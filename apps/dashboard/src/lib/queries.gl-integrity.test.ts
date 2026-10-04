import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

const { qScoped } = vi.hoisted(() => ({ qScoped: vi.fn() }));
vi.mock("./db", () => ({ q: vi.fn(), qScoped, pool: {} }));
import { getClosingOpname, getDailyGlByProduct, getGlSourceRevision, getZeroClosingEvents } from "./queries";

const U = 1 as ScopedUnitId;
const D1 = "2026-10-01";
const D2 = "2026-10-02";
const D3 = "2026-10-03";

/**
 * Actual SQL execution against either isolated in-memory PGlite or the
 * disposable PostgreSQL 16 CI service. Never reads DATABASE_URL or local
 * credentials. All values are synthetic; no application/source data is read.
 * Install the optional runner outside the checkout, then run:
 *   npm install --prefix /tmp/solamax-gl-sql-tests @electric-sql/pglite@0.5.8
 *   GL_SQL_TEST_PGLITE=/tmp/solamax-gl-sql-tests/node_modules/@electric-sql/pglite \
 *     pnpm --filter @solamax/dashboard test -- queries.gl-integrity
 * PostgreSQL 16 CI mode requires BOTH GL_SQL_TEST_POSTGRES16=1 and
 * GL_SQL_TEST_POSTGRES16_URL pointing to the fixed disposable loopback service
 * in ci.yml. Its fixtures live in a unique schema in one rollback-only
 * transaction; public/app schemas are never fixture targets.
 * Without either runner the SQL behavior suite is explicitly SKIPPED, not passed.
 * Scope/revision wiring below always runs in the ordinary unit-test suite.
 * PGlite 0.5.8 embeds PostgreSQL 18.3 WASM; production uses PostgreSQL 16.
 * The separate CI PostgreSQL 16 step closes that engine-version gap, but neither
 * fixture runner replaces staging schema/RLS/live-oracle verification.
 */
const enginePath = process.env.GL_SQL_TEST_PGLITE;
const postgresOptIn = process.env.GL_SQL_TEST_POSTGRES16;
const postgresUrl = process.env.GL_SQL_TEST_POSTGRES16_URL;
// An incomplete/invalid opt-in must FAIL, not silently skip or fall back to WASM.
const postgresRequested = postgresOptIn !== undefined || postgresUrl !== undefined;
interface SqlEngine {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

const CI_DATABASE = "solamax_snapshot_ci";
const CI_USER = "snapshot_ci_admin";

function postgresFixtureTarget(optIn: string | undefined, raw: string | undefined) {
  if (optIn !== "1" || !raw)
    throw new Error("PostgreSQL fixture mode requires explicit opt-in and its dedicated test URL");
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("PostgreSQL fixture URL is invalid"); }
  // Exact test-only identity, literal IPv4 loopback, explicit unprivileged port,
  // and no query/hash overrides (especially host=/cloudsql or libpq options).
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== `/${CI_DATABASE}` || url.username !== CI_USER
    || url.password !== "snapshot_ci_only" || url.search || url.hash
    || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535) {
    throw new Error("PostgreSQL fixtures require the fixed disposable loopback test database/account");
  }
  return {
    host: "127.0.0.1", port: Number(url.port), database: CI_DATABASE,
    user: CI_USER, password: "snapshot_ci_only",
  };
}

function assertPostgresFixtureIdentity(row: { database: string; role: string; version: string } | undefined) {
  if (!row || row.database !== CI_DATABASE || row.role !== CI_USER
    || !/^16\d{4}$/.test(row.version)) {
    throw new Error("PostgreSQL fixture connection must be the disposable test database/account on PostgreSQL 16");
  }
}

