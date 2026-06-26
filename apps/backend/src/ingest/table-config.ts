/**
 * Konfigurasi UPSERT per tabel target. `columns` = key payload (snake_case,
 * sudah tervalidasi zod @solamax/shared) = nama kolom Postgres. `conflict` =
 * natural key target ON CONFLICT (lihat ARCHITECTURE.md §3 — TERKUNCI).
 * Identifier HANYA berasal dari konstanta ini (tak pernah dari input).
 */
export interface TableConfig {
  /** Nama tabel Postgres. */
  table: string;
  /** Kolom payload, urutan tetap. */
  columns: readonly string[];
  /** Target ON CONFLICT (selain unit_id yang selalu ikut). Kosong utk mode replace. */
  conflict: readonly string[];
  /** Punya kolom ingested_at yang di-refresh saat update. */
  hasIngestedAt: boolean;
  /**
   * REPLACE per (unit_id, business_date): DELETE baris business_date di payload
   * lalu INSERT — utk tabel tanpa PK baris bersih (edc/pelanggan_sale/voucher_sale).
   * Agent WAJIB mengirim satu business_date utuh per payload (jangan terpisah).
   */
  replaceByBusinessDate?: boolean;
  /**
   * Kolom yang DIJUMLAH saat dua baris berbagi conflict-key yang sama dalam satu
   * batch. Sumber bisa punya banyak baris per natural-key (mis. tr_dtebus: satu DO
   * menebus produk sama di beberapa baris) → tanpa agregasi, UPSERT gagal Postgres
   * 21000 ("ON CONFLICT … cannot affect row a second time"). Jaring backend
   * (defense-in-depth); agent idealnya sudah meng-agregat di sumber.
   */
  sumOnConflict?: readonly string[];
}

export const TABLE_CONFIG: Record<string, TableConfig> = {
  sales_header: {
    table: "sales_header",
    columns: ["ckdjualbbm", "dtgljual", "nshift", "vcket"],
    conflict: ["ckdjualbbm"],
    hasIngestedAt: false,
  },
  sales_detail: {
    table: "sales_detail",
    columns: [
      "ckdjualbbm", "ckdnozzle", "nurut", "nstandawal", "nstandakhir",
      "nvolume", "nhargajual", "nsubtotal", "ckdbbm", "ckdtangki",
      "vcopeator", "dtgljam", "subah", "sedit",
    ],
    conflict: ["ckdjualbbm", "ckdnozzle", "nurut"],
    hasIngestedAt: true,
  },
  cash_header: {
    table: "cash_header",
    columns: [
      "ckdkb", "dtgl", "vcket", "sjnstrans", "ntotal", "vcref", "ctmpkas", "sbatal",
    ],
    conflict: ["ckdkb"],
    hasIngestedAt: true,
  },
  cash_detail: {
    table: "cash_detail",
    columns: ["ckdkb", "ckdperk", "njumlah"],
    conflict: ["ckdkb", "ckdperk"],
    hasIngestedAt: true,
  },
  opname: {
    table: "opname",
    columns: [
      "ckdopnbbm", "ckdtangki", "ckdbbm", "dtaglopn", "nstockbk",
      "nstockop", "nvolselisih", "dtgljam", "sbatal",
    ],
    conflict: ["ckdopnbbm", "ckdtangki"],
    hasIngestedAt: true,
  },
  delivery: {
    table: "delivery",
    columns: [
      "ckdtrm", "dtgltrm", "dtgljam", "cnodo", "cnoso", "nvoldo", "nvolreal",
      "nvolselisih", "cnopol", "vcsopir", "ckdtangki", "ckdbbm", "sbatal",
    ],
    conflict: ["ckdtrm"],
    hasIngestedAt: true,
  },
  product: {
    table: "product",
    columns: ["ckdbbm", "vcnmbbm", "nhrgjual", "perk_map"],
    conflict: ["ckdbbm"],
    hasIngestedAt: false,
  },
  nozzle: {
    table: "nozzle",
    columns: ["ckdnozzle", "ckdpompa", "ckdtangki"],
    conflict: ["ckdnozzle"],
    hasIngestedAt: false,
  },
  tangki: {
    table: "tangki",
    columns: ["ckdtangki", "ckdbbm", "vcnmtangki"],
    conflict: ["ckdtangki"],
    hasIngestedAt: false,
  },
  account: {
    table: "account",
    columns: ["ckdperk", "vcnmperk", "ckdinduk"],
    conflict: ["ckdperk"],
    hasIngestedAt: false,
  },
  real_tank: {
    table: "real_tank",
    columns: [
      "ckdtangki", "nkapasitas", "ntinggi", "nvolume", "nsuhu",
      "ntinggiair", "nvolumeair", "nstatus", "dtanggaljam",
    ],
    conflict: ["ckdtangki"],
    hasIngestedAt: true,
  },

  // --- Rincian Penjualan (FASE 1b) ---
  // deposit: UPSERT by (unit_id, ckddepo); full-sync agent.
  deposit: {
    table: "deposit",
    columns: ["ckddepo", "dtgl", "ckdplg", "ntotal", "nsaldo", "sbatal", "vcket"],
    conflict: ["ckddepo"],
    hasIngestedAt: true,
  },
  // card: master EDC, UPSERT by (unit_id, ckdcard).
  card: {
    table: "card",
    columns: ["ckdcard", "vcnmcard", "ckdbank", "cgl"],
    conflict: ["ckdcard"],
    hasIngestedAt: false,
  },
  // edc/pelanggan_sale/voucher_sale: REPLACE per (unit_id, business_date).
  edc: {
    table: "edc",
    columns: [
      "business_date", "cshift", "tanggaljam", "ckdkartu", "total", "liter",
      "jenis", "cnotrace", "nonozle", "jrnkey",
    ],
    conflict: [],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
  pelanggan_sale: {
    table: "pelanggan_sale",
    columns: [
      "business_date", "ckdplg", "vcnmplg", "ckdjualplg", "ckdbbm", "nshift",
      "liter", "total", "sbatal",
    ],
    conflict: [],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
  // tebus: Penebusan DO (tr_htebus ⋈ tr_dtebus). UPSERT by PK (idempoten saat
  // re-pull window). header by (unit_id,ckdtbs); detail by (unit_id,ckdtbs,ckdbbm).
  tebus_header: {
    table: "tebus_header",
    columns: ["ckdtbs", "dtgltbs", "cnoso", "sbatal"],
    conflict: ["ckdtbs"],
    hasIngestedAt: true,
  },
  tebus_detail: {
    table: "tebus_detail",
    columns: ["ckdtbs", "ckdbbm", "nvolume"],
    conflict: ["ckdtbs", "ckdbbm"],
    hasIngestedAt: true,
    sumOnConflict: ["nvolume"], // satu DO bisa menebus produk sama di >1 baris
  },
  voucher_sale: {
    table: "voucher_sale",
    columns: [
      "business_date", "ckdplg", "vcnmplg", "ckdusevouc", "ckdbbm", "nshift",
      "liter", "total", "sbatal",
    ],
    conflict: [],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
};

/** Batas keras baris per tabel per request — sumber tunggal di @solamax/shared. */
export { MAX_ROWS_PER_TABLE } from "@solamax/shared";
