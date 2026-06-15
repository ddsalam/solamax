import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";

/**
 * UJI AKSES-NEGATIF DB-LIVE (penegasan A) — FIXTURE-FREE & READ-ONLY.
 * Memverifikasi wiring tenant nyata + aturan unitVisible TANPA menulis apa pun:
 * "tenant lain" diwakili UUID sintetis di ScopeCtx, diuji terhadap baris IB NYATA.
 * Cukup role dashboard_app (SELECT). Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL
 * di-set (default `pnpm test` tetap bebas-DB; CI tak menjalankan ini).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

// UUID tenant ASING (sintetis) — tak mungkin == tenant mana pun di DB.
const FOREIGN_TENANT = "00000000-0000-4000-8000-0000deadbeef";

d("scope live (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let solaGroup: string;
  let ib: { unit_id: number; tenant_id: string | null };

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort((a, b) => a - b);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    solaGroup = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'solagroup'`)).rows[0].id;
    ib = units.find((u) => u.code === "6478111")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("wiring nyata: IB aktif & tenant_id = SolaGroup", () => {
    expect(ib).toBeTruthy();
    expect(ib.tenant_id).toBe(solaGroup);
    expect(solaGroup).not.toBe(FOREIGN_TENANT);
  });

  it("super_admin → melihat IB", () => {
    expect(allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" })).toContain(ib.unit_id);
  });

  it("direksi SolaGroup → melihat IB", () => {
    expect(allowed({ role: "direksi", tenantId: solaGroup, unitScope: "ALL" })).toContain(ib.unit_id);
  });

  it("direksi tenant ASING → TIDAK melihat IB (isolasi lintas-tenant)", () => {
    expect(allowed({ role: "direksi", tenantId: FOREIGN_TENANT, unitScope: "ALL" })).not.toContain(
      ib.unit_id,
    );
  });

  it("pengawas SolaGroup [IB] → melihat IB; [] → nol", () => {
    expect(allowed({ role: "pengawas", tenantId: solaGroup, unitScope: [ib.unit_id] })).toContain(
      ib.unit_id,
    );
    expect(allowed({ role: "pengawas", tenantId: solaGroup, unitScope: [] })).toEqual([]);
  });

  it("pengawas tenant ASING (scope berisi id IB) → TIDAK melihat IB (tenant mismatch)", () => {
    expect(
      allowed({ role: "pengawas", tenantId: FOREIGN_TENANT, unitScope: [ib.unit_id] }),
    ).not.toContain(ib.unit_id);
  });
});
