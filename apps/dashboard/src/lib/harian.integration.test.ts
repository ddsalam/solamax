import { afterAll, describe, expect, it } from "vitest";

/**
 * VERIFIKASI DB-LIVE Laporan Harian — FIXTURE-FREE & READ-ONLY.
 * Menjalankan QUERY + MODEL PRODUKSI yang sama dengan halaman terhadap Cloud SQL
 * (role dashboard_app, RLS aktif via qScoped) dan membuktikan:
 *
 *  (1) INVARIAN UNION-SPAN — dasar keputusan "satu jendela G/L per unit": baris
 *      G/L hari-D dari jendela [D..D] IDENTIK dengan baris hari-D dari jendela
 *      [awal bulan..D]. Halaman memfilter seksi harian dari jendela MTD, jadi
 *      kalau invarian ini gugur seluruh seksi G/L harian salah. Diuji SENDIRI di
 *      sini — TIDAK menumpang board-live.integration.test.ts.
 *  (2) TOTAL model == getSalesTotals per unit (jalur angka penjualan).
 *  (3) RBAC lapis-data: grain multi-unit tak pernah memuat unit di luar daftar
 *      ScopedUnitId, dan TOTAL model 1-unit = unit itu saja.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set (CI default skip).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

// Tanggal FINAL (historis, penutup sudah masuk) — bukan hari berjalan.
const DATE = "2026-07-22";
const MONTH_FROM = "2026-07-01";

d("laporan harian — live", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it(
    "INVARIAN: baris G/L hari-D identik dari jendela [D..D] dan [awal bulan..D]",
    async (ctx) => {
      const Q = await import("./queries");
      const { q } = await import("./db");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
      const units = await q<{ unit_id: number; code: string }>(
        `SELECT unit_id, code FROM public.unit WHERE active ORDER BY unit_id`,
      );
      // Guard absen WAJIB ctx.skip() — `return` senyap dilaporkan vitest sebagai
      // PASS dgn nol assertion, sehingga "unit tak ada" tak terbedakan dari
      // "invarian terverifikasi".
      if (units.length === 0) return ctx.skip();

      for (const u of units) {
        const uid = u.unit_id as unknown as SUID;
        const [narrow, wide] = await Promise.all([
          Q.getDailyGlByProduct(uid, DATE, DATE),
          Q.getDailyGlByProduct(uid, MONTH_FROM, DATE),
        ]);
        const wideD = wide.filter((r) => r.d === DATE);
        expect(wideD.length, `jml baris hari-D unit ${u.code}`).toBe(narrow.length);
        const byKey = new Map(narrow.map((r) => [r.ckdbbm, r]));
        for (const r of wideD) {
          const n = byKey.get(r.ckdbbm);
          expect(n, `produk ${r.ckdbbm} unit ${u.code}`).toBeTruthy();
          if (r.gl === null) expect(n!.gl).toBeNull();
          else expect(n!.gl!).toBeCloseTo(r.gl, 6);
          expect(n!.provisional).toBe(r.provisional);
          expect(n!.fisik ?? -1).toBeCloseTo(r.fisik ?? -1, 6);
        }
      }
    },
    { timeout: 600_000 },
  );

  it(
    "TOTAL model per unit == getSalesTotals",
    async (ctx) => {
      const Q = await import("./queries");
      const { q } = await import("./db");
      const { buildHarianModel, harianSpanFrom } = await import("./harian-model");
      const { FLEET_RECORD_FLOOR } = await import("./config");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];

      const rows = await q<{ unit_id: number; code: string; name: string }>(
        `SELECT unit_id, code, name FROM public.unit WHERE active ORDER BY unit_id`,
      );
      if (rows.length === 0) return ctx.skip();
      const units = rows.map((u) => ({ unit_id: u.unit_id as SUID, code: u.code, name: u.name }));
      const ids = units.map((u) => u.unit_id);

      const [dailySales, coverage, sync] = await Promise.all([
        Q.getDailySalesByProduct(ids, harianSpanFrom(DATE, FLEET_RECORD_FLOOR), DATE),
        Q.getUnitCoverage(ids),
        Q.getSyncByUnit(ids),
      ]);
      const model = buildHarianModel({
        units,
        date: DATE,
        dailySales,
        gl: new Map(),
        coverage,
        sync,
        recordFloor: FLEET_RECORD_FLOOR,
      });

      for (const u of units) {
        const t = await Q.getSalesTotals(u.unit_id, DATE, DATE);
        expect(model.daily.totalsByUnit[u.unit_id as number]!, `harian ${u.code}`).toBeCloseTo(t.vol, 3);
        const mtd = await Q.getSalesTotals(u.unit_id, MONTH_FROM, DATE);
        expect(model.monthly.totalsByUnit[u.unit_id as number]!.kum, `MTD ${u.code}`).toBeCloseTo(mtd.vol, 3);
      }
      // TOTAL grup = Σ per unit (tak ada jalur terpisah yang bisa menyimpang).
      const sum = units.reduce((s, u) => s + model.daily.totalsByUnit[u.unit_id as number]!, 0);
      expect(model.daily.grandTotal).toBeCloseTo(sum, 3);
    },
    { timeout: 600_000 },
  );

  it(
    "RBAC lapis-data: scope 1 unit → 1 kolom, TOTAL = unit itu saja",
    async (ctx) => {
      const Q = await import("./queries");
      const { q } = await import("./db");
      const { buildHarianModel, harianSpanFrom } = await import("./harian-model");
      const { FLEET_RECORD_FLOOR } = await import("./config");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];

      const rows = await q<{ unit_id: number; code: string; name: string }>(
        `SELECT unit_id, code, name FROM public.unit WHERE active ORDER BY unit_id LIMIT 1`,
      );
      if (rows.length === 0) return ctx.skip();
      const one = rows.map((u) => ({ unit_id: u.unit_id as SUID, code: u.code, name: u.name }));
      const ids = one.map((u) => u.unit_id);

      const dailySales = await Q.getDailySalesByProduct(
        ids,
        harianSpanFrom(DATE, FLEET_RECORD_FLOOR),
        DATE,
      );
      // Lapis DB: grain TIDAK boleh memuat unit lain sama sekali.
      const foreign = dailySales.filter((r) => r.unit_id !== (one[0]!.unit_id as number));
      expect(foreign, "baris unit asing dalam grain ber-scope").toEqual([]);

      const model = buildHarianModel({
        units: one,
        date: DATE,
        dailySales,
        gl: new Map(),
        coverage: await Q.getUnitCoverage(ids),
        sync: await Q.getSyncByUnit(ids),
        recordFloor: FLEET_RECORD_FLOOR,
      });
      expect(model.units).toHaveLength(1);
      expect(model.daily.grandTotal).toBeCloseTo(
        model.daily.totalsByUnit[one[0]!.unit_id as number]!,
        6,
      );
      // Rekor pun hanya melihat unit itu.
      expect(model.record.total).toBeCloseTo(
        Object.values(model.record.byUnit).reduce((a, b) => a + b, 0),
        6,
      );
    },
    { timeout: 600_000 },
  );
});