async function postgresFixtureEngine(): Promise<SqlEngine> {
  const target = postgresFixtureTarget(postgresOptIn, postgresUrl);
  const client = new Client({ ...target, ssl: false, connectionTimeoutMillis: 5_000,
    query_timeout: 15_000, application_name: "solamax_gl_fixture_ci",
    options: "-c statement_timeout=10000 -c lock_timeout=5000" });
  let transaction = false;
  try {
    await client.connect();
    // Only a read occurs before endpoint/identity/version validation. This also
    // catches an accidental localhost tunnel connected to a non-test database.
    const identity = await client.query<{ database: string; role: string; version: string }>(
      `SELECT current_database() AS database, current_user AS role,
              current_setting('server_version_num') AS version`,
    );
    assertPostgresFixtureIdentity(identity.rows[0]);
    await client.query("BEGIN");
    transaction = true;
    const schema = `gl_integrity_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Deliberately omit public: unqualified production SQL must resolve ONLY
    // our fixture schema or fail. ROLLBACK removes schema and every fixture row.
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    const location = await client.query<{ schema: string }>("SELECT current_schema() AS schema");
    if (location.rows[0]?.schema !== schema) throw new Error("Fixture schema isolation failed");
    return {
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
      exec: async (sql: string) => client.query(sql),
      close: async () => {
        try {
          await client.query("ROLLBACK");
          const cleanup = await client.query<{ clean: boolean }>(
            "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS clean", [schema],
          );
          if (!cleanup.rows[0]?.clean) throw new Error("Fixture schema rollback verification failed");
        }
        finally { await client.end(); }
      },
    };
  } catch (error) {
    try { if (transaction) await client.query("ROLLBACK"); }
    finally { await client.end(); }
    throw error;
  }
}

let db: SqlEngine;
let nextId = 0;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function stock(
  d: string, tank: string, op: number | null, bk: number | null = op,
  extra: { timestamp?: string; product?: string; canceled?: number; unit?: number; id?: string; businessDate?: string | null } = {},
) {
  await db.query(`INSERT INTO opname
    (unit_id, ckdopnbbm, ckdtangki, ckdbbm, dtaglopn, dtgljam, nstockop, nstockbk, sbatal)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    extra.unit ?? 1, extra.id ?? `O${String(++nextId).padStart(8, "0")}`, tank,
    extra.product ?? "P", extra.businessDate === undefined ? d : extra.businessDate,
    extra.timestamp ?? `${nextDay(d)}T06:00:00+07:00`, op, bk, extra.canceled ?? 0,
  ]);
}

async function sale(d: string, volume: number | null, product = "P", unit = 1) {
  const id = `S${++nextId}`;
  await db.query("INSERT INTO sales_header VALUES ($1,$2,$3)", [unit, id, d]);
  await db.query("INSERT INTO sales_detail VALUES ($1,$2,$3,$4)", [unit, id, product, volume]);
}

async function receipt(d: string | null, volume: number | null, canceled = 0, timestamp = `${D3}T02:00:00+07:00`) {
  await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',$3,123,$4)", [d, timestamp, volume, canceled]);
}

async function tera(d: string, volume: number | null, canceled = 0) {
  await db.query("INSERT INTO terra_resmi VALUES (1,$1,'P',$2,$3)", [d, volume, canceled]);
}

async function baseline() {
  await stock(D1, "A", 10_000); await stock(D1, "B", 10_000);
  await stock(D2, "A", 9_000); await stock(D2, "B", 10_000);
  await sale(D2, 1_000);
}

