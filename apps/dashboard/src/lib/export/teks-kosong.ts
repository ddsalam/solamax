/**
 * ⛔ SATU PEMBUAT VONIS untuk aturan yang berlaku di SEMUA medium ekspor:
 * **`null` bernama tetap bernama.**
 *
 * Layar sudah menaatinya. Kertas dan CSV adalah dua medium yang paling gampang
 * melanggarnya, dengan cara yang berbeda:
 *   · PDF  — sel kosong terbaca "tidak ada apa-apa di sini";
 *   · CSV  — sel kosong dibaca **Excel sebagai NOL**, dan angkanya lalu ikut
 *            dijumlahkan orang tanpa pernah tahu ia karangan.
 *
 * Karena itu tak ada satu pun penyaji yang boleh menulis string kosong untuk
 * `null`. Keduanya memanggil fungsi di berkas ini, dan mutasi yang melanggarnya
 * memerahkan uji PDF **dan** uji CSV sekaligus.
 */

/** Sel ringkas (tabel per-unit, CSV). */
export const KOSONG_RINGKAS = "belum dihitung";
/** Baris panel laporan (Cash Flow / Income / Balance). */
export const KOSONG_PANEL = "belum bisa dihitung";

/**
 * Angka untuk medium TEKS (CSV). `null` **tidak pernah** jadi string kosong.
 *
 * Angkanya sengaja **tanpa pemisah ribuan** dan memakai titik desimal: CSV
 * dibaca mesin sebelum dibaca orang, dan "1.234.567" gaya Indonesia akan
 * mendarat di Excel sebagai teks — atau lebih buruk, sebagai 1,234567.
 */
export function angkaTeks(v: number | null): string {
  return v === null ? KOSONG_RINGKAS : String(Math.round(v));
}

/**
 * Benar-benar kosong? Dipakai penjaga untuk membuktikan tak ada sel kosong yang
 * lolos — termasuk sel berisi spasi, yang Excel perlakukan sama saja.
 */
export function selKosong(s: string): boolean {
  return s.trim() === "";
}
