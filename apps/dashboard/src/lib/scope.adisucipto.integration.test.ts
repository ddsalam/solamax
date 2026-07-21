import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";
import { ptLabelForUnits } from "./config";

/**
 * UJI ISOLASI LINTAS-TENANT Adisucipto (unit #3, PT Sola Adis Raya) ⊥
 * {IB, Bakau} (PT Sola Petra Abadi) — DB-LIVE, FIXTURE-FREE, READ-ONLY.
 *
 * Beda dgn scope.bakau.integration.test.ts (isolasi antar-unit SATU tenant):
 * di sini batasnya TENANT (Option A onboarding AS) — direksi/admin tenant lama
 * TIDAK boleh melihat AS sama sekali, dan sebaliknya, tanpa grant per-unit.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN unit AS ada.
 * Bila AS BELUM ada di instance itu, tiap test melapor **SKIP eksplisit**
 * (`ctx.skip()`), BUKAN `return` senyap — sebab vitest melaporkan return senyap
 * sebagai ✓ PASS, yang membuat "unit tidak ada" tak bisa dibedakan dari
 * "isolasi terverifikasi" (false assurance). Tetap aman dijalankan di mana pun.
 * Pasangan DB-layer-nya = RLS 0016 (lihat rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("Adisucipto⊥PT-lama cross-TENANT isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let ptLama: string | undefined; // PT Sola Petra Abadi
  let ptAdis: string | undefined; // PT Sola Adis Raya
  let as: { unit_id: number; tenant_id: string | null } | undefined;
  let lama: { unit_id: number; tenant_id: string | null }[] = [];

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort((a, b) => a - b);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    ptLama = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'pt-sola-petra-abadi'`))
      .rows[0]?.id;
    ptAdis = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'pt-sola-adis-raya'`))
      .rows[0]?.id;
    as = units.find((u) => u.code === "6478101");
    lama = units.filter((u) => u.tenant_id === ptLama);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: AS aktif di bawah tenant PT Sola Adis Raya ≠ tenant lama (skip jika AS belum ada)", (ctx) => {
    if (!as) return ctx.skip(); // absen → SKIP eksplisit, BUKAN pass senyap
    expect(ptAdis).toBeTruthy();
    expect(as!.tenant_id).toBe(ptAdis);
    expect(ptLama).toBeTruthy();
    expect(ptAdis).not.toBe(ptLama);
    // AS tidak boleh menumpang tenant lama (Option A — bukan pola Bakau).
    expect(lama.map((u) => u.unit_id)).not.toContain(as!.unit_id);
  });

  it("direksi tenant LAMA → TIDAK melihat AS (unit tenant lama saja)", (ctx) => {
    if (!as) return ctx.skip();
    const a = allowed({ role: "direksi", tenantId: ptLama!, unitScope: "ALL" });
    expect(a).not.toContain(as!.unit_id);
    for (const u of lama) expect(a).toContain(u.unit_id);
  });

  it("admin_perusahaan tenant LAMA → TIDAK melihat AS", (ctx) => {
    if (!as) return ctx.skip();
    const a = allowed({ role: "admin_perusahaan", tenantId: ptLama!, unitScope: "ALL" });
    expect(a).not.toContain(as!.unit_id);
  });

  it("direksi PT Sola Adis Raya → HANYA AS (tanpa grant per-unit)", (ctx) => {
    if (!as) return ctx.skip();
    const a = allowed({ role: "direksi", tenantId: ptAdis!, unitScope: "ALL" });
    expect(a).toEqual([as!.unit_id]);
  });

  it("pengawas[AS] → HANYA AS; pengawas tenant lama TIDAK melihat AS", (ctx) => {
    if (!as) return ctx.skip();
    const a = allowed({ role: "pengawas", tenantId: ptAdis!, unitScope: [as!.unit_id] });
    expect(a).toEqual([as!.unit_id]);
    for (const u of lama) {
      const b = allowed({ role: "pengawas", tenantId: ptLama!, unitScope: [u.unit_id] });
      expect(b).not.toContain(as!.unit_id);
    }
  });

  it("404 lintas-tenant: unit AS tak terlihat viewer tenant lama (→ notFound, tanpa bocor eksistensi)", (ctx) => {
    if (!as) return ctx.skip();
    // scope.requireUnit() melempar notFound() bila unit tak lolos unitVisible —
    // 404 identik dgn unit-tak-ada, jadi eksistensi AS tidak bocor.
    expect(
      unitVisible(
        { role: "direksi", tenantId: ptLama!, unitScope: "ALL" },
        { unit_id: as!.unit_id, tenant_id: as!.tenant_id },
      ),
    ).toBe(false);
    for (const u of lama) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: ptAdis!, unitScope: "ALL" },
          { unit_id: u.unit_id, tenant_id: u.tenant_id },
        ),
      ).toBe(false);
    }
  });

  it("super_admin → melihat semua unit kedua tenant", (ctx) => {
    if (!as) return ctx.skip();
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(as!.unit_id);
    for (const u of lama) expect(a).toContain(u.unit_id);
  });

  it("label PT ekspor: unit AS → PT Sola Adis Raya; campuran lintas-PT → payung SolaGroup", (ctx) => {
    if (!as) return ctx.skip();
    expect(ptLabelForUnits(["6478101"])).toBe("PT Sola Adis Raya");
    expect(ptLabelForUnits(["6478111", "6378301"])).toBe("PT Sola Petra Abadi");
    expect(ptLabelForUnits(["6478111", "6478101"])).toBe("SolaGroup");
  });
});
