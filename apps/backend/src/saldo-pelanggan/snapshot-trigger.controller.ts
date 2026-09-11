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
import { PrismaService } from "../prisma.service.js";
import {
  type SnapshotWorkerResult,
  SnapshotWorkerService,
} from "./snapshot-worker.service.js";

/**
 * Cloud Run is configured to stop requests after 20 minutes. Keep two minutes
 * for HTTP/framework cleanup after source finalization plus the bounded build.
 */
export const SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS = 18 * 60 * 1_000;

function isAuthorized(given: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  const supplied = Buffer.from(given, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

function parseUnitId(body: unknown): number | null {
  if (!body || typeof body !== "object" || !("unit_id" in body)) return null;
  const unitId = (body as { unit_id?: unknown }).unit_id;
  if (!Number.isInteger(unitId) || Number(unitId) < -32_768 || Number(unitId) > 32_767) {
    return null;
  }
  return Number(unitId);
}

function rejectWithoutOracle(): never {
  // Secret failures, malformed identifiers, and unknown/inactive units are
  // deliberately indistinguishable to callers outside the application RBAC.
  throw new NotFoundException();
}

function throwWorkerOutcome(result: SnapshotWorkerResult, status: number): never {
  const body = result.status === "skipped"
    ? { status: result.status, reason: result.reason }
    : { status: result.status };
  throw new HttpException(body, status);
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
  ): Promise<SnapshotWorkerResult | undefined> {
    if (!isAuthorized(suppliedSecret, process.env.SNAPSHOT_TRIGGER_SECRET)) {
      rejectWithoutOracle();
    }

    const unitId = parseUnitId(body);
    if (unitId === null) rejectWithoutOracle();

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

    const startedAt = Date.now();
    const leaseOwner = `snapshot-http:${hostname()}:${randomUUID()}`;
    let result: SnapshotWorkerResult;
    try {
      result = await this.worker.runOnce(unitId, leaseOwner, {
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
