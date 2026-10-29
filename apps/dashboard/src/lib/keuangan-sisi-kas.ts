import { saldoSemuaAkun, type MutasiKas } from "./keuangan-kas";
import { saldoPihakLawan, type JenisPihakLawan, type MutasiPihakLawan, type SaldoAwalPihakLawan } from "./pihak-lawan-model";
import {
  saldoTitipanPerPemilik,
  totalSaldoTitipan,
  type SaldoAwalTitipan,
  type SaldoTitipanPemilik,
  type TitipanDiterima,
} from "./titipan-bright";

/**
 * SISI BUKU KAS laporan harian (rencana 2026-10-29 U6; R8, R16, R24, R32;
 * KTD2, KTD8, KTD12, KTD15) — MURNI, tanpa I/O.
 *
 * Satu tempat yang menjawab dua pertanyaan atas baris `cash_ledger`:
 *
 *   1. **Arus kas** — setiap kategori kas dipetakan ke TEPAT SATU baris arus
 *      kas (`PETA_KATEGORI_ARUS_KAS`, KTD12). Baris yang nilainya dihitung dari
 *      buku kas dijumlah dari peta ini, bukan dari daftar label kedua.
 *   2. **Neraca** — term yang mengimbangi setiap baris kas yang bukan laba:
 *      pihak lawan (KTD2), penampung (KTD8), temporary investment (§1.2),
 *      titipan per pemilik (§10.27/U5), dan arus ekuitas (§10.29).
 *
 * Fungsi neraca dipanggil DUA KALI oleh perakit laporan (KTD15): dengan semua
 * baris, dan tanpa baris yang dibukukan hari itu bertanggal asal lebih awal.
 */

// ---------------------------------------------------------------------------
// Peta kategori kas → baris arus kas (KTD12)
// ---------------------------------------------------------------------------

/** Baris arus kas di `panelCashFlow`, plus satu baris semu untuk perpindahan antar akun. */
export type BarisArusKas =
  | "Omzet penjualan"
  | "Transaksi piutang pelanggan EasyMax"
  | "Transaksi hutang piutang non-EasyMax"
  | "Penebusan SO"
  | "Pendapatan lain-lain"
  | "Biaya operasional"
  | "Titipan outlet Bright (bukan pendapatan)"
  | "Prive / kontribusi pemilik (bukan beban)"
  | "Temporary investment"
  | "Mutasi belum teridentifikasi (penampung)"
  | "Perpindahan antar akun kas";

export interface PetaArus {
  baris: BarisArusKas;
  /**
   * `true` = nilai baris arus itu DIJUMLAH dari baris kas kategori ini.
   * `false` = baris arus itu bersumber lain (EasyMax, Rincian pengawas, beban)
   * dan baris kas kategori ini adalah REALISASI tunainya — menjumlahnya lagi
   * menghitung dua kali. "Perpindahan antar akun kas" bersih nol di dalam tujuh
   * akun (sisa MDR pencairan EDC sudah tercatat sebagai beban non-kas).
   */
  dariBukuKas: boolean;
}

/**
 * ⛔ SETIAP label `cash_mutation_category` yang di-seed migrasi WAJIB ada di
 * sini — dijaga `keuangan-sisi-kas.test.ts`, yang membaca label dari teks SQL
 * migrasi (0029, 0043, 0045, 0049, …). Kategori tanpa peta = arusnya hilang dari
 * cash flow dan cek arus kas menjerit palsu setiap hari (KTD12).
 *
 * Dikunci LABEL, bukan `side|label`: tiga label yang hidup di kedua sisi
 * (Pindah Buku, Hutang Piutang, Temporary Investment) dan penampung (0049)
 * jatuh ke baris arus yang sama di kedua sisinya.
 */
export const PETA_KATEGORI_ARUS_KAS: Readonly<Record<string, PetaArus>> = {
  // 0029
  "Setoran Hasil Penjualan": { baris: "Omzet penjualan", dariBukuKas: false },
  "Pendapatan Lain-Lain": { baris: "Pendapatan lain-lain", dariBukuKas: false },
  "Tambahan Modal": { baris: "Prive / kontribusi pemilik (bukan beban)", dariBukuKas: true },
  "Transfer Pembayaran Piutang Pelanggan": { baris: "Transaksi piutang pelanggan EasyMax", dariBukuKas: false },
  "Pindah Buku": { baris: "Perpindahan antar akun kas", dariBukuKas: false },
  "Hutang Piutang": { baris: "Transaksi hutang piutang non-EasyMax", dariBukuKas: true },
  "Temporary Investment": { baris: "Temporary investment", dariBukuKas: true },
  "Biaya Operasional": { baris: "Biaya operasional", dariBukuKas: false },
  "Pembelian BBM": { baris: "Penebusan SO", dariBukuKas: true },
  "Kontribusi ke Pusat": { baris: "Prive / kontribusi pemilik (bukan beban)", dariBukuKas: true },
  "Management Fee": { baris: "Biaya operasional", dariBukuKas: false },
  "Setoran ke Bank": { baris: "Perpindahan antar akun kas", dariBukuKas: false },
  // 0043
  "Penjualan EDC": { baris: "Omzet penjualan", dariBukuKas: false },
  // 0045
  "Penyerahan titipan Bright": { baris: "Titipan outlet Bright (bukan pendapatan)", dariBukuKas: true },
  // 0049
  "Mutasi Belum Teridentifikasi": { baris: "Mutasi belum teridentifikasi (penampung)", dariBukuKas: true },
  "Penyerahan titipan": { baris: "Titipan outlet Bright (bukan pendapatan)", dariBukuKas: true },
};

