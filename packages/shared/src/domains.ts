import { z } from "zod";

/**
 * Domain = grup watermark untuk sinkronisasi. Satu domain bisa membawa
 * beberapa tabel target (mis. sales = sales_header + sales_detail) yang
 * di-commit atomik dengan satu watermark.
 */
export const DOMAINS = [
  "sales",
  "cash",
  "opname",
  "delivery",
  "masters",
  "realtank",
  "deposit",
  "edc",
  "pelanggan",
  "tebus",
  "tera",
  "terra_resmi",
  "piutang",
  "hutang",
] as const;
export type Domain = (typeof DOMAINS)[number];

/** Tabel target di Postgres cloud, per domain. */
export const TABLES_BY_DOMAIN = {
  sales: ["sales_header", "sales_detail"],
  cash: ["cash_header", "cash_detail"],
  opname: ["opname"],
  delivery: ["delivery"],
  masters: ["product", "nozzle", "tangki", "account", "card", "pelanggan_master"],
  // Snapshot ATG (Automatic Tank Gauge) keadaan-kini per tangki — full sync tiap
  // siklus (7 baris), bukan master. Sumber: tb_realtank.
  realtank: ["real_tank"],
  // Deposit prabayar pelanggan (tr_deposit) — full sync (tabel kecil).
  deposit: ["deposit"],
  // EDC/non-tunai (vw_edc3) — incremental per `ctgl`, REPLACE per business_date.
  edc: ["edc"],
  // Pelanggan tempo (vw_jualplg ⊎ vw_usevouc) — windowed DTGL, REPLACE per business_date.
  pelanggan: ["pelanggan_sale", "voucher_sale"],
  // Penebusan DO (tr_htebus ⋈ tr_dtebus) — windowed DTGLTBS (date), UPSERT by PK.
  // Sumber kolom "Penebusan DO" + basis running-balance DO Awal/Sisa di laporan.
  tebus: ["tebus_header", "tebus_detail"],
  // Tera/kalibrasi nozzle (tabel `tera`) — incremental TanggalJam (datetime),
  // UPSERT by surrogate key. Sumber kolom "Tera (L)" + komponen Penjualan_BERSIH
  // (= jual KOTOR − tera) di perhitungan Gain/Losses harian (selaras RESUME).
  tera: ["tera"],
  // Tera RESMI (ledger tr_hterra ⋈ tr_dterra) — full-sync, UPSERT by natural key
  // (ckdterra, ckdnozzle). SUMBER TUNGGAL semua angka terra laporan: Rincian B +
  // seksi TERRA + kolom "Tera (L)" Laporan + net-sales G/L (gross − tera RESMI).
  // Grup tanggal-bisnis = DTGLTERRA. `tera` mentah lama tetap di-sync tapi TIDAK
  // dipakai laporan mana pun (lihat ADR terra-unification 2026-06-29).
  terra_resmi: ["terra_resmi"],
  // Buku piutang pelanggan (tr_bppiut) — full-sync, UPSERT by PK CKDBPPIUT.
  // Saldo Piutang Lokal/Online (split via tm_plg.SJENIS) di Laporan Operasional.
  piutang: ["bppiut"],
  // Buku hutang pelanggan (tr_bphut) — full-sync, UPSERT by PK CKDBPHUT.
  // Saldo Hutang Lokal (negatif) di Laporan Operasional.
  hutang: ["bphut"],
} as const satisfies Record<Domain, readonly string[]>;

export type TargetTable =
  (typeof TABLES_BY_DOMAIN)[Domain][number];
