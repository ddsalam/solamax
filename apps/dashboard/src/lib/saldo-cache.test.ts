import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaldoSnapshotPointer, SaldoSnapshotRow } from "./saldo-snapshot";
import type { ScopedUnitId } from "./scope-rule";

const { pointerRead, generationRead, legacyRead, cacheHits, cacheRegistrations } = vi.hoisted(() => ({
  pointerRead: vi.fn(),
  generationRead: vi.fn(),
  legacyRead: vi.fn(),
  cacheHits: [] as unknown[],
  cacheRegistrations: [] as Array<{ key: string[]; revalidate: number }>,
}));

vi.mock("./db", () => ({ qScoped: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(
    load: () => Promise<T>,
    key: string[],
    options: { revalidate: number },
  ) => {
    cacheRegistrations.push({ key, revalidate: options.revalidate });
    return cacheHits.length > 0
      ? () => Promise.resolve(cacheHits.shift() as T)
      : load;
  },
}));

vi.mock("./saldo-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./saldo-snapshot")>()),
  getSaldoSnapshotPointer: pointerRead,
  getSaldoSnapshotGeneration: generationRead,
}));

vi.mock("./queries", () => ({ readSaldoPelangganLegacy: legacyRead }));

import {
  SALDO_HIST_REVALIDATE_S,
  SALDO_LIVE_REVALIDATE_S,
  getSaldoPelangganCached,
  getSaldoSnapshotCached,
  resolveSaldoGeneration,
  saldoRevalidateSeconds,
  shouldBypassCachedGeneration,
} from "./saldo-cache";

const U = 7 as unknown as ScopedUnitId;
const DATE = "2026-08-03";

function pointer(generationId: string, n = 10): SaldoSnapshotPointer {
  return {
    generationId,
    rowCount: 1,
    formulaVersion: "saldo-pelanggan-v1",
    computedAt: "2026-08-03T02:01:00Z",
    sourceCycleId: "cycle-1",
    sourceCompletedAt: "2026-08-03T02:00:00Z",
    pendingReplacement: false,
    staleInvalidFrom: null,
    awalPiutangLokal: n,
    akhirPiutangLokal: n + 1,
    awalPiutangOnline: n + 2,
    akhirPiutangOnline: n + 3,
    awalHutangLokal: -(n + 4),
    akhirHutangLokal: -(n + 5),
  };
}

function zeroPointer(generationId: string): SaldoSnapshotPointer {
  return {
    ...pointer(generationId),
    awalPiutangLokal: 0,
    akhirPiutangLokal: 0,
    awalPiutangOnline: 0,
    akhirPiutangOnline: 0,
    awalHutangLokal: 0,
    akhirHutangLokal: 0,
  };
}

function row(values: Partial<SaldoSnapshotRow> = {}): SaldoSnapshotRow {
  return {
    customerCode: "P1",
    customerName: "Pelanggan",
    awalPiutangLokal: 0,
    akhirPiutangLokal: 0,
    awalPiutangOnline: 0,
    akhirPiutangOnline: 0,
    awalHutangLokal: 0,
    akhirHutangLokal: 0,
    ...values,
  };
}

const ready = (rows: SaldoSnapshotRow[]) => ({
  status: "ready" as const,
  rows,
  hasOnlineCustomer: rows.some((r) => r.customerCode.includes(".")),
});
const notReady = { status: "not_ready" as const, reason: "incomplete_snapshot" as const };

beforeEach(() => {
  pointerRead.mockReset();
  generationRead.mockReset();
  legacyRead.mockReset();
  cacheHits.length = 0;
  cacheRegistrations.length = 0;
});

