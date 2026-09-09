import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service.js";
import {
  SNAPSHOT_FORMULA_VERSION,
  SNAPSHOT_OPERATIONAL_LIMITS,
} from "./snapshot-config.js";
import {
  ASSERT_VALID_SOURCE_KEYS_SQL,
  COMPLETE_MANIFEST_SQL,
  COMPLETE_WORK_SQL,
  FAIL_MANIFEST_SQL,
  INSERT_BUILDING_MANIFEST_SQL,
  LOCK_POINTER_SQL,
  LOCK_PUBLICATION_SQL,
  MATERIALIZE_DELTA_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  PUBLICATION_OPERATIONAL_GATE_SQL,
  SET_BUILD_STATEMENT_TIMEOUT_SQL,
  SET_PUBLISH_TIMEOUT_SQL,
  SET_UNIT_SCOPE_SQL,
  SOURCE_CYCLE_EVIDENCE_SQL,
  UPSERT_POINTER_SQL,
  VALIDATE_BASELINE_SQL,
  VALIDATE_GENERATION_SQL,
} from "./snapshot-sql.js";

export interface SnapshotBuildRequest {
  unitId: number;
  asOfDate: string;
  sourceCycleId: string;
  sourceCycleSequence: bigint;
  rebuildEpoch: bigint;
  workId?: string;
}

export interface SnapshotBuildHooks {
  /** Deterministic barrier used only by the synthetic negative-unit fixture. */
  beforePointerSwap?: (context: {
    unitId: number;
    asOfDate: string;
    generationId: string;
  }) => Promise<void> | void;
  /** Fixed WIB minute used only by Vitest against an ephemeral negative unit. */
  syntheticWibMinutes?: number;
}

export interface PublishedGeneration {
  asOfDate: string;
  generationId: string;
}

export interface SnapshotBuildResult {
  baseline: PublishedGeneration;
  target: PublishedGeneration;
}

type SqlTransaction = Prisma.TransactionClient;
type PublicationTuple = readonly [sourceSequence: bigint, rebuildEpoch: bigint];

interface SourceEvidenceRow {
  source_cycle_id: string;
}

interface CountRow {
  invalid_key_count: bigint | number | string;
}

interface BaselineRow {
  generation_id: string;
}

interface ManifestLockRow {
  source_cycle_id: string;
  source_cycle_sequence: bigint | number | string;
  rebuild_epoch: bigint | number | string;
  status: string;
}

interface PointerLockRow {
  generation_id: string;
  source_cycle_sequence: bigint | number | string;
  rebuild_epoch: bigint | number | string;
}

interface OperationalGateRow {
  wib_minutes: number;
  database_bytes: bigint | number | string;
}

interface ValidationRow {
  row_count: bigint | number | string;
  row_keyed_checksum: Uint8Array;
  awal_piutang_lokal_total: unknown;
  akhir_piutang_lokal_total: unknown;
  awal_piutang_online_total: unknown;
  akhir_piutang_online_total: unknown;
  awal_hutang_lokal_total: unknown;
  akhir_hutang_lokal_total: unknown;
}

interface ReturningIdRow {
  generation_id?: string;
  work_id?: string;
}

export class SnapshotBuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SnapshotBuildError";
  }
}

function asBigInt(value: bigint | number | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function numericText(value: unknown): string {
  if (value === null || value === undefined) return "0";
  return String(value);
}

export function comparePublicationTuple(
  candidate: PublicationTuple,
  current: PublicationTuple,
): number {
  if (candidate[0] !== current[0]) return candidate[0] > current[0] ? 1 : -1;
  if (candidate[1] !== current[1]) return candidate[1] > current[1] ? 1 : -1;
  return 0;
}

export function previousMonthEnd(asOfDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error("asOfDate invalid");
  const [year, month] = asOfDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, 0));
  return date.toISOString().slice(0, 10);
}

