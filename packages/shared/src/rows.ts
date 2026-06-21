import { z } from "zod";

/**
 * Skema baris per tabel target (snake_case = nama kolom Postgres tujuan).
 * Dipakai agent untuk memvalidasi sebelum kirim, dan backend untuk validasi
 * sebelum UPSERT. Angka EasyMax bisa null; waktu rekam (dtgljam) sudah dikonversi
 * ke ISO UTC oleh agent sebelum masuk ke skema ini.
 */

const num = z.number().nullable();
const str = z.string().nullable();
/** ISO-8601 UTC, mis. "2026-06-11T07:30:00Z". */
const isoUtc = z.string().datetime();
/** Tanggal bisnis "YYYY-MM-DD". */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SalesHeaderRow = z.object({
  ckdjualbbm: z.string(),
  dtgljual: isoDate,
  nshift: z.number().int().nullable(),
  vcket: str,
});

export const SalesDetailRow = z.object({
  ckdjualbbm: z.string(),
  ckdnozzle: z.string(),
  nurut: z.number().int(),
  nstandawal: num,
  nstandakhir: num,
  nvolume: num,
  nhargajual: num,
  nsubtotal: num,
  ckdbbm: str,
  ckdtangki: str,
  vcopeator: str,
  dtgljam: isoUtc, // non-NULL — agent memfilter IS NOT NULL
  subah: z.number().int().nullable(),
  sedit: z.number().int().nullable(),
});

export const CashHeaderRow = z.object({
  ckdkb: z.string(),
  dtgl: isoDate,
  vcket: str,
  sjnstrans: z.number().int().nullable(),
  ntotal: num,
  vcref: str,
  ctmpkas: str,
  sbatal: z.number().int().nullable(),
});

export const CashDetailRow = z.object({
  ckdkb: z.string(),
  ckdperk: str,
  njumlah: num,
});

export const OpnameRow = z.object({
  ckdopnbbm: z.string(),
  ckdtangki: z.string(),
  ckdbbm: str,
  dtaglopn: isoDate.nullable(),
  nstockbk: num,
  nstockop: num,
  nvolselisih: num,
  dtgljam: isoUtc,
  sbatal: z.number().int().nullable(),
});

export const DeliveryRow = z.object({
  ckdtrm: z.string(),
  dtgltrm: isoDate.nullable(),
  dtgljam: isoUtc,
  cnodo: str,
  nvoldo: num,
  nvolreal: num,
  nvolselisih: num,
  cnopol: str,
  vcsopir: str,
  ckdtangki: str,
  ckdbbm: str,
  sbatal: z.number().int().nullable(),
});

/**
 * Snapshot ATG per tangki (sumber view `vw_realtm` — gabungan tb_realtank +
 * tm_tangki). Satu baris per tangki = pembacaan terkini. `ckdtangki` = kode
 * tangki kanonik ("T-0N", kunci natural, dipakai langsung — tanpa tebak id).
 * `nkapasitas` = kapasitas OTORITATIF yang ditampilkan EasyMax (mis. DEX 9.000),
 * BUKAN kalibrasi. Tinggi dalam mm di sumber.
 */
export const RealTankRow = z.object({
  ckdtangki: z.string(), // "T-0N" — kunci natural
  nkapasitas: num, // kapasitas otoritatif (L), dari vw_realtm
  ntinggi: num, // tinggi cairan BBM (mm)
  nvolume: num, // volume BBM kini (L)
  nsuhu: num, // suhu (°C)
  ntinggiair: num, // tinggi air dasar (mm)
  nvolumeair: num, // volume air (L)
  nstatus: z.number().int().nullable(),
  dtanggaljam: isoUtc, // waktu pembacaan (agent konversi WIB→UTC)
});

/**
 * Deposit prabayar pelanggan (sumber `tr_deposit`, PK `CKDDEPO`). Watermark =
 * `DTGL` (tanggal bisnis). `ckdplg` → master pelanggan (`tm_plg.CKDPLG`).
 * `sbatal` ditarik apa adanya; rescan window menangkap pembatalan menyusul.
 */
export const DepositRow = z.object({
  ckddepo: z.string(),
  dtgl: isoDate,
  ckdplg: str,
  ntotal: num,
  nsaldo: num,
  sbatal: z.number().int().nullable(),
  vcket: str,
});

/**
 * Penjualan tempo pelanggan (sub-A: sumber view `vw_jualplg` = pjualplg/RFID/
 * deposit). `business_date` = `DTGL` header (bersih). `vcnmplg` DI-DENORMALISASI
 * dari view (tak perlu master tm_plg). Idempotensi: REPLACE per (unit_id, business_date).
 */
