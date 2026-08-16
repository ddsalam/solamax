import { qScoped } from "./db";
import { effectiveBuyPrice } from "./harga-beli";
import { kumpulkanBeban, type BarisBeban } from "./keuangan-beban";
import { saldoAkun, saldoSemuaAkun } from "./keuangan-kas";
import { computeDay, sisaSoAktif, type DayProductInput, type DayTotals } from "./keuangan-mesin";
import { deltaKategori, deltaKategoriSampai } from "./keuangan-laporan-model";
import {
  getAkunKas,
  getHargaBeliRows,
  getMutasiKas,
  type MutasiKasRow,
} from "./keuangan-input-queries";
import { getDailyGlByProduct, getDoHarian, getSalesByProduct, getSaldoPelanggan } from "./queries";
import type { ScopedUnitId } from "./scope";

/**
 * Perakitan bahan Laporan Keuangan Harian (Layar 2) — **READ-ONLY**.
 *
 * Berkas ini hanya MENGUMPULKAN; yang menyusun laporannya
 * `keuangan-laporan-model.ts` (murni). Pemisahan itu disengaja: aturan laporan
 * harus bisa diuji tanpa DB, dan sudah.
 *
 * ⛔ Setiap kueri per-unit menerima `ScopedUnitId` — lupa men-scope = error
 * type-check, dan RLS 0016 memfilter ulang di DB.
 */

export interface BahanLaporan {
  totals: DayTotals;
  /** Produk yang menyumbang `null` — dinamai di layar, bukan disembunyikan. */
  incomplete: readonly string[];
  kasAwalPerAkun: { nama: string; saldo: number }[] | null;
  kasAwalTotal: number | null;
  kasAkhir: number | null;
  /** SALDO kumulatif — untuk neraca. */
  hutangPiutangNonEasymax: number | null;
  /** ARUS hari itu — untuk cash flow. Bukan angka yang sama. */
  arusHutangPiutangNonEasymax: number | null;
  piutangEasymax: number | null;
  deltaPiutangEasymax: number | null;
  beban: BarisBeban[];
  pendapatanLain: number;
  penebusanSo: number | null;
  totalAssetKemarin: number | null;
}

/** Beban & pendapatan lain-lain milik hari itu, dari kedua pintu (§2.4). */
async function getBebanDanPendapatan(
  unit: ScopedUnitId,
  date: string,
): Promise<{ beban: BarisBeban[]; pendapatanLain: number }> {
  const manual = await qScoped<{
    businessDate: string;
    accountingAccount: string | null;
    amountRp: number;
    keterangan: string;
    void: boolean;
    section: string;
  }>(
    unit,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS "businessDate",
            accounting_account                  AS "accountingAccount",
            amount::float8                      AS "amountRp",
            keterangan, void, section::text     AS section
       FROM app.manual_entry
      WHERE unit_id = $1 AND business_date = $2::date
        AND section IN ('pengeluaran','pendapatan_lain')`,
    [unit, date],
  );
  const nonKas = await qScoped<{
    businessDate: string;
    accountingAccount: string;
    amountRp: number;
    keterangan: string;
    void: boolean;
  }>(
    unit,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS "businessDate",
            accounting_account                  AS "accountingAccount",
            amount_rp::float8                   AS "amountRp",
            keterangan, void
       FROM app.noncash_expense
      WHERE unit_id = $1 AND business_date = $2::date`,
    [unit, date],
  );

  // Beban disimpan BERTANDA negatif di manual_entry; `kumpulkanBeban` menerima
  // beban POSITIF. Tandanya dibalik di SATU tempat, di sini.
  const beban = kumpulkanBeban(
    {
      manual_entry: manual
        .filter((r) => r.section === "pengeluaran")
        .map((r) => ({ ...r, amountRp: -r.amountRp })),
      noncash_expense: nonKas,
    },
    date,
    date,
  );
  const pendapatanLain = manual
    .filter((r) => r.section === "pendapatan_lain" && !r.void)
    .reduce((s, r) => s + r.amountRp, 0);

  return { beban, pendapatanLain };
}

/** Total asset komponen-non-kas pada satu tanggal — untuk LANGKAH harian. */
function assetNonKas(t: DayTotals): number {
  return t.inventoryValue + t.soValue;
}

/**
 * Total asset pada satu tanggal — dipakai untuk LANGKAH HARIAN `BSCheck`.
 *
 * Dihitung terpisah dan sengaja: langkah harian adalah satu-satunya angka
 * neraca yang bisa berdiri TANPA saldo pembuka (§1.2), dan ia yang dinilai
 * gerbang §3. Membiarkannya `null` karena "asset kemarin belum dihitung" akan
 * menyembunyikan satu-satunya pemeriksa neraca yang bekerja hari ini.
 *
 * `null` bila salah satu komponennya tak diketahui — bukan nol.
 */