export function evaluateOperationalGate(
  wibMinutes: number,
  databaseBytes: number,
  forLease: boolean,
): { ok: true } | { ok: false; reason: string } {
  const limits = SNAPSHOT_OPERATIONAL_LIMITS;
  if (databaseBytes >= limits.databaseReviewBytes) {
    return { ok: false, reason: "disk_review_required" };
  }
  if (
    wibMinutes < limits.buildWindowStartMinutes ||
    wibMinutes >= limits.buildWindowEndMinutes
  ) {
    return { ok: false, reason: "outside_build_window" };
  }
  if (forLease && wibMinutes >= limits.latestLeaseMinutes) {
    return { ok: false, reason: "latest_lease_passed" };
  }
  return { ok: true };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function assertBuildRequest(request: SnapshotBuildRequest): void {
  if (!Number.isInteger(request.unitId) || request.unitId < -32_768 || request.unitId > 32_767) {
    throw new Error("unitId must be a SMALLINT");
  }
  if (!validCalendarDate(request.asOfDate)) throw new Error("asOfDate must be a calendar date");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.sourceCycleId)) {
    throw new Error("sourceCycleId must be a UUID");
  }
  if (request.sourceCycleSequence <= 0n) throw new Error("sourceCycleSequence must be positive");
  if (request.rebuildEpoch < 0n) throw new Error("rebuildEpoch must be nonnegative");
  if (request.workId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.workId)) {
    throw new Error("workId must be a UUID");
  }
}

