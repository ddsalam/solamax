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
  cnoso: str, // No. SO Pertamina — link ke tr_htebus.CNOSO (per-SO open-balance)
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

/**
 * Penebusan DO — header (sumber `tr_htebus`, PK `CKDTBS`). Watermark = `DTGLTBS`
 * (tanggal bisnis, kolom DATE tanpa jam → pola windowed à la cash). `sbatal`
 * ditarik apa adanya; rescan window menangkap pembatalan menyusul (difilter di
 * query dashboard, bukan di sync).
 */
export const TebusHeaderRow = z.object({
  ckdtbs: z.string(),
  dtgltbs: isoDate,
  cnoso: str, // No. SO Pertamina — kunci join penerimaan↔penebusan (per-SO)
  sbatal: z.number().int().nullable(),
});

/**
 * Penebusan DO — detail per produk (sumber `tr_dtebus`, grain `(CKDTBS,CKDBBM)`).
 * `nvolume` = volume DO yang ditebus (L). CATATAN: `tr_dtebus.NSISA` adalah KOLOM
 * MATI (selalu = NVOLUME; EasyMax hitung sisa live) → JANGAN di-sync/dipakai.
 */
export const TebusDetailRow = z.object({
  ckdtbs: z.string(),
  ckdbbm: str,
  nvolume: num,
});

/**
 * Tera/kalibrasi nozzle (sumber tabel `tera`, BUKAN `tr_tera` yang kosong).
 * Watermark = `TanggalJam` (datetime, agent konversi WIB→UTC; floor ≥ 2020-01-01
 * membuang baris 1980). `business_date` = tanggal bisnis WIB dari TanggalJam.
 * `ckdbbm` DI-RESOLVE di agent (join MySQL `tera → tm_tangki → tm_bbm`), produk
 * via nama (`tm_bbm.VCNMBBM`). `liter` = volume tera (L) yang dikurangkan dari
 * jual KOTOR untuk Penjualan_BERSIH (perhitungan Gain/Losses). `no_nozzle`/
 * `id_pompa`/`sa_tangki` = identifier mentah EasyMax (audit + idempotensi).
 * CATATAN: kunci join tera→tangki adalah ASUMSI yang DIPROBE di mesin SPBU
 * sebelum di-lock (lihat agent domains.ts).
 */
export const TeraRow = z.object({
  business_date: isoDate,
  tanggaljam: isoUtc,
  no_nozzle: str,
  id_pompa: z.number().int().nullable(),
  sa_tangki: z.number().int().nullable(),
  jenis: z.number().int().nullable(), // tipe baris tera (audit; tak memfilter — semua tera dihitung)
  ckdbbm: str,
  liter: num,
  total: num,
});

/**
 * Tera RESMI (ledger EasyMax `tr_hterra ⋈ tr_dterra`). SUMBER TUNGGAL semua angka
 * terra laporan (Rincian "Terra/Nozzle Test" B, seksi TERRA, kolom "Tera (L)"
 * Laporan, net-sales G/L = gross − Σ nvolume). BEDA dari tabel `tera` (log fisik
 * semua-pour) yang TIDAK dipakai laporan. `business_date` = `DTGLTERRA` (tanggal-
 * bisnis header, = DTGLJUAL jurnal penjualan tertaut `ckdjualbbm`), bukan jam pour.
 * Filter laporan: `sbatal = 0`. Natural key UPSERT = (unit_id, ckdterra, ckdnozzle);
 * produk resolve by name via `product.vcnmbbm` (dari `ckdbbm`). Rekon eksak 8/8 hari
 * ke RINCIAN PENJUALAN PDF (probe16, 2026-06-29).
 */
export const TerraResmiRow = z.object({
  business_date: isoDate, // DTGLTERRA
  ckdterra: z.string(), // header PK (NT…)
  ckdnozzle: z.string(), // detail nozzle (natural key dgn ckdterra)
  nshift: z.number().int().nullable(),
  ckdtangki: str,
  ckdbbm: str,
  nvolume: num, // Liter tera
  nharga: num, // harga/L (info)
  ntotal: num, // Rupiah tera (= B)
  dtgljam: isoUtc, // waktu pour (audit)
  ckdjualbbm: str, // FK jurnal penjualan tertaut
  sbatal: z.number().int().nullable(),
});

/**
 * Buku piutang pelanggan (sumber `tr_bppiut`, PK `CKDBPPIUT`). Ledger append-only;
 * saldo = `Σ NJUMLAH·sign(SJNSBP: 1=debet/+, 2=kredit/−)` per pelanggan, `DTGL < tanggal`.
 * Split Lokal/Online via `tm_plg.SJENIS` (lihat pelanggan_master). Full-sync (UPSERT
 * by PK menangkap baris back-dated + flip SBATAL). `ckdplg` → `tm_plg.CKDPLG`.
 */
export const BppiutRow = z.object({
  ckdbppiut: z.string(),
  dtgl: isoDate,
  ckdplg: str,
  vcref: str,
  vcket: str,
  njumlah: num,
  sjnsbp: z.number().int().nullable(),
  sbatal: z.number().int().nullable(),
});

/**
 * Buku hutang pelanggan (sumber `tr_bphut`, PK `CKDBPHUT`). Liabilitas SPBU ke
 * pelanggan (deposit/lebih-bayar). Saldo = `Σ NJUMLAH·sign(SJNSBP: 2=+, 1=−)`,
 * `DTGL < tanggal` (ditampilkan negatif/merah). Full-sync; UPSERT by PK.
 */
export const BphutRow = z.object({
  ckdbphut: z.string(),
  dtgl: isoDate,
  ckdplg: str,
  vcref: str,
  vcket: str,
  njumlah: num,
  sjnsbp: z.number().int().nullable(),
  sbatal: z.number().int().nullable(),
});

/**
 * Master pelanggan AR (sumber `tm_plg`, PK `CKDPLG`). `sjenis` = diskriminator
 * kelas (1,5=Lokal · 3=Online · 4=dorman, dikecualikan dari Saldo Piutang).
 * Full-sync (tabel kecil ~3k). NB: `pelanggan` (kartu RFID/kuota) ≠ master ini.
 */
export const PelangganMasterRow = z.object({
  ckdplg: z.string(),
  vcnmplg: str,
  sjenis: z.number().int().nullable(),
  saktif: z.number().int().nullable(),
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
  tebus_header: TebusHeaderRow,
  tebus_detail: TebusDetailRow,
  tera: TeraRow,
  terra_resmi: TerraResmiRow,
  bppiut: BppiutRow,
  bphut: BphutRow,
  pelanggan_master: PelangganMasterRow,
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
export type TebusHeaderRow = z.infer<typeof TebusHeaderRow>;
export type TebusDetailRow = z.infer<typeof TebusDetailRow>;
export type TeraRow = z.infer<typeof TeraRow>;
export type TerraResmiRow = z.infer<typeof TerraResmiRow>;
export type BppiutRow = z.infer<typeof BppiutRow>;
export type BphutRow = z.infer<typeof BphutRow>;
export type PelangganMasterRow = z.infer<typeof PelangganMasterRow>;
