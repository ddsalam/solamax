import { IngestPayload, MAX_ROWS_PER_TABLE } from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import type { EasyMaxConnection } from "./db/mysql.js";
import {
  CASH_DOMAIN,
  DATETIME_DOMAINS,
  DEPOSIT_DOMAIN,
  EDC_DOMAIN,
  MASTERS_DOMAIN,
  PELANGGAN_DOMAIN,
  REALTANK_DOMAIN,
  SALES_RESYNC,
  type DateTimeDomain,
} from "./domains.js";
import { IngestClient, IngestError } from "./ingest-client.js";
import { log } from "./logger.js";
import type { StateStore } from "./state/store.js";
import {
  businessDateToCtgl,
  ctglToBusinessDate,
  str,
  subtractDays,
  subtractMinutesIso,
  tzOffsetMinutes,
  utcIsoToWibString,
} from "./transform.js";

const RETRY = { retries: 4, baseDelayMs: 500 };
/** Sentinel cutoff bila belum ada watermark (tarik seluruh data live). */
const EPOCH_WIB = "1000-01-01 00:00:00";
const EPOCH_DATE = "1000-01-01";

type Tables = IngestPayload["tables"];

export interface SyncDeps {
  conn: EasyMaxConnection;
  client: IngestClient;
  store: StateStore;
  cfg: AgentConfig;
  dryRun: boolean;
}

function tableCounts(tables: Tables): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(tables)) if (v) out[k] = v.length;
  return out;
}

/**
 * Kirim payload. Mengembalikan "ok" bila terkirim, "buffered" bila backend
 * offline (disimpan ke buffer lokal untuk retry), melempar bila fatal (4xx).
 * Dalam dry-run: cetak ringkasan, tak mengirim.
 */
async function dispatch(
  d: SyncDeps,
  payload: IngestPayload,
): Promise<"ok" | "buffered" | "dry"> {
  IngestPayload.parse(payload); // tangkap bug mapping sebelum kirim/buffer

  if (d.dryRun) {
    log.info("[dry-run] payload", {
      domain: payload.domain,
      watermark_high: payload.watermark_high,
      counts: tableCounts(payload.tables),
    });
    return "dry";
  }

  try {
    const res = await d.client.sendWithRetry(payload, RETRY);
    log.info("ingest ok", { domain: payload.domain, upserted: res.upserted });
    return "ok";
  } catch (err) {
    if (err instanceof IngestError && err.retriable) {
      d.store.enqueue(payload);
      log.warn("backend offline → payload di-buffer", {
        domain: payload.domain,
        bufferDepth: d.store.bufferCount(),
      });
      return "buffered";
    }
    throw err; // fatal (auth/validasi) — perlu intervensi
  }
}

async function syncDatetimeDomain(
  d: SyncDeps,
  def: DateTimeDomain,
): Promise<void> {
  const offset = tzOffsetMinutes(d.cfg.timezone);
  const stored = d.store.getWatermark(def.domain); // UTC ISO | null
  const cycleStartIso = stored
    ? subtractMinutesIso(stored, d.cfg.sync.safetyWindowMin)
    : null;
  let bind = cycleStartIso ? utcIsoToWibString(cycleStartIso, offset) : EPOCH_WIB;

  for (;;) {
    const raw = await d.conn.roQuery<Record<string, unknown>>(def.sql, [
      bind,
      d.cfg.sync.batchSize,
    ]);
    if (raw.length === 0) break;

    // Halaman PENUH bisa memotong grup baris ber-DTGLJAM identik (satu shift
    // ditulis serentak) tepat di batas LIMIT → sisa grup hilang selamanya
    // karena bind berikutnya memakai `>`. Lengkapi grup boundary: buang baris
    // ber-timestamp tertinggi dari halaman, ambil SELURUH grup itu via query
    // terpisah, gabung (disjoint, tanpa duplikat).
    let merged = raw;
    if (raw.length === d.cfg.sync.batchSize) {
      const boundary = raw.reduce<string>((max, r) => {
        const v = String(r.DTGLJAM);
        return v > max ? v : max;
      }, "");
      const below = raw.filter((r) => String(r.DTGLJAM) !== boundary);
      const group = await d.conn.roQuery<Record<string, unknown>>(
        def.sqlBoundary,
        [boundary],
      );
      merged = [...below, ...group];
    }

    const page = def.map(merged, offset);
    if (page.watermarkHigh === null) break; // semua NULL (mustahil, jaga-jaga)

    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: def.domain,
      watermark_high: page.watermarkHigh,
      tables: page.tables,
    });

    // Watermark HANYA maju setelah batch sukses di-ingest backend. Saat
    // "buffered" (offline) watermark diam → siklus depan baca ulang dari MySQL;
    // duplikat aman karena UPSERT idempoten.
    if (status === "ok") d.store.setWatermark(def.domain, page.watermarkHigh);
    if (status === "buffered") break; // backend offline; lanjut siklus berikut
    if (d.dryRun) break; // dry-run cukup satu page agar ringan
    bind = utcIsoToWibString(page.watermarkHigh, offset); // maju, tanpa safety
    if (raw.length < d.cfg.sync.batchSize) break;
    // Paginasi terus sampai habis (backfill ~169k baris = ~169 batch dalam
    // satu run --once; tak perlu mode terpisah).
  }
}