@Injectable()
export class SnapshotBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    request: SnapshotBuildRequest,
    hooks: SnapshotBuildHooks = {},
  ): Promise<SnapshotBuildResult> {
    assertBuildRequest(request);
    this.assertSyntheticHooks(request, hooks);

    await this.assertSourceCut(request, request.asOfDate);
    const baselineDate = previousMonthEnd(request.asOfDate);
    let baseline = await this.findValidBaseline(request, baselineDate);
    if (!baseline) {
      baseline = await this.buildGeneration(
        request,
        baselineDate,
        undefined,
        undefined,
        hooks,
      );
    }

    const target = await this.buildGeneration(
      request,
      request.asOfDate,
      baseline,
      request.workId,
      hooks,
    );
    return { baseline, target };
  }

  private assertSyntheticHooks(
    request: SnapshotBuildRequest,
    hooks: SnapshotBuildHooks,
  ): void {
    if (hooks.syntheticWibMinutes === undefined) return;
    if (process.env.NODE_ENV !== "test" || request.unitId >= 0) {
      throw new Error("synthetic clock is restricted to negative-unit tests");
    }
    if (!Number.isInteger(hooks.syntheticWibMinutes)) {
      throw new Error("syntheticWibMinutes must be an integer");
    }
  }

  private async inUnitTransaction<T>(
    unitId: number,
    timeoutSql: string,
    run: (tx: SqlTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      await tx.$executeRawUnsafe(timeoutSql);
      return run(tx);
    });
  }

  private async assertSourceCut(
    request: SnapshotBuildRequest,
    asOfDate: string,
  ): Promise<void> {
    await this.inUnitTransaction(request.unitId, SET_BUILD_STATEMENT_TIMEOUT_SQL, async (tx) => {
      const evidence = await tx.$queryRawUnsafe<SourceEvidenceRow[]>(
        SOURCE_CYCLE_EVIDENCE_SQL,
        request.unitId,
        request.sourceCycleId,
        request.sourceCycleSequence,
      );
      if (evidence.length !== 1) {
        throw new SnapshotBuildError(
          "source_cut_incomplete",
          "source cut is absent, incomplete, or its row-count evidence disagrees",
          false,
        );
      }
      const invalid = await tx.$queryRawUnsafe<CountRow[]>(
        ASSERT_VALID_SOURCE_KEYS_SQL,
        request.unitId,
        request.sourceCycleId,
        asOfDate,
      );
      if (asBigInt(invalid[0]?.invalid_key_count ?? 0) !== 0n) {
        throw new SnapshotBuildError(
          "invalid_customer_key",
          "complete source cut contains a blank customer key in the target population",
          false,
        );
      }
    });
  }

  private async findValidBaseline(
    request: SnapshotBuildRequest,
    baselineDate: string,
  ): Promise<PublishedGeneration | undefined> {
    return this.inUnitTransaction(request.unitId, SET_BUILD_STATEMENT_TIMEOUT_SQL, async (tx) => {
      const rows = await tx.$queryRawUnsafe<BaselineRow[]>(
        VALIDATE_BASELINE_SQL,
        request.unitId,
        baselineDate,
        SNAPSHOT_FORMULA_VERSION,
        request.sourceCycleId,
      );
      const generationId = rows[0]?.generation_id;
      return generationId ? { asOfDate: baselineDate, generationId } : undefined;
    });
  }

  private async buildGeneration(
    request: SnapshotBuildRequest,
    asOfDate: string,
    baseline: PublishedGeneration | undefined,
    workId: string | undefined,
    hooks: SnapshotBuildHooks,
  ): Promise<PublishedGeneration> {
    await this.assertSourceCut(request, asOfDate);
    const generationId = randomUUID();
    let manifestCreated = false;
    try {
      await this.inUnitTransaction(request.unitId, SET_BUILD_STATEMENT_TIMEOUT_SQL, async (tx) => {
        const inserted = await tx.$queryRawUnsafe<ReturningIdRow[]>(
          INSERT_BUILDING_MANIFEST_SQL,
          request.unitId,
          asOfDate,
          generationId,
          SNAPSHOT_FORMULA_VERSION,
          request.sourceCycleId,
          request.sourceCycleSequence,
          request.rebuildEpoch,
          baseline?.asOfDate ?? null,
          baseline?.generationId ?? null,
        );
        if (inserted.length !== 1) {
          throw new SnapshotBuildError("manifest_not_created", "building manifest was not created", true);
        }
      });
      manifestCreated = true;

      await this.inUnitTransaction(request.unitId, SET_BUILD_STATEMENT_TIMEOUT_SQL, async (tx) => {
        if (baseline) {
          await tx.$executeRawUnsafe(
            MATERIALIZE_DELTA_SQL,
            request.unitId,
            asOfDate,
            generationId,
            request.sourceCycleId,
            baseline.asOfDate,
            baseline.generationId,
          );
        } else {
          await tx.$executeRawUnsafe(
            MATERIALIZE_FULL_HISTORY_SQL,
            request.unitId,
            asOfDate,
            generationId,
            request.sourceCycleId,
          );
        }
      });

      const published = await this.publishPreparedGeneration(
        { ...request, asOfDate, workId },
        generationId,
        hooks,
      );
      if (!published) {
        throw new SnapshotBuildError(
          "superseded",
          "a newer or different equal publication tuple is already active",
          false,
        );
      }
      return { asOfDate, generationId };
    } catch (error) {
      if (manifestCreated) await this.markManifestFailed(request.unitId, asOfDate, generationId, error);
      throw error;
    }
  }

  /**
   * Final validation + manifest completion + pointer CAS share one transaction.
   * The optional barrier deliberately pauses inside that transaction for the
   * two-client atomicity proof.
   */
  async publishPreparedGeneration(
    request: SnapshotBuildRequest,
    generationId: string,
    hooks: SnapshotBuildHooks = {},
  ): Promise<boolean> {
    assertBuildRequest(request);
    this.assertSyntheticHooks(request, hooks);
    return this.inUnitTransaction(request.unitId, SET_PUBLISH_TIMEOUT_SQL, async (tx) => {
      const manifests = await tx.$queryRawUnsafe<ManifestLockRow[]>(
        LOCK_PUBLICATION_SQL,
        request.unitId,
        request.asOfDate,
        generationId,
      );
      const manifest = manifests[0];
      if (!manifest || manifest.status !== "building") {
        throw new SnapshotBuildError("manifest_not_building", "generation is not publishable", false);
      }
      if (
        manifest.source_cycle_id !== request.sourceCycleId ||
        asBigInt(manifest.source_cycle_sequence) !== request.sourceCycleSequence ||
        asBigInt(manifest.rebuild_epoch) !== request.rebuildEpoch
      ) {
        throw new SnapshotBuildError("manifest_provenance_mismatch", "manifest provenance changed", false);
      }

      const pointers = await tx.$queryRawUnsafe<PointerLockRow[]>(
        LOCK_POINTER_SQL,
        request.unitId,
        request.asOfDate,
      );
      const pointer = pointers[0];
      if (pointer) {
        const ordering = comparePublicationTuple(
          [request.sourceCycleSequence, request.rebuildEpoch],
          [asBigInt(pointer.source_cycle_sequence), asBigInt(pointer.rebuild_epoch)],
        );
        if (ordering < 0 || (ordering === 0 && pointer.generation_id !== generationId)) {
          await tx.$queryRawUnsafe(
            FAIL_MANIFEST_SQL,
            request.unitId,
            request.asOfDate,
            generationId,
            "superseded",
            "a newer or different equal publication tuple is already active",
            false,
          );
          if (request.workId) {
            await tx.$queryRawUnsafe(
              COMPLETE_WORK_SQL,
              request.unitId,
              request.workId,
              generationId,
            );
          }
          return false;
        }
      }

      const gateRows = await tx.$queryRawUnsafe<OperationalGateRow[]>(
        PUBLICATION_OPERATIONAL_GATE_SQL,
      );
      const gateRow = gateRows[0];
      if (!gateRow) throw new SnapshotBuildError("operational_gate_unavailable", "cannot read DB clock/size", true);
      const wibMinutes = hooks.syntheticWibMinutes ?? gateRow.wib_minutes;
      const gate = evaluateOperationalGate(wibMinutes, Number(gateRow.database_bytes), false);
      if (!gate.ok) throw new SnapshotBuildError(gate.reason, `publication stopped: ${gate.reason}`, true);

      const validated = await tx.$queryRawUnsafe<ValidationRow[]>(
        VALIDATE_GENERATION_SQL,
        request.unitId,
        request.asOfDate,
        generationId,
      );
      const proof = validated[0];
      if (!proof || !proof.row_keyed_checksum) {
        throw new SnapshotBuildError("generation_validation_failed", "generation proof is absent", false);
      }
      const completed = await tx.$queryRawUnsafe<ReturningIdRow[]>(
        COMPLETE_MANIFEST_SQL,
        request.unitId,
        request.asOfDate,
        generationId,
        asBigInt(proof.row_count),
        Buffer.from(proof.row_keyed_checksum),
        numericText(proof.awal_piutang_lokal_total),
        numericText(proof.akhir_piutang_lokal_total),
        numericText(proof.awal_piutang_online_total),
        numericText(proof.akhir_piutang_online_total),
        numericText(proof.awal_hutang_lokal_total),
        numericText(proof.akhir_hutang_lokal_total),
      );
      if (completed.length !== 1) {
        throw new SnapshotBuildError("manifest_completion_failed", "manifest completion lost provenance", false);
      }

      await hooks.beforePointerSwap?.({
        unitId: request.unitId,
        asOfDate: request.asOfDate,
        generationId,
      });

      const swapped = await tx.$queryRawUnsafe<ReturningIdRow[]>(
        UPSERT_POINTER_SQL,
        request.unitId,
        request.asOfDate,
        generationId,
        request.sourceCycleSequence,
        request.rebuildEpoch,
      );
      if (swapped.length !== 1) {
        throw new SnapshotBuildError("pointer_cas_lost", "pointer CAS did not select the generation", false);
      }
      if (request.workId) {
        const done = await tx.$queryRawUnsafe<ReturningIdRow[]>(
          COMPLETE_WORK_SQL,
          request.unitId,
          request.workId,
          generationId,
        );
        if (done.length !== 1) {
          throw new SnapshotBuildError("work_completion_failed", "leased work was not completed atomically", true);
        }
      }
      return true;
    });
  }

  private async markManifestFailed(
    unitId: number,
    asOfDate: string,
    generationId: string,
    error: unknown,
  ): Promise<void> {
    const buildError = error instanceof SnapshotBuildError
      ? error
      : new SnapshotBuildError("builder_error", error instanceof Error ? error.message : String(error), true);
    try {
      await this.inUnitTransaction(unitId, SET_PUBLISH_TIMEOUT_SQL, async (tx) => {
        await tx.$queryRawUnsafe(
          FAIL_MANIFEST_SQL,
          unitId,
          asOfDate,
          generationId,
          buildError.code,
          buildError.message.slice(0, 2_000),
          buildError.retryable,
        );
      });
    } catch {
      // Preserve the original failure. Reaper owns any manifest left building.
    }
  }
}
