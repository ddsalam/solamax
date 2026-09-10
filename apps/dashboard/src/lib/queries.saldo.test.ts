import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

const { qScoped } = vi.hoisted(() => ({ qScoped: vi.fn() }));
vi.mock("./db", () => ({ qScoped }));

const {
  getSaldoPelanggan,
  getSaldoSnapshot,
  readSaldoPelangganLegacy,
  READ_SALDO_PELANGGAN_LEGACY_SQL,
} = await import("./queries");
const {
  READ_SALDO_SNAPSHOT_POINTER_SQL,
  READ_SALDO_SNAPSHOT_READINESS_SQL,
  READ_SALDO_SNAPSHOT_ROWS_SQL,
} = await import("./saldo-snapshot");
const U = 7 as unknown as ScopedUnitId;
const DATE = "2026-08-04";
const pointer = {
  generationId: "8d15c6cf-3e80-4db8-8104-8ea8b556be96", rowCount: 2,
  formulaVersion: "saldo-pelanggan-v1", computedAt: "2026-08-04T00:01:00Z",
  sourceCycleId: "6af6b4f3-25db-4c5f-9675-08c67ed0d2df", sourceCompletedAt: "2026-08-04T00:00:00Z",
  pendingReplacement: false, staleInvalidFrom: null,
  awalPiutangLokal: 10, akhirPiutangLokal: 20, awalPiutangOnline: 3,
  akhirPiutangOnline: 4, awalHutangLokal: -2, akhirHutangLokal: -5,
};
const replacementPointer = {
  ...pointer,
  generationId: "c6383ed1-34ce-4732-912d-6d35943c5be7",
  computedAt: "2026-08-04T00:02:00Z",
};
const rows = [
  { customerCode: "P1", customerName: "Zero", awalPiutangLokal: 0, akhirPiutangLokal: 0, awalPiutangOnline: 0, akhirPiutangOnline: 0, awalHutangLokal: 0, akhirHutangLokal: 0 },
  { customerCode: "21.999.0014", customerName: null, awalPiutangLokal: 10, akhirPiutangLokal: 20, awalPiutangOnline: 3, akhirPiutangOnline: 4, awalHutangLokal: -2, akhirHutangLokal: -5 },
];
const verifiedRows = [{ integrityVerified: true, customerCode: null }, ...rows];
const legacyRow = {
  awalPiutangLokal: 10,
  akhirPiutangLokal: 20,
  awalPiutangOnline: 3,
  akhirPiutangOnline: 4,
  awalHutangLokal: -2,
  akhirHutangLokal: -5,
};
const totals = {
  awal: { piutangLokal: 10, piutangOnline: 3, hutangLokal: -2 },
  akhir: { piutangLokal: 20, piutangOnline: 4, hutangLokal: -5 },
};

