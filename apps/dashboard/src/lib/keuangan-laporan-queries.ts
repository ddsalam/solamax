import { qScoped } from "./db";
import { ukur } from "./ukur-kueri";
import { effectiveBuyPrice } from "./harga-beli";
import { normalizeProductIdentity } from "./derive";
import {
  kumpulkanBeban,
  pilahManualEntry,
  type BarisBeban,
  type BarisManualLaporan,
} from "./keuangan-beban";
import { NOMINAL_MANUAL_ENTRY_SQL } from "./manual-entry-nominal";
import { SQL_AKUN_EFEKTIF } from "./keuangan-reklas";
import { sqlTitipan, type SaldoTitipanPemilik, type TitipanDiterima } from "./titipan-bright";
import { cutOverTerawal, saldoAkun } from "./keuangan-kas";
import { computeDay, sisaSoAktif, type DayProductInput, type DayTotals } from "./keuangan-mesin";
import {
  langkahHarianDari,
  sebabKasDari,
  type SebabKasInput,
  type SisiKasLangkah,
} from "./keuangan-laporan-model";
import {
  arusBukuKas,
  barisSusulan,
  sisiKasNeraca,
  type MutasiSisiKas,
  type PihakLawanNeraca,
  type SisiKasNeraca,
} from "./keuangan-sisi-kas";
import { getPihakLawan } from "./pihak-lawan-queries";
import { addDays } from "./periods";
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
  /** Sebab `kasAkhir`/`kasAwalPerAkun` kosong — diteruskan ke panel apa adanya. */
  sebabKas: SebabKasInput;
  /**
   * SALDO — untuk neraca. KTD2/U6: Σ saldo pihak lawan non-titipan (positif =
   * piutang) + −Σ amount baris Hutang Piutang tanpa pihak lawan.
   */
  hutangPiutangNonEasymax: number | null;
  /** Bagian di atas yang pihak lawannya belum ditetapkan (KTD3) — ditampilkan terpisah. */
  pihakLawanBelumDitetapkan: number | null;
  /** §10.26 — ada saldo pembuka pihak lawan berlaku yang sementara. */
  pihakLawanSementara: boolean;
  /** ARUS hari itu — untuk cash flow. Bukan angka yang sama. */
  arusHutangPiutangNonEasymax: number | null;
  /** KTD8 — SALDO penampung (−Σ amount) untuk neraca; `null` = tanpa akun kas. */
  penampung: number | null;
  /** KTD8 — ARUS penampung hari itu (cash flow). */
  arusPenampung: number | null;
  /** §1.2 — SALDO temporary investment (−Σ amount) untuk neraca. */
  temporaryInvestment: number | null;
  /** §1.3 — ARUS temporary investment hari itu. */
  arusTemporaryInvestment: number | null;
  /** §10.26 — ada saldo pembuka pemilik titipan berlaku yang sementara. */
  titipanSementara: boolean;
  /**
   * KTD15 — sisi kas yang sama TANPA baris yang dibukukan hari itu bertanggal
   * asal lebih awal. `undefined` = hari itu tak punya baris susulan.
   */
  tanpaSusulan?: SisiKasLangkah;
  /**
   * §10.27/U5 — SALDO liabilitas titipan, GABUNGAN semua pemilik (neraca).
   * Namanya tetap demi baris neraca yang sudah ada; rinciannya di
   * {@link BahanLaporan.titipanPerPemilik}.
   */
  saldoTitipanBright: number;
  /** U5 — saldo titipan per pemilik (Outlet Bright, Kebab, …); Σ = `saldoTitipanBright`. */
  titipanPerPemilik: SaldoTitipanPemilik[];
  /** §10.27/U5 — ARUS titipan hari itu, semua pemilik: diterima − diserahkan (cash flow). */
  arusTitipanBright: number;
  piutangEasymax: number;
  deltaPiutangEasymax: number;
  beban: BarisBeban[];
  pendapatanLain: number;
  /**
   * §10.29 — arus ekuitas bersih hari itu (prive/kontribusi): `deltaKontribusi`
   * neraca & baris arus kas. U6: reklasifikasi biaya pengawas + buku kas
   * (Tambahan Modal / Kontribusi ke Pusat). POSITIF = keluar.
   */
  kontribusi: number;
  /** R16 — Σ buku kas `Pembelian BBM` hari itu (arus, keluar = negatif). `null` = tanpa akun kas. */
  penebusanSo: number | null;
  totalAssetKemarin: number | null;
}

