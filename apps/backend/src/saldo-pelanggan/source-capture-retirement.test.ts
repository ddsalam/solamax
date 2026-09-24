import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  LOCK_SOURCE_CAPTURE_SQL,
  MARK_CYCLE_DRAINED_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  READ_DOOMED_CYCLES_SQL,
  READ_LATEST_SOURCE_SEQUENCE_SQL,
} from "./source-capture-sql.js";
import { SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";
import { SnapshotSourceCaptureService } from "./source-capture.service.js";

/**
 * Dua mode kegagalan diuji di sini, keduanya SENYAP.
 *
 * (1) Bentuk paling lama menghapus seluruh sisa dalam SATU pernyataan tak
 *     berbatas di dalam satu transaksi ber-budget. Sekali budget terlewat,
 *     seluruhnya di-rollback — nol kemajuan — dan pemanggilnya hanya menulis
 *     satu baris peringatan ke stderr. Produksi 12-13 Sep 2026 mengukur 114.521
 *     ms dan 99.784 ms terhadap 120.000 ms; tebingnya tak terlihat sampai
 *     dilewati. Batching menutup itu.
 *
 * (2) Bentuk berbatas itu TETAP bertanya kepada tabel BARIS, dengan predikat
 *     kelayakan yang hidup di tabel CUT. Perencana memilih Seq Scan atas tabel
 *     3,1 GB, dan pemindaian itu berjalan SAMPAI HABIS justru ketika tak ada
 *     yang cocok. Produksi 24-09-2026, unit 7: NOL baris dihapus, 36 detik
 *     terpakai, lalu gagal pada timeout transaksi 30 detik — 11 kali sehari,
 *     naik dari 1 kali seminggu sebelumnya. Bertanya kepada tabel CUT lebih
 *     dulu menutup itu; uji di bawah menjaga keduanya sekaligus.
 */

const CUT_A = "00000000-0000-4000-8000-00000000000a";
const CUT_B = "00000000-0000-4000-8000-00000000000b";

type Stub = {
  prisma: PrismaService;
  transactions: number;
  pruneCalls: Array<{ sql: string; params: unknown[] }>;
  markCalls: string[];
  drainedMarks: unknown[][];
};

function stub(options: {
  latestSequence?: bigint | null;
  /** Cut yang masih perlu dikuras, menurut READ_DOOMED_CYCLES_SQL. */
  doomed?: string[];
  /** Baris terhapus per pemanggilan prune, berurutan; sisanya 0. */
  deletions?: number[];
  throwOnPruneCall?: number;
  /** Dipanggil sesudah tiap prune — dipakai menggeser jam palsu. */
  afterPrune?: (callIndex: number) => void;
} = {}): Stub {
  const {
    latestSequence = 7n, doomed = [CUT_A], deletions = [], throwOnPruneCall, afterPrune,
  } = options;
  const pruneCalls: Array<{ sql: string; params: unknown[] }> = [];
  const markCalls: string[] = [];
  const drainedMarks: unknown[][] = [];
  let transactions = 0;
  const prunes = new Set<string>(PRUNE_RETIRED_SOURCE_ROWS_SQL);

  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (prunes.has(sql)) {
        pruneCalls.push({ sql, params });
        if (throwOnPruneCall !== undefined && pruneCalls.length === throwOnPruneCall) {
          throw new Error("injected:batch-failure");
        }
        afterPrune?.(pruneCalls.length);
        return deletions[pruneCalls.length - 1] ?? 0;
      }
      if (sql === FAIL_SUPERSEDED_STAGING_CYCLES_SQL || sql === LOCK_SOURCE_CAPTURE_SQL) {
        markCalls.push(sql);
      }
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql === READ_LATEST_SOURCE_SEQUENCE_SQL) {
        return latestSequence === null ? [] : [{ source_cycle_sequence: latestSequence }];
      }
      if (sql === READ_DOOMED_CYCLES_SQL) {
        return doomed.map((source_cycle_id) => ({ source_cycle_id }));
      }
      if (sql === MARK_CYCLE_DRAINED_SQL) {
        drainedMarks.push(params);
        return [{ source_cycle_id: params[1] }];
      }
      return [];
    }),
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return fn(tx);
    },
  } as unknown as PrismaService;
  return {
    prisma,
    get transactions() { return transactions; },
    pruneCalls, markCalls, drainedMarks,
  } as Stub;
}

