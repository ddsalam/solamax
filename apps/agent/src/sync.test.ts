import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IngestPayload, IngestResponse } from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import type { EasyMaxConnection } from "./db/mysql.js";
import { IngestError, type IngestClient } from "./ingest-client.js";
import { StateStore } from "./state/store.js";
import { runCycle, type SyncDeps } from "./sync.js";

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

describe("runCycle", () => {
  it("dry-run: tidak mengirim & tidak memajukan watermark", async () => {
    const { client, sent } = fakeClient({});
    const store = new StateStore(dir);
    const deps: SyncDeps = { conn: fakeConn(), client, store, cfg: CFG, dryRun: true };

    await runCycle(deps, { includeMasters: false });

    expect(sent).toHaveLength(0);
    expect(store.getWatermark("sales")).toBeNull();
  });

  it("normal: mengirim payload sales & memajukan watermark ke max DTGLJAM (UTC)", async () => {
    const { client, sent } = fakeClient({});
    const store = new StateStore(dir);
    const deps: SyncDeps = { conn: fakeConn(), client, store, cfg: CFG, dryRun: false };

    await runCycle(deps, { includeMasters: false });

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

    await runCycle(deps, { includeMasters: false });
    expect(store.bufferCount()).toBeGreaterThan(0); // ter-buffer
    // Watermark TIDAK maju sebelum batch sukses di-ingest backend.
    expect(store.getWatermark("sales")).toBeNull();

    // Backend pulih → siklus berikutnya menguras buffer + kirim live + watermark maju.
    const online = fakeClient({});
    const deps2: SyncDeps = {
      conn: fakeConn(), client: online.client, store, cfg: CFG, dryRun: false,
    };
    await runCycle(deps2, { includeMasters: false });

    expect(store.bufferCount()).toBe(0);
    expect(online.sent.some((p) => p.domain === "sales")).toBe(true);
    expect(store.getWatermark("sales")).toBe("2026-06-11T07:30:00.000Z");
  });
});