/** Beban & pendapatan lain-lain milik hari itu, dari kedua pintu (§2.4). */
async function getBebanDanPendapatan(
  unit: ScopedUnitId,
  date: string,
): Promise<{
  beban: BarisBeban[];
  pendapatanLain: number;
  titipanBright: number;
  kontribusi: number;
}> {
  const manual = await qScoped<BarisManualLaporan>(
    unit,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS "businessDate",
            -- §10.29 — akun EFEKTIF: reklasifikasi terakhir, kalau tidak akun beku.
            ${SQL_AKUN_EFEKTIF("m")}            AS "accountingAccount",
            ${NOMINAL_MANUAL_ENTRY_SQL}::float8 AS "amountRp",
            keterangan, void, section::text     AS section,
            operational_category                AS "operationalCategory"
       FROM app.manual_entry m
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

  const { manualBeban, pendapatanLain, titipanBright, kontribusi } = pilahManualEntry(manual);
  const beban = kumpulkanBeban(
    { manual_entry: manualBeban, noncash_expense: nonKas },
    date,
    date,
  );

  return { beban, pendapatanLain, titipanBright, kontribusi };
}

/**
 * §10.27/U5 — titipan DITERIMA (Rincian) per pemilik & hari buku, SEJAK buku
 * kas unit ini dimulai. Sebelum buku dimulai kas tak terhitung, jadi
 * liabilitasnya pun tak dihitung — `null`, supaya keduanya mulai bersamaan dan
 * langkah harian di hari pertama tetap seimbang.
 *
 * SATU kueri (jumlah kueri `getBahanLaporan` terukur, papan-keuangan guard):
 * setiap pemilik titipan unit + Σ diterimanya per tanggal, ditambah baris
 * tanpa pemilik (baris lama ⇒ Outlet Bright, `saldoTitipanPerPemilik`).
 * Per TANGGAL (U6) supaya baris yang mendahului saldo pembuka pemiliknya bisa
 * dikecualikan secara murni — satu pemilik × hari sejak cut-over, kecil.
 */
async function titipanDiterimaPada(
  unit: ScopedUnitId,
  d: string,
  mutasi: readonly MutasiSisiKas[],
): Promise<TitipanDiterima[] | null> {
  const aktif = mutasi.filter((m) => !m.void && m.businessDate <= d);
  if (aktif.length === 0) return null;
  // Mulai = cut-over terawal bila ada (§10.26) — titipan dan kas mulai
  // dibukukan pada tanggal yang SAMA. Tanpa ini, mutasi lama sebelum cut-over
  // (IB, 1 Sep) menarik awal titipan mundur sebulan (produksi: −345,8 jt).
  const cut = cutOverTerawal(mutasi);
  if (cut !== null && d < cut) return null;
  const mulai =
    cut ?? aktif.reduce((a, m) => (m.businessDate < a ? m.businessDate : a), aktif[0]!.businessDate);
  return getTitipanDiterima(unit, mulai, d);
}

/**
 * Kueri titipan diterima per pemilik & hari buku dalam `[mulai, d]` — dipisah
 * hanya supaya gerbang K1 (`queries.sqlcheck`) bisa mengeksekusinya langsung;
 * jalur laporan memanggilnya lewat {@link titipanDiterimaPada}.
 */
export async function getTitipanDiterima(unit: ScopedUnitId, mulai: string, d: string): Promise<TitipanDiterima[]> {
  return qScoped<TitipanDiterima>(
    unit,
    `WITH t AS (
       SELECT m.pihak_lawan_id AS pid, m.business_date AS d, sum(m.amount) AS rp
         FROM app.manual_entry m
        WHERE m.unit_id = $1 AND NOT m.void
          AND m.business_date BETWEEN $2::date AND $3::date
          AND ${sqlTitipan("m")}
        GROUP BY m.pihak_lawan_id, m.business_date
     ), p AS (
       SELECT id, nama FROM app.pihak_lawan WHERE unit_id = $1 AND jenis = 'titipan'
     )
     SELECT COALESCE(p.id, t.pid)::text      AS "pihakLawanId",
            p.nama,
            COALESCE(t.rp, 0)::float8        AS rp,
            to_char(t.d, 'YYYY-MM-DD')       AS "businessDate"
       FROM p FULL JOIN t ON t.pid = p.id`,
    [unit, mulai, d],
  );
}

/**
 * Sisi buku kas neraca pada `d` — penuh, dan tanpa baris susulan hari itu
 * (KTD15). Titipan diterima dibaca SEKALI dan dipakai kedua hitungan: baris
 * Rincian bukan baris kas, jadi tak pernah "susulan".
 */
async function sisiKasPada(
  unit: ScopedUnitId,
  d: string,
  mutasi: readonly MutasiSisiKas[],
  pihakLawan: readonly PihakLawanNeraca[],
  dasar: { adaAkun: boolean; kasTerhitung: boolean },
): Promise<{ penuh: SisiKasNeraca; tanpaSusulan: SisiKasNeraca | undefined }> {
  const titipanDiterima = await titipanDiterimaPada(unit, d, mutasi);
  const hitung = (rows: readonly MutasiSisiKas[]) =>
    sisiKasNeraca({ mutasi: rows, date: d, ...dasar, pihakLawan, titipanDiterima });
  const tanpa = mutasi.filter((m) => !barisSusulan(m, d));
  return { penuh: hitung(mutasi), tanpaSusulan: tanpa.length === mutasi.length ? undefined : hitung(tanpa) };
}

/** Total asset komponen-non-kas pada satu tanggal — untuk LANGKAH harian. */
function assetNonKas(t: DayTotals): number | null {
  return t.inventoryValue === null ? null : t.inventoryValue + t.soValue;
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
async function totalAssetPada(
  unit: ScopedUnitId,
  d: string,
  pihakLawanP: Promise<readonly PihakLawanNeraca[]>,
): Promise<number | null> {
  const [gl, sales, buyRows, doRows, akun, mutasi, saldo] = await Promise.all([
    getDailyGlByProduct(unit, d, d),
    getSalesByProduct(unit, d, d),
    getHargaBeliRows(unit),
    getDoHarian(unit, d),
    getAkunKas(unit),
    getMutasiKas(unit, d),
    getSaldoPelanggan(unit, d),
  ]);
  if (akun.length === 0) return null;

  const hargaJual = new Map(sales.flatMap((s) => {
    const key = normalizeProductIdentity(s.ckdbbm);
    return key === null ? [] : [[key, s.harga] as const];
  }));
  const doPer = new Map(doRows.flatMap((x) => {
    const key = normalizeProductIdentity(x.ckdbbm);
    return key === null ? [] : [[key, x] as const];
  }));
  const { totals } = computeDay(
    gl.map((r) => {
      const key = normalizeProductIdentity(r.ckdbbm);
      const x = key === null ? undefined : doPer.get(key);
      return {
        productKey: key ?? "Produk tidak diketahui",
        volume: r.sales_gross,
        sellPrice: key === null ? null : hargaJual.get(key) ?? null,
        tera: r.tera,
        stock: key === null ? null : r.fisik,
        lossesGain: key === null ? null : r.gl,
        sourceGlIncomplete: key === null || r.gl === null,
        sourceStockIncomplete: key === null || r.fisik === null,
        buyPrice: key === null ? null : effectiveBuyPrice(buyRows, key, d),
        sisaSo: x === undefined ? null : sisaSoAktif(x.sisa, x.sisa_macet),
      };
    }),
  );
  const piutang = saldo.akhir.piutangLokal + saldo.akhir.piutangOnline;
  // ⛔ Term sisi kas lewat fungsi yang SAMA dengan hari ini (`sisiKasNeraca`):
  //    kas, pihak lawan (KTD2), penampung (KTD8), temporary investment, titipan
  //    (liabilitas — mengurangi asset bersih). Kemarin dihitung PENUH — baris
  //    susulan kemarin sudah dinilai kemarin.
  const { penuh: k } = await sisiKasPada(unit, d, mutasi, await pihakLawanP, { adaAkun: true, kasTerhitung: true });
  const nonKas = assetNonKas(totals);
  return nonKas === null
    ? null
    : k.kasAkhir! + nonKas + piutang + k.hutangPiutangNonEasymax! + k.penampung! + k.temporaryInvestment! -
        k.saldoTitipanBright;
}

export async function getBahanLaporan(
  unit: ScopedUnitId,
  date: string,
  kemarin: string,
): Promise<BahanLaporan> {
  // 📏 DIUKUR DI JALUR NYATA (ukur-kueri.ts): satu baris log per panggilan berisi
  // jumlah kueri, jumlah round-trip, dan wall-clock — tak ada isi datanya. Papan
  // membungkus loop-nya dengan `ukur("papan", …)`, jadi angka per-unit dan angka
  // per-halaman keduanya terbentuk dari pemakaian sesungguhnya, bukan dari beban
  // tiruan yang ditembakkan ke `solamax-pg`.
  return ukur("bahan-laporan", () => bahanLaporan(unit, date, kemarin));
}

async function bahanLaporan(
  unit: ScopedUnitId,
  date: string,
  kemarin: string,
): Promise<BahanLaporan> {
  // Pihak lawan unit (+ saldo pembukanya) dibaca SEKALI dan dipakai hari ini
  // maupun kemarin — satu kueri tambahan per laporan, bukan dua.
  const pihakLawanP = getPihakLawan(unit);
  const [gl, sales, buyRows, doRows, akun, mutasi, saldo, bp, assetKemarin, pihakLawan] = await Promise.all([
    getDailyGlByProduct(unit, date, date),
    getSalesByProduct(unit, date, date),
    getHargaBeliRows(unit),
    getDoHarian(unit, date),
    getAkunKas(unit),
    getMutasiKas(unit, date),
    getSaldoPelanggan(unit, date),
    getBebanDanPendapatan(unit, date),
    totalAssetPada(unit, kemarin, pihakLawanP),
    pihakLawanP,
  ]);

  const hargaJual = new Map(sales.flatMap((s) => {
    const key = normalizeProductIdentity(s.ckdbbm);
    return key === null ? [] : [[key, s.harga] as const];
  }));
  const doPer = new Map(doRows.flatMap((d) => {
    const key = normalizeProductIdentity(d.ckdbbm);
    return key === null ? [] : [[key, d] as const];
  }));

  const inputs: DayProductInput[] = gl.map((r) => {
    const key = normalizeProductIdentity(r.ckdbbm);
    const d = key === null ? undefined : doPer.get(key);
    return {
      productKey: key ?? "Produk tidak diketahui",
      volume: r.sales_gross,
      sellPrice: key === null ? null : hargaJual.get(key) ?? null,
      tera: r.tera,
      stock: key === null ? null : r.fisik,
      lossesGain: key === null ? null : r.gl,
      sourceGlIncomplete: key === null || r.gl === null,
      sourceStockIncomplete: key === null || r.fisik === null,
      buyPrice: key === null ? null : effectiveBuyPrice(buyRows, key, date),
      // `sisaSoAktif` mengurangi bagian macet — jangan menghitungnya ulang.
      sisaSo: d === undefined ? null : sisaSoAktif(d.sisa, d.sisa_macet),
    };
  });
  const { totals } = computeDay(inputs);

  // ⛔ DUA SEBAB BERBEDA, DINAMAI (§10.21). Terukur di produksi 22 Agu 2026:
  //    `cashOnHand = 0` di KETUJUH unit — termasuk Bakau yang punya `Kas Besar`
  //    — sebab `cash_ledger` kosong dan Σ dari nol mutasi adalah 0. Nol itu
  //    mengalir ke `asset`, lalu ke `langkahHarian`, dan seluruh jaring yang
  //    dibangun untuk menangkap "angka dari himpunan tak lengkap" DIAM: bukan
  //    karena rusak, melainkan karena 0 adalah angka yang sah.
  const adaAkun = akun.length > 0;
  const sebabKas = sebabKasDari(
    akun.length,
    mutasi.filter((m) => !m.void && m.businessDate <= date).length,
    { tanggal: date, terawal: cutOverTerawal(mutasi) },
  );
  /** Saldo hanya berarti bila bukunya punya isi. Kosong ⇒ BELUM DIKETAHUI. */
  const kasTerhitung = sebabKas === null;
  const kasAwalPerAkun = kasTerhitung
    ? akun.map((a) => ({ nama: a.nama, saldo: saldoAkun(mutasi, a.id, kemarin) }))
    : null;
  const kasAwalTotal = kasAwalPerAkun === null ? null : kasAwalPerAkun.reduce((s, a) => s + a.saldo, 0);
  // ⚠️ DUA angka berbeda dari kategori yang sama, dan mencampurnya adalah
  // kesalahan yang tak akan terlihat: NERACA butuh SALDO (kumulatif sampai
  // hari ini), CASH FLOW butuh ARUS (mutasi hari itu saja). Keduanya kini
  // lahir dari SATU modul (`keuangan-sisi-kas.ts`): saldo dari `sisiKasNeraca`,
  // arus dari `arusBukuKas` lewat peta kategori → baris arus kas (KTD12).
  // ⚠️ BATAS YANG DISEBUT: suku kategori memakai `adaAkun`, bukan
  //    `kasTerhitung`. Nol di sana berarti "tak ada mutasi kategori itu", yang
  //    memang benar. Keputusan §10.21 menyebut `kasAkhir`; memperluasnya
  //    diam-diam ke pos lain adalah menebak keputusan yang tak diambil.
  const sisi = await sisiKasPada(unit, date, mutasi, pihakLawan, { adaAkun, kasTerhitung });
  const saldoNonEasymax = sisi.penuh.hutangPiutangNonEasymax;
  const arus = arusBukuKas(mutasi, date);
  const arusDari = (b: Parameters<typeof arus.get>[0]) => (adaAkun ? (arus.get(b) ?? 0) : null);
  const arusNonEasymax = arusDari("Transaksi hutang piutang non-EasyMax");
  const kasAkhir = sisi.penuh.kasAkhir;
  const titipanPerPemilik = sisi.penuh.titipanPerPemilik;
  const saldoTitipanBright = sisi.penuh.saldoTitipanBright;
  const arusTitipanBright = bp.titipanBright + (arus.get("Titipan outlet Bright (bukan pendapatan)") ?? 0);
  /** Sisi kas → bentuk langkah harian; kontribusi = reklasifikasi + buku kas. */
  const langkahDari = (k: SisiKasNeraca): SisiKasLangkah => ({
    kasAkhir: k.kasAkhir,
    hutangPiutangNonEasymax: k.hutangPiutangNonEasymax,
    penampung: k.penampung,
    temporaryInvestment: k.temporaryInvestment,
    saldoTitipanBright: k.saldoTitipanBright,
    kontribusi: bp.kontribusi + k.kontribusiKas,
  });

  // Piutang pelanggan EasyMax pada DUA batas (§ getSaldoPelanggan) — yang dipakai
  // neraca adalah akhir hari; arusnya = selisih terhadap awal hari.
  const piutangEasymax = saldo.akhir.piutangLokal + saldo.akhir.piutangOnline;
  const piutangAwal = saldo.awal.piutangLokal + saldo.awal.piutangOnline;
  const deltaPiutangEasymax = -(piutangEasymax - piutangAwal);

  return {
    totals,
    incomplete: totals.incomplete,
    kasAwalPerAkun,
    kasAwalTotal,
    kasAkhir,
    sebabKas,
    hutangPiutangNonEasymax: saldoNonEasymax,
    pihakLawanBelumDitetapkan: sisi.penuh.pihakLawanBelumDitetapkan,
    pihakLawanSementara: sisi.penuh.pihakLawanSementara,
    arusHutangPiutangNonEasymax: arusNonEasymax,
    penampung: sisi.penuh.penampung,
    arusPenampung: arusDari("Mutasi belum teridentifikasi (penampung)"),
    temporaryInvestment: sisi.penuh.temporaryInvestment,
    arusTemporaryInvestment: arusDari("Temporary investment"),
    saldoTitipanBright,
    titipanPerPemilik,
    titipanSementara: sisi.penuh.titipanSementara,
    tanpaSusulan: sisi.tanpaSusulan === undefined ? undefined : langkahDari(sisi.tanpaSusulan),
    arusTitipanBright,
    piutangEasymax,
    deltaPiutangEasymax,
    beban: bp.beban,
    pendapatanLain: bp.pendapatanLain,
    kontribusi: langkahDari(sisi.penuh).kontribusi,
    // R16 — penebusan SO = baris kas `Pembelian BBM` hari itu (peta KTD12).
    penebusanSo: arusDari("Penebusan SO"),
    totalAssetKemarin: assetKemarin,
  };
}

/**
 * Langkah harian TERKINI satu hari — `day_close.difference_rp` yang dipakai
 * `tutupHari` (rencana 2026-10-29 U2/KTD5). Jalur yang SAMA dengan Layar 4
 * (`getBahanLaporan` → `langkahHarianDari`), dipanggil ulang di bawah kunci
 * penutupan supaya baris yang dibukukan sesudah layar dibuka ikut terhitung.
 *
 * ⚠️ Kuerinya berjalan di koneksi pool sendiri, BUKAN di transaksi pemanggil —
 * READ COMMITTED: mereka melihat semua yang sudah di-COMMIT. Benar karena
 * pemanggil sudah memegang kunci eksklusif hari itu (`kunciHariEksklusif`),
 * jadi jalur tulis R28 yang ingin menulis ke hari itu sudah COMMIT lebih dulu
 * atau masih menunggu dan akan melihat hari itu tertutup.
 */
export async function hitungLangkahHarian(unit: ScopedUnitId, date: string): Promise<number | null> {
  return langkahHarianDari(await getBahanLaporan(unit, date, addDays(date, -1)));
}

export { assetNonKas };

/**
 * U6 — bahan buku pembantu pihak lawan per tanggal (R2). Jalur BACA yang sama
 * dengan neraca (`getMutasiKas` + `getPihakLawan` + titipan diterima +
 * `sisiKasNeraca`), supaya saldo per pihak lawan di halaman itu tak pernah
 * berselisih dengan baris "Hutang piutang non-EasyMax"/titipan di neraca.
 */
export async function getBahanBukuPembantu(unit: ScopedUnitId, per: string) {
  const [akun, mutasi, pihakLawan] = await Promise.all([getAkunKas(unit), getMutasiKas(unit, per), getPihakLawan(unit)]);
  const adaAkun = akun.length > 0;
  const titipanDiterima = await titipanDiterimaPada(unit, per, mutasi);
  const sisi = sisiKasNeraca({ mutasi, date: per, adaAkun, kasTerhitung: false, pihakLawan, titipanDiterima });
  return { mutasi, pihakLawan, titipanDiterima, sisi };
}
