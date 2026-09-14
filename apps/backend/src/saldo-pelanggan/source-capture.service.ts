import { Injectable } from "@nestjs/common";
import type { IngestPayload, SourceCut } from "@solamax/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service.js";
import {
  CLAIM_DOMAIN_COMPLETE_SQL,
  COMPLETE_DOMAIN_SQL,
  DIFF_LEDGER_SQL,
  DIFF_PELANGGAN_SQL,
  DOMAIN_EVIDENCE_SQL,
  ENQUEUE_STALE_POINTERS_SQL,
  ENQUEUE_BACKFILL_SQL,
  READ_BACKFILL_SOURCE_CYCLE_SQL,
  SUPERSEDE_BACKFILL_WORK_SQL,
  ENSURE_SOURCE_CYCLE_SQL,
  FAIL_OBSOLETE_SOURCE_CYCLE_SQL,
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  LOCK_SOURCE_CAPTURE_SQL,
  LOCK_SOURCE_CYCLE_ALLOCATION_SQL,
  MARK_STALE_POINTERS_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  PROMOTE_SOURCE_CYCLE_SQL,
  READ_LATEST_COMPLETE_SEQUENCE_SQL,
  READ_LATEST_SOURCE_SEQUENCE_SQL,
  COUNT_STAGING_CYCLES_SQL,
  READ_READY_SOURCE_CYCLE_SQL,
  READ_SOURCE_CYCLE_SQL,
  REFRESH_PREVIOUS_CYCLE_SQL,
  STAGE_BPHUT_SQL,
  STAGE_BPPIUT_SQL,
  STAGE_PELANGGAN_SQL,
  SUPERSEDE_PENDING_WORK_SQL,
  UPSERT_DIRTY_WATERMARK_SQL,
} from "./source-capture-sql.js";
import { SNAPSHOT_BACKFILL_LIMITS, SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";
import { SET_UNIT_SCOPE_SQL } from "./snapshot-sql.js";

export type SourceCutDomain = SourceCut["domain"];

export type SnapshotCaptureStep =
  | "ensure_cycle"
  | "stage_rows"
  | "complete_domain"
  | "verify_domains"
  | "diff_changes"
  | "dirty_watermark"
  | "mark_pointers"
  | "promote_cycle"
  | "enqueue_work"
  | "prune_source_cuts";

export interface SnapshotCaptureHooks {
  /** Deterministic fault barrier used only by synthetic fixtures. */
  beforeStep?: (step: SnapshotCaptureStep) => Promise<void> | void;
}

export interface SnapshotCaptureResult {
  outcome: "staging" | "ready" | "complete" | "already_complete" | "obsolete";
  cycleId: string;
  sourceCycleSequence: bigint;
}

type Tx = Prisma.TransactionClient;

interface CycleRow {
  source_cycle_id: string;
  source_cycle_sequence: bigint | number | string;
  previous_source_cycle_id: string | null;
  status: "staging" | "complete" | "failed";
  pelanggan_row_count: bigint | number | string | null;
  bppiut_row_count: bigint | number | string | null;
  bphut_row_count: bigint | number | string | null;
}

interface SequenceRow {
  source_cycle_sequence: bigint | number | string;
}

interface EvidenceRow {
  row_count: bigint | number | string;
  keyed_checksum: Uint8Array;
}

interface ReturningCycleRow {
  source_cycle_id: string;
  source_cycle_sequence?: bigint | number | string;
}

const STAGE_SQL: Record<SourceCutDomain, string> = {
  pelanggan_master: STAGE_PELANGGAN_SQL,
  bppiut: STAGE_BPPIUT_SQL,
  bphut: STAGE_BPHUT_SQL,
};

const SOURCE_CUT_DOMAINS: readonly SourceCutDomain[] = [
  "pelanggan_master",
  "bppiut",
  "bphut",
];

function rowsForDomain(payload: IngestPayload, domain: SourceCutDomain): unknown[] {
  return (payload.tables[domain] ?? []) as unknown[];
}

function allDomainsComplete(cycle: CycleRow): boolean {
  return cycle.pelanggan_row_count !== null
    && cycle.bppiut_row_count !== null
    && cycle.bphut_row_count !== null;
}

export class SnapshotCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotCaptureError";
  }
}

