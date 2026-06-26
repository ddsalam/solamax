/**
 * Ketersediaan domain pipeline (Fase 0 lock: Domain 4–7 belum di-ingest).
 *
 * UI untuk domain ini DISEMBUNYIKAN di v1 dan KEMBALI OTOMATIS begitu flag
 * di-flip ke `true` saat pipeline-nya landing — kode panel-nya tetap ada
 * (di-gate, bukan dihapus). Gunakan flag HANYA untuk panel yang sumber datanya
 * belum ada sama sekali; bagian yang sudah punya data nyata (mis. baris kas,
 * opname, penerimaan) di-gate pada PRESENCE data ("has rows") sehingga
 * self-heal tanpa menyentuh file ini.
 */
export const DOMAIN = {
  tera: true, // nozzle-test / kolom Tera + komponen Penjualan_BERSIH G/L (domain `tera` LIVE)
  pelanggan: false, // deposit & piutang pelanggan (C)
  edc: false, // settlement EDC (D)
  pendapatanLain: false, // pendapatan lain-lain (F)
  setoran: false, // setoran bank (I)
  do: true, // DO Harian (penebusan tr_htebus/tr_dtebus + running-balance) — LIVE

  hargaBeli: false, // harga beli & margin (master harga beli)
} as const;

/**
 * Rekonsiliasi A–I baru bermakna setelah semua komponen non-tunai tersedia
 * (B tera, C piutang, D EDC, F pendapatan lain, I setoran). Selama salah satu
 * belum ada, panel A–I & catatan "H = I" disembunyikan.
 */
export const REKON_READY =
  DOMAIN.tera && DOMAIN.pelanggan && DOMAIN.edc && DOMAIN.pendapatanLain && DOMAIN.setoran;