/**
 * Re-sync SALES untuk rentang business-date [fromDate, toExcl) — dipecah per
 * window `salesResyncChunkDays` (anti-stall; base-table InnoDB, filter DTGLJUAL
 * ter-pushdown). UPSERT idempoten; **tak memajukan watermark DTGLJAM** (orthogonal
 * dgn sync incremental). Menangkap baris ber-DTGLJAM NULL (shift-3 di-key esok) yang
 * incremental buang selamanya. Kembalikan `false` bila ada batch tak "ok".
 */
async function syncSalesWindow(
  d: SyncDeps,
  fromDate: string,
  toExcl: string,
): Promise<boolean> {
  const offset = tzOffsetMinutes(d.cfg.timezone);
  const chunk = Math.max(1, d.cfg.sync.salesResyncChunkDays);
  let lo = fromDate;
  while (lo < toExcl) {
    let hiExcl = subtractDays(lo, -chunk); // lo + chunk hari
    if (hiExcl > toExcl) hiExcl = toExcl;

    const raw = await d.conn.roQuery<Record<string, unknown>>(SALES_RESYNC.sql, [
      lo,
      hiExcl,
    ]);
    const { sales_header, sales_detail } = SALES_RESYNC.map(raw, offset).tables;
    log.info("sales resync: window", {
      lo,
      hiExcl,
      header: sales_header.length,
      detail: sales_detail.length,
    });

    // Pecah per batchSize HEADER (detail ikut header-nya). Tanpa FK, urutan bebas;
    // kelompokkan agar payload < limit /ingest. Watermark TIDAK disentuh.
    for (let i = 0; i < sales_header.length; i += d.cfg.sync.batchSize) {
      const hChunk = sales_header.slice(i, i + d.cfg.sync.batchSize);
      const ids = new Set(hChunk.map((h) => h.ckdjualbbm));
      const dChunk = sales_detail.filter((x) => ids.has(x.ckdjualbbm));
      const status = await dispatch(d, {
        unit_code: d.cfg.unitCode,
        domain: "sales",
        watermark_high: null, // re-sync by business-date; jangan geser watermark DTGLJAM
        tables: { sales_header: hChunk, sales_detail: dChunk },
      });
      if (status !== "ok") return false; // buffered/dry — siklus depan ulang window
    }
    lo = hiExcl;
  }
  return true;
}

/**
 * Re-backfill SALES satu rentang tanggal-bisnis (inklusif kedua ujung), dipanggil
 * sekali dari CLI `--resync-sales <from> <to>`. Idempoten; aman diulang.
 */
export async function resyncSales(
  d: SyncDeps,
  fromDate: string,
  toDate: string,
): Promise<void> {
  const toExcl = subtractDays(toDate, -1); // inklusif `toDate`
  log.info("sales resync: mulai", { from: fromDate, to: toDate });
  const ok = await syncSalesWindow(d, fromDate, toExcl);
  log.info("sales resync: selesai", { from: fromDate, to: toDate, ok });
}

/**
 * Hardening steady-state: tiap siklus, re-UPSERT SALES jendela `salesRescanDays`
 * terakhir berbasis DTGLJUAL (pola cash). Menyembuhkan baris NULL-DTGLJAM &
 * back-dated tanpa menunggu intervensi. Murni UPSERT — aman & idempoten.
 */
