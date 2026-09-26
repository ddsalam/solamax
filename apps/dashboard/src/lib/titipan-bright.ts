/**
 * Titipan outlet Bright (KEUANGAN-HARIAN §10.27) — SATU tempat aturannya.
 *
 * ⛔ KEPUTUSAN OWNER 26 Sep 2026: "Setoran Bright" di Rincian Penjualan adalah
 * **titipan** hasil penjualan outlet Bright di tiap SPBU — BUKAN pendapatan SPBU.
 * Uangnya masuk laci & disetor bersama kas SPBU (jadi tetap ikut rekonsiliasi
 * kas pengawas, komponen F), tetapi ia UTANG kepada outlet Bright/SPH sampai
 * diserahkan.
 *
 * Akibat di laporan keuangan:
 *   · Laba rugi — TIDAK masuk pendapatan lain-lain;
 *   · Arus kas — baris sendiri "Titipan outlet Bright" (masuk − diserahkan);
 *   · Neraca — LIABILITAS "Titipan outlet Bright" = Σ titipan − Σ penyerahan
 *     sejak buku kas dimulai. Kas naik, utang naik, laba tak berubah ⇒ langkah
 *     harian tetap seimbang.
 *
 * Produksi 12–25 Sep 2026: 105 baris "setoran bright" di KETUJUH unit dicatat
 * sebagai pendapatan lain — laba SPBU lebih saji tiap hari.
 */

/** Kategori operasional (milik pengawas, §2.1) untuk baris titipan. */
export const KATEGORI_TITIPAN_BRIGHT = "Titipan outlet Bright";

/** Kategori mutasi kas (kredit, 0045) saat titipan diserahkan ke outlet Bright/SPH. */
export const KATEGORI_PENYERAHAN_TITIPAN = "Penyerahan titipan Bright";

/**
 * Baris LAMA (sebelum pilihan kategori ada) dikenali dari keterangannya:
 * kata "bright" atau "titipan" utuh. Hanya untuk baris TANPA kategori — begitu
 * pengawas memilih kategori, pilihannya yang berlaku, bukan tebakan ini.
 */
export const POLA_KETERANGAN_TITIPAN = /(^|[^a-z])(bright|titipan)([^a-z]|$)/i;

export interface BarisPendapatanLain {
  section: string;
  operationalCategory: string | null;
  keterangan: string;
}

/** Vonis tunggal (TS). Padanan SQL: {@link sqlTitipanBright}. */
export function isTitipanBright(r: BarisPendapatanLain): boolean {
  if (r.section !== "pendapatan_lain") return false;
  if (r.operationalCategory !== null) return r.operationalCategory === KATEGORI_TITIPAN_BRIGHT;
  return POLA_KETERANGAN_TITIPAN.test(r.keterangan);
}

/**
 * Padanan SQL dari {@link isTitipanBright} untuk alias tabel `manual_entry`.
 * Regex POSIX Postgres setara dengan pola TS di atas (`~*` = tak peka huruf).
 */
export function sqlTitipanBright(a: string): string {
  return `(${a}.section = 'pendapatan_lain' AND (
    ${a}.operational_category = '${KATEGORI_TITIPAN_BRIGHT}'
    OR (${a}.operational_category IS NULL
        AND ${a}.keterangan ~* '(^|[^a-z])(bright|titipan)([^a-z]|$)')))`;
}
