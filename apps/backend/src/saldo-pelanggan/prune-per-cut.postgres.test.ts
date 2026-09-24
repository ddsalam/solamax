import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MARK_CYCLE_DRAINED_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  READ_DOOMED_CYCLES_SQL,
} from "./source-capture-sql.js";
import { SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";

const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");

const CUT = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
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

function seedCycle(n: number, status: "staging" | "complete" | "failed", baris: number): void {
  const waktu = status === "complete"
    ? `'2026-09-${String(10 + n).padStart(2, "0")} 19:05:15+00', clock_timestamp(), NULL, NULL`
    : status === "failed"
      ? `NULL, NULL, clock_timestamp(), 'superseded'`
      : `NULL, NULL, NULL, NULL`;
  const bukti = status === "staging"
    ? "NULL,NULL,NULL,NULL,NULL,NULL"
    : "1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea)";
  sql(`INSERT INTO app.saldo_pelanggan_source_cycle
 (unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,failed_at,
  failure_summary,pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,
  bppiut_keyed_checksum,bphut_row_count,bphut_keyed_checksum)
 VALUES (1,'${CUT(n)}',${n},'${status}',${waktu},${bukti});`);
  if (baris === 0) return;
  sql(`INSERT INTO app.saldo_pelanggan_source_bppiut
 (unit_id,source_cycle_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
 SELECT 1,'${CUT(n)}','P${n}-'||g,'2026-09-01'::date,'PLG1',100,1,0,sha256(g::text::bytea)
 FROM generate_series(1,${baris}) g;
INSERT INTO app.saldo_pelanggan_source_pelanggan
 (unit_id,source_cycle_id,ckdplg,vcnmplg,sjenis,row_keyed_checksum)
 VALUES (1,'${CUT(n)}','PLG1','PLG1',1,sha256('x'::bytea));`);
}

const doomed = (): string[] =>
  rows(bind(READ_DOOMED_CYCLES_SQL, [1])).map((r) => r.source_cycle_id);

/**
 * `RETURNING 1` ditambahkan HANYA untuk menghitung baris terhapus di dalam uji;
 * ia tidak mengubah baris mana yang dihapus. DELETE tidak bisa berdiri sebagai
 * subquery, jadi bentuk CTE inilah satu-satunya cara membaca jumlahnya tanpa
 * menulis ulang pernyataan produksinya.
 */
function prune(cycle: string, limit: number = SNAPSHOT_RETIREMENT_LIMITS.batchRows): number[] {
  return PRUNE_RETIRED_SOURCE_ROWS_SQL.map((s) => Number(
    sql(`WITH x AS (${bind(s, [1, cycle, limit])} RETURNING 1) SELECT count(*) FROM x;`),
  ));
}

/** MARK_CYCLE_DRAINED_SQL sudah membawa RETURNING-nya sendiri. */
function markDrained(cycle: string): number {
  return Number(sql(`WITH x AS (${bind(MARK_CYCLE_DRAINED_SQL, [1, cycle])}) SELECT count(*) FROM x;`));
}

const sisaBaris = (cycle: string): number => Number(sql(
  `SELECT (SELECT count(*) FROM app.saldo_pelanggan_source_bppiut WHERE source_cycle_id='${cycle}')
        + (SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan WHERE source_cycle_id='${cycle}')
        + (SELECT count(*) FROM app.saldo_pelanggan_source_bphut WHERE source_cycle_id='${cycle}');`));

suite("pemensiunan per-cut (PostgreSQL 16)", () => {
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
    for (const m of ["0037_saldo_pelanggan_snapshot", "0038_snapshot_manifest_row_count",
                     "0039_snapshot_debet_kredit", "0040_saldo_pelanggan_shift",
                     "0041_source_cycle_rows_pruned_at"]) {
      sql(readFileSync(resolve(migrations, m, "migration.sql"), "utf8"));
    }
  });

  it("cut yang tersusul masuk daftar; cut TERBARU tidak pernah", () => {
    seedCycle(1, "failed", 5);
    seedCycle(2, "complete", 5);
    seedCycle(3, "complete", 5);
    // Cut 3 adalah complete tertinggi — ia predesesor diff berikutnya.
    expect(doomed()).toEqual([CUT(1), CUT(2)]);
  });

  it("menguras satu cut sampai habis, lalu menandainya — dan ia hilang dari daftar", () => {
    seedCycle(1, "failed", 5);
    seedCycle(2, "complete", 5);
    expect(sisaBaris(CUT(1))).toBe(6);

    expect(prune(CUT(1))).toEqual([1, 5, 0]); // pelanggan, bppiut, bphut
    expect(sisaBaris(CUT(1))).toBe(0);
    expect(markDrained(CUT(1))).toBe(1);
    expect(doomed()).toEqual([]);
  });

  // 🔴 RISIKO UTAMA: tanda "sudah kosong" pada cut yang MASIH BERISI membuat
  // barisnya tak pernah terhapus, diam-diam dan selamanya.
  it("MENOLAK menandai cut yang masih punya baris — di SQL, bukan di kode pemanggil", () => {
    seedCycle(1, "failed", 5);
    seedCycle(2, "complete", 5);
    expect(sisaBaris(CUT(1))).toBe(6);

    expect(markDrained(CUT(1))).toBe(0); // ditolak
    expect(rows(`SELECT rows_pruned_at FROM app.saldo_pelanggan_source_cycle
                  WHERE source_cycle_id='${CUT(1)}'`)[0]!.rows_pruned_at).toBeNull();

    // Dan cut itu TETAP ada di daftar, jadi putaran berikutnya mengurasnya.
    expect(doomed()).toContain(CUT(1));
  });

  it("menolak juga bila hanya SATU dari tiga tabel yang masih berisi", () => {
    seedCycle(1, "failed", 3);
    seedCycle(2, "complete", 1);
    // Kosongkan bppiut saja; baris pelanggan sengaja ditinggal.
    sql(`DELETE FROM app.saldo_pelanggan_source_bppiut WHERE source_cycle_id='${CUT(1)}';`);
    expect(sisaBaris(CUT(1))).toBe(1);
    expect(markDrained(CUT(1))).toBe(0);
  });

  it("penandaan idempoten — dijalankan dua kali tidak menggeser stempelnya", () => {
    seedCycle(1, "failed", 2);
    seedCycle(2, "complete", 1);
    prune(CUT(1));
    expect(markDrained(CUT(1))).toBe(1);
    const pertama = rows(`SELECT rows_pruned_at::text AS t FROM app.saldo_pelanggan_source_cycle
                           WHERE source_cycle_id='${CUT(1)}'`)[0]!.t;
    expect(markDrained(CUT(1))).toBe(0);
    expect(rows(`SELECT rows_pruned_at::text AS t FROM app.saldo_pelanggan_source_cycle
                  WHERE source_cycle_id='${CUT(1)}'`)[0]!.t).toBe(pertama);
  });

  // Kelayakan tetap dinilai ULANG tiap batch, seperti bentuk lama.
  it("cut yang jadi TIDAK layak di tengah jalan berhenti dikuras", () => {
    seedCycle(1, "complete", 5);
    seedCycle(2, "complete", 1);
    expect(doomed()).toContain(CUT(1));

    // Muncul pekerjaan build yang memakai cut itu ⇒ ia tak lagi layak pensiun.
    sql(`INSERT INTO app.saldo_pelanggan_build_work
 (unit_id,work_id,as_of_date,source_cycle_id,source_cycle_sequence,source_cycle_status,rebuild_epoch,state)
 VALUES (1,gen_random_uuid(),'2026-09-11','${CUT(1)}',1,'complete',0,'queued');`);

    expect(doomed()).not.toContain(CUT(1));
    expect(prune(CUT(1))).toEqual([0, 0, 0]); // predikatnya menahan
    expect(sisaBaris(CUT(1))).toBe(6);
  });

  it("batch berbatas: LIMIT menahan jumlah yang dihapus sekali jalan", () => {
    seedCycle(1, "failed", 10);
    seedCycle(2, "complete", 1);
    const [, bppiutPertama] = prune(CUT(1), 4);
    expect(bppiutPertama).toBe(4);
    const [, bppiutKedua] = prune(CUT(1), 4);
    expect(bppiutKedua).toBe(4);
    const [, bppiutKetiga] = prune(CUT(1), 4);
    expect(bppiutKetiga).toBe(2); // tidak penuh ⇒ tabel ini tuntas
  });

  it("cut bertanda kosong tidak muncul lagi walau masih memenuhi predikat pensiun", () => {
    seedCycle(1, "failed", 1);
    seedCycle(2, "complete", 1);
    prune(CUT(1));
    markDrained(CUT(1));
    // Predikat pensiunnya masih benar untuk cut 1; yang menyingkirkannya dari
    // daftar adalah tandanya. Di situlah ongkos pemindaian hilang.
    expect(doomed()).toEqual([]);
  });
});