export const PelangganSaleRow = z.object({
  business_date: isoDate,
  ckdplg: str,
  vcnmplg: str,
  ckdjualplg: str,
  ckdbbm: str,
  nshift: z.number().int().nullable(),
  liter: num,
  total: num,
  sbatal: z.number().int().nullable(),
});

/**
 * Penjualan voucher pelanggan (sub-B: sumber view `vw_usevouc`). Rupiah =
 * `NJUMLAHUSE`. Union dgn pelanggan_sale per `CKDPLG` (transaksi disjoint UV vs JP).
 */
export const VoucherSaleRow = z.object({
  business_date: isoDate,
  ckdplg: str,
  vcnmplg: str,
  ckdusevouc: str,
  ckdbbm: str,
  nshift: z.number().int().nullable(),
  liter: num,
  total: num,
  sbatal: z.number().int().nullable(),
});

/**
 * Transaksi EDC/non-tunai (sumber view `vw_edc3`). `business_date` = `ctgl`
 * (tanggal bisnis EasyMax 'YYYYMMDD' → 'YYYY-MM-DD'); `tanggaljam` = waktu rekam
 * (agent konversi WIB→UTC). `ckdkartu` null = kartu tak tercatat ("blank-card",
 * dikecualikan dari breakdown channel laporan tapi tetap disinkron + di-flag).
 * `tr_edc` TAK punya SBATAL → idempotensi via REPLACE per (unit_id, business_date).
 */
export const EdcRow = z.object({
  business_date: isoDate,
  cshift: str,
  tanggaljam: isoUtc,
  ckdkartu: str, // null = blank-card
  total: num,
  liter: num,
  jenis: z.number().int().nullable(),
  cnotrace: str,
  nonozle: str,
  jrnkey: z.number().int().nullable(),
});

export const ProductRow = z.object({
  ckdbbm: z.string(),
  vcnmbbm: str,
  nhrgjual: num,
  perk_map: z.record(z.string(), z.unknown()).nullable(),
});

export const NozzleRow = z.object({
  ckdnozzle: z.string(),
  ckdpompa: str,
  ckdtangki: str,
});

export const TangkiRow = z.object({
  ckdtangki: z.string(),
  ckdbbm: str,
  vcnmtangki: str,
});

export const AccountRow = z.object({
  ckdperk: z.string(),
  vcnmperk: str,
  ckdinduk: str,
});

/** Master kartu/channel EDC (sumber `tm_card`, PK `CKDCARD`). Nama channel di laporan. */
export const CardRow = z.object({
  ckdcard: z.string(),
  vcnmcard: str,
  ckdbank: str,
  cgl: str,
});

/** Map nama tabel → skema baris. */
export const ROW_SCHEMA = {
  sales_header: SalesHeaderRow,
  sales_detail: SalesDetailRow,
  cash_header: CashHeaderRow,
  cash_detail: CashDetailRow,
  opname: OpnameRow,
  delivery: DeliveryRow,
  product: ProductRow,
  nozzle: NozzleRow,
  tangki: TangkiRow,
  account: AccountRow,
  real_tank: RealTankRow,
  deposit: DepositRow,
  edc: EdcRow,
  card: CardRow,
  pelanggan_sale: PelangganSaleRow,
  voucher_sale: VoucherSaleRow,
} as const;

export type RowSchemaMap = typeof ROW_SCHEMA;
export type SalesHeaderRow = z.infer<typeof SalesHeaderRow>;
export type SalesDetailRow = z.infer<typeof SalesDetailRow>;
export type CashHeaderRow = z.infer<typeof CashHeaderRow>;
export type CashDetailRow = z.infer<typeof CashDetailRow>;
export type OpnameRow = z.infer<typeof OpnameRow>;
export type DeliveryRow = z.infer<typeof DeliveryRow>;
export type ProductRow = z.infer<typeof ProductRow>;
export type NozzleRow = z.infer<typeof NozzleRow>;
export type TangkiRow = z.infer<typeof TangkiRow>;
export type AccountRow = z.infer<typeof AccountRow>;
export type RealTankRow = z.infer<typeof RealTankRow>;
export type DepositRow = z.infer<typeof DepositRow>;
export type EdcRow = z.infer<typeof EdcRow>;
export type CardRow = z.infer<typeof CardRow>;
export type PelangganSaleRow = z.infer<typeof PelangganSaleRow>;
export type VoucherSaleRow = z.infer<typeof VoucherSaleRow>;
