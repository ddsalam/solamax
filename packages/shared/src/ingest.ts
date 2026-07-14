import { z } from "zod";
import { DOMAINS } from "./domains.js";
import { ROW_SCHEMA } from "./rows.js";

/**
 * Kontrak payload POST /ingest. Lihat ARCHITECTURE.md §4.
 * `tables` = peta nama-tabel-target → array baris. Semua tabel dalam satu
 * payload di-commit atomik dengan satu watermark.
 */
/** Domain yang boleh membawa `replace_window` (mirror = snapshot sumber per jendela). */
export const REPLACE_WINDOW_DOMAINS = ["tebus", "delivery"] as const;

export const IngestPayload = z
  .object({
    unit_code: z.string().min(1),
    domain: z.enum(DOMAINS),
    /** ISO UTC; null untuk masters (full sync, tanpa watermark). */
    watermark_high: z.string().datetime().nullable(),
    /**
     * REPLACE per jendela tanggal-bisnis [from, to): backend MENGHAPUS baris
     * mirror dalam jendela lalu INSERT baris payload — menangkap DELETE/renumber
     * di sumber yang UPSERT biasa tak pernah bersihkan (temuan Sisa DO Bakau
     * 2026-07-12: koreksi/hapus tr_htebus di luar window rescan = phantom
     * permanen). Hanya untuk domain REPLACE_WINDOW_DOMAINS; payload TANPA baris
     * sah (jendela kosong di sumber = DELETE-only). Jendela WAJIB utuh dalam
     * SATU payload (agent memecah jendela, bukan baris).
     */
    replace_window: z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .refine((w) => w.from < w.to, { message: "replace_window: from harus < to" })
      .optional(),
    tables: z.object({
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
      terra_resmi: z.array(ROW_SCHEMA.terra_resmi).optional(),
      bppiut: z.array(ROW_SCHEMA.bppiut).optional(),
      bphut: z.array(ROW_SCHEMA.bphut).optional(),
      pelanggan_master: z.array(ROW_SCHEMA.pelanggan_master).optional(),
    }),
  })
  .superRefine((p, ctx) => {
    // Payload kosong hanya sah bila replace_window hadir (DELETE-only window).
    const hasRows = Object.values(p.tables).some((rows) => rows && rows.length > 0);
    if (!hasRows && !p.replace_window) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tables"],
        message: "payload tidak boleh kosong — minimal satu tabel berisi baris",
      });
    }
    if (
      p.replace_window &&
      !(REPLACE_WINDOW_DOMAINS as readonly string[]).includes(p.domain)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replace_window"],
        message: `replace_window hanya untuk domain: ${REPLACE_WINDOW_DOMAINS.join(", ")}`,
      });
    }
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
