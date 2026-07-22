import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { unitVisible, type ScopeCtx } from "./scope-rule";
import { ptLabelForUnits, UNIT_DISPLAY } from "./config";

/**
 * UJI ISOLASI LINTAS-TENANT 28 Oktober (unit #7, PT Sola Petra Energi) ⊥ SEMUA
 * unit tenant lain — {IB, Bakau} (PT Sola Petra Abadi) + {Adisucipto} (PT Sola
 * Adis Raya) + {Bundaran Kotabaru} (PT Merita Abadi Sukses) + {Batu Layang}
 * (PT Batu Layang Jaya) + {Korek} (PT Mitra Indah Lestari Oil Pratama) —
 * DB-LIVE, FIXTURE-FREE, READ-ONLY. Unit TERAKHIR: armada lengkap 7/7.
 *
 * ⚠️ SLUG NYARIS-TABRAKAN — bahaya khas unit ini. Tenant baru
 * `pt-sola-petra-energi` berbeda SATU KATA dari tenant lama
 * `pt-sola-petra-abadi` (pemilik IB *dan* Bakau). Menyambungkan unit 7 ke
 * tenant yang salah akan membuat data 28 Oktober terlihat oleh direksi
 * IB/Bakau **secara sah menurut aturan** — `scope-rule.ts` tidak akan pernah
 * menandainya, sebab ia memang "bekerja benar". Karena itu:
 *   - slug dicari dengan STRING EKSAK, tak pernah LIKE/prefix/"yang sola petra";
 *   - kedua slug diambil terpisah dan ditegaskan BERBEDA (dan keduanya ADA);
 *   - keanggotaan tenant Abadi ditegaskan TIDAK memuat unit 7.
 *
 * Kelas 28 Oktober = tenant BARU ke-6 (Option A, pola AS/KB/BL/KR — bukan
 * same-tenant Bakau). Batasnya TENANT: direksi/admin tenant lain TIDAK boleh
 * melihat 28 Oktober sama sekali, dan sebaliknya, tanpa grant per-unit.
 * Ditegakkan di scope-rule.ts:35 (`unit.tenant_id !== ctx.tenantId → false`).
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set DAN unit 28 Oktober
 * ada. Bila BELUM ada di instance itu, tiap test melapor **SKIP eksplisit**
 * (`ctx.skip()`), BUKAN `return` senyap — vitest melaporkan return senyap
 * sebagai ✓ PASS dgn nol assertion, yang membuat "unit tidak ada" tak bisa
 * dibedakan dari "isolasi terverifikasi" (false assurance; lihat PR #111).
 * Pasangan DB-layer-nya = RLS 0016 (lihat rls-surfaces.integration.test.ts).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const SLUG_ENERGI = "pt-sola-petra-energi"; // tenant BARU (28 Oktober)
const SLUG_ABADI = "pt-sola-petra-abadi"; // tenant LAMA (IB + Bakau) — bukan ini!
const CODE_28 = "63781002"; // DELAPAN digit — satu-satunya di armada

/**
 * Sidik jari instance LIVE (`solamax-pg`). Bukan rahasia — sudah tercatat di
 * session-notes/unit-onboarding-runbook.md §1.0 sebagai guard anti-salah-cluster.
 * Dipakai untuk MEMBATASI klaim topologi ("armada 7/7") ke instance live saja:
 * `-rlsstg` sengaja hanya memuat subset sintetis, jadi menuntut 7 unit di sana
 * akan merah PALSU — bukan temuan. Invarian yang berlaku di KEDUA instance
 * (tiap unit DB punya entri config) tetap diuji tanpa gerbang.
 */
const LIVE_SYSTEM_ID = "7650126488674766864";

