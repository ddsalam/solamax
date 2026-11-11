import { TOLERANSI_RP } from "./keuangan-tutup-hari";

/**
 * PENJELASAN SELISIH CASH FLOW CHECK (rencana 2026-11-11-2210; R1–R5,
 * KTD1/KTD2/KTD5) — MURNI, tanpa I/O.
 *
 * ⛔ **Mengurai, tidak menghitung ulang (KTD1).** Angka cek DITERIMA dari
 * `panelCashFlow(...)` (satu-satunya pemilik). Di sini hanya dihitung baris 1
 * ("waktu pembayaran piutang"); sisa = cek − baris 1, dalam sen. Jumlah baris
 * = cek, persis, karena dibangun begitu — bukan karena dua rumus kebetulan
 * sama.
 *
 * Mengapa baris 1 ada: kategori "Transfer Pembayaran Piutang Pelanggan"
 * `dariBukuKas: false` — arusnya dari Δ saldo piutang EasyMax, baris bank
 * hanya realisasi tunainya. Bila bank menerima pada D tetapi EasyMax mencatat
 * pembayarannya pada hari lain, penerimaan itu muncul 1:1 di cek kedua hari
 * dengan tanda berlawanan.
 */

/** Pembayaran/pengurangan piutang di EasyMax (`bppiut` sjnsbp=2, bucket Lokal/Online). */
export interface BarisPiutangEasymax {
  /** `ckdbppiut` — urutan baris = urutan kode ini. */
  kode: string;
  pelanggan: string;
  ref: string | null;
  keterangan: string | null;
  rp: number;
}

/** Baris kas "Transfer Pembayaran Piutang Pelanggan" (non-void, bukan saldo awal). */
export interface BarisPiutangBank {
  id: string;
  /** Nama akun dengan nomor rekening DISAMARKAN (…4 digit terakhir). */
  rekening: string;
  tanggalAsal: string | null;
  keterangan: string | null;
  rp: number;
}

export interface HariPiutang {
  tanggal: string;
  easymax: BarisPiutangEasymax[];
  bank: BarisPiutangBank[];
}

/** Pasangan persis: subset baris EasyMax hari surplus-EasyMax = Σ bank hari surplus-bank. */
export interface CocokPersis {
  tanggalEasymax: string;
  tanggalBank: string;
  rp: number;
  baris: BarisPiutangEasymax[];
}

export interface PetunjukHari {
  tanggal: string;
  /** Baris 1 hari itu (Σ EasyMax − Σ bank), rupiah. */
  selisihRp: number;
  easymax: BarisPiutangEasymax[];
  bank: BarisPiutangBank[];
  cocok: CocokPersis | null;
}

export interface BarisPenjelasan {
  kode: "piutang_waktu" | "sisa";
  rp: number;
}

export interface PenjelasanSelisihArusKas {
  date: string;
  check: number;
  /** Baris 1 & sisa — Σ rp (dalam sen) === check (dalam sen). */
  baris: [BarisPenjelasan, BarisPenjelasan];
  easymax: { n: number; rp: number };
  bank: { n: number; rp: number };
  /** Baris EasyMax & bank hari D sendiri — agar Finance bisa menyebut barisnya. */
  hariIni: HariPiutang;
  sisaDiLuarToleransi: boolean;
  /** Hari dalam ±7 dengan baris 1 bertanda berlawanan; terdekat dulu, maks. `MAKS_PETUNJUK`. */
  petunjuk: PetunjukHari[];
  /** Baris 1 ≠ 0 tetapi tak ada hari berlawanan dalam ±7. */
  tanpaHariBerlawanan: boolean;
  /** Teks tindakan yang berlaku — komponen tidak memutuskannya. */
  aksi: "piutang_waktu" | "sisa_di_luar_toleransi" | null;
}

/** Label kategori kas yang arusnya dari EasyMax (kunci `PETA_KATEGORI_ARUS_KAS`, `dariBukuKas: false`). */
export const KATEGORI_PIUTANG_PELANGGAN = "Transfer Pembayaran Piutang Pelanggan";

/** Penjelasan, atau galat bacaannya (R8) — bentuk yang dikirim halaman ke panel. */
export type PenjelasanAtauGalat = PenjelasanSelisihArusKas | { galat: string };

