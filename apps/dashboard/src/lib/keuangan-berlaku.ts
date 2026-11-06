/**
 * SATU aturan "baris `manual_entry` BERLAKU" — rencana 2026-11-07 (Batalkan &
 * Balik baris pintu Finance), KTD1/KTD2.
 *
 * Sebuah baris biaya/pendapatan lain-lain TIDAK BERLAKU bila ia di-void
 * (Batalkan, pembatalan pengawas, kaskade pembatalan mutasi kas). Baris yang
 * tidak berlaku bernilai NOL di setiap keluaran uang: Income Statement, Cash
 * Flow, langkah neraca, Papan, buku besar, titipan, "Perlu ditautkan", ekspor.
 *
 * ⛔ Kenapa satu tempat: aturan hanya berlaku di tempat penegakannya ditulis.
 * Sebelum berkas ini, setiap kueri menulis `NOT m.void`-nya sendiri, dan cabang
 * `keluar` di `pilahManualEntry` lupa — beban laporan benar hanya karena
 * `kumpulkanBeban` kebetulan menyaring lagi. Pembaca uang BARU memakai fragmen
 * di bawah; `keuangan-berlaku.guard.test.ts` memerah bila ada yang menulis
 * saringannya sendiri.
 *
 * Pembaca yang khusus baris PENGAWAS (Rincian, kepatuhan, setoran) dan penjaga
 * tulis tetap `NOT void` — terdaftar bernama di uji penjaga.
 */

/**
 * Ekspresi SQL boolean: baris `manual_entry` beralias `alias` TIDAK berlaku.
 * Dipakai sebagai kolom (`… AS void`, sehingga saringan hilir tetap satu
 * pertanyaan) atau sebagai saringan (`NOT ${SQL_ME_TAK_BERLAKU("m")}`).
 */
export const SQL_ME_TAK_BERLAKU = (alias: string): string => `(${alias}.void)`;

/** Sisi TypeScript aturan yang sama — untuk baris yang sudah dibaca dengan kolom `void`. */
export function barisBerlaku(r: { void: boolean }): boolean {
  return !r.void;
}
