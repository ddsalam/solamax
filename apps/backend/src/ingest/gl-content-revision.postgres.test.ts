import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IngestPayload } from "@solamax/shared";
import { IngestService } from "./ingest.service.js";
import { createIngestServiceSqlAdapter, type IngestSqlHooks } from "./gl-content-revision.test-support.js";
import { buildReplaceWindowDeletes, buildUpsert } from "./sql.js";
import { TABLE_CONFIG } from "./table-config.js";

/**
 * Executes the real IngestService and its generated SQL, not a copied ingest
 * implementation. The adapter only supplies transactions and real affected-row
 * counts. No DATABASE_URL, local credentials, source data, or public tables.
 *
 * Optional serial runner (PGlite 0.5.8 embeds PostgreSQL 18, not production 16):
 * GL_SQL_TEST_PGLITE=/tmp/solamax-gl-sql-tests/node_modules/@electric-sql/pglite \
 *   pnpm --filter @solamax/backend exec vitest run src/ingest/gl-content-revision.postgres.test.ts
 * Native CI requires both dedicated opt-in variables below. Its committed,
 * uniquely owned schema permits genuine separate-connection concurrency tests;
 * teardown verifies removal. PGlite explicitly skips these concurrency cases.
 */
const enginePath = process.env.GL_SQL_TEST_PGLITE;
const postgresOptIn = process.env.GL_SQL_TEST_POSTGRES16;
const postgresUrl = process.env.GL_SQL_TEST_POSTGRES16_URL;
const postgresRequested = postgresOptIn !== undefined || postgresUrl !== undefined;
const CI_DATABASE = "solamax_snapshot_ci";
const CI_USER = "snapshot_ci_admin";
const SCHEMA_PREFIX = "gl_ingest_";
const TABLES = ["sales_header", "sales_detail", "opname", "delivery", "terra_resmi", "product", "cash_header", "sync_state"];
const U = 1;
const D1 = "2026-10-01";
const D2 = "2026-10-02";
const D3 = "2026-10-03";
const WATERMARK = `${D3}T12:00:00Z`;

type Row = Record<string, unknown>;
interface QueryResult<T> { rows: T[]; rowCount?: number | null; affectedRows?: number }
interface Connection {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<unknown>;
}
interface Fixture extends Connection {
  transaction<T>(body: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface NativeClient {
  connect(): Promise<void>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): void;
}

function postgresFixtureTarget(optIn: string | undefined, raw: string | undefined) {
  if (optIn !== "1" || !raw) throw new Error("PostgreSQL fixture mode requires explicit opt-in and dedicated test URL");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid PostgreSQL fixture URL"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== `/${CI_DATABASE}` || url.username !== CI_USER
    || url.password !== "snapshot_ci_only" || url.search || url.hash
    || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535) {
    throw new Error("PostgreSQL fixtures require the fixed disposable loopback database/account");
  }
  return { host: "127.0.0.1", port: Number(url.port), database: CI_DATABASE,
    user: CI_USER, password: "snapshot_ci_only" };
}

function assertIdentity(row: { database: string; role: string; version: string } | undefined) {
  if (!row || row.database !== CI_DATABASE || row.role !== CI_USER || !/^16\d{4}$/.test(row.version)) {
    throw new Error("PostgreSQL fixtures require the disposable test database/account on PostgreSQL 16");
  }
}

