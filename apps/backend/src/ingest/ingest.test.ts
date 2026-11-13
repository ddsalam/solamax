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
function fakePrisma(onCommit?: () => void) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      return 1;
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      const result = await fn(tx);
      onCommit?.();
      return result;
    },
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
      1, "sales", "2026-06-11T07:30:00.000Z", 2, true,
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

  it("replace_window terra_resmi: sumber kosong menghapus baris mirror yang lenyap", async () => {
    const { prisma, executed } = fakePrisma();
    const payload: IngestPayload = {
      unit_code: "6478111",
      domain: "terra_resmi",
      watermark_high: null,
      replace_window: { from: "2026-08-27", to: "2026-08-28" },
      tables: {},
    };

    const res = await new IngestService(prisma).ingest(7, payload);

    expect(res.upserted).toEqual({});
    const sqls = executed.map((e) => e.sql);
    expect(sqls[0]).toContain("set_config('app.unit_ids'");
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(executed[1]!.params).toEqual(["replace_window:terra_resmi:7"]);
    expect(sqls[2]).toContain('DELETE FROM "terra_resmi"');
    expect(sqls[2]).toContain('"unit_id" = $1');
    expect(executed[2]!.params).toEqual([7, "2026-08-27", "2026-08-28", [], []]);
    expect(sqls.some((sql) => sql.includes('INSERT INTO "terra_resmi"'))).toBe(false);
    expect(sqls.at(-1)).toContain('"sync_state"');
  });

  it("replace_details sales: pangkas detail basi per header SEBELUM upsert (BL 23-09-2026)", async () => {
    const { prisma, executed } = fakePrisma();
    const payload: IngestPayload = { ...SALES_PAYLOAD, watermark_high: null, replace_details: true };
    await new IngestService(prisma).ingest(5, payload);
    const sqls = executed.map((e) => e.sql);
    const pruneIdx = sqls.findIndex((s) => s.includes('DELETE FROM "sales_detail"'));
    const insIdx = sqls.findIndex((s) => s.includes('INSERT INTO "sales_detail"'));
    expect(pruneIdx).toBeGreaterThan(-1);
    expect(insIdx).toBeGreaterThan(pruneIdx);
    expect(sqls[pruneIdx]).toContain("NOT EXISTS");
    // Header diambil dari DETAIL payload; kunci (header, nozzle, nurut) yang dipertahankan.
    expect(executed[pruneIdx]!.params).toEqual([5, ["H1"], ["H1"], ["N1"], [1]]);
  });

  it("tanpa replace_details: sales murni UPSERT, tak ada DELETE", async () => {
    const { prisma, executed } = fakePrisma();
    await new IngestService(prisma).ingest(1, SALES_PAYLOAD);
    expect(executed.some((e) => e.sql.includes("DELETE"))).toBe(false);
  });

  it("replace_details pada domain selain sales → 422 tanpa eksekusi", async () => {
    const { prisma, executed } = fakePrisma();
    const payload = {
      unit_code: "6478111",
      domain: "delivery",
      watermark_high: null,
      replace_details: true,
      tables: { delivery: [] },
    } as unknown as IngestPayload;
    await expect(new IngestService(prisma).ingest(1, payload)).rejects.toThrow(
      /replace_details tidak sah/,
    );
    expect(executed).toHaveLength(0);
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

  it("source_cut diterima dan diteruskan ke capture setelah mirror ter-commit", async () => {
    let transactionCommitted = false;
    let captureSawCommittedMirror = false;
    const { prisma } = fakePrisma(() => {
      transactionCommitted = true;
    });
    const capture = {
      capture: vi.fn(async () => {
        captureSawCommittedMirror = transactionCommitted;
        return {
          outcome: "staging" as const,
          cycleId: SOURCE_CUT_PAYLOAD.source_cut!.cycle_id,
          sourceCycleSequence: 1n,
        };
      }),
    } as unknown as SnapshotSourceCaptureService;
    const service = new IngestService(prisma, capture);
    (service as unknown as { logger: { log(): void } }).logger = { log() {} };

    const response = await service.ingest(1, SOURCE_CUT_PAYLOAD);

    expect(response).toEqual({ upserted: { bppiut: 1 }, new_watermark: null });
    expect(captureSawCommittedMirror).toBe(true);
    expect(capture.capture).toHaveBeenCalledOnce();
    expect(capture.capture).toHaveBeenCalledWith(1, SOURCE_CUT_PAYLOAD);
  });

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

// Domain tagihan (rencana 2026-11-13 U2). Perilaku terhadap DATA dibuktikan di
// tagihan.postgres.test.ts; di sini yang dikunci adalah BENTUK transaksinya.
// Seluruh nilai ilustratif.
describe("IngestService — domain tagihan", () => {
  const faktur = (id: string, extra: Record<string, unknown> = {}) => ({
    ckdtagih: id, dtgl: "2026-01-05", dtgljt: null, ckdplg: "PLG-A", vcket: null,
    ntotal: 10000000, nadm: 0, ngatot: 10000000, nstatus: 0, sbatal: 0,
    vcalasan: null, nlastsaldo: 10000000, sjenistag: 1, ...extra,
  });
  const bayar = (id: string, tagih: string) => ({
    ckdbyr: id, dtgl: "2026-01-20", ckdtagih: tagih, vcbukti: null, vcket: null,
    ctmpkas: null, ntotal: 4000000, sbatal: 0, vcalasan: null, capprovecode: null,
    cnamereq: null,
  });
  const POTONGAN: IngestPayload = {
    unit_code: "0000001",
    domain: "tagihan",
    watermark_high: null,
    tables: {
      tagihan_header: [faktur("TG-1"), faktur("TG-2")],
      tagihan_detail: [
        { ckdtagih: "TG-1", ckdjualplg: "JP-1" },
        { ckdtagih: "TG-1", ckdjualplg: "JP-2" },
      ],
      tagihan_bayar: [bayar("BY-1", "TG-1")],
    },
  };
  const MANIFEST: IngestPayload = {
    unit_code: "0000001",
    domain: "tagihan",
    watermark_high: null,
    tagihan_manifest: {
      cycle_id: "8d15c6cf-3e80-4db8-8104-8ea8b556be96",
      header_keys: ["TG-1", "TG-2"],
      bayar_keys: ["BY-1"],
    },
    tables: {},
  };

  it("potongan: kunci per-unit → pangkas tautan per faktur → upsert; TANPA hapus header/pembayaran", async () => {
    const { prisma, executed } = fakePrisma();
    const res = await new IngestService(prisma).ingest(3, POTONGAN);
    expect(res.upserted).toEqual({ tagihan_header: 2, tagihan_detail: 2, tagihan_bayar: 1 });

    const sqls = executed.map((e) => e.sql);
    expect(sqls[0]).toContain("set_config('app.unit_ids'");
    expect(executed[0]!.params).toEqual(["3"]);
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(executed[1]!.params).toEqual(["tagihan:3"]);

    // Cakupan pangkas tautan = faktur di HEADER payload (TG-2 tanpa tautan ikut:
    // tautan lamanya harus hilang); yang dipertahankan = pasangan di payload.
    const pangkas = sqls.findIndex((s) => s.includes('DELETE FROM "tagihan_detail"'));
    const sisip = sqls.findIndex((s) => s.includes('INSERT INTO "tagihan_detail"'));
    expect(pangkas).toBeGreaterThan(1);
    expect(sisip).toBeGreaterThan(pangkas);
    expect(executed[pangkas]!.params).toEqual([
      3, ["TG-1", "TG-2"], ["TG-1", "TG-1"], ["JP-1", "JP-2"],
    ]);
    expect(sqls[sisip]).toContain('ON CONFLICT ("unit_id","ckdtagih","ckdjualplg") DO NOTHING');

    // 🔴 Tanpa manifest, header & pembayaran TIDAK PERNAH dihapus, dan stempel
    // siklus-lengkap tidak bergerak.
    expect(sqls.some((s) => s.includes('DELETE FROM "tagihan_header"'))).toBe(false);
    expect(sqls.some((s) => s.includes('DELETE FROM "tagihan_bayar"'))).toBe(false);
    expect(sqls.some((s) => s.includes('"tagihan_cycle"'))).toBe(false);
    expect(sqls.at(-1)).toContain('"sync_state"');
    expect(executed.at(-1)!.params).toEqual([3, "tagihan", null, 5, false]);
  });

  it("potongan tanpa header: tak ada tautan yang dihapus", async () => {
    const { prisma, executed } = fakePrisma();
    await new IngestService(prisma).ingest(3, {
      ...POTONGAN, tables: { tagihan_bayar: [bayar("BY-1", "TG-1")] },
    });
    expect(executed.some((e) => e.sql.includes("DELETE"))).toBe(false);
  });

  it("header & pembayaran: UPSERT by PK + skipUnchanged + cast tanggal/numeric", async () => {
    const { prisma, executed } = fakePrisma();
    await new IngestService(prisma).ingest(3, POTONGAN);
    const hdr = executed.find((e) => e.sql.includes('INSERT INTO "tagihan_header"'))!;
    expect(hdr.sql).toContain('ON CONFLICT ("unit_id","ckdtagih") DO UPDATE SET');
    expect(hdr.sql).toContain("IS DISTINCT FROM");
    // dtgl, dtgljt → ::date (regresi 42804); ntotal/nadm/ngatot/nlastsaldo → teks ::numeric.
    expect(hdr.sql.match(/::date/g)).toHaveLength(4); // 2 kolom × 2 baris
    expect(hdr.sql.match(/::numeric/g)).toHaveLength(8); // 4 kolom × 2 baris
    expect(hdr.params).toContain("10000000");
    expect(hdr.params).not.toContain(10000000);
    const byr = executed.find((e) => e.sql.includes('INSERT INTO "tagihan_bayar"'))!;
    expect(byr.sql).toContain('ON CONFLICT ("unit_id","ckdbyr") DO UPDATE SET');
    expect(byr.sql).toContain("IS DISTINCT FROM");
  });

  it("manifest: kunci → hapus pembayaran → hapus header → hapus tautan yatim → stempel → sync_state, SATU transaksi", async () => {
    const { prisma, executed } = fakePrisma();
    const res = await new IngestService(prisma).ingest(3, MANIFEST);
    expect(res.upserted).toEqual({});

    const sqls = executed.map((e) => e.sql);
    expect(sqls).toHaveLength(7);
    expect(sqls[0]).toContain("set_config('app.unit_ids'");
    expect(executed[0]!.params).toEqual(["3"]);
    expect(sqls[1]).toContain("pg_advisory_xact_lock");
    expect(executed[1]!.params).toEqual(["tagihan:3"]);
    expect(sqls[2]).toContain('DELETE FROM "tagihan_bayar"');
    expect(executed[2]!.params).toEqual([3, ["BY-1"]]);
    expect(sqls[3]).toContain('DELETE FROM "tagihan_header"');
    expect(executed[3]!.params).toEqual([3, ["TG-1", "TG-2"]]);
    expect(sqls[4]).toContain('DELETE FROM "tagihan_detail"');
    expect(executed[4]!.params).toEqual([3]);
    expect(sqls[5]).toContain('INSERT INTO "tagihan_cycle"');
    expect(executed[5]!.params).toEqual([3, "8d15c6cf-3e80-4db8-8104-8ea8b556be96", 2, 1]);
    expect(sqls[6]).toContain('"sync_state"');
    // Setiap DELETE membawa pembatas unit-nya SENDIRI, bukan hanya mengandalkan RLS.
    for (const i of [2, 3, 4]) expect(sqls[i]).toContain('"unit_id" = $1');
  });

  it("manifest kosong (tabel sumber kosong) tetap sah — daftar kosong diteruskan apa adanya", async () => {
    const { prisma, executed } = fakePrisma();
    await new IngestService(prisma).ingest(3, {
      ...MANIFEST,
      tagihan_manifest: { ...MANIFEST.tagihan_manifest!, header_keys: [], bayar_keys: [] },
    });
    expect(executed[2]!.params).toEqual([3, []]);
    expect(executed[3]!.params).toEqual([3, []]);
    expect(executed[5]!.params.slice(2)).toEqual([0, 0]);
  });

  it("manifest pada domain lain → 422 tanpa eksekusi", async () => {
    const { prisma, executed } = fakePrisma();
    const payload = { ...MANIFEST, domain: "piutang" } as IngestPayload;
    await expect(new IngestService(prisma).ingest(3, payload)).rejects.toThrow(
      /tagihan_manifest tidak sah/,
    );
    expect(executed).toHaveLength(0);
  });

  it("manifest yang membawa baris → 422 tanpa eksekusi", async () => {
    const { prisma, executed } = fakePrisma();
    const payload = { ...MANIFEST, tables: POTONGAN.tables } as IngestPayload;
    await expect(new IngestService(prisma).ingest(3, payload)).rejects.toThrow(
      /tidak boleh membawa baris/,
    );
    expect(executed).toHaveLength(0);
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
