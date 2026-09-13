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
 * Klasifikasi sebab skip: INSIDEN atau NORMAL.
 *
 * ⚠️ KENAPA INI ADA. Antara 12 dan 14 September 2026 build snapshot BEKU
 * berhari-hari: `pg_database_size` melewati `databaseReviewBytes`, dan karena
 * batas byte diperiksa PALING AWAL (`snapshot-builder.service.ts:192-194`)
 * setiap invokasi memulangkan `disk_review_required` pada jam berapa pun.
 * Tidak ada yang melihatnya, karena:
 *   · baris lognya hanya memuat `status:"skipped"`, tanpa sebab; dan
 *   · HTTP-nya 425 — SAMA PERSIS dengan `outside_build_window`, yang normal
 *     terjadi 21 dari 24 jam.
 * Dua keadaan yang sangat berbeda derajatnya tidak dapat dibedakan dari luar,
 * jadi yang berbahaya bersembunyi di balik yang wajar.
 *
 * Bentuk perbaikannya, bukan sekadar kejadiannya: sebab skip dipetakan ke
 * status HTTP DAN tingkat log yang berbeda, sehingga ia terbaca di request log
 * Cloud Run (yang hanya menyimpan status) maupun di penyaring severity
 * Cloud Logging (yang dipakai alarm).
 *
 * Sebab yang TIDAK dikenal diperlakukan sebagai INSIDEN, bukan normal. Sebab
 * baru yang lupa diklasifikasikan adalah persis kelas kegagalan di atas; ia
 * harus berisik, bukan diam. `snapshot-trigger.classification.test.ts`
 * membaca literal `reason:` dari sumbernya dan menjatuhkan uji bila ada yang
 * belum terdaftar di sini.
 */
export const SNAPSHOT_SKIP_CLASSIFICATION: Readonly<Record<string, { http: number; incident: boolean }>> =
  Object.freeze({
    // Gerbang kapasitas tertutup: TIDAK ADA snapshot yang bisa terbit, jam
    // berapa pun. 507 Insufficient Storage menamai sebabnya di status itu
    // sendiri, sehingga request log saja sudah cukup untuk melihatnya.
    disk_review_required: { http: 507, incident: true },
    // Baris gerbang tidak terbaca — keadaan tak dapat dinilai, bukan normal.
    operational_gate_unavailable: { http: HttpStatus.SERVICE_UNAVAILABLE, incident: true },
    // Normal: 21 dari 24 jam berada di luar jendela 02.00-05.00 WIB.
    outside_build_window: { http: 425, incident: false },
    // Normal: lewat 04:45 WIB lease baru memang tidak diambil lagi.
    latest_lease_passed: { http: 425, incident: false },
    // Normal per invokasi: sisa pekerjaan dilanjutkan invokasi berikutnya.
    request_deadline_exhausted: { http: 425, incident: false },
  });

export const SNAPSHOT_UNKNOWN_SKIP = Object.freeze({
  http: HttpStatus.INTERNAL_SERVER_ERROR,
  incident: true,
});

export function classifySkip(reason: string): { http: number; incident: boolean } {
  return SNAPSHOT_SKIP_CLASSIFICATION[reason] ?? SNAPSHOT_UNKNOWN_SKIP;
}

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

    const skip = result.status === "skipped" ? classifySkip(result.reason) : undefined;
    // Insiden ditulis sebagai WARN supaya penyaring severity Cloud Logging
    // melihatnya; skip normal tetap LOG dan tidak menimbulkan kebisingan.
    const write = skip?.incident
      ? (line: string) => this.logger.warn(line)
      : (line: string) => this.logger.log(line);
    write(JSON.stringify({
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
      // Sebabnya WAJIB ikut. Tanpa ini log hanya berbunyi status:"skipped", dan
      // `disk_review_required` (pipeline BEKU, insiden) tidak dapat dibedakan
      // dari `outside_build_window` (normal, 21 dari 24 jam). Dibayar 13-14 Sep
      // 2026: produksi 13,97 GB melewati gerbang 9 GB dan setiap invokasi
      // di-skip selama berhari-hari tanpa satu baris log pun menyebutkan disk.
      ...(result.status === "skipped" ? { reason: result.reason, incident: skip!.incident } : {}),
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
        throwWorkerOutcome(result, skip!.http);
      case "retry_wait":
        throwWorkerOutcome(result, HttpStatus.SERVICE_UNAVAILABLE);
      case "dead_letter":
        throwWorkerOutcome(result, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