/** Rentang hari pencarian petunjuk (D−7…D+7) — sama dengan jendela kueri. */
export const JENDELA_HARI = 7;
/** KTD2 — pencarian subset persis hanya bila hari surplus-EasyMax ≤ 16 baris. */
export const BATAS_BARIS_PENCARIAN = 16;
/** Petunjuk yang dikembalikan & ditampilkan — tiga hari terdekat. */
export const MAKS_PETUNJUK = 3;

export const TEKS_AKSI_PIUTANG_WAKTU =
  "Minta kasir mencatat pembayaran di EasyMax pada tanggal bank (dianjurkan). " +
  "Membukukan ulang baris bank pada hari EasyMax membuat baris rekening koran tak bisa dicocokkan. " +
  "Jangan menutup selisih ini dengan jurnal memorial atau baris lawan.";

export const TEKS_SISA_DI_LUAR_TOLERANSI =
  "Selisih di luar waktu pembayaran piutang — telusuri di baris arus kas di Laporan keuangan.";

export const TEKS_SISA_DALAM_TOLERANSI = "Sisa dalam toleransi — pembulatan setoran.";

export const TEKS_TANPA_HARI_BERLAWANAN =
  "Tidak ada hari dalam ±7 hari dengan selisih berlawanan — periksa tanggal pembayaran di EasyMax.";

