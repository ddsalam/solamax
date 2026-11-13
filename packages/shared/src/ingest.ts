import { z } from "zod";
import { DOMAINS, TABLES_BY_DOMAIN } from "./domains.js";
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

/**
 * Penutup siklus domain `tagihan` — daftar kunci LENGKAP header faktur dan
 * pembayaran yang dibaca agent pada siklus itu.
 *
 * Domain `tagihan` adalah snapshot penuh, tetapi UPSERT saja tak pernah
 * menghapus: faktur/pembayaran yang DIHAPUS di EasyMax (perilaku yang dikenal
 * sesudah dokumen ditanggal-ulang) akan tinggal abadi di mirror. Dengan manifest
 * ini backend, dalam SATU transaksi di bawah kunci per-unit, menghapus header &
 * pembayaran yang kuncinya tak terdaftar, menghapus tautan faktur yang tak ada
 * lagi, lalu menstempel waktu siklus-lengkap unit itu.
 *
 * Kontrak agent (tak bisa ditegakkan skema): manifest HANYA dikirim bila ketiga
 * kueri sumber berhasil DAN setiap potongan siklus itu sudah diterima. Tanpa
 * manifest, tak ada yang dipangkas.
 *
 * Empat penjaga backend (semuanya di dalam transaksi manifest; ditolak = HTTP
 * 409, SELURUH transaksi batal — tak ada yang terhapus, stempel tak bergerak):
 *  1. Daftar header KOSONG pada mirror yang masih berisi faktur ditolak, kecuali
 *     `izinkan_kosong`. "Tiga SELECT berhasil dengan nol baris" juga wujud agent
 *     yang menunjuk basis data kosong / baru separuh dipulihkan; itu tak boleh
 *     menghapus seluruh mirror unit. Daftar kosong pada mirror kosong tetap sah
 *     (unit yang memang tak punya faktur harus bisa berstempel siklus-lengkap).
 *  2. `chunk_token` harus sama dengan token potongan TERAKHIR yang diterima
 *     backend untuk unit itu. Manifest siklus lama yang mendarat sesudah potongan
 *     siklus baru membawa token basi → ditolak sebelum memangkas apa pun.
 *  3. Sesudah pangkas, jumlah header & pembayaran di mirror harus SAMA dengan
 *     jumlah kunci manifest. Kunci yang barisnya tak pernah tiba = siklus tak
 *     lengkap → ditolak.
 *  4. Manifest ber-`cycle_id` yang SUDAH distempel (kirim ulang sesudah balasan
 *     hilang) diterima tanpa mengerjakan apa pun.
 *
 * Sengaja BUKAN perluasan `source_cut`/`replace_window`: `source_cut` tertutup
 * untuk tiga sumber saldo dan tak pernah memangkas `public`; `replace_window`
 * berjendela tanggal, sedangkan faktur dipangkas per kunci.
 */

/**
 * Batas keras jumlah kunci PER DAFTAR di `tagihan_manifest`, dan panjang satu
 * kunci. Dipilih dengan margin di bawah batas body backend (`json({ limit:
 * "10mb" })` di apps/backend/src/main.ts = 10.485.760 byte):
 *   satu kunci ASCII terpanjang di JSON = 32 + 2 tanda kutip + 1 koma = 35 byte
 *   2 daftar × 100.000 kunci × 35 byte  = 7.000.000 byte (+ amplop < 1 KB)
 *   → ±67% dari batas; sisa ±3,4 MB.
 * Kunci nyata `CHAR(15)`: 2 × 100.000 × 18 byte = 3,6 MB. Karakter non-ASCII
 * bisa melampaui hitungan ini; karena itu agent JUGA mengukur byte payload
 * sebenarnya terhadap `MAX_TAGIHAN_MANIFEST_BYTES` sebelum mengirim.
 */
export const MAX_TAGIHAN_MANIFEST_KEYS = 100_000;
export const MAX_TAGIHAN_KEY_LENGTH = 32;
/** Anggaran byte payload manifest di sisi agent: 8 MiB dari batas body 10 MiB. */
export const MAX_TAGIHAN_MANIFEST_BYTES = 8 * 1024 * 1024;

const TagihanKey = z.string().min(1).max(MAX_TAGIHAN_KEY_LENGTH);
const tagihanKeys = (nama: string) =>
  z.array(TagihanKey).max(MAX_TAGIHAN_MANIFEST_KEYS, {
    message: `tagihan_manifest.${nama}: melampaui ${MAX_TAGIHAN_MANIFEST_KEYS} kunci — manifest tak muat dalam batas body backend`,
  });

