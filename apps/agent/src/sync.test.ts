import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IngestPayload, IngestResponse } from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import type { EasyMaxConnection } from "./db/mysql.js";
import { IngestError, type IngestClient } from "./ingest-client.js";
import { StateStore } from "./state/store.js";
import { batchByBusinessDate, runCycle, type SyncDeps } from "./sync.js";

const SALES_ROW = {
  CKDJUALBBM: "H1", CKDNOZZLE: "N1", NURUT: 1, NVOLUME: "50", NHARGAJUAL: "10000",
  NSUBTOTAL: "500000", CKDBBM: "P1", CKDTANGKI: "T1", NSTANDAWAL: "100",
  NSTANDAKHIR: "150", VCOPEATOR: "-", DTGLJAM: "2026-06-11 14:30:00",
  SUBAH: "0", SEDIT: "0", DTGLJUAL: "2026-06-11 00:00:00", NSHIFT: "2", VCKET: null,
};

/** Conn palsu: kembalikan 1 baris sales pada panggilan pertama saja, sisanya []. */
function fakeConn(): EasyMaxConnection {
  let salesServed = false;
  return {
    async roQuery(sql: string) {
      if (sql.includes("tr_djualbbm") && !salesServed) {
        salesServed = true;
        return [SALES_ROW];
      }
      return [];
    },
  } as unknown as EasyMaxConnection;
}

function fakeClient(behavior: {
  fail?: boolean;
}): { client: IngestClient; sent: IngestPayload[] } {
  const sent: IngestPayload[] = [];
  const client = {
    async sendWithRetry(payload: IngestPayload): Promise<IngestResponse> {
      if (behavior.fail) throw new IngestError("offline", true);
      sent.push(payload);
      return { upserted: {}, new_watermark: payload.watermark_high };
    },
  } as unknown as IngestClient;
  return { client, sent };
}

const CFG = {
  unitCode: "6478111",
  timezone: "Asia/Pontianak",
  sync: {
    pollIntervalMs: 1, masterIntervalMs: 1, safetyWindowMin: 60,
    cashRescanDays: 7, batchSize: 1000,
  },
} as unknown as AgentConfig;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solamax-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("paginasi boundary (grup DTGLJAM identik terpotong LIMIT)", () => {
  it("melengkapi grup boundary via sqlBoundary & tidak menduplikat", async () => {
    const row = (nozzle: string, ts: string) => ({
      ...SALES_ROW, CKDNOZZLE: nozzle, DTGLJAM: ts,
    });
    const calls: string[] = [];
    let pageServed = false;
    const conn = {
      async roQuery(sql: string, params: unknown[]) {
        calls.push(sql.includes("LIMIT") ? `page(${params[0]})` : `boundary(${params[0]})`);
        if (sql.includes("tr_djualbbm") && sql.includes("LIMIT")) {
          if (pageServed) return [];
          pageServed = true;
          // halaman PENUH (batchSize=2): N1@14:00, N2@14:30 — grup 14:30 terpotong
          return [row("N1", "2026-06-11 14:00:00"), row("N2", "2026-06-11 14:30:00")];
        }
        if (sql.includes("tr_djualbbm")) {
          // grup boundary lengkap: 14:30 ternyata berisi 2 baris
          return [row("N2", "2026-06-11 14:30:00"), row("N3", "2026-06-11 14:30:00")];
        }
        return [];
      },
    } as unknown as EasyMaxConnection;

    const { client, sent } = fakeClient({});
    const store = new StateStore(dir);
    const cfg = { ...CFG, sync: { ...CFG.sync, batchSize: 2 } } as AgentConfig;
    await runCycle({ conn, client, store, cfg, dryRun: false }, { includeMasters: false, includePelanggan: false });

    const sales = sent.find((p) => p.domain === "sales")!;
    const nozzles = sales.tables.sales_detail!.map((r) => r.ckdnozzle).sort();
    expect(nozzles).toEqual(["N1", "N2", "N3"]); // lengkap & tanpa duplikat
    expect(store.getWatermark("sales")).toBe("2026-06-11T07:30:00.000Z"); // 14:30 WIB
    expect(calls.some((c) => c.startsWith("boundary(2026-06-11 14:30:00"))).toBe(true);
  });
});

