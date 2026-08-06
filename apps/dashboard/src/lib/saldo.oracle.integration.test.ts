import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { ScopedUnitId } from "./scope-rule";

/**
 * KUNCI ORACLE — Saldo Piutang/Hutang vs laporan EasyMax asli, DUA unit.
 *
 * Sumber kebenaran: **"DAFTAR SALDO HUTANG PIUTANG"** — dan HANYA laporan itu.
 * Bukan "Laporan Penjualan Harian": kedua laporan berbeda definisi (saldo awal vs
 * akhir hari), dan mencampurnya adalah akar seluruh kebingungan sesi 2026-08-05/06
 * (lihat catatan "oracle yang tak setara" di probe.ts:SALDO_EXPECTED, sudah dipensiunkan).
 *
 *   - 28 Oktober (unit 7) — 2–4 Agustus 2026, 3 tanggal × 3 baris = 9 sel
 *   - Imam Bonjol (unit 1) — 1–5 Agustus 2026, 5 tanggal × 3 baris = 15 sel
 *
 * Total per seksi diparse ulang secara independen dari tiap .xlsx (Σ DEBET − Σ KREDIT,
 * termasuk pelanggan bersaldo negatif) dan dicocok-silang ke baris `TOTAL SALDO …`
 * serta blok `Summary` di dalam berkas — tiga sumber, semuanya sepakat.
 *
 * Laporan ini memakai saldo **AKHIR hari**, jadi yang dicocokkan `akhir`.
 * `awal` diuji relasional: saldo awal hari D ≡ saldo akhir hari D−1.
 *
 * Menjalankan implementasi SEBENARNYA (`getSaldoPelanggan` → `qScoped` → RLS),
 * bukan menyalin SQL-nya — supaya perubahan pada query benar-benar tertangkap.
 *
 * Jalan hanya bila SALDO_LIVE_DB=1 & DATABASE_URL di-set DAN unitnya ada beserta
 * datanya. Bila tidak, tiap test melapor **SKIP eksplisit** (`ctx.skip()`), BUKAN
 * `return` senyap — return senyap dilaporkan vitest sebagai ✓ PASS dengan nol
 * assertion, yang membuat "data tak ada" tak bisa dibedakan dari "terverifikasi".
 */
const LIVE = process.env.SALDO_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

type Trio = { piutangLokal: number; piutangOnline: number; hutangLokal: number };

const UNIT_28 = 7;
const UNIT_IB = 1;

/** Oracle per unit: total per seksi, per tanggal — SAAT BERKAS DIEKSPOR. */
const ORACLE: Record<number, { code: string; nama: string; oracle: Record<string, Trio> }> = {
  [UNIT_28]: {
    code: "63781002",
    nama: "28 Oktober",
    oracle: {
      "2026-08-02": { piutangLokal: 12_033_038_039, piutangOnline: 10_796_518, hutangLokal: 149_332_330 },
      "2026-08-03": { piutangLokal: 12_117_420_938, piutangOnline: 10_796_518, hutangLokal: 140_919_652 },
      "2026-08-04": { piutangLokal: 12_239_110_739, piutangOnline: 10_796_518, hutangLokal: 123_526_169 },
    },
  },
  [UNIT_IB]: {
    code: "6478111",
    nama: "Imam Bonjol",
    // Hutang IB NEGATIF (28 Oktober positif) — formula yang sama harus menghasilkan
    // keduanya tanpa perlakuan khusus; tanda mengikuti data.
    oracle: {
      "2026-08-01": { piutangLokal: 35_377_538_927, piutangOnline: 1_200_000, hutangLokal: -770_002_380 },
      "2026-08-02": { piutangLokal: 35_476_850_395, piutangOnline: 1_200_000, hutangLokal: -735_869_634 },
      "2026-08-03": { piutangLokal: 35_563_341_030, piutangOnline: 1_200_000, hutangLokal: -734_439_355 },
      "2026-08-04": { piutangLokal: 35_687_985_717, piutangOnline: 1_200_000, hutangLokal: -751_284_145 },
      "2026-08-05": { piutangLokal: 35_770_675_661, piutangOnline: 1_200_000, hutangLokal: -707_071_775 },
    },
  },
};

