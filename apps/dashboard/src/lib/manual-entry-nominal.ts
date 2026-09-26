/**
 * Konvensi TANDA `app.manual_entry.amount` — SATU tempat, dipakai setiap pembaca.
 *
 * ⛔ **Nominal selalu POSITIF; ARAH ditentukan SEKSI** (`pengeluaran` = keluar,
 * `pendapatan_lain`/`setoran_tunai` = masuk). Ini konvensi yang sejak awal
 * dipakai pintu pengawas (Rincian Penjualan, `addManualEntry` menolak ≤ 0) dan
 * yang dihitung rekonsiliasi Rincian & Ketaatan (komponen F/G/I).
 *
 * 🔴 **Cacat yang ditutup (26 Sep 2026).** Pintu Finance (`tambahBiayaFinance`)
 * menyimpan `pengeluaran` NEGATIF, dan laporan keuangan membalik tanda SEMUA
 * baris pengeluaran dengan anggapan semuanya negatif. Akibatnya beban pengawas
 * — yang positif — terbaca NEGATIF, lalu `biaya = −totalBeban` menjadikannya
 * POSITIF: **biaya pengawas MENAMBAH laba bersih**. Produksi IB 24-09-2026:
 * −113.532.683 + 12.484.800 **+ 6.204.800** = −94.843.083, seharusnya
 * −107.252.683. Uji per-pintu tidak pernah menangkapnya karena tak satu pun
 * memakai baris dari KEDUA pintu pada hari yang sama.
 *
 * Baris Finance yang terlanjur tersimpan negatif sebelum perbaikan TIDAK
 * disunting (hari tertutup mengunci `manual_entry`, dan menyunting sejarah
 * bukan pekerjaan migrasi) — ia dinormalkan SAAT DIBACA lewat ekspresi ini.
 * Baris pengawas dibaca apa adanya: nilainya tak disentuh sama sekali.
 */
export const NOMINAL_MANUAL_ENTRY_SQL =
  "(CASE WHEN source_door = 'finance' THEN abs(amount) ELSE amount END)";

/**
 * Padanan murni dari {@link NOMINAL_MANUAL_ENTRY_SQL} — untuk uji dan untuk
 * pemanggil yang sudah memegang barisnya. Keduanya WAJIB berbunyi sama.
 */
export function nominalManualEntry(r: { sourceDoor: string; amount: number }): number {
  return r.sourceDoor === "finance" ? Math.abs(r.amount) : r.amount;
}