describe("snapshot-only saldo reader", () => {
  beforeEach(() => qScoped.mockReset());

  it("uses a pointer-first, exact-generation snapshot path", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce(verifiedRows);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({ status: "ready", asOfDate: DATE, hasOnlineCustomer: true, rows });
    expect(qScoped).toHaveBeenNthCalledWith(1, U, READ_SALDO_SNAPSHOT_POINTER_SQL, [U, DATE]);
    expect(qScoped).toHaveBeenNthCalledWith(2, U, READ_SALDO_SNAPSHOT_ROWS_SQL, [U, DATE, pointer.generationId]);
  });

  it("keeps a zero-balance customer and exposes provenance plus both totals", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce(verifiedRows);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({
      status: "ready", metadata: { sourceCycleId: pointer.sourceCycleId, formulaVersion: pointer.formulaVersion, computedAt: pointer.computedAt, pendingReplacement: false, staleInvalidFrom: null, totals: { awal: { piutangLokal: 10, piutangOnline: 3, hutangLokal: -2 }, akhir: { piutangLokal: 20, piutangOnline: 4, hutangLokal: -5 } } },
    });
  });

  it("keeps the active generation while exposing a failed replacement attempt", async () => {
    const active = { ...pointer, pendingReplacement: true, staleInvalidFrom: "2026-08-01" };
    const latestAttempt = { status: "failed", attemptedAt: "2026-08-04T00:05:00Z", failureSummary: "checksum berbeda" };
    qScoped.mockResolvedValueOnce([active]).mockResolvedValueOnce(verifiedRows).mockResolvedValueOnce([latestAttempt]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({
      status: "ready",
      metadata: { pendingReplacement: true },
      latestAttempt,
    });
    expect(qScoped).toHaveBeenNthCalledWith(3, U, READ_SALDO_SNAPSHOT_READINESS_SQL, [U, DATE]);
  });

  it("reports no published pointer without numeric fields", async () => {
    qScoped.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "no_published_snapshot",
    });
    expect(qScoped).toHaveBeenNthCalledWith(2, U, READ_SALDO_SNAPSHOT_READINESS_SQL, [U, DATE]);
  });

  it("reports a latest building manifest without numeric fields", async () => {
    const latestAttempt = { status: "building", attemptedAt: "2026-08-04T02:00:00Z", failureSummary: null };
    qScoped.mockResolvedValueOnce([]).mockResolvedValueOnce([latestAttempt]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "building_snapshot", latestAttempt,
    });
  });

  it("reports a latest failed manifest with useful failure metadata", async () => {
    const latestAttempt = { status: "failed", attemptedAt: "2026-08-04T02:05:00Z", failureSummary: "checksum berbeda" };
    qScoped.mockResolvedValueOnce([]).mockResolvedValueOnce([latestAttempt]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "failed_snapshot", latestAttempt,
    });
  });

  it("reports a complete manifest without a pointer as an incomplete publication", async () => {
    const latestAttempt = { status: "complete", attemptedAt: "2026-08-04T02:05:00Z", failureSummary: null };
    qScoped.mockResolvedValueOnce([]).mockResolvedValueOnce([latestAttempt]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "incomplete_snapshot", latestAttempt,
    });
  });

  it("rejects an incomplete immutable generation", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "incomplete_snapshot",
    });
  });

  it("follows one changed pointer after a generation retirement race", async () => {
    qScoped
      .mockResolvedValueOnce([pointer])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([replacementPointer])
      .mockResolvedValueOnce(verifiedRows);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({
      status: "ready",
      metadata: { generationId: replacementPointer.generationId },
      rows,
    });
    expect(qScoped).toHaveBeenNthCalledWith(3, U, READ_SALDO_SNAPSHOT_POINTER_SQL, [U, DATE]);
    expect(qScoped).toHaveBeenNthCalledWith(
      4, U, READ_SALDO_SNAPSHOT_ROWS_SQL, [U, DATE, replacementPointer.generationId],
    );
  });

  it("accepts a published zero-customer generation", async () => {
    qScoped.mockResolvedValueOnce([{ ...pointer, rowCount: 0 }]).mockResolvedValueOnce([{ integrityVerified: true, customerCode: null }]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({ status: "ready", rows: [], hasOnlineCustomer: false });
  });

  it("rejects a zero-customer generation when its checksum proof is absent", async () => {
    qScoped
      .mockResolvedValueOnce([{ ...pointer, rowCount: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({
      status: "not_ready", asOfDate: DATE, reason: "incomplete_snapshot",
    });
  });

  it("keeps the existing aggregate surface alive through the legacy ledger when no snapshot exists", async () => {
    qScoped
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([legacyRow]);
    await expect(getSaldoPelanggan(U, DATE)).resolves.toEqual(totals);
    expect(qScoped).toHaveBeenNthCalledWith(3, U, READ_SALDO_PELANGGAN_LEGACY_SQL, [U, DATE]);
  });

  it("falls back when a published pointer cannot yield a complete immutable generation", async () => {
    qScoped
      .mockResolvedValueOnce([pointer])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([legacyRow]);
    await expect(getSaldoPelanggan(U, DATE)).resolves.toEqual(totals);
    expect(qScoped).toHaveBeenNthCalledWith(4, U, READ_SALDO_PELANGGAN_LEGACY_SQL, [U, DATE]);
  });

  it("uses a complete snapshot without touching the legacy ledgers", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce(verifiedRows);
    await expect(getSaldoPelanggan(U, DATE)).resolves.toEqual(totals);
    expect(qScoped).toHaveBeenCalledTimes(2);
  });

  it("keeps snapshot totals byte-equivalent to the legacy aggregate on the same fixture", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce(verifiedRows);
    const fromSnapshot = await getSaldoPelanggan(U, DATE);
    qScoped.mockReset().mockResolvedValueOnce([legacyRow]);
    const fromLegacy = await readSaldoPelangganLegacy(U, DATE);
    expect(fromSnapshot).toEqual(fromLegacy);
  });

  it("never scans direct ledgers and joins the master only as a label", () => {
    const sql = `${READ_SALDO_SNAPSHOT_POINTER_SQL}\n${READ_SALDO_SNAPSHOT_ROWS_SQL}`;
    expect(sql).not.toMatch(/public\.(bppiut|bphut)/);
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("FROM verified");
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("GROUP BY btrim(ckdplg)");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.status = 'complete'");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.published");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.validation_passed");
    expect(READ_SALDO_SNAPSHOT_READINESS_SQL).toContain("FROM app.saldo_pelanggan_snapshot_manifest");
    expect(READ_SALDO_SNAPSHOT_READINESS_SQL).toContain("failure_summary");
    expect(READ_SALDO_SNAPSHOT_READINESS_SQL).not.toMatch(/public\.(bppiut|bphut)/);
    // Six numeric fields are cast for rows; the integrity sentinel supplies six typed NULLs.
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL.match(/::float8/g)).toHaveLength(12);
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("sha256(convert_to(COALESCE(string_agg(");
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("c.row_keyed_checksum = a.row_keyed_checksum");
    for (const total of [
      "awal_piutang_lokal_total", "akhir_piutang_lokal_total",
      "awal_piutang_online_total", "akhir_piutang_online_total",
      "awal_hutang_lokal_total", "akhir_hutang_lokal_total",
    ]) {
      expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain(`c.${total} = a.${total}`);
    }
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("snapshot_rows AS MATERIALIZED");
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL.match(/FROM app\.saldo_pelanggan_snapshot_row/g)).toHaveLength(1);
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("LEFT JOIN snapshot_rows r");
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain('ORDER BY "integrityVerified" DESC, "customerCode"');
  });
});

