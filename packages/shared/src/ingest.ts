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
    })
    .refine((t) => Object.values(t).some((rows) => rows && rows.length > 0), {
      message: "payload tidak boleh kosong — minimal satu tabel berisi baris",
    }),
});
export type IngestPayload = z.infer<typeof IngestPayload>;

export const IngestResponse = z.object({
  upserted: z.record(z.string(), z.number()),
  new_watermark: z.string().datetime().nullable(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;