/** Kategori pihak lawan yang ditimbang di term Hutang Piutang neraca (bukan titipan). */
export const KATEGORI_HUTANG_PIUTANG = "Hutang Piutang";
/** KTD8 — kategori penampung (0049), debet & kredit. */
export const KATEGORI_PENAMPUNG = "Mutasi Belum Teridentifikasi";
/** §1.2 — Temporary Investment (0029), aset bukan kas. */
export const KATEGORI_TEMPORARY_INVESTMENT = "Temporary Investment";

/** Bagian baris kas yang dibaca sisi kas — `MutasiKas` + kolom 0049. */
export interface MutasiSisiKas extends MutasiKas {
  pihakLawanId?: string | null;
  /** 0049 — tanggal bank/transaksi bila dibukukan maju; `null` = sama dengan hari buku. */
  tanggalAsal?: string | null;
}

const sen = (rp: number): number => Math.round(rp * 100);

/**
 * Σ baris kas hari `date` per baris arus kas — HANYA baris arus yang
 * `dariBukuKas`. Baris yang kategorinya tak berpeta tidak dijumlah di sini
 * (dan guard uji mencegahnya lahir). Dalam rupiah, dijumlah dalam sen.
 */
export function arusBukuKas(mutasi: readonly MutasiSisiKas[], date: string): Map<BarisArusKas, number> {
  const s = new Map<BarisArusKas, number>();
  for (const m of mutasi) {
    if (m.void || m.saldoAwal || m.businessDate !== date || m.categoryLabel === null) continue;
    const p = PETA_KATEGORI_ARUS_KAS[m.categoryLabel];
    if (p === undefined || !p.dariBukuKas) continue;
    s.set(p.baris, (s.get(p.baris) ?? 0) + sen(m.amount));
  }
  return new Map([...s].map(([k, v]) => [k, v / 100 || 0]));
}

// ---------------------------------------------------------------------------
// Neraca: term yang mengimbangi baris kas bukan-laba
// ---------------------------------------------------------------------------

export interface PihakLawanNeraca {
  id: string;
  jenis: JenisPihakLawan;
  saldoAwal: SaldoAwalPihakLawan | null;
}

export interface SisiKasNeraca {
  /** Σ saldo tujuh akun (cut-over §10.24). `null` = kas belum terhitung (§10.21). */
  kasAkhir: number | null;
  /**
   * KTD2 — Σ saldo pihak lawan NON-titipan (pembuka + −Σ amount Hutang Piutang)
   * + −Σ amount Hutang Piutang yang pihak lawannya belum ditetapkan. ASET bila
   * positif (piutang). `null` = unit tanpa akun kas.
   */
  hutangPiutangNonEasymax: number | null;
  /** Bagian di atas yang pihak lawannya masih NULL (baris lama, KTD3). */
  pihakLawanBelumDitetapkan: number | null;
  /** Ada saldo pembuka pihak lawan (non-titipan) berlaku yang bertanda sementara. */
  pihakLawanSementara: boolean;
  /** KTD8 — −Σ amount penampung. Negatif = uang masuk yang belum dikenali (kewajiban). */
  penampung: number | null;
  /** §1.2 — −Σ amount Temporary Investment (kas keluar ⇒ investasi naik). */
  temporaryInvestment: number | null;
  /** §10.27/U5 — liabilitas titipan per pemilik (+ saldo pembuka pemilik, U6). */
  titipanPerPemilik: SaldoTitipanPemilik[];
  saldoTitipanBright: number;
  /** Ada saldo pembuka pemilik titipan berlaku yang bertanda sementara. */
  titipanSementara: boolean;
  /** §10.29 — arus ekuitas HARI ITU dari buku kas (Tambahan Modal/Kontribusi ke Pusat). POSITIF = keluar. */
  kontribusiKas: number;
}

export interface MasukanSisiKas {
  mutasi: readonly MutasiSisiKas[];
  date: string;
  /** Unit punya akun kas — term arus/saldo kategori berarti (lihat §10.21 batas). */
  adaAkun: boolean;
  /** `sebabKas === null` — kas akhir boleh dihitung. */
  kasTerhitung: boolean;
  pihakLawan: readonly PihakLawanNeraca[];
  /**
   * Titipan diterima (Rincian) per pemilik & tanggal sejak buku titipan dimulai.
   * `null` = buku titipan belum dimulai pada `date` (sebelum cut-over) ⇒ nol.
   */
  titipanDiterima: readonly TitipanDiterima[] | null;
}

