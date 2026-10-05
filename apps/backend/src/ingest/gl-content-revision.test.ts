import { describe, expect, it } from "vitest";
import { IngestPayload } from "@solamax/shared";
import type { PrismaService } from "../prisma.service.js";
import { IngestService } from "./ingest.service.js";
import { TABLE_CONFIG } from "./table-config.js";
import { buildUpsert } from "./sql.js";
import { buildGlWindowPrune, contributesToGl, glContentConfig } from "./gl-content-revision.js";

describe("G/L content revision statement boundaries", () => {
  it.each(["sales_header", "sales_detail", "opname", "delivery", "terra_resmi", "product"])(
    "%s compares every source update column while keeping generic config unchanged", table => {
      const original = TABLE_CONFIG[table]!;
      const flag = original.skipUnchanged;
      const cfg = glContentConfig(original);
      const sql = buildUpsert(cfg, 1, [Object.fromEntries(cfg.columns.map(c => [c, null]))]).sql;
      const setColumns = [...sql.matchAll(/"([^"]+)" = EXCLUDED/g)].map(m => m[1]);
      const predicate = sql.match(/ WHERE \((.*?)\) IS DISTINCT FROM/)!;
      expect(predicate).not.toBeNull();
      expect([...predicate[1]!.matchAll(/\."([^"]+)"/g)].map(m => m[1])).toEqual(setColumns);
      expect(predicate[1]).not.toContain("ingested_at");
      expect(original.skipUnchanged).toBe(flag);
      expect(cfg).not.toBe(original);
    },
  );

  it("does not alter unrelated source config", () => {
    for (const table of ["cash_header", "deposit", "tangki", "nozzle", "bppiut"])
      expect(glContentConfig(TABLE_CONFIG[table]!)).toBe(TABLE_CONFIG[table]);
    expect(contributesToGl("cash_header")).toBe(false);
  });

  it("delivery pruning uses scoped dates and CHAR key equality including empty windows", () => {
    const empty = buildGlWindowPrune("delivery", 2, { from: "2026-01-01", to: "2026-02-01" }, []);
    expect(empty.params).toEqual([2, "2026-01-01", "2026-02-01", []]);
    expect(empty.sql).toContain('t."unit_id" = $1');
    expect(empty.sql).toContain("$4::bpchar[]");
    expect(empty.sql).toContain('t."dtgltrm" >= $2::date');
    expect(empty.sql).toContain('t."dtgltrm" < $3::date');
    const moved = buildGlWindowPrune("delivery", 2, { from: "2026-01-01", to: "2026-02-01" },
      [{ ckdtrm: "D1 ", dtgltrm: "2025-12-31" }, { ckdtrm: "D1 ", dtgltrm: "2025-12-31" }]);
    expect(moved.params[3]).toEqual(["D1 ", "D1 "]); // do not drop keys moved out of the window
  });

  it("terra pruning preserves VARCHAR key pairs rather than CHAR padding semantics", () => {
    const statement = buildGlWindowPrune("terra_resmi", 3, { from: "2026-01-01", to: "2026-02-01" },
      [{ ckdterra: "T", ckdnozzle: "N" }, { ckdterra: "T ", ckdnozzle: "N " }]);
    expect(statement.params).toEqual([3, "2026-01-01", "2026-02-01", ["T", "T "], ["N", "N "]]);
    expect(statement.sql).toContain("$4::varchar(15)[], $5::varchar(5)[]");
    expect(statement.sql).not.toContain("bpchar");
  });

  async function execute(payload: IngestPayload, changedTables: string[]) {
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    const prisma = { $transaction: async (body: (tx: unknown) => Promise<unknown>) => body({
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        executed.push({ sql, params });
        if (sql.startsWith("SELECT")) return 1; // locks/GUC must never be counted
        return changedTables.some(table => sql.includes(`INTO "${table}"`)) ? 1 : 0;
      },
    }) } as unknown as PrismaService;
    const response = await new IngestService(prisma).ingest(2, payload);
    const metadata = executed.find(r => r.sql.includes('INSERT INTO "sync_state"'))!;
    return { response, metadata, executed };
  }

  const product = { ckdbbm: "P", vcnmbbm: "SYNTHETIC", nhrgjual: null, perk_map: null };
  it("accepted row counts stay raw while zero affected writes do not advance content", async () => {
    const payload = IngestPayload.parse({ unit_code: "SYNTHETIC", domain: "masters", watermark_high: null,
      tables: { product: [product, product] } });
    const { response, metadata } = await execute(payload, []);
    expect(response.upserted).toEqual({ product: 2 });
    expect(metadata.params).toEqual([2, "masters", null, 2, false]);
  });

  it("detects actual contributing tables under an unrelated accepted domain", async () => {
    const payload = IngestPayload.parse({ unit_code: "SYNTHETIC", domain: "cash", watermark_high: null,
      tables: { product: [product], sales_header: [{ ckdjualbbm: "H", dtgljual: "2026-01-01", nshift: 1, vcket: null }] } });
    for (const changed of ["product", "sales_header"]) {
      const { metadata } = await execute(payload, [changed]);
      expect(metadata.params).toEqual([2, "cash", null, 2, true]);
    }
  });

  it("non-G/L table mutations and advisory/GUC results cannot mark G/L changed", async () => {
    const payload = IngestPayload.parse({ unit_code: "SYNTHETIC", domain: "masters", watermark_high: null,
      tables: { tangki: [{ ckdtangki: "T", ckdbbm: "P", vcnmtangki: "SYNTHETIC" }] } });
    const { metadata } = await execute(payload, ["tangki"]);
    expect(metadata.params).toEqual([2, "masters", null, 1, false]);
  });
});
