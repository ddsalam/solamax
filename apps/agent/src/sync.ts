import { IngestPayload } from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import type { EasyMaxConnection } from "./db/mysql.js";
import {
  CASH_DOMAIN,
  DATETIME_DOMAINS,
  MASTERS_DOMAIN,
  REALTANK_DOMAIN,
  type DateTimeDomain,
} from "./domains.js";
import { IngestClient, IngestError } from "./ingest-client.js";
import { log } from "./logger.js";
import type { StateStore } from "./state/store.js";
import {
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

/** Satu siklus penuh. Master di-sync hanya bila `includeMasters`. */
export async function runCycle(
  d: SyncDeps,
  opts: { includeMasters: boolean },
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
  try {
    await syncCash(d);
  } catch (err) {
    log.error("domain gagal — dilewati siklus ini", {
      domain: "cash",
      err: String(err),
    });
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
  while (!stopped) {
    const includeMasters = Date.now() - lastMasters >= d.cfg.sync.masterIntervalMs;
    try {
      await runCycle(d, { includeMasters });
      if (includeMasters) lastMasters = Date.now();
    } catch (err) {
      log.error("siklus gagal (fatal)", { err: String(err) });
    }
    await new Promise((r) => setTimeout(r, d.cfg.sync.pollIntervalMs));
  }
  log.info("agent berhenti");
}
