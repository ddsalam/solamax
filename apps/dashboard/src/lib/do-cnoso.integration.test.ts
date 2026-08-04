import { afterAll, describe, expect, it } from "vitest";

/**
 * VERIFIKASI DB-LIVE penautan CNOSO case-insensitive — FIXTURE-FREE & READ-ONLY.
 * Menjalankan QUERY PRODUKSI (getDoHarian / getDoAnomalies / getDoSuspectSO) yang
 * sama dengan halaman terhadap Cloud SQL pilot, role read-only, RLS aktif.
 *
 * Kasusnya nyata dan terkunci: di Bundaran Kotabaru (unit 4) dua No. SO pernah
 * diketik dua casing — `020712kb`/`020712KB` dan `300712kb`/`300712KB`. EasyMax
 * menautkannya case-insensitively (laporan resmi: kedua SO lunas 32.000/32.000,
 * Volume Sisa 0; F12 Solar hanya menyisakan SO 4062677939 = 8.000 L). Postgres `=`
 * tidak, jadi tiap SO pecah dua: sisi tebus menyisakan outstanding palsu dan empat
 * penerimaan huruf-besar jatuh jadi "yatim". Hantunya persis 32.000 L.
 *
 * Angka di bawah = data 2012 yang sudah final. Yang bertanggal 2026-08-04 adalah
 * potret saat fix ini dibuat.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set (CI default skip) — jadi
 * penjaga sisi-CI-nya adalah pemindai sumber di `cnoso-keys.test.ts`, bukan ini.
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const KB = "6478106"; // Bundaran Kotabaru
const SOLAR = "BB-03";
const D = "2026-08-04";

/** Dua SO yang pecah karena casing — dilipat jadi satu oleh fix ini. */
const SPLIT_SO = ["020712kb", "300712kb"];

