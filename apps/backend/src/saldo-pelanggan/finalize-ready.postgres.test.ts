import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { IngestPayload } from "@solamax/shared";
import type { PrismaService } from "../prisma.service.js";
import { SnapshotSourceCaptureService } from "./source-capture.service.js";

const suite = process.env.SNAPSHOT_POSTGRES_CI === "1" ? describe.sequential : describe.skip;
const requireDashboard = createRequire(resolve(__dirname, "../../../dashboard/package.json"));
let client: any;
let service: SnapshotSourceCaptureService;
const query = async (sql: string, ...values: unknown[]) =>
  client.query(sql, values.map(v => typeof v === "bigint" ? v.toString() : v));

suite("actual finalizeReady caller (PostgreSQL16)", () => {
  beforeAll(async () => {
    const raw = process.env.SNAPSHOT_POSTGRES_CI_URL;
    if (!raw) throw Error("disposable CI URL required");
    const url = new URL(raw);
    if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.pathname !== "/solamax_snapshot_ci" || url.username !== "snapshot_ci_admin"
      || url.password !== "snapshot_ci_only" || url.search || !url.port) throw Error("disposable target required");
    const { Client } = requireDashboard("pg");
    client = new Client({ connectionString: raw, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
    await client.connect();
    const identity = (await query("SELECT current_database() db,current_user role,current_setting('server_version_num')::int version")).rows[0];
    expect(identity).toMatchObject({ db: "solamax_snapshot_ci", role: "snapshot_ci_admin" });
    expect(identity.version).toBeGreaterThanOrEqual(160000);
    expect(identity.version).toBeLessThan(170000);
    await query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='snapshot_ci_owner') THEN CREATE ROLE snapshot_ci_owner NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$");
    const prisma = { $transaction: async (fn: any) => {
      await query("BEGIN; SET LOCAL ROLE snapshot_ci_owner; SET LOCAL app.unit_ids='1'");
      try {
        const result = await fn({
          $queryRawUnsafe: async (sql: string, ...v: unknown[]) => (await query(sql, ...v)).rows,
          $executeRawUnsafe: async (sql: string, ...v: unknown[]) => (await query(sql, ...v)).rowCount,
        });
        await query("COMMIT"); return result;
      } catch (e) { await query("ROLLBACK"); throw e; }
    }} as unknown as PrismaService;
    service = new SnapshotSourceCaptureService(prisma);
  });
  beforeEach(async () => {
    await query("DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.unit CASCADE; DROP TABLE IF EXISTS public.pelanggan_master; CREATE SCHEMA app AUTHORIZATION snapshot_ci_owner; CREATE TABLE public.unit(unit_id smallint PRIMARY KEY,timezone text NOT NULL DEFAULT 'Asia/Pontianak'); ALTER TABLE public.unit OWNER TO snapshot_ci_owner; CREATE TABLE public.pelanggan_master(unit_id smallint,ckdplg char(12),vcnmplg text); ALTER TABLE public.pelanggan_master OWNER TO snapshot_ci_owner; INSERT INTO public.unit(unit_id) VALUES(1); SET ROLE snapshot_ci_owner; SET app.unit_ids='1'");
    for (const name of ["0037_saldo_pelanggan_snapshot", "0038_snapshot_manifest_row_count", "0039_snapshot_debet_kredit", "0040_saldo_pelanggan_shift", "0041_source_cycle_rows_pruned_at"])
      await query(readFileSync(resolve(__dirname, "../../prisma/migrations", name, "migration.sql"), "utf8"));
    await query("RESET ROLE");
  });
  afterAll(async () => { await client?.end(); });

  async function ready(amount = 100) {
    const id = randomUUID();
    for (const domain of ["pelanggan_master", "bppiut", "bphut"] as const) {
      const payload = { unit_code: "SYNTHETIC", domain: domain === "pelanggan_master" ? "masters" : domain,
        watermark_high: null, source_cut: { cycle_id: id, domain, chunk_index: 0, chunk_count: 1, row_count: domain === "bphut" ? 0 : 1 },
        tables: { [domain]: domain === "pelanggan_master" ? [{ ckdplg: "SYNTHETIC", vcnmplg: "Synthetic", sjenis: 1, saktif: 1 }] : domain === "bppiut" ? [{ ckdbppiut: "SYNTHETIC", dtgl: "2026-01-01", ckdplg: "SYNTHETIC", njumlah: amount, sjnsbp: 1, sbatal: 0 }] : [] } } as IngestPayload;
      await service.capture(1, payload);
    }
    return id;
  }
  it("promotes a ready cut through the actual service and durably enqueues work", async () => {
    await ready();
    await service.finalizeReady(1);
    const id = await ready(200);
    await expect(service.finalizeReady(1)).resolves.toMatchObject({ outcome: "complete", cycleId: id });
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_dirty")).rows[0].n)).toBeGreaterThan(0);
    await service.enqueueBackfill(1, 0);
    expect((await query("SELECT status FROM app.saldo_pelanggan_source_cycle WHERE source_cycle_id=$1", id)).rows[0].status).toBe("complete");
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_build_work WHERE source_cycle_id=$1", id)).rows[0].n)).toBeGreaterThan(0);
  });
  it("leaves physical retirement to the bounded collector and preserves the latest cut", async () => {
    const previous = await ready(); await service.finalizeReady(1);
    const latest = await ready(200); await service.finalizeReady(1);
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_source_bppiut WHERE source_cycle_id=$1", previous)).rows[0].n)).toBe(1);
    const summary = await service.collectRetiredSources(1);
    expect(summary.cyclesDrained).toBeGreaterThan(0);
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_source_bppiut WHERE source_cycle_id=$1", previous)).rows[0].n)).toBe(0);
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_source_bppiut WHERE source_cycle_id=$1", latest)).rows[0].n)).toBe(1);
  });
  it("rolls back promotion and queue changes on a late finalization failure", async () => {
    await ready();
    await service.finalizeReady(1);
    const id = await ready(200);
    await expect(service.finalizeReady(1, { beforeStep: step => { if (step === "prune_source_cuts") throw Error("synthetic late failure"); } })).rejects.toThrow("synthetic late failure");
    expect((await query("SELECT status FROM app.saldo_pelanggan_source_cycle WHERE source_cycle_id=$1", id)).rows[0].status).toBe("staging");
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_build_work WHERE source_cycle_id=$1", id)).rows[0].n)).toBe(0);
    expect(Number((await query("SELECT count(*) n FROM app.saldo_pelanggan_dirty")).rows[0].n)).toBe(0);
    await expect(service.finalizeReady(1)).resolves.toMatchObject({ outcome: "complete" });
  });
});
