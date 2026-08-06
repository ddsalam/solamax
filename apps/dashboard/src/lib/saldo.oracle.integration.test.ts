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

/** Oracle: total per seksi, per tanggal (rupiah bulat) — SAAT BERKAS DIEKSPOR. */
const ORACLE = {
  "2026-08-02": { piutangLokal: 12_033_038_039, piutangOnline: 10_796_518, hutangLokal: 149_332_330 },
  "2026-08-03": { piutangLokal: 12_117_420_938, piutangOnline: 10_796_518, hutangLokal: 140_919_652 },
  "2026-08-04": { piutangLokal: 12_239_110_739, piutangOnline: 10_796_518, hutangLokal: 123_526_169 },
} as const;

/**
 * KOREKSI PASCA-EKSPOR — ledger bergerak setelah oracle dicetak; itu normal.
 *
 * Pagi 2026-08-06 (09:23 WIB) pengawas 28 Oktober memperbaiki satu posting
 * ber-tanggal 04-08: EasyMax membatalkan 5 posting asli + 5 baris pembalik
 * (`SBATAL=1`), lalu memasang 5 posting pengganti. Empat pelanggan nilainya
 * sama; **PLG0831 naik 30.081.000 → 30.685.500 = +604.500**.
 *
 * Jadi angka SolaMax untuk 04-08 kini **12.239.715.239** — dan itu BENAR;
 * berkas oracle-lah yang mendahului koreksi. Dibuktikan dengan rekonstruksi:
 * (saldo sekarang − 5 repost + 5 posting asli) = 12.239.110.739 = oracle, selisih 0.
 *
 * Angka koreksi di bawah TIDAK boleh sekadar "faktor pengepas": test terpisah
 * menuntut baris-baris ber-ID ini benar-benar ada di ledger dengan status &
 * nominal yang disebut. Mengarang koreksi agar hijau akan MERAH di test itu.
 */
const KOREKSI_PASCA_EKSPOR = {
  "2026-08-04": { piutangLokal: 604_500 },
} as const;

/** ID posting asli yang dibatalkan (SBATAL=1) dan penggantinya (SBATAL=0). */
const AUDIT_04_08 = {
  dibatalkan: [
    "PP2026080400100", "PP2026080400105", "PP2026080400106",
    "PP2026080400107", "PP2026080400108",
  ],
  pengganti: [
    "PP2026080400110", "PP2026080400115", "PP2026080400116",
    "PP2026080400117", "PP2026080400118",
  ],
} as const;

/** Nilai yang harus tampil hari ini = oracle + koreksi terdokumentasi. */
function expected(date: keyof typeof ORACLE) {
  const o = ORACLE[date];
  const k = (KOREKSI_PASCA_EKSPOR as Record<string, { piutangLokal: number }>)[date];
  return k ? { ...o, piutangLokal: o.piutangLokal + k.piutangLokal } : o;
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
 * Query di bawah RLS: `bppiut` ber-policy FORCE, jadi TANPA GUC `app.unit_ids`
 * hasilnya **0 baris, bukan error** — tak bisa dibedakan dari "tidak ada data".
 * Formatnya daftar polos (`7`), BUKAN literal array (`{7}`): policy mem-split
 * pada koma lalu menyaring regex `^-?[0-9]+$`, sehingga `{7}` gugur jadi nol.
 */
async function scoped<T extends object>(sql: string): Promise<T[]> {
  const c = await pool!.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.unit_ids', '7', true)");
    const r = await c.query(sql);
    await c.query("COMMIT");
    return r.rows as T[];
  } finally {
    c.release();
  }
}

/** Unit 28 Oktober ada DAN ledgernya terisi? (kalau tidak, SKIP, bukan PASS) */
async function ready(): Promise<boolean> {
  if (!pool) return false;
  const u = await pool.query("SELECT unit_id FROM public.unit WHERE code = $1", [CODE_28]);
  if (u.rowCount !== 1 || u.rows[0].unit_id !== 7) return false;
  const c = await scoped<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.bppiut
      WHERE unit_id = 7 AND dtgl <= '2026-08-04'::date`,
  );
  return (c[0]?.n ?? 0) > 0;
}

d("Saldo 28 Oktober — 9 sel vs oracle EasyMax", () => {
  for (const date of Object.keys(ORACLE) as (keyof typeof ORACLE)[]) {
    it(`${date}: ketiga baris EKSAK (saldo akhir hari)`, async (ctx) => {
      if (!(await ready())) ctx.skip();
      const { getSaldoPelanggan } = await loadQueries();
      const got = await getSaldoPelanggan(UNIT_28, date);
      expect(got.akhir).toEqual(expected(date));
    });
  }

  it("KOREKSI 04-08 nyata di ledger, bukan faktor pengepas", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Pagar terhadap godaan menaikkan KOREKSI_PASCA_EKSPOR sampai test hijau:
    // baris-barisnya harus benar-benar ada, dgn status & selisih yang disebut.
    const rows = await scoped<{ ckdbppiut: string; sbatal: number; njumlah: string }>(
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

    const sum = (ids: readonly string[]) =>
      ids.reduce((s, id) => s + Number(by.get(id)!.njumlah), 0);
    // Selisih pengganti − asli HARUS persis sebesar koreksi yang dideklarasikan.
    expect(sum(AUDIT_04_08.pengganti) - sum(AUDIT_04_08.dibatalkan)).toBe(
      KOREKSI_PASCA_EKSPOR["2026-08-04"].piutangLokal,
    );
  });

  it("REKONSTRUKSI: buang koreksi → mendarat tepat di oracle asli", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Bukti terkuat bahwa ATURAN-nya benar: kalau gerak ledger pasca-ekspor
    // dibatalkan, angka SolaMax identik dgn berkas EasyMax — selisih nol rupiah.
    const { getSaldoPelanggan } = await loadQueries();
    const live = await getSaldoPelanggan(UNIT_28, "2026-08-04");
    expect(live.akhir.piutangLokal - KOREKSI_PASCA_EKSPOR["2026-08-04"].piutangLokal).toBe(
      ORACLE["2026-08-04"].piutangLokal,
    );
  });

  it("KONTROL — oracle yang digeser satu hari HARUS gagal", async (ctx) => {
    if (!(await ready())) ctx.skip();
    // Tanpa kontrol ini, "cocok" tak membuktikan apa pun: kalau assertion di atas
    // toleran (mis. pembulatan longgar), ia akan cocok juga dengan angka yang salah.
    const { getSaldoPelanggan } = await loadQueries();
    const got = await getSaldoPelanggan(UNIT_28, "2026-08-03");
    expect(got.akhir).not.toEqual(expected("2026-08-02"));
    expect(got.akhir).not.toEqual(expected("2026-08-04"));
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
    const r = await scoped<{ net: number }>(
      `SELECT COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END),0)::float8 AS net
         FROM public.bppiut b
        WHERE b.unit_id = 7 AND COALESCE(b.sbatal,0) = 0
          AND trim(b.ckdplg) = '21.999.0014' AND b.dtgl <= '2026-08-04'::date`,
    );
    expect(r[0]!.net).toBe(36_084); // kontrol: pelanggannya memang bersaldo
    const got = await getSaldoPelanggan(UNIT_28, "2026-08-04");
    expect(got.akhir.piutangOnline).toBe(expected("2026-08-04").piutangOnline);
    // dan tanpa dia, angkanya meleset persis sebesar saldonya
    expect(got.akhir.piutangOnline - 36_084).not.toBe(expected("2026-08-04").piutangOnline);
  });
});