export function sisiKasNeraca(i: MasukanSisiKas): SisiKasNeraca {
  const d = i.date;
  const hidup = i.mutasi.filter((m) => !m.void && m.businessDate <= d);
  const sigma = (label: string) => {
    let s = 0;
    for (const m of hidup) if (m.categoryLabel === label) s += sen(m.amount);
    return s;
  };

  // --- Pihak lawan (KTD2) ---------------------------------------------------
  // ⛔ Pemilik TITIPAN tidak ditimbang di sini: penyerahannya (kategori
  //    Penyerahan titipan) DAN saldo pembukanya hidup di liabilitas titipan.
  //    Menimbangnya di dua term menghitung utang yang sama dua kali.
  const nonTitipan = i.pihakLawan.filter((p) => p.jenis !== "titipan");
  const dikenal = new Set(nonTitipan.map((p) => p.id));
  const hp = hidup.filter((m) => m.categoryLabel === KATEGORI_HUTANG_PIUTANG);
  const mutasiPl: MutasiPihakLawan[] = hp
    .filter((m) => m.pihakLawanId != null && dikenal.has(m.pihakLawanId))
    .map((m) => ({ pihakLawanId: m.pihakLawanId!, businessDate: m.businessDate, amountSen: sen(m.amount), void: false }));
  let plSen = 0;
  let sementara = false;
  for (const p of nonTitipan) {
    const r = saldoPihakLawan({ pihakLawanId: p.id, saldoAwal: p.saldoAwal, mutasi: mutasiPl, per: d });
    plSen += r.saldoSen;
    if (r.sementara) sementara = true;
  }
  let belumSen = 0;
  let asingSen = 0;
  for (const m of hp) {
    if (m.pihakLawanId == null) belumSen -= sen(m.amount);
    // Pihak lawan yang tak dikenal sebagai non-titipan (mis. Hutang Piutang yang
    // keliru menunjuk pemilik titipan): tetap diimbangi, supaya kasnya tak
    // pernah berdiri sendiri — tanpa pembuka.
    else if (!dikenal.has(m.pihakLawanId)) asingSen -= sen(m.amount);
  }

  // --- Titipan per pemilik (§10.27/U5 + pembuka U6) ---------------------------
  const pembukaTitipan = new Map<string, SaldoAwalTitipan>();
  for (const p of i.pihakLawan) if (p.jenis === "titipan" && p.saldoAwal !== null) pembukaTitipan.set(p.id, p.saldoAwal);
  const titipanPerPemilik =
    i.titipanDiterima === null ? [] : saldoTitipanPerPemilik(i.titipanDiterima, i.mutasi, d, pembukaTitipan);
  const titipanSementara =
    i.titipanDiterima !== null && [...pembukaTitipan.values()].some((a) => a.sementara && a.tanggal <= d);

  // --- Arus ekuitas hari itu dari buku kas (§10.29) ---------------------------
  let kontribusiSen = 0;
  for (const m of hidup) {
    if (m.saldoAwal || m.businessDate !== d || m.categoryLabel === null) continue;
    if (PETA_KATEGORI_ARUS_KAS[m.categoryLabel]?.baris === "Prive / kontribusi pemilik (bukan beban)") {
      kontribusiSen -= sen(m.amount);
    }
  }

  const rp = (s: number) => s / 100 || 0;
  return {
    kasAkhir: i.kasTerhitung ? [...saldoSemuaAkun(i.mutasi, d).values()].reduce((s, v) => s + v, 0) : null,
    hutangPiutangNonEasymax: i.adaAkun ? rp(plSen + belumSen + asingSen) : null,
    pihakLawanBelumDitetapkan: i.adaAkun ? rp(belumSen) : null,
    pihakLawanSementara: sementara,
    penampung: i.adaAkun ? rp(-sigma(KATEGORI_PENAMPUNG)) : null,
    temporaryInvestment: i.adaAkun ? rp(-sigma(KATEGORI_TEMPORARY_INVESTMENT)) : null,
    titipanPerPemilik,
    saldoTitipanBright: totalSaldoTitipan(titipanPerPemilik),
    titipanSementara,
    kontribusiKas: rp(kontribusiSen),
  };
}

/**
 * KTD15 — baris SUSULAN hari `date`: dibukukan hari itu dengan tanggal asal
 * lebih awal (impor rekening koran, kaki antar unit, pembalik, penebusan maju).
 * Langkah "dinilai" dihitung tanpa baris ini; selisihnya adalah koreksi susulan.
 */
export function barisSusulan(m: MutasiSisiKas, date: string): boolean {
  return m.businessDate === date && m.tanggalAsal != null && m.tanggalAsal < date;
}