async function totalAssetPada(unit: ScopedUnitId, d: string): Promise<number | null> {
  const [gl, sales, buyRows, doRows, akun, mutasi, saldo] = await Promise.all([
    getDailyGlByProduct(unit, d, d),
    getSalesByProduct(unit, d, d),
    getHargaBeliRows(unit),
    getDoHarian(unit, d),
    getAkunKas(unit),
    getMutasiKas(unit, d),
    getSaldoPelanggan(unit, d),
  ]);
  if (akun.length === 0 || saldo === null) return null;

  const hargaJual = new Map(sales.map((s) => [s.ckdbbm, s.harga]));
  const doPer = new Map(doRows.map((x) => [x.ckdbbm, x]));
  const { totals } = computeDay(
    gl.map((r) => {
      const x = doPer.get(r.ckdbbm);
      return {
        productKey: r.ckdbbm,
        volume: r.sales_gross,
        sellPrice: hargaJual.get(r.ckdbbm) ?? null,
        tera: r.tera,
        stock: r.fisik,
        lossesGain: r.gl,
        buyPrice: effectiveBuyPrice(buyRows, r.ckdbbm, d),
        sisaSo: x === undefined ? null : sisaSoAktif(x.sisa, x.sisa_macet),
      };
    }),
  );
  const kas = [...saldoSemuaAkun(mutasi, d).values()].reduce((s, v) => s + v, 0);
  const piutang = saldo.akhir.piutangLokal + saldo.akhir.piutangOnline;
  const nonEasymax = deltaKategoriSampai(mutasi, d, "Hutang Piutang");
  return kas + assetNonKas(totals) + piutang + nonEasymax;
}

export async function getBahanLaporan(
  unit: ScopedUnitId,
  date: string,
  kemarin: string,
): Promise<BahanLaporan> {
  const [gl, sales, buyRows, doRows, akun, mutasi, saldo, bp, assetKemarin] = await Promise.all([
    getDailyGlByProduct(unit, date, date),
    getSalesByProduct(unit, date, date),
    getHargaBeliRows(unit),
    getDoHarian(unit, date),
    getAkunKas(unit),
    getMutasiKas(unit, date),
    getSaldoPelanggan(unit, date),
    getBebanDanPendapatan(unit, date),
    totalAssetPada(unit, kemarin),
  ]);

  const hargaJual = new Map(sales.map((s) => [s.ckdbbm, s.harga]));
  const doPer = new Map(doRows.map((d) => [d.ckdbbm, d]));

  const inputs: DayProductInput[] = gl.map((r) => {
    const d = doPer.get(r.ckdbbm);
    return {
      productKey: r.ckdbbm,
      volume: r.sales_gross,
      sellPrice: hargaJual.get(r.ckdbbm) ?? null,
      tera: r.tera,
      stock: r.fisik,
      lossesGain: r.gl,
      buyPrice: effectiveBuyPrice(buyRows, r.ckdbbm, date),
      // `sisaSoAktif` mengurangi bagian macet — jangan menghitungnya ulang.
      sisaSo: d === undefined ? null : sisaSoAktif(d.sisa, d.sisa_macet),
    };
  });
  const { totals } = computeDay(inputs);

  const adaAkun = akun.length > 0;
  const kasAwalPerAkun = adaAkun
    ? akun.map((a) => ({ nama: a.nama, saldo: saldoAkun(mutasi, a.id, kemarin) }))
    : null;
  const kasAwalTotal = kasAwalPerAkun === null ? null : kasAwalPerAkun.reduce((s, a) => s + a.saldo, 0);
  const kasAkhir = adaAkun ? [...saldoSemuaAkun(mutasi, date).values()].reduce((s, v) => s + v, 0) : null;

  // ⚠️ DUA angka berbeda dari kategori yang sama, dan mencampurnya adalah
  // kesalahan yang tak akan terlihat: NERACA butuh SALDO (kumulatif sampai
  // hari ini), CASH FLOW butuh ARUS (mutasi hari itu saja).
  const saldoNonEasymax = adaAkun ? deltaKategoriSampai(mutasi, date, "Hutang Piutang") : null;
  const arusNonEasymax = adaAkun ? deltaKategori(mutasi, date, "Hutang Piutang") : null;

  // Piutang pelanggan EasyMax pada DUA batas (§ getSaldoPelanggan) — yang dipakai
  // neraca adalah akhir hari; arusnya = selisih terhadap awal hari.
  const piutangEasymax = saldo === null ? null : saldo.akhir.piutangLokal + saldo.akhir.piutangOnline;
  const piutangAwal = saldo === null ? null : saldo.awal.piutangLokal + saldo.awal.piutangOnline;
  const deltaPiutangEasymax =
    piutangEasymax === null || piutangAwal === null ? null : -(piutangEasymax - piutangAwal);

  return {
    totals,
    incomplete: totals.incomplete,
    kasAwalPerAkun,
    kasAwalTotal,
    kasAkhir,
    hutangPiutangNonEasymax: saldoNonEasymax,
    arusHutangPiutangNonEasymax: arusNonEasymax,
    piutangEasymax,
    deltaPiutangEasymax,
    beban: bp.beban,
    pendapatanLain: bp.pendapatanLain,
    // ⚠️ Penebusan SO belum punya jalur arus-kas tersendiri di SolaMax; ia
    // dibiarkan `null` (tak bersumber) alih-alih ditebak nol.
    penebusanSo: null,
    totalAssetKemarin: assetKemarin,
  };
}

export { assetNonKas };