describe("cakupan cache saldo snapshot", () => {
  const today = "2026-08-05";

  it("memakai tepat 86400 detik untuk <= H-2 dan 120 detik untuk H-1/H", () => {
    expect(saldoRevalidateSeconds("2026-08-03", today)).toBe(86_400);
    expect(saldoRevalidateSeconds("2012-07-31", today)).toBe(SALDO_HIST_REVALIDATE_S);
    expect(saldoRevalidateSeconds("2026-08-04", today)).toBe(120);
    expect(saldoRevalidateSeconds(today, today)).toBe(SALDO_LIVE_REVALIDATE_S);
    expect(saldoRevalidateSeconds("2026-08-09", today)).toBe(SALDO_LIVE_REVALIDATE_S);
  });

  it("melewati cache not-ready, kosong, dan baris all-six-zero", () => {
    expect(shouldBypassCachedGeneration(notReady)).toBe(true);
    expect(shouldBypassCachedGeneration(ready([]))).toBe(true);
    expect(shouldBypassCachedGeneration(ready([row()]))).toBe(true);
  });

  it.each([
    "awalPiutangLokal",
    "akhirPiutangLokal",
    "awalPiutangOnline",
    "akhirPiutangOnline",
    "awalHutangLokal",
    "akhirHutangLokal",
  ] as const)("mempercayai cache bila hanya %s yang nonzero", (field) => {
    expect(shouldBypassCachedGeneration(ready([row({ [field]: 1 })]))).toBe(false);
  });

  it("memakai cache hit nonzero tanpa read segar", async () => {
    const fresh = vi.fn(() => Promise.resolve(ready([row({ awalPiutangLokal: 2 })])));
    const hit = ready([row({ awalPiutangLokal: 1 })]);
    await expect(resolveSaldoGeneration(() => Promise.resolve(hit), fresh)).resolves.toBe(hit);
    expect(fresh).not.toHaveBeenCalled();
  });

  it.each([notReady, ready([]), ready([row()])])(
    "membaca segar untuk cache hit tak tepercaya %#",
    async (hit) => {
      const freshResult = ready([row()]);
      const fresh = vi.fn(() => Promise.resolve(freshResult));
      await expect(resolveSaldoGeneration(() => Promise.resolve(hit), fresh)).resolves.toBe(freshResult);
      expect(fresh).toHaveBeenCalledOnce();
    },
  );

  it("memakai hasil producer cold-miss tanpa menjalankan query identik dua kali", async () => {
    const hit = ready([row()]);
    const fresh = vi.fn(() => Promise.resolve(hit));
    await expect(
      resolveSaldoGeneration(() => Promise.resolve(hit), fresh, () => true),
    ).resolves.toBe(hit);
    expect(fresh).not.toHaveBeenCalled();
  });
});

describe("getSaldoSnapshotCached", () => {
  it("membaca pointer segar, meng-cache exact generation, dan mengembalikan rowset + metadata", async () => {
    const p = pointer("gen-a");
    const rows = [row({ customerCode: "21.1", akhirPiutangOnline: 7 })];
    pointerRead.mockResolvedValue(p);
    generationRead.mockResolvedValue(ready(rows));

    const got = await getSaldoSnapshotCached(U, DATE, "2026-08-05");

    expect(got).toEqual({
      status: "ready",
      asOfDate: DATE,
      metadata: {
        generationId: "gen-a",
        rowCount: 1,
        formulaVersion: "saldo-pelanggan-v1",
        computedAt: "2026-08-03T02:01:00Z",
        sourceCycleId: "cycle-1",
        sourceCompletedAt: "2026-08-03T02:00:00Z",
        pendingReplacement: false,
        staleInvalidFrom: null,
        totals: {
          awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
          akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
        },
      },
      rows,
      hasOnlineCustomer: true,
    });
    expect(pointerRead).toHaveBeenCalledOnce();
    expect(generationRead).toHaveBeenCalledWith(U, DATE, p);
    expect(cacheRegistrations).toEqual([{
      key: ["saldo-pelanggan-snapshot", "7", DATE, "gen-a"],
      revalidate: 86_400,
    }]);
  });

  it("mengembalikan no_published_snapshot tanpa membuat cache ketika pointer belum ada", async () => {
    pointerRead.mockResolvedValue(null);
    await expect(getSaldoSnapshotCached(U, DATE, "2026-08-05")).resolves.toEqual({
      status: "not_ready",
      asOfDate: DATE,
      reason: "no_published_snapshot",
    });
    expect(generationRead).not.toHaveBeenCalled();
    expect(cacheRegistrations).toEqual([]);
  });

  it.each([notReady, ready([])])("mengabaikan cache hit tak siap/kosong %#", async (hit) => {
    const p = pointer("gen-a");
    pointerRead.mockResolvedValue(p);
    cacheHits.push(hit);
    generationRead.mockResolvedValueOnce(ready([row({ akhirPiutangLokal: 9 })]));

    await expect(getSaldoSnapshotCached(U, DATE, "2026-08-05")).resolves.toMatchObject({ status: "ready" });
    expect(generationRead).toHaveBeenCalledOnce();
  });

  it("menerima hasil segar all-six-zero sesudah validasi", async () => {
    const p = zeroPointer("gen-zero");
    pointerRead.mockResolvedValue(p);
    generationRead.mockResolvedValueOnce(ready([row()]));

    const got = await getSaldoSnapshotCached(U, DATE, "2026-08-05");

    expect(got).toMatchObject({
      status: "ready",
      metadata: {
        totals: {
          awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
          akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
        },
      },
      rows: [row()],
    });
    expect(generationRead).toHaveBeenCalledOnce();
  });

  it("refetch pointer sekali dan memakai generasi baru bila exact generation hilang", async () => {
    const oldPointer = pointer("gen-old");
    const newPointer = pointer("gen-new", 20);
    pointerRead.mockResolvedValueOnce(oldPointer).mockResolvedValueOnce(newPointer);
    cacheHits.push(notReady);
    generationRead
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(ready([row({ akhirPiutangLokal: 21 })]));

    const got = await getSaldoSnapshotCached(U, DATE, "2026-08-05");

    expect(got).toMatchObject({ status: "ready", metadata: { generationId: "gen-new" } });
    expect(pointerRead).toHaveBeenCalledTimes(2);
    expect(cacheRegistrations.map((r) => r.key.at(-1))).toEqual(["gen-old", "gen-new"]);
  });

  it("berhenti not_ready bila pointer kedua masih menunjuk generasi yang sama", async () => {
    const p = pointer("gen-a");
    pointerRead.mockResolvedValue(p);
    cacheHits.push(notReady);
    generationRead.mockResolvedValue(notReady);

    await expect(getSaldoSnapshotCached(U, DATE, "2026-08-05")).resolves.toEqual({
      status: "not_ready",
      asOfDate: DATE,
      reason: "incomplete_snapshot",
    });
    expect(pointerRead).toHaveBeenCalledTimes(2);
    expect(generationRead).toHaveBeenCalledOnce();
  });
});

