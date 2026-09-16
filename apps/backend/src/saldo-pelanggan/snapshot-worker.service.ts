import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service.js";
import {
  SNAPSHOT_BACKFILL_LIMITS,
  SNAPSHOT_OPERATIONAL_LIMITS,
  SNAPSHOT_RETIREMENT_LIMITS,
} from "./snapshot-config.js";
import { type RetirementSummary, SnapshotSourceCaptureService } from "./source-capture.service.js";

/** Hasil satu putaran pemensiunan lintas unit. */
export interface RetirementRun {
  units: Array<RetirementSummary & {
    unitId: number;
    error?: string;
    /** Sudah berapa lama unit ini mengirim cut sama sekali. */
    oldestCutHours?: number;
    /** Umur cut `complete` terbaru; null = TIDAK PERNAH ada yang selesai. */
    completeAgeHours?: number | null;
    /** Mengirim cut lama, tetapi tak satu pun pernah `complete` — kalah balapan. */
    staleCut?: boolean;
  }>;
  /** Unit yang belum sempat dilayani karena anggaran habis — dilaporkan, tidak didiamkan. */
  skipped: number[];
}
import {
  evaluateOperationalGate,
  SnapshotBuildError,
  SnapshotBuilderService,
} from "./snapshot-builder.service.js";
import { PUBLICATION_OPERATIONAL_GATE_SQL, SET_UNIT_SCOPE_SQL } from "./snapshot-sql.js";
import { COUNT_STAGING_BY_UNIT_SQL, CUT_AGE_BY_UNIT_SQL } from "./source-capture-sql.js";
import {
  FAIL_EXPIRED_MANIFEST_SQL,
  FAIL_ORPHAN_MANIFEST_SQL,
  HEARTBEAT_WORK_SQL,
  LEASE_WORK_SQL,
  REAP_EXPIRED_WORK_SQL,
  RETRY_WORK_SQL,
} from "./snapshot-worker-sql.js";

type SqlTransaction = Prisma.TransactionClient;

interface GateRow {
  wib_minutes: number;
  database_bytes: bigint | number | string;
}

interface LeasedWorkRow {
  unit_id: number;
  work_id: string;
  as_of_date: Date | string;
  source_cycle_id: string;
  source_cycle_sequence: bigint | number | string;
  rebuild_epoch: bigint | number | string;
  attempt_count: number;
}

interface WorkStateRow {
  work_id: string;
  state: "retry_wait" | "dead_letter";
}

interface ReturningWorkRow {
  work_id: string;
}

export type SnapshotWorkerResult =
  | { status: "skipped"; reason: string }
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; workId: string; generationId: string }
  | { status: "superseded"; workId: string }
  | { status: "retry_wait" | "dead_letter"; workId: string; error: string };

export interface SnapshotWorkerRunOptions {
  /** Absolute request deadline supplied by an HTTP/control-plane caller. */
  attemptDeadlineEpochMs?: number;
  /** Number of prior business dates, in addition to today. */
  backfillDays?: number;
}

export interface SnapshotWorkerBatchOptions extends SnapshotWorkerRunOptions {
  maxItems?: number;
}

export type SnapshotWorkerBatchResult = SnapshotWorkerResult & {
  processedCount: number;
  completedCount: number;
  supersededCount: number;
};