async function syncSalesRescan(d: SyncDeps): Promise<void> {
  const todayWib = new Date(Date.now() + tzOffsetMinutes(d.cfg.timezone) * 60_000)
    .toISOString()
    .slice(0, 10);
  const from = subtractDays(todayWib, d.cfg.sync.salesRescanDays);
  const toExcl = subtractDays(todayWib, -1); // mencakup hari ini
  await syncSalesWindow(d, from, toExcl);
}

async function syncCash(d: SyncDeps): Promise<void> {
  // Re-scan BERJENDELA: dari (watermark DTGL − cashRescanDays). Full-scan 2.942
  // baris hanya terjadi sekali di run pertama (watermark kosong = backfill);
  // setelah itu tiap poll hanya membaca jendela 7 hari terakhir — saat kas
  // dipakai lagi pun tetap ringan.
  const stored = d.store.getWatermark("cash"); // "YYYY-MM-DD" | null
  const startDate = stored
    ? subtractDays(stored, d.cfg.sync.cashRescanDays)
    : EPOCH_DATE;

  const raw = await d.conn.roQuery(CASH_DOMAIN.sql, [startDate]);
  if (raw.length === 0) {
    log.info("kas: 0 baris (dorman sejak 2019 — normal)", { since: startDate });
    return;
  }
  const page = CASH_DOMAIN.map(raw);
  const headers = page.tables.cash_header ?? [];
  const details = page.tables.cash_detail ?? [];

  // Pecah per batchSize header (detail ikut header-nya) agar payload tak
  // melampaui limit /ingest. Watermark maju HANYA bila SEMUA chunk ter-ingest.
  let allOk = true;
  for (let i = 0; i < headers.length; i += d.cfg.sync.batchSize) {
    const hChunk = headers.slice(i, i + d.cfg.sync.batchSize);
    const ids = new Set(hChunk.map((h) => h.ckdkb));
    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: "cash",
      watermark_high: null, // kas berbasis tanggal; agent simpan watermark DTGL lokal
      tables: {
        cash_header: hChunk,
        cash_detail: details.filter((x) => ids.has(x.ckdkb)),
      },
    });
    if (status !== "ok") {
      allOk = false;
      break; // buffered/dry — sisa chunk dibaca ulang siklus depan
    }
  }
  if (allOk && !d.dryRun && page.watermarkHigh) {
    d.store.setWatermark("cash", page.watermarkHigh);
  }
}

async function syncDeposit(d: SyncDeps): Promise<void> {
  // FULL SYNC: tr_deposit kecil (~6k baris) → tarik SELURUH baris tiap siklus.
  // Menghilangkan gap SBATAL-flip telat sepenuhnya (pembatalan kapan pun selalu
  // ikut pull; EasyMax flag-batal, bukan hard-delete). UPSERT idempoten by
  // (unit_id, ckddepo). Tanpa watermark.
  const raw = await d.conn.roQuery(DEPOSIT_DOMAIN.sql);
  const rows = DEPOSIT_DOMAIN.map(raw);
  if (rows.length === 0) {
    log.info("deposit: 0 baris");
    return;
  }

  if (d.dryRun) {
    // Rekonsiliasi per tanggal bisnis (non-batal) untuk gate F1a — bandingkan
    // langsung ke PDF "Pendapatan Non Tunai" (mis. 17 Jun = 47.000.000 / 6).
    const byDate = new Map<string, { n: number; sum: number }>();
    for (const r of rows) {
      if (r.sbatal) continue;
      const e = byDate.get(r.dtgl) ?? { n: 0, sum: 0 };
      e.n += 1;
      e.sum += r.ntotal ?? 0;
      byDate.set(r.dtgl, e);
    }
    const recent = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(-15)
      .map(([dtgl, e]) => ({ dtgl, n: e.n, sum: e.sum }));
    const batal = rows.filter((r) => r.sbatal).length;
    log.info("[dry-run] deposit rekon per-tanggal (non-batal)", {
      total: rows.length,
      batal,
      recent,
    });
  }

  // Pecah per batchSize agar payload tak melampaui limit /ingest. Tanpa
  // watermark — siklus depan full-sync ulang (idempoten via UPSERT).
  for (let i = 0; i < rows.length; i += d.cfg.sync.batchSize) {
    const chunk = rows.slice(i, i + d.cfg.sync.batchSize);
    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: "deposit",
      watermark_high: null, // full-sync; tanpa watermark
      tables: { deposit: chunk },
    });
    if (status !== "ok") break; // buffered/dry — sisa chunk dibaca ulang siklus depan
  }
}

type EdcRow = NonNullable<Tables["edc"]>[number];

