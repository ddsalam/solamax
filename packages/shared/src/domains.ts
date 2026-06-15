import { z } from "zod";

/**
 * Domain = grup watermark untuk sinkronisasi. Satu domain bisa membawa
 * beberapa tabel target (mis. sales = sales_header + sales_detail) yang
 * di-commit atomik dengan satu watermark.
 */
export const DOMAINS = ["sales", "cash", "opname", "delivery", "masters"] as const;
export type Domain = (typeof DOMAINS)[number];

/** Tabel target di Postgres cloud, per domain. */
export const TABLES_BY_DOMAIN = {
  sales: ["sales_header", "sales_detail"],
  cash: ["cash_header", "cash_detail"],
  opname: ["opname"],
  delivery: ["delivery"],
  masters: ["product", "nozzle", "tangki", "account"],
} as const satisfies Record<Domain, readonly string[]>;

export type TargetTable =
  (typeof TABLES_BY_DOMAIN)[Domain][number];