function assertOwnedSchema(schema: string) {
  if (!/^gl_ingest_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid fixture schema ownership token");
}

async function assertLocation(connection: Connection, schema: string) {
  const { rows } = await connection.query<{ schema: string; path: string }>(
    "SELECT current_schema() AS schema, current_setting('search_path') AS path",
  );
  if (rows[0]?.schema !== schema || rows[0]?.path !== `${schema}, pg_catalog`) {
    throw new Error("Fixture search_path must contain only its owned schema and pg_catalog");
  }
}

async function createFixture(): Promise<Fixture> {
  if (postgresRequested && enginePath) throw new Error("Choose exactly one SQL fixture engine; no fallback from native PostgreSQL");
  const schema = `${SCHEMA_PREFIX}${randomUUID().replaceAll("-", "")}`;
  assertOwnedSchema(schema);
  if (!postgresRequested) {
    const { PGlite } = createRequire(import.meta.url)(enginePath!) as {
      PGlite: new () => Connection & { close(): Promise<void> };
    };
    const db = new PGlite();
    try {
      await db.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", pg_catalog`);
      await assertLocation(db, schema);
    } catch (error) { await db.close(); throw error; }
    return {
      query: (sql, params) => db.query(sql, params), exec: sql => db.exec(sql),
      transaction: async body => {
        await db.exec("BEGIN");
        try { const result = await body(db); await db.exec("COMMIT"); return result; }
        catch (error) { await db.exec("ROLLBACK"); throw error; }
      },
      close: async () => {
        try {
          // Failed migration DDL may have left an explicit transaction aborted.
          await db.exec("ROLLBACK");
          await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
          const result = await db.query<{ clean: boolean }>(
            "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS clean", [schema],
          );
          if (!result.rows[0]?.clean) throw new Error("PGlite fixture cleanup failed");
        } finally { await db.close(); }
      },
    };
  }

  const target = postgresFixtureTarget(postgresOptIn, postgresUrl);
  // pg is already a dashboard dependency; do not add a backend package or load
  // the dashboard's DB module (which would read its configured credentials).
  const { Client } = createRequire(new URL("../../../dashboard/package.json", import.meta.url))("pg") as {
    Client: new (options: Row) => NativeClient;
  };
  const activeClients = new Set<NativeClient>();
  const connect = async () => {
    const client = new Client({ ...target, ssl: false, connectionTimeoutMillis: 5_000,
      query_timeout: 15_000, application_name: "solamax_gl_ingest_fixture_ci",
      options: "-c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=5000" });
    client.on("error", () => { /* Active operations surface the connection failure. */ });
    try {
      await client.connect();
      // Actual identity/version must be checked before any write on EVERY
      // connection. A literal-loopback tunnel is insufficient evidence alone.
      const identity = await client.query<{ database: string; role: string; version: string }>(
        "SELECT current_database() AS database, current_user AS role, current_setting('server_version_num') AS version",
      );
      assertIdentity(identity.rows[0]);
      return client;
    } catch (error) { await client.end(); throw error; }
  };
  const admin = await connect();
  const adminConnection: Connection = { query: (sql, params) => admin.query(sql, params), exec: sql => admin.query(sql) };
  let owned = false;
  const cleanup = async () => {
    // Closing the admin also rolls back a failed migration's explicit BEGIN.
    // Do not reuse it for DROP: it may be aborted or already disconnected.
    await Promise.allSettled([...activeClients, admin].map(client => client.end()));
    activeClients.clear();
    if (!owned) return;
    const cleaner = await connect();
    try {
      assertOwnedSchema(schema);
      await cleaner.query(`SET search_path TO "${schema}", pg_catalog`);
      // Only the schema created by this exact fixture instance may be dropped.
      const owner = await cleaner.query<{ owned: boolean }>(
        "SELECT nspowner=current_user::regrole AS owned FROM pg_catalog.pg_namespace WHERE nspname=$1", [schema],
      );
      if (owner.rows[0]?.owned !== true) throw new Error("Fixture schema owner changed; refusing cleanup");
      await cleaner.query(`DROP SCHEMA "${schema}" CASCADE`);
      const result = await cleaner.query<{ clean: boolean }>(
        "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS clean", [schema],
      );
      if (!result.rows[0]?.clean) throw new Error("PostgreSQL fixture cleanup verification failed");
    } finally { await cleaner.end(); }
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    owned = true;
    await admin.query(`SET search_path TO "${schema}", pg_catalog`);
    await assertLocation(adminConnection, schema);
    return {
      ...adminConnection,
      transaction: async body => {
        const client = await connect();
        activeClients.add(client);
        const connection: Connection = { query: (sql, params) => client.query(sql, params), exec: sql => client.query(sql) };
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
          await assertLocation(connection, schema);
          const result = await body(connection);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          try { await client.query("ROLLBACK"); } catch { /* A closed connection has already rolled back. */ }
          throw error;
        } finally {
          try { await client.end(); } finally { activeClients.delete(client); }
        }
      },
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}

const migration = (name: string) => readFileSync(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
async function installSchema(db: Fixture) {
  // Actual migration DDL, no LIKE INCLUDING DEFAULTS or shared sequences/FKs.
  // public qualification is remapped ONLY in this fixture; grants are omitted.
  const { rows } = await db.query<{ schema: string }>("SELECT current_schema() AS schema");
  const schema = rows[0]!.schema;
  assertOwnedSchema(schema);
  const remap = (sql: string) => sql.replaceAll('"public".', `"${schema}".`);
  await db.exec(migration("0001_init"));
  const deliveryColumn = migration("0010_cnoso").match(/ALTER TABLE "public"\."delivery"[^;]+;/)?.[0];
  if (!deliveryColumn) throw new Error("Expected delivery migration statement is missing");
  await db.exec(remap(deliveryColumn));
  await db.exec(remap(migration("0014_terra_resmi").split("-- Grant SELECT")[0]!));
  // Seed old-writer metadata/source before the actual additive migration. Its
  // own BEGIN/COMMIT must run outside an enclosing fixture transaction.
  await db.query(`INSERT INTO sync_state VALUES (1,'delivery',$1,$2,1)`,
    [`${D3}T12:00:00Z`, `${D2}T12:00:00Z`]);
  await db.query(`INSERT INTO delivery (unit_id,ckdtrm,dtgltrm,dtgljam,nvoldo)
    VALUES (1,'MIGRATION',$1,$2,10)`, [D2, `${D2}T08:00:00Z`]);
  const before = await db.query<{ health: Row; source: Row }>(
    "SELECT to_jsonb(s) AS health, to_jsonb(d) AS source FROM sync_state s CROSS JOIN delivery d",
  );
  await db.exec(remap(migration("0048_gl_content_revision")));
  const after = await db.query<{ health: Row; source: Row; revision: unknown; marker: unknown }>(
    `SELECT to_jsonb(s)-'gl_revision'-'gl_revision_run_at' AS health,
      to_jsonb(d) AS source, s.gl_revision AS revision, s.gl_revision_run_at AS marker
      FROM sync_state s CROSS JOIN delivery d`,
  );
  expect(after.rows).toEqual(before.rows.map(row => ({ ...row, revision: null, marker: null })));
  const columns = await db.query<{ name: string; nullable: string; default_value: unknown; type: string }>(
    `SELECT column_name AS name, is_nullable AS nullable, column_default AS default_value, data_type AS type
      FROM information_schema.columns WHERE table_schema=$1 AND table_name='sync_state'
      AND column_name IN ('gl_revision','gl_revision_run_at') ORDER BY column_name`, [schema],
  );
  expect(columns.rows).toEqual([
    { name: "gl_revision", nullable: "YES", default_value: null, type: "bigint" },
    { name: "gl_revision_run_at", nullable: "YES", default_value: null, type: "timestamp with time zone" },
  ]);
  // Ensure every relation and owned sequence created above stays in our schema,
  // and no fixture can reach an external table through a foreign key/trigger.
  const hazards = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND (EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f'))`, [schema]);
  expect(hazards.rows[0]?.n).toBe(0);
  const sequences = await db.query<{ name: string; owner_schema: string | null }>(`SELECT c.relname AS name,
    own_ns.nspname AS owner_schema FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_class'::regclass
      AND dep.objid=c.oid AND dep.deptype IN ('a','i') AND dep.refclassid='pg_catalog.pg_class'::regclass
    LEFT JOIN pg_catalog.pg_class owner ON owner.oid=dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace own_ns ON own_ns.oid=owner.relnamespace
    WHERE c.relkind='S' AND ns.nspname=$1`, [schema]);
  expect(sequences.rows).toHaveLength(3);
  for (const sequence of sequences.rows) expect(sequence.owner_schema).toBe(schema);
  const defaults = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_catalog.pg_attrdef a
    JOIN pg_catalog.pg_class c ON c.oid=a.adrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
    JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_attrdef'::regclass AND dep.objid=a.oid
    LEFT JOIN pg_catalog.pg_class target ON dep.refclassid='pg_catalog.pg_class'::regclass AND target.oid=dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace target_ns ON target_ns.oid=target.relnamespace
    LEFT JOIN pg_catalog.pg_proc fn ON dep.refclassid='pg_catalog.pg_proc'::regclass AND fn.oid=dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace fn_ns ON fn_ns.oid=fn.pronamespace
    WHERE ns.nspname=$1 AND ((target.oid IS NOT NULL AND target_ns.nspname<>$1)
      OR (fn.oid IS NOT NULL AND fn_ns.nspname NOT IN ($1,'pg_catalog')))`, [schema]);
  expect(defaults.rows[0]?.n).toBe(0);
}

let db: Fixture;
let service: IngestService;
function realService(hooks: IngestSqlHooks = {}) {
  return new IngestService(createIngestServiceSqlAdapter(db, hooks));
}

const payload = (domain: IngestPayload["domain"], table: string, rows: Row[], extra: Partial<IngestPayload> = {}): IngestPayload => {
  const cfg = TABLE_CONFIG[table];
  if (!cfg) throw new Error("Unknown payload fixture table");
  const emptyColumns = Object.fromEntries(cfg.columns.map(column => [column, null]));
  // Every service input must pass the same accepted DTO as the HTTP boundary.
  return IngestPayload.parse({ unit_code: "synthetic-fixture", domain, watermark_high: WATERMARK,
    tables: { [table]: rows.map(row => ({ ...emptyColumns, ...row })) }, ...extra });
};
const receipt = (id = "D1", extra: Row = {}): Row => ({
  ckdtrm: id, dtgltrm: D2, dtgljam: `${D2}T08:00:00Z`, nvoldo: 10, nvolreal: 9,
  ckdbbm: "P", ckdtangki: "T", sbatal: 0, ...extra,
});
const terra = (id = "R1", extra: Row = {}): Row => ({
  ckdterra: id, ckdnozzle: "N", business_date: D2, dtgljam: `${D2}T08:00:00Z`,
  nvolume: 2, ntotal: 20, nharga: 10, ckdbbm: "P", ckdtangki: "T", sbatal: 0, ...extra,
});
const detail = (extra: Row = {}): Row => ({
  ckdjualbbm: "H1", ckdnozzle: "N", nurut: 1, dtgljam: `${D2}T08:00:00Z`, nvolume: 10, ckdbbm: "P", ...extra,
});
const cases: { table: string; domain: IngestPayload["domain"]; row: Row; nullable: string; value: unknown }[] = [
  { table: "sales_header", domain: "sales", row: { ckdjualbbm: "H1", dtgljual: D2 }, nullable: "vcket", value: "changed" },
  { table: "sales_detail", domain: "sales", row: detail(), nullable: "nsubtotal", value: 123.45 },
  { table: "opname", domain: "opname", row: { ckdopnbbm: "O1", ckdtangki: "T", dtgljam: `${D2}T08:00:00Z`, dtaglopn: D2 }, nullable: "nstockop", value: 50 },
  { table: "delivery", domain: "delivery", row: receipt(), nullable: "cnopol", value: "TEST" },
  { table: "terra_resmi", domain: "terra_resmi", row: terra(), nullable: "ckdjualbbm", value: "H1" },
  { table: "product", domain: "masters", row: { ckdbbm: "P", vcnmbbm: "SYNTHETIC" }, nullable: "perk_map", value: { sales: "A" } },
];
interface SyncState { revision: string | null; run: string | null; marker: string | null; watermark: string | null; count: number }
async function state(domain: string, unit = U): Promise<SyncState | undefined> {
  const result = await db.query<SyncState>(`SELECT gl_revision::text AS revision, last_run_at::text AS run,
    gl_revision_run_at::text AS marker, last_watermark::text AS watermark, last_row_count AS count
    FROM sync_state WHERE unit_id=$1 AND domain=$2`, [unit, domain]);
  return result.rows[0];
}
async function businessRows(table: string, unit = U): Promise<Row[]> {
  if (!TABLE_CONFIG[table]) throw new Error("Unknown fixture table");
  const result = await db.query<{ business: Row }>(`SELECT to_jsonb(t)-'id'-'ingested_at' AS business
    FROM "${table}" t WHERE unit_id=$1 ORDER BY to_jsonb(t)-'id'-'ingested_at'`, [unit]);
  return result.rows.map(row => row.business);
}
async function oldReplace(domain: "delivery" | "terra_resmi", unit: number, rows: Row[], from = D2, to = D3) {
  rows = payload(domain, domain, rows, { replace_window: { from, to } }).tables[domain]!;
  // Differential oracle for the OLD replacement algorithm only. The new path
  // always runs IngestService above. Both use existing production SQL builders.
  await db.transaction(async tx => {
    for (const statement of buildReplaceWindowDeletes(domain, unit, { from, to }))
      await tx.query(statement.sql, statement.params);
    if (rows.length) {
      const statement = buildUpsert(TABLE_CONFIG[domain]!, unit, rows);
      await tx.query(statement.sql, statement.params);
    }
  });
}

// Safety guards run even when SQL behavior tests are intentionally skipped.
describe("G/L ingest disposable PostgreSQL fixture gates", () => {
  const safe = "postgresql://snapshot_ci_admin:snapshot_ci_only@127.0.0.1:5432/solamax_snapshot_ci";
  it("accepts only the dedicated opt-in and exact disposable target", () => {
    expect(postgresFixtureTarget("1", safe)).toMatchObject({ host: "127.0.0.1", database: CI_DATABASE, user: CI_USER });
  });
  it.each([undefined, "", "0", "true"])("rejects incomplete opt-in (%s)", flag => {
    expect(() => postgresFixtureTarget(flag, safe)).toThrow();
  });
  it.each([undefined, "", "invalid", safe.replace("127.0.0.1", "localhost"),
    safe.replace("127.0.0.1", "sql.example.com"), safe.replace("127.0.0.1", "127.0.0.1.example.com"),
    safe.replace("127.0.0.1", "[::1]"), safe.replace("solamax_snapshot_ci", "solamax"),
    safe.replace("snapshot_ci_admin:", "ingest:"), safe.replace("snapshot_ci_only", "other"),
    safe.replace(":5432", ""), safe.replace(":5432", ":443"), safe.replace(":5432", ":65536"),
    safe + "?host=/cloudsql/live", safe + "?options=-csearch_path=public", safe + "#override",
  ])("rejects unsafe fixture URL case %#", raw => {
    expect(() => postgresFixtureTarget("1", raw)).toThrow();
  });
  it("validates actual server database, role, and PostgreSQL major 16", () => {
    const valid = { database: CI_DATABASE, role: CI_USER, version: "160012" };
    expect(() => assertIdentity(valid)).not.toThrow();
    for (const row of [undefined, { ...valid, database: "solamax" }, { ...valid, role: "ingest" },
      { ...valid, version: "150010" }, { ...valid, version: "180003" }, { ...valid, version: "16garbage" }])
      expect(() => assertIdentity(row)).toThrow();
  });
  it("refuses cleanup identifiers outside its exact owned schema format", () => {
    for (const schema of ["public", "app", "gl_ingest_other", 'gl_ingest_"; DROP SCHEMA public CASCADE; --'])
      expect(() => assertOwnedSchema(schema)).toThrow();
  });
});

describe.skipIf(!enginePath && !postgresRequested).sequential("G/L content revision through actual IngestService SQL", () => {
  beforeAll(async () => { db = await createFixture(); await installSchema(db); }, 30_000);
  beforeEach(async () => {
    await db.exec(`TRUNCATE ${TABLES.map(table => `"${table}"`).join(", ")} RESTART IDENTITY`);
    service = realService();
  });
  afterAll(async () => { await db?.close(); }, 20_000);

  it("cleans its committed schema after an explicit migration transaction aborts", async () => {
    const failedMigration = await createFixture();
    try {
      await failedMigration.exec("CREATE TABLE cleanup_probe (id integer); BEGIN");
      await expect(failedMigration.query("SELECT 1/0")).rejects.toThrow(/division by zero/);
      // close() must recover/close the poisoned session before its DROP and
      // verify that the committed schema is actually absent afterward.
    } finally { await failedMigration.close(); }
  });

  it.each(cases)("$table: identical resend keeps counter and stored content, advances health, retains raw accepted counts", async ({ table, domain, row }) => {
    // Duplicated input collapses to one stored key, but accepted response is 2.
    const p = payload(domain, table, [row, row]);
    const firstResponse = await service.ingest(U, p);
    expect(firstResponse).toEqual({ upserted: { [table]: 2 }, new_watermark: WATERMARK });
    const before = (await state(domain))!;
    const stored = await businessRows(table);
    expect(before).toMatchObject({ revision: "1", count: 2 });
    expect(before.marker).toBe(before.run);
    const tupleBefore = await db.query<{ tuple: string }>(`SELECT ctid::text AS tuple FROM "${table}" WHERE unit_id=$1`, [U]);
    await db.query("SELECT pg_sleep(0.002)");
    expect(await service.ingest(U, p)).toEqual(firstResponse);
    const after = (await state(domain))!;
    expect(after).toMatchObject({ revision: "1", count: 2, watermark: before.watermark });
    expect(after.run).not.toBe(before.run);
    expect(after.marker).toBe(after.run);
    expect(await businessRows(table)).toEqual(stored);
    // Even headers/masters without ingested_at must avoid physical no-op UPDATE.
    const tupleAfter = await db.query<{ tuple: string }>(`SELECT ctid::text AS tuple FROM "${table}" WHERE unit_id=$1`, [U]);
    expect(tupleAfter.rows).toEqual(tupleBefore.rows);
  });

  it.each(cases)("$table: NULL→value→NULL updates exactly once per actual transition", async ({ table, domain, row, nullable, value }) => {
    await service.ingest(U, payload(domain, table, [{ ...row, [nullable]: null }]));
    await service.ingest(U, payload(domain, table, [{ ...row, [nullable]: value }]));
    expect((await state(domain))?.revision).toBe("2");
    expect((await businessRows(table))[0]?.[nullable]).not.toBeNull();
    await service.ingest(U, payload(domain, table, [{ ...row, [nullable]: null }]));
    expect((await state(domain))?.revision).toBe("3");
    expect((await businessRows(table))[0]?.[nullable]).toBeNull();
    await service.ingest(U, payload(domain, table, [{ ...row, [nullable]: null }]));
    expect((await state(domain))?.revision).toBe("3");
  });

  it("backdated receipt, cancellation, and business-date moves advance despite unchanged watermark", async () => {
    const first = receipt();
    await service.ingest(U, payload("delivery", "delivery", [first]));
    const watermark = (await state("delivery"))!.watermark;
    for (const [index, row] of [receipt("D1", { nvoldo: 11, dtgljam: `${D1}T01:00:00Z` }),
      receipt("D1", { nvoldo: 11, sbatal: 1 }), receipt("D1", { nvoldo: 11, sbatal: 1, dtgltrm: D1 })].entries()) {
      await service.ingest(U, payload("delivery", "delivery", [row], { watermark_high: `${D1}T01:00:00Z` }));
      expect(await state("delivery")).toMatchObject({ revision: String(index + 2), watermark });
    }
    expect((await businessRows("delivery"))[0]).toMatchObject({ dtgltrm: D1, sbatal: 1, nvoldo: 11 });
  });

  it("sales detail prune counts deletion, preserves unrelated headers, and ignores repeat pruning", async () => {
    await service.ingest(U, payload("sales", "sales_detail", [detail(), detail({ nurut: 2 }), detail({ ckdjualbbm: "H2" })]));
    const p = payload("sales", "sales_detail", [detail({ ckdjualbbm: "H1   ", ckdnozzle: "N  " })], { replace_details: true });
    await service.ingest(U, p);
    expect((await state("sales"))?.revision).toBe("2");
    const rows = await businessRows("sales_detail");
    expect(rows).toHaveLength(2);
    expect(rows.map(row => String(row.ckdjualbbm).trim()).sort()).toEqual(["H1", "H2"]);
    await service.ingest(U, p);
    expect((await state("sales"))?.revision).toBe("2");
  });

  it.each(["delivery", "terra_resmi"] as const)("%s window replacement equals old delete/upsert for duplicates, date moves, and out-of-window rows", async domain => {
    const make = domain === "delivery" ? receipt : terra;
    const dateKey = domain === "delivery" ? "dtgltrm" : "business_date";
    const volumeKey = domain === "delivery" ? "nvoldo" : "nvolume";
    const seed = [make("KEEP"), make("REMOVE"), make("MOVE"), make("OUTSIDE", { [dateKey]: D1 })];
    await service.ingest(U, payload(domain, domain, seed));
    await service.ingest(2, payload(domain, domain, seed));
    const changes = [make("KEEP", { [volumeKey]: 3 }), make("KEEP", { [volumeKey]: 4 }),
      make("MOVE", { [dateKey]: D3 }), make("NEW", { [dateKey]: D1 })];
    const p = payload(domain, domain, changes, { replace_window: { from: D2, to: D3 } });
    const response = await service.ingest(U, p);
    await oldReplace(domain, 2, changes);
    const withoutUnit = (rows: Row[]) => rows.map(({ unit_id: _unit, ...row }) => row);
    expect(withoutUnit(await businessRows(domain, U))).toEqual(withoutUnit(await businessRows(domain, 2)));
    expect(response.upserted[domain]).toBe(4);
    const kept = (await businessRows(domain)).find(row => String(row[domain === "delivery" ? "ckdtrm" : "ckdterra"]).trim() === "KEEP");
    expect(kept?.[volumeKey]).toBe(domain === "delivery" ? 4 : 7); // keep-last versus sumOnConflict
    expect((await state(domain))?.revision).toBe("2");
    await service.ingest(U, p);
    expect((await state(domain))?.revision).toBe("2");
    // Empty window removes only remaining in-window keys, including a zero-row
    // accepted payload; the second empty prune is a true no-op.
    const empty = payload(domain, domain, [], { replace_window: { from: D2, to: D3 } });
    expect(await service.ingest(U, empty)).toEqual({ upserted: {}, new_watermark: WATERMARK });
    await oldReplace(domain, 2, []);
    expect(withoutUnit(await businessRows(domain, U))).toEqual(withoutUnit(await businessRows(domain, 2)));
    expect((await state(domain))?.revision).toBe("3");
    await service.ingest(U, empty);
    expect((await state(domain))?.revision).toBe("3");
  });

  it.each(["delivery", "terra_resmi"] as const)("%s: 1,000-row replacement matches the old algorithm and identical replay rewrites no keys", async domain => {
    const make = domain === "delivery" ? receipt : terra;
    const dateKey = domain === "delivery" ? "dtgltrm" : "business_date";
    const volumeKey = domain === "delivery" ? "nvoldo" : "nvolume";
    const seed = Array.from({ length: 1_000 }, (_, index) => make(`K${String(index).padStart(4, "0")}`,
      { [volumeKey]: index + 1 }));
    for (const unit of [U, 2]) await service.ingest(unit, payload(domain, domain, seed));
    // 950 old keys + 50 replacements; some changed values and dates exercise
    // the normal UPSERT work, while the deleted window keys must disappear.
    const replacement = Array.from({ length: 1_000 }, (_, index) => make(`K${String(index + 50).padStart(4, "0")}`,
      { [volumeKey]: index + 51 + (index % 10 === 0 ? 1 : 0), [dateKey]: index % 100 === 0 ? D3 : D2 }));
    const p = payload(domain, domain, replacement, { replace_window: { from: D2, to: D3 } });
    expect((await service.ingest(U, p)).upserted[domain]).toBe(1_000);
    await oldReplace(domain, 2, replacement);
    const withoutUnit = (rows: Row[]) => rows.map(({ unit_id: _unit, ...row }) => row);
    expect(withoutUnit(await businessRows(domain, U))).toEqual(withoutUnit(await businessRows(domain, 2)));
    const keys = domain === "delivery" ? "ckdtrm" : "ckdterra, ckdnozzle";
    const tuples = () => db.query<{ key: string[]; tuple: string }>(
      `SELECT jsonb_build_array(${keys}) AS key, ctid::text AS tuple FROM "${domain}" WHERE unit_id=$1 ORDER BY ${keys}`, [U]);
    const beforeTuples = (await tuples()).rows;
    expect(beforeTuples).toHaveLength(1_000);
    const beforeState = (await state(domain))!;
    expect(beforeState.revision).toBe("2");
    await service.ingest(U, p);
    expect((await state(domain))?.revision).toBe(beforeState.revision);
    expect((await tuples()).rows).toEqual(beforeTuples);
    expect(withoutUnit(await businessRows(domain, U))).toEqual(withoutUnit(await businessRows(domain, 2)));
  }, 20_000);

  it("delivery CHAR padding matches the retained natural key without false pruning", async () => {
    await service.ingest(U, payload("delivery", "delivery", [receipt("D1")]));
    await service.ingest(U, payload("delivery", "delivery", [receipt("D1   ")], { replace_window: { from: D2, to: D3 } }));
    expect((await state("delivery"))?.revision).toBe("1");
    expect(await businessRows("delivery")).toHaveLength(1);
  });

  it("terra VARCHAR key pairs preserve significant trailing spaces and prune the exact pair", async () => {
    const padded = terra("R1 ", { ckdnozzle: "N " });
    await service.ingest(U, payload("terra_resmi", "terra_resmi", [terra(), terra("R1 "), terra("R1", { ckdnozzle: "N " }), padded]));
    const p = payload("terra_resmi", "terra_resmi", [padded], { replace_window: { from: D2, to: D3 } });
    await service.ingest(U, p);
    expect(await businessRows("terra_resmi")).toEqual([expect.objectContaining({ ckdterra: "R1 ", ckdnozzle: "N " })]);
    expect((await state("terra_resmi"))?.revision).toBe("2");
    await service.ingest(U, p);
    expect((await state("terra_resmi"))?.revision).toBe("2");
  });

  it("terra bounded VARCHAR padding matches actual storage without false pruning or rewriting", async () => {
    // PostgreSQL permits overlength trailing padding and truncates it on column
    // assignment. The retained-key comparison must use exactly those widths.
    const row = terra("R1                ", { ckdnozzle: "N     " });
    const p = payload("terra_resmi", "terra_resmi", [row], { replace_window: { from: D2, to: D3 } });
    await service.ingest(U, p);
    const before = await db.query<{ id: string; nozzle: string; tuple: string }>(
      "SELECT ckdterra AS id, ckdnozzle AS nozzle, ctid::text AS tuple FROM terra_resmi WHERE unit_id=$1", [U]);
    expect(before.rows[0]?.id).toHaveLength(15);
    expect(before.rows[0]?.nozzle).toBe("N    ");
    await service.ingest(U, p);
    expect((await state("terra_resmi"))?.revision).toBe("1");
    const after = await db.query<{ id: string; nozzle: string; tuple: string }>(
      "SELECT ckdterra AS id, ckdnozzle AS nozzle, ctid::text AS tuple FROM terra_resmi WHERE unit_id=$1", [U]);
    expect(after.rows).toEqual(before.rows);
  });

  it("terra overlength nonspace keys keep the original UPSERT failure and roll back window pruning", async () => {
    await service.ingest(U, payload("terra_resmi", "terra_resmi", [terra()]));
    const beforeRows = await businessRows("terra_resmi");
    const beforeState = await state("terra_resmi");
    const p = payload("terra_resmi", "terra_resmi", [terra("NEW", { ckdnozzle: "TOOLONG" })],
      { replace_window: { from: D2, to: D3 } });
    await expect(service.ingest(U, p)).rejects.toThrow(/value too long/);
    expect(await businessRows("terra_resmi")).toEqual(beforeRows);
    expect(await state("terra_resmi")).toEqual(beforeState);
  });

  it("non-G/L writes and accepted empty source-cut markers retain content revision zero", async () => {
    for (const amount of [10, 20]) {
      await service.ingest(U, payload("cash", "cash_header", [{ ckdkb: "C1", dtgl: D2, ntotal: amount }]));
      expect((await state("cash"))?.revision).toBe("0");
    }
    await service.ingest(U, payload("masters", "pelanggan_master", [], { source_cut: {
      cycle_id: "10000000-0000-4000-8000-000000000001", domain: "pelanggan_master",
      chunk_index: 0, chunk_count: 1, row_count: 0,
    } }));
    expect(await state("masters")).toMatchObject({ revision: "0", count: 0 });
    expect((await state("cash"))?.revision).toBe("0");
    expect((await businessRows("cash_header"))[0]?.ntotal).toBe(20);
  });

  it("actual G/L table writes under a different allowed domain advance that domain only", async () => {
    await service.ingest(U, payload("cash", "product", [{ ckdbbm: "P", vcnmbbm: "A" }]));
    expect((await state("cash"))?.revision).toBe("1");
    expect(await state("masters")).toBeUndefined();
    await service.ingest(U, payload("cash", "product", [{ ckdbbm: "P", vcnmbbm: "B" }]));
    expect((await state("cash"))?.revision).toBe("2");
  });

  it("unit-scoped edits and pruning preserve the other unit's rows and revision", async () => {
    for (const unit of [U, 2]) await service.ingest(unit, payload("delivery", "delivery", [receipt()]));
    const otherRows = await businessRows("delivery", 2);
    const otherState = await state("delivery", 2);
    await service.ingest(U, payload("delivery", "delivery", [], { replace_window: { from: D2, to: D3 } }));
    expect(await businessRows("delivery", U)).toEqual([]);
    expect(await businessRows("delivery", 2)).toEqual(otherRows);
    expect(await state("delivery", 2)).toEqual(otherState);
    expect((await state("delivery", U))?.revision).toBe("2");
  });

  it("actual transaction-local scope enforces RLS, fails closed, and rejects cross-unit writes", async () => {
    for (const unit of [U, 2]) await service.ingest(unit, payload("delivery", "delivery", [receipt()]));
    const schema = (await db.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0]!.schema;
    assertOwnedSchema(schema);
    // This predefined NOLOGIN role exists on both PG16 and PGlite. We change
    // only ACLs/policies on owned fixture objects, never create a global role.
    const role = await db.query<{ safe: boolean }>(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AS safe
      FROM pg_catalog.pg_roles WHERE rolname='pg_read_all_data'`);
    expect(role.rows[0]?.safe).toBe(true);
    const predicate = migration("0016_rls_unit_scope").match(/predicate text := \$p\$([\s\S]*?)\$p\$;/)?.[1];
    if (!predicate) throw new Error("Expected actual RLS migration predicate is missing");
    await db.exec(`GRANT USAGE ON SCHEMA "${schema}" TO pg_read_all_data;
      GRANT SELECT, INSERT, UPDATE, DELETE ON delivery, sync_state TO pg_read_all_data;
      ALTER TABLE delivery ENABLE ROW LEVEL SECURITY; ALTER TABLE delivery FORCE ROW LEVEL SECURITY;
      ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_state FORCE ROW LEVEL SECURITY;
      CREATE POLICY unit_scope ON delivery USING (${predicate}) WITH CHECK (${predicate});
      CREATE POLICY unit_scope ON sync_state USING (${predicate}) WITH CHECK (${predicate});`);
    try {
      const scoped = realService({ beforeTransaction: async tx => { await tx.query("SET LOCAL ROLE pg_read_all_data"); } });
      const otherRows = await businessRows("delivery", 2);
      const otherState = await state("delivery", 2);
      await scoped.ingest(U, payload("delivery", "delivery", [receipt("D1", { nvoldo: 12 })]));
      expect((await state("delivery"))?.revision).toBe("2");
      expect(await businessRows("delivery", 2)).toEqual(otherRows);
      expect(await state("delivery", 2)).toEqual(otherState);
      await db.transaction(async tx => {
        await tx.query("SET LOCAL ROLE pg_read_all_data");
        // A previous ingest's SET LOCAL unit context must not leak to a new tx.
        expect((await tx.query("SELECT * FROM delivery")).rows).toEqual([]);
        expect((await tx.query("SELECT * FROM sync_state")).rows).toEqual([]);
        await tx.query("SELECT set_config('app.unit_ids','1',true)");
        expect((await tx.query("SELECT unit_id FROM delivery")).rows).toEqual([{ unit_id: 1 }]);
      });
      await expect(db.transaction(async tx => {
        await tx.query("SET LOCAL ROLE pg_read_all_data");
        await tx.query("SELECT set_config('app.unit_ids','1',true)");
        const accepted = payload("delivery", "delivery", [receipt("CROSS-UNIT")]);
        const statement = buildUpsert(TABLE_CONFIG.delivery!, 2, accepted.tables.delivery!);
        await tx.query(statement.sql, statement.params);
      })).rejects.toThrow(/row-level security/);
      expect(await businessRows("delivery", 2)).toEqual(otherRows);
    } finally {
      await db.exec(`DROP POLICY unit_scope ON delivery; DROP POLICY unit_scope ON sync_state;
        ALTER TABLE delivery DISABLE ROW LEVEL SECURITY; ALTER TABLE sync_state DISABLE ROW LEVEL SECURITY;
        REVOKE SELECT, INSERT, UPDATE, DELETE ON delivery, sync_state FROM pg_read_all_data;
        REVOKE USAGE ON SCHEMA "${schema}" FROM pg_read_all_data;`);
    }
  });

  it("failure after source DML and before metadata rolls back source rows and counters together", async () => {
    await service.ingest(U, payload("delivery", "delivery", [receipt()]));
    const beforeRows = await businessRows("delivery");
    const beforeState = await state("delivery");
    const failing = realService({ beforeStatement: sql => {
      if (/INSERT INTO "sync_state"/.test(sql)) throw new Error("synthetic failure before metadata");
    } });
    await expect(failing.ingest(U, payload("delivery", "delivery", [receipt("D1", { nvoldo: 99 }), receipt("NEW")]))).rejects.toThrow("synthetic failure before metadata");
    expect(await businessRows("delivery")).toEqual(beforeRows);
    expect(await state("delivery")).toEqual(beforeState);
    await service.ingest(U, payload("delivery", "delivery", [receipt("D1", { nvoldo: 99 })]));
    expect((await state("delivery"))?.revision).toBe("2");
  });

  it("new A → legacy older receipt B → new no-op B advances again without watermark movement", async () => {
    await service.ingest(U, payload("delivery", "delivery", [receipt()]));
    const initial = (await state("delivery"))!;
    const changed = receipt("D1", { nvoldo: 11, dtgljam: `${D1}T08:00:00Z` });
    await db.transaction(async tx => {
      const statement = buildUpsert(TABLE_CONFIG.delivery!, U, payload("delivery", "delivery", [changed]).tables.delivery!);
      await tx.query(statement.sql, statement.params);
      // Exact previous writer behavior: heartbeat/watermark update, no marker.
      await tx.query(`INSERT INTO "sync_state" ("unit_id","domain","last_watermark","last_run_at","last_row_count")
        VALUES ($1,'delivery',$2::timestamptz,now(),1) ON CONFLICT ("unit_id","domain") DO UPDATE SET
        "last_watermark"=GREATEST(COALESCE(EXCLUDED."last_watermark","sync_state"."last_watermark"),
          COALESCE("sync_state"."last_watermark",EXCLUDED."last_watermark")),
        "last_run_at"=now(),"last_row_count"=EXCLUDED."last_row_count"`, [U, `${D1}T08:00:00Z`]);
    });
    const legacy = (await state("delivery"))!;
    expect(legacy).toMatchObject({ revision: "1", watermark: initial.watermark });
    expect(legacy.run).not.toBe(legacy.marker);
    const contentBefore = await businessRows("delivery");
    await service.ingest(U, payload("delivery", "delivery", [changed], { watermark_high: `${D1}T08:00:00Z` }));
    expect(await businessRows("delivery")).toEqual(contentBefore);
    const healed = (await state("delivery"))!;
    expect(healed).toMatchObject({ revision: "2", watermark: initial.watermark });
    expect(healed.marker).toBe(healed.run);
    await service.ingest(U, payload("delivery", "delivery", [changed]));
    expect((await state("delivery"))?.revision).toBe("2");
  });

  it("first new no-op after nullable migration metadata advances once to establish the handshake", async () => {
    await service.ingest(U, payload("delivery", "delivery", [receipt()]));
    await db.exec("UPDATE sync_state SET gl_revision=NULL, gl_revision_run_at=NULL");
    await service.ingest(U, payload("delivery", "delivery", [receipt()]));
    expect((await state("delivery"))?.revision).toBe("1");
    await service.ingest(U, payload("delivery", "delivery", [receipt()]));
    expect((await state("delivery"))?.revision).toBe("1");
  });

  // A two-party barrier requires two native open transactions BEFORE either
  // service begins. PGlite is single-connection and cannot prove these races.
  async function concurrently(first: IngestPayload, second: IngestPayload) {
    let arrived = 0;
    let release!: () => void;
    let deadline!: ReturnType<typeof setTimeout>;
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve;
      deadline = setTimeout(() => reject(new Error("Two native transactions did not reach the barrier within 2 seconds")), 2_000);
    });
    // Attach rejection immediately, including a failed connection before arrival.
    void gate.catch(() => undefined);
    const racing = realService({ beforeTransaction: async () => {
      if (++arrived === 2) release();
      await gate;
    } });
    try {
      const results = await Promise.allSettled([racing.ingest(U, first), racing.ingest(U, second)]);
      expect(arrived).toBe(2);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    } finally { clearTimeout(deadline); }
  }

  it.skipIf(!postgresRequested).each(["delivery", "sales"] as const)("native PostgreSQL: simultaneous identical %s resends increment once", async domain => {
    // Delivery exercises the window advisory lock; sales exercises competing
    // UPSERTs without that lock, including an initially absent sync_state row.
    const p = domain === "delivery"
      ? payload(domain, "delivery", [receipt()], { replace_window: { from: D2, to: D3 } })
      : payload(domain, "sales_detail", [detail()]);
    await concurrently(p, p);
    expect((await state(domain))?.revision).toBe("1");
    expect(await businessRows(domain === "delivery" ? "delivery" : "sales_detail")).toHaveLength(1);
  }, 20_000);

  it.skipIf(!postgresRequested)("native PostgreSQL: simultaneous distinct edits each increment the shared counter", async () => {
    await service.ingest(U, payload("sales", "sales_detail", [detail()]));
    await concurrently(payload("sales", "sales_detail", [detail({ nvolume: 20 })]),
      payload("sales", "sales_detail", [detail({ nvolume: 30 })]));
    expect((await state("sales"))?.revision).toBe("3");
    expect([20, 30]).toContain((await businessRows("sales_detail"))[0]?.nvolume);
  }, 20_000);

  it.skipIf(!postgresRequested)("native PostgreSQL: simultaneous domains retain both source changes and independent counters", async () => {
    await concurrently(payload("masters", "product", [{ ckdbbm: "P", vcnmbbm: "FIRST" }]),
      payload("cash", "product", [{ ckdbbm: "Q", vcnmbbm: "SECOND" }]));
    expect((await state("masters"))?.revision).toBe("1");
    expect((await state("cash"))?.revision).toBe("1");
    expect((await businessRows("product")).map(row => row.vcnmbbm).sort()).toEqual(["FIRST", "SECOND"]);
  }, 20_000);
});
