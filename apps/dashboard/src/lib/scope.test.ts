import { describe, expect, it } from "vitest";
import { unitVisible, type ScopeCtx } from "./scope-rule";

/**
 * UJI AKSES-NEGATIF (penegasan A) — di lapisan aturan otorisasi tunggal `unitVisible`.
 * Karena SEMUA query data hanya menerima unit yang lolos aturan ini (lewat DataScope
 * + tipe ber-brand ScopedUnitId), lolosnya tes ini = jaminan default-deny lintas
 * tenant/unit di server. (Tes DB-live atas SQL nyata dijalankan terpisah saat seed.)
 */

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// Unit IB (tenant A) + unit placeholder (tenant B).
const UNIT_IB = { unit_id: 1, tenant_id: TENANT_A };
const UNIT_B = { unit_id: 2, tenant_id: TENANT_B };

const superAdmin: ScopeCtx = { role: "super_admin", tenantId: null, unitScope: "ALL" };
const direksiA: ScopeCtx = { role: "direksi", tenantId: TENANT_A, unitScope: "ALL" };
const pengawasA_IB: ScopeCtx = { role: "pengawas", tenantId: TENANT_A, unitScope: [1] };
const pengawasB_unit2: ScopeCtx = { role: "pengawas", tenantId: TENANT_B, unitScope: [2] };

describe("unitVisible — super_admin", () => {
  it("melihat semua tenant/unit", () => {
    expect(unitVisible(superAdmin, UNIT_IB)).toBe(true);
    expect(unitVisible(superAdmin, UNIT_B)).toBe(true);
  });
});

describe("unitVisible — direksi (tenant A)", () => {
  it("melihat unit tenant-nya (IB)", () => {
    expect(unitVisible(direksiA, UNIT_IB)).toBe(true);
  });
  it("DITOLAK melihat unit tenant lain (tenant B)", () => {
    expect(unitVisible(direksiA, UNIT_B)).toBe(false);
  });
});

describe("unitVisible — pengawas IB (tenant A, unit 1)", () => {
  it("melihat unit-nya (IB)", () => {
    expect(unitVisible(pengawasA_IB, UNIT_IB)).toBe(true);
  });
  it("DITOLAK melihat unit lain di tenant SAMA", () => {
    expect(unitVisible(pengawasA_IB, { unit_id: 3, tenant_id: TENANT_A })).toBe(false);
  });
  it("DITOLAK melihat unit tenant lain", () => {
    expect(unitVisible(pengawasA_IB, UNIT_B)).toBe(false);
  });
});

describe("unitVisible — pengawas unit placeholder (tenant B, unit 2)", () => {
  it("melihat unit-nya (placeholder)", () => {
    expect(unitVisible(pengawasB_unit2, UNIT_B)).toBe(true);
  });
  it("DITOLAK melihat IB (tenant lain) — harus NOL data IB", () => {
    expect(unitVisible(pengawasB_unit2, UNIT_IB)).toBe(false);
  });
});

describe("default-deny", () => {
  it("non-super tanpa tenant → tak melihat apa pun", () => {
    const orphan: ScopeCtx = { role: "direksi", tenantId: null, unitScope: "ALL" };
    expect(unitVisible(orphan, UNIT_IB)).toBe(false);
    expect(unitVisible(orphan, UNIT_B)).toBe(false);
  });
  it("pengawas dengan unitScope kosong → tak melihat apa pun", () => {
    const empty: ScopeCtx = { role: "pengawas", tenantId: TENANT_A, unitScope: [] };
    expect(unitVisible(empty, UNIT_IB)).toBe(false);
  });
});
