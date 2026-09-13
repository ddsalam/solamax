import { randomUUID, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { SNAPSHOT_BACKFILL_LIMITS } from "./snapshot-config.js";
import { PrismaService } from "../prisma.service.js";
import {
  type SnapshotWorkerBatchResult,
  SnapshotWorkerService,
} from "./snapshot-worker.service.js";

/**
 * Cloud Run is configured to stop requests after 20 minutes. Keep two minutes
 * for HTTP/framework cleanup after source finalization plus the bounded build.
 */
export const SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS = SNAPSHOT_BACKFILL_LIMITS.requestMilliseconds;

function isAuthorized(given: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  const supplied = Buffer.from(given, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

function parseOptions(body: unknown): { unitId: number; backfillDays: number; maxItems: number } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const unitId = input.unit_id;
  const backfillDays = input.backfill_days === undefined ? SNAPSHOT_BACKFILL_LIMITS.defaultDays : input.backfill_days;
  const maxItems = input.max_items === undefined ? SNAPSHOT_BACKFILL_LIMITS.defaultItems : input.max_items;
  if (!Number.isInteger(unitId) || Number(unitId) < -32_768 || Number(unitId) > 32_767
    || !Number.isInteger(backfillDays) || Number(backfillDays) < 0 || Number(backfillDays) > SNAPSHOT_BACKFILL_LIMITS.maxDays
    || !Number.isInteger(maxItems) || Number(maxItems) < 1 || Number(maxItems) > SNAPSHOT_BACKFILL_LIMITS.maxItems) {
    return null;
  }
  return { unitId: Number(unitId), backfillDays: Number(backfillDays), maxItems: Number(maxItems) };
}

function rejectWithoutOracle(): never {
  // Secret failures, malformed identifiers, and unknown/inactive units are
  // deliberately indistinguishable to callers outside the application RBAC.
  throw new NotFoundException();
}

function throwWorkerOutcome(result: SnapshotWorkerBatchResult, status: number): never {
  const body = result.status === "skipped"
    ? { status: result.status, reason: result.reason }
    : { status: result.status };
  throw new HttpException({
    ...body,
    processedCount: result.processedCount,
    completedCount: result.completedCount,
    supersededCount: result.supersededCount,
  }, status);
}

@Controller("snapshot-worker")
export class SnapshotTriggerController {
  private readonly logger = new Logger(SnapshotTriggerController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: SnapshotWorkerService,
  ) {}

  @Post()
  async trigger(
    @Headers("x-snapshot-secret") suppliedSecret: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SnapshotWorkerBatchResult | undefined> {
    const startedAt = Date.now();
    if (!isAuthorized(suppliedSecret, process.env.SNAPSHOT_TRIGGER_SECRET)) {
      rejectWithoutOracle();
    }

    const options = parseOptions(body);
    if (!options) rejectWithoutOracle();
    const { unitId, backfillDays, maxItems } = options;

    let activeUnit: { unitId: number } | null;
    try {
      activeUnit = await this.prisma.unit.findFirst({
        where: { unitId, active: true },
        select: { unitId: true },
      });
    } catch {
      this.logger.error(JSON.stringify({
        msg: "snapshot-worker unit lookup failed",
        unit_id: unitId,
      }));
      throw new HttpException({ status: "failed" }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!activeUnit) rejectWithoutOracle();

    const leaseOwner = `snapshot-http:${hostname()}:${randomUUID()}`;
    let result: SnapshotWorkerBatchResult;
    try {
      result = await this.worker.runBatch(unitId, leaseOwner, {
        backfillDays,
        maxItems,
        attemptDeadlineEpochMs: startedAt + SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS,
      });
    } catch {
      this.logger.error(JSON.stringify({
        msg: "snapshot-worker invocation failed",
        unit_id: unitId,
        ms: Date.now() - startedAt,
      }));
      throw new HttpException({ status: "failed" }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    this.logger.log(JSON.stringify({
      msg: "snapshot-worker invocation finished",
      unit_id: unitId,
      status: result.status,
      processed_count: result.processedCount,
      completed_count: result.completedCount,
      superseded_count: result.supersededCount,
      ms: Date.now() - startedAt,
      ...(result.status === "done" ? {
        work_id: result.workId,
        generation_id: result.generationId,
      } : {}),
      ...("workId" in result && result.status !== "done" ? { work_id: result.workId } : {}),
    }));

    switch (result.status) {
      case "done":
        response.status(HttpStatus.OK);
        return result;
      case "idle":
        response.status(HttpStatus.NO_CONTENT);
        return undefined;
      case "superseded":
        response.status(208);
        return result;
      case "busy":
        throwWorkerOutcome(result, HttpStatus.CONFLICT);
      case "skipped":
        throwWorkerOutcome(result, 425);
      case "retry_wait":
        throwWorkerOutcome(result, HttpStatus.SERVICE_UNAVAILABLE);
      case "dead_letter":
        throwWorkerOutcome(result, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