function dateText(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function errorText(error: unknown): string {
  if (error instanceof SnapshotBuildError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function isGlobalLeaseConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown };
  return record.code === "P2002" ||
    record.meta?.code === "23505" ||
    String(record.meta?.message ?? record.message ?? "").includes("sps_work_one_global_lease");
}

@Injectable()
export class SnapshotWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: SnapshotBuilderService,
    private readonly sourceCapture: SnapshotSourceCaptureService,
  ) {}

  private async scopedTransaction<T>(
    unitId: number,
    run: (tx: SqlTransaction) => Promise<T>,
  ): Promise<T> {
    const acquireStartedAt = Date.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
      if (Date.now() - acquireStartedAt > SNAPSHOT_OPERATIONAL_LIMITS.poolAcquireMilliseconds) {
        throw new SnapshotBuildError("pool_acquire_timeout", "database connection took more than one second", true);
      }
      return run(tx);
    });
  }

  /**
   * Pemensiunan SAJA — tanpa gerbang, tanpa lease, tanpa membangun.
   *
   * Ada karena laju penangkapan (±1 cut/jam, mengikuti masterIntervalMs) jauh
   * melampaui laju pemensiunan (1×/hari, terikat pada cron build 02:05).
   * Terukur 14-09-2026: 22 cut staging menumpuk dalam ±27 jam, 3,38 GB/hari,
   * dan gerbang 9 GB menutup — yang MEMBEKUKAN seluruh publikasi snapshot.
   *
   * Dipisahkan dari `runBatch` dengan sengaja: memanggil `runBatch` tiap jam
   * memang ikut memensiunkan, tetapi ia memulangkan 425 di luar jendela build,
   * sehingga job Scheduler-nya tercatat GAGAL 20-an kali sehari. Alarm yang
   * selalu menyala berhenti dibaca orang — dan itu persis kelas kegagalan yang
   * membuat insiden ini tidak terlihat berhari-hari.
   */
  /**
   * Pemensiunan untuk SELURUH unit aktif — bukan satu unit.
   *
   * ⚠️ INI AKAR INSIDEN KAPASITAS 14-09-2026, dan alasan bentuk ini dipilih.
   * Pemensiunan bersifat PER UNIT. Hanya unit 1 yang punya penjadwal, sehingga
   * unit 4 menumpuk **32 cut staging = 30,3 juta baris** tanpa satu pun
   * pemensiunan — sementara tiap pengukuran kami, yang di-scope ke unit 1,
   * tampak bersih.
   *
   * KENAPA SATU ENDPOINT YANG MENGITERASI, BUKAN SATU JOB PER UNIT.
   * Kegagalan yang baru terjadi PERSIS berbentuk "ada unit yang tidak punya
   * job". Satu job per unit memberi isolasi kegagalan yang lebih baik, tetapi
   * ia membuat CAKUPAN bergantung pada seseorang mengingat menambah job setiap
   * kali unit baru di-onboard — ketergantungan yang sudah terbukti gagal, dan
   * yang akan diuji lagi pada setiap unit berikutnya. Dengan mengiterasi unit
   * aktif, cakupan menjadi **sifat sistem**, bukan sifat ingatan.
   *
   * Harga yang dibayar, dan penawarnya:
   *  · tak ada isolasi antar-unit → kegagalan satu unit DITANGKAP dan iterasi
   *    lanjut; unit yang gagal dilaporkan, tidak menghentikan sisanya;
   *  · satu unit lambat dapat menghabiskan anggaran → urutannya **backlog
   *    terbanyak lebih dulu**, sehingga unit terburuk selalu terlayani walau
   *    anggaran habis, dan unit yang belum sempat dilaporkan eksplisit.
   */
  async retireAllUnits(): Promise<RetirementRun> {
    const units = await this.prisma.unit.findMany({
      where: { active: true },
      select: { unitId: true },
    });
    const active = new Set(units.map((u) => u.unitId));
    if (active.size === 0) return { units: [], skipped: [] };

    // Urutan: backlog terbanyak lebih dulu. Hitungan ini butuh scope SELURUH
    // unit — di-scope sempit ia memulangkan nol tanpa galat, dan nol itu
    // persis yang menyembunyikan unit 4 selama ini.
    const scope = [...active].sort((a, b) => a - b).join(",");
    const backlog = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(SET_UNIT_SCOPE_SQL, scope);
      return tx.$queryRawUnsafe<Array<{ unit_id: number; staging_count: bigint }>>(
        COUNT_STAGING_BY_UNIT_SQL,
      );
    }, { timeout: SNAPSHOT_RETIREMENT_LIMITS.batchMilliseconds });

    const ordered = [
      ...backlog.map((row) => row.unit_id).filter((unitId) => active.has(unitId)),
      ...[...active].sort((a, b) => a - b),
    ].filter((unitId, index, all) => all.indexOf(unitId) === index);

    // Umur cut per unit — inilah yang membuat "punya job tetapi selalu idle"
    // terlihat. Diambil sekali untuk seluruh unit, bukan per unit.
    const umur = new Map<number, { oldest: number; complete: number | null }>();
    for (const row of await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(SET_UNIT_SCOPE_SQL, scope);
      return tx.$queryRawUnsafe<Array<{
        unit_id: number; oldest_cut_hours: number; complete_age_hours: number | null;
      }>>(CUT_AGE_BY_UNIT_SQL);
    }, { timeout: SNAPSHOT_RETIREMENT_LIMITS.batchMilliseconds })) {
      umur.set(row.unit_id, {
        oldest: Number(row.oldest_cut_hours),
        complete: row.complete_age_hours === null ? null : Number(row.complete_age_hours),
      });
    }

    const deadline = Date.now() + SNAPSHOT_RETIREMENT_LIMITS.allUnitsMilliseconds;
    const done: RetirementRun["units"] = [];
    const skipped: number[] = [];
    for (const unitId of ordered) {
      if (Date.now() >= deadline) { skipped.push(unitId); continue; }
      const u = umur.get(unitId);
      // Kalah balapan cut-vs-build: sudah lama mengirim cut, tetapi tak satu pun
      // pernah mencapai `complete`. Unit seperti ini memulangkan `idle` — sah,
      // tenang, dan tak terlihat sampai seseorang membuka psql.
      const staleCut = !!u
        && u.oldest > SNAPSHOT_RETIREMENT_LIMITS.staleCompleteCutHours
        && (u.complete === null || u.complete > SNAPSHOT_RETIREMENT_LIMITS.staleCompleteCutHours);
      const umurFields = u
        ? { oldestCutHours: u.oldest, completeAgeHours: u.complete, staleCut }
        : {};
      try {
        done.push({ unitId, ...(await this.retireOnly(unitId)), ...umurFields });
      } catch (error) {
        done.push({
          unitId, stagingBefore: 0, stagingAfter: 0, rowsDeleted: 0,
          error: errorText(error), ...umurFields,
        });
      }
    }
    return { units: done, skipped };
  }

  async retireOnly(unitId: number): Promise<RetirementSummary> {
    if (!Number.isInteger(unitId) || unitId < -32_768 || unitId > 32_767) {
      throw new Error("unitId must be a SMALLINT");
    }
    await this.reap(unitId);
    return this.sourceCapture.collectRetiredSources(unitId);
  }

  private async reap(unitId: number): Promise<void> {
    await this.scopedTransaction(unitId, async (tx) => {
      await tx.$queryRawUnsafe(FAIL_EXPIRED_MANIFEST_SQL, unitId);
      await tx.$queryRawUnsafe(REAP_EXPIRED_WORK_SQL, unitId);
      await tx.$queryRawUnsafe(FAIL_ORPHAN_MANIFEST_SQL, unitId);
    });
  }

  private async lease(
    unitId: number,
    leaseOwner: string,
    requestDeadline?: number,
  ): Promise<LeasedWorkRow | undefined | null> {
    try {
      return await this.scopedTransaction(unitId, async (tx) => {
        const rows = await tx.$queryRawUnsafe<LeasedWorkRow[]>(
          LEASE_WORK_SQL,
          unitId,
          leaseOwner,
          requestDeadline ?? null,
        );
        return rows[0];
      });
    } catch (error) {
      if (isGlobalLeaseConflict(error)) return null;
      throw error;
    }
  }

  private async heartbeat(work: LeasedWorkRow, leaseOwner: string): Promise<void> {
    await this.scopedTransaction(work.unit_id, async (tx) => {
      const rows = await tx.$queryRawUnsafe<ReturningWorkRow[]>(
        HEARTBEAT_WORK_SQL,
        work.unit_id,
        work.work_id,
        leaseOwner,
      );
      if (rows.length !== 1) {
        throw new SnapshotBuildError("lease_lost", "heartbeat no longer owns the build lease", true);
      }
    });
  }

  private async retry(
    work: LeasedWorkRow,
    leaseOwner: string,
    error: unknown,
  ): Promise<WorkStateRow | undefined> {
    return this.scopedTransaction(work.unit_id, async (tx) => {
      const rows = await tx.$queryRawUnsafe<WorkStateRow[]>(
        RETRY_WORK_SQL,
        work.unit_id,
        work.work_id,
        leaseOwner,
        errorText(error),
        !(error instanceof SnapshotBuildError) || error.retryable,
      );
      return rows[0];
    });
  }

  /**
   * One invocation leases and executes at most one item for one explicit unit.
   * Database uniqueness on `state='leased'` is the cross-instance global-1 net.
   */
  async runOnce(
    unitId: number,
    leaseOwner: string,
    options: SnapshotWorkerRunOptions = {},
  ): Promise<SnapshotWorkerResult> {
    return this.runItem(unitId, leaseOwner, options, true);
  }

  /** Sequential requests keep the same database global-one lease constraint. */
  async runBatch(
    unitId: number,
    leaseOwner: string,
    options: SnapshotWorkerBatchOptions = {},
  ): Promise<SnapshotWorkerBatchResult> {
    const maxItems = options.maxItems ?? SNAPSHOT_BACKFILL_LIMITS.defaultItems;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > SNAPSHOT_BACKFILL_LIMITS.maxItems) {
      throw new Error(`maxItems must be an integer from 1 to ${SNAPSHOT_BACKFILL_LIMITS.maxItems}`);
    }
    const deadline = Math.min(
      Date.now() + SNAPSHOT_BACKFILL_LIMITS.requestMilliseconds,
      options.attemptDeadlineEpochMs ?? Number.POSITIVE_INFINITY,
    );
    let processedCount = 0;
    let completedCount = 0;
    let supersededCount = 0;
    let last: SnapshotWorkerResult = { status: "idle" };
    for (let index = 0; index < maxItems; index += 1) {
      const result = await this.runItem(unitId, leaseOwner, {
        ...options,
        attemptDeadlineEpochMs: deadline,
      }, index === 0);
      if ("workId" in result) processedCount += 1;
      if (result.status === "done") completedCount += 1;
      if (result.status === "superseded") supersededCount += 1;
      // An empty queue following success does not erase completed work. Other
      // terminal outcomes retain their status, including partial failures.
      if (result.status === "idle" && processedCount > 0) break;
      last = result;
      if (result.status !== "done" && result.status !== "superseded") break;
    }
    return { ...last, processedCount, completedCount, supersededCount };
  }

  private async runItem(
    unitId: number,
    leaseOwner: string,
    options: SnapshotWorkerRunOptions,
    prepareSource: boolean,
  ): Promise<SnapshotWorkerResult> {
    if (!Number.isInteger(unitId) || unitId < -32_768 || unitId > 32_767) {
      throw new Error("unitId must be a SMALLINT");
    }
    if (!leaseOwner.trim()) throw new Error("leaseOwner must not be blank");

    const backfillDays = options.backfillDays ?? SNAPSHOT_BACKFILL_LIMITS.defaultDays;
    if (!Number.isInteger(backfillDays) || backfillDays < 0 || backfillDays > SNAPSHOT_BACKFILL_LIMITS.maxDays) {
      throw new Error(`backfillDays must be an integer from 0 to ${SNAPSHOT_BACKFILL_LIMITS.maxDays}`);
    }
    if (options.attemptDeadlineEpochMs !== undefined && !Number.isFinite(options.attemptDeadlineEpochMs)) {
      throw new Error("attemptDeadlineEpochMs must be finite");
    }
    const deadlineExpired = () => Date.now() >= (options.attemptDeadlineEpochMs ?? Number.POSITIVE_INFINITY);
    if (deadlineExpired()) return { status: "skipped", reason: "request_deadline_exhausted" };

    await this.reap(unitId);

    // Runs BEFORE the gate on purpose. Retiring staging cuts is what keeps the
    // database under `databaseReviewBytes`; gating it on that same limit made
    // the collector unreachable exactly when it was needed. Failure here is
    // never fatal — the invocation proceeds and the next one retries.
    try {
      await this.sourceCapture.collectRetiredSources(unitId);
    } catch (error) {
      process.stderr.write(`snapshot source retirement warning: ${errorText(error)}\n`);
    }

    const gateRows = await this.prisma.$queryRawUnsafe<GateRow[]>(PUBLICATION_OPERATIONAL_GATE_SQL);
    const gateRow = gateRows[0];
    if (!gateRow) return { status: "skipped", reason: "operational_gate_unavailable" };
    const gate = evaluateOperationalGate(
      gateRow.wib_minutes,
      Number(gateRow.database_bytes),
      true,
    );
    if (!gate.ok) return { status: "skipped", reason: gate.reason };

    if (deadlineExpired()) return { status: "skipped", reason: "request_deadline_exhausted" };
    if (prepareSource) {
      // Finalization is durable and retryable. Backfill also runs against an
      // existing complete cut when no new source domain arrived this request.
      try {
        await this.sourceCapture.finalizeReady(unitId);
      } catch (error) {
        process.stderr.write(`snapshot source finalization warning: ${errorText(error)}\n`);
      }
      if (deadlineExpired()) return { status: "skipped", reason: "request_deadline_exhausted" };
      await this.sourceCapture.enqueueBackfill(unitId, backfillDays);
    }
    if (deadlineExpired()) return { status: "skipped", reason: "request_deadline_exhausted" };

    const work = await this.lease(unitId, leaseOwner, options.attemptDeadlineEpochMs);
    if (work === null) return { status: "busy" };
    if (!work) {
      if (deadlineExpired()) return { status: "skipped", reason: "request_deadline_exhausted" };
      // SQL rechecks time/disk after connection acquisition. Surface a gate
      // that closed during finalization rather than reporting an empty queue.
      const rows = await this.prisma.$queryRawUnsafe<GateRow[]>(PUBLICATION_OPERATIONAL_GATE_SQL);
      if (!rows[0]) return { status: "skipped", reason: "operational_gate_unavailable" };
      const afterLease = evaluateOperationalGate(rows[0].wib_minutes, Number(rows[0].database_bytes), true);
      if (!afterLease.ok) return { status: "skipped", reason: afterLease.reason };
      return { status: "idle" };
    }

    let heartbeatFailure: unknown;
    let heartbeatRunning = false;
    const timer = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.heartbeat(work, leaseOwner)
        .catch((error) => { heartbeatFailure = error; })
        .finally(() => { heartbeatRunning = false; });
    }, SNAPSHOT_OPERATIONAL_LIMITS.heartbeatSeconds * 1_000);
    timer.unref();

    try {
      const built = await this.builder.build(
        {
          unitId: work.unit_id,
          asOfDate: dateText(work.as_of_date),
          sourceCycleId: work.source_cycle_id,
          sourceCycleSequence: BigInt(work.source_cycle_sequence),
          rebuildEpoch: BigInt(work.rebuild_epoch),
          workId: work.work_id,
          leaseOwner,
        },
        {
          attemptDeadlineEpochMs: Math.min(
            Date.now() + SNAPSHOT_OPERATIONAL_LIMITS.attemptSeconds * 1_000,
            options.attemptDeadlineEpochMs ?? Number.POSITIVE_INFINITY,
          ),
        },
      );
      if (heartbeatFailure) {
        // Publication can only have committed if COMPLETE_WORK still owned the
        // lease; retain success but make the control-plane failure visible.
        process.stderr.write(`snapshot heartbeat warning: ${errorText(heartbeatFailure)}\n`);
      }
      if (built.outcome === "superseded") {
        return { status: "superseded", workId: work.work_id };
      }
      return {
        status: "done",
        workId: work.work_id,
        generationId: built.target.generationId,
      };
    } catch (error) {
      const state = await this.retry(work, leaseOwner, error);
      if (!state) {
        return {
          status: "dead_letter",
          workId: work.work_id,
          error: `lease lost while handling: ${errorText(error)}`,
        };
      }
      return {
        status: state.state,
        workId: work.work_id,
        error: errorText(error),
      };
    } finally {
      clearInterval(timer);
    }
  }
}
