import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  LOCK_SOURCE_CAPTURE_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  READ_LATEST_SOURCE_SEQUENCE_SQL,
} from "./source-capture-sql.js";
import { SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";
import { SnapshotSourceCaptureService } from "./source-capture.service.js";

/**
 * Mode kegagalan yang diuji di sini SENYAP DAN TOTAL.
 *
 * Bentuk lama menghapus seluruh sisa dalam SATU pernyataan tak berbatas, di
 * dalam satu transaksi ber-budget 120 detik. Sekali budget terlewat, seluruh
 * transaksi di-rollback — nol kemajuan — dan pemanggilnya (`snapshot-worker
 * .service.ts`) hanya menulis satu baris peringatan ke stderr lalu jalan terus.
 * Tumpukannya lalu membesar, sehingga percobaan berikutnya lebih pasti gagal.
 *
 * Produksi 12-13 September 2026 mengukur invokasi 114.521 ms dan 99.784 ms
 * terhadap budget 120.000 ms — 95% dan 83%, keduanya masih commit. Tebingnya
 * tidak terlihat sampai dilewati, jadi uji inilah yang harus melihatnya.
 */

type Stub = {
  prisma: PrismaService;
  transactions: number;
  pruneCalls: Array<{ sql: string; params: unknown[] }>;
  markCalls: string[];
};

function stub(options: {
  latestSequence?: bigint | null;
  /** Baris terhapus per pemanggilan prune, berurutan; sisanya 0. */
  deletions?: number[];
  throwOnPruneCall?: number;
} = {}): Stub {
  const { latestSequence = 7n, deletions = [], throwOnPruneCall } = options;
  const pruneCalls: Array<{ sql: string; params: unknown[] }> = [];
  const markCalls: string[] = [];
  let transactions = 0;
  const prunes = new Set<string>(PRUNE_RETIRED_SOURCE_ROWS_SQL);

  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (prunes.has(sql)) {
        pruneCalls.push({ sql, params });
        if (throwOnPruneCall !== undefined && pruneCalls.length === throwOnPruneCall) {
          throw new Error("injected:batch-failure");
        }
        return deletions[pruneCalls.length - 1] ?? 0;
      }
      if (sql === FAIL_SUPERSEDED_STAGING_CYCLES_SQL || sql === LOCK_SOURCE_CAPTURE_SQL) {
        markCalls.push(sql);
      }
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql === READ_LATEST_SOURCE_SEQUENCE_SQL) {
        return latestSequence === null ? [] : [{ source_cycle_sequence: latestSequence }];
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
    pruneCalls,
    markCalls,
  } as Stub;
}

function service(prisma: PrismaService): SnapshotSourceCaptureService {
  return new SnapshotSourceCaptureService(prisma);
}

describe("pemensiunan source cut — berbatas dan bertahap", () => {
  it("setiap pernyataan prune MEMBAWA batas barisnya", () => {
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL).toHaveLength(3);
    for (const sql of PRUNE_RETIRED_SOURCE_ROWS_SQL) {
      // Kalau batas ini hilang, prune kembali jadi satu pernyataan tak
      // berbatas dan tebing 120 detik itu kembali — tanpa gejala apa pun.
      expect(sql).toContain("LIMIT $2::int");
      expect(sql).toContain("ctid");
    }
    // Predikat pemensiunannya tidak boleh ikut hilang saat dibuat berbatas.
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL.join("\n"))
      .toContain("w.state IN ('queued', 'leased', 'retry_wait')");
  });

  it("meneruskan batas barisnya sebagai parameter, bukan hanya menuliskannya", async () => {
    const s = stub({ deletions: [] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls.length).toBeGreaterThan(0);
    for (const call of s.pruneCalls) {
      expect(call.params[1]).toBe(SNAPSHOT_RETIREMENT_LIMITS.batchRows);
    }
  });

  it("menandai lebih dulu di transaksi TERPISAH, baru menguras", async () => {
    const s = stub({ deletions: [] });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.markCalls).toContain(FAIL_SUPERSEDED_STAGING_CYCLES_SQL);
    // 1 transaksi penandaan + 1 transaksi per tabel (tiga tabel, batch pertama
    // sudah tidak penuh). Penandaan tidak boleh berbagi transaksi dengan
    // pengurasan: kalau berbagi, pengurasan yang gagal ikut membatalkannya.
    expect(s.transactions).toBe(4);
  });

  it("terus menguras selama batch-nya PENUH, lalu berhenti", async () => {
    const full = SNAPSHOT_RETIREMENT_LIMITS.batchRows;
    // Tabel pertama butuh tiga lintasan; dua penuh, yang ketiga tidak.
    const s = stub({ deletions: [full, full, 5] });
    await service(s.prisma).collectRetiredSources(1);
    const first = PRUNE_RETIRED_SOURCE_ROWS_SQL[0]!;
    expect(s.pruneCalls.filter(c => c.sql === first)).toHaveLength(3);
    // Dua tabel sisanya masing-masing satu lintasan (langsung tidak penuh).
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
    // Inti perbaikannya: dua batch pertama berjalan di TRANSAKSI SENDIRI yang
    // sudah selesai sebelum yang ketiga gagal. Bentuk lama memakai satu
    // transaksi untuk semuanya, jadi kegagalan yang sama menghapus seluruh
    // kemajuan dan meninggalkan database persis seperti semula.
    expect(s.pruneCalls).toHaveLength(3);
    expect(s.transactions).toBe(4);
  });

  it("tidak menguras apa pun bila unit belum punya source cycle", async () => {
    const s = stub({ latestSequence: null });
    await service(s.prisma).collectRetiredSources(1);
    expect(s.pruneCalls).toHaveLength(0);
    expect(s.transactions).toBe(1);
  });
});
