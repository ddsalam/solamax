import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";
import { ptLabelForUnits } from "./config";

/**
 * UJI ISOLASI LINTAS-TENANT Korek (KR, unit #6, PT Mitra Indah Lestari Oil
 * Pratama) ⊥ SEMUA unit tenant lain — {IB, Bakau} (PT Sola Petra Abadi) +
 * {Adisucipto} (PT Sola Adis Raya) + {Bundaran Kotabaru} (PT Merita Abadi
 * Sukses) + {Batu Layang} (PT Batu Layang Jaya) — DB-LIVE, FIXTURE-FREE,
 * READ-ONLY.
 *
 * KR = tenant BARU ke-5 (Option A, pola AS/KB/BL — bukan same-tenant Bakau).
 * Batasnya TENANT: direksi/admin tenant lain TIDAK boleh melihat KR sama sekali,
 * dan KR TIDAK boleh melihat unit tenant lain, tanpa grant per-unit. Isolasi
 * ditegakkan di scope-rule.ts:35 (`unit.tenant_id !== ctx.tenantId → false`),
 * simetris.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN unit KR ada.
 * Bila KR BELUM ada di instance itu, tiap test melapor **SKIP eksplisit**
 * (`ctx.skip()`), BUKAN `return` senyap — sebab vitest melaporkan return senyap
 * sebagai ✓ PASS, yang membuat "unit tidak ada" tak bisa dibedakan dari
 * "isolasi terverifikasi" (false assurance; lihat PR #111). Tetap aman
 * dijalankan di mana pun. Pasangan DB-layer-nya = RLS 0016 (lihat
 * rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("KR⊥tenant-lain cross-TENANT isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let ptKr: string | undefined; // PT Mitra Indah Lestari Oil Pratama
  let kr: { unit_id: number; tenant_id: string | null } | undefined;
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
    ptKr = (
      await pool.query(
        `SELECT id FROM app.tenant WHERE slug = 'pt-mitra-indah-lestari-oil-pratama'`,
      )
    ).rows[0]?.id;
    kr = units.find((u) => u.code === "6478311");
    // "others" = SEMUA unit tenant lain (lintas empat tenant lama), by tenant_id.
    others = kr ? units.filter((u) => u.tenant_id !== kr!.tenant_id) : [];
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: KR aktif di bawah tenant PT Mitra Indah Lestari Oil Pratama ≠ tenant lain (skip jika KR belum ada)", (ctx) => {
    if (!kr) return ctx.skip(); // absen → SKIP eksplisit, BUKAN pass senyap
    expect(ptKr).toBeTruthy();
    expect(kr!.tenant_id).toBe(ptKr);
    // KR tidak boleh menumpang tenant lain (Option A — bukan pola Bakau).
    expect(others.map((u) => u.unit_id)).not.toContain(kr!.unit_id);
    // Ada minimal satu unit tenant lain utk membuktikan isolasi (IB/Bakau/AS/KB/BL live).
    expect(others.length).toBeGreaterThan(0);
  });

  it("direksi tiap tenant LAIN → TIDAK melihat KR (hanya unit tenant-nya sendiri)", (ctx) => {
    if (!kr) return ctx.skip();
    const otherTenants = [...new Set(others.map((u) => u.tenant_id))];
    for (const t of otherTenants) {
      const a = allowed({ role: "direksi", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(kr!.unit_id);
      // direksi tenant-lain tetap melihat unit-nya sendiri.
      for (const u of others.filter((x) => x.tenant_id === t)) expect(a).toContain(u.unit_id);
    }
  });

  it("admin_perusahaan tiap tenant LAIN → TIDAK melihat KR", (ctx) => {
    if (!kr) return ctx.skip();
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      const a = allowed({ role: "admin_perusahaan", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(kr!.unit_id);
    }
  });

  it("direksi PT Mitra Indah Lestari Oil Pratama → HANYA KR (tanpa grant per-unit)", (ctx) => {
    if (!kr) return ctx.skip();
    const a = allowed({ role: "direksi", tenantId: ptKr!, unitScope: "ALL" });
    expect(a).toEqual([kr!.unit_id]);
  });

  it("pengawas[KR] → HANYA KR; pengawas tenant lain TIDAK melihat KR", (ctx) => {
    if (!kr) return ctx.skip();
    const a = allowed({ role: "pengawas", tenantId: ptKr!, unitScope: [kr!.unit_id] });
    expect(a).toEqual([kr!.unit_id]);
    for (const u of others) {
      const b = allowed({ role: "pengawas", tenantId: u.tenant_id!, unitScope: [u.unit_id] });
      expect(b).not.toContain(kr!.unit_id);
    }
  });

  it("404 lintas-tenant dua arah: KR tak terlihat viewer tenant lain, dan sebaliknya", (ctx) => {
    if (!kr) return ctx.skip();
    // Arah 1: viewer tenant lain → KR tak terlihat (notFound(), tanpa bocor eksistensi).
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: t!, unitScope: "ALL" },
          { unit_id: kr!.unit_id, tenant_id: kr!.tenant_id },
        ),
      ).toBe(false);
    }
    // Arah 2: viewer KR → unit tenant lain tak terlihat.
    for (const u of others) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: ptKr!, unitScope: "ALL" },
          { unit_id: u.unit_id, tenant_id: u.tenant_id },
        ),
      ).toBe(false);
    }
  });

  it("super_admin → melihat semua unit (KR + semua tenant lain)", (ctx) => {
    if (!kr) return ctx.skip();
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(kr!.unit_id);
    for (const u of others) expect(a).toContain(u.unit_id);
  });

  it("label PT ekspor: unit KR → PT Mitra Indah Lestari Oil Pratama; campuran lintas-PT → payung SolaGroup", (ctx) => {
    if (!kr) return ctx.skip();
    expect(ptLabelForUnits(["6478311"])).toBe("PT Mitra Indah Lestari Oil Pratama");
    expect(ptLabelForUnits(["6478311", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478311", "6478201"])).toBe("SolaGroup");
  });
});