function service(prisma: PrismaService): SnapshotSourceCaptureService {
  return new SnapshotSourceCaptureService(prisma);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("pemensiunan source cut — berbatas, bertahap, dan per-cut", () => {
  it("setiap pernyataan prune MEMBAWA batas barisnya DAN menembak satu cut", () => {
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL).toHaveLength(3);
    for (const sql of PRUNE_RETIRED_SOURCE_ROWS_SQL) {
      // Kalau batas ini hilang, prune kembali jadi satu pernyataan tak berbatas
      // dan tebing 120 detik itu kembali — tanpa gejala apa pun.
      expect(sql).toContain("LIMIT $3::int");
      expect(sql).toContain("ctid");
      // Kalau ini hilang, ia kembali memindai seluruh tabel per unit.
      expect(sql).toContain("s.source_cycle_id = $2::uuid");
    }
    // Predikat pemensiunannya tidak boleh ikut hilang saat dibuat per-cut:
    // kelayakan tetap dinilai ulang tiap batch, hanya tempatnya yang pindah.
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL.join("\n"))
      .toContain("w.state IN ('queued', 'leased', 'retry_wait')");
    expect(READ_DOOMED_CYCLES_SQL).toContain("rows_pruned_at IS NULL");
  });

  it("meneruskan cut dan batas barisnya sebagai parameter, bukan hanya menuliskannya", async () => {
    const s = stub({ deletions: [] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls.length).toBeGreaterThan(0);
    for (const call of s.pruneCalls) {
      expect(call.params[1]).toBe(CUT_A);
      expect(call.params[2]).toBe(SNAPSHOT_RETIREMENT_LIMITS.batchRows);
    }
  });

  it("menandai lebih dulu di transaksi TERPISAH, baru menguras", async () => {
    const s = stub({ deletions: [] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.markCalls).toContain(FAIL_SUPERSEDED_STAGING_CYCLES_SQL);
    // 1 penandaan + 1 baca daftar cut + 3 prune + 1 tanda-kosong. Penandaan
    // tidak boleh berbagi transaksi dengan pengurasan: kalau berbagi,
    // pengurasan yang gagal ikut membatalkannya.
    expect(s.transactions).toBe(6);
  });

  it("terus menguras selama batch-nya PENUH, lalu berhenti", async () => {
    const full = SNAPSHOT_RETIREMENT_LIMITS.batchRows;
    // Tabel pertama butuh tiga lintasan; dua penuh, yang ketiga tidak.
    const s = stub({ deletions: [full, full, 5] });
    await service(s.prisma).collectRetiredSources(1);
    const first = PRUNE_RETIRED_SOURCE_ROWS_SQL[0]!;
    expect(s.pruneCalls.filter((c) => c.sql === first)).toHaveLength(3);
    expect(s.pruneCalls).toHaveLength(5);
  });

  it("berhenti pada batch pertama yang tidak penuh — tanpa lintasan kosong tambahan", async () => {
    const s = stub({ deletions: [0, 0, 0] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(3);
  });

  it("KEMAJUAN BATCH SEBELUMNYA TERSIMPAN ketika batch berikutnya gagal", async () => {
    const full = SNAPSHOT_RETIREMENT_LIMITS.batchRows;
    const s = stub({ deletions: [full, full], throwOnPruneCall: 3 });
    await expect(service(s.prisma).collectRetiredSources(1)).rejects.toThrow("injected:batch-failure");
    // Dua batch pertama berjalan di TRANSAKSI SENDIRI yang sudah selesai sebelum
    // yang ketiga gagal. Bentuk lama memakai satu transaksi untuk semuanya.
    expect(s.pruneCalls).toHaveLength(3);
    // 1 penandaan + 1 baca daftar + 3 prune (yang ketiga gagal).
    expect(s.transactions).toBe(5);
    // Dan cut yang belum tuntas TIDAK ditandai kosong.
    expect(s.drainedMarks).toHaveLength(0);
  });

  it("tidak menguras apa pun bila unit belum punya source cycle", async () => {
    const s = stub({ latestSequence: null });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(0);
    expect(s.transactions).toBe(1);
  });

  // 🔴 INI SELURUH POINNYA. Tanpa ini, perbaikan bisa diurungkan tanpa merah.
  it("cut yang SUDAH kosong tidak diperiksa lagi — nol pernyataan atas tabel besar", async () => {
    const s = stub({ doomed: [] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(0);
    // 1 penandaan + 1 baca daftar. Tidak ada yang menyentuh tabel baris.
    expect(s.transactions).toBe(2);
    const summary = await service(stub({ doomed: [] }).prisma).collectRetiredSources(1);
    expect(summary.cyclesConsidered).toBe(0);
    expect(summary.cyclesDrained).toBe(0);
  });

  it("beberapa cut dikuras berurutan, masing-masing ditandai kosong sendiri", async () => {
    const s = stub({ doomed: [CUT_A, CUT_B], deletions: [] });
    const summary = await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(6); // 3 tabel x 2 cut
    expect(s.drainedMarks.map((p) => p[1])).toEqual([CUT_A, CUT_B]);
    expect(summary.cyclesConsidered).toBe(2);
    expect(summary.cyclesDrained).toBe(2);
  });

  // 🔴 Tanda "sudah kosong" yang terpasang pada cut yang masih berisi akan
  // membuat barisnya tak pernah terhapus, diam-diam dan selamanya.
  it("budget habis di TENGAH cut ⇒ cut itu TIDAK ditandai kosong", async () => {
    const mulai = 1_000_000;
    let sekarang = mulai;
    vi.spyOn(Date, "now").mockImplementation(() => sekarang);
    const s = stub({
      doomed: [CUT_A, CUT_B],
      deletions: [],
      // Lewati budget tepat sesudah tabel pertama cut pertama.
      afterPrune: (n) => {
        if (n === 1) sekarang = mulai + SNAPSHOT_RETIREMENT_LIMITS.budgetMilliseconds + 1;
      },
    });
    const summary = await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(1);
    expect(s.drainedMarks).toHaveLength(0);
    expect(summary.cyclesDrained).toBe(0);
    // Cut berikutnya juga tidak disentuh — budgetnya memang sudah habis.
    expect(summary.cyclesConsidered).toBe(2);
  });

  it("syarat 'benar-benar kosong' ditegakkan SQL-nya sendiri, bukan kode pemanggil", () => {
    // Kalau syarat ini pindah ke TypeScript, ia bisa dilewati oleh jalur lain.
    for (const t of ["source_pelanggan", "source_bppiut", "source_bphut"]) {
      expect(MARK_CYCLE_DRAINED_SQL).toContain(`saldo_pelanggan_${t}`);
    }
    expect(MARK_CYCLE_DRAINED_SQL).toContain("NOT EXISTS");
    expect(MARK_CYCLE_DRAINED_SQL).toContain("rows_pruned_at IS NULL");
  });
});