const sen = (rp: number): number => Math.round(rp * 100);
const rupiah = (s: number): number => s / 100 || 0;
const jumlahSen = (xs: readonly { rp: number }[]): number => xs.reduce((a, x) => a + sen(x.rp), 0);
const selisihSen = (h: HariPiutang): number => jumlahSen(h.easymax) - jumlahSen(h.bank);
const hariKe = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** "29 Okt" dari "YYYY-MM-DD". */
export function tanggalPendek(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Rupiah bertitik ribuan, desimal (koma) hanya bila ada. */
export const rpTeks = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/**
 * Subset baris (berurutan) yang jumlahnya persis `targetSen`. Bila lebih dari
 * satu, yang daftar indeksnya terkecil secara leksikografis (urutan baris
 * terendah) menang — DFS "ambil dulu, lalu lewati" menurut urutan indeks
 * menemukannya pertama. `null` bila tak ada atau baris > `BATAS_BARIS_PENCARIAN`.
 */
function subsetPersis(baris: readonly BarisPiutangEasymax[], targetSen: number): BarisPiutangEasymax[] | null {
  if (targetSen <= 0 || baris.length === 0 || baris.length > BATAS_BARIS_PENCARIAN) return null;
  const nilai = baris.map((b) => sen(b.rp));
  // Pangkas cabang yang melampaui target hanya bila semua nilai positif.
  const bolehPangkas = nilai.every((v) => v > 0);
  const idx: number[] = [];
  const cari = (i: number, s: number): boolean => {
    if (idx.length > 0 && s === targetSen) return true;
    if (i === nilai.length || (bolehPangkas && s > targetSen)) return false;
    idx.push(i);
    if (cari(i + 1, s + nilai[i]!)) return true;
    idx.pop();
    return cari(i + 1, s);
  };
  return cari(0, 0) ? idx.map((i) => baris[i]!) : null;
}

/** Kelompokkan baris kueri per tanggal (urutan baris dipertahankan). */
export function kelompokkanPerHari(
  rows: readonly ({ sisi: "easymax"; tanggal: string; baris: BarisPiutangEasymax } | { sisi: "bank"; tanggal: string; baris: BarisPiutangBank })[],
): HariPiutang[] {
  const per = new Map<string, HariPiutang>();
  for (const r of rows) {
    const h = per.get(r.tanggal) ?? { tanggal: r.tanggal, easymax: [], bank: [] };
    if (r.sisi === "easymax") h.easymax.push(r.baris);
    else h.bank.push(r.baris);
    per.set(r.tanggal, h);
  }
  return [...per.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

/**
 * R1–R5. `check` = nilai cek arus kas yang sudah tampil; `null`/0 ⇒ `null`
 * (tidak ada blok, AE5). `hari` = baris EasyMax & bank dalam D±7.
 */
export function jelaskanSelisihArusKas(x: {
  date: string;
  check: number | null;
  hari: readonly HariPiutang[];
}): PenjelasanSelisihArusKas | null {
  if (x.check === null || sen(x.check) === 0) return null;
  const checkSen = sen(x.check);
  const hariD = x.hari.find((h) => h.tanggal === x.date) ?? { tanggal: x.date, easymax: [], bank: [] };
  const piutangSen = selisihSen(hariD);
  const sisaSen = checkSen - piutangSen;
  const sisaDiLuarToleransi = Math.abs(sisaSen) > sen(TOLERANSI_RP);

  const d0 = hariKe(x.date);
  const berlawanan =
    piutangSen === 0
      ? []
      : x.hari
          .filter((h) => {
            const jarak = Math.abs(hariKe(h.tanggal) - d0);
            const s = selisihSen(h);
            return h.tanggal !== x.date && jarak <= JENDELA_HARI && s !== 0 && Math.sign(s) !== Math.sign(piutangSen);
          })
          .sort((a, b) => Math.abs(hariKe(a.tanggal) - d0) - Math.abs(hariKe(b.tanggal) - d0) || a.tanggal.localeCompare(b.tanggal));
  const petunjuk: PetunjukHari[] = berlawanan
      .slice(0, MAKS_PETUNJUK)
      .map((h) => {
        // R4 — hari surplus-bank memberi target (Σ bank-nya); subset dicari
        // di baris EasyMax hari surplus-EasyMax.
        const [hariEasymax, hariBank] = piutangSen > 0 ? [hariD, h] : [h, hariD];
        const baris = subsetPersis(hariEasymax.easymax, jumlahSen(hariBank.bank));
        return {
          tanggal: h.tanggal,
          selisihRp: rupiah(selisihSen(h)),
          easymax: h.easymax,
          bank: h.bank,
          cocok:
            baris === null
              ? null
              : { tanggalEasymax: hariEasymax.tanggal, tanggalBank: hariBank.tanggal, rp: rupiah(jumlahSen(baris)), baris },
        };
      });

  return {
    date: x.date,
    check: x.check,
    baris: [
      { kode: "piutang_waktu", rp: rupiah(piutangSen) },
      { kode: "sisa", rp: rupiah(sisaSen) },
    ],
    easymax: { n: hariD.easymax.length, rp: rupiah(jumlahSen(hariD.easymax)) },
    bank: { n: hariD.bank.length, rp: rupiah(jumlahSen(hariD.bank)) },
    hariIni: hariD,
    sisaDiLuarToleransi,
    petunjuk,
    tanpaHariBerlawanan: piutangSen !== 0 && berlawanan.length === 0,
    aksi: piutangSen !== 0 ? "piutang_waktu" : sisaDiLuarToleransi ? "sisa_di_luar_toleransi" : null,
  };
}

/** KTD5 — kalimat baris 1 menurut tandanya. */
export function kalimatPiutangWaktu(p: PenjelasanSelisihArusKas): string | null {
  const s = p.baris[0].rp;
  const d = tanggalPendek(p.date);
  if (s < 0) return `Bank menerima Rp ${rpTeks(-s)} pada ${d}, tetapi EasyMax belum/tidak mencatat pembayarannya pada ${d}.`;
  if (s > 0) return `EasyMax mencatat pembayaran Rp ${rpTeks(s)} pada ${d}, tetapi rekening tidak menerimanya pada ${d}.`;
  return null;
}

/** R4 — kalimat pasangan persis, mis. "EasyMax mencatat pembayaran piutang Rp 123.196.000 (3 baris) pada 29 Okt — …". */
export function kalimatCocok(c: CocokPersis): string {
  const rinci = c.baris.map((b) => `${b.pelanggan} ${rpTeks(b.rp)}`).join(", ");
  return (
    `EasyMax mencatat pembayaran piutang Rp ${rpTeks(c.rp)} (${c.baris.length} baris) pada ${tanggalPendek(c.tanggalEasymax)} — ${rinci}; ` +
    `bank menerimanya pada ${tanggalPendek(c.tanggalBank)}.`
  );
}
