import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";

/**
 * UJI AKSES-NEGATIF DB-LIVE (penegasan A) atas DATA NYATA staging: memastikan
 * wiring tenant_id unit (IB→SolaGroup, placeholder→tenant B) + aturan unitVisible
 * menghasilkan isolasi yang benar. Hanya jalan bila SCOPE_LIVE_DB=1 & DATABASE_URL
 * di-set (default `pnpm test` tetap bebas-DB). Read-only.
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("scope live (DB nyata)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let tenantA: string; // SolaGroup
  let tenantB: string; // placeholder
  let ibId: number;
  let placeholderId: number;

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort();

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    const t = await pool.query(`SELECT id, slug FROM app.tenant`);
    tenantA = t.rows.find((r) => r.slug === "solagroup").id;
    tenantB = t.rows.find((r) => r.slug === "placeholder").id;
    ibId = units.find((u) => u.code === "6478111")!.unit_id;
    placeholderId = units.find((u) => u.code === "9990001")!.unit_id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("seed lengkap: IB (tenant A) + placeholder (tenant B) ada & beda tenant", () => {
    expect(tenantA).toBeTruthy();
    expect(tenantB).toBeTruthy();
    expect(tenantA).not.toBe(tenantB);
    expect(units.find((u) => u.unit_id === ibId)!.tenant_id).toBe(tenantA);
    expect(units.find((u) => u.unit_id === placeholderId)!.tenant_id).toBe(tenantB);
  });

  it("super_admin → semua unit", () => {
    expect(allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" })).toEqual(
      [ibId, placeholderId].sort(),
    );
  });

  it("direksi tenant A → HANYA IB (bukan placeholder tenant B)", () => {
    const got = allowed({ role: "direksi", tenantId: tenantA, unitScope: "ALL" });
    expect(got).toContain(ibId);
    expect(got).not.toContain(placeholderId);
  });

  it("pengawas IB → HANYA IB", () => {
    expect(allowed({ role: "pengawas", tenantId: tenantA, unitScope: [ibId] })).toEqual([ibId]);
  });

  it("pengawas placeholder (tenant B) → HANYA placeholder, NOL data IB", () => {
    const got = allowed({ role: "pengawas", tenantId: tenantB, unitScope: [placeholderId] });
    expect(got).toEqual([placeholderId]);
    expect(got).not.toContain(ibId); // penegasan A: tak boleh lihat IB
  });
});
