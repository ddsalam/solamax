/**
 * Kode alasan PEMBUKUAN MAJU (master `app.reason_code`, migrasi 0049) — satu
 * salinan untuk seluruh jalur Keuangan. Kode-kode ini diisi SISTEM saat sebuah
 * baris terdorong ke hari terbuka berikutnya (R28); HoF tak boleh memilihnya
 * sebagai alasan koreksi (lihat {@link PREFIKS_KODE_MAJU}).
 *
 * Modul murni — tanpa I/O, BUKAN "use server".
 */

/** Klasifikasi / pecahan mutasi rekening koran. */
export const KODE_MAJU_IMPOR = "ADJ-FWD-IMPORT";
/** Pasangan antar unit (kaki penerima). */
export const KODE_MAJU_INTERUNIT = "ADJ-FWD-INTERUNIT";
/** Penebusan BBM (pembelian). */
export const KODE_MAJU_PURCHASE = "ADJ-FWD-PURCHASE";
/** Pemindahan dari penampung (Mutasi Belum Teridentifikasi). */
export const KODE_MAJU_SUSPENSE = "ADJ-FWD-SUSPENSE";
/** Baris pembalik (selalu terdorong maju). */
export const KODE_MAJU_REVERSAL = "ADJ-FWD-REVERSAL";

/** Awalan bersama semua kode pembukuan maju. */
export const PREFIKS_KODE_MAJU = "ADJ-FWD-";
