import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";
import { ptLabelForUnits } from "./config";

/**
 * UJI ISOLASI LINTAS-TENANT Batu Layang (BL, unit #5, PT Batu Layang Jaya) ⊥
 * SEMUA unit tenant lain — {IB, Bakau} (PT Sola Petra Abadi) + {Adisucipto}
 * (PT Sola Adis Raya) + {Bundaran Kotabaru} (PT Merita Abadi Sukses) —
 * DB-LIVE, FIXTURE-FREE, READ-ONLY.
 *
 * BL = tenant BARU ke-4 (Option A, pola AS/KB — bukan same-tenant Bakau).
 * Batasnya TENANT: direksi/admin tenant lain TIDAK boleh melihat BL sama sekali,
 * dan BL TIDAK boleh melihat unit tenant lain, tanpa grant per-unit. Isolasi
 * ditegakkan di scope-rule.ts:35 (`unit.tenant_id !== ctx.tenantId → false`),
 * simetris.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN unit BL ada.
 * Bila BL BELUM ada di instance itu, tiap test melapor **SKIP eksplisit**
 * (`ctx.skip()`), BUKAN `return` senyap — sebab vitest melaporkan return senyap
 * sebagai ✓ PASS, yang membuat "unit tidak ada" tak bisa dibedakan dari
 * "isolasi terverifikasi" (false assurance). Tetap aman dijalankan di mana pun.
 * Pasangan DB-layer-nya = RLS 0016 (lihat rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("BL⊥tenant-lain cross-TENANT isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let ptBl: string | undefined; // PT Batu Layang Jaya
  let bl: { unit_id: number; tenant_id: string | null } | undefined;
  let others: { unit_id: number; tenant_id: string | null }[] = [];

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort((a, b) => a - b);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    ptBl = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'pt-batu-layang-jaya'`))
      .rows[0]?.id;
    bl = units.find((u) => u.code === "6478201");
    // "others" = SEMUA unit tenant lain (lintas tiga tenant lama), by tenant_id.
    others = bl ? units.filter((u) => u.tenant_id !== bl!.tenant_id) : [];
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: BL aktif di bawah tenant PT Batu Layang Jaya ≠ tenant lain (skip jika BL belum ada)", (ctx) => {
    if (!bl) return ctx.skip(); // absen → SKIP eksplisit, BUKAN pass senyap
    expect(ptBl).toBeTruthy();
    expect(bl!.tenant_id).toBe(ptBl);
    // BL tidak boleh menumpang tenant lain (Option A — bukan pola Bakau).
    expect(others.map((u) => u.unit_id)).not.toContain(bl!.unit_id);
    // Ada minimal satu unit tenant lain utk membuktikan isolasi (IB/Bakau/AS/KB live).
    expect(others.length).toBeGreaterThan(0);
  });

  it("direksi tiap tenant LAIN → TIDAK melihat BL (hanya unit tenant-nya sendiri)", (ctx) => {
    if (!bl) return ctx.skip();
    const otherTenants = [...new Set(others.map((u) => u.tenant_id))];
    for (const t of otherTenants) {
      const a = allowed({ role: "direksi", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(bl!.unit_id);
      // direksi tenant-lain tetap melihat unit-nya sendiri.
      for (const u of others.filter((x) => x.tenant_id === t)) expect(a).toContain(u.unit_id);
    }
  });

  it("admin_perusahaan tiap tenant LAIN → TIDAK melihat BL", (ctx) => {
    if (!bl) return ctx.skip();
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      const a = allowed({ role: "admin_perusahaan", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(bl!.unit_id);
    }
  });

  it("direksi PT Batu Layang Jaya → HANYA BL (tanpa grant per-unit)", (ctx) => {
    if (!bl) return ctx.skip();
    const a = allowed({ role: "direksi", tenantId: ptBl!, unitScope: "ALL" });
    expect(a).toEqual([bl!.unit_id]);
  });

  it("pengawas[BL] → HANYA BL; pengawas tenant lain TIDAK melihat BL", (ctx) => {
    if (!bl) return ctx.skip();
    const a = allowed({ role: "pengawas", tenantId: ptBl!, unitScope: [bl!.unit_id] });
    expect(a).toEqual([bl!.unit_id]);
    for (const u of others) {
      const b = allowed({ role: "pengawas", tenantId: u.tenant_id!, unitScope: [u.unit_id] });
      expect(b).not.toContain(bl!.unit_id);
    }
  });

  it("404 lintas-tenant dua arah: BL tak terlihat viewer tenant lain, dan sebaliknya", (ctx) => {
    if (!bl) return ctx.skip();
    // Arah 1: viewer tenant lain → BL tak terlihat (notFound(), tanpa bocor eksistensi).
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: t!, unitScope: "ALL" },
          { unit_id: bl!.unit_id, tenant_id: bl!.tenant_id },
        ),
      ).toBe(false);
    }
    // Arah 2: viewer BL → unit tenant lain tak terlihat.
    for (const u of others) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: ptBl!, unitScope: "ALL" },
          { unit_id: u.unit_id, tenant_id: u.tenant_id },
        ),
      ).toBe(false);
    }
  });

  it("super_admin → melihat semua unit (BL + semua tenant lain)", (ctx) => {
    if (!bl) return ctx.skip();
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(bl!.unit_id);
    for (const u of others) expect(a).toContain(u.unit_id);
  });

  it("label PT ekspor: unit BL → PT Batu Layang Jaya; campuran lintas-PT → payung SolaGroup", (ctx) => {
    if (!bl) return ctx.skip();
    expect(ptLabelForUnits(["6478201"])).toBe("PT Batu Layang Jaya");
    expect(ptLabelForUnits(["6478201", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478201", "6478106"])).toBe("SolaGroup");
  });
});
