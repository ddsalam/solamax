/**
 * Formula rekonsiliasi kas A–I — SUMBER TUNGGAL, murni, tanpa I/O.
 *
 * Diekstrak dari `rincian-model.ts` (dulu dihitung inline di sana) supaya layar
 * Rincian, ekspor PDF, DAN indikator Ketaatan Administrasi memakai aritmetika
 * yang SAMA PERSIS. Menyalin `H = E + F − G` ke file kedua = dua sumber
 * kebenaran yang akan berpisah diam-diam; jangan lakukan itu.
 *
 * ⚠️ SENGAJA TIDAK DIHITUNG DI SQL. Query kepatuhan mengembalikan komponen
 *    MENTAH (A,B,C,D,F,G) dan H diturunkan di sini. Kalau SQL ikut menghitung H,
 *    "satu sumber" bocor melewati batas TS/SQL dan tak ada tipe yang menahannya.
 */

export interface RekonKomponen {
  /** Omset penjualan (Σ sales_detail.nsubtotal). */
  A: number;
  /** Terra / nozzle test. */
  B: number;
  /** Pelanggan tempo (pelanggan_sale ⊎ voucher_sale). */
  C: number;
  /** EDC (channel ber-kartu). */
  D: number;
  /** Pendapatan lain — input pengawas. */
  F: number;
  /** Pengeluaran — input pengawas. */
  G: number;
}

/** E = A − (B + C + D) — Penjualan Tunai. */
export function penjualanTunai(k: Pick<RekonKomponen, "A" | "B" | "C" | "D">): number {
  return k.A - (k.B + k.C + k.D);
}

/** H = E + F − G — Uang Tunai yang seharusnya ada di tangan pengawas. */
export function uangTunai(k: RekonKomponen): number {
  return penjualanTunai(k) + k.F - k.G;
}
