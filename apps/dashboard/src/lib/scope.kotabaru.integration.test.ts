import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";
import { ptLabelForUnits } from "./config";

/**
 * UJI ISOLASI LINTAS-TENANT Bundaran Kotabaru (KB, unit #4, PT Merita Abadi
 * Sukses) ⊥ SEMUA unit tenant lain — {IB, Bakau} (PT Sola Petra Abadi) +
 * {Adisucipto} (PT Sola Adis Raya) — DB-LIVE, FIXTURE-FREE, READ-ONLY.
 *
 * KB = tenant BARU ke-3 (Option A, pola AS — bukan same-tenant Bakau). Batasnya
 * TENANT: direksi/admin tenant lain TIDAK boleh melihat KB sama sekali, dan KB
 * TIDAK boleh melihat unit tenant lain, tanpa grant per-unit. Isolasi ditegakkan
 * di scope-rule.ts:35 (`unit.tenant_id !== ctx.tenantId → false`), simetris.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN unit KB ada —
 * otomatis SKIP pada instance tanpa KB, sehingga tetap hijau di mana pun.
 * Pasangan DB-layer-nya = RLS 0016 (lihat rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("KB⊥tenant-lain cross-TENANT isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let ptKb: string | undefined; // PT Merita Abadi Sukses
  let kb: { unit_id: number; tenant_id: string | null } | undefined;
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
    ptKb = (await pool.query(`SELECT id FROM app.tenant WHERE slug = 'pt-merita-abadi-sukses'`))
      .rows[0]?.id;
    kb = units.find((u) => u.code === "6478106");
    // "others" = SEMUA unit tenant lain (lintas dua tenant lama), by tenant_id.
    others = kb ? units.filter((u) => u.tenant_id !== kb!.tenant_id) : [];
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: KB aktif di bawah tenant PT Merita Abadi Sukses ≠ tenant lain (skip jika KB belum ada)", () => {
    if (!kb) return; // instance tanpa KB → sisanya di-skip lewat guard di tiap test
    expect(ptKb).toBeTruthy();
    expect(kb!.tenant_id).toBe(ptKb);
    // KB tidak boleh menumpang tenant lain (Option A — bukan pola Bakau).
    expect(others.map((u) => u.unit_id)).not.toContain(kb!.unit_id);
    // Ada minimal satu unit tenant lain utk membuktikan isolasi (IB/Bakau/AS live).
    expect(others.length).toBeGreaterThan(0);
  });

  it("direksi tiap tenant LAIN → TIDAK melihat KB (hanya unit tenant-nya sendiri)", () => {
    if (!kb) return;
    const otherTenants = [...new Set(others.map((u) => u.tenant_id))];
    for (const t of otherTenants) {
      const a = allowed({ role: "direksi", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(kb!.unit_id);
      // direksi tenant-lain tetap melihat unit-nya sendiri.
      for (const u of others.filter((x) => x.tenant_id === t)) expect(a).toContain(u.unit_id);
    }
  });

  it("admin_perusahaan tiap tenant LAIN → TIDAK melihat KB", () => {
    if (!kb) return;
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      const a = allowed({ role: "admin_perusahaan", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(kb!.unit_id);
    }
  });

  it("direksi PT Merita Abadi Sukses → HANYA KB (tanpa grant per-unit)", () => {
    if (!kb) return;
    const a = allowed({ role: "direksi", tenantId: ptKb!, unitScope: "ALL" });
    expect(a).toEqual([kb!.unit_id]);
  });

  it("pengawas[KB] → HANYA KB; pengawas tenant lain TIDAK melihat KB", () => {
    if (!kb) return;
    const a = allowed({ role: "pengawas", tenantId: ptKb!, unitScope: [kb!.unit_id] });
    expect(a).toEqual([kb!.unit_id]);
    for (const u of others) {
      const b = allowed({ role: "pengawas", tenantId: u.tenant_id!, unitScope: [u.unit_id] });
      expect(b).not.toContain(kb!.unit_id);
    }
  });

  it("404 lintas-tenant dua arah: KB tak terlihat viewer tenant lain, dan sebaliknya", () => {
    if (!kb) return;
    // Arah 1: viewer tenant lain → KB tak terlihat (notFound(), tanpa bocor eksistensi).
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: t!, unitScope: "ALL" },
          { unit_id: kb!.unit_id, tenant_id: kb!.tenant_id },
        ),
      ).toBe(false);
    }
    // Arah 2: viewer KB → unit tenant lain tak terlihat.
    for (const u of others) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: ptKb!, unitScope: "ALL" },
          { unit_id: u.unit_id, tenant_id: u.tenant_id },
        ),
      ).toBe(false);
    }
  });

  it("super_admin → melihat semua unit (KB + semua tenant lain)", () => {
    if (!kb) return;
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(kb!.unit_id);
    for (const u of others) expect(a).toContain(u.unit_id);
  });

  it("label PT ekspor: unit KB → PT Merita Abadi Sukses; campuran lintas-PT → payung SolaGroup", () => {
    if (!kb) return;
    expect(ptLabelForUnits(["6478106"])).toBe("PT Merita Abadi Sukses");
    expect(ptLabelForUnits(["6478106", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478106", "6478101"])).toBe("SolaGroup");
  });
});
