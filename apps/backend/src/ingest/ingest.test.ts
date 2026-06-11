import { describe, expect, it } from "vitest";
import type { IngestPayload } from "@solamax/shared";
import { IngestService } from "./ingest.service.js";
import { IngestController } from "./ingest.controller.js";
import { hashApiKey } from "../auth/api-key.guard.js";
import type { PrismaService } from "../prisma.service.js";

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

describe("IngestService", () => {
  it("upsert semua tabel + sync_state dalam satu transaksi, urutan header dulu", async () => {
    const { prisma, executed } = fakePrisma();
    const res = await new IngestService(prisma).ingest(1, SALES_PAYLOAD);

    expect(res.upserted).toEqual({ sales_header: 1, sales_detail: 1 });
    expect(res.new_watermark).toBe("2026-06-11T07:30:00.000Z");
    expect(executed).toHaveLength(3); // header, detail, sync_state
    expect(executed[0]!.sql).toContain('"sales_header"');
    expect(executed[1]!.sql).toContain('"sales_detail"');
    expect(executed[2]!.sql).toContain('"sync_state"');
    expect(executed[2]!.params).toEqual([
      1, "sales", new Date("2026-06-11T07:30:00.000Z"), 2,
    ]);
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
});

describe("hashApiKey", () => {
  it("sha256 hex deterministik", () => {
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