/**
 * KOREKSI PASCA-EKSPOR — ledger bergerak setelah oracle dicetak; itu normal.
 *
 * Pagi 2026-08-06 (09:23 WIB) pengawas 28 Oktober memperbaiki satu posting
 * ber-tanggal 04-08: EasyMax membatalkan 5 posting asli + 5 baris pembalik
 * (`SBATAL=1`), lalu memasang 5 posting pengganti. Empat pelanggan nilainya sama;
 * **PLG0831 naik 30.081.000 → 30.685.500 = +604.500**.
 *
 * Angka koreksi di bawah TIDAK boleh sekadar "faktor pengepas": test terpisah
 * menuntut baris-baris ber-ID ini benar-benar ada di ledger dengan status &
 * nominal yang disebut. Mengarang koreksi agar hijau akan MERAH di test itu.
 */
const KOREKSI: Record<number, Record<string, Partial<Trio>>> = {
  [UNIT_28]: { "2026-08-04": { piutangLokal: 604_500 } },
  [UNIT_IB]: {},
};

const AUDIT_04_08 = {
  dibatalkan: ["PP2026080400100", "PP2026080400105", "PP2026080400106", "PP2026080400107", "PP2026080400108"],
  pengganti: ["PP2026080400110", "PP2026080400115", "PP2026080400116", "PP2026080400117", "PP2026080400118"],
} as const;

function expected(unit: number, date: string): Trio {
  const o = ORACLE[unit]!.oracle[date]!;
  const k = KOREKSI[unit]?.[date];
  return k ? { ...o, ...Object.fromEntries(Object.entries(k).map(([f, v]) => [f, o[f as keyof Trio] + v!])) } : o;
}

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

/**
 * Query di bawah RLS: tabelnya ber-policy FORCE, jadi TANPA GUC `app.unit_ids`
 * hasilnya **0 baris, bukan error** — tak bisa dibedakan dari "tidak ada data".
 * Formatnya daftar polos (`7`), BUKAN literal array (`{7}`): policy mem-split
 * pada koma lalu menyaring regex `^-?[0-9]+$`, sehingga `{7}` gugur jadi nol.
 */
async function scoped<T extends object>(unit: number, sql: string): Promise<T[]> {
  const c = await pool!.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit)]);
    const r = await c.query(sql);
    await c.query("COMMIT");
    return r.rows as T[];
  } finally {
    c.release();
  }
}

/** Unitnya ada DAN ledgernya terisi? (kalau tidak, SKIP, bukan PASS) */
async function ready(unit: number): Promise<boolean> {
  if (!pool) return false;
  const { code } = ORACLE[unit]!;
  const u = await pool.query("SELECT unit_id FROM public.unit WHERE code = $1", [code]);
  if (u.rowCount !== 1 || u.rows[0].unit_id !== unit) return false;
  const c = await scoped<{ n: number }>(
    unit,
    `SELECT count(*)::int AS n FROM public.bppiut WHERE unit_id = ${unit}`,
  );
  return (c[0]?.n ?? 0) > 0;
}

for (const unit of [UNIT_28, UNIT_IB]) {
  const { nama, oracle } = ORACLE[unit]!;
  const dates = Object.keys(oracle);

  d(`Saldo ${nama} (unit ${unit}) — ${dates.length * 3} sel vs oracle EasyMax`, () => {
    for (const date of dates) {
      it(`${date}: ketiga baris EKSAK (saldo akhir hari)`, async (ctx) => {
        if (!(await ready(unit))) ctx.skip();
        const { getSaldoPelanggan } = await loadQueries();
        const got = await getSaldoPelanggan(unit as unknown as ScopedUnitId, date);
        expect(got.akhir).toEqual(expected(unit, date));
      });
    }

    it("KONTROL — oracle tanggal lain HARUS tidak cocok", async (ctx) => {
      if (!(await ready(unit))) ctx.skip();
      // Tanpa kontrol ini, "cocok" tak membuktikan apa pun: assertion yang toleran
      // akan cocok juga dengan angka tanggal sebelahnya.
      const { getSaldoPelanggan } = await loadQueries();
      const got = await getSaldoPelanggan(unit as unknown as ScopedUnitId, dates[1]!);
      expect(got.akhir).not.toEqual(expected(unit, dates[0]!));
      expect(got.akhir).not.toEqual(expected(unit, dates[2]!));
    }, 30_000);

    // Timeout dinaikkan: tiap panggilan menyentuh DB live (~0,9–2 dtk) dan IB
    // memakai 5 tanggal → 8 query. Default 5 dtk membuatnya gagal karena WAKTU,
    // bukan karena angka — kegagalan yang menyamar sebagai temuan.
    it(
      "saldo AWAL hari D ≡ saldo AKHIR hari D−1",
      async (ctx) => {
        if (!(await ready(unit))) ctx.skip();
        // Invarian yang dulu bikin salah paham: nilai lama SolaMax untuk D sebenarnya
        // benar — tapi untuk D−1. Sekarang keduanya tampil berlabel.
        const { getSaldoPelanggan } = await loadQueries();
        for (let i = 1; i < dates.length; i++) {
          const a = await getSaldoPelanggan(unit as unknown as ScopedUnitId, dates[i - 1]!);
          const b = await getSaldoPelanggan(unit as unknown as ScopedUnitId, dates[i]!);
          expect(b.awal).toEqual(a.akhir);
        }
      },
      60_000,
    );
  });
}

