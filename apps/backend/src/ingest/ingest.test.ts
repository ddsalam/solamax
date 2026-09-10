import { describe, expect, it, vi } from "vitest";
import type { IngestPayload } from "@solamax/shared";
import { IngestService } from "./ingest.service.js";
import { IngestController } from "./ingest.controller.js";
import { hashApiKey } from "../auth/api-key.guard.js";
import type { PrismaService } from "../prisma.service.js";
import type {
  SnapshotCaptureStep,
  SnapshotSourceCaptureService,
} from "../saldo-pelanggan/source-capture.service.js";

/** Prisma palsu: rekam executeRaw dalam transaksi. */
function fakePrisma() {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      return 1;
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  } as unknown as PrismaService;
  return { prisma, executed };
}

const SALES_PAYLOAD: IngestPayload = {
  unit_code: "6478111",
  domain: "sales",
  watermark_high: "2026-06-11T07:30:00.000Z",
  tables: {
    sales_header: [
      { ckdjualbbm: "H1", dtgljual: "2026-06-11", nshift: 2, vcket: null },
    ],
    sales_detail: [
      {
        ckdjualbbm: "H1", ckdnozzle: "N1", nurut: 1, nstandawal: 100,
        nstandakhir: 150, nvolume: 50, nhargajual: 10000, nsubtotal: 500000,
        ckdbbm: "P1", ckdtangki: "T1", vcopeator: null,
        dtgljam: "2026-06-11T07:30:00.000Z", subah: 0, sedit: 0,
      },
    ],
  },
};

const SOURCE_CUT_PAYLOAD: IngestPayload = {
  unit_code: "6478111",
  domain: "piutang",
  watermark_high: null,
  source_cut: {
    cycle_id: "8d15c6cf-3e80-4db8-8104-8ea8b556be96",
    domain: "bppiut",
    chunk_index: 0,
    chunk_count: 1,
    row_count: 1,
  },
  tables: {
    bppiut: [{
      ckdbppiut: "PI-1",
      dtgl: "2026-01-10",
      ckdplg: "P1",
      vcref: null,
      vcket: null,
      njumlah: 100,
      sjnsbp: 1,
      sbatal: 0,
    }],
  },
};

const CAPTURE_STEPS: SnapshotCaptureStep[] = [
  "ensure_cycle",
  "stage_rows",
  "complete_domain",
  "verify_domains",
  "diff_changes",
  "dirty_watermark",
  "mark_pointers",
  "promote_cycle",
  "enqueue_work",
  "prune_source_cuts",
];