async function day() {
  const rows = await getDailyGlByProduct(U, D2, D2);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

// Wiring remains an unconditional CI guard even without the optional engine.
describe("G/L source revision wiring", () => {
  beforeEach(() => qScoped.mockReset());
  it("uses the authorized unit and every contributing source, including masters", async () => {
    qScoped.mockResolvedValue([{ revision: "source-vector" }]);
    expect(await getGlSourceRevision(U)).toBe("source-vector");
    const [unit, sql, params] = qScoped.mock.calls[0]!;
    expect(unit).toBe(U); expect(params).toEqual([U]);
    for (const domain of ["sales", "opname", "delivery", "terra_resmi", "masters"])
      expect(sql).toContain(`'${domain}'`);
    expect(sql).toContain("ORDER BY domain");
    expect(sql).toContain("SS.US");
    expect(sql).not.toMatch(/max\s*\(/i);
  });
  it("returns an explicit sentinel when no source revision exists", async () => {
    qScoped.mockResolvedValue([]);
    expect(await getGlSourceRevision(U)).toBe("never");
  });
});

describe("PostgreSQL fixture safety gates", () => {
  const safe = "postgresql://snapshot_ci_admin:snapshot_ci_only@127.0.0.1:5432/solamax_snapshot_ci";
  it("accepts only the explicit disposable loopback target", () => {
    expect(postgresFixtureTarget("1", safe)).toMatchObject({ host: "127.0.0.1", port: 5432,
      database: CI_DATABASE, user: CI_USER });
  });
  it.each([undefined, "", "0", "true"])("rejects absent/incorrect opt-in (%s)", flag => {
    expect(() => postgresFixtureTarget(flag, safe)).toThrow();
  });
  it.each([
    undefined, "", "not-a-url",
    safe.replace("127.0.0.1", "sql.example.com"),
    safe.replace("127.0.0.1", "127.0.0.1.example.com"),
    safe.replace("solamax_snapshot_ci", "solamax"),
    safe.replace("snapshot_ci_admin:", "dashboard_app:"),
    safe.replace("snapshot_ci_only", "different-password"),
    safe.replace(":5432", ""), safe.replace(":5432", ":443"),
    safe + "?host=/cloudsql/live", safe + "?options=-csearch_path=public", safe + "#override",
  ])("rejects unsafe/incomplete fixture URL case %#", url => {
    expect(() => postgresFixtureTarget("1", url)).toThrow();
  });
  it("checks actual server identity and major version before any fixture writes", () => {
    const valid = { database: CI_DATABASE, role: CI_USER, version: "160012" };
    expect(() => assertPostgresFixtureIdentity(valid)).not.toThrow();
    for (const row of [undefined, { ...valid, database: "solamax" },
      { ...valid, role: "ingest" }, { ...valid, version: "150010" },
      { ...valid, version: "180003" }, { ...valid, version: "16invalid" }]) {
      expect(() => assertPostgresFixtureIdentity(row)).toThrow();
    }
  });
});

describe.skipIf(!enginePath && !postgresRequested).sequential("G/L SQL integrity (isolated PostgreSQL execution)", () => {
  beforeAll(async () => {
    if (postgresRequested && enginePath) throw new Error("Choose exactly one SQL fixture engine; PostgreSQL CI cannot fall back to PGlite");
    if (postgresRequested) db = await postgresFixtureEngine();
    else {
      const { PGlite } = createRequire(import.meta.url)(enginePath!) as { PGlite: new () => SqlEngine };
      db = new PGlite();
    }
    await db.exec(`
      CREATE TABLE opname (unit_id int, ckdopnbbm char(15), ckdtangki char(5), ckdbbm char(5),
        dtaglopn date, dtgljam timestamptz, nstockop numeric, nstockbk numeric, sbatal int);
      CREATE TABLE product (unit_id int, ckdbbm char(5), vcnmbbm text);
      CREATE TABLE sales_header (unit_id int, ckdjualbbm text, dtgljual date);
      CREATE TABLE sales_detail (unit_id int, ckdjualbbm text, ckdbbm char(5), nvolume numeric);
      CREATE TABLE delivery (unit_id int, dtgltrm date, dtgljam timestamptz, ckdbbm char(5),
        ckdtangki char(5), nvoldo numeric, nvolreal numeric, sbatal int);
      CREATE TABLE terra_resmi (unit_id int, business_date date, ckdbbm char(5), nvolume numeric, sbatal int);
      CREATE TABLE sync_state (unit_id int, domain text, last_run_at timestamptz);
    `);
  }, 30_000);
  beforeEach(async () => {
    await db.exec("TRUNCATE opname, product, sales_header, sales_detail, delivery, terra_resmi, sync_state");
    nextId = 0;
    qScoped.mockReset();
    qScoped.mockImplementation(async (_scope, sql, params) => (await db.query(sql, params)).rows);
  });
  afterAll(async () => { await db?.close(); });

  it("keeps complete matching tank totals and a genuine zero G/L", async () => {
    await baseline();
    expect(await day()).toMatchObject({ fisik: 19_000, fisik_prev: 20_000, gl: 0, excluded_tanks: 0, provisional: false });
  });

  it.each([null, -1, 100_001])("null/garbage physical stock (%s) invalidates the whole product", async (bad) => {
    await baseline();
    await db.query("UPDATE opname SET nstockop=$1 WHERE dtaglopn=$2 AND ckdtangki='B'", [bad, D2]);
    expect(await day()).toMatchObject({ fisik: null, gl: null, excluded_tanks: 1, provisional: true });
  });

  it.each([null, -1, 100_001, 70_001])("null/garbage book stock (%s) cannot silently omit a tank", async (bad) => {
    await baseline();
    await db.query("UPDATE opname SET nstockbk=$1 WHERE dtaglopn=$2 AND ckdtangki='B'", [bad, D2]);
    expect(await day()).toMatchObject({ fisik: null, gl: null, excluded_tanks: 1, provisional: true });
  });

  it("an invalid prior tank cannot become a false recovery gain", async () => {
    await baseline();
    await db.query("UPDATE opname SET nstockop=NULL WHERE dtaglopn=$1 AND ckdtangki='B'", [D1]);
    expect(await day()).toMatchObject({ fisik: 19_000, fisik_prev: null, gl: null, provisional: true });
  });

  it("all-invalid current tanks stay unknown, never zero", async () => {
    await baseline();
    await db.query("UPDATE opname SET nstockop=NULL WHERE dtaglopn=$1", [D2]);
    expect(await day()).toMatchObject({ fisik: null, gl: null, excluded_tanks: 2, provisional: true });
  });

  it("a missing current tank cannot be subtracted from the complete prior product", async () => {
    await baseline();
    await db.query("DELETE FROM opname WHERE dtaglopn=$1 AND ckdtangki='B'", [D2]);
    expect(await day()).toMatchObject({ gl: null, provisional: true });
  });

  it("a newly reappearing tank cannot create a false gain", async () => {
    await baseline();
    await db.query("DELETE FROM opname WHERE dtaglopn=$1 AND ckdtangki='B'", [D1]);
    expect(await day()).toMatchObject({ gl: null, provisional: true });
  });

  it("compares tank identities, not just equal tank counts", async () => {
    await baseline();
    await db.query("UPDATE opname SET ckdtangki='C' WHERE dtaglopn=$1 AND ckdtangki='B'", [D2]);
    expect(await day()).toMatchObject({ gl: null, provisional: true });
  });

  it("normalizes tank whitespace before ranking and comparing endpoints", async () => {
    await baseline();
    await db.query("UPDATE opname SET ckdtangki=' A ' WHERE dtaglopn=$1 AND ckdtangki='A'", [D1]);
    await stock(D2, " A ", 9_100, 9_100, { timestamp: `${D3}T07:00:00+07:00` });
    expect(await day()).toMatchObject({ fisik: 19_100, fisik_prev: 20_000, gl: 100, provisional: false });
  });

  it("prior provisional status propagates to the next day's calculation", async () => {
    await baseline();
    await db.query("UPDATE opname SET dtgljam=$1 WHERE dtaglopn=$2", [`${D1}T21:00:00+07:00`, D1]);
    expect(await day()).toMatchObject({ gl: 0, provisional: true });
  });

  it("preserves NVOLDO, business dates, official tera, and cancellation semantics", async () => {
    await baseline();
    await receipt(D2, 500); // source recording date D3 must not shift business date D2
    await receipt(D2, 8_000, 1);
    await tera(D2, 100); await tera(D2, 2_000, 1);
    expect(await day()).toMatchObject({ pen_do: 500, tera: 100, sales_gross: 1_000, gl: -600, provisional: false });
  });

  it("uses WIB when delivery business date is absent", async () => {
    await baseline();
    await receipt(null, 500, 0, `${D1}T18:00:00Z`); // D2 01:00 WIB
    expect(await day()).toMatchObject({ pen_do: 500, gl: -500 });
  });

  it.each([null, 100_001, -100_001])("unknown/garbage delivery (%s) blocks G/L but keeps diagnostic valid sums", async (volume) => {
    await baseline(); await receipt(D2, 500); await receipt(D2, volume);
    expect(await day()).toMatchObject({ pen_do: 500, gl: null, provisional: true });
  });

  it.each(["sale", "tera"])("a NULL %s volume is not silently treated as zero", async (domain) => {
    await baseline();
    if (domain === "sale") await sale(D2, null); else await tera(D2, null);
    expect(await day()).toMatchObject({ sales_gross: 1_000, tera: 0, gl: null, provisional: true });
  });

  it("invalid canceled and out-of-window movements do not taint the day", async () => {
    await baseline();
    await receipt(D2, null, 1); await tera(D2, null, 1);
    await receipt(D1, null); await sale(D1, null); await tera(D1, null);
    await sale(D2, null, "Q");
    expect(await day()).toMatchObject({ gl: 0, provisional: false });
  });

  it("invalid movement in a skipped closing day taints the full gap window", async () => {
    await stock(D1, "A", 10_000); await stock(D3, "A", 9_000);
    await sale(D2, 1_000); await receipt(D2, null);
    const [r] = await getDailyGlByProduct(U, D3, D3);
    expect(r).toMatchObject({ sales_gross: 1_000, gl: null, provisional: true });
  });

  it("chooses latest morning, ignores 08:00 and later sessions, and preserves unaffected products", async () => {
    await baseline();
    await stock(D2, "A", 9_100, 9_100, { timestamp: `${D3}T07:59:59+07:00` });
    await stock(D2, "A", 9_200, 9_200, { timestamp: `${D3}T08:00:00+07:00` });
    await stock(D2, "A", 9_300, 9_300, { timestamp: `${D3}T08:07:00+07:00` });
    await stock(D2, "A", 9_700, 9_700, { timestamp: `${D3}T10:20:49+07:00` });
    await stock(D1, "Z", 5_000, 5_000, { product: "Q" });
    await stock(D2, "Z", 5_000, 5_000, { product: "Q" });
    const rows = await getDailyGlByProduct(U, D2, D2);
    expect(rows.find(r => r.ckdbbm === "P")).toMatchObject({ fisik: 19_100, gl: 100, provisional: false });
    expect(rows.find(r => r.ckdbbm === "Q")).toMatchObject({ fisik: 5_000, gl: 0, provisional: false });
    const closing = await getClosingOpname(U, D2, D2);
    expect(closing.find(r => r.ckdtangki === "A")).toMatchObject({ op: 9_100, provisional: false });
  });

  it("canceled latest morning is not eligible for closing", async () => {
    await baseline();
    await stock(D2, "A", 20_000, 20_000, { timestamp: `${D3}T07:59:00+07:00`, canceled: 1 });
    expect(await day()).toMatchObject({ fisik: 19_000, gl: 0, provisional: false });
  });

  it("falls back to latest available when no morning exists and marks it provisional", async () => {
    await stock(D1, "A", 10_000);
    await stock(D2, "A", 9_500, 9_500, { timestamp: `${D2}T20:00:00+07:00` });
    await stock(D2, "A", 9_000, 9_000, { timestamp: `${D3}T08:00:00+07:00` });
    await sale(D2, 1_000);
    expect(await day()).toMatchObject({ fisik: 9_000, gl: 0, provisional: true });
  });

  it("keeps synthetic midnight for a source NULL timestamp as a provisional fallback", async () => {
    await stock(D1, "A", 10_000);
    await stock(D2, "A", 9_000, 9_000, { timestamp: `${D2}T00:00:00+07:00` });
    await sale(D2, 1_000);
    expect(await day()).toMatchObject({ fisik: 9_000, gl: 0, provisional: true });
  });

  it("breaks equal timestamp ties by source document key deterministically", async () => {
    await stock(D1, "A", 10_000);
    await stock(D2, "A", 9_000, 9_000, { id: "O-AAA" });
    await stock(D2, "A", 9_100, 9_100, { id: "O-ZZZ" });
    await sale(D2, 1_000);
    expect(await day()).toMatchObject({ fisik: 9_100, gl: 100 });
  });

  it("preserves a real zero reading and flags the source inconsistency without imputation", async () => {
    await stock(D1, "A", 10_000);
    await stock(D2, "A", 0, 10_000);
    await stock(D3, "A", 9_500);
    expect(await day()).toMatchObject({ fisik: 0, gl: -10_000, provisional: false });
    const events = await getZeroClosingEvents([U], D1, D3);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ d: D2, ckdtangki: "A" });
  });

  it("preserves gap-window movements and flags the gap", async () => {
    await stock(D1, "A", 10_000); await stock(D3, "A", 7_000);
    await sale(D2, 1_000); await sale(D3, 2_000);
    const [r] = await getDailyGlByProduct(U, D3, D3);
    expect(r).toMatchObject({ fisik_prev: 10_000, sales_gross: 3_000, gl: 0, provisional: true });
  });

  it("single-day, month window, and split window return identical day values", async () => {
    await baseline();
    const single = await getDailyGlByProduct(U, D2, D2);
    const range = await getDailyGlByProduct(U, D1, D3);
    expect(range.filter(r => r.d === D2)).toEqual(single);
  });

  it("never includes another unit's stock or movements", async () => {
    await baseline();
    await stock(D2, "A", 50_000, 50_000, { unit: 2 });
    await sale(D2, 50_000, "P", 2);
    expect(await day()).toMatchObject({ fisik: 19_000, sales_gross: 1_000, gl: 0 });
  });

  it("missing prior anchor is unknown, not zero", async () => {
    await stock(D2, "A", 10_000);
    expect(await day()).toMatchObject({ fisik_prev: null, gl: null, provisional: true });
  });

  it("the source revision changes for each domain, even a late older transaction", async () => {
    expect(await getGlSourceRevision(U)).toBe("never");
    for (const domain of ["sales", "opname", "delivery", "terra_resmi", "masters"])
      await db.query("INSERT INTO sync_state VALUES (1,$1,$2)", [domain, `${D2}T10:00:00.123456Z`]);
    let previous = await getGlSourceRevision(U);
    for (const domain of ["sales", "opname", "delivery", "terra_resmi", "masters"]) {
      await db.query("UPDATE sync_state SET last_run_at=$1 WHERE unit_id=1 AND domain=$2", [`${D2}T09:00:00.123457Z`, domain]);
      const revision = await getGlSourceRevision(U);
      expect(revision).not.toBe(previous); previous = revision;
    }
    await db.query("INSERT INTO sync_state VALUES (2,'opname',$1),(1,'cash',$1)", [`${D3}T12:00:00Z`]);
    expect(await getGlSourceRevision(U)).toBe(previous);
  });
});