d("28 Oktober — jejak koreksi pasca-ekspor", () => {
  it("KOREKSI 04-08 nyata di ledger, bukan faktor pengepas", async (ctx) => {
    if (!(await ready(UNIT_28))) ctx.skip();
    // Pagar terhadap godaan menaikkan KOREKSI sampai test hijau: baris-barisnya
    // harus benar-benar ada, dgn status & selisih yang disebut.
    const rows = await scoped<{ ckdbppiut: string; sbatal: number; njumlah: string }>(
      UNIT_28,
      `SELECT ckdbppiut, COALESCE(sbatal,0) AS sbatal, njumlah::text
         FROM public.bppiut
        WHERE unit_id = 7 AND ckdbppiut IN (${[...AUDIT_04_08.dibatalkan, ...AUDIT_04_08.pengganti]
          .map((id) => `'${id}'`)
          .join(",")})`,
    );
    expect(rows).toHaveLength(10);
    const by = new Map(rows.map((r) => [r.ckdbppiut.trim(), r]));
    for (const id of AUDIT_04_08.dibatalkan) expect(by.get(id)!.sbatal).toBe(1);
    for (const id of AUDIT_04_08.pengganti) expect(by.get(id)!.sbatal).toBe(0);
    const sum = (ids: readonly string[]) => ids.reduce((s, id) => s + Number(by.get(id)!.njumlah), 0);
    expect(sum(AUDIT_04_08.pengganti) - sum(AUDIT_04_08.dibatalkan)).toBe(604_500);
  });

  it("REKONSTRUKSI: buang koreksi → mendarat tepat di oracle asli", async (ctx) => {
    if (!(await ready(UNIT_28))) ctx.skip();
    const { getSaldoPelanggan } = await loadQueries();
    const live = await getSaldoPelanggan(UNIT_28 as unknown as ScopedUnitId, "2026-08-04");
    expect(live.akhir.piutangLokal - 604_500).toBe(ORACLE[UNIT_28]!.oracle["2026-08-04"]!.piutangLokal);
  });

  it("HERWIN (21.999.0014, SJENIS 4, bertitik) IKUT di Piutang Online", async (ctx) => {
    if (!(await ready(UNIT_28))) ctx.skip();
    // Regresi nyata pemicu investigasi: filter `sjenis = 3` membuangnya dan Online
    // kurang Rp36.084 setiap hari. Dibuktikan dari data, bukan diasumsikan.
    const { getSaldoPelanggan } = await loadQueries();
    const r = await scoped<{ net: number }>(
      UNIT_28,
      `SELECT COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END),0)::float8 AS net
         FROM public.bppiut b
        WHERE b.unit_id = 7 AND COALESCE(b.sbatal,0) = 0
          AND trim(b.ckdplg) = '21.999.0014' AND b.dtgl <= '2026-08-04'::date`,
    );
    expect(r[0]!.net).toBe(36_084); // kontrol: pelanggannya memang bersaldo
    const got = await getSaldoPelanggan(UNIT_28 as unknown as ScopedUnitId, "2026-08-04");
    expect(got.akhir.piutangOnline).toBe(10_796_518);
    expect(got.akhir.piutangOnline - 36_084).not.toBe(10_796_518);
  });
});

