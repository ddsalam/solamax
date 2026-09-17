import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ASSERT_VALID_SOURCE_SIDES_SQL,
  SOURCE_CYCLE_EVIDENCE_SQL,
  COMPLETE_MANIFEST_SQL,
  INSERT_BUILDING_MANIFEST_SQL,
  MATERIALIZE_DELTA_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  READ_READY_SNAPSHOT_SQL,
  UPSERT_POINTER_SQL,
  VALIDATE_BASELINE_SQL,
  VALIDATE_GENERATION_SQL,
} from "./snapshot-sql.js";

import { ENQUEUE_STALE_POINTERS_SQL, ENQUEUE_BACKFILL_SQL, READ_BACKFILL_SOURCE_CYCLE_SQL, SUPERSEDE_BACKFILL_WORK_SQL } from "./source-capture-sql.js";

// This suite never reads DATABASE_URL or local credential files. The opt-in URL
// names the disposable CI service, not either Cloud SQL tier. The old B2 live
// suite and its system_identifier guard remain unchanged.
const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");
const cut = "00000000-0000-4000-8000-000000000001";
const oldBase = "00000000-0000-4000-8000-000000000002";
const oldTarget = "00000000-0000-4000-8000-000000000003";
const full = "00000000-0000-4000-8000-000000000004";
const delta = "00000000-0000-4000-8000-000000000005";
const six = ["awal_piutang_lokal", "akhir_piutang_lokal", "awal_piutang_online", "akhir_piutang_online", "awal_hutang_lokal", "akhir_hutang_lokal"];
const sides = ["piutang_lokal", "piutang_online", "hutang_lokal"].flatMap(book =>
  ["awal", "akhir"].flatMap(boundary => ["debet", "kredit"].map(side => `${boundary}_${book}_${side}`)));
const eighteen = [...six, ...sides];
let connection: NodeJS.ProcessEnv;
let dashboardPointerSql: string;
let dashboardRowsSql: string;
let schemaReadySql: string;

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

function expectSqlFailure(statement: string, sqlState: string, detail: string): void {
  let stderr: string | undefined;
  try {
    sql(statement);
  } catch (error) {
    stderr = String((error as {stderr?: unknown}).stderr ?? "");
  }
  expect(stderr, "Expected the intended database rejection, not a connection or SQL syntax failure").toContain(sqlState);
  expect(stderr).toContain(detail);
}

function rows(statement: string): Record<string, any>[] {
  return JSON.parse(sql(`SELECT COALESCE(json_agg(result), '[]'::json) FROM (${statement}) result;`));
}

// Only fixed fixture values reach this helper; production statements retain
// their positional parameters. String literals are still SQL-escaped.
function bind(statement: string, values: Array<string | number | null>): string {
  return statement.replace(/\$(\d+)/g, (_token, index: string) => {
    const value = values[Number(index) - 1];
    if (value === undefined) throw new Error(`Missing fixture argument ${index}`);
    return value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
  });
}

function migration39(): string {
  const matches = readdirSync(migrations).filter(name => name.startsWith("0039_"));
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrations, matches[0]!, "migration.sql"), "utf8");
}

function seedGeneration(date: string, id: string, baseline: boolean): string {
  const values = baseline
    ? "('IBLOCAL',80,80,0,0,0,0),('01.000.0003',0,0,0,0,0,0),('HUT',0,0,0,0,0,0),('ZERO',0,0,0,0,0,0),('N4',0,0,0,0,0,0)"
    : "('IBLOCAL',13052684187.50,13052684187.50,0,0,0,0),('01.000.0003',0,0,900000,900000,0,0),('HUT',0,0,0,0,-673010538,-673010538),('ZERO',0,0,0,0,0,0),('N4',0,0,0,0,0,0)";
  return `
INSERT INTO app.saldo_pelanggan_snapshot_manifest
  (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,source_completed_at,base_month_end,base_generation_id)
VALUES (1,'${date}','${id}','saldo-pelanggan-v1','${cut}',1,'2026-09-12 19:05:15+00',${baseline ? "NULL,NULL" : `'2026-08-31','${oldBase}'`});
INSERT INTO app.saldo_pelanggan_snapshot_row (unit_id,as_of_date,generation_id,customer_code,${six.join(",")})
SELECT 1,'${date}'::date,'${id}'::uuid,v.* FROM (VALUES ${values}) v;
UPDATE app.saldo_pelanggan_snapshot_manifest m SET
  status='complete', published=true, validation_passed=true,
  computed_at=now(),completed_at=now(),published_at=now(),customer_key_count=5,row_count=5,
  row_keyed_checksum=(SELECT sha256(convert_to(string_agg(concat_ws('|',unit_id::text,as_of_date::text,customer_code,${six.map(c => `${c}::text`).join(",")}),E'\\n' ORDER BY customer_code),'UTF8')) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id=m.generation_id),
  ${six.map(c => `${c}_total=(SELECT sum(${c}) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id=m.generation_id)`).join(",")},
  source_pelanggan_row_count=5,source_bppiut_row_count=7,source_bphut_row_count=2,
  source_pelanggan_keyed_checksum=sha256('master'::bytea),source_bppiut_keyed_checksum=sha256('piut'::bytea),source_bphut_keyed_checksum=sha256('hut'::bytea)
WHERE generation_id='${id}';
INSERT INTO app.saldo_pelanggan_snapshot_pointer(unit_id,as_of_date,generation_id,source_cycle_sequence,rebuild_epoch)
VALUES(1,'${date}','${id}',1,0);`;
}

