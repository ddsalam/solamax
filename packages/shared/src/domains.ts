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
] as const;
export type Domain = (typeof DOMAINS)[number];

/** Tabel target di Postgres cloud, per domain. */
export const TABLES_BY_DOMAIN = {
  sales: ["sales_header", "sales_detail"],
  cash: ["cash_header", "cash_detail"],
  opname: ["opname"],
  delivery: ["delivery"],
  masters: ["product", "nozzle", "tangki", "account", "card"],
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
} as const satisfies Record<Domain, readonly string[]>;

export type TargetTable =
  (typeof TABLES_BY_DOMAIN)[Domain][number];