/**
 * Rekonsiliasi EDC dry-run (gate F1a): per-channel per-business_date (nama via
 * tm_card), blank-card DITAMPILKAN TERPISAH (flag kepatuhan, keputusan #3), +
 * diagnostik keunikan komposit (step-1: tentukan UNIQUE vs surrogate+replace).
 */
async function logEdcRecon(d: SyncDeps, rows: EdcRow[]): Promise<void> {
  const cards = await d.conn.roQuery<Record<string, unknown>>(
    "SELECT CKDCARD, VCNMCARD FROM tm_card",
  );
  const name = new Map<string, string>();
  for (const c of cards) {
    const code = String(c.CKDCARD).trim();
    name.set(code, str(c.VCNMCARD) ?? code);
  }

  // Step-1 keunikan: komposit vs +rich(jrnkey,jenis). Bebas-tabrakan → boleh UNIQUE.
  const comp = new Set<string>();
  const rich = new Set<string>();
  for (const r of rows) {
    const k = `${r.tanggaljam}|${r.nonozle ?? ""}|${r.cnotrace ?? ""}|${r.total ?? ""}|${r.ckdkartu ?? ""}`;
    comp.add(k);
    rich.add(`${k}|${r.jrnkey ?? ""}|${r.jenis ?? ""}`);
  }
  log.info("[dry-run] EDC keunikan komposit (step-1)", {
    total: rows.length,
    distinct_komposit: comp.size,
    tabrakan_komposit: rows.length - comp.size,
    distinct_rich: rich.size,
    tabrakan_rich: rows.length - rich.size,
    keputusan:
      rows.length - comp.size === 0
        ? "komposit bebas-tabrakan → UNIQUE boleh"
        : "ADA tabrakan → surrogate id + REPLACE per business_date (jangan collapse)",
  });

  interface Agg {
    channelSum: number;
    blankSum: number;
    blankN: number;
    perChannel: Map<string, { sum: number; n: number }>;
  }
  const byDate = new Map<string, Agg>();
  for (const r of rows) {
    let a = byDate.get(r.business_date);
    if (!a) {
      a = { channelSum: 0, blankSum: 0, blankN: 0, perChannel: new Map() };
      byDate.set(r.business_date, a);
    }
    if (r.ckdkartu === null) {
      a.blankSum += r.total ?? 0;
      a.blankN += 1;
    } else {
      a.channelSum += r.total ?? 0;
      const c = a.perChannel.get(r.ckdkartu) ?? { sum: 0, n: 0 };
      c.sum += r.total ?? 0;
      c.n += 1;
      a.perChannel.set(r.ckdkartu, c);
    }
  }

  for (const dt of [...byDate.keys()].sort().slice(-7)) {
    const a = byDate.get(dt)!;
    const breakdown = [...a.perChannel.entries()]
      .map(([code, v]) => ({ kartu: name.get(code) ?? code, n: v.n, sum: v.sum }))
      .sort((x, y) => y.sum - x.sum);
    log.info("[dry-run] EDC rekon per-tanggal", {
      business_date: dt,
      channels: breakdown.length, // bandingkan jumlah channel ke PDF (11/9/…)
      channel_sum: a.channelSum, // = D EDC di PDF
      blank_card_sum: a.blankSum, // TERPISAH — dikecualikan channel-sum (flag)
      blank_card_n: a.blankN,
      breakdown,
    });
  }
}

/**
 * Pecah baris jadi batch yang menjaga SATU business_date utuh per batch (≤ batchSize)
 * — wajib utk tabel REPLACE-per-business_date (edc/pelanggan_sale/voucher_sale):
 * bila satu tanggal terpisah ke dua payload, DELETE payload-2 menghapus insert
 * payload-1. Baris masuk sudah ORDER BY business_date (tanggal kontigu).
 */
