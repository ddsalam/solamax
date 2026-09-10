import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

const { qScoped } = vi.hoisted(() => ({ qScoped: vi.fn() }));
vi.mock("./db", () => ({ qScoped }));

const { getSaldoPelanggan, getSaldoSnapshot } = await import("./queries");
const { READ_SALDO_SNAPSHOT_POINTER_SQL, READ_SALDO_SNAPSHOT_ROWS_SQL } = await import("./saldo-snapshot");
const U = 7 as unknown as ScopedUnitId;
const DATE = "2026-08-04";
const pointer = {
  generationId: "8d15c6cf-3e80-4db8-8104-8ea8b556be96", rowCount: 2,
  sourceCycleId: "6af6b4f3-25db-4c5f-9675-08c67ed0d2df", sourceCompletedAt: "2026-08-04T00:00:00Z",
  pendingReplacement: true, staleInvalidFrom: "2026-08-01",
  awalPiutangLokal: 10, akhirPiutangLokal: 20, awalPiutangOnline: 3,
  akhirPiutangOnline: 4, awalHutangLokal: -2, akhirHutangLokal: -5,
};
const rows = [
  { customerCode: "P1", customerName: "Zero", awalPiutangLokal: 0, akhirPiutangLokal: 0, awalPiutangOnline: 0, akhirPiutangOnline: 0, awalHutangLokal: 0, akhirHutangLokal: 0 },
  { customerCode: "21.999.0014", customerName: null, awalPiutangLokal: 10, akhirPiutangLokal: 20, awalPiutangOnline: 3, akhirPiutangOnline: 4, awalHutangLokal: -2, akhirHutangLokal: -5 },
];
const verifiedRows = [{ integrityVerified: true, customerCode: null }, ...rows];

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
      status: "ready", metadata: { sourceCycleId: pointer.sourceCycleId, pendingReplacement: true, staleInvalidFrom: "2026-08-01", totals: { awal: { piutangLokal: 10, piutangOnline: 3, hutangLokal: -2 }, akhir: { piutangLokal: 20, piutangOnline: 4, hutangLokal: -5 } } },
    });
  });

  it("reports no published pointer without numeric fields", async () => {
    qScoped.mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({ status: "not_ready", asOfDate: DATE, reason: "no_published_snapshot" });
  });

  it("rejects an incomplete immutable generation", async () => {
    qScoped.mockResolvedValueOnce([pointer]).mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({ status: "not_ready", asOfDate: DATE, reason: "incomplete_snapshot" });
  });

  it("accepts a published zero-customer generation", async () => {
    qScoped.mockResolvedValueOnce([{ ...pointer, rowCount: 0 }]).mockResolvedValueOnce([{ integrityVerified: true, customerCode: null }]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toMatchObject({ status: "ready", rows: [], hasOnlineCustomer: false });
  });

  it("rejects a zero-customer generation when its checksum proof is absent", async () => {
    qScoped.mockResolvedValueOnce([{ ...pointer, rowCount: 0 }]).mockResolvedValueOnce([]);
    await expect(getSaldoSnapshot(U, DATE)).resolves.toEqual({ status: "not_ready", asOfDate: DATE, reason: "incomplete_snapshot" });
  });

  it("keeps the legacy totals wrapper nullable rather than fabricating zero", async () => {
    qScoped.mockResolvedValueOnce([]);
    await expect(getSaldoPelanggan(U, DATE)).resolves.toBeNull();
  });

  it("never scans direct ledgers and joins the master only as a label", () => {
    const sql = `${READ_SALDO_SNAPSHOT_POINTER_SQL}\n${READ_SALDO_SNAPSHOT_ROWS_SQL}`;
    expect(sql).not.toMatch(/public\.(bppiut|bphut)/);
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("FROM verified");
    expect(READ_SALDO_SNAPSHOT_ROWS_SQL).toContain("GROUP BY btrim(ckdplg)");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.status = 'complete'");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.published");
    expect(READ_SALDO_SNAPSHOT_POINTER_SQL).toContain("m.validation_passed");
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