function resetV1(): void {
  sql(`DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.unit CASCADE; DROP TABLE IF EXISTS public.pelanggan_master;
CREATE SCHEMA app AUTHORIZATION snapshot_ci_owner;
CREATE TABLE public.unit(unit_id smallint PRIMARY KEY);
ALTER TABLE public.unit OWNER TO snapshot_ci_owner;
CREATE TABLE public.pelanggan_master(unit_id smallint,ckdplg char(12),vcnmplg text);
ALTER TABLE public.pelanggan_master OWNER TO snapshot_ci_owner;
INSERT INTO public.unit VALUES(1),(2);`, false);
  sql(readFileSync(resolve(migrations, "0037_saldo_pelanggan_snapshot/migration.sql"), "utf8"));
  sql(readFileSync(resolve(migrations, "0038_snapshot_manifest_row_count/migration.sql"), "utf8"));
  sql(`
INSERT INTO app.saldo_pelanggan_source_cycle
(unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,bphut_row_count,bphut_keyed_checksum)
VALUES(1,'${cut}',1,'complete','2026-09-12 19:05:15+00',now(),5,sha256('master'::bytea),7,sha256('piut'::bytea),2,sha256('hut'::bytea));
INSERT INTO app.saldo_pelanggan_source_pelanggan(unit_id,source_cycle_id,ckdplg,vcnmplg,sjenis,row_keyed_checksum)
SELECT 1,'${cut}',code,code,kind,sha256(code::bytea) FROM (VALUES('IBLOCAL',1),('01.000.0003',3),('HUT',3),('ZERO',5),('N4',4)) v(code,kind);
INSERT INTO app.saldo_pelanggan_source_bppiut(unit_id,source_cycle_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
SELECT 1,'${cut}',key,date::date,code,amount,side,0,sha256(key::bytea) FROM (VALUES
('P1','2026-08-30','IBLOCAL',100::numeric,1),('P2','2026-08-30','IBLOCAL',20::numeric,2),
('P3','2026-09-12','IBLOCAL',122345938194::numeric,1),('P4','2026-09-12','IBLOCAL',109293254086.50::numeric,2),
('P5','2026-09-12','01.000.0003',10505841::numeric,1),('P6','2026-09-12','01.000.0003',9605841::numeric,2),
('P7','2026-09-12','N4',6411357535::numeric,1)) v(key,date,code,amount,side);
INSERT INTO app.saldo_pelanggan_source_bphut(unit_id,source_cycle_id,ckdbphut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
SELECT 1,'${cut}',key,'2026-09-12','HUT',amount,side,0,sha256(key::bytea) FROM (VALUES
('H1',53549062678.5::numeric,1),('H2',54222073216.5::numeric,2)) v(key,amount,side);
${seedGeneration("2026-08-31", oldBase, true)}
${seedGeneration("2026-09-13", oldTarget, false)}
INSERT INTO app.saldo_pelanggan_dirty(unit_id,covered_through_date,covered_by_generation_id,covered_source_cycle_sequence)
VALUES(1,'2026-09-13','${oldTarget}',1);
INSERT INTO app.saldo_pelanggan_build_work(unit_id,work_id,as_of_date,source_cycle_id,source_cycle_sequence,generation_id,state,attempt_count,completed_at)
VALUES(1,'00000000-0000-4000-8000-000000000006','2026-09-13','${cut}',1,'${oldTarget}','done',1,now());`);
}

describe("snapshot PostgreSQL CI target guard", () => {
  it("rejects absent, remote, proxy-like wrong database, and option-bearing URLs before connection", () => {
    for (const value of [undefined, "postgresql://ingest:secret@127.0.0.1:55439/solamax", "postgresql://snapshot_ci_admin:snapshot_ci_only@db.example:5432/solamax_snapshot_ci", "postgresql://snapshot_ci_admin:snapshot_ci_only@localhost:5432/solamax_snapshot_ci?host=remote"]) {
      expect(() => ciConnection(value)).toThrow();
    }
  });
});

