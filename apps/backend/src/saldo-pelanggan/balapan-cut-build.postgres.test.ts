import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  READ_READY_SOURCE_CYCLE_SQL,
} from "./source-capture-sql.js";

const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");

let connection: NodeJS.ProcessEnv;

function ciConnection(raw: string | undefined): NodeJS.ProcessEnv {
  if (!raw) throw new Error("SNAPSHOT_POSTGRES_CI_URL is required for the opt-in CI suite");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.pathname !== "/solamax_snapshot_ci" || url.username !== "snapshot_ci_admin"
    || url.password !== "snapshot_ci_only" || url.search || !url.port || Number(url.port) < 1024) {
    throw new Error("Snapshot CI requires the fixed disposable localhost database and test-only account");
  }
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: "solamax_snapshot_ci",
    PGUSER: "snapshot_ci_admin", PGPASSWORD: "snapshot_ci_only", PGCONNECT_TIMEOUT: "5",
  };
}

function sql(statement: string, owner = true): string {
  return execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
    env: connection,
    input: `${owner ? "SET ROLE snapshot_ci_owner; SET app.unit_ids = '1';" : ""}\n${statement}`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
  }).trim();
}

function rows(statement: string): Record<string, any>[] {
  return JSON.parse(sql(`SELECT COALESCE(json_agg(result), '[]'::json) FROM (${statement}) result;`));
}

function bind(statement: string, values: Array<string | number>): string {
  return statement.replace(/\$(\d+)/g, (_t, i: string) => {
    const v = values[Number(i) - 1];
    if (v === undefined) throw new Error(`Missing fixture argument ${i}`);
    return typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  });
}

const cutId = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

/** `siap` = ketiga domain + ketiga checksum ada — syarat READ_READY_SOURCE_CYCLE_SQL. */
function seedCycle(seq: number, status: "staging" | "complete", siap: boolean): void {
  const bukti = siap
    ? `1, sha256('m'::bytea), 1, sha256('p'::bytea), 1, sha256('h'::bytea)`
    : `NULL, NULL, NULL, NULL, NULL, NULL`;
  const waktu = status === "complete"
    ? `'2026-09-16 19:05:15+00', clock_timestamp()`
    : `NULL, NULL`;
  sql(`INSERT INTO app.saldo_pelanggan_source_cycle
 (unit_id, source_cycle_id, source_cycle_sequence, status, source_completed_at, promoted_at,
  pelanggan_row_count, pelanggan_keyed_checksum, bppiut_row_count, bppiut_keyed_checksum,
  bphut_row_count, bphut_keyed_checksum)
 VALUES (1, '${cutId(seq)}', ${seq}, '${status}', ${waktu}, ${bukti});`);
}

function statuses(): Record<string, any>[] {
  return rows(`SELECT source_cycle_sequence AS seq, status
               FROM app.saldo_pelanggan_source_cycle ORDER BY source_cycle_sequence`);
}

function gugurkan(batas: number): void {
  sql(bind(FAIL_SUPERSEDED_STAGING_CYCLES_SQL, [1, batas]));
}

function kandidatFinalisasi(): Record<string, any>[] {
  // FOR UPDATE butuh transaksi; bungkus supaya kuerinya persis yang produksi pakai.
  return rows(`SELECT source_cycle_sequence AS seq FROM (${
    READ_READY_SOURCE_CYCLE_SQL.replace("FOR UPDATE", "")
  }) k`.replace("$1::smallint", "1::smallint"));
}