export function batchByBusinessDate<T extends { business_date: string }>(
  rows: readonly T[],
  batchSize: number,
): T[][] {
  const byDate = new Map<string, T[]>();
  for (const r of rows) {
    const arr = byDate.get(r.business_date);
    if (arr) arr.push(r);
    else byDate.set(r.business_date, [r]);
  }
  const batches: T[][] = [];
  let cur: T[] = [];
  for (const [date, dateRows] of byDate) {
    // GUARD: satu business_date > cap payload → tak muat satu payload → REPLACE
    // per-date akan pecah antar payload & DELETE-2 menghapus INSERT-1. Error keras
    // (kasus praktis mustahil di SPBU: ~370 baris/hari/unit). Bila suatu saat nyata
    // → butuh strategi DELETE-once-then-append di backend.
    if (dateRows.length > MAX_ROWS_PER_TABLE) {
      throw new Error(
        `business_date ${date}: ${dateRows.length} baris > cap ${MAX_ROWS_PER_TABLE} — REPLACE per business_date butuh satu payload utuh; perlu strategi DELETE-once-append.`,
      );
    }
    if (cur.length > 0 && cur.length + dateRows.length > batchSize) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...dateRows); // satu tanggal tak pernah dipecah (walau > batchSize)
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

async function syncEdc(d: SyncDeps): Promise<void> {
  // Incremental per ctgl (business-date EasyMax) + rescan window. Backfill penuh
  // hanya di run pertama live; dry-run dibatasi ~14 hari terakhir agar ringan.
  const offset = tzOffsetMinutes(d.cfg.timezone);
  const stored = d.store.getWatermark("edc"); // "YYYY-MM-DD" | null
  let startCtgl: string;
  if (stored) {
    startCtgl = businessDateToCtgl(subtractDays(stored, d.cfg.sync.edcRescanDays));
  } else if (d.dryRun) {
    const mx = await d.conn.roQuery<{ m: unknown }>("SELECT MAX(ctgl) AS m FROM vw_edc3");
    const maxBd = ctglToBusinessDate(str(mx[0]?.m));
    startCtgl = maxBd ? businessDateToCtgl(subtractDays(maxBd, 14)) : "10000101";
  } else {
    startCtgl = "10000101"; // backfill penuh (production, sekali)
  }

  const raw = await d.conn.roQuery(EDC_DOMAIN.sql, [startCtgl]);
  if (raw.length === 0) {
    log.info("edc: 0 baris", { sinceCtgl: startCtgl });
    return;
  }
  const { rows, businessDateHigh } = EDC_DOMAIN.map(raw, offset);

  if (d.dryRun) await logEdcRecon(d, rows);

  // Kirim per-batch UTUH-PER-TANGGAL. Backend REPLACE per (unit_id, business_date)
  // — EDC tanpa SBATAL; replace menangkap koreksi & buang baris usang.
  for (const chunk of batchByBusinessDate(rows, d.cfg.sync.batchSize)) {
    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: "edc",
      watermark_high: null, // business-date; watermark disimpan lokal
      tables: { edc: chunk },
    });
    if (status !== "ok") return; // buffered/dry — siklus depan ulang window
  }
  if (!d.dryRun && businessDateHigh) d.store.setWatermark("edc", businessDateHigh);
}

type PelangganSaleRow = NonNullable<Tables["pelanggan_sale"]>[number];
type VoucherSaleRow = NonNullable<Tables["voucher_sale"]>[number];

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Rekonsiliasi pelanggan dry-run (gate F1a): union `vw_jualplg` ⊎ `vw_usevouc`
 * SUM per CKDPLG by business_date (non-batal) → Rp + Liter + jumlah plg vs PDF.
 * Cetak: kontribusi sale vs voucher (voucher liter = HARD-GATE), `overlap_ckdplg`
 * (hard-check anti-double-count), + breakdown per pelanggan (nama denormal).
 */
