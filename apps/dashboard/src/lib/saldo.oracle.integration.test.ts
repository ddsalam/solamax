import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { ScopedUnitId } from "./scope-rule";

/**
 * KUNCI ORACLE — Saldo Piutang/Hutang 28 Oktober vs laporan EasyMax asli.
 *
 * Sumber kebenaran: "DAFTAR SALDO HUTANG PIUTANG" unit 28 Oktober (63781002),
 * diekspor dari EasyMax untuk 2, 3, dan 4 Agustus 2026. Total per seksi diparse
 * ulang secara independen dari ketiga .xlsx (Σ DEBET − Σ KREDIT, termasuk
 * pelanggan bersaldo negatif) — lihat
 * session-notes/2026-08-05-saldo-hutang-piutang-28oktober.md §0.
 *
 * Laporan itu memakai saldo **AKHIR hari**, jadi yang dicocokkan adalah `akhir`.
 * `awal` diuji secara relasional: saldo awal hari D ≡ saldo akhir hari D−1.
 *
 * Menjalankan implementasi SEBENARNYA (`getSaldoPelanggan` → `qScoped` → RLS),
 * bukan menyalin SQL-nya — supaya perubahan pada query benar-benar tertangkap.
 *
 * Jalan hanya bila SALDO_LIVE_DB=1 & DATABASE_URL di-set DAN unit 28 Oktober ada
 * beserta datanya. Bila tidak, tiap test melapor **SKIP eksplisit** (`ctx.skip()`),
 * BUKAN `return` senyap — return senyap dilaporkan vitest sebagai ✓ PASS dengan
 * nol assertion, yang membuat "data tak ada" tak bisa dibedakan dari "terverifikasi".
 */
const LIVE = process.env.SALDO_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const UNIT_28 = 7 as unknown as ScopedUnitId; // 63781002 — unit_id di solamax-pg
const CODE_28 = "63781002";

/** Oracle: total per seksi, per tanggal (rupiah bulat). */
const ORACLE = {
  "2026-08-02": { piutangLokal: 12_033_038_039, piutangOnline: 10_796_518, hutangLokal: 149_332_330 },
  "2026-08-03": { piutangLokal: 12_117_420_938, piutangOnline: 10_796_518, hutangLokal: 140_919_652 },
  "2026-08-04": { piutangLokal: 12_239_110_739, piutangOnline: 10_796_518, hutangLokal: 123_526_169 },
} as const;

const pool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
afterAll(async () => {
  await pool?.end();
});

/**
 * `./queries` → `./db` membuat Pool saat modul dievaluasi dan MELEMPAR bila
 * DATABASE_URL kosong. Import statis akan menggagalkan seluruh berkas ini di CI
 * (di mana test memang seharusnya SKIP), jadi modulnya dimuat saat test jalan.
 */
const loadQueries = () => import("./queries");

/** Unit 28 Oktober ada DAN ledgernya terisi? (kalau tidak, SKIP, bukan PASS) */
async function ready(): Promise<boolean> {
  if (!pool) return false;
  const u = await pool.query("SELECT unit_id FROM public.unit WHERE code = $1", [CODE_28]);
  if (u.rowCount !== 1 || u.rows[0].unit_id !== 7) return false;
  const c = await pool.query(
    `SELECT count(*)::int AS n FROM public.bppiut
      WHERE unit_id = 7 AND dtgl <= '2026-08-04'::date`,
  );
  return (c.rows[0]?.n ?? 0) > 0;
}

d("Saldo 28 Oktober — 9 sel vs oracle EasyMax", () => {
  for (const [date, want] of Object.entries(ORACLE)) {
    it(`${date}: ketiga baris EKSAK (saldo akhir hari)`, async (ctx) => {
      if (!(await ready())) ctx.skip();
      const { getSaldoPelanggan } = await loadQueries();
      const got = await getSaldoPelanggan(UNIT_28, date);
      expect(got.akhir).toEqual(want);
    });
  }

  it("KONTROL — oracle yang digeser satu hari HARUS gagal", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Tanpa kontrol ini, "cocok" tak membuktikan apa pun: kalau assertion di atas
    // toleran (mis. pembulatan longgar), ia akan cocok juga dengan angka yang salah.
    const { getSaldoPelanggan } = await loadQueries();
    const got = await getSaldoPelanggan(UNIT_28, "2026-08-03");
    expect(got.akhir).not.toEqual(ORACLE["2026-08-02"]);
    expect(got.akhir).not.toEqual(ORACLE["2026-08-04"]);
  });

  it("saldo AWAL hari D ≡ saldo AKHIR hari D−1", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Inilah invarian yang dulu bikin salah paham: nilai lama SolaMax untuk D
    // sebenarnya benar — tapi untuk D−1. Sekarang keduanya tampil berlabel.
    const { getSaldoPelanggan } = await loadQueries();
    for (const [prev, next] of [
      ["2026-08-02", "2026-08-03"],
      ["2026-08-03", "2026-08-04"],
    ] as const) {
      const a = await getSaldoPelanggan(UNIT_28, prev);
      const b = await getSaldoPelanggan(UNIT_28, next);
      expect(b.awal).toEqual(a.akhir);
    }
  });

  it("HERWIN (21.999.0014, SJENIS 4, bertitik) IKUT di Piutang Online", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Regresi nyata yang memicu investigasi ini: filter `sjenis = 3` membuangnya
    // dan Online kurang Rp36.084 setiap hari. Dibuktikan dari data, bukan diasumsikan.
    const { getSaldoPelanggan } = await loadQueries();
    const r = await pool!.query(
      `SELECT COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END),0)::float8 AS net
         FROM public.bppiut b
        WHERE b.unit_id = 7 AND COALESCE(b.sbatal,0) = 0
          AND trim(b.ckdplg) = '21.999.0014' AND b.dtgl <= '2026-08-04'::date`,
    );
    expect(r.rows[0].net).toBe(36_084); // kontrol: pelanggannya memang bersaldo
    const got = await getSaldoPelanggan(UNIT_28, "2026-08-04");
    expect(got.akhir.piutangOnline).toBe(ORACLE["2026-08-04"].piutangOnline);
    // dan tanpa dia, angkanya meleset persis sebesar saldonya
    expect(got.akhir.piutangOnline - 36_084).not.toBe(ORACLE["2026-08-04"].piutangOnline);
  });
});