d("28 Oktober ⊥ tenant-lain cross-TENANT isolation (data nyata, fixture-free)", () => {
  let pool: Pool;
  let units: { unit_id: number; code: string; tenant_id: string | null }[];
  let ptEnergi: string | undefined;
  let ptAbadi: string | undefined;
  let o28: { unit_id: number; tenant_id: string | null } | undefined;
  let others: { unit_id: number; code: string; tenant_id: string | null }[] = [];
  let isLiveInstance = false;

  const allowed = (ctx: ScopeCtx) =>
    units.filter((u) => unitVisible(ctx, u)).map((u) => u.unit_id).sort((a, b) => a - b);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    units = (
      await pool.query(
        `SELECT unit_id, code, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    // Dua lookup TERPISAH, keduanya string eksak (`=`, bukan LIKE).
    ptEnergi = (
      await pool.query(`SELECT id FROM app.tenant WHERE slug = $1`, [SLUG_ENERGI])
    ).rows[0]?.id;
    ptAbadi = (
      await pool.query(`SELECT id FROM app.tenant WHERE slug = $1`, [SLUG_ABADI])
    ).rows[0]?.id;
    isLiveInstance =
      (
        await pool.query(`SELECT system_identifier::text AS id FROM pg_control_system()`)
      ).rows[0]?.id === LIVE_SYSTEM_ID;
    o28 = units.find((u) => u.code === CODE_28);
    // "others" = SEMUA unit tenant lain (lintas lima tenant lama), by tenant_id.
    others = o28 ? units.filter((u) => u.tenant_id !== o28!.tenant_id) : [];
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("prasyarat: 28 Oktober aktif di bawah tenant PT Sola Petra Energi ≠ tenant lain (skip jika belum ada)", (ctx) => {
    if (!o28) return ctx.skip(); // absen → SKIP eksplisit, BUKAN pass senyap
    expect(ptEnergi).toBeTruthy();
    expect(o28!.tenant_id).toBe(ptEnergi);
    expect(others.map((u) => u.unit_id)).not.toContain(o28!.unit_id);
    // Minimal satu unit tenant lain utk membuktikan isolasi (IB/Bakau/AS/KB/BL/KR).
    expect(others.length).toBeGreaterThan(0);
  });

  it("⚠️ ANTI-TABRAKAN SLUG: energi ≠ abadi, dan unit 7 TIDAK menempel tenant Abadi", (ctx) => {
    if (!o28) return ctx.skip();
    // Kedua tenant harus ADA — kalau `abadi` tak ketemu, berarti kita menguji
    // instance yang salah dan "tidak menempel Abadi" jadi benar secara hampa.
    expect(ptAbadi).toBeTruthy();
    expect(ptEnergi).toBeTruthy();
    expect(ptEnergi).not.toBe(ptAbadi);
    // Inti jebakan: unit 7 TIDAK boleh berada di tenant Abadi.
    expect(o28!.tenant_id).not.toBe(ptAbadi);
    // IB & Bakau memang milik Abadi — buktikan tenant Abadi memuat mereka
    // TAPI bukan unit 7 (bukan sekadar "unit 7 bukan Abadi" secara hampa).
    const abadiUnits = units.filter((u) => u.tenant_id === ptAbadi).map((u) => u.code);
    expect(abadiUnits).toContain("6478111");
    expect(abadiUnits).toContain("6378301");
    expect(abadiUnits).not.toContain(CODE_28);
    // Dan tenant Energi HANYA memuat unit 7.
    expect(units.filter((u) => u.tenant_id === ptEnergi).map((u) => u.code)).toEqual([CODE_28]);
  });

  it("kode POS DELAPAN digit tersimpan utuh di DB (tanpa trunkasi/pad)", (ctx) => {
    if (!o28) return ctx.skip();
    const row = units.find((u) => u.unit_id === o28!.unit_id)!;
    expect(row.code).toBe(CODE_28);
    expect(row.code).toHaveLength(8);
    // Tak ada unit lain yang kodenya prefix/suffix dari kode ini (deteksi dini
    // andai kelak ada pencocokan longgar di jalur mana pun).
    for (const u of others) {
      expect(CODE_28.startsWith(u.code)).toBe(false);
      expect(u.code.startsWith(CODE_28)).toBe(false);
    }
  });

  it("direksi tiap tenant LAIN → TIDAK melihat 28 Oktober (hanya unit tenant-nya sendiri)", (ctx) => {
    if (!o28) return ctx.skip();
    const otherTenants = [...new Set(others.map((u) => u.tenant_id))];
    for (const t of otherTenants) {
      const a = allowed({ role: "direksi", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(o28!.unit_id);
      // direksi tenant-lain tetap melihat unit-nya sendiri.
      for (const u of others.filter((x) => x.tenant_id === t)) expect(a).toContain(u.unit_id);
    }
  });

  it("direksi PT Sola Petra ABADI (IB+Bakau) → melihat IB & Bakau, TIDAK 28 Oktober", (ctx) => {
    if (!o28) return ctx.skip();
    // Uji eksplisit untuk tenant yang slug-nya nyaris sama — inilah kebocoran
    // yang paling mungkin terjadi dan paling sulit terdeteksi.
    const a = allowed({ role: "direksi", tenantId: ptAbadi!, unitScope: "ALL" });
    expect(a).not.toContain(o28!.unit_id);
    const ib = units.find((u) => u.code === "6478111")!;
    const bk = units.find((u) => u.code === "6378301")!;
    expect(a).toContain(ib.unit_id);
    expect(a).toContain(bk.unit_id);
  });

  it("admin_perusahaan tiap tenant LAIN → TIDAK melihat 28 Oktober", (ctx) => {
    if (!o28) return ctx.skip();
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      const a = allowed({ role: "admin_perusahaan", tenantId: t!, unitScope: "ALL" });
      expect(a).not.toContain(o28!.unit_id);
    }
  });

  it("direksi PT Sola Petra Energi → HANYA 28 Oktober (tanpa grant per-unit)", (ctx) => {
    if (!o28) return ctx.skip();
    const a = allowed({ role: "direksi", tenantId: ptEnergi!, unitScope: "ALL" });
    expect(a).toEqual([o28!.unit_id]);
  });

  it("pengawas[28 Oktober] → HANYA 28 Oktober; pengawas tenant lain TIDAK melihatnya", (ctx) => {
    if (!o28) return ctx.skip();
    const a = allowed({ role: "pengawas", tenantId: ptEnergi!, unitScope: [o28!.unit_id] });
    expect(a).toEqual([o28!.unit_id]);
    for (const u of others) {
      const b = allowed({ role: "pengawas", tenantId: u.tenant_id!, unitScope: [u.unit_id] });
      expect(b).not.toContain(o28!.unit_id);
    }
  });

  it("404 lintas-tenant dua arah: 28 Oktober tak terlihat viewer tenant lain, dan sebaliknya", (ctx) => {
    if (!o28) return ctx.skip();
    // Arah 1: viewer tenant lain → 28 Oktober tak terlihat (notFound(), tanpa
    // membocorkan eksistensi).
    for (const t of [...new Set(others.map((u) => u.tenant_id))]) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: t!, unitScope: "ALL" },
          { unit_id: o28!.unit_id, tenant_id: o28!.tenant_id },
        ),
      ).toBe(false);
    }
    // Arah 2: viewer 28 Oktober → unit tenant lain tak terlihat.
    for (const u of others) {
      expect(
        unitVisible(
          { role: "direksi", tenantId: ptEnergi!, unitScope: "ALL" },
          { unit_id: u.unit_id, tenant_id: u.tenant_id },
        ),
      ).toBe(false);
    }
  });

  it("super_admin → melihat semua unit (28 Oktober + semua tenant lain)", (ctx) => {
    if (!o28) return ctx.skip();
    const a = allowed({ role: "super_admin", tenantId: null, unitScope: "ALL" });
    expect(a).toContain(o28!.unit_id);
    for (const u of others) expect(a).toContain(u.unit_id);
  });

  it("tiap unit di DB punya entri config (berlaku di SEMUA instance)", (ctx) => {
    if (!o28) return ctx.skip();
    // Arah subset ini benar di live MAUPUN -rlsstg: cegah unit "yatim" yang
    // tampil tanpa PT/kop. Arah sebaliknya (tiap config punya unit) hanya benar
    // di live — diuji di test berikutnya.
    for (const u of units) expect(Object.keys(UNIT_DISPLAY)).toContain(u.code);
  });

  it("armada LENGKAP 7/7: tujuh unit aktif, enam tenant, config ⋈ DB set-equal (LIVE saja)", (ctx) => {
    if (!o28) return ctx.skip();
    // Klaim topologi ini hanya sah di instance live. `-rlsstg` memuat subset
    // sintetis (mis. unit 1 = "IB-equiv (synthetic)"), jadi menuntutnya di sana
    // = merah palsu. SKIP eksplisit, bukan pass senyap.
    if (!isLiveInstance) return ctx.skip();
    // Unit terakhir. Kalau angka ini meleset, ada unit tak terduga di instance.
    expect(units).toHaveLength(7);
    expect(new Set(units.map((u) => u.tenant_id)).size).toBe(6);
    expect(units.map((u) => u.code).sort()).toEqual(Object.keys(UNIT_DISPLAY).sort());
  });

  it("label PT ekspor: unit 28 Oktober → PT Sola Petra Energi; campuran lintas-PT → payung SolaGroup", (ctx) => {
    if (!o28) return ctx.skip();
    expect(ptLabelForUnits([CODE_28])).toBe("PT Sola Petra Energi");
    // Campuran dgn unit tenant Abadi TIDAK boleh menghasilkan nama PT mana pun.
    expect(ptLabelForUnits([CODE_28, "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits([CODE_28, "6378301"])).toBe("SolaGroup");
    expect(ptLabelForUnits([CODE_28, "6478311"])).toBe("SolaGroup");
  });
});
