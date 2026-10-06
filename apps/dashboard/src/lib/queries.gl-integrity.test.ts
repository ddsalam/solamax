import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

const { qScoped } = vi.hoisted(() => ({ qScoped: vi.fn() }));
vi.mock("./db", () => ({ q: vi.fn(), qScoped, pool: {} }));
import { getClosingOpname, getDailyGlByProduct, getDailySalesByProduct, getDeliveryByProduct, getGlSourceRevision, getSalesByProduct, getZeroClosingEvents } from "./queries";

import { buildLaporanModel, type LaporanRaw } from "./laporan-model";
import { buildArusMinyak } from "./arus-minyak";
import { buildHarianModel } from "./harian-model";
import { addDays } from "./periods";

const U = 1 as ScopedUnitId;
const D1 = "2026-10-01";
const D2 = "2026-10-02";
const D3 = "2026-10-03";
// Identity normalization must match JavaScript trim, including source UTF-8
// whitespace that PostgreSQL trim(text) and locale regexes do not all remove.
const UNKNOWN_IDENTITIES = [null, "", "   ", "\t", "\n", "\r\n", "\u00a0", "\u2003", "\ufeff"];
const BLANK_IDENTITIES = UNKNOWN_IDENTITIES.filter((s): s is string => s !== null);
const ECMASCRIPT_TRIM = [0x9,0xa,0xb,0xc,0xd,0x20,0xa0,0x1680,
  0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,
  0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff].map(code => String.fromCharCode(code));

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
  extra: { timestamp?: string; product?: string | null; canceled?: number; unit?: number; id?: string; businessDate?: string | null } = {},
) {
  await db.query(`INSERT INTO opname
    (unit_id, ckdopnbbm, ckdtangki, ckdbbm, dtaglopn, dtgljam, nstockop, nstockbk, sbatal)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    extra.unit ?? 1, extra.id ?? `O${String(++nextId).padStart(8, "0")}`, tank,
    extra.product === undefined ? "P" : extra.product, extra.businessDate === undefined ? d : extra.businessDate,
    extra.timestamp ?? `${nextDay(d)}T06:00:00+07:00`, op, bk, extra.canceled ?? 0,
  ]);
}

async function sale(d: string, volume: number | null, product: string | null = "P", unit = 1) {
  const id = `S${++nextId}`;
  await db.query("INSERT INTO sales_header VALUES ($1,$2,$3)", [unit, id, d]);
  await db.query("INSERT INTO sales_detail (unit_id,ckdjualbbm,ckdbbm,nvolume) VALUES ($1,$2,$3,$4)", [unit, id, product, volume]);
  return id;
}

async function receipt(d: string | null, volume: number | null, canceled = 0, timestamp = `${D3}T02:00:00+07:00`) {
  await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',$3,123,$4)", [d, timestamp, volume, canceled]);
}

async function tera(d: string, volume: number | null, canceled = 0) {
  await db.query("INSERT INTO terra_resmi VALUES (1,$1,'P',$2,$3)", [d, volume, canceled]);
}

async function unassignedMovement(
  domain: "receipt" | "sale" | "tera", product: string | null,
  date = D2, canceled = 0, unit = 1,
) {
  if (domain === "sale") await sale(date, 100, product, unit);
  else if (domain === "receipt") await db.query(
    "INSERT INTO delivery VALUES ($1,$2,$3,$4,'A',100,100,$5)",
    [unit, date, `${nextDay(date)}T02:00:00+07:00`, product, canceled],
  );
  else await db.query("INSERT INTO terra_resmi VALUES ($1,$2,$3,100,$4)", [unit, date, product, canceled]);
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
  it("uses the authorized unit and a schema-compatible, domain-complete source vector", async () => {
    qScoped.mockResolvedValue([{ revision: "source-vector" }]);
    expect(await getGlSourceRevision(U)).toBe("source-vector");
    const [unit, sql, params] = qScoped.mock.calls[0]!;
    expect(unit).toBe(U); expect(params).toEqual([U]);
    expect(sql).toContain("s.unit_id = $1");
    expect(sql).toContain("to_jsonb(s)->>'gl_revision'");
    expect(sql).toContain("to_jsonb(s)->>'gl_revision_run_at'");
    expect(sql).toContain("ORDER BY domain");
    expect(sql).toContain("SS.US");
    expect(sql).not.toMatch(/domain\s+(?:IN|=)/i);
    expect(sql).not.toMatch(/max\s*\(/i);
  });
  it("returns the empty vector when no source revision exists", async () => {
    qScoped.mockResolvedValue([]);
    expect(await getGlSourceRevision(U)).toBe("[]");
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
      CREATE TABLE opname (unit_id int, ckdopnbbm char(15), ckdtangki char(5) NOT NULL, ckdbbm char(5),
        dtaglopn date, dtgljam timestamptz, nstockop numeric, nstockbk numeric, sbatal int);
      CREATE TABLE product (unit_id int, ckdbbm char(5), vcnmbbm text);
      CREATE TABLE sales_header (unit_id int, ckdjualbbm text, dtgljual date);
      CREATE TABLE sales_detail (unit_id int, ckdjualbbm text, ckdbbm char(5), nvolume numeric, nsubtotal numeric, nhargajual numeric, dtgljam timestamptz);
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

  it.each(["2026-10-01", "2026-01-01", "2024-03-01"])(
    "detects a previous-month zero anchor with predecessor context (%s)", async first => {
      const previous = addDays(first, -1);
      const predecessor = addDays(first, -2);
      const following = addDays(first, 1);
      await db.exec("INSERT INTO product VALUES (1,'P','SOLAR')");
      await stock(predecessor, "A", 10_000);
      await stock(previous, "A", 0, 10_000);
      await stock(first, "A", 9_000);
      await stock(following, "A", 8_500);
      await sale(first, 1_000); await sale(following, 500);
      // Starting at the candidate zero itself loses its lag and hides the event.
      expect(await getZeroClosingEvents([U], previous, following)).toEqual([]);
      const zeros = await getZeroClosingEvents([U], predecessor, following);
      expect(zeros).toEqual([expect.objectContaining({
        d: previous, prev: 10_000, next: 9_000, recv_next: 0,
      })]);
      const gl = await getDailyGlByProduct(U, first, following);
      // The mirror gain on a placeholder-zero anchor is withheld, raw kept for audit.
      expect(gl[0]).toMatchObject({ fisik_prev: 0, fisik: 9_000, gl: null, gl_raw: 10_000,
        gl_suspect: "jangkar_nol", provisional: true });
      expect(gl[1]).toMatchObject({ fisik_prev: 9_000, fisik: 8_500, gl: 0, gl_raw: 0, gl_suspect: null });
      const build = async (date: string) => buildHarianModel({
        units: [{ unit_id: U, code: "SYNTHETIC", name: "Synthetic unit" }], date,
        dailySales: await getDailySalesByProduct([U], first, date),
        gl: new Map([[1, gl]]), coverage: [{ unit_id: 1, sales_min: predecessor }],
        sync: [{ unit_id: 1, last_run: `${following}T01:00:00Z` }],
        glSuspectDates: zeros.map(z => ({ unitId: z.unit_id, date: z.d })),
      });
      const boundary = await build(first);
      expect(boundary).toMatchObject({ glProvisional: true, glMonthlyProvisional: true, glIncomplete: true });
      expect(boundary.glSuspectUnits.map(u => u.unitId)).toEqual([1]);
      expect(boundary.glDaily.grandTotal).toBeNull();
      expect(boundary.glMonthly.grand.kum).toBeNull();
      const later = await build(following);
      expect(later).toMatchObject({ glProvisional: false, glMonthlyProvisional: true, glIncomplete: true });
      expect(later.glDaily.grandTotal).toBe(0);
      expect(later.glMonthly.grand.kum).toBeNull();
      // A refill satisfies the legacy warning detector, but cannot rehabilitate
      // a zero already classified penutup_nol: the dependent balance stays out.
      await receipt(first, 9_000);
      expect(await getZeroClosingEvents([U], predecessor, following)).toEqual([]);
      expect((await getDailyGlByProduct(U, first, first))[0]).toMatchObject({
        fisik_prev: 0, pen_do: 9_000, gl: null, gl_raw: 1_000, gl_suspect: "jangkar_nol", provisional: true });
    },
  );

  it("discards a detected zero whose following anchor precedes the report month", async () => {
    await db.exec("INSERT INTO product VALUES (1,'P','SOLAR')");
    await stock("2026-09-28", "A", 10_000);
    await stock("2026-09-29", "A", 0, 10_000);
    await stock("2026-09-30", "A", 9_000);
    await stock(D1, "A", 8_000); await sale(D1, 1_000);
    const zeros = await getZeroClosingEvents([U], "2026-09-28", D2);
    expect(zeros).toEqual([expect.objectContaining({ d: "2026-09-29" })]);
    const model = buildHarianModel({
      units: [{ unit_id: U, code: "SYNTHETIC", name: "Synthetic unit" }], date: D1,
      dailySales: await getDailySalesByProduct([U], D1, D1),
      gl: new Map([[1, await getDailyGlByProduct(U, D1, D1)]]),
      coverage: [{ unit_id: 1, sales_min: "2026-09-28" }],
      sync: [{ unit_id: 1, last_run: `${D2}T01:00:00Z` }],
      glSuspectDates: zeros.map(z => ({ unitId: z.unit_id, date: z.d })),
    });
    expect(model).toMatchObject({ glProvisional: false, glMonthlyProvisional: false, glSuspectUnits: [] });
    expect(model.glDaily.grandTotal).toBe(0);
    expect(model.glMonthly.grand.kum).toBe(0);
  });

  it("keeps complete matching tank totals and a genuine zero G/L", async () => {
    await baseline();
    expect(await day()).toMatchObject({ fisik: 19_000, fisik_prev: 20_000, gl: 0, gl_raw: 0,
      gl_suspect: null, excluded_tanks: 0, provisional: false });
  });

  it.each([" ", "\t", "\n", "\u00a0", "\ufeff"])("sales summary groups boundary aliases (%s) before joining G/L and preserves latest price", async pad => {
    await db.query("INSERT INTO product VALUES (1,'P','SOLAR'),(1,$1,'SOLAR'),(2,'P','FOREIGN')", [`${pad}P`]);
    const earlier = await sale(D2, 100, "P");
    const latest = await sale(D2, 200, `${pad}P${pad}`);
    await db.query("UPDATE sales_detail SET nsubtotal=1000000, nhargajual=10000, dtgljam=$1 WHERE ckdjualbbm=$2", [`${D2}T01:00:00Z`, earlier]);
    await db.query("UPDATE sales_detail SET nsubtotal=2460000, nhargajual=12300, dtgljam=$1 WHERE ckdjualbbm=$2", [`${D2}T02:00:00Z`, latest]);
    await sale(D1, 10_000); await sale(D3, 20_000); await sale(D2, 30_000, "P", 2);
    expect(await getSalesByProduct(U, D2, D2)).toEqual([
      { ckdbbm: "P", nama: "SOLAR", vol: 300, omzet: 3_460_000, harga: 12_300 },
    ]);
  });

  it("sales summary preserves one unidentified group, case and internal whitespace", async () => {
    for (const product of UNKNOWN_IDENTITIES) await sale(D2, 1, product);
    await sale(D2, 2, "P"); await sale(D2, 3, "p"); await sale(D2, 4, "P\tQ");
    const rows = await getSalesByProduct(U, D2, D2);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.ckdbbm === null)).toMatchObject({ nama: null, vol: UNKNOWN_IDENTITIES.length });
    expect(rows.find(r => r.ckdbbm === "P")?.vol).toBe(2);
    expect(rows.find(r => r.ckdbbm === "p")?.vol).toBe(3);
    expect(rows.find(r => r.ckdbbm === "P\tQ")?.vol).toBe(4);
  });

  it.each([false, true])("delivery summary groups aliases with master aliases=%s, preserving receipt filters", async masterAlias => {
    await db.exec("INSERT INTO product VALUES (1,'P','SOLAR')");
    if (masterAlias) await db.query("INSERT INTO product VALUES (1,$1,'SOLAR')", ["\u00a0P"]);
    await receipt(D2, 100);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,$3,'A',200,999999,0)", [D2, `${D3}T02:00:00+07:00`, "\ufeffP\u00a0"]);
    // Existing NVOLDO/date/cancellation/unit behavior remains unchanged.
    await receipt(D2, 8_000, 1); await receipt(D1, 9_000); await receipt(D3, 9_000);
    await receipt(D2, 100_001);
    await db.query("INSERT INTO delivery VALUES (2,$1,$2,'P','A',9000,9000,0)", [D2, `${D2}T12:00:00Z`]);
    expect(await getDeliveryByProduct(U, D2, D2)).toEqual([{ ckdbbm: "P", nama: "SOLAR", vol: 300 }]);
  });

  it("delivery summary retains one unknown identity without merging real case/internal-space codes", async () => {
    for (const product of [null, "", "\t", "\u00a0", "\ufeff"]) await unassignedMovement("receipt", product);
    await unassignedMovement("receipt", "P"); await unassignedMovement("receipt", "p");
    await unassignedMovement("receipt", "P\tQ");
    const rows = await getDeliveryByProduct(U, D2, D2);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.ckdbbm === null)).toEqual({ ckdbbm: null, nama: null, vol: 500 });
    for (const code of ["P", "p", "P\tQ"]) expect(rows.find(r => r.ckdbbm === code)?.vol).toBe(100);
  });

  it("SQL summaries feed one operational row with G/L/tera once and the complete monthly denominator", async () => {
    await db.exec("INSERT INTO product VALUES (1,'P','SOLAR')");
    await stock(D1, "A", 10_000); await stock(D2, "A", 9_600);
    await sale(D2, 100, "P"); await sale(D2, 200, "\u00a0P"); await sale(D2, 300, "\ufeffP");
    await db.exec("UPDATE sales_detail SET nsubtotal=nvolume*10000, nhargajual=10000");
    await tera(D2, 50);
    const prodDay = await getSalesByProduct(U, D2, D2);
    const prodMonth = await getSalesByProduct(U, D1, D2);
    const glRows = await getDailyGlByProduct(U, D2, D2);
    const raw: LaporanRaw = {
      prodDay, prodMonth, glRows, zeroClosing: [], delivMonth: [], doDay: [], doAnomalies: [], doSuspects: [],
      shift: { shifts: 3, last_dtgljam: null }, hargaDeviasi: [], corrections: 0, cash: [],
      saldo: { awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
        akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 } },
      recapPelanggan: [], recapEdc: [], recapDeposit: [], recapPendapatanLain: [], recapPengeluaran: [],
      recapSetoran: [], terra: [], tetanggaSebelum: { f: [], g: [], i: [] }, tetanggaSesudah: { f: [], g: [], i: [] },
    };
    const model = buildLaporanModel(raw, { unitCode: "6478111", date: D2, today: D3,
      mi: { month: 10, year: 2026, dayOfMonth: 2, daysInMonth: 31 }, detail: true });
    expect(model.sales.rows).toEqual([{ ckdbbm: "P", nama: "SOLAR", vol: 600, omzet: 6_000_000, gl: 150, tera: 50 }]);
    expect(new Set(model.sales.rows.map(r => r.ckdbbm)).size).toBe(model.sales.rows.length);
    expect(model.sales.rows.reduce((sum, r) => sum + r.gl!, 0)).toBe(model.sales.glTotal);
    expect(model.sales.rows.reduce((sum, r) => sum + r.tera, 0)).toBe(model.sales.totTera);
    expect(model.glMonthly.rows).toEqual([{ ckdbbm: "P", nama: "SOLAR", selisih: 150, vol: 600 }]);
    expect(model.glMonthly.glPctMonth).toBe(0.25);
    expect(model.glMonthly.rows[0]!.selisih! / model.glMonthly.rows[0]!.vol).toBe(0.25);
    expect(model.arusMinyak.total.losses).toBe(150);
    // Receipt summaries use the same canonical row grain in target/realization.
    await receipt(D2, 100);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,$3,'A',200,999999,0)", [D2, `${D3}T02:00:00+07:00`, "\u00a0P"]);
    const withReceipts = buildLaporanModel({ ...raw, glRows: await getDailyGlByProduct(U, D2, D2),
      delivMonth: await getDeliveryByProduct(U, D1, D2) },
      { unitCode: "6478111", date: D2, today: D3, mi: { month: 10, year: 2026, dayOfMonth: 2, daysInMonth: 31 }, detail: true });
    expect(withReceipts.target.rows).toHaveLength(1);
    expect(withReceipts.target.rows[0]!.terima).toBe(300);
    expect(withReceipts.sales.glTotal).toBe(-150);
  });

  it.each(UNKNOWN_IDENTITIES)("unidentified stock product (%s) is preserved as unavailable, not genuine zero", async product => {
    await stock(D1, "A", 10_000, 10_000, { product });
    await stock(D2, "A", 10_000, 10_000, { product });
    expect(await day()).toMatchObject({ ckdbbm: null, nama: null, fisik: null,
      fisik_prev: null, gl: null, excluded_tanks: 1, provisional: true });
    const [closing] = await getClosingOpname(U, D2, D2);
    expect(closing).toMatchObject({ ckdbbm: null, op: 10_000 }); // raw source stays intact
  });

  it.each(BLANK_IDENTITIES)("blank tank identity (%s) cannot establish valid stock coverage", async tank => {
    await stock(D1, tank, 10_000); await stock(D2, tank, 9_000); await sale(D2, 1_000);
    expect(await day()).toMatchObject({ ckdbbm: "P", fisik: null, fisik_prev: null,
      gl: null, excluded_tanks: 1, provisional: true });
  });

  it("invalid prior tank identity cannot turn into a valid recovery balance", async () => {
    await stock(D1, "", 10_000); await stock(D2, "A", 9_000); await sale(D2, 1_000);
    expect(await day()).toMatchObject({ fisik: 9_000, fisik_prev: null, gl: null, provisional: true });
  });

  it.each(UNKNOWN_IDENTITIES)("daily sales preserves unknown product (%s) without inventing an identity", async product => {
    await sale(D2, 100, product);
    await db.exec("UPDATE sales_detail SET nsubtotal=1234");
    expect(await getDailySalesByProduct([U], D2, D2)).toEqual([
      { unit_id: 1, d: D2, ckdbbm: null, nama: null, vol: 100, omzet: 1234 },
    ]);
  });

  it.each(UNKNOWN_IDENTITIES)("zero-closing detector preserves unknown product (%s) without hiding evidence", async product => {
    await stock(D1, "A", 10_000, 10_000, { product });
    await stock(D2, "A", 0, 10_000, { product });
    await stock(D3, "A", 9_500, 9_500, { product });
    expect(await getZeroClosingEvents([U], D1, D3)).toEqual([
      expect.objectContaining({ ckdbbm: null, ckdtangki: "A", d: D2 }),
    ]);
  });

  it.each((["receipt", "sale", "tera"] as const).flatMap(domain =>
    UNKNOWN_IDENTITIES.map(product => [domain, product] as const),
  ))("unknown %s product (%s) invalidates balances without allocating its volume", async (domain, product) => {
    await baseline();
    await stock(D1, "C", 5_000, 5_000, { product: "Q" });
    await stock(D2, "C", 5_000, 5_000, { product: "Q" });
    await unassignedMovement(domain, product);
    const rows = await getDailyGlByProduct(U, D2, D2);
    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.ckdbbm === "P")).toMatchObject({ pen_do: 0, sales_gross: 1_000,
      tera: 0, gl: null, provisional: true });
    expect(rows.find(r => r.ckdbbm === "Q")).toMatchObject({ pen_do: 0, sales_gross: 0,
      tera: 0, gl: null, provisional: true });
    expect(rows.find(r => r.ckdbbm === null)).toMatchObject({ fisik: null, fisik_prev: null,
      gl: null, excluded_tanks: 0, provisional: true,
      pen_do: domain === "receipt" ? 100 : 0, sales_gross: domain === "sale" ? 100 : 0,
      tera: domain === "tera" ? 100 : 0 });
  });

  it.each(["receipt", "sale", "tera"] as const)("unknown %s with no opname still emits an unavailable diagnostic row", async domain => {
    await unassignedMovement(domain, null);
    expect(await day()).toMatchObject({ ckdbbm: null, fisik: null, fisik_prev: null,
      gl: null, excluded_tanks: 0, provisional: true,
      pen_do: domain === "receipt" ? 100 : 0, sales_gross: domain === "sale" ? 100 : 0,
      tera: domain === "tera" ? 100 : 0 });
    expect(await getDailyGlByProduct(U, D3, D3)).toEqual([]); // no invented dates
  });

  it("deduplicates unknown stock/movement identities and keeps unassigned sums at daily grain", async () => {
    await stock(D1, "A", 10_000, 10_000, { product: null });
    await stock(D2, "A", 9_000, 9_000, { product: " " });
    await unassignedMovement("sale", null, D1);
    await unassignedMovement("sale", " "); await unassignedMovement("receipt", null);
    await unassignedMovement("tera", "");
    const row = await day();
    expect(row).toMatchObject({ ckdbbm: null, fisik: null, gl: null, excluded_tanks: 1,
      sales_gross: 100, pen_do: 100, tera: 100, provisional: true });
    const range = await getDailyGlByProduct(U, D1, D3);
    expect(range.filter(r => r.d === D2)).toEqual([row]);
  });

  it("retains numeric zero as diagnostic only when movement identity is missing", async () => {
    await unassignedMovement("receipt", null);
    await db.exec("UPDATE delivery SET nvoldo=0");
    expect(await day()).toMatchObject({ ckdbbm: null, pen_do: 0, gl: null, provisional: true });
  });

  it("unknown canceled, out-of-window, and foreign-unit movements do not taint a valid day", async () => {
    await baseline();
    for (const domain of ["receipt", "sale", "tera"] as const) {
      await unassignedMovement(domain, null, D1);
      await unassignedMovement(domain, null, D2, 0, 2);
    }
    await unassignedMovement("receipt", "", D2, 1);
    await unassignedMovement("tera", "", D2, 1);
    expect(await day()).toMatchObject({ ckdbbm: "P", gl: 0, provisional: false });
  });

  it("unknown movement inside a closing gap taints the balance and survives single/range queries", async () => {
    await stock(D1, "A", 10_000); await stock(D3, "A", 9_000); await sale(D3, 1_000);
    await unassignedMovement("receipt", null);
    const [current] = await getDailyGlByProduct(U, D3, D3);
    expect(current).toMatchObject({ d: D3, ckdbbm: "P", gl: null, provisional: true });
    const range = await getDailyGlByProduct(U, D2, D3);
    expect(range.filter(r => r.d === D3)).toEqual([current]);
    expect(range.filter(r => r.d === D2)).toEqual([expect.objectContaining({ ckdbbm: null, gl: null })]);
  });

  it.each([" ", ...BLANK_IDENTITIES.filter(s => s.length <= 2)])("padded valid product/tank codes (%s) remain valid identities and genuine zero", async pad => {
    const product = `${pad}P${pad}`; const tank = `${pad}A${pad}`;
    await stock(D1, tank, 10_000, 10_000, { product });
    await stock(D2, "A", 9_200, 9_200, { product: "P" }); await sale(D2, 1_000, product);
    await unassignedMovement("receipt", product); await unassignedMovement("tera", product);
    expect(await day()).toMatchObject({ ckdbbm: "P", fisik: 9_200, pen_do: 100,
      sales_gross: 1_000, tera: 100, gl: 0, provisional: false });
    expect(await getDailySalesByProduct([U], D2, D2)).toEqual([
      expect.objectContaining({ ckdbbm: "P", nama: "P", vol: 1_000 }),
    ]);
  });

  it("normalizes zero-closing tank endpoints and receipt identities consistently", async () => {
    await stock(D1, "\tA\u00a0", 10_000);
    await stock(D2, "A", 0, 10_000);
    await stock(D3, "\nA", 9_500);
    await receipt(D3, 100);
    await db.exec("UPDATE delivery SET ckdtangki=U&'\\00A0A\\0009'");
    expect(await getZeroClosingEvents([U], D1, D3)).toEqual([
      expect.objectContaining({ d: D2, ckdtangki: "A", prev: 10_000, next: 9_500, recv_next: 100 }),
    ]);
  });

  it("keeps internal tank whitespace distinct instead of silently merging tanks", async () => {
    await stock(D1, "A\tB", 10_000); await stock(D1, "AB", 5_000);
    await stock(D2, "A\tB", 9_000); await stock(D2, "AB", 5_000); await sale(D2, 1_000);
    expect(await day()).toMatchObject({ fisik: 14_000, fisik_prev: 15_000,
      gl: 0, excluded_tanks: 0, provisional: false });
  });

  it("matches every ECMAScript trim character and keeps internal whitespace", async () => {
    for (const pad of ECMASCRIPT_TRIM) {
      expect(pad.trim()).toBe("");
      await sale(D2, 1, pad); await sale(D2, 1, `${pad}P${pad}`);
    }
    await sale(D2, 7, "P\tQ");
    await sale(D2, 9, "P\u00a0Q");
    const rows = await getDailySalesByProduct([U], D2, D2);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.ckdbbm === null)?.vol).toBe(ECMASCRIPT_TRIM.length);
    expect(rows.find(r => r.ckdbbm === "P")?.vol).toBe(ECMASCRIPT_TRIM.length);
    expect(rows.find(r => r.ckdbbm === "P\tQ")?.vol).toBe(7);
    expect(rows.find(r => r.ckdbbm === "P\u00a0Q")?.vol).toBe(9);
  });

  it("normalized product master matches padded identities without multiplying sales", async () => {
    await db.exec("INSERT INTO product VALUES (1,'P','SOLAR'),(1,E'\\tP','SOLAR')");
    await sale(D2, 100, "\u00a0P\t");
    expect(await getDailySalesByProduct([U], D2, D2)).toEqual([
      expect.objectContaining({ ckdbbm: "P", nama: "SOLAR", vol: 100 }),
    ]);
    await stock(D1, "A", 10_000, 10_000, { product: "\tP" });
    await stock(D2, "A", 9_900, 9_900, { product: "P\u00a0" });
    expect(await day()).toMatchObject({ ckdbbm: "P", nama: "SOLAR", gl: 0, provisional: false });
  });

  it.each(["P\tQ", "P\u00a0Q"])("preserves internal product whitespace (%s) in stock and all movements", async product => {
    await stock(D1, "A", 10_000, 10_000, { product });
    await stock(D2, "A", 10_100, 10_100, { product });
    for (const domain of ["receipt", "sale", "tera"] as const) await unassignedMovement(domain, product);
    expect(await day()).toMatchObject({ ckdbbm: product, pen_do: 100, sales_gross: 100,
      tera: 100, gl: 0, provisional: false });
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

  it.each(["receipt", "sale", "tera"] as const)("SQL rejected %s movement cannot become a numeric Arus theory", async domain => {
    await baseline(); await receipt(D2, 500);
    if (domain === "receipt") await receipt(D2, null);
    else if (domain === "sale") await sale(D2, null);
    else await tera(D2, null);
    const source = await day();
    expect(source).toMatchObject({ movement_invalid: true, pen_do: 500,
      sales_gross: 1_000, tera: 0, gl: null });
    const model = buildArusMinyak([source]);
    expect(model.rows[0]).toMatchObject({ awal: 20_000, penerimaan: 500,
      penjualan: 1_000, teori: null, fisik: 19_000, losses: null });
    expect(model.total).toMatchObject({ awal: 20_000, teori: null, fisik: 19_000 });
    expect(model.incomplete).toBe(true); expect(model.provisional).toBe(true);
  });

  it("SQL valid movements retain theory when only current physical stock is missing", async () => {
    await stock(D1, "A", 10_000); await stock(D1, "B", 10_000);
    await stock(D2, "A", null, 9_000); await stock(D2, "B", 10_000);
    await sale(D2, 1_000);
    const source = await day();
    expect(source).toMatchObject({ movement_invalid: false, fisik_prev: 20_000, fisik: null, gl: null });
    const model = buildArusMinyak([source]);
    expect(model.rows[0]).toMatchObject({ awal: 20_000, teori: 19_000, fisik: null, losses: null });
    expect(model.total).toMatchObject({ awal: 20_000, teori: 19_000, fisik: null });
  });

  it("SQL unknown movements invalidate theory without assigning their diagnostic sums", async () => {
    await baseline(); await unassignedMovement("receipt", "\u00a0");
    const source = await getDailyGlByProduct(U, D2, D2);
    expect(source).toHaveLength(2);
    expect(source.every(r => r.movement_invalid)).toBe(true);
    const model = buildArusMinyak(source);
    expect(model.rows.find(r => r.ckdbbm === "P")).toMatchObject({ penerimaan: 0, teori: null });
    expect(model.rows.find(r => r.ckdbbm === null)).toMatchObject({ penerimaan: 100, awal: null, teori: null, fisik: null });
    expect(model.total).toMatchObject({ awal: null, teori: null, fisik: null, losses: null });
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
    // The zero stays the recorded stock; only its derived G/L is withheld.
    expect(await day()).toMatchObject({ fisik: 0, fisik_prev: 10_000, gl: null, gl_raw: -10_000,
      gl_suspect: "penutup_nol", provisional: true });
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ fisik_prev: 0, fisik: 9_500,
      gl: null, gl_raw: 9_500, gl_suspect: "jangkar_nol", provisional: true });
    const events = await getZeroClosingEvents([U], D1, D3);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ d: D2, ckdtangki: "A" });
  });

  // ---- Source-artefact verdict (synthetic tanks/quantities only) ----

  it("a placeholder zero tank inside a multi-tank product is an artefact", async () => {
    await stock(D1, "A", 6_000); await stock(D1, "B", 4_000);
    await stock(D2, "A", 0, 5_500); await stock(D2, "B", 3_800);
    await sale(D2, 700);
    expect(await day()).toMatchObject({ fisik: 3_800, fisik_prev: 10_000, gl: null, gl_raw: -5_500,
      gl_suspect: "penutup_nol", excluded_tanks: 0, provisional: true });
  });

  it("a legitimately empty tank inside a multi-tank product is not penalized", async () => {
    await stock(D1, "A", 6_000); await stock(D1, "B", 0);
    await stock(D2, "A", 5_300); await stock(D2, "B", 0);
    await sale(D2, 700);
    expect(await day()).toMatchObject({ fisik: 5_300, gl: 0, gl_raw: 0, gl_suspect: null, provisional: false });
  });

  it("a tank sold down to zero (explained by sales) is not an artefact, even beside a full tank", async () => {
    await stock(D1, "A", 2_000); await stock(D1, "B", 5_000);
    await stock(D2, "A", 0); await stock(D2, "B", 5_000);
    await sale(D2, 2_000);
    expect(await day()).toMatchObject({ fisik: 5_000, gl: 0, gl_raw: 0, gl_suspect: null, provisional: false });
  });

  it("uses the operational 1,000 L threshold strictly for a single-tank zero", async () => {
    await stock(D1, "A", 1_000); await stock(D2, "A", 0);
    expect(await day()).toMatchObject({ fisik: 0, gl: -1_000, gl_raw: -1_000, gl_suspect: null, provisional: false });
    await db.query("UPDATE opname SET nstockop=1000.01, nstockbk=1000.01 WHERE dtaglopn=$1", [D1]);
    expect(await day()).toMatchObject({ gl: null, gl_raw: -1_000.01, gl_suspect: "penutup_nol" });
  });

  it("a material negative theoretical stock is an artefact; receipts/cancellation/date boundary keep their semantics", async () => {
    await stock(D1, "A", 2_000); await stock(D2, "A", 9_000);
    await sale(D2, 5_000);
    // Theory 2.000 − 5.000 = −3.000 L: physically impossible stock.
    expect(await day()).toMatchObject({ pen_do: 0, gl: null, gl_raw: 12_000, gl_suspect: "teori_negatif", provisional: true });
    await receipt(D2, 8_000, 1); // canceled: still missing
    await receipt(D3, 8_000);    // business date after D2: outside (D1, D2]
    expect(await day()).toMatchObject({ pen_do: 0, gl_suspect: "teori_negatif" });
    await receipt(D2, 8_000);
    expect(await day()).toMatchObject({ pen_do: 8_000, gl: 4_000, gl_raw: 4_000, gl_suspect: null, provisional: false });
  });

  it("does not withhold negative theory at or above the heuristic −1,000 L threshold (no validity claim) and nets official tera", async () => {
    await stock(D1, "A", 1_000); await stock(D2, "A", 50);
    await sale(D2, 1_800);
    // Theory −800 L: below zero yet not flagged — the threshold is a heuristic, not a measured tolerance.
    expect(await day()).toMatchObject({ gl: 850, gl_raw: 850, gl_suspect: null });
    // Net sales = gross − official tera: 2.900 − 900 keeps theory above −1.000.
    await sale(D2, 1_100); await tera(D2, 900);
    expect(await day()).toMatchObject({ sales_gross: 2_900, tera: 900, gl: 1_050, gl_suspect: null });
    await tera(D2, 900, 1); // canceled tera does not net sales
    expect(await day()).toMatchObject({ tera: 900, gl_suspect: null });
  });

  it("zero-anchor artefact needs predecessor context and is identical for single, range and split windows", async () => {
    const before = addDays(D1, -1);
    await stock(before, "A", 10_000); await stock(D1, "A", 0, 10_000);
    await stock(D2, "A", 9_000); await stock(D3, "A", 8_000);
    await sale(D2, 1_000); await sale(D3, 1_000);
    const range = await getDailyGlByProduct(U, D1, D3);
    expect(range.map(r => [r.d, r.gl, r.gl_raw, r.gl_suspect])).toEqual([
      [D1, null, -10_000, "penutup_nol"], [D2, null, 10_000, "jangkar_nol"], [D3, 0, 0, null]]);
    expect(await getDailyGlByProduct(U, D2, D2)).toEqual(range.filter(r => r.d === D2));
    const split = [...await getDailyGlByProduct(U, D1, D1), ...await getDailyGlByProduct(U, D2, D3)];
    expect(split).toEqual(range);
    // A receipt covering the rebound cannot rehabilitate the known bad anchor.
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',9000,9000,0)", [D2, `${D2}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ pen_do: 9_000, gl: null, gl_raw: 1_000,
      gl_suspect: "jangkar_nol", provisional: true });
  });

  it("a known bad anchor on normalized tank endpoints is not rehabilitated by any receipt", async () => {
    await stock(D1, "\tA ", 10_000); await stock(D2, "A", 0, 10_000); await stock(D3, "\nA", 9_500);
    await receipt(D3, 9_500, 1); // canceled
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ pen_do: 0, gl: null, gl_raw: 9_500,
      gl_suspect: "jangkar_nol" });
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P',U&'\\00A0A\\0009',9500,9500,0)", [D3, `${D3}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ pen_do: 9_500, gl: null, gl_raw: 0,
      gl_suspect: "jangkar_nol", provisional: true });
  });

  it("receipts of any product, unit or tank cannot rehabilitate a known bad zero anchor", async () => {
    await stock(D1, "A", 5_000); await stock(D2, "A", 0, 5_000); await stock(D3, "A", 5_000);
    // Another product delivered into the same tank is not product P's receipt.
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'Q','A',5000,5000,0)", [D3, `${D3}T10:00:00+07:00`]);
    // Neither is the same product/tank in another unit.
    await db.query("INSERT INTO delivery VALUES (2,$1,$2,'P','A',5000,5000,0)", [D3, `${D3}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ ckdbbm: "P", fisik_prev: 0, fisik: 5_000,
      pen_do: 0, gl: null, gl_raw: 5_000, gl_suspect: "jangkar_nol", provisional: true });
    // The same normalized product enters Penerimaan, yet the anchor stays bad.
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,' P ','A',5000,5000,0)", [D3, `${D3}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ ckdbbm: "P", pen_do: 5_000,
      gl: null, gl_raw: 0, gl_suspect: "jangkar_nol", provisional: true });
  });

  it("tank history from another product cannot certify a zero-anchor artefact", async () => {
    await stock(D1, "A", 5_000); // product P
    await stock(D2, "A", 0, 0, { product: "Q" }); await stock(D3, "A", 5_000, 5_000, { product: "Q" });
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ ckdbbm: "Q", fisik_prev: 0, fisik: 5_000,
      gl: 5_000, gl_raw: 5_000, gl_suspect: null, provisional: false });
  });

  it.each([0, 5_000])("an intervening product remap breaks the tank chain instead of being skipped (zero's book %s)", async book => {
    const before = addDays(D1, -1);
    await stock(before, "A", 5_000); await stock(D1, "A", 5_000, 5_000, { product: "Q" });
    await stock(D2, "A", 0, book); await stock(D3, "A", 5_000);
    // D2 itself stays a product-level zero closing (rule a, independent of tank history).
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik_prev: 5_000, fisik: 0,
      gl: null, gl_suspect: "penutup_nol" });
    // The zero's own predecessor in tank A held Q: no comparable P history certifies D3.
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ fisik_prev: 0, fisik: 5_000,
      gl: 5_000, gl_raw: 5_000, gl_suspect: null });
  });

  it("a remapped tank predecessor cannot certify a multi-tank placeholder zero", async () => {
    const before = addDays(D1, -1);
    await stock(before, "A", 500); await stock(before, "B", 5_000);
    await stock(D1, "A", 5_000, 5_000, { product: "Q" });
    await stock(D2, "A", 0); await stock(D2, "B", 5_000);
    await receipt(D1, 2_000);
    // P's comparable predecessor in tank A was 500 L (near empty), not Q's 5.000 L.
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik_prev: 5_500, fisik: 5_000,
      pen_do: 2_000, gl: -2_500, gl_raw: -2_500, gl_suspect: null, provisional: true });
  });

  it.each([
    ["guard-excluded book stock", { bk: 999_999, product: "P" }],
    ["unknown product identity", { bk: 9_000, product: null }],
  ] as const)("%s in tank history cannot certify a zero-anchor artefact", async (_name, prior) => {
    await stock(D1, "A", 9_000, prior.bk, { product: prior.product });
    await stock(D2, "A", 0); await stock(D3, "A", 5_000);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ ckdbbm: "P", fisik_prev: 0, fisik: 5_000,
      gl: 5_000, gl_raw: 5_000, gl_suspect: null, excluded_tanks: 0 });
    // The existing book guard itself is unchanged: that closing stays excluded.
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik_prev: null, gl: null, gl_suspect: null });
    // The zero's own book value does not supply the missing history either.
    await db.query("UPDATE opname SET nstockbk=5000 WHERE dtaglopn=$1", [D2]);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ fisik_prev: 0, gl: 5_000, gl_suspect: null });
  });

  // ---- Anchor validity at the closing grain (synthetic tanks/quantities only) ----
  // A zero closing invalidates the NEXT balance exactly when that comparable prior
  // closing is itself classified penutup_nol, from its own prior measured stock
  // and its own movements on coherent tank history. Book stock only keeps its
  // existing guard role; receipts on the dependent day never rehabilitate it.

  it("a same-product receipt without a tank keeps the measured G/L after a sold-empty tank", async () => {
    await stock(D1, "A", 5_000); await stock(D2, "A", 0); await sale(D2, 5_000); await stock(D3, "A", 5_000);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P',NULL,5000,5000,0)", [D3, `${D3}T10:00:00+07:00`]);
    // D2 is a coherent measured empty closing: its sales explain the zero.
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik: 0, gl: 0, gl_raw: 0, gl_suspect: null });
    const [current] = await getDailyGlByProduct(U, D3, D3);
    expect(current).toMatchObject({ fisik_prev: 0, fisik: 5_000, pen_do: 5_000, gl: 0, gl_raw: 0,
      gl_suspect: null, provisional: false });
    expect((await getDailyGlByProduct(U, D1, D3)).filter(r => r.d === D3)).toEqual([current]);
  });

  it.each([
    { surplus: 50, book: 0, sold: 0 }, { surplus: 1_500, book: 0, sold: 0 },
    { surplus: 50, book: 0, sold: 1_000 }, { surplus: 1_500, book: 3_000, sold: 1_000 },
  ])("a sold-empty tank keeps the next-day nominal-DO surplus +$surplus L (zero's book $book ignored, sold $sold)", async ({ surplus, book, sold }) => {
    const teraL = sold ? 100 : 0;
    await stock(D1, "A", 5_000); await stock(D2, "A", 0, book); await sale(D2, 5_000);
    await stock(D3, "A", 5_000 - (sold - teraL) + surplus);
    if (sold) { await sale(D3, sold); await tera(D3, teraL); }
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',5000,$3,0)", [D3, `${D3}T10:00:00+07:00`, 5_000 + surplus]);
    // The prior balance is coherent: a legitimately empty physical closing.
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik: 0, gl: 0, gl_suspect: null });
    const [current] = await getDailyGlByProduct(U, D3, D3);
    // Nominal NVOLDO, gross sales and official tera keep their existing semantics.
    expect(current).toMatchObject({ fisik_prev: 0, pen_do: 5_000, sales_gross: sold, tera: teraL,
      gl: surplus, gl_raw: surplus, gl_suspect: null, provisional: false });
    expect((await getDailyGlByProduct(U, D1, D3)).filter(r => r.d === D3)).toEqual([current]);
  });

  it.each(["2026-10-02", "2026-09-30", "2025-12-31"])(
    "a prior zero classified penutup_nol stays a bad anchor though today's receipt covers the rebound (zero %s)", async zero => {
      const before = addDays(zero, -1), after = addDays(zero, 1), recover = addDays(zero, 2);
      await stock(before, "A", 10_000); await stock(zero, "A", 0, 10_000);
      await stock(after, "A", 8_000); await stock(recover, "A", 7_500);
      await sale(after, 1_000); await sale(recover, 500);
      await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',9000,9000,0)", [after, `${after}T10:00:00+07:00`]);
      const range = await getDailyGlByProduct(U, before, recover);
      expect(range.map(r => [r.d, r.gl, r.gl_raw, r.gl_suspect, r.provisional])).toEqual([
        [before, null, null, null, true], [zero, null, -10_000, "penutup_nol", true],
        [after, null, 0, "jangkar_nol", true], [recover, 0, 0, null, false]]);
      expect(range[2]).toMatchObject({ fisik_prev: 0, fisik: 8_000, pen_do: 9_000, sales_gross: 1_000, tera: 0 });
      for (const row of range) expect(await getDailyGlByProduct(U, row.d, row.d)).toEqual([row]);
      // Split exactly at the dependent day (a month/year boundary for the later cases).
      expect([...await getDailyGlByProduct(U, before, zero), ...await getDailyGlByProduct(U, after, recover)]).toEqual(range);
    },
  );

  it("a bad anchor carries across a closing gap and the next valid physical closing restores the balance", async () => {
    const d4 = addDays(D3, 1), d5 = addDays(D3, 2);
    await stock(D1, "A", 10_000); await stock(D2, "A", 0, 10_000);
    await stock(d4, "A", 9_000); await stock(d5, "A", 8_500);
    await sale(D3, 400); await sale(d4, 600); await sale(d5, 500);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',10000,10000,0)", [d4, `${d4}T10:00:00+07:00`]);
    const range = await getDailyGlByProduct(U, D1, d5);
    expect(range.map(r => [r.d, r.gl, r.gl_raw, r.gl_suspect, r.provisional])).toEqual([
      [D1, null, null, null, true], [D2, null, -10_000, "penutup_nol", true],
      [d4, null, 0, "jangkar_nol", true], [d5, 0, 0, null, false]]);
    expect(range[2]).toMatchObject({ fisik_prev: 0, pen_do: 10_000, sales_gross: 1_000 });
    expect(await getDailyGlByProduct(U, d4, d4)).toEqual([range[2]]);
    expect([...await getDailyGlByProduct(U, D1, D3), ...await getDailyGlByProduct(U, d4, d5)]).toEqual(range);
  });

  it("a placeholder zero tank in a multi-tank prior closing invalidates the next balance whatever its book", async () => {
    await stock(D1, "A", 6_000); await stock(D1, "B", 4_000);
    await stock(D2, "A", 0, 5_500); await stock(D2, "B", 3_800); await sale(D2, 700);
    await stock(D3, "A", 5_000); await stock(D3, "B", 3_500); await sale(D3, 300);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',5000,5000,0)", [D3, `${D3}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ gl: null, gl_raw: -5_500, gl_suspect: "penutup_nol" });
    const [bad] = await getDailyGlByProduct(U, D3, D3);
    expect(bad).toMatchObject({ fisik_prev: 3_800, fisik: 8_500, pen_do: 5_000, gl: null, gl_raw: 0,
      gl_suspect: "jangkar_nol", provisional: true });
    expect((await getDailyGlByProduct(U, D1, D3)).filter(r => r.d === D3)).toEqual([bad]);
    await db.query("UPDATE opname SET nstockbk=0 WHERE dtaglopn=$1 AND ckdtangki='A'", [D2]);
    // A zero book does not rehabilitate it: 5.000 L prior + shortfall still qualify penutup_nol.
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ gl: null, gl_raw: -5_500, gl_suspect: "penutup_nol" });
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toEqual(bad);
  });

  it.each([10_000, 0])("a placeholder zero (book %s) stays a bad anchor though today's DO and sales balance exactly", async book => {
    await stock(D1, "A", 10_000); await stock(D2, "A", 0, book);
    await stock(D3, "A", 8_000); await sale(D3, 1_000);
    await db.query("INSERT INTO delivery VALUES (1,$1,$2,'P','A',9000,9000,0)", [D3, `${D3}T10:00:00+07:00`]);
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik_prev: 10_000, fisik: 0,
      gl: null, gl_raw: -10_000, gl_suspect: "penutup_nol" });
    const [current] = await getDailyGlByProduct(U, D3, D3);
    expect(current).toMatchObject({ fisik_prev: 0, fisik: 8_000, pen_do: 9_000, sales_gross: 1_000,
      gl: null, gl_raw: 0, gl_suspect: "jangkar_nol", provisional: true });
    expect((await getDailyGlByProduct(U, D1, D3)).filter(r => r.d === D3)).toEqual([current]);
  });

  it("a negative-theory verdict alone does not invalidate its physical closing as the next anchor", async () => {
    await stock(D1, "A", 2_000); await stock(D2, "A", 0); await sale(D2, 5_000);
    await stock(D3, "A", 5_100); await receipt(D3, 5_000);
    expect((await getDailyGlByProduct(U, D2, D2))[0]).toMatchObject({ fisik: 0, gl: null,
      gl_raw: 3_000, gl_suspect: "teori_negatif" });
    const [current] = await getDailyGlByProduct(U, D3, D3);
    expect(current).toMatchObject({ fisik_prev: 0, pen_do: 5_000, gl: 100, gl_raw: 100,
      gl_suspect: null, provisional: false });
    expect((await getDailyGlByProduct(U, D1, D3)).filter(r => r.d === D3)).toEqual([current]);
  });

  it("a sold-empty tank refilled with a recorded surplus above 1.000 L stays measured despite the legacy warning", async () => {
    await stock(D1, "A", 5_000); await stock(D2, "A", 0); await sale(D2, 5_000);
    await stock(D3, "A", 6_500); await receipt(D3, 5_000);
    // The legacy warning detector still lists the zero (its own heuristic, unchanged).
    expect(await getZeroClosingEvents([U], D1, D3)).toEqual([expect.objectContaining({ d: D2, ckdtangki: "A" })]);
    expect((await getDailyGlByProduct(U, D3, D3))[0]).toMatchObject({ fisik_prev: 0, pen_do: 5_000,
      gl: 1_500, gl_raw: 1_500, gl_suspect: null, provisional: false });
  });

  it.each([365, 366])("the bad-anchor dependency stays inside the dependent day's horizon (prior anchor %s days back)", async age => {
    const anchor = addDays(D2, -age);
    await stock(anchor, "A", 10_000); await stock(D1, "A", 0, 10_000); await stock(D2, "A", 9_000);
    const single = await getDailyGlByProduct(U, D2, D2);
    expect(single[0]).toMatchObject({ fisik_prev: 0, fisik: 9_000, gl_raw: 9_000,
      gl_suspect: age <= 365 ? "jangkar_nol" : null });
    const range = await getDailyGlByProduct(U, anchor, D2);
    expect(range.filter(r => r.d === D2)).toEqual(single);
    // The zero itself is classified whenever its own anchor is in the query.
    expect(range.find(r => r.d === D1)).toMatchObject({ gl: null, gl_suspect: "penutup_nol" });
  });

  it("a canceled zero session cannot become the closing or an artefact", async () => {
    await baseline();
    await stock(D2, "A", 0, 9_000, { canceled: 1, timestamp: `${D3}T07:30:00+07:00` });
    expect(await day()).toMatchObject({ fisik: 19_000, gl: 0, gl_suspect: null, provisional: false });
  });

  it("unknown stock, tank-set change and invalid movement stay unknown, not artefacts", async () => {
    await baseline();
    await db.query("UPDATE opname SET nstockop=NULL WHERE dtaglopn=$1 AND ckdtangki='B'", [D2]);
    expect(await day()).toMatchObject({ gl: null, gl_raw: null, gl_suspect: null, excluded_tanks: 1 });
    await db.exec("TRUNCATE opname, sales_header, sales_detail");
    await stock(D1, "A", 10_000); await stock(D2, "A", 0); await stock(D2, "B", 0);
    expect(await day()).toMatchObject({ gl: null, gl_raw: null, gl_suspect: null, provisional: true });
    await db.exec("TRUNCATE opname");
    await stock(D1, "A", 10_000); await stock(D2, "A", 0); await receipt(D2, null);
    expect(await day()).toMatchObject({ movement_invalid: true, gl: null, gl_raw: null, gl_suspect: null });
  });

  it("SQL artefact feeds Laporan, Arus and Harian as unavailable while keeping raw audit values", async () => {
    await db.exec("INSERT INTO product VALUES (1,'P','SOLAR'),(1,'Q','PERTALITE')");
    await stock(D1, "A", 6_000); await stock(D2, "A", 0, 5_000);
    await stock(D1, "C", 3_000, 3_000, { product: "Q" }); await stock(D2, "C", 2_900, 2_900, { product: "Q" });
    await sale(D2, 1_000, "P"); await sale(D2, 100, "Q");
    await db.exec("UPDATE sales_detail SET nsubtotal=nvolume*10000, nhargajual=10000");
    const glRows = await getDailyGlByProduct(U, D1, D2);
    const prodDay = await getSalesByProduct(U, D2, D2);
    const raw: LaporanRaw = {
      prodDay, prodMonth: prodDay, glRows, zeroClosing: [], delivMonth: [], doDay: [], doAnomalies: [], doSuspects: [],
      shift: { shifts: 3, last_dtgljam: null }, hargaDeviasi: [], corrections: 0, cash: [],
      saldo: { awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
        akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 } },
      recapPelanggan: [], recapEdc: [], recapDeposit: [], recapPendapatanLain: [], recapPengeluaran: [],
      recapSetoran: [], terra: [], tetanggaSebelum: { f: [], g: [], i: [] }, tetanggaSesudah: { f: [], g: [], i: [] },
    };
    const model = buildLaporanModel(raw, { unitCode: "SYNTHETIC", date: D2, today: D3,
      mi: { month: 10, year: 2026, dayOfMonth: 2, daysInMonth: 31 }, detail: true });
    expect(model.sales.rows.find(r => r.ckdbbm === "P")!.gl).toBeNull();
    expect(model.sales.rows.find(r => r.ckdbbm === "Q")!.gl).toBe(0);
    expect(model.sales.glTotal).toBeNull(); expect(model.glMonthly.glMonthTotal).toBeNull();
    expect(model.arusMinyak.rows.find(r => r.ckdbbm === "P")).toMatchObject({
      awal: 6_000, teori: 5_000, fisik: 0, losses: null, pct: null, artefak: "penutup_nol", glMentah: -5_000 });
    expect(model.arusMinyak.total.losses).toBeNull();
    const harian = buildHarianModel({
      units: [{ unit_id: U, code: "SYNTHETIC", name: "Synthetic unit" }], date: D2,
      dailySales: await getDailySalesByProduct([U], D1, D2), gl: new Map([[1, glRows]]),
      coverage: [{ unit_id: 1, sales_min: D1 }], sync: [{ unit_id: 1, last_run: `${D3}T01:00:00Z` }],
    });
    expect(harian.glDaily.totalsByUnit[1]).toBeNull();
    expect(harian.glDaily.grandTotal).toBeNull();
    expect(harian.glSuspectUnits.map(u => u.unitId)).toEqual([1]);
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

  it("keeps unidentified movements before the first requested closing and with no requested closings", async () => {
    await stock("2026-09-01", "A", 10_000);
    await unassignedMovement("receipt", null, D1);
    await unassignedMovement("sale", "\u00a0", D2);
    await unassignedMovement("tera", "\ufeff", D3);
    const withoutClosing = await getDailyGlByProduct(U, D1, D3);
    expect(withoutClosing).toEqual([
      expect.objectContaining({ d: D1, ckdbbm: null, pen_do: 100, gl: null, provisional: true }),
      expect.objectContaining({ d: D2, ckdbbm: null, sales_gross: 100, gl: null, provisional: true }),
      expect.objectContaining({ d: D3, ckdbbm: null, tera: 100, gl: null, provisional: true }),
    ]);
    await stock(D3, "A", 10_000);
    const withClosing = await getDailyGlByProduct(U, D1, D3);
    expect(withClosing.filter(r => r.ckdbbm === null)).toEqual(withoutClosing);
    expect(withClosing.find(r => r.ckdbbm === "P")).toMatchObject({
      d: D3, fisik_prev: 10_000, pen_do: 0, sales_gross: 0, tera: 0, gl: null, provisional: true,
    });
  });

  it.each([30, 365])("retains all movement domains after an anchor %s days before the requested day", async age => {
    const anchor = new Date(Date.parse(`${D2}T00:00:00Z`) - age * 86_400_000).toISOString().slice(0, 10);
    const movementDate = nextDay(anchor);
    await stock(anchor, "A", 10_000); await stock(D2, "A", 10_025);
    await receipt(movementDate, 8_000); await sale(movementDate, 7_000); await tera(movementDate, 25);
    await sale(D2, 1_000);
    // The anchor date itself is outside (previous, D], even for invalid rows.
    await receipt(anchor, null); await sale(anchor, null); await tera(anchor, null);
    const beforeAnchor = new Date(Date.parse(`${anchor}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    for (const domain of ["receipt", "sale", "tera"] as const) {
      await unassignedMovement(domain, null, beforeAnchor);
      await unassignedMovement(domain, null, anchor);
    }
    const current = await day();
    expect(current).toMatchObject({ fisik_prev: 10_000, pen_do: 8_000,
      sales_gross: 8_000, tera: 25, gl: 0, provisional: true });
    const range = await getDailyGlByProduct(U, D1, D3);
    expect(range.filter(r => r.d === D2)).toEqual([current]);
  });

  it.each(["receipt", "sale", "tera"] as const)("retains unidentified %s invalidity before from across a long closing gap", async domain => {
    await stock("2026-09-01", "A", 10_000); await stock(D2, "A", 9_000);
    await sale("2026-09-15", 1_000);
    await unassignedMovement(domain, null, "2026-09-20");
    const current = await day();
    expect(current).toMatchObject({ fisik_prev: 10_000, sales_gross: 1_000,
      pen_do: 0, tera: 0, gl: null, provisional: true });
    // No invented diagnostic date: the unknown movement is outside the output.
    expect(await getDailyGlByProduct(U, D1, D3)).toEqual([current]);
  });

  it("aggregates only required daily movements despite a full year of closing history", async () => {
    // Deterministic execution-work guard, not a machine-dependent timing limit.
    // Six products, 370 days. The 365-day stock anchor still runs, while a DAY
    // request needs only six daily groups per movement domain, not 366 * 6.
    await db.exec(`
      INSERT INTO opname
      SELECT 1, 'O'||g||'_'||p, 'T'||p, 'P'||p, DATE '${D2}'-369+g,
             (DATE '${D2}'-368+g + TIME '06:00') AT TIME ZONE 'Asia/Pontianak',
             10000, 10000, 0
      FROM generate_series(0,369) g CROSS JOIN generate_series(1,6) p;
      INSERT INTO sales_header SELECT 1, 'H'||g, DATE '${D2}'-369+g FROM generate_series(0,369) g;
      INSERT INTO sales_detail (unit_id,ckdjualbbm,ckdbbm,nvolume)
      SELECT 1, 'H'||g, 'P'||p, 3000 FROM generate_series(0,369) g CROSS JOIN generate_series(1,6) p;
      INSERT INTO delivery (unit_id,dtgltrm,ckdbbm,nvoldo,sbatal)
      SELECT 1, DATE '${D2}'-369+g, 'P'||p, 2000, 0 FROM generate_series(0,369) g CROSS JOIN generate_series(1,6) p;
      INSERT INTO terra_resmi
      SELECT 1, DATE '${D2}'-369+g, 'P'||p, 1000, 0 FROM generate_series(0,369) g CROSS JOIN generate_series(1,6) p;
      ANALYZE opname; ANALYZE sales_header; ANALYZE sales_detail; ANALYZE delivery; ANALYZE terra_resmi;
    `);
    const rows = await getDailyGlByProduct(U, D2, D2);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toMatchObject({ pen_do: 2000, sales_gross: 3000,
      tera: 1000, fisik: 10000, fisik_prev: 10000, gl: 0, provisional: false });
    type PlanNode = { "Subplan Name"?: string; "Actual Rows"?: number; "Actual Loops"?: number; Plans?: PlanNode[] };
    const expectMovementGroups = async (groups: number) => {
      const [, sql, params] = qScoped.mock.calls.at(-1)!;
      const result = await db.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) ${sql}`, params,
      );
      const nodes: PlanNode[] = [];
      const visit = (node: PlanNode) => { nodes.push(node); node.Plans?.forEach(visit); };
      visit(result.rows[0]!["QUERY PLAN"][0]!.Plan);
      for (const domain of ["deliv", "sale", "terad"]) {
        const aggregate = nodes.find(n => n["Subplan Name"] === `CTE ${domain}`);
        expect(aggregate, `${domain} must be assessed once`).toBeDefined();
        expect(aggregate?.["Actual Loops"]).toBe(1);
        expect(aggregate?.["Actual Rows"]).toBe(groups);
      }
    };
    await expectMovementGroups(6);
    // A placeholder zero in the directly preceding closing adds only that
    // closing's own window (one more day of six products), never the year.
    await db.exec(`UPDATE opname SET nstockop=0 WHERE ckdbbm='P1' AND dtaglopn=DATE '${D2}'-1`);
    const withDependency = await getDailyGlByProduct(U, D2, D2);
    expect(withDependency.find(r => r.ckdbbm === "P1")).toMatchObject({ fisik_prev: 0, fisik: 10000,
      gl: null, gl_raw: 10000, gl_suspect: "jangkar_nol" });
    expect(withDependency.filter(r => r.ckdbbm !== "P1").map(r => r.gl)).toEqual([0, 0, 0, 0, 0]);
    await expectMovementGroups(12);
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

  it("old-schema revisions cover every domain, even a late older transaction", async () => {
    expect(await getGlSourceRevision(U)).toBe("[]");
    const domains = ["sales", "opname", "delivery", "terra_resmi", "masters", "cash", "future|domain:with\"punctuation"];
    for (const domain of domains)
      await db.query("INSERT INTO sync_state VALUES (1,$1,$2)", [domain, `${D2}T10:00:00.123456Z`]);
    let previous = await getGlSourceRevision(U);
    expect(JSON.parse(previous)).toEqual([...domains].sort().map(domain => [domain, "legacy", `${D2}T10:00:00.123456Z`]));
    for (const domain of domains) {
      await db.query("UPDATE sync_state SET last_run_at=$1 WHERE unit_id=1 AND domain=$2", [`${D2}T09:00:00.123457Z`, domain]);
      const revision = await getGlSourceRevision(U);
      expect(revision).not.toBe(previous); previous = revision;
    }
    await db.query("INSERT INTO sync_state VALUES (2,'opname',$1),(2,'cash',$1)", [`${D3}T12:00:00Z`]);
    expect(await getGlSourceRevision(U)).toBe(previous);
  });

  it("old-schema null timestamps have stable explicit legacy entries", async () => {
    await db.exec("INSERT INTO sync_state VALUES (1,'cash',NULL),(1,'sales',NULL)");
    expect(JSON.parse(await getGlSourceRevision(U))).toEqual([
      ["cash", "legacy", "never"], ["sales", "legacy", "never"],
    ]);
  });

  describe("content revision columns after migration", () => {
    beforeAll(async () => {
      await db.exec("ALTER TABLE sync_state ADD COLUMN gl_revision bigint, ADD COLUMN gl_revision_run_at timestamptz");
    });
    afterAll(async () => {
      await db.exec("ALTER TABLE sync_state DROP COLUMN gl_revision, DROP COLUMN gl_revision_run_at");
    });

    it("returns an empty vector without source data after migration", async () => {
      expect(await getGlSourceRevision(U)).toBe("[]");
    });

    it("keeps bigint revisions exact beyond JavaScript safe integers", async () => {
      await db.query("INSERT INTO sync_state VALUES (1,'sales',$1,9007199254740992,$1)", [`${D2}T10:00:00.123456Z`]);
      let previous = await getGlSourceRevision(U);
      expect(JSON.parse(previous)).toEqual([["sales", "content", "9007199254740992"]]);
      for (const counter of ["9007199254740993", "9223372036854775807"]) {
        await db.query("UPDATE sync_state SET gl_revision=$1", [counter]);
        const revision = await getGlSourceRevision(U);
        expect(JSON.parse(revision)).toEqual([["sales", "content", counter]]);
        expect(revision).not.toBe(previous); previous = revision;
      }
    });

    it("changes for a content revision in every domain, including arbitrary domains", async () => {
      const domains = ["sales", "cash", "opname", "delivery", "masters", "realtank", "deposit",
        "edc", "pelanggan", "tebus", "tera", "terra_resmi", "piutang", "hutang", "future|domain:with\"punctuation"];
      for (const domain of domains)
        await db.query("INSERT INTO sync_state VALUES (1,$1,$2,0,$2)", [domain, `${D2}T10:00:00.123456Z`]);
      let previous = await getGlSourceRevision(U);
      expect(JSON.parse(previous)).toEqual([...domains].sort().map(domain => [domain, "content", "0"]));
      for (const domain of domains) {
        await db.query("UPDATE sync_state SET gl_revision=gl_revision+1, last_run_at=$1, gl_revision_run_at=$1 WHERE unit_id=1 AND domain=$2",
          [`${D2}T09:00:00.123457Z`, domain]);
        const revision = await getGlSourceRevision(U);
        expect(revision, domain).not.toBe(previous); previous = revision;
      }
      await db.query("INSERT INTO sync_state VALUES (2,'opname',$1,999,$1),(2,'cash',$1,999,$1)", [`${D3}T12:00:00Z`]);
      expect(await getGlSourceRevision(U)).toBe(previous);
    });

    it("keeps a mixed ordered vector stable through no-op runs and inactive legacy domains", async () => {
      await db.query(`INSERT INTO sync_state VALUES
        (1,'terra_resmi',$1,7,$1), (1,'sales',$1,0,$1), (1,'opname',$1,2,$1),
        (1,'masters',$1,3,$1), (1,'delivery',$1,4,$1), (1,'cash',$2,NULL,NULL),
        (1,'future|domain:with"punctuation',NULL,NULL,NULL)`, [`${D2}T10:00:00.123456Z`, `${D1}T17:00:00.654321+07:00`]);
      const previous = await getGlSourceRevision(U);
      expect(JSON.parse(previous)).toEqual([
        ["cash", "legacy", `${D1}T10:00:00.654321Z`],
        ["delivery", "content", "4"], ["future|domain:with\"punctuation", "legacy", "never"],
        ["masters", "content", "3"], ["opname", "content", "2"],
        ["sales", "content", "0"], ["terra_resmi", "content", "7"],
      ]);
      for (const timestamp of [`${D2}T10:00:00.123457Z`, `${D3}T19:00:00.123456+07:00`]) {
        await db.query("UPDATE sync_state SET last_run_at=$1, gl_revision_run_at=$1 WHERE gl_revision IS NOT NULL", [timestamp]);
        expect(await getGlSourceRevision(U)).toBe(previous);
      }
    });

    it.each([
      { counter: null, lastRun: `${D2}T10:00:00.123456Z`, marker: `${D2}T10:00:00.123456Z` },
      { counter: "-1", lastRun: `${D2}T10:00:00.123456Z`, marker: `${D2}T10:00:00.123456Z` },
      { counter: "0", lastRun: `${D2}T10:00:00.123456Z`, marker: null },
      { counter: "5", lastRun: `${D2}T10:00:00.123456Z`, marker: `${D2}T10:00:00.123457Z` },
      { counter: "7", lastRun: null, marker: `${D2}T10:00:00.123456Z` },
      { counter: "0", lastRun: null, marker: null },
      { counter: null, lastRun: null, marker: null },
    ])("falls back to legacy when the content counter/run is untrusted (%#)", async ({ counter, lastRun, marker }) => {
      await db.query("INSERT INTO sync_state VALUES (1,'sales',$1,$2,$3)", [lastRun, counter, marker]);
      expect(JSON.parse(await getGlSourceRevision(U))).toEqual([["sales", "legacy", lastRun ?? "never"]]);
    });

    it("detects an old writer by marker mismatch and keeps invalidating on its later runs", async () => {
      await db.query("INSERT INTO sync_state VALUES (1,'sales',$1,6,$1)", [`${D2}T10:00:00.123456Z`]);
      const contentRevision = await getGlSourceRevision(U);
      let previous = contentRevision;
      for (const timestamp of [`${D2}T10:00:00.123457Z`, `${D2}T10:00:00.123458Z`]) {
        await db.query("UPDATE sync_state SET last_run_at=$1", [timestamp]);
        const revision = await getGlSourceRevision(U);
        expect(JSON.parse(revision)).toEqual([["sales", "legacy", timestamp]]);
        expect(revision).not.toBe(previous); previous = revision;
      }
      await db.exec("UPDATE sync_state SET gl_revision=7, gl_revision_run_at=last_run_at");
      const restored = await getGlSourceRevision(U);
      expect(JSON.parse(restored)).toEqual([["sales", "content", "7"]]);
      expect(restored).not.toBe(previous);
      expect(restored).not.toBe(contentRevision);
    });

    it("compares run markers as timestamps across timezone offsets", async () => {
      await db.query("INSERT INTO sync_state VALUES (1,'sales',$1,0,$2)",
        [`${D2}T10:00:00.123456Z`, `${D2}T17:00:00.123456+07:00`]);
      expect(JSON.parse(await getGlSourceRevision(U))).toEqual([["sales", "content", "0"]]);
    });
  });
});