function logPelangganRecon(
  saleRows: PelangganSaleRow[],
  voucherRows: VoucherSaleRow[],
): void {
  const sale = saleRows.filter((r) => !r.sbatal);
  const vou = voucherRows.filter((r) => !r.sbatal);

  interface Cust {
    name: string;
    liter: number;
    rp: number;
    inSale: boolean;
    inVou: boolean;
  }
  const byDate = new Map<string, Map<string, Cust>>();
  const add = (
    date: string,
    ckdplg: string | null,
    name: string | null,
    liter: number | null,
    rp: number | null,
    src: "sale" | "vou",
  ): void => {
    let m = byDate.get(date);
    if (!m) {
      m = new Map();
      byDate.set(date, m);
    }
    const key = ckdplg ?? "(null)";
    let c = m.get(key);
    if (!c) {
      c = { name: name ?? key, liter: 0, rp: 0, inSale: false, inVou: false };
      m.set(key, c);
    }
    c.liter += liter ?? 0;
    c.rp += rp ?? 0;
    if (src === "sale") c.inSale = true;
    else c.inVou = true;
    if ((!c.name || c.name === key) && name) c.name = name;
  };
  for (const r of sale) add(r.business_date, r.ckdplg, r.vcnmplg, r.liter, r.total, "sale");
  for (const r of vou) add(r.business_date, r.ckdplg, r.vcnmplg, r.liter, r.total, "vou");

  const subAgg = (rows: Array<{ business_date: string; ckdplg: string | null; liter: number | null; total: number | null }>) => {
    const m = new Map<string, { liter: number; rp: number; plg: Set<string> }>();
    for (const r of rows) {
      let e = m.get(r.business_date);
      if (!e) {
        e = { liter: 0, rp: 0, plg: new Set() };
        m.set(r.business_date, e);
      }
      e.liter += r.liter ?? 0;
      e.rp += r.total ?? 0;
      if (r.ckdplg) e.plg.add(r.ckdplg);
    }
    return m;
  };
  const saleByDate = subAgg(sale);
  const vouByDate = subAgg(vou);

  for (const dt of [...byDate.keys()].sort().slice(-7)) {
    const m = byDate.get(dt)!;
    let liter = 0;
    let rp = 0;
    let overlap = 0;
    const breakdown: Array<{ plg: string; liter: number; rp: number }> = [];
    for (const c of m.values()) {
      liter += c.liter;
      rp += c.rp;
      if (c.inSale && c.inVou) overlap += 1;
      breakdown.push({ plg: c.name, liter: r2(c.liter), rp: Math.round(c.rp) });
    }
    breakdown.sort((a, b) => b.rp - a.rp);
    const sv = saleByDate.get(dt) ?? { liter: 0, rp: 0, plg: new Set<string>() };
    const vv = vouByDate.get(dt) ?? { liter: 0, rp: 0, plg: new Set<string>() };
    log.info("[dry-run] pelanggan rekon per-tanggal", {
      business_date: dt,
      plg: m.size, // distinct CKDPLG → bandingkan jumlah pelanggan PDF (18/48/…)
      liter: r2(liter), // → bandingkan Volume PDF
      rp: Math.round(rp), // → bandingkan Rp PDF
      from_sale: { plg: sv.plg.size, liter: r2(sv.liter), rp: Math.round(sv.rp) },
      from_voucher: { plg: vv.plg.size, liter: r2(vv.liter), rp: Math.round(vv.rp) }, // voucher HARD-GATE
      overlap_ckdplg: overlap, // hard-check anti-double-count (CKDPLG di KEDUA view)
      breakdown,
    });
  }
}

/** Batas atas sentinel utk window tunggal (inkremental/dry-run): praktis tak terbatas. */
const PELANGGAN_FAR_FUTURE = "9999-12-31";

/** dtglHigh tertinggi dari dua kandidat (mana pun boleh null). */
function higherDate(a: string | null, b: string | null): string | null {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** Tarik satu window [lo, hiExcl) dari kedua view, kembalikan hasil ter-map. */
async function pullPelangganWindow(
  d: SyncDeps,
  lo: string,
  hiExcl: string,
): Promise<{
  sale: ReturnType<typeof PELANGGAN_DOMAIN.mapSale>;
  vou: ReturnType<typeof PELANGGAN_DOMAIN.mapVoucher>;
}> {
  const saleRaw = await d.conn.roQuery(PELANGGAN_DOMAIN.saleSql, [lo, hiExcl]);
  const vouRaw = await d.conn.roQuery(PELANGGAN_DOMAIN.voucherSql, [lo, hiExcl]);
  return {
    sale: PELANGGAN_DOMAIN.mapSale(saleRaw),
    vou: PELANGGAN_DOMAIN.mapVoucher(vouRaw),
  };
}

/**
 * Kirim baris pelanggan UTUH-PER-TANGGAL per tabel. Backend REPLACE per
 * (unit_id, business_date) → satu business_date tak boleh terpisah antar payload.
 * Kembalikan `false` bila ada batch tak "ok" (buffered/dry) → pemanggil berhenti
 * TANPA memajukan watermark (siklus depan ulang).
 */
async function dispatchPelanggan(
  d: SyncDeps,
  saleRows: PelangganSaleRow[],
  vouRows: VoucherSaleRow[],
): Promise<boolean> {
  for (const chunk of batchByBusinessDate(saleRows, d.cfg.sync.batchSize)) {
    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: "pelanggan",
      watermark_high: null,
      tables: { pelanggan_sale: chunk },
    });
    if (status !== "ok") return false;
  }
  for (const chunk of batchByBusinessDate(vouRows, d.cfg.sync.batchSize)) {
    const status = await dispatch(d, {
      unit_code: d.cfg.unitCode,
      domain: "pelanggan",
      watermark_high: null,
      tables: { voucher_sale: chunk },
    });
    if (status !== "ok") return false;
  }
  return true;
}

