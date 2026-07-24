import { describe, expect, it } from "vitest";
import type { ScopedUnit, ScopedUnitId } from "./scope-rule";
import { intersectScopedUnits } from "./unit-params";

const u = (id: number, code: string): ScopedUnit => ({
  unit_id: id as ScopedUnitId,
  code,
  name: code,
});

const SCOPE = [u(1, "6478111"), u(2, "6378301"), u(7, "63781002")];

describe("intersectScopedUnits — aturan keamanan tunggal", () => {
  it("param absen → semua unit ber-scope, allUnits true", () => {
    expect(intersectScopedUnits(undefined, SCOPE)).toEqual({ units: SCOPE, allUnits: true });
  });

  it("string kosong → semua unit ber-scope", () => {
    expect(intersectScopedUnits("", SCOPE).units).toEqual(SCOPE);
    expect(intersectScopedUnits("  ,  ,", SCOPE).units).toEqual(SCOPE);
  });

  it("subset sah → hanya yang diminta, urutan mengikuti SCOPE (bukan urutan URL)", () => {
    const r = intersectScopedUnits("63781002,6478111", SCOPE);
    expect(r.units.map((x) => x.code)).toEqual(["6478111", "63781002"]);
    expect(r.allUnits).toBe(false);
  });

  it("KEAMANAN: kode di luar scope diabaikan diam-diam (tidak melebarkan akses)", () => {
    const r = intersectScopedUnits("6478111,6478999", SCOPE);
    expect(r.units.map((x) => x.code)).toEqual(["6478111"]);
  });

  it("KEAMANAN: SEMUA kode di luar scope → fallback semua scope, BUKAN kosong", () => {
    const r = intersectScopedUnits("6478999,0000000", SCOPE);
    expect(r.units).toEqual(SCOPE);
    expect(r.allUnits).toBe(true);
  });

  it("scope kosong → kosong (tak ada unit yang bisa dibuat dari ketiadaan)", () => {
    expect(intersectScopedUnits("6478111", [])).toEqual({ units: [], allUnits: true });
  });

  it("spasi di sekitar kode ditoleransi", () => {
    expect(intersectScopedUnits(" 6478111 , 6378301 ", SCOPE).units.map((x) => x.code)).toEqual([
      "6478111",
      "6378301",
    ]);
  });

  it("kode 8 digit (28 Oktober) diperlakukan sebagai string opaque", () => {
    expect(intersectScopedUnits("63781002", SCOPE).units.map((x) => x.code)).toEqual(["63781002"]);
  });

  it("allUnits true bila subset kebetulan == seluruh scope", () => {
    const r = intersectScopedUnits("6478111,6378301,63781002", SCOPE);
    expect(r.allUnits).toBe(true);
  });
});
