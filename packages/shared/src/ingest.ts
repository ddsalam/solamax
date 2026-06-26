import { z } from "zod";
import { DOMAINS } from "./domains.js";
import { ROW_SCHEMA } from "./rows.js";

/**
 * Kontrak payload POST /ingest. Lihat ARCHITECTURE.md §4.
 * `tables` = peta nama-tabel-target → array baris. Semua tabel dalam satu
 * payload di-commit atomik dengan satu watermark.
 */
export const IngestPayload = z.object({
  unit_code: z.string().min(1),
  domain: z.enum(DOMAINS),
  /** ISO UTC; null untuk masters (full sync, tanpa watermark). */
  watermark_high: z.string().datetime().nullable(),
  tables: z
    .object({
      sales_header: z.array(ROW_SCHEMA.sales_header).optional(),
      sales_detail: z.array(ROW_SCHEMA.sales_detail).optional(),
      cash_header: z.array(ROW_SCHEMA.cash_header).optional(),
      cash_detail: z.array(ROW_SCHEMA.cash_detail).optional(),
      opname: z.array(ROW_SCHEMA.opname).optional(),
      delivery: z.array(ROW_SCHEMA.delivery).optional(),
      product: z.array(ROW_SCHEMA.product).optional(),
      nozzle: z.array(ROW_SCHEMA.nozzle).optional(),
      tangki: z.array(ROW_SCHEMA.tangki).optional(),
      account: z.array(ROW_SCHEMA.account).optional(),
      real_tank: z.array(ROW_SCHEMA.real_tank).optional(),
      deposit: z.array(ROW_SCHEMA.deposit).optional(),
      edc: z.array(ROW_SCHEMA.edc).optional(),
      card: z.array(ROW_SCHEMA.card).optional(),
      pelanggan_sale: z.array(ROW_SCHEMA.pelanggan_sale).optional(),
      voucher_sale: z.array(ROW_SCHEMA.voucher_sale).optional(),
      tebus_header: z.array(ROW_SCHEMA.tebus_header).optional(),
      tebus_detail: z.array(ROW_SCHEMA.tebus_detail).optional(),
      tera: z.array(ROW_SCHEMA.tera).optional(),
    })
    .refine((t) => Object.values(t).some((rows) => rows && rows.length > 0), {
      message: "payload tidak boleh kosong — minimal satu tabel berisi baris",
    }),
});
export type IngestPayload = z.infer<typeof IngestPayload>;

/**
 * Batas keras baris per tabel per request /ingest. Sumber kebenaran tunggal
 * (backend menolak >ini; agent mem-batch ≤ini). Satu business_date REPLACE wajib
 * muat dalam SATU payload → date >cap = error keras (lihat agent batchByBusinessDate).
 */
export const MAX_ROWS_PER_TABLE = 5000;

export const IngestResponse = z.object({
  upserted: z.record(z.string(), z.number()),
  new_watermark: z.string().datetime().nullable(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;
