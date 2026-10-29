/**
 * Pola validasi masukan bersama — modul murni (tanpa import server, BUKAN
 * "use server"), aman diimpor dari aksi, model, maupun komponen client.
 *
 * Pola tanggal `DATE_RE` tinggal di `selection-keys.ts` (sudah dipakai client).
 */

/** UUID kanonik (huruf besar/kecil). Tanpa flag `g` ⇒ `.test()` tak menyimpan keadaan. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
