import { describe, expect, it } from "vitest";
import { resolveRole, unitVisible, type ScopeCtx } from "./scope-rule";
import { ctxAll, ctxMany, ctxSuper, ctxUnits } from "./test-ctx";

/**
 * UJI AKSES-NEGATIF (penegasan A) — di lapisan aturan otorisasi tunggal `unitVisible`.
 * Karena SEMUA query data hanya menerima unit yang lolos aturan ini (lewat DataScope
 * + tipe ber-brand ScopedUnitId), lolosnya tes ini = jaminan default-deny lintas
 * tenant/unit di server. (Tes DB-live atas SQL nyata dijalankan terpisah saat seed.)
 *
 * Bentuk konteks mengikuti migrasi 0019: hak efektif = GABUNGAN penugasan aktif, dan
 * luas unit ditentukan kolom EKSPLISIT `allUnits` — BUKAN oleh kosong/tidaknya daftar
 * unit. Konversi dari bentuk lama bersifat mekanis (lihat test-ctx.ts); tak ada asersi
 * yang dilonggarkan.
 */

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// Unit IB (tenant A) + unit placeholder (tenant B).
const UNIT_IB = { unit_id: 1, tenant_id: TENANT_A };
const UNIT_B = { unit_id: 2, tenant_id: TENANT_B };

const superAdmin = ctxSuper();
const direksiA = ctxAll("direksi", TENANT_A);
const pengawasA_IB = ctxUnits("pengawas", TENANT_A, [1]);
const pengawasB_unit2 = ctxUnits("pengawas", TENANT_B, [2]);

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
  it("DITOLAK walau unit tenant lain ADA di daftar unitnya (phantom grant pra-0019)", () => {
    // Bentuk baris yang bisa dibuat UI lama; sejak 0019 mustahil TERSIMPAN, tapi
    // aturan baca tetap harus menolaknya.
    const phantom = ctxUnits("pengawas", TENANT_A, [1, 2]);
    expect(unitVisible(phantom, UNIT_IB)).toBe(true);
    expect(unitVisible(phantom, UNIT_B)).toBe(false);
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
  it("non-super tanpa penugasan → tak melihat apa pun", () => {
    const orphan: ScopeCtx = { role: "direksi", assignments: [] };
    expect(unitVisible(orphan, UNIT_IB)).toBe(false);
    expect(unitVisible(orphan, UNIT_B)).toBe(false);
  });
  it("T-EMPTY: pengawas dengan daftar unit KOSONG → tak melihat apa pun", () => {
    const empty = ctxUnits("pengawas", TENANT_A, []);
    expect(unitVisible(empty, UNIT_IB)).toBe(false);
  });
  it("T-EMPTY (semua role): daftar kosong = DENY, bukan 'semua'", () => {
    for (const role of ["direksi", "admin_perusahaan", "pengawas"] as const) {
      expect(unitVisible(ctxUnits(role, TENANT_A, []), UNIT_IB)).toBe(false);
    }
  });
  it("unit tanpa tenant (yatim) → tak terlihat siapa pun kecuali super_admin", () => {
    const yatim = { unit_id: 9, tenant_id: null };
    expect(unitVisible(direksiA, yatim)).toBe(false);
    expect(unitVisible(pengawasA_IB, yatim)).toBe(false);
    expect(unitVisible(superAdmin, yatim)).toBe(true);
  });
});

/* ═════════ Kemampuan baru 0019 — sebelumnya tak mungkin dinyatakan sama sekali ═════════ */

describe("T-UNION — satu orang, penugasan di DUA PT (tanpa super_admin)", () => {
  const lintas = ctxMany("direksi", [
    { tenantId: TENANT_A, allUnits: true, unitIds: [] },
    { tenantId: TENANT_B, allUnits: false, unitIds: [2] },
  ]);
  it("melihat TEPAT gabungan yang diberikan", () => {
    expect(unitVisible(lintas, UNIT_IB)).toBe(true); // via penugasan A (semua unit)
    expect(unitVisible(lintas, UNIT_B)).toBe(true); // via penugasan B (unit 2 saja)
  });
  it("nol selebihnya: unit LAIN di PT B tidak terlihat", () => {
    expect(unitVisible(lintas, { unit_id: 5, tenant_id: TENANT_B })).toBe(false);
  });
  it("nol selebihnya: PT ketiga tidak terlihat", () => {
    const TENANT_C = "33333333-3333-3333-3333-333333333333";
    expect(unitVisible(lintas, { unit_id: 7, tenant_id: TENANT_C })).toBe(false);
  });
});

describe("T-SUBSET — batas unit berlaku untuk SEMUA role, bukan hanya pengawas", () => {
  it("direksi ber-daftar-unit TIDAK melihat unit lain di PT-nya sendiri", () => {
    const direksiTerbatas = ctxUnits("direksi", TENANT_A, [2]);
    expect(unitVisible(direksiTerbatas, { unit_id: 2, tenant_id: TENANT_A })).toBe(true);
    expect(unitVisible(direksiTerbatas, UNIT_IB)).toBe(false); // unit 1 di PT A
  });
  it("admin_perusahaan ber-daftar-unit juga terbatas", () => {
    const adminTerbatas = ctxUnits("admin_perusahaan", TENANT_A, [2]);
    expect(unitVisible(adminTerbatas, UNIT_IB)).toBe(false);
  });
});

describe("T-NEWUNIT — dua semantik cakupan saat unit ke-8 onboard", () => {
  const UNIT_BARU = { unit_id: 8, tenant_id: TENANT_A };
  it('"semua unit PT" MEWARISI unit baru tanpa ada yang menyentuh tabel akses', () => {
    expect(unitVisible(ctxAll("direksi", TENANT_A), UNIT_BARU)).toBe(true);
    expect(unitVisible(ctxAll("pengawas", TENANT_A), UNIT_BARU)).toBe(true);
  });
  it('"daftar unit tertentu" BEKU — unit baru TIDAK ikut', () => {
    expect(unitVisible(ctxUnits("direksi", TENANT_A, [1]), UNIT_BARU)).toBe(false);
    expect(unitVisible(ctxUnits("pengawas", TENANT_A, [1]), UNIT_BARU)).toBe(false);
  });
});

describe("resolveRole — fail-closed bila invarian satu-role dilanggar", () => {
  it("role tunggal → dipakai apa adanya, tanpa konflik", () => {
    expect(resolveRole(["direksi", "direksi"])).toEqual({ role: "direksi", conflict: false });
  });
  it("T-FC1: role campur → PALING RESTRIKTIF menang (bukan paling tinggi)", () => {
    expect(resolveRole(["admin_perusahaan", "pengawas"])).toEqual({
      role: "pengawas",
      conflict: true,
    });
    expect(resolveRole(["super_admin", "direksi"])).toEqual({ role: "direksi", conflict: true });
  });
  it("T-FC2: tidak pernah lockout — hasilnya role sah yang tetap bisa dipakai", () => {
    const r = resolveRole(["pengawas", "direksi", "admin_perusahaan"]);
    expect(r.role).toBe("pengawas");
    expect(r.conflict).toBe(true);
    expect(unitVisible(ctxUnits(r.role, TENANT_A, [1]), UNIT_IB)).toBe(true);
  });
});