/** Ringkasan satu putaran pemensiunan, untuk dibaca operator tanpa psql. */
export interface RetirementSummary {
  stagingBefore: number;
  stagingAfter: number;
  rowsDeleted: number;
}

@Injectable()
export class SnapshotSourceCaptureService {
  constructor(private readonly prisma: PrismaService) {}

  async capture(
    unitId: number,
    payload: IngestPayload,
    hooks: SnapshotCaptureHooks = {},
  ): Promise<SnapshotCaptureResult | null> {
    const sourceCut = payload.source_cut;
    if (!sourceCut) return null;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      await tx.$executeRawUnsafe(LOCK_SOURCE_CYCLE_ALLOCATION_SQL, unitId);

      await hooks.beforeStep?.("ensure_cycle");
      let cycle = await this.readCycle(tx, unitId, sourceCut.cycle_id, false);
      if (!cycle) {
        await tx.$executeRawUnsafe(
          ENSURE_SOURCE_CYCLE_SQL,
          unitId,
          sourceCut.cycle_id,
        );
        cycle = await this.readCycle(tx, unitId, sourceCut.cycle_id);
      }
      const sequence = BigInt(cycle.source_cycle_sequence);
      if (cycle.status === "complete") {
        return {
          outcome: "already_complete" as const,
          cycleId: sourceCut.cycle_id,
          sourceCycleSequence: sequence,
        };
      }
      if (cycle.status === "failed") {
        return {
          outcome: "obsolete" as const,
          cycleId: sourceCut.cycle_id,
          sourceCycleSequence: sequence,
        };
      }

      await hooks.beforeStep?.("stage_rows");
      await tx.$executeRawUnsafe(
        STAGE_SQL[sourceCut.domain],
        unitId,
        sourceCut.cycle_id,
        JSON.stringify(rowsForDomain(payload, sourceCut.domain)),
      );

      if (sourceCut.chunk_index !== sourceCut.chunk_count - 1) {
        return {
          outcome: "staging" as const,
          cycleId: sourceCut.cycle_id,
          sourceCycleSequence: sequence,
        };
      }

      await hooks.beforeStep?.("complete_domain");
      const completedDomain = await tx.$queryRawUnsafe<CycleRow[]>(
        CLAIM_DOMAIN_COMPLETE_SQL[sourceCut.domain],
        unitId,
        sourceCut.cycle_id,
        sourceCut.row_count,
      );
      if (completedDomain.length !== 1) {
        throw new SnapshotCaptureError(
          "domain_completion_conflict",
          `source-cut proof changed for ${sourceCut.domain}`,
        );
      }

      cycle = completedDomain[0]!;
      if (!allDomainsComplete(cycle)) {
        return {
          outcome: "staging" as const,
          cycleId: sourceCut.cycle_id,
          sourceCycleSequence: sequence,
        };
      }

      return {
        outcome: "ready" as const,
        cycleId: sourceCut.cycle_id,
        sourceCycleSequence: sequence,
      };
    // Anggaran per-chunk. Ukuran 3 detik yang lama TERBUKTI menghancurkan fitur:
    // pada cut IB 12-09 p50 hanya 256 ms tetapi p95 1.470 ms dan max 4.762 ms,
    // sehingga 9 dari 712 chunk (1,26%) kedaluwarsa. Karena capture fail-open di
    // /ingest, chunk yang gagal HILANG DIAM-DIAM dan cut tak pernah mencapai
    // jumlah baris yang dideklarasikan agent — satu cut utuh butuh 709 chunk
    // lolos semua, peluangnya ~0,013%. Menaikkan plafon tidak memperlambat
    // permintaan yang sehat: p50 tetap 256 ms, hanya ekor yang kini selesai
    // alih-alih dibuang.
    }, { maxWait: 5_000, timeout: 30_000 });
  }

  /**
   * Retire staging cuts the agent has already moved past, and release their
   * rows. Deliberately independent of promotion and of every operational gate.
   *
   * Before this existed, the only path that marked a staging cut `failed` was
   * `finalizeReady`, and the only caller of `finalizeReady` sits *behind* the
   * capacity gate. That made the two mutually dependent: once staging rows
   * pushed the database past `databaseReviewBytes`, the gate refused, the
   * collector never ran, the disk never shrank, and the gate refused again.
   * Observed 2026-09-12 on production: 7.2 GB of 9.66 GB were staging rows
   * from cuts that could never win, and no cut had ever been pruned.
   *
   * Retirement is safe without a winner: any cut strictly below the newest
   * allocated sequence has already lost, whether or not a later one completed.
   * The newest cut is never touched, so an in-flight capture keeps its rows.
   */
  async collectRetiredSources(unitId: number): Promise<RetirementSummary> {
    const summary: RetirementSummary = { stagingBefore: 0, stagingAfter: 0, rowsDeleted: 0 };
    // Tahap 1 — menandai. Murni UPDATE metadata, selalu murah.
    // Kedua hitungan staging diambil DI SINI, bukan sesudah pengurasan:
    // staging->failed terjadi pada penandaan, sementara pengurasan hanya
    // menghapus BARIS. Menghitung ulang sesudahnya menambah round-trip yang
    // tidak mungkin memberi angka berbeda.
    const marked = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      await tx.$executeRawUnsafe(LOCK_SOURCE_CAPTURE_SQL, unitId);

      const latestRows = await tx.$queryRawUnsafe<SequenceRow[]>(
        READ_LATEST_SOURCE_SEQUENCE_SQL,
        unitId,
      );
      const latest = latestRows[0];
      summary.stagingBefore = await this.countStaging(tx, unitId);
      if (!latest) {
        summary.stagingAfter = summary.stagingBefore;
        return false;
      }

      await tx.$executeRawUnsafe(
        FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
        unitId,
        BigInt(latest.source_cycle_sequence),
      );
      summary.stagingAfter = await this.countStaging(tx, unitId);
      return true;
    }, { timeout: SNAPSHOT_RETIREMENT_LIMITS.batchMilliseconds });
    if (!marked) return summary;

    // Tahap 2 — pengurasan. Tiap batch COMMIT sendiri, jadi budget yang habis
    // meninggalkan kemajuan yang tersimpan, bukan nol. Ini yang membedakannya
    // dari bentuk lama: di sana satu pernyataan tak berbatas melewati budget
    // dan seluruhnya di-rollback, diam-diam, berulang kali.
    const deadline = Date.now() + SNAPSHOT_RETIREMENT_LIMITS.budgetMilliseconds;
    for (const sql of PRUNE_RETIRED_SOURCE_ROWS_SQL) {
      while (Date.now() < deadline) {
        const deleted = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
          await tx.$executeRawUnsafe(LOCK_SOURCE_CAPTURE_SQL, unitId);
          return tx.$executeRawUnsafe(sql, unitId, SNAPSHOT_RETIREMENT_LIMITS.batchRows);
        }, { timeout: SNAPSHOT_RETIREMENT_LIMITS.batchMilliseconds });
        // Batch yang tidak penuh berarti tabel ini sudah terkuras. Berhenti di
        // sini, bukan pada `deleted === 0`, supaya tidak ada lintasan kosong
        // tambahan per tabel setiap kali pemensiunan berjalan.
        summary.rowsDeleted += deleted;
        if (deleted < SNAPSHOT_RETIREMENT_LIMITS.batchRows) break;
      }
    }
    return summary;
  }

  private async countStaging(tx: Tx, unitId: number): Promise<number> {
    const rows = await tx.$queryRawUnsafe<Array<{ staging_count: bigint }>>(
      COUNT_STAGING_CYCLES_SQL,
      unitId,
    );
    return Number(rows[0]?.staging_count ?? 0);
  }

  /**
   * Finalize at most one durable ready cut. The snapshot worker calls this
   * inside its existing operational window, so HTTP ingest never waits for
   * full-cut diff, dirty propagation, or rebuild queue fan-out.
   */
  async finalizeReady(
    unitId: number,
    hooks: SnapshotCaptureHooks = {},
  ): Promise<SnapshotCaptureResult | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      await tx.$executeRawUnsafe(LOCK_SOURCE_CAPTURE_SQL, unitId);

      const readyRows = await tx.$queryRawUnsafe<CycleRow[]>(
        READ_READY_SOURCE_CYCLE_SQL,
        unitId,
      );
      const cycle = readyRows[0];
      if (!cycle) return null;

      const sequence = BigInt(cycle.source_cycle_sequence);
      const cycleId = cycle.source_cycle_id;

      const latestRows = await tx.$queryRawUnsafe<SequenceRow[]>(
        READ_LATEST_COMPLETE_SEQUENCE_SQL,
        unitId,
      );
      const latestSequence = latestRows[0]
        ? BigInt(latestRows[0].source_cycle_sequence)
        : 0n;
      if (latestSequence > sequence) {
        const failed = await tx.$queryRawUnsafe<ReturningCycleRow[]>(
          FAIL_OBSOLETE_SOURCE_CYCLE_SQL,
          unitId,
          cycleId,
        );
        if (failed.length !== 1) {
          throw new SnapshotCaptureError(
            "obsolete_cycle_not_failed",
            "obsolete source cut could not be finalized",
          );
        }
        await hooks.beforeStep?.("prune_source_cuts");
        await this.pruneRetiredSourceRows(tx, unitId);
        return {
          outcome: "obsolete" as const,
          cycleId,
          sourceCycleSequence: sequence,
        };
      }

      await hooks.beforeStep?.("verify_domains");
      for (const domain of SOURCE_CUT_DOMAINS) {
        const evidence = await tx.$queryRawUnsafe<EvidenceRow[]>(
          DOMAIN_EVIDENCE_SQL[domain],
          unitId,
          cycleId,
        );
        const proof = evidence[0];
        if (!proof || !proof.keyed_checksum) {
          throw new SnapshotCaptureError(
            "domain_evidence_missing",
            `source-cut evidence missing for ${domain}`,
          );
        }
        const claimedCount = {
          pelanggan_master: cycle.pelanggan_row_count,
          bppiut: cycle.bppiut_row_count,
          bphut: cycle.bphut_row_count,
        }[domain];
        const actualCount = BigInt(proof.row_count);
        if (claimedCount === null || actualCount !== BigInt(claimedCount)) {
          throw new SnapshotCaptureError(
            "domain_row_count_mismatch",
            `${domain}: staged ${actualCount} rows, expected ${claimedCount}`,
          );
        }
        const verified = await tx.$queryRawUnsafe<CycleRow[]>(
          COMPLETE_DOMAIN_SQL[domain],
          unitId,
          cycleId,
          actualCount,
          Buffer.from(proof.keyed_checksum),
        );
        if (verified.length !== 1) {
          throw new SnapshotCaptureError(
            "domain_completion_conflict",
            `source-cut proof changed for ${domain}`,
          );
        }
      }

      const refreshed = await tx.$queryRawUnsafe<Array<{
        previous_source_cycle_id: string | null;
      }>>(
        REFRESH_PREVIOUS_CYCLE_SQL,
        unitId,
        cycleId,
      );
      if (refreshed.length !== 1) {
        throw new SnapshotCaptureError(
          "source_cycle_refresh_failed",
          "ready source cut lost its finalization lock",
        );
      }
      const previousCycleId = refreshed[0]!.previous_source_cycle_id;

      await hooks.beforeStep?.("diff_changes");
      if (previousCycleId) {
        await tx.$executeRawUnsafe(
          DIFF_PELANGGAN_SQL,
          unitId,
          cycleId,
          previousCycleId,
        );
        await tx.$executeRawUnsafe(
          DIFF_LEDGER_SQL.bppiut,
          unitId,
          cycleId,
          previousCycleId,
        );
        await tx.$executeRawUnsafe(
          DIFF_LEDGER_SQL.bphut,
          unitId,
          cycleId,
          previousCycleId,
        );
      }

      await hooks.beforeStep?.("dirty_watermark");
      await tx.$executeRawUnsafe(
        UPSERT_DIRTY_WATERMARK_SQL,
        unitId,
        cycleId,
        sequence,
      );

      await hooks.beforeStep?.("mark_pointers");
      await tx.$executeRawUnsafe(MARK_STALE_POINTERS_SQL, unitId);

      await hooks.beforeStep?.("promote_cycle");
      const promoted = await tx.$queryRawUnsafe<ReturningCycleRow[]>(
        PROMOTE_SOURCE_CYCLE_SQL,
        unitId,
        cycleId,
      );
      if (promoted.length !== 1) {
        throw new SnapshotCaptureError(
          "source_cycle_promotion_failed",
          "complete source cut lost its atomic promotion race",
        );
      }

      await hooks.beforeStep?.("enqueue_work");
      await tx.$executeRawUnsafe(SUPERSEDE_PENDING_WORK_SQL, unitId);
      await tx.$executeRawUnsafe(
        ENQUEUE_STALE_POINTERS_SQL,
        unitId,
        cycleId,
        sequence,
      );

      await hooks.beforeStep?.("prune_source_cuts");
      await tx.$executeRawUnsafe(
        FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
        unitId,
        sequence,
      );
      await this.pruneRetiredSourceRows(tx, unitId);

      return {
        outcome: "complete" as const,
        cycleId,
        sourceCycleSequence: sequence,
      };
    }, { timeout: 120_000 });
  }

  /** Seed missing historical dates from the retained latest complete cut. */
  async enqueueBackfill(unitId: number, priorDays: number): Promise<void> {
    if (!Number.isInteger(priorDays) || priorDays < 0 || priorDays > SNAPSHOT_BACKFILL_LIMITS.maxDays) {
      throw new Error(`priorDays must be an integer from 0 to ${SNAPSHOT_BACKFILL_LIMITS.maxDays}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      await tx.$executeRawUnsafe(LOCK_SOURCE_CAPTURE_SQL, unitId);
      const cuts = await tx.$queryRawUnsafe<ReturningCycleRow[]>(READ_BACKFILL_SOURCE_CYCLE_SQL, unitId);
      const cut = cuts[0];
      if (!cut || cut.source_cycle_sequence === undefined) return;
      await tx.$executeRawUnsafe(SUPERSEDE_BACKFILL_WORK_SQL, unitId, cut.source_cycle_sequence);
      await tx.$executeRawUnsafe(ENQUEUE_BACKFILL_SQL, unitId, priorDays,
        cut.source_cycle_id, cut.source_cycle_sequence);
    }, { timeout: 120_000 });
  }

  /** Satu lintasan berbatas per tabel. Memulangkan jumlah baris yang terhapus. */
  private async pruneRetiredSourceRows(tx: Tx, unitId: number): Promise<number> {
    let deleted = 0;
    for (const sql of PRUNE_RETIRED_SOURCE_ROWS_SQL) {
      deleted += await tx.$executeRawUnsafe(sql, unitId, SNAPSHOT_RETIREMENT_LIMITS.batchRows);
    }
    return deleted;
  }

  private async readCycle(
    tx: Tx,
    unitId: number,
    cycleId: string,
    required?: true,
  ): Promise<CycleRow>;
  private async readCycle(
    tx: Tx,
    unitId: number,
    cycleId: string,
    required: false,
  ): Promise<CycleRow | undefined>;
  private async readCycle(
    tx: Tx,
    unitId: number,
    cycleId: string,
    required = true,
  ): Promise<CycleRow | undefined> {
    const rows = await tx.$queryRawUnsafe<CycleRow[]>(
      READ_SOURCE_CYCLE_SQL,
      unitId,
      cycleId,
    );
    const cycle = rows[0];
    if (!cycle && required) {
      throw new SnapshotCaptureError(
        "source_cycle_missing",
        "source-cut cycle could not be created",
      );
    }
    return cycle;
  }
}
