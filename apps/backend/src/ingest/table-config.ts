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
  /** Target ON CONFLICT (selain unit_id yang selalu ikut). */
  conflict: readonly string[];
  /** Punya kolom ingested_at yang di-refresh saat update. */
  hasIngestedAt: boolean;
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
      "ckdtrm", "dtgltrm", "dtgljam", "cnodo", "nvoldo", "nvolreal",
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
};

/** Batas keras baris per tabel per request (kontrak ~1000; toleransi 5x). */
export const MAX_ROWS_PER_TABLE = 5000;
