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
 * Snapshot ATG per tangki (sumber `tb_realtank`). Satu baris per tangki =
 * pembacaan terkini (volume/tinggi/suhu/air). `tank_no` = kolom `id` EasyMax
 * (1..7) — dipetakan ke CKDTANGKI "T-0N" di dashboard. Tinggi dalam mm di sumber.
 */
export const RealTankRow = z.object({
  tank_no: z.number().int(),
  ntinggi: num, // tinggi cairan BBM (mm)
  nvolume: num, // volume BBM kini (L)
  nsuhu: num, // suhu (°C)
  ntinggiair: num, // tinggi air dasar (mm)
  nvolumeair: num, // volume air (L)
  nstatus: z.number().int().nullable(),
  dtanggaljam: isoUtc, // waktu pembacaan (agent konversi WIB→UTC)
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
