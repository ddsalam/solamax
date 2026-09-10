import { describe, expect, it } from "vitest";
import {
  buildPiutangView,
  type PiutangFilter,
  type PiutangSort,
} from "./piutang-model";
import type { SaldoSnapshot, SaldoSnapshotRow } from "./saldo-snapshot";

const zeroRow = (code: string, name: string | null): SaldoSnapshotRow => ({
  customerCode: code,
  customerName: name,
  awalPiutangLokal: 0,
  akhirPiutangLokal: 0,
  awalPiutangOnline: 0,
  akhirPiutangOnline: 0,
  awalHutangLokal: 0,
  akhirHutangLokal: 0,
});

const withSaldo = (code: string, name: string | null, amount = 1): SaldoSnapshotRow => ({
  ...zeroRow(code, name),
  akhirPiutangLokal: amount,
});

function ready(
  rows: SaldoSnapshotRow[],
  hasOnlineCustomer = false,
): Extract<SaldoSnapshot, { status: "ready" }> {
  return {
    status: "ready",
    asOfDate: "2026-09-09",
    metadata: {
      generationId: "generation-1",
      rowCount: rows.length,
      sourceCycleId: "cycle-1",
      sourceCompletedAt: "2026-09-09T03:00:00Z",
      pendingReplacement: false,
      staleInvalidFrom: null,
      totals: {
        awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
        akhir: { piutangLokal: 1, piutangOnline: 0, hutangLokal: 0 },
      },
    },
    rows,
    hasOnlineCustomer,
  };
}

describe("buildPiutangView", () => {
  it("returns useful no-cut copy and no numeric rows", () => {
    const result = buildPiutangView(
      { status: "not_ready", asOfDate: "2026-09-09", reason: "no_published_snapshot", latestAttempt: null },
      {},
    );

    expect(result).toEqual({
      status: "not_ready",
      asOfDate: "2026-09-09",
      reason: "no_published_snapshot",
      title: "Data saldo belum siap",
      message: "Unit ini masih menunggu pembaruan agent untuk mengirim source cut lengkap. Angka saldo belum ditampilkan.",
      attemptedAt: null,
      failureSummary: null,
    });
    expect(result).not.toHaveProperty("rows");
  });

  it.each([
    {
      reason: "building_snapshot" as const,
      latestAttempt: { status: "building" as const, attemptedAt: "2026-09-09T03:00:00Z", failureSummary: null },
      title: "Data saldo sedang disiapkan",
      message: "Source cut sudah diterima dan snapshot sedang dibangun. Angka saldo belum ditampilkan.",
    },
    {
      reason: "failed_snapshot" as const,
      latestAttempt: { status: "failed" as const, attemptedAt: "2026-09-09T03:05:00Z", failureSummary: "checksum berbeda" },
      title: "Data saldo belum siap",
      message: "Pembuatan snapshot terakhir gagal. Laporkan unit, tanggal, dan waktu upaya terakhir kepada pengelola. Angka saldo belum ditampilkan.",
    },
    {
      reason: "incomplete_snapshot" as const,
      latestAttempt: null,
      title: "Data saldo belum siap",
      message: "Snapshot yang dipublikasikan tidak lolos pemeriksaan keutuhan. Laporkan unit dan tanggal kepada pengelola. Angka saldo belum ditampilkan.",
    },
  ])("maps $reason without manufacturing numeric rows", ({ reason, latestAttempt, title, message }) => {
    const result = buildPiutangView(
      { status: "not_ready", asOfDate: "2026-09-09", reason, latestAttempt },
      {},
    );
    expect(result).toMatchObject({ status: "not_ready", reason, title, message });
    expect(result).not.toHaveProperty("rows");
  });

  it("keeps a valid zero-customer snapshot ready", () => {
    expect(buildPiutangView(ready([]), {})).toMatchObject({
      status: "ready",
      rows: [],
      resultCount: 0,
      totalCount: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
  });

  it("defaults to all customers, puts nonzero first, and badges zero rows", () => {
    const result = buildPiutangView(ready([
      zeroRow(" Z-2 ", "Aster"),
      withSaldo("B-2", "Beta", 7),
      withSaldo("A-1", "Alpha", -2),
      zeroRow("Z-1", "Zulu"),
    ]), {});
    expect(result).toMatchObject({ status: "ready", filter: "semua", sort: "default", search: "" });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.rows.map((row) => row.customerCode)).toEqual(["A-1", "B-2", "Z-2", "Z-1"]);
    expect(result.rows.map((row) => row.isZeroBalance)).toEqual([false, false, true, true]);
  });

  it("searches trimmed code/name case-insensitively and still finds zero rows", () => {
    const result = buildPiutangView(ready([
      withSaldo("P-1", "Bersaldo"),
      zeroRow("  Nol-7  ", "Pelanggan Sunyi"),
    ]), { search: "  nOL-7 " });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.search).toBe("nOL-7");
    expect(result.rows).toMatchObject([{ customerCode: "Nol-7", isZeroBalance: true }]);

    const byName = buildPiutangView(ready([zeroRow("N-1", "  Pelanggan Sunyi ")]), { search: "SUNYI" });
    expect(byName).toMatchObject({ status: "ready", resultCount: 1 });
  });

  it.each<[PiutangFilter, string[]]>([
    ["semua", ["A", "Z"]],
    ["bersaldo", ["A"]],
    ["nol", ["Z"]],
  ])("applies the %s filter without netting buckets", (filter, codes) => {
    const offsetting = { ...zeroRow("A", "Aktif"), akhirPiutangLokal: 5, akhirHutangLokal: -5 };
    const result = buildPiutangView(ready([offsetting, zeroRow("Z", "Zero")]), { filter });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.rows.map((row) => row.customerCode)).toEqual(codes);
  });

  it.each<[PiutangSort, string[]]>([
    ["nama", ["C-2", "C-1", "C-3"]],
    ["kode", ["C-1", "C-2", "C-3"]],
  ])("supports %s ordering only", (sort, codes) => {
    const result = buildPiutangView(ready([
      withSaldo("C-3", "Zulu"),
      zeroRow("C-1", "Zulu"),
      zeroRow("C-2", "Alpha"),
    ]), { sort });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.rows.map((row) => row.customerCode)).toEqual(codes);
  });

  it("paginates 51 rows at 50 and clamps malformed or excessive pages", () => {
    const rows = Array.from({ length: 51 }, (_, index) => withSaldo(String(index + 1).padStart(2, "0"), `Nama ${index + 1}`));
    const page2 = buildPiutangView(ready(rows), { sort: "kode", page: "2" });
    expect(page2).toMatchObject({ status: "ready", resultCount: 51, totalCount: 51, page: 2, pageSize: 50, totalPages: 2 });
    if (page2.status !== "ready") throw new Error("expected ready");
    expect(page2.rows.map((row) => row.customerCode)).toEqual(["51"]);

    expect(buildPiutangView(ready(rows), { page: "wat" })).toMatchObject({ status: "ready", page: 1 });
    expect(buildPiutangView(ready(rows), { page: -7 })).toMatchObject({ status: "ready", page: 1 });
    expect(buildPiutangView(ready(rows), { page: 99 })).toMatchObject({ status: "ready", page: 2 });
  });

  it("presence-gates Online only from snapshot metadata, not dotted row heuristics", () => {
    const dotted = zeroRow("21.999.0014", "Online");
    expect(buildPiutangView(ready([dotted], false), {})).toMatchObject({ status: "ready", hasOnlineCustomer: false });
    expect(buildPiutangView(ready([dotted], true), {})).toMatchObject({ status: "ready", hasOnlineCustomer: true });
  });
});
