/**
 * Batas waktu buku besar (rencana 2026-11-02 K6; §10.51) — modul MURNI tanpa
 * impor, supaya komponen peramban (sidebar, pemilih tanggal) bisa memakainya.
 * `buku-besar-model.ts` mengekspor ulang {@link MULAI_BUKU_BESAR}: satu sumber.
 */

/** Buku besar dibentuk dari catatan sejak tanggal ini; bulan sebelumnya tidak punya buku besar. */
export const MULAI_BUKU_BESAR = "2026-10-01";
export const MULAI_BULAN_BUKU_BESAR = MULAI_BUKU_BESAR.slice(0, 7);

/**
 * Bulan buku besar untuk tanggal/bulan mana pun yang sedang dipilih: tanggal
 * sebelum mulai dijepit ke bulan mulai. Tautan yang dibangun dari tanggal
 * terpilih (sidebar, pemilih unit) memakai ini supaya tidak pernah menunjuk
 * bulan yang tak ada — pilih 30 Sep lalu klik "Buku besar" dulu berujung 404.
 */
export function bulanBukuBesar(tanggalAtauBulan: string): string {
  const b = tanggalAtauBulan.slice(0, 7);
  return b < MULAI_BULAN_BUKU_BESAR ? MULAI_BULAN_BUKU_BESAR : b;
}
