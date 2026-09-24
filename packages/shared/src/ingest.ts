import { z } from "zod";
import { DOMAINS } from "./domains.js";
import { ROW_SCHEMA } from "./rows.js";

/**
 * Kontrak payload POST /ingest. Lihat ARCHITECTURE.md §4.
 * `tables` = peta nama-tabel-target → array baris. Semua tabel dalam satu
 * payload di-commit atomik dengan satu watermark.
 */
/**
 * Domain yang boleh membawa `replace_window` (mirror = snapshot sumber per jendela).
 *
 * `terra_resmi` ditambahkan 2026-09-01 setelah **tiga** kejadian produksi di mana
 * penghapusan permanen sesi tera di POS menjadi baris yatim ABADI di mirror —
 * full-sync + UPSERT murni menangkap koreksi nilai dan flip `SBATAL`, tapi tak
 * pernah menghapus. Kasus: BL `NT202600026` (13-08), 28 Oktober `NT202600074`
 * (29-08), IB `NT202600055` (27-08, Pertamax 4 L / Rp 65.200). Ketiganya hanya
 * bisa disembuhkan lewat DELETE manual ke Postgres produksi sebelum ini.
 */
export const REPLACE_WINDOW_DOMAINS = ["tebus", "delivery", "terra_resmi"] as const;

/** Tiga sumber lengkap yang membentuk satu source-cut saldo pelanggan. */
export const SOURCE_CUT_DOMAINS = ["pelanggan_master", "bppiut", "bphut"] as const;

export const SourceCut = z
  .object({
    cycle_id: z.string().uuid(),
    domain: z.enum(SOURCE_CUT_DOMAINS),
    chunk_index: z.number().int().nonnegative(),
    chunk_count: z.number().int().positive(),
    row_count: z.number().int().nonnegative(),
  })
  .refine((cut) => cut.chunk_index < cut.chunk_count, {
    path: ["chunk_index"],
    message: "source_cut.chunk_index harus < chunk_count",
  });
export type SourceCut = z.infer<typeof SourceCut>;

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
    /**
     * Hanya domain `sales`, hanya dari rescan per tanggal-bisnis (`SALES_RESYNC`),
     * yang selalu membawa SELURUH detail tiap header. Backend menghapus baris
     * `sales_detail` milik header-header itu yang `(ckdnozzle, nurut)`-nya tak ada
     * lagi di payload. Tanpa ini, baris shift-3 yang di-key pagi (NURUT 0, DTGLJAM
     * NULL) lalu ditulis ulang EasyMax sebagai NURUT 1 saat tutup shift tinggal
     * ABADI di mirror dan dihitung dua kali (Batu Layang 23-09-2026: +15.610,80 L /
     * Rp 196.068.215; 25-07-2026: +2.793,51 L). Jalur incremental (per DTGLJAM)
     * JANGAN memakainya — detail per header di sana parsial.
     */
    replace_details: z.literal(true).optional(),
    /** Metadata potongan full-sync untuk capture snapshot saldo yang durable. */
    source_cut: SourceCut.optional(),
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
    // Payload kosong hanya sah untuk DELETE-only window atau marker full-sync.
    const hasRows = Object.values(p.tables).some((rows) => rows && rows.length > 0);
    if (!hasRows && !p.replace_window && !p.source_cut) {
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
    if (p.replace_details && p.domain !== "sales") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replace_details"],
        message: "replace_details hanya untuk domain sales",
      });
    }
    if (p.source_cut) {
      const expected = {
        pelanggan_master: { domain: "masters", table: "pelanggan_master" },
        bppiut: { domain: "piutang", table: "bppiut" },
        bphut: { domain: "hutang", table: "bphut" },
      } as const;
      const binding = expected[p.source_cut.domain];
      if (p.domain !== binding.domain) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_cut", "domain"],
          message: `source_cut ${p.source_cut.domain} hanya sah untuk domain ${binding.domain}`,
        });
      }
      if (!Object.prototype.hasOwnProperty.call(p.tables, binding.table)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", binding.table],
          message: `source_cut ${p.source_cut.domain} wajib membawa key tabel ${binding.table}`,
        });
      }
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