describe("IngestService", () => {
  it("upsert semua tabel + sync_state dalam satu transaksi, urutan header dulu", async () => {
    const { prisma, executed } = fakePrisma();
    const res = await new IngestService(prisma).ingest(1, SALES_PAYLOAD);

    expect(res.upserted).toEqual({ sales_header: 1, sales_detail: 1 });
    expect(res.new_watermark).toBe("2026-06-11T07:30:00.000Z");
    // RLS (0016): set_config('app.unit_ids', <unit>, true) runs FIRST in the txn so
    // WITH CHECK on the data writes passes, then header, detail, sync_state.
    expect(executed).toHaveLength(4);
    expect(executed[0]!.sql).toContain("set_config('app.unit_ids'");
    expect(executed[0]!.params).toEqual(["1"]); // = unitId, transaction-local context
    expect(executed[1]!.sql).toContain('"sales_header"');
    expect(executed[2]!.sql).toContain('"sales_detail"');
    expect(executed[3]!.sql).toContain('"sync_state"');
    expect(executed[3]!.params).toEqual([
      1, "sales", "2026-06-11T07:30:00.000Z", 2,
    ]);
  });

  it("tebus_header: kolom date dtgltbs di-cast ::date (regresi 42804)", async () => {
    const { prisma, executed } = fakePrisma();
    const payload: IngestPayload = {
      unit_code: "6478111",
      domain: "tebus",
      watermark_high: null,
      tables: {
        tebus_header: [{ ckdtbs: "TBS1", dtgltbs: "2026-06-24", cnoso: "4062082957", sbatal: 0 }],
        tebus_detail: [{ ckdtbs: "TBS1", ckdbbm: "BB-03", nvolume: 40000 }],
      },
    };
    const res = await new IngestService(prisma).ingest(1, payload);
    expect(res.upserted).toEqual({ tebus_header: 1, tebus_detail: 1 });
    const hdr = executed.find((e) => e.sql.includes('"tebus_header"'))!;
    // tanpa ::date → Postgres 42804 (text→date). Cast WAJIB hadir.
    expect(hdr.sql).toMatch(/::date/);
    expect(hdr.sql).toContain('ON CONFLICT ("unit_id","ckdtbs")');
    const det = executed.find((e) => e.sql.includes('"tebus_detail"'))!;
    expect(det.sql).toContain('ON CONFLICT ("unit_id","ckdtbs","ckdbbm")');
  });

  it("replace_window tebus: lock → DELETE detail (join header) → DELETE header → INSERT, satu transaksi", async () => {
    const { prisma, executed } = fakePrisma();
    const payload: IngestPayload = {
      unit_code: "6378301",
      domain: "tebus",
      watermark_high: null,
      replace_window: { from: "2026-06-01", to: "2026-07-01" },
      tables: {
        tebus_header: [{ ckdtbs: "TB202600136", dtgltbs: "2026-06-22", cnoso: "4062051864", sbatal: 0 }],
        tebus_detail: [{ ckdtbs: "TB202600136", ckdbbm: "BB-03", nvolume: 40000 }],
      },
    };
    const res = await new IngestService(prisma).ingest(2, payload);
    expect(res.upserted).toEqual({ tebus_header: 1, tebus_detail: 1 });
    const sqls = executed.map((e) => e.sql);
    // Urutan: set_config → advisory lock → DELETE detail → DELETE header → INSERT×2 → sync_state.
    expect(sqls[0]).toContain("set_config('app.unit_ids'");
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(executed[1]!.params).toEqual(["replace_window:tebus:2"]);
    expect(sqls[2]).toContain('DELETE FROM "tebus_detail"');
    expect(sqls[2]).toContain('USING "tebus_header"');
    expect(sqls[3]).toContain('DELETE FROM "tebus_header"');
    expect(executed[3]!.params).toEqual([2, "2026-06-01", "2026-07-01"]);
    const delIdx = sqls.findIndex((s) => s.includes('DELETE FROM "tebus_header"'));
    const insIdx = sqls.findIndex((s) => s.includes('INSERT INTO "tebus_header"'));
    expect(delIdx).toBeGreaterThan(-1);
    expect(insIdx).toBeGreaterThan(delIdx); // DELETE sebelum INSERT
  });

  it("replace_window delivery: payload TANPA baris = DELETE-only (jendela kosong di sumber)", async () => {
    const { prisma, executed } = fakePrisma();
    const payload: IngestPayload = {
      unit_code: "6378301",
      domain: "delivery",
      watermark_high: null,
      replace_window: { from: "2020-01-01", to: "2021-01-01" },
      tables: {},
    };
    const res = await new IngestService(prisma).ingest(2, payload);
    expect(res.upserted).toEqual({});
    const sqls = executed.map((e) => e.sql);
    expect(sqls.some((s) => s.includes('DELETE FROM "delivery"') && s.includes('"dtgltrm"'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO "delivery"'))).toBe(false);
    expect(sqls[sqls.length - 1]).toContain('"sync_state"');
  });

  it("replace_window pada domain non-whitelist → 422 tanpa eksekusi", async () => {
    const { prisma, executed } = fakePrisma();
    const payload = {
      ...SALES_PAYLOAD,
      replace_window: { from: "2026-06-01", to: "2026-07-01" },
    } as IngestPayload;
    await expect(new IngestService(prisma).ingest(1, payload)).rejects.toThrow(
      /replace_window tidak sah/,
    );
    expect(executed).toHaveLength(0);
  });

  it("menolak tabel melebihi limit baris (422, tanpa eksekusi)", async () => {
    const { prisma, executed } = fakePrisma();
    const big = {
      ...SALES_PAYLOAD,
      tables: {
        sales_header: Array.from({ length: 5001 }, (_, i) => ({
          ckdjualbbm: `H${i}`, dtgljual: "2026-06-11", nshift: 1, vcket: null,
        })),
      },
    };
    await expect(new IngestService(prisma).ingest(1, big)).rejects.toThrow(
      /melampaui limit/,
    );
    expect(executed).toHaveLength(0);
  });

  it.each(CAPTURE_STEPS)(
    "capture gagal di %s: mirror+sync_state tetap commit dan ingest sukses",
    async (step) => {
      const { prisma, executed } = fakePrisma();
      const capture = {
        capture: async () => {
          throw new Error(`injected:${step}`);
        },
      } as unknown as SnapshotSourceCaptureService;
      const service = new IngestService(prisma, capture);
      // Keep the matrix output concise; production still emits the error event.
      (service as unknown as { logger: { error(): void } }).logger = { error() {} };

      const response = await service.ingest(1, SOURCE_CUT_PAYLOAD);

      expect(response).toEqual({ upserted: { bppiut: 1 }, new_watermark: null });
      expect(executed.some((e) => e.sql.includes('INSERT INTO "bppiut"'))).toBe(true);
      expect(executed.at(-1)?.sql).toContain('"sync_state"');
    },
  );

  it("agen lama tanpa source_cut tetap sukses dan menulis mirror tanpa memicu capture", async () => {
    const { prisma, executed } = fakePrisma();
    const capture = {
      capture: vi.fn(),
    } as unknown as SnapshotSourceCaptureService;
    const service = new IngestService(prisma, capture);
    const legacyPayload: IngestPayload = {
      ...SOURCE_CUT_PAYLOAD,
      source_cut: undefined,
    };

    const response = await service.ingest(1, legacyPayload);

    expect(response).toEqual({ upserted: { bppiut: 1 }, new_watermark: null });
    expect(executed.some((e) => e.sql.includes('INSERT INTO "bppiut"'))).toBe(true);
    expect(executed.at(-1)?.sql).toContain('"sync_state"');
    expect(capture.capture).not.toHaveBeenCalled();
  });

  it("mengukur overhead orchestration source-cut lokal dengan n=30 (bukan rlsstg)", async () => {
    const baselinePayload: IngestPayload = {
      ...SOURCE_CUT_PAYLOAD,
      source_cut: undefined,
    };
    const noCapture = new IngestService(fakePrisma().prisma);
    const withCapture = new IngestService(fakePrisma().prisma, {
      capture: async () => ({
        outcome: "staging" as const,
        cycleId: SOURCE_CUT_PAYLOAD.source_cut!.cycle_id,
        sourceCycleSequence: 1n,
      }),
    } as unknown as SnapshotSourceCaptureService);
    (withCapture as unknown as { logger: { log(): void } }).logger = { log() {} };

    const measure = async (run: () => Promise<unknown>): Promise<number[]> => {
      const samples: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        const start = performance.now();
        await run();
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b);
    };
    const baseline = await measure(() => noCapture.ingest(1, baselinePayload));
    const captured = await measure(() => withCapture.ingest(1, SOURCE_CUT_PAYLOAD));
    const percentile = (samples: number[], p: number) =>
      samples[Math.ceil(samples.length * p) - 1]!;
    const report = {
      environment: "local-fake-prisma-no-network",
      n: 30,
      baseline_p50_ms: Number(percentile(baseline, 0.5).toFixed(3)),
      baseline_p95_ms: Number(percentile(baseline, 0.95).toFixed(3)),
      capture_p50_ms: Number(percentile(captured, 0.5).toFixed(3)),
      capture_p95_ms: Number(percentile(captured, 0.95).toFixed(3)),
      added_p50_ms: Number((percentile(captured, 0.5) - percentile(baseline, 0.5)).toFixed(3)),
      added_p95_ms: Number((percentile(captured, 0.95) - percentile(baseline, 0.95)).toFixed(3)),
    };
    console.info("B3_INGEST_LATENCY_LOCAL", JSON.stringify(report));
    expect(baseline).toHaveLength(30);
    expect(captured).toHaveLength(30);
  });
});

describe("IngestController", () => {
  const controller = (svc?: Partial<IngestService>) =>
    new IngestController((svc ?? {}) as IngestService);
  const req = (code: string) =>
    ({ unit: { unitId: 1, code } }) as never;

  it("payload invalid → 422", async () => {
    await expect(
      controller().ingest(req("6478111"), { rusak: true }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("unit_code tak sesuai API key → 403", async () => {
    await expect(
      controller().ingest(req("9999999"), SALES_PAYLOAD),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("payload valid + unit cocok → diteruskan ke service", async () => {
    let got: unknown;
    const res = await controller({
      ingest: async (unitId: number, p: IngestPayload) => {
        got = { unitId, domain: p.domain };
        return { upserted: {}, new_watermark: null };
      },
    }).ingest(req("6478111"), SALES_PAYLOAD);
    expect(got).toEqual({ unitId: 1, domain: "sales" });
    expect(res.upserted).toEqual({});
  });

  it("kontrak endpoint /ingest tetap HTTP 200", () => {
    expect(Reflect.getMetadata("__httpCode__", IngestController.prototype.ingest)).toBe(200);
  });
});

describe("hashApiKey", () => {
  it("sha256 hex deterministik", () => {
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