async function syncPelanggan(d: SyncDeps): Promise<void> {
  const stored = d.store.getWatermark("pelanggan"); // "YYYY-MM-DD" | null
  const todayWib = new Date(Date.now() + tzOffsetMinutes(d.cfg.timezone) * 60_000)
    .toISOString()
    .slice(0, 10);

  // ── Jalur steady-state (watermark ada) & dry-run: window tunggal terbatas-baru.
  // vw_jualplg/vw_usevouc difilter DTGL>=startDate (pushdown MERGE = ringan); batas
  // atas = sentinel jauh. JANGAN MAX(DTGL) atas view (agregat = materialisasi 288k).
  if (stored || d.dryRun) {
    const startDate = stored
      ? subtractDays(stored, d.cfg.sync.pelangganRescanDays)
      : subtractDays(todayWib, 8); // dry-run gate: cukup tampil 14–18 Jun, ringan
    log.info("pelanggan: tarik window", { since: startDate });
    const { sale, vou } = await pullPelangganWindow(d, startDate, PELANGGAN_FAR_FUTURE);
    log.info("pelanggan: window ok", { sale: sale.rows.length, vou: vou.rows.length });
    if (sale.rows.length === 0 && vou.rows.length === 0) {
      log.info("pelanggan: 0 baris", { since: startDate });
      return;
    }
    if (d.dryRun) logPelangganRecon(sale.rows, vou.rows);
    if (!(await dispatchPelanggan(d, sale.rows, vou.rows))) return;
    const high = higherDate(sale.dtglHigh, vou.dtglHigh);
    if (!d.dryRun && high) d.store.setWatermark("pelanggan", high);
    return;
  }

  // ── Backfill penuh (produksi, sekali): JALAN-MUNDUR per window agar tiap query
  // vw_jualplg ter-bound (filter DTGL) — hindari materialisasi 288k sekaligus yang
  // STALL di mesin SPBU. Berhenti setelah 3 window kosong beruntun (lewat awal data)
  // atau capai floor ~3 thn (guard anti-loop). Watermark di-set hanya di AKHIR →
  // Ctrl-C di tengah aman (re-run mengulang backfill; REPLACE per-tanggal idempoten).
  const chunkDays = d.cfg.sync.pelangganChunkDays;
  const floor = subtractDays(todayWib, 366 * 3);
  let hiExcl = subtractDays(todayWib, -1); // besok (inklusif hari ini)
  let emptyStreak = 0;
  let high: string | null = null;
  let windows = 0;
  let landed = 0;
  while (true) {
    const lo = subtractDays(hiExcl, chunkDays);
    const { sale, vou } = await pullPelangganWindow(d, lo, hiExcl);
    const n = sale.rows.length + vou.rows.length;
    log.info("pelanggan backfill: window", {
      lo,
      hiExcl,
      sale: sale.rows.length,
      vou: vou.rows.length,
    });
    if (n === 0) {
      emptyStreak += 1;
    } else {
      emptyStreak = 0;
      if (!(await dispatchPelanggan(d, sale.rows, vou.rows))) return; // buffered → re-run
      high = higherDate(high, higherDate(sale.dtglHigh, vou.dtglHigh));
      landed += n;
    }
    windows += 1;
    if (emptyStreak >= 3) {
      log.info("pelanggan backfill: selesai (3 window kosong beruntun)", { windows, landed });
      break;
    }
    if (lo <= floor) {
      log.info("pelanggan backfill: capai floor", { floor, windows, landed });
      break;
    }
    hiExcl = lo;
  }
  if (high) d.store.setWatermark("pelanggan", high);
}

async function syncMasters(d: SyncDeps): Promise<void> {
  const tables: Tables = {};
  // Isolasi per tabel master: satu query gagal (mis. nama kolom beda antar
  // versi EasyMax) tak boleh memblokir master lain — log & lanjut.
  for (const q of MASTERS_DOMAIN.queries) {
    try {
      const raw = await d.conn.roQuery(q.sql);
      (tables as Record<string, unknown[]>)[q.table as string] = q.map(raw);
    } catch (err) {
      log.error("master gagal — dilewati", { table: q.table, err: String(err) });
    }
  }
  if (Object.values(tables).every((rows) => !rows || rows.length === 0)) return;
  await dispatch(d, {
    unit_code: d.cfg.unitCode,
    domain: "masters",
    watermark_high: null,
    tables,
  });
}

