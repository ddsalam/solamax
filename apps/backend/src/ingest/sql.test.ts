import { describe, expect, it } from "vitest";
import { buildUpsert } from "./sql.js";
import { TABLE_CONFIG } from "./table-config.js";

describe("buildUpsert", () => {
  it("membangun multi-row upsert dengan parameter terurut", () => {
    const { sql, params } = buildUpsert(TABLE_CONFIG.cash_detail!, 1, [
      { ckdkb: "K1", ckdperk: "5101", njumlah: 50000 },
      { ckdkb: "K1", ckdperk: "5102", njumlah: 7000 },
    ]);
    expect(sql).toContain(
      'INSERT INTO "cash_detail" ("unit_id","ckdkb","ckdperk","njumlah")',
    );
    expect(sql).toContain("VALUES ($1,$2,$3,$4),($5,$6,$7,$8)");
    expect(sql).toContain('ON CONFLICT ("unit_id","ckdkb","ckdperk")');
    expect(sql).toContain('"njumlah" = EXCLUDED."njumlah"');
    expect(sql).toContain('"ingested_at" = now()');
    // ckdkb/ckdperk = bagian conflict → TIDAK di-update
    expect(sql).not.toContain('"ckdkb" = EXCLUDED');
    expect(params).toEqual([1, "K1", "5101", 50000, 1, "K1", "5102", 7000]);
  });

  it("nilai hilang → null; objek (jsonb) → string JSON + cast ::jsonb", () => {
    const { sql, params } = buildUpsert(TABLE_CONFIG.product!, 2, [
      { ckdbbm: "P1", perk_map: { CKDPERK1: "x" } }, // vcnmbbm & nhrgjual absen
    ]);
    expect(params).toEqual([2, "P1", null, null, '{"CKDPERK1":"x"}']);
    expect(sql).toContain("$5::jsonb");
  });

  it("kolom date/timestamptz diberi cast eksplisit (Postgres tak coerce text)", () => {
    const sales = buildUpsert(TABLE_CONFIG.sales_header!, 1, [
      { ckdjualbbm: "H1", dtgljual: "2026-06-11", nshift: 1, vcket: null },
    ]);
    expect(sales.sql).toContain("$3::date"); // dtgljual (setelah unit_id, ckdjualbbm)
    const det = buildUpsert(TABLE_CONFIG.sales_detail!, 1, [
      { ckdjualbbm: "H1", ckdnozzle: "N1", nurut: 1, dtgljam: "2026-06-11T07:30:00Z" },
    ]);
    expect(det.sql).toContain("::timestamptz");
    const dlv = buildUpsert(TABLE_CONFIG.delivery!, 1, [{ ckdtrm: "D1", dtgltrm: "2026-06-11", dtgljam: "2026-06-11T07:30:00Z" }]);
    expect(dlv.sql).toContain("::date");
  });

  it("semua kolom = conflict → DO NOTHING (tanpa SET kosong)", () => {
    const cfgAllKey = {
      table: "x",
      columns: ["a"],
      conflict: ["a"],
      hasIngestedAt: false,
    };
    const { sql } = buildUpsert(cfgAllKey, 1, [{ a: "v" }]);
    expect(sql).toContain("DO NOTHING");
  });

  it("rows kosong → error", () => {
    expect(() => buildUpsert(TABLE_CONFIG.opname!, 1, [])).toThrow();
  });

  it("SEMUA tabel target payload punya config dengan conflict ⊆ columns", () => {
    for (const [name, cfg] of Object.entries(TABLE_CONFIG)) {
      expect(cfg.table, name).toBe(name);
      for (const k of cfg.conflict) expect(cfg.columns, name).toContain(k);
    }
  });
});