describe("batchByBusinessDate (REPLACE: satu tanggal tak boleh terpisah)", () => {
  const mk = (date: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ business_date: date, i }));

  it("tak memecah satu business_date walau melewati batas batch", () => {
    // 3 tanggal × 4 baris, batchSize 5 → batas 5 jatuh di tengah tanggal ke-2.
    const rows = [...mk("D1", 4), ...mk("D2", 4), ...mk("D3", 4)];
    const batches = batchByBusinessDate(rows, 5);
    // Tiap batch hanya berisi tanggal-tanggal UTUH (tak ada tanggal yang muncul di 2 batch).
    const dateToBatch = new Map<string, number>();
    batches.forEach((b, bi) => {
      for (const r of b) {
        const prev = dateToBatch.get(r.business_date);
        expect(prev === undefined || prev === bi).toBe(true);
        dateToBatch.set(r.business_date, bi);
      }
    });
    expect(batches.flat()).toHaveLength(12); // 0 drop
    expect(new Set([...dateToBatch.values()]).size).toBe(batches.length);
  });

  it("satu tanggal > batchSize tetap satu batch utuh", () => {
    const batches = batchByBusinessDate(mk("D1", 7), 5);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(7);
  });

  it("GUARD: satu business_date > cap 5000 → error keras (jangan pecah REPLACE)", () => {
    expect(() => batchByBusinessDate(mk("D1", 5001), 1000)).toThrow(
      /business_date D1: 5001 baris > cap 5000/,
    );
    // tepat di cap (5000) → aman (satu batch utuh).
    expect(() => batchByBusinessDate(mk("D1", 5000), 1000)).not.toThrow();
  });
});

describe("runCycle", () => {
  it("dry-run: tidak mengirim & tidak memajukan watermark", async () => {
    const { client, sent } = fakeClient({});
    const store = new StateStore(dir);
    const deps: SyncDeps = { conn: fakeConn(), client, store, cfg: CFG, dryRun: true };

    await runCycle(deps, { includeMasters: false, includePelanggan: false });

    expect(sent).toHaveLength(0);
    expect(store.getWatermark("sales")).toBeNull();
  });

  it("normal: mengirim payload sales & memajukan watermark ke max DTGLJAM (UTC)", async () => {
    const { client, sent } = fakeClient({});
    const store = new StateStore(dir);
    const deps: SyncDeps = { conn: fakeConn(), client, store, cfg: CFG, dryRun: false };

    await runCycle(deps, { includeMasters: false, includePelanggan: false });

    const salesPayload = sent.find((p) => p.domain === "sales");
    expect(salesPayload).toBeDefined();
    expect(salesPayload!.tables.sales_detail).toHaveLength(1);
    expect(store.getWatermark("sales")).toBe("2026-06-11T07:30:00.000Z");
  });

  it("backend offline: payload di-buffer, lalu drain saat pulih", async () => {
    const offline = fakeClient({ fail: true });
    const store = new StateStore(dir);
    const deps: SyncDeps = {
      conn: fakeConn(), client: offline.client, store, cfg: CFG, dryRun: false,
    };

    await runCycle(deps, { includeMasters: false, includePelanggan: false });
    expect(store.bufferCount()).toBeGreaterThan(0); // ter-buffer
    // Watermark TIDAK maju sebelum batch sukses di-ingest backend.
    expect(store.getWatermark("sales")).toBeNull();

    // Backend pulih → siklus berikutnya menguras buffer + kirim live + watermark maju.
    const online = fakeClient({});
    const deps2: SyncDeps = {
      conn: fakeConn(), client: online.client, store, cfg: CFG, dryRun: false,
    };
    await runCycle(deps2, { includeMasters: false, includePelanggan: false });

    expect(store.bufferCount()).toBe(0);
    expect(online.sent.some((p) => p.domain === "sales")).toBe(true);
    expect(store.getWatermark("sales")).toBe("2026-06-11T07:30:00.000Z");
  });
});