describe("legacy aggregate transition query", () => {
  const sql = READ_SALDO_PELANGGAN_LEGACY_SQL.replace(/\s+/g, " ");

  it("uses end-of-day <= in both ledgers and exactly three start-of-day < cuts", () => {
    expect(sql).toContain("b.dtgl <= $2::date");
    expect(sql).toContain("h.dtgl <= $2::date");
    expect(sql).not.toMatch(/b\.dtgl <(?!=)/);
    expect(sql).not.toMatch(/h\.dtgl <(?!=)/);
    expect(sql.match(/(?<!\.)dtgl < \$2::date/g)).toHaveLength(3);
  });

  it("keeps local and online as separate code-format buckets", () => {
    expect(sql.match(/WHERE lokal AND NOT dotted/g)).toHaveLength(2);
    expect(sql.match(/sjenis IN \(1,5\)/g)).toHaveLength(1);
    expect(sql).toContain("(m.ckdplg IS NOT NULL) AS lokal");
    expect(sql.match(/WHERE dotted(?! AND sjenis)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/sjenis\s*=\s*3/);
    expect(sql).toContain("position('.' in trim(b.ckdplg)) > 0");
  });

  it("preserves debit-credit signs and negative liability presentation", () => {
    expect(sql).toContain("CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END");
    expect(sql).toContain("CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END");
    expect(sql.match(/\(-COALESCE\(\(SELECT sum\(v\) FROM hut/g)).toHaveLength(2);
  });

  it("scans each scoped non-cancelled ledger once and keeps online rows independent of master", () => {
    expect(sql.match(/FROM public\.bppiut/g)).toHaveLength(1);
    expect(sql.match(/FROM public\.bphut/g)).toHaveLength(1);
    expect(sql).toContain("b.unit_id = $1 AND COALESCE(b.sbatal,0) = 0");
    expect(sql).toContain("h.unit_id = $1 AND COALESCE(h.sbatal,0) = 0");
    expect(sql).toMatch(/LEFT JOIN \(SELECT unit_id, ckdplg FROM public\.pelanggan_master/);
    expect(sql).not.toContain("INNER JOIN");
  });

  it("returns explicit six-zero totals when the aggregate query yields no row", async () => {
    qScoped.mockReset().mockResolvedValueOnce([]);
    await expect(readSaldoPelangganLegacy(U, DATE)).resolves.toEqual({
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
      akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
    });
  });
});