suite("saldo v2 migration and SQL on disposable PostgreSQL 16", () => {
  beforeAll(async () => {
    connection = ciConnection(process.env.SNAPSHOT_POSTGRES_CI_URL);
    const identity = JSON.parse(sql("SELECT json_build_object('version',current_setting('server_version_num')::int,'database',current_database(),'user',current_user);", false));
    expect(identity).toMatchObject({ database: "solamax_snapshot_ci", user: "snapshot_ci_admin" });
    // Dipatok ke 16 (2026-09-14, keputusan owner): `gcloud sql instances
    // describe` menjawab POSTGRES_16 untuk solamax-pg DAN solamax-pg-rlsstg.
    // Sebelumnya suite ini menegaskan 14 — versi yang tidak berjalan di tier
    // mana pun, sehingga setiap "lulus di PostgreSQL" menguji mesin yang salah.
    expect(identity.version).toBeGreaterThanOrEqual(160000);
    expect(identity.version).toBeLessThan(170000);
    sql("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='snapshot_ci_owner') THEN CREATE ROLE snapshot_ci_owner NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$;", false);
    const dashboardPath = resolve(__dirname, "../../../dashboard/src/lib/saldo-snapshot.ts");
    vi.doMock(resolve(__dirname, "../../../dashboard/src/lib/db.ts"), () => ({ qScoped: vi.fn() }));
    // Runtime import keeps the dashboard source outside backend's tsc rootDir,
    // while executing the actual exported reader SQL in this database suite.
    const reader = await import(dashboardPath);
    dashboardPointerSql = reader.READ_SALDO_SNAPSHOT_POINTER_SQL;
    dashboardRowsSql = reader.READ_SALDO_SNAPSHOT_ROWS_SQL;
    const schemaWait = await import(resolve(__dirname, "../../../dashboard/src/lib/wait-snapshot-schema.ts"));
    schemaReadySql = schemaWait.SNAPSHOT_V2_SCHEMA_READY_SQL;
  });

  it("rebuilds v1 under FORCE RLS, preserving six balances and replacing every generation reference", () => {
    resetV1();
    const before = rows(`SELECT as_of_date::text,customer_code,${six.join(",")} FROM app.saldo_pelanggan_snapshot_row ORDER BY as_of_date,customer_code`);
    const physicalSize = () => rows("SELECT pg_total_relation_size('app.saldo_pelanggan_snapshot_row') AS relation_bytes,count(*) AS rows,coalesce(sum(pg_column_size(r)),0) AS payload_bytes FROM app.saldo_pelanggan_snapshot_row r")[0]!;
    const cutTimes = rows("SELECT as_of_date::text,source_completed_at FROM app.saldo_pelanggan_snapshot_manifest ORDER BY as_of_date");
    const beforeUpgrade = rows("SELECT clock_timestamp() AS started")[0]!.started as string;
    const v1Size = physicalSize();
    expect(rows(schemaReadySql)).toEqual([{ready:false}]);
    sql(migration39());
    expect(rows(schemaReadySql)).toEqual([{ready:true}]);
    expect(rows("SELECT as_of_date::text,source_completed_at FROM app.saldo_pelanggan_snapshot_manifest ORDER BY as_of_date")).toEqual(cutTimes);
    expect(rows(`SELECT generation_id FROM app.saldo_pelanggan_snapshot_manifest WHERE computed_at < '${beforeUpgrade}'::timestamptz OR completed_at < '${beforeUpgrade}'::timestamptz OR published_at < '${beforeUpgrade}'::timestamptz`)).toHaveLength(0);
    const v2Size = physicalSize();
    expect(v2Size.rows).toBe(v1Size.rows);
    expect(v2Size.payload_bytes).toBeGreaterThan(v1Size.payload_bytes);
    console.info("Snapshot same-fixture upgrade storage (relation includes old dead tuples until vacuum):", { v1: v1Size, v2: v2Size });
    expect(rows(`SELECT as_of_date::text,customer_code,${six.join(",")} FROM app.saldo_pelanggan_snapshot_row ORDER BY as_of_date,customer_code`)).toEqual(before);
    const manifests = rows("SELECT as_of_date::text,generation_id,formula_version,rebuild_epoch,base_generation_id FROM app.saldo_pelanggan_snapshot_manifest ORDER BY as_of_date");
    expect(manifests).toHaveLength(2);
    expect(manifests.every(m => m.formula_version === "saldo-pelanggan-v2" && m.rebuild_epoch > 0)).toBe(true);
    expect(manifests.map(m => m.generation_id)).not.toContain(oldBase);
    expect(manifests.map(m => m.generation_id)).not.toContain(oldTarget);
    expect(manifests[1]!.base_generation_id).toBe(manifests[0]!.generation_id);
    expect(rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer ORDER BY as_of_date").map(r => r.generation_id)).toEqual(manifests.map(m => m.generation_id));
    expect(rows("SELECT covered_by_generation_id FROM app.saldo_pelanggan_dirty")[0]!.covered_by_generation_id).toBe(manifests[1]!.generation_id);
    expect(rows("SELECT generation_id,rebuild_epoch FROM app.saldo_pelanggan_build_work")[0]).toEqual({ generation_id: manifests[1]!.generation_id, rebuild_epoch: manifests[1]!.rebuild_epoch });
    expect(rows(bind(dashboardPointerSql,[1,"2026-09-13"]))).toHaveLength(1);
    const read = rows(bind(dashboardRowsSql,[1,"2026-09-13",manifests[1]!.generation_id]));
    expect(read).toHaveLength(6);
    expect(read[0]!.integrityVerified).toBe(true);
    expect(read.find(row => row.customerCode === "IBLOCAL")).toMatchObject({
      akhirPiutangLokal: 13052684187.5, akhirPiutangLokalDebet: 122345938294, akhirPiutangLokalKredit: 109293254106.5,
    });
    expect(rows(bind(READ_READY_SNAPSHOT_SQL,[1,"2026-09-13"]))).toHaveLength(5);
    expect(rows("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('app.saldo_pelanggan_snapshot_row'::regclass,'app.saldo_pelanggan_snapshot_manifest'::regclass)").every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    expect(rows("SELECT condeferrable,condeferred FROM pg_constraint WHERE conname IN ('sps_manifest_base_generation_fkey','sps_pointer_generation_fkey','sps_row_generation_fkey','sps_dirty_coverage_generation_fkey','sps_work_generation_fkey')").every(r => !r.condeferrable && !r.condeferred)).toBe(true);
    expect(sql("SET app.unit_ids=''; SELECT count(*) FROM app.saldo_pelanggan_snapshot_row;")).toBe("0");
    expect(sql("SET app.unit_ids='2'; SELECT count(*) FROM app.saldo_pelanggan_snapshot_row;")).toBe("0");
  });

  it("keeps a validated empty generation readable through the integrity sentinel", () => {
    const emptyCut = "00000000-0000-4000-8000-000000000020";
    const emptyGeneration = "00000000-0000-4000-8000-000000000021";
    sql(`SET app.unit_ids='2';
INSERT INTO app.saldo_pelanggan_source_cycle
(unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,bphut_row_count,bphut_keyed_checksum)
VALUES(2,'${emptyCut}',1,'complete','2026-09-12 19:05:15+00',now(),0,sha256(''::bytea),0,sha256(''::bytea),0,sha256(''::bytea));
${bind(INSERT_BUILDING_MANIFEST_SQL,[2,"2026-09-13",emptyGeneration,"saldo-pelanggan-v2",emptyCut,1,0,null,null])};
${bind(MATERIALIZE_FULL_HISTORY_SQL,[2,"2026-09-13",emptyGeneration,emptyCut])};`);
    const checksum = sql(`SET app.unit_ids='2'; SELECT encode(row_keyed_checksum,'hex') FROM (${bind(VALIDATE_GENERATION_SQL,[2,"2026-09-13",emptyGeneration])}) v;`);
    sql(`SET app.unit_ids='2'; ${bind(COMPLETE_MANIFEST_SQL,[2,"2026-09-13",emptyGeneration,0,`\\x${checksum}`,...eighteen.map(() => 0)])}; ${bind(UPSERT_POINTER_SQL,[2,"2026-09-13",emptyGeneration,1,0])};`);
    const read = JSON.parse(sql(`SET app.unit_ids='2'; SELECT json_agg(result) FROM (${bind(dashboardRowsSql,[2,"2026-09-13",emptyGeneration])}) result;`));
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({integrityVerified:true,customerCode:null,awalPiutangLokal:null,awalPiutangLokalDebet:null});
  });

  it("rejects every broken debit-credit pair and NULL without CHECK UNKNOWN loopholes", () => {
    for (const balance of six) {
      expectSqlFailure(`UPDATE app.saldo_pelanggan_snapshot_row SET ${balance}_debet=${balance}_debet+1 WHERE customer_code='IBLOCAL';`, "23514", `sps_row_${balance}_sides`);
      expectSqlFailure(`UPDATE app.saldo_pelanggan_snapshot_manifest SET ${balance}_debet_total=${balance}_debet_total+1;`, "23514", `sps_manifest_${balance}_sides`);
      for (const side of ["debet", "kredit"]) {
        expectSqlFailure(`UPDATE app.saldo_pelanggan_snapshot_row SET ${balance}_${side}=NULL WHERE customer_code='IBLOCAL';`, "23502", `${balance}_${side}`);
        expectSqlFailure(`UPDATE app.saldo_pelanggan_snapshot_manifest SET ${balance}_${side}_total=NULL;`, "23514", `sps_manifest_${balance}_sides`);
      }
    }
  });

  it("retains the real IB totals exactly through SQL float8 and JSON", () => {
    // Tracked audit 01-audit.txt, section 3 (lines 68–70). These are actual
    // accepted totals; no invented high-value demonstration replaces them.
    const expected = [[122345938294,109293254106.5,13052684187.5],[10505841,9605841,900000],[53549062678.5,54222073216.5,-673010538]];
    for (const [index, book] of ["piutang_lokal", "piutang_online", "hutang_lokal"].entries()) {
      for (const boundary of ["awal", "akhir"]) {
        const prefix = `${boundary}_${book}`;
        const value = rows(`SELECT ${prefix}_debet_total::float8 AS debet,${prefix}_kredit_total::float8 AS kredit,${prefix}_total::float8 AS saldo FROM app.saldo_pelanggan_snapshot_manifest WHERE as_of_date='2026-09-13'`)[0]!;
        expect([value.debet,value.kredit,value.saldo]).toEqual(expected[index]);
        expect(value.debet-value.kredit).toBe(value.saldo);
        expect(JSON.parse(JSON.stringify(value))).toEqual(value);
      }
    }
  });

  it("round-trips every supplied EasyMax customer debit, credit, and saldo through float8 and JSON", () => {
    const path = resolve(__dirname, "../../../../session-notes/evidence/2026-09-13-piutang-fase2-gerbang-a/easymax-ib-2026-09-13.csv");
    const numericTriples = readFileSync(path,"utf8").trim().split(/\r?\n/).slice(1).map(line => line.split(",").slice(-3));
    expect(numericTriples).toHaveLength(328);
    expect(numericTriples.flat().every(value => /^-?\d+(\.\d+)?$/.test(value))).toBe(true);
    const values = numericTriples.map((triple,index) => `(${index},${triple.map(value => `${value}::numeric`).join(",")})`).join(",");
    const result = rows(`SELECT n,debet::float8 AS debet,kredit::float8 AS kredit,saldo::float8 AS saldo,
      debet::float8::numeric=debet AND kredit::float8::numeric=kredit AND saldo::float8::numeric=saldo AS exact_round_trip
      FROM (VALUES ${values}) v(n,debet,kredit,saldo) ORDER BY n`);
    expect(result.every(row => row.exact_round_trip)).toBe(true);
    expect(result.map(row => [row.debet,row.kredit,row.saldo])).toEqual(numericTriples.map(triple => triple.map(Number)));
    expect(result.every(row => row.debet-row.kredit === row.saldo)).toBe(true);
  });

  it("uses all 18 numbers in integrity checks and gets identical cumulative full-history and delta results", () => {
    const baseId = rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer WHERE as_of_date='2026-08-31'")[0]!.generation_id as string;
    expect(rows(bind(VALIDATE_BASELINE_SQL,[1,"2026-08-31","saldo-pelanggan-v2",1]))).toHaveLength(1);
    sql(bind(INSERT_BUILDING_MANIFEST_SQL,[1,"2026-09-12",full,"saldo-pelanggan-v2",cut,1,0,null,null]));
    sql(bind(MATERIALIZE_FULL_HISTORY_SQL,[1,"2026-09-12",full,cut]));
    // Release only this fixture's building slot; retain its rows as the oracle.
    sql(`UPDATE app.saldo_pelanggan_snapshot_manifest SET status='failed',completed_at=now(),failure_code='ci_oracle',failure_summary='retained full-history comparison' WHERE generation_id='${full}';`);
    sql(bind(INSERT_BUILDING_MANIFEST_SQL,[1,"2026-09-12",delta,"saldo-pelanggan-v2",cut,1,1,"2026-08-31",baseId]));
    sql(bind(MATERIALIZE_DELTA_SQL,[1,"2026-09-12",delta,cut,"2026-08-31",baseId]));
    const values = (id: string) => rows(`SELECT customer_code,${eighteen.join(",")} FROM app.saldo_pelanggan_snapshot_row WHERE generation_id='${id}' ORDER BY customer_code`);
    expect(values(delta)).toEqual(values(full));
    expect(values(delta).find(row => row.customer_code === "IBLOCAL")).toMatchObject({awal_piutang_lokal:80,akhir_piutang_lokal:13052684187.5,awal_piutang_lokal_debet:100,akhir_piutang_lokal_debet:122345938294});
    const validated = rows(bind(VALIDATE_GENERATION_SQL,[1,"2026-08-31",baseId]))[0]!;
    // Keep the net balance unchanged while changing both components: only the
    // expanded checksum can reject this corruption.
    for (const balance of six) {
      sql(`UPDATE app.saldo_pelanggan_snapshot_row SET ${balance}_debet=${balance}_debet+1,${balance}_kredit=${balance}_kredit+1 WHERE generation_id='${baseId}' AND customer_code='IBLOCAL';`);
      expect(rows(bind(VALIDATE_GENERATION_SQL,[1,"2026-08-31",baseId]))[0]!.row_keyed_checksum).not.toEqual(validated.row_keyed_checksum);
      expect(rows(bind(VALIDATE_BASELINE_SQL,[1,"2026-08-31","saldo-pelanggan-v2",1]))).toHaveLength(0);
      expect(rows(bind(dashboardRowsSql,[1,"2026-08-31",baseId]))).toHaveLength(0);
      sql(`UPDATE app.saldo_pelanggan_snapshot_row SET ${balance}_debet=${balance}_debet-1,${balance}_kredit=${balance}_kredit-1 WHERE generation_id='${baseId}' AND customer_code='IBLOCAL';`);
    }
    const size = rows("SELECT pg_total_relation_size('app.saldo_pelanggan_snapshot_row') AS row_relation_bytes,count(*) AS fixture_rows FROM app.saldo_pelanggan_snapshot_row")[0]!;
    expect(size.row_relation_bytes).toBeGreaterThan(0);
    console.info("Snapshot v2 fixture physical size (heap + TOAST + indexes):", size);
  });

  it("detects unknown included sjnsbp while preserving intentional orphan exclusion", () => {
    sql("UPDATE app.saldo_pelanggan_source_bppiut SET sjnsbp=9 WHERE ckdbppiut='P7';");
    expect(rows(bind(ASSERT_VALID_SOURCE_SIDES_SQL,[1,cut,"2026-09-13"]))[0]!.invalid_side_count).toBe(0);
    sql("UPDATE app.saldo_pelanggan_source_bppiut SET sjnsbp=NULL WHERE ckdbppiut='P3';");
    expect(rows(bind(ASSERT_VALID_SOURCE_SIDES_SQL,[1,cut,"2026-09-13"]))[0]!.invalid_side_count).toBe(1);
    sql("UPDATE app.saldo_pelanggan_source_bppiut SET sjnsbp=1 WHERE ckdbppiut IN ('P3','P7');");
  });

  it("rolls the entire migration back when source reconstruction disagrees with a stored saldo", () => {
    resetV1();
    sql("UPDATE app.saldo_pelanggan_source_bppiut SET njumlah=njumlah+1 WHERE ckdbppiut='P3';");
    expectSqlFailure(migration39(), "P0001", "snapshot_v2_legacy_balance_mismatch");
    expect(rows("SELECT generation_id,formula_version FROM app.saldo_pelanggan_snapshot_manifest ORDER BY as_of_date")).toEqual([
      {generation_id:oldBase,formula_version:"saldo-pelanggan-v1"},{generation_id:oldTarget,formula_version:"saldo-pelanggan-v1"},
    ]);
    expect(rows("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='saldo_pelanggan_snapshot_row' AND column_name LIKE '%_debet'")).toHaveLength(0);
  });

  it("fails visibly and rolls back an upgrade containing unknown included sjnsbp", () => {
    resetV1();
    sql("UPDATE app.saldo_pelanggan_source_bppiut SET sjnsbp=9 WHERE ckdbppiut='P3';");
    expectSqlFailure(migration39(), "P0001", "snapshot_v2_invalid_sjnsbp");
    expect(rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer ORDER BY as_of_date").map(r => r.generation_id)).toEqual([oldBase,oldTarget]);
  });

  it("rolls back when the retained source cut is incomplete or a builder is active", () => {
    resetV1();
    sql("DELETE FROM app.saldo_pelanggan_source_bppiut WHERE ckdbppiut='P3';");
    expectSqlFailure(migration39(), "P0001", "snapshot_v2_source_cut_incomplete");
    expect(rows("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='saldo_pelanggan_snapshot_row' AND column_name LIKE '%_debet'")).toHaveLength(0);
    resetV1();
    sql(bind(INSERT_BUILDING_MANIFEST_SQL,[1,"2026-09-12",full,"saldo-pelanggan-v1",cut,1,0,null,null]));
    expectSqlFailure(migration39(), "P0001", "snapshot_v2_active_builder");
    expect(rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer ORDER BY as_of_date").map(r => r.generation_id)).toEqual([oldBase,oldTarget]);
  });

  it("rolls back NULL source amounts instead of silently summing them as zero", () => {
    resetV1();
    sql("UPDATE app.saldo_pelanggan_source_bphut SET njumlah=NULL WHERE ckdbphut='H1';");
    expectSqlFailure(migration39(), "P0001", "snapshot_v2_invalid_source_amount");
    expect(rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer ORDER BY as_of_date").map(r => r.generation_id)).toEqual([oldBase,oldTarget]);
  });
  it.each([
    ["UPDATE app.saldo_pelanggan_snapshot_manifest SET formula_version='unexpected';", "snapshot_v2_unexpected_formula"],
    ["UPDATE app.saldo_pelanggan_source_bppiut SET ckdplg='' WHERE ckdbppiut='P3';", "snapshot_v2_invalid_customer_key"],
    ["UPDATE app.saldo_pelanggan_snapshot_manifest SET row_keyed_checksum=sha256('corrupt'::bytea);", "snapshot_v2_old_checksum_mismatch"],
  ])("rejects unsafe upgrade evidence: %s", (mutation, marker) => {
    resetV1();
    sql(mutation);
    expectSqlFailure(migration39(), "P0001", marker);
    expect(rows("SELECT generation_id FROM app.saldo_pelanggan_snapshot_pointer ORDER BY as_of_date").map(r => r.generation_id)).toEqual([oldBase,oldTarget]);
    expect(rows(schemaReadySql)).toEqual([{ready:false}]);
  });

  it("accepts a later cut for an earlier target and rejects targets beyond its WIB date", () => {
    resetV1();
    expect(rows(bind(SOURCE_CYCLE_EVIDENCE_SQL,[1,cut,1,"2026-09-10"]))).toHaveLength(1);
    expect(rows(bind(SOURCE_CYCLE_EVIDENCE_SQL,[1,cut,1,"2026-09-13"]))).toHaveLength(1);
    expect(rows(bind(SOURCE_CYCLE_EVIDENCE_SQL,[1,cut,1,"2026-09-14"]))).toHaveLength(0);
  });

  it("enqueues seven or 31 prior dates once, respecting cut date and same-cut dead letters", () => {
    resetV1();
    sql(migration39());
    sql(`DELETE FROM app.saldo_pelanggan_build_work;
      DELETE FROM app.saldo_pelanggan_snapshot_pointer;
      UPDATE app.saldo_pelanggan_source_cycle SET source_completed_at=
        ((clock_timestamp() AT TIME ZONE 'Asia/Pontianak')::date - 1)::timestamp AT TIME ZONE 'Asia/Pontianak';`);
    expect(rows(bind(READ_BACKFILL_SOURCE_CYCLE_SQL,[1]))).toEqual([{source_cycle_id:cut,source_cycle_sequence:1}]);
    const enqueue = (days: number) => sql(bind(ENQUEUE_BACKFILL_SQL,[1,days,cut,1]));
    enqueue(7);
    expect(rows("SELECT count(*) AS n FROM app.saldo_pelanggan_build_work")[0]!.n).toBe(7);
    expect(rows("SELECT w.as_of_date FROM app.saldo_pelanggan_build_work w JOIN app.saldo_pelanggan_source_cycle c USING (unit_id,source_cycle_id) WHERE w.as_of_date > (c.source_completed_at AT TIME ZONE 'Asia/Pontianak')::date")).toHaveLength(0);
    const ids = rows("SELECT work_id FROM app.saldo_pelanggan_build_work ORDER BY work_id");
    sql("UPDATE app.saldo_pelanggan_build_work SET state='dead_letter',completed_at=now();");
    enqueue(7);
    expect(rows("SELECT work_id FROM app.saldo_pelanggan_build_work ORDER BY work_id")).toEqual(ids);
    expect(rows("SELECT work_id FROM app.saldo_pelanggan_build_work WHERE state<>'dead_letter'")).toHaveLength(0);
    // Exercise the promotion enqueue SQL too: today is beyond this yesterday cut.
    sql("ALTER TABLE public.unit ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Pontianak';");
    sql(bind(ENQUEUE_STALE_POINTERS_SQL,[1,cut,1]));
    expect(rows("SELECT count(*) AS n FROM app.saldo_pelanggan_build_work")[0]!.n).toBe(7);
    enqueue(31);
    expect(rows("SELECT count(*) AS n FROM app.saldo_pelanggan_build_work")[0]!.n).toBe(31);
    expect(rows("SELECT as_of_date FROM app.saldo_pelanggan_build_work WHERE as_of_date < (clock_timestamp() AT TIME ZONE 'Asia/Pontianak')::date - 31")).toHaveLength(0);
    enqueue(32);
    expect(rows("SELECT count(*) AS n FROM app.saldo_pelanggan_build_work")[0]!.n).toBe(31);
    sql("SET app.unit_ids='2'; " + bind(ENQUEUE_BACKFILL_SQL,[1,31,cut,1]));
    expect(rows("SELECT count(*) AS n FROM app.saldo_pelanggan_build_work")[0]!.n).toBe(31);
  });

  it("keeps healthy pointers, repairs stale dates, and never falls back from an invalid latest cut", () => {
    resetV1();
    sql(migration39());
    const nextCut = "00000000-0000-4000-8000-000000000020";
    const latestComplete = `INSERT INTO app.saldo_pelanggan_source_cycle
      (unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,bphut_row_count,bphut_keyed_checksum)
      VALUES(1,'${nextCut}',2,'complete',clock_timestamp(),now(),0,sha256(''::bytea),0,sha256(''::bytea),0,sha256(''::bytea));`;
    sql(latestComplete);
    expect(rows(bind(READ_BACKFILL_SOURCE_CYCLE_SQL,[1]))[0]!.source_cycle_id).toBe(nextCut);
    sql("UPDATE app.saldo_pelanggan_source_cycle SET pelanggan_row_count=1 WHERE source_cycle_sequence=2;");
    expect(rows(bind(READ_BACKFILL_SOURCE_CYCLE_SQL,[1]))).toHaveLength(0);
    sql("UPDATE app.saldo_pelanggan_source_cycle SET pelanggan_row_count=0 WHERE source_cycle_sequence=2;");
    const today = rows("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Pontianak')::date::text AS date")[0]!.date as string;
    // Build a real empty generation today with production SQL, then publish its pointer.
    sql(bind(INSERT_BUILDING_MANIFEST_SQL,[1,today,full,"saldo-pelanggan-v2",nextCut,2,0,null,null]));
    sql(bind(MATERIALIZE_FULL_HISTORY_SQL,[1,today,full,nextCut]));
    const validation = rows(bind(VALIDATE_GENERATION_SQL,[1,today,full,nextCut]))[0]!;
    sql(bind(COMPLETE_MANIFEST_SQL,[1,today,full,0,validation.row_keyed_checksum as string,...eighteen.map(() => 0)]));
    sql(bind(UPSERT_POINTER_SQL,[1,today,full,2,0]));
    sql(bind(ENQUEUE_BACKFILL_SQL,[1,0,nextCut,2]));
    expect(rows(`SELECT work_id FROM app.saldo_pelanggan_build_work WHERE as_of_date='${today}' AND source_cycle_id='${nextCut}'`)).toHaveLength(0);
    sql(`UPDATE app.saldo_pelanggan_snapshot_pointer SET pending_replacement=true, stale_invalid_from=as_of_date, pending_since=clock_timestamp() WHERE as_of_date='${today}';`);
    const olderQueuedWork = "00000000-0000-4000-8000-000000000030";
    sql(`INSERT INTO app.saldo_pelanggan_build_work(unit_id,work_id,as_of_date,source_cycle_id,source_cycle_sequence,state)
      VALUES(1,'${olderQueuedWork}','${today}','${cut}',1,'queued');`);
    sql(bind(SUPERSEDE_BACKFILL_WORK_SQL,[1,2]));
    // Match service order: retire the old pending item before enqueueing its successor.
    sql(bind(ENQUEUE_BACKFILL_SQL,[1,0,nextCut,2]));
    expect(rows(`SELECT work_id FROM app.saldo_pelanggan_build_work WHERE as_of_date='${today}' AND source_cycle_id='${nextCut}'`)).toHaveLength(1);
    expect(rows(`SELECT state,last_error FROM app.saldo_pelanggan_build_work WHERE work_id='${olderQueuedWork}'`)).toEqual([{state:"dead_letter",last_error:"superseded_by_new_source_cut"}]);
    expect(rows(`SELECT state FROM app.saldo_pelanggan_build_work WHERE as_of_date='${today}' AND source_cycle_id='${nextCut}'`)).toEqual([{state:"queued"}]);
    expect(rows("SELECT state FROM app.saldo_pelanggan_build_work WHERE work_id='00000000-0000-4000-8000-000000000006'")).toEqual([{state:"done"}]);
  });

});