d("penautan CNOSO case-insensitive — live", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  async function units() {
    const { q } = await import("./db");
    return q<{ unit_id: number; code: string; name: string }>(
      `SELECT unit_id, code, name FROM public.unit ORDER BY unit_id`,
    );
  }

  it("PERLAKUAN: Sisa DO Solar KB = 8.000 L (bukan 40.000), macet lenyap", async () => {
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getDoHarian>[0];
    const kb = (await units()).find((u) => u.code === KB)!;
    const rows = await Q.getDoHarian(kb.unit_id as unknown as SUID, D);
    const solar = rows.find((r) => r.ckdbbm === SOLAR)!;
    // Sebelum fix: sisa 40.000, do_awal 48.000, sisa_macet 32.000.
    expect(solar.sisa).toBe(8_000);
    expect(solar.do_awal).toBe(16_000);
    expect(solar.sisa_macet).toBe(0);
    // Identitas tampilan: Sisa = DO Awal + Penebusan − Penerimaan + alur_selisih.
    expect(solar.do_awal + solar.penebusan - solar.penerimaan + solar.alur_selisih)
      .toBe(solar.sisa);
  }, 120_000);

  it("PERLAKUAN: penerimaan yatim Solar KB turun 32.000 L di panel Alokasi", async () => {
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getDoAnomalies>[0];
    const kb = (await units()).find((u) => u.code === KB)!;
    const rows = await Q.getDoAnomalies(kb.unit_id as unknown as SUID, D);
    const solar = rows.find((r) => r.ckdbbm === SOLAR)!;
    expect(solar.orphan).toBe(120_000); // sebelum fix: 152.000
    expect(solar.over_receipt).toBe(0);
  }, 120_000);

  it("PERLAKUAN: dua SO pecah itu hilang dari daftar SO macet KB", async () => {
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getDoSuspectSO>[0];
    const kb = (await units()).find((u) => u.code === KB)!;
    const rows = await Q.getDoSuspectSO(kb.unit_id as unknown as SUID, D);
    const hit = rows.filter((r) => SPLIT_SO.includes(r.cnoso.trim().toLowerCase()));
    expect(hit, "SO yang sudah lunas tak boleh lagi dihitung macet").toEqual([]);
  }, 120_000);

  it("KONTROL A: `231112kb` tetap nol — varian huruf besarnya sbatal=1", async () => {
    // SO ini JUGA punya varian casing, tapi baris huruf-besarnya adalah header
    // penebusan ber-sbatal=1 (BB-01 48.000) yang tersaring SEBELUM join. Kalau
    // pelipatan casing sampai menelan baris batal itu, red BB-01 jadi 96.000 dan
    // Sisa BB-01 KB melonjak 48.000 → 96.000. Nilai 48.000 = tripwire hidup.
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getDoHarian>[0];
    const kb = (await units()).find((u) => u.code === KB)!;
    const rows = await Q.getDoHarian(kb.unit_id as unknown as SUID, D);
    expect(rows.find((r) => r.ckdbbm === "BB-01")!.sisa).toBe(48_000);

    const susp = await Q.getDoSuspectSO(kb.unit_id as unknown as SUID, D);
    expect(susp.filter((r) => r.cnoso.trim().toLowerCase() === "231112kb")).toEqual([]);
  }, 120_000);

  it("KONTROL B: tak ada unit LAIN yang punya varian casing CNOSO sama sekali", async () => {
    // Fix ini hanya bisa menggeser angka pada SO yang casing-nya pernah berbeda.
    // Kalau tak ada grup ber-varian di enam unit lain, delta-nya NOL secara
    // struktural — pernyataan yang tetap sahih saat data bertambah, tak seperti
    // membekukan tujuh angka Sisa DO. Unit 4 = kontrol positif: harus 3.
    const { qScoped } = await import("./db");
    const all = (await units()).map((u) => u.unit_id);
    // qScoped, bukan q: delivery/tebus_header ber-FORCE-RLS — tanpa konteks unit
    // hasilnya NOL BARIS (fail-closed), dan kontrol positif di bawah jadi hijau-palsu.
    const rows = await qScoped<{ unit_id: number; n: string }>(
      all,
      `WITH allso AS (
         SELECT unit_id, trim(cnoso) AS c FROM public.delivery WHERE cnoso IS NOT NULL
         UNION ALL
         SELECT unit_id, trim(cnoso) FROM public.tebus_header WHERE cnoso IS NOT NULL
       )
       SELECT unit_id, count(*)::text AS n
       FROM (SELECT unit_id, lower(c) FROM allso GROUP BY 1, 2
             HAVING count(DISTINCT c) > 1) x
       GROUP BY 1 ORDER BY 1`,
    );
    const byUnit = new Map(rows.map((r) => [r.unit_id, Number(r.n)]));
    const kb = (await units()).find((u) => u.code === KB)!;
    expect(byUnit.get(kb.unit_id), "kontrol positif: KB memang punya 3").toBe(3);
    for (const u of await units()) {
      if (u.unit_id === kb.unit_id) continue;
      expect(byUnit.get(u.unit_id) ?? 0, `${u.name} tak boleh punya varian casing`).toBe(0);
    }
  }, 120_000);

  it("TAMPILAN: nomor SO yang dirender tetap ejaan sumbernya, di semua unit", async () => {
    // Kunci di-normalisasi, nilai TAMPILAN tidak: getDoSuspectSO merender cnoso ke
    // layar dan PDF. Setiap nomor yang tampil harus benar-benar ada di tebus_header
    // dengan ejaan itu persis — bukan hasil lower() yang me-recase SO sehat.
    const Q = await import("./queries");
    const { qScoped } = await import("./db");
    type SUID = Parameters<typeof Q.getDoSuspectSO>[0];
    let checked = 0;
    for (const u of await units()) {
      const shown = (await Q.getDoSuspectSO(u.unit_id as unknown as SUID, D)).map(
        (r) => r.cnoso,
      );
      if (!shown.length) continue;
      // Satu query per unit (bukan per baris): nomor mana yang TIDAK ada persis
      // begitu di tebus_header. Kosong = semua ejaan tampilan setia ke sumber.
      const missing = await qScoped<{ c: string }>(
        u.unit_id,
        `SELECT s.c FROM unnest($2::text[]) AS s(c)
         WHERE NOT EXISTS (SELECT 1 FROM public.tebus_header h
                           WHERE h.unit_id = $1 AND trim(h.cnoso) = s.c)`,
        [u.unit_id, shown],
      );
      expect(
        missing.map((r) => r.c),
        `${u.name}: nomor SO ini tak ada persis di tebus_header (ter-recase?)`,
      ).toEqual([]);
      checked += shown.length;
    }
    expect(checked, "harus benar-benar memeriksa baris, bukan nol").toBeGreaterThan(0);
  }, 300_000);

  it("HISTORIS: DO Awal ikut benar pada hari penerimaan huruf-besar mendarat", async () => {
    // 2012-07-31 mendarat 8030062842 & 8030062843, 2012-08-01 mendarat 8030062847 —
    // ketiganya ber-CNOSO `300712KB`. Sebelum fix ketiganya jatuh ke SO yatim, jadi
    // TIDAK menurunkan Sisa; `alur_selisih` yang positif adalah sidik jarinya.
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getDoHarian>[0];
    const kb = (await units()).find((u) => u.code === KB)!;
    const at = async (date: string) =>
      (await Q.getDoHarian(kb.unit_id as unknown as SUID, date)).find(
        (r) => r.ckdbbm === SOLAR,
      )!;

    const a = await at("2012-07-31"); // sebelum: awal 40.000, sisa 40.000, alur 16.000
    expect([a.do_awal, a.sisa, a.alur_selisih]).toEqual([32_000, 16_000, 0]);

    const b = await at("2012-08-01"); // sebelum: awal 40.000, sisa 72.000, alur 16.000
    expect([b.do_awal, b.sisa, b.alur_selisih]).toEqual([16_000, 40_000, 8_000]);

    // Rantai harian nyambung: DO Awal hari-D = Sisa hari D−1.
    expect(b.do_awal).toBe(a.sisa);
  }, 120_000);
});