d("Imam Bonjol — jalur yang TIDAK tereksekusi di 28 Oktober", () => {
  it("KREDIT pada bucket Online ikut dihitung (28 Oktober kreditnya nol)", async (ctx) => {
    if (!(await ready(UNIT_IB))) ctx.skip();
    // Online IB: debet 10.505.841 − kredit 9.305.841 = 1.200.000. Kalau `sjnsbp=2`
    // diabaikan pada bucket Online, hasilnya jadi 10.505.841 — bukan 1.200.000.
    const r = await scoped<{ debet: number; kredit: number }>(
      UNIT_IB,
      `SELECT COALESCE(sum(njumlah) FILTER (WHERE sjnsbp = 1),0)::float8 AS debet,
              COALESCE(sum(njumlah) FILTER (WHERE sjnsbp = 2),0)::float8 AS kredit
         FROM public.bppiut
        WHERE unit_id = 1 AND COALESCE(sbatal,0) = 0
          AND position('.' in trim(ckdplg)) > 0 AND dtgl <= '2026-08-01'::date`,
    );
    expect(r[0]!.debet).toBe(10_505_841);
    expect(r[0]!.kredit).toBe(9_305_841); // kontrol: jalur kredit memang ada isinya
    const { getSaldoPelanggan } = await loadQueries();
    const got = await getSaldoPelanggan(UNIT_IB as unknown as ScopedUnitId, "2026-08-01");
    expect(got.akhir.piutangOnline).toBe(1_200_000);
    expect(got.akhir.piutangOnline).not.toBe(10_505_841); // yakni kredit TIDAK diabaikan
  });

  it("pecahan ½ rupiah tetap eksak, dan totalnya bulat", async (ctx) => {
    if (!(await ready(UNIT_IB))) ctx.skip();
    // Hutang IB memuat 4 pelanggan bernilai `,5`; pecahannya saling meniadakan
    // sehingga TOTAL-nya bulat. 28 Oktober seluruhnya bulat → jalur ini tak pernah
    // teruji di sana. Kalau muncul ±0,5 atau ±1, itu bukan "pembulatan kecil".
    const rows = await scoped<{ ckdplg: string; net: number }>(
      UNIT_IB,
      `SELECT trim(ckdplg) AS ckdplg,
              (-(sum(njumlah * CASE sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END)))::float8 AS net
         FROM public.bphut
        WHERE unit_id = 1 AND COALESCE(sbatal,0) = 0 AND dtgl <= '2026-08-01'::date
          AND trim(ckdplg) IN ('PLG2067','PLG2068','PLG2069','PLG2249')
        GROUP BY 1 ORDER BY 1`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.ckdplg, r.net]))).toEqual({
      PLG2067: -653_265.5,
      PLG2068: -6_622_022.5,
      PLG2069: -21_516_390.5,
      PLG2249: 4_100_949.5,
    });
    // kontrol: nilai-nilai itu memang BUKAN bilangan bulat
    for (const r of rows) expect(Number.isInteger(r.net)).toBe(false);

    const { getSaldoPelanggan } = await loadQueries();
    const got = await getSaldoPelanggan(UNIT_IB as unknown as ScopedUnitId, "2026-08-01");
    expect(got.akhir.hutangLokal).toBe(-770_002_380);
    expect(Number.isInteger(got.akhir.hutangLokal)).toBe(true);
  });

  it("tanda Hutang mengikuti data: IB negatif, 28 Oktober positif", async (ctx) => {
    if (!(await ready(UNIT_IB)) || !(await ready(UNIT_28))) ctx.skip();
    const { getSaldoPelanggan } = await loadQueries();
    const ib = await getSaldoPelanggan(UNIT_IB as unknown as ScopedUnitId, "2026-08-04");
    const o28 = await getSaldoPelanggan(UNIT_28 as unknown as ScopedUnitId, "2026-08-04");
    expect(ib.akhir.hutangLokal).toBeLessThan(0);
    expect(o28.akhir.hutangLokal).toBeGreaterThan(0);
  }, 60_000);
});
