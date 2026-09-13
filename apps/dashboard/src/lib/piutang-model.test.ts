import { describe, expect, it } from "vitest";
import {
  buildPiutangExportView,
  buildPiutangView,
  groupPiutangRows,
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
      formulaVersion: "saldo-pelanggan-v1",
      computedAt: "2026-09-09T03:01:00Z",
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
      message: "Belum ada snapshot terpublikasi. Status pengiriman source cut dan pembangunan belum terlihat dari jalur baca ini. Angka saldo belum ditampilkan.",
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
      sections: [
        { id: "lokal", page: 1, pageSize: 50, totalPages: 1 },
        { id: "hutang", page: 1, pageSize: 50, totalPages: 1 },
        { id: "nol", page: 1, pageSize: 50, totalPages: 1 },
      ],
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
    const page2 = buildPiutangView(ready(rows), { sort: "kode", pages: { lokal: "2" } });
    expect(page2).toMatchObject({ status: "ready", resultCount: 51, totalCount: 51, sections: [{ id: "lokal", page: 2, pageSize: 50, totalPages: 2 }, { id: "hutang" }, { id: "nol" }] });
    if (page2.status !== "ready") throw new Error("expected ready");
    expect(page2.sections[0]!.rows.map((row) => row.customerCode)).toEqual(["51"]);

    expect(buildPiutangView(ready(rows), { pages: { lokal: "wat" } })).toMatchObject({ status: "ready", sections: [{ id: "lokal", page: 1 }, { id: "hutang" }, { id: "nol" }] });
    expect(buildPiutangView(ready(rows), { pages: { lokal: -7 } })).toMatchObject({ status: "ready", sections: [{ id: "lokal", page: 1 }, { id: "hutang" }, { id: "nol" }] });
    expect(buildPiutangView(ready(rows), { pages: { lokal: 99 } })).toMatchObject({ status: "ready", sections: [{ id: "lokal", page: 2 }, { id: "hutang" }, { id: "nol" }] });
    const exported = buildPiutangExportView(ready(rows), { sort: "kode" });
    expect(exported).toMatchObject({ status: "ready", resultCount: 51 });
    if (exported.status !== "ready") throw new Error("expected ready");
    expect(exported.rows).toHaveLength(51);
  });

  it("presence-gates Online only from snapshot metadata, not dotted row heuristics", () => {
    const dotted = zeroRow("21.999.0014", "Online");
    expect(buildPiutangView(ready([dotted], false), {})).toMatchObject({ status: "ready", hasOnlineCustomer: false });
    expect(buildPiutangView(ready([dotted], true), {})).toMatchObject({ status: "ready", hasOnlineCustomer: true });
  });
});


describe("section membership and pagination", () => {
  it("keeps opening-only and offsetting balances in each relevant book, with unchanged amounts", () => {
    const rows = [
      { ...zeroRow("A", "Awal"), awalPiutangLokal: 12.5 },
      { ...zeroRow("B", "Dua"), awalPiutangLokal: 5, akhirHutangLokal: -5 },
      { ...zeroRow("C", "Online"), akhirPiutangOnline: 9 },
      zeroRow("Z", "Nol"),
    ];
    const view = buildPiutangView(ready(rows, true), {});
    if (view.status !== "ready") throw new Error("expected ready");
    expect(view.sections.map((s) => [s.id, s.rows.map((r) => r.customerCode)])).toEqual([
      ["lokal", ["A", "B"]], ["online", ["C"]], ["hutang", ["B"]], ["nol", ["Z"]],
    ]);
    expect(view.resultCount).toBe(4);
    expect(view.occurrenceCount).toBe(5);
    expect(view.sections[0]!.rows[1]!.bookCount).toBe(2);
    for (const section of view.sections) for (const row of section.rows) {
      expect(row).toMatchObject(rows.find((r) => r.customerCode === row.customerCode)!);
    }
    expect(groupPiutangRows(view.rows, false).map((s) => s.id)).toEqual(["lokal", "hutang", "nol"]);
  });

  it("pages each section independently and exports every result in the same section order", () => {
    const rows = Array.from({ length: 51 }, (_, i) => [
      withSaldo(`L${i}`, `Pelanggan ${i}`),
      { ...zeroRow(`H${i}`, `Pelanggan ${i}`), awalHutangLokal: -1 },
      { ...zeroRow(`O${i}`, `Pelanggan ${i}`), akhirPiutangOnline: 1 },
      zeroRow(`Z${i}`, `Pelanggan ${i}`),
    ]).flat();
    const view = buildPiutangView(ready(rows, true), { sort: "kode", pages: { lokal: 2, online: 2, hutang: 1, nol: 2 } });
    const exported = buildPiutangExportView(ready(rows, true), { sort: "kode" });
    if (view.status !== "ready" || exported.status !== "ready") throw new Error("expected ready");
    expect(view.sections.map((s) => [s.id, s.page, s.rows.length, s.resultCount])).toEqual([
      ["lokal", 2, 1, 51], ["online", 2, 1, 51], ["hutang", 1, 50, 51], ["nol", 2, 1, 51],
    ]);
    expect(view.zeroSectionOpen).toBe(true);
    expect(exported.sections.map((s) => s.rows.length)).toEqual([51, 51, 51, 51]);
    for (const section of view.sections) {
      const all = exported.sections.find((s) => s.id === section.id)!;
      expect(section.rows).toEqual(all.rows.slice((section.page - 1) * 50, section.page * 50));
    }
  });

  it("keeps the zero section present and opens it for search or the zero filter", () => {
    for (const input of [{}, { search: "Nol" }, { filter: "nol" }, { filter: "bersaldo" }]) {
      const view = buildPiutangView(ready([zeroRow("Z", "Nol")]), input);
      if (view.status !== "ready") throw new Error("expected ready");
      expect(view.sections.at(-1)?.id).toBe("nol");
      expect(view.zeroSectionOpen).toBe(Boolean(input.search || input.filter === "nol"));
      expect(view.sections.at(-1)?.resultCount).toBe(input.filter === "bersaldo" ? 0 : 1);
    }
  });
});


it("sorts search results within books before zero rows, identically for screen and export", () => {
  const snapshot = ready([
    withSaldo("L2", "Cari Zulu"), withSaldo("L1", "Cari Alpha"),
    { ...zeroRow("H2", "Cari Zulu"), awalHutangLokal: -0.4 },
    { ...zeroRow("H1", "Cari Alpha"), akhirHutangLokal: -1 },
    zeroRow("Z1", "Cari Nol"), withSaldo("X", "Excluded"),
  ]);
  const screen = buildPiutangView(snapshot, { search: "cari", sort: "nama" });
  const exported = buildPiutangExportView(snapshot, { search: "cari", sort: "nama" });
  if (screen.status !== "ready" || exported.status !== "ready") throw new Error("expected ready");
  const codes = (sections: typeof exported.sections) => sections.map((s) => s.rows.map((r) => r.customerCode));
  expect(codes(screen.sections)).toEqual([["L1", "L2"], ["H1", "H2"], ["Z1"]]);
  expect(codes(screen.sections)).toEqual(codes(exported.sections));
});