describe("getSaldoPelangganCached kompatibilitas", () => {
  it("mendelegasikan snapshot siap ke totals", async () => {
    const p = pointer("gen-a");
    pointerRead.mockResolvedValue(p);
    generationRead.mockResolvedValue(ready([row({ akhirPiutangLokal: 1 })]));

    await expect(getSaldoPelangganCached(U, DATE, "2026-08-05")).resolves.toEqual({
      awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("jatuh ke agregat ledger lama ketika pointer snapshot belum ada", async () => {
    pointerRead.mockResolvedValue(null);
    legacyRead.mockResolvedValue({
      awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });
    await expect(getSaldoPelangganCached(U, DATE, "2026-08-05")).resolves.toEqual({
      awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });
    expect(legacyRead).toHaveBeenCalledWith(U, DATE);
    expect(cacheRegistrations).toEqual([{
      key: ["saldo-pelanggan-legacy", "7", DATE],
      revalidate: 86_400,
    }]);
  });

  it("memakai cache agregat lama nonzero tanpa scan ledger ulang", async () => {
    pointerRead.mockResolvedValue(null);
    cacheHits.push({
      awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });

    await expect(getSaldoPelangganCached(U, DATE, "2026-08-05")).resolves.toMatchObject({
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("mengabaikan cache agregat lama all-zero dan membaca ledger segar", async () => {
    pointerRead.mockResolvedValue(null);
    cacheHits.push({
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
      akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
    });
    legacyRead.mockResolvedValue({
      awal: { piutangLokal: 10, piutangOnline: 12, hutangLokal: -14 },
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });

    await expect(getSaldoPelangganCached(U, DATE, "2026-08-05")).resolves.toMatchObject({
      akhir: { piutangLokal: 11, piutangOnline: 13, hutangLokal: -15 },
    });
    expect(legacyRead).toHaveBeenCalledOnce();
  });

  it("menerima cold-miss all-zero tanpa menjalankan scan ledger dua kali", async () => {
    pointerRead.mockResolvedValue(null);
    legacyRead.mockResolvedValue({
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
      akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
    });

    await expect(getSaldoPelangganCached(U, DATE, "2026-08-05")).resolves.toEqual({
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
      akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
    });
    expect(legacyRead).toHaveBeenCalledOnce();
  });
});
