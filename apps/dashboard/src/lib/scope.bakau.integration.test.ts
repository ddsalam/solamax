import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";

/**
 * UJI ISOLASI Bakau⊥IB (unit #2) — DB-LIVE, FIXTURE-FREE, READ-ONLY.
 * Membuktikan aturan scope aplikasi (`unitVisible`) mengisolasi DUA unit di bawah
 * SATU tenant PT: pengawas Bakau melihat HANYA Bakau, pengawas IB HANYA IB, direksi
 * melihat KEDUANYA, dan permintaan lintas-unit tak terlihat (→ notFound/404).
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN kedua unit ada — otomatis
 * SKIP pada instance 1-unit, sehingga tetap hijau di live sampai Bakau di-provision.
 * Pasangan DB-layer-nya = RLS 0016 (lihat rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("Bakau⊥IB scope isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let pt: string | undefined;
  let ib: { unit_id: number; tenant_id: string | null } | undefined;
  let bakau: { unit_id: number; tenant_id: string | null } | undefined;

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort((a, b) => a - b);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    pt = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'pt-sola-petra-abadi'`)).rows[0]?.id;
    ib = units.find((u) => u.code === "6478111");
    bakau = units.find((u) => u.code === "6378301");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: IB + Bakau aktif di bawah satu tenant PT (skip jika Bakau belum ada)", () => {
    if (!bakau) return; // instance 1-unit → sisanya di-skip lewat guard di tiap test
    expect(ib).toBeTruthy();
    expect(ib!.tenant_id).toBe(pt);
    expect(bakau!.tenant_id).toBe(pt);
    expect(pt).toBeTruthy();
  });

  it("direksi PT → melihat KEDUA IB + Bakau", () => {
    if (!bakau) return;
    const a = allowed({ role: "direksi", tenantId: pt!, unitScope: "ALL" });
    expect(a).toContain(ib!.unit_id);
    expect(a).toContain(bakau!.unit_id);
  });

  it("pengawas[Bakau] → HANYA Bakau (bukan IB)", () => {
    if (!bakau) return;
    const a = allowed({ role: "pengawas", tenantId: pt!, unitScope: [bakau!.unit_id] });
    expect(a).toEqual([bakau!.unit_id]);
    expect(a).not.toContain(ib!.unit_id);
  });

  it("pengawas[IB] → HANYA IB (bukan Bakau)", () => {
    if (!bakau) return;
    const a = allowed({ role: "pengawas", tenantId: pt!, unitScope: [ib!.unit_id] });
    expect(a).toEqual([ib!.unit_id]);
    expect(a).not.toContain(bakau!.unit_id);
  });

  it("super_admin → melihat keduanya", () => {
    if (!bakau) return;
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(ib!.unit_id);
    expect(a).toContain(bakau!.unit_id);
  });

  it("404 lintas-unit: pengawas Bakau minta IB (dan sebaliknya) → tak terlihat", () => {
    if (!bakau) return;
    // scope.requireUnit() melempar notFound() bila unit tak lolos unitVisible.
    expect(
      unitVisible(
        { role: "pengawas", tenantId: pt!, unitScope: [bakau!.unit_id] },
        { unit_id: ib!.unit_id, tenant_id: ib!.tenant_id },
      ),
    ).toBe(false);
    expect(
      unitVisible(
        { role: "pengawas", tenantId: pt!, unitScope: [ib!.unit_id] },
        { unit_id: bakau!.unit_id, tenant_id: bakau!.tenant_id },
      ),
    ).toBe(false);
  });
});