export const TagihanManifest = z
  .object({
    cycle_id: z.string().uuid(),
    /** Seluruh `CKDTAGIH` di `tr_htagihan` (termasuk yang batal). */
    header_keys: tagihanKeys("header_keys"),
    /** Seluruh `CKDBYR` di `tr_byrtagih` (termasuk yang batal). */
    bayar_keys: tagihanKeys("bayar_keys"),
    /**
     * `tagihan_token` dari balasan potongan TERAKHIR siklus ini (nilai buram).
     * WAJIB bila ada kunci — manifest berisi selalu didahului potongan. Manifest
     * kosong (nol potongan) tak membawanya; ia dijaga `izinkan_kosong`.
     */
    chunk_token: z.string().min(1).max(128).optional(),
    /**
     * Pemulihan yang digerakkan OPERATOR: izinkan daftar header kosong menghapus
     * mirror yang masih berisi. Agent TIDAK PERNAH mengirimnya.
     */
    izinkan_kosong: z.literal(true).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.header_keys.length + m.bayar_keys.length > 0 && !m.chunk_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chunk_token"],
        message: "tagihan_manifest berisi kunci wajib membawa chunk_token (token potongan terakhir siklus itu)",
      });
    }
  });
export type TagihanManifest = z.infer<typeof TagihanManifest>;

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
    /** Hanya domain `tagihan`: penutup siklus + pemangkasan (lihat TagihanManifest). */
    tagihan_manifest: TagihanManifest.optional(),
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
      tagihan_header: z.array(ROW_SCHEMA.tagihan_header).optional(),
      tagihan_detail: z.array(ROW_SCHEMA.tagihan_detail).optional(),
      tagihan_bayar: z.array(ROW_SCHEMA.tagihan_bayar).optional(),
    }),
  })
  .superRefine((p, ctx) => {
    // Payload kosong hanya sah untuk DELETE-only window, marker full-sync, atau
    // manifest penutup siklus tagihan.
    const hasRows = Object.values(p.tables).some((rows) => rows && rows.length > 0);
    if (!hasRows && !p.replace_window && !p.source_cut && !p.tagihan_manifest) {
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
    if (p.tagihan_manifest) {
      if (p.domain !== "tagihan") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tagihan_manifest"],
          message: "tagihan_manifest hanya untuk domain tagihan",
        });
      }
      // Manifest = penutup siklus, dikirim SESUDAH semua potongan diterima; ia
      // tak pernah membawa baris. Baris + manifest sepayload akan mengaburkan
      // "siklus mana yang dinyatakan lengkap".
      if (hasRows) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tagihan_manifest"],
          message: "payload tagihan_manifest tidak boleh membawa baris",
        });
      }
    }
    // Tabel tagihan HANYA di domain tagihan, dan domain tagihan HANYA membawa
    // tabelnya sendiri. Di domain lain baris itu akan menghapus tautan faktur
    // TANPA kunci per-unit `tagihan` (kunci itu diambil per domain). Domain lain
    // sengaja tak diperketat di sini: keanggotaan tabel per domain mereka belum
    // pernah ditegakkan, dan mengubahnya bukan cakupan perubahan ini.
    const tagihanTables = TABLES_BY_DOMAIN.tagihan as readonly string[];
    for (const [table, rows] of Object.entries(p.tables)) {
      if (!rows || rows.length === 0) continue;
      if (tagihanTables.includes(table) !== (p.domain === "tagihan")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", table],
          message: p.domain === "tagihan"
            ? `domain tagihan hanya membawa tabel: ${tagihanTables.join(", ")}`
            : `tabel ${table} hanya untuk domain tagihan`,
        });
      }
    }
    // Tautan faktur diganti PER FAKTUR di backend (hapus tautan faktur-payload
    // yang tak ada di payload). Karena itu tautan tak boleh berjalan tanpa
    // header fakturnya: potongan dipecah per faktur, bukan per baris.
    const links = p.tables.tagihan_detail;
    if (links && links.length > 0) {
      const headers = new Set(
        (p.tables.tagihan_header ?? []).map((h) => h.ckdtagih.trimEnd()),
      );
      const yatim = links.find((l) => !headers.has(l.ckdtagih.trimEnd()));
      if (yatim) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", "tagihan_detail"],
          message: `tagihan_detail ${yatim.ckdtagih}: header fakturnya tidak ada di payload yang sama`,
        });
      }
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
  /**
   * Hanya balasan payload domain `tagihan`: penanda buram "payload tagihan
   * terakhir yang diterima untuk unit ini". Agent mengembalikan token potongan
   * TERAKHIR-nya sebagai `tagihan_manifest.chunk_token`.
   */
  tagihan_token: z.string().min(1).max(128).optional(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;