suite("balapan cut-vs-build — opsi (d) (PostgreSQL 16)", () => {
  beforeAll(() => {
    connection = ciConnection(process.env.SNAPSHOT_POSTGRES_CI_URL);
    const identity = JSON.parse(sql(
      "SELECT json_build_object('version',current_setting('server_version_num')::int,'database',current_database(),'user',current_user);",
      false));
    expect(identity).toMatchObject({ database: "solamax_snapshot_ci", user: "snapshot_ci_admin" });
    expect(identity.version).toBeGreaterThanOrEqual(160000);
    expect(identity.version).toBeLessThan(170000);
    sql("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='snapshot_ci_owner') THEN CREATE ROLE snapshot_ci_owner NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$;", false);
  });

  beforeEach(() => {
    sql(`DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.unit CASCADE;
DROP TABLE IF EXISTS public.pelanggan_master;
CREATE SCHEMA app AUTHORIZATION snapshot_ci_owner;
CREATE TABLE public.unit(unit_id smallint PRIMARY KEY);
ALTER TABLE public.unit OWNER TO snapshot_ci_owner;
CREATE TABLE public.pelanggan_master(unit_id smallint,ckdplg char(12),vcnmplg text);
ALTER TABLE public.pelanggan_master OWNER TO snapshot_ci_owner;
INSERT INTO public.unit VALUES(1);`, false);
    sql(readFileSync(resolve(migrations, "0037_saldo_pelanggan_snapshot/migration.sql"), "utf8"));
  });

  // 🔴 INI kasus Batu Layang 16-09-2026.
  it("cut READY bertahan saat alokasi terbaru masih diunggah", () => {
    seedCycle(1, "staging", true);   // siap difinalisasi
    seedCycle(2, "staging", false);  // agent sedang mengunggah

    gugurkan(2);

    expect(statuses()).toEqual([
      { seq: 1, status: "staging" },  // ← bentuk lama menggugurkan yang ini
      { seq: 2, status: "staging" },
    ]);
    // Dan finalisasi benar-benar menemukannya: tanpa ini, bertahannya sia-sia.
    expect(kandidatFinalisasi()).toEqual([{ seq: 1 }]);
  });

  it("cut yang BELUM siap tetap digugurkan — yang dipertahankan hanya kandidat finalisasi", () => {
    seedCycle(1, "staging", false);
    seedCycle(2, "staging", false);
    gugurkan(2);
    expect(statuses()).toEqual([
      { seq: 1, status: "failed" },
      { seq: 2, status: "staging" },
    ]);
  });

  // 🔴 Kasus yang `<>` akan salahkan: subkueri NULL membuat SELURUH UPDATE tak
  // mengenai apa pun, jadi semua cut basi bertahan selamanya.
  it("tanpa satu pun cut siap, SEMUA yang tersusul gugur — persis seperti bentuk lama", () => {
    seedCycle(1, "staging", false);
    seedCycle(2, "staging", false);
    seedCycle(3, "staging", false);
    gugurkan(3);
    expect(statuses()).toEqual([
      { seq: 1, status: "failed" },
      { seq: 2, status: "failed" },
      { seq: 3, status: "staging" },
    ]);
  });

  it("hanya SATU yang dipertahankan — yang ber-sequence tertinggi", () => {
    seedCycle(1, "staging", true);
    seedCycle(2, "staging", true);
    seedCycle(3, "staging", false);
    gugurkan(3);
    expect(statuses()).toEqual([
      { seq: 1, status: "failed" },
      { seq: 2, status: "staging" },
      { seq: 3, status: "staging" },
    ]);
  });

  // ⏳ Ongkos +-144 MB harus SEMENTARA. Tanpa syarat "tak ada complete di
  // atasnya", cut ini tertahan selamanya dan ongkosnya jadi permanen.
  it("pengecualiannya dilepas begitu ada cut complete di atasnya", () => {
    seedCycle(1, "staging", true);
    seedCycle(2, "complete", true);
    seedCycle(3, "staging", false);
    gugurkan(3);
    expect(statuses()).toEqual([
      { seq: 1, status: "failed" },   // ← dilepas: bukan kandidat lagi
      { seq: 2, status: "complete" },
      { seq: 3, status: "staging" },
    ]);
  });

  it("sesudah finalisasi, cut yang dipertahankan tadi gugur pada putaran berikutnya", () => {
    seedCycle(1, "staging", true);
    seedCycle(2, "staging", false);
    gugurkan(2);
    expect(statuses()).toEqual([
      { seq: 1, status: "staging" },
      { seq: 2, status: "staging" },
    ]);

    // Finalisasi mengangkat cut 1 menjadi complete; alokasi berikutnya datang.
    sql(`UPDATE app.saldo_pelanggan_source_cycle
         SET status='complete', source_completed_at='2026-09-16 19:05:15+00', promoted_at=clock_timestamp()
         WHERE unit_id=1 AND source_cycle_sequence=1;`);
    seedCycle(3, "staging", false);
    gugurkan(3);

    expect(statuses()).toEqual([
      { seq: 1, status: "complete" },
      { seq: 2, status: "failed" },
      { seq: 3, status: "staging" },
    ]);
  });
});