async function syncRealTank(d: SyncDeps): Promise<void> {
  // Snapshot keadaan-kini: 7 baris (1 per tangki), full sync tiap siklus agar
  // monitoring realtime tetap segar. Tanpa watermark (keadaan ditimpa, bukan log).
  const offset = tzOffsetMinutes(d.cfg.timezone);
  const raw = await d.conn.roQuery<Record<string, unknown>>(REALTANK_DOMAIN.sql);
  const rows = REALTANK_DOMAIN.map(raw, offset);
  if (rows.length === 0) {
    log.info("realtank: 0 baris (tb_realtank kosong)");
    return;
  }
  await dispatch(d, {
    unit_code: d.cfg.unitCode,
    domain: "realtank",
    watermark_high: null, // keadaan-kini; tak ada watermark
    tables: { real_tank: rows },
  });
}

/**
 * Satu siklus penuh. Master di-sync hanya bila `includeMasters`; pelanggan (BERAT
 * — union view) hanya bila `includePelanggan` (poll jarang, lihat runForever).
 */
export async function runCycle(
  d: SyncDeps,
  opts: { includeMasters: boolean; includePelanggan: boolean },
): Promise<void> {
  // Flush buffer dulu (FIFO). Bila backend masih offline → lewati live agar
  // urutan terjaga & buffer tak membengkak tak terkendali.
  if (!d.dryRun && d.store.bufferCount() > 0) {
    try {
      const sent = await d.store.drainBuffer((p) =>
        d.client.sendWithRetry(p, RETRY).then(() => undefined),
      );
      log.info("buffer ter-flush", { sent });
    } catch (err) {
      log.warn("backend masih offline — lewati siklus live", {
        err: String(err),
        bufferDepth: d.store.bufferCount(),
      });
      return;
    }
  }

  // Isolasi per domain: kegagalan satu domain (skema/SQL) tak menghentikan
  // domain lain; watermark domain gagal tak bergeser → dicoba lagi siklus depan.
  for (const def of DATETIME_DOMAINS) {
    try {
      await syncDatetimeDomain(d, def);
    } catch (err) {
      log.error("domain gagal — dilewati siklus ini", {
        domain: def.domain,
        err: String(err),
      });
    }
  }
  // Hardening: rescan SALES per business-date (sembuhkan NULL-DTGLJAM/back-dated).
  try {
    await syncSalesRescan(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "sales-rescan",
      err: String(err),
    });
  }
  try {
    await syncCash(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "cash",
      err: String(err),
    });
  }
  try {
    await syncDeposit(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "deposit",
      err: String(err),
    });
  }
  try {
    await syncEdc(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "edc",
      err: String(err),
    });
  }
  if (opts.includePelanggan) {
    try {
      await syncPelanggan(d);
    } catch (err) {
      // Eksplisit (stack) — union dua view besar; jangan abort senyap.
      log.error("domain gagal — dilewati siklus ini", {
        domain: "pelanggan",
        err: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
  try {
    await syncRealTank(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "realtank",
      err: String(err),
    });
  }
  if (opts.includeMasters) {
    try {
      await syncMasters(d);
    } catch (err) {
      log.error("domain gagal — dilewati siklus ini", {
        domain: "masters",
        err: String(err),
      });
    }
  }
}

/** Loop berkala sampai diberhentikan (SIGINT/SIGTERM). */
export async function runForever(d: SyncDeps): Promise<void> {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let lastMasters = 0;
  let lastPelanggan = 0;
  while (!stopped) {
    const now = Date.now();
    const includeMasters = now - lastMasters >= d.cfg.sync.masterIntervalMs;
    const includePelanggan = now - lastPelanggan >= d.cfg.sync.pelangganIntervalMs;
    try {
      await runCycle(d, { includeMasters, includePelanggan });
      if (includeMasters) lastMasters = Date.now();
      if (includePelanggan) lastPelanggan = Date.now();
    } catch (err) {
      log.error("siklus gagal (fatal)", { err: String(err) });
    }
    await new Promise((r) => setTimeout(r, d.cfg.sync.pollIntervalMs));
  }
  log.info("agent berhenti");
}
