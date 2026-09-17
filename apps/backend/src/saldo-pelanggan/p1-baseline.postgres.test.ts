import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MATERIALIZE_DELTA_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  VALIDATE_BASELINE_SQL,
  VALIDATE_GENERATION_SQL,
} from "./snapshot-sql.js";

const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");

const CUT1 = "00000000-0000-4000-8000-0000000000d1";
const CUT2 = "00000000-0000-4000-8000-0000000000d2";
const G_BASE = "00000000-0000-4000-8000-0000000000e1";
const G_DELTA = "00000000-0000-4000-8000-0000000000e2";
const G_FULL = "00000000-0000-4000-8000-0000000000e3";
const JANGKAR = "2026-08-31";
const TARGET = "2026-09-10";

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

function bind(statement: string, values: Array<string | number | null>): string {
  return statement.replace(/\$(\d+)/g, (_t, i: string) => {
    const v = values[Number(i) - 1];
    if (v === undefined) throw new Error(`Missing fixture argument ${i}`);
    return v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  });
}

function seedCut(cut: string, seq: number, selesai: string, piut: string): void {
  sql(`INSERT INTO app.saldo_pelanggan_source_cycle
 (unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,
  pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,
  bphut_row_count,bphut_keyed_checksum)
 VALUES (1,'${cut}',${seq},'complete','${selesai}',clock_timestamp(),1,sha256('m'::bytea),2,sha256('p'::bytea),0,sha256('h'::bytea));
INSERT INTO app.saldo_pelanggan_source_pelanggan(unit_id,source_cycle_id,ckdplg,vcnmplg,sjenis,row_keyed_checksum)
 VALUES (1,'${cut}','IBLOCAL','IBLOCAL',1,sha256('IBLOCAL'::bytea));
INSERT INTO app.saldo_pelanggan_source_bppiut
 (unit_id,source_cycle_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
 VALUES ${piut};`);
}

/** Faktur lama (sebelum jangkar) + faktur dalam bulan target. */
const PIUT_DASAR = (cut: string) => `
 (1,'${cut}','P1','2026-07-15','IBLOCAL',1000,1,0,sha256('P1'::bytea)),
 (1,'${cut}','P2','2026-09-05','IBLOCAL',500,1,0,sha256('P2'::bytea))`;

/** Sama, DITAMBAH pembayaran yang dicatat MUNDUR ke Juli — menggeser jangkar. */
const PIUT_MUNDUR = (cut: string) => `${PIUT_DASAR(cut)},
 (1,'${cut}','P3','2026-07-20','IBLOCAL',300,2,0,sha256('P3'::bytea))`;

function buildJangkar(): void {
  sql(`INSERT INTO app.saldo_pelanggan_snapshot_manifest
 (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,source_completed_at)
 VALUES (1,'${JANGKAR}','${G_BASE}','saldo-pelanggan-v2','${CUT1}',1,'2026-09-12 19:05:15+00');`);
  sql(bind(MATERIALIZE_FULL_HISTORY_SQL, [1, JANGKAR, G_BASE, CUT1]));
  // Checksum dan total diambil dari VALIDATE_GENERATION_SQL, bukan dikarang:
  // VALIDATE_BASELINE_SQL menghitung ulang dan MEMBANDINGKANNYA, jadi nilai
  // palsu akan membuat jangkar ditolak karena alasan yang salah.
  const kolom = [
    "awal_piutang_lokal", "akhir_piutang_lokal", "awal_piutang_online",
    "akhir_piutang_online", "awal_hutang_lokal", "akhir_hutang_lokal",
    "awal_piutang_lokal_debet", "awal_piutang_lokal_kredit",
    "akhir_piutang_lokal_debet", "akhir_piutang_lokal_kredit",
    "awal_piutang_online_debet", "awal_piutang_online_kredit",
    "akhir_piutang_online_debet", "akhir_piutang_online_kredit",
    "awal_hutang_lokal_debet", "awal_hutang_lokal_kredit",
    "akhir_hutang_lokal_debet", "akhir_hutang_lokal_kredit",
  ];
  sql(`UPDATE app.saldo_pelanggan_snapshot_manifest m SET status='complete',published=true,
   validation_passed=true,computed_at=now(),completed_at=now(),published_at=now(),
   customer_key_count=v.row_count, row_count=v.row_count,
   row_keyed_checksum=v.row_keyed_checksum,
   source_pelanggan_row_count=1,source_bppiut_row_count=2,source_bphut_row_count=0,
   source_pelanggan_keyed_checksum=sha256('m'::bytea),source_bppiut_keyed_checksum=sha256('p'::bytea),
   source_bphut_keyed_checksum=sha256('h'::bytea),
   ${kolom.map((c) => `${c}_total=v.${c}_total`).join(",")}
   FROM (${bind(VALIDATE_GENERATION_SQL, [1, JANGKAR, G_BASE])}) v
   WHERE m.generation_id='${G_BASE}';
INSERT INTO app.saldo_pelanggan_snapshot_pointer(unit_id,as_of_date,generation_id,source_cycle_sequence,rebuild_epoch)
 VALUES(1,'${JANGKAR}','${G_BASE}',1,0);`);
}

function seedManifest(gen: string, cut: string, seq: number): void {
  sql(`INSERT INTO app.saldo_pelanggan_snapshot_manifest
 (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,source_completed_at)
 VALUES (1,'${TARGET}','${gen}','saldo-pelanggan-v2','${cut}',${seq},'2026-09-13 19:05:15+00');`);
}

function checksum(gen: string): string {
  return rows(bind(VALIDATE_GENERATION_SQL, [1, TARGET, gen]))[0]!.row_keyed_checksum;
}

/**
 * Materialisasi satu generasi lalu menutup manifestnya.
 *
 * `sps_manifest_one_building` hanya mengizinkan SATU manifest 'building' per
 * unit — jadi dua cara materialisasi tidak bisa hidup berdampingan sebagai
 * 'building'. Barisnya tetap ada setelah manifestnya ditutup, dan
 * VALIDATE_GENERATION_SQL membaca baris, bukan status.
 */
function materialisasi(gen: string, cara: "delta" | "full"): string {
  seedManifest(gen, CUT2, 2);
  sql(cara === "delta"
    ? bind(MATERIALIZE_DELTA_SQL, [1, TARGET, gen, CUT2, JANGKAR, G_BASE])
    : bind(MATERIALIZE_FULL_HISTORY_SQL, [1, TARGET, gen, CUT2]));
  const hasil = checksum(gen);
  sql(`UPDATE app.saldo_pelanggan_snapshot_manifest
        SET status='failed', completed_at=now(), failure_code='fixture',
            failure_summary='ditutup supaya generasi berikutnya bisa dibangun'
        WHERE generation_id='${gen}';`);
  return hasil;
}

function baselineSah(seq: number): Record<string, any>[] {
  return rows(bind(VALIDATE_BASELINE_SQL, [1, JANGKAR, "saldo-pelanggan-v2", seq]));
}

function catatPerubahan(cut: string, mundurKe: string): void {
  sql(`INSERT INTO app.saldo_pelanggan_source_change
 (unit_id,source_cycle_id,domain,source_key,change_kind,old_business_date,new_business_date,
  old_row_keyed_checksum,new_row_keyed_checksum,classification_changed,label_only,invalid_from_date)
 VALUES (1,'${cut}','bppiut','P3','insert',NULL,'${mundurKe}',NULL,sha256('P3'::bytea),false,false,'${mundurKe}');`);
}

suite("P1 — keabsahan baseline lewat bukti perubahan (PostgreSQL 16)", () => {
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
    // Hanya sampai 0039: cabang ini berbasis `staging` dan tidak bergantung
    // pada W. Migrasi berikutnya ikut sendiri lewat urutan merge.
    for (const m of ["0037_saldo_pelanggan_snapshot", "0038_snapshot_manifest_row_count",
                     "0039_snapshot_debet_kredit"]) {
      sql(readFileSync(resolve(migrations, m, "migration.sql"), "utf8"));
    }
  });

  // 🔴 UJI YANG DIWAJIBKAN PEMILIK: baseline-dipakai-ulang vs full-history.
  it("tanpa bukti perubahan: baseline cut lama DIPAKAI ULANG, dan hasilnya IDENTIK dengan full-history", () => {
    seedCut(CUT1, 1, "2026-09-12 19:05:15+00", PIUT_DASAR(CUT1));
    buildJangkar();
    seedCut(CUT2, 2, "2026-09-13 19:05:15+00", PIUT_DASAR(CUT2));

    // Cut berganti, UUID berganti — bentuk lama menolak di sini. P1 menerima.
    expect(baselineSah(2)).toEqual([expect.objectContaining({ generation_id: G_BASE })]);

    expect(materialisasi(G_DELTA, "delta")).toBe(materialisasi(G_FULL, "full"));
  });

  it("ada bukti yang menjangkau <= tanggal jangkar: baseline DITOLAK, jadi ia dibangun ulang", () => {
    seedCut(CUT1, 1, "2026-09-12 19:05:15+00", PIUT_DASAR(CUT1));
    buildJangkar();
    seedCut(CUT2, 2, "2026-09-13 19:05:15+00", PIUT_MUNDUR(CUT2));
    catatPerubahan(CUT2, "2026-07-20");

    expect(baselineSah(2)).toEqual([]);
  });

  // 🔴 KONTROL: kalau baseline basi itu DIPAKSA dipakai, hasilnya BEDA. Tanpa ini,
  // penolakan di atas bisa saja menolak sesuatu yang sebenarnya tak berbahaya.
  it("baseline basi yang dipaksa dipakai menghasilkan checksum BERBEDA dari full-history", () => {
    seedCut(CUT1, 1, "2026-09-12 19:05:15+00", PIUT_DASAR(CUT1));
    buildJangkar();
    seedCut(CUT2, 2, "2026-09-13 19:05:15+00", PIUT_MUNDUR(CUT2));
    catatPerubahan(CUT2, "2026-07-20");

    expect(materialisasi(G_DELTA, "delta")).not.toBe(materialisasi(G_FULL, "full"));
  });

  it("bukti yang menjangkau SESUDAH tanggal jangkar tidak membatalkannya", () => {
    seedCut(CUT1, 1, "2026-09-12 19:05:15+00", PIUT_DASAR(CUT1));
    buildJangkar();
    seedCut(CUT2, 2, "2026-09-13 19:05:15+00", PIUT_DASAR(CUT2));
    // Perubahan hanya menjangkau 2026-09-05 — sesudah 2026-08-31.
    catatPerubahan(CUT2, "2026-09-05");
    expect(baselineSah(2)).toEqual([expect.objectContaining({ generation_id: G_BASE })]);
  });

  it("baseline dari cut yang LEBIH BARU dari build ini ditolak", () => {
    seedCut(CUT1, 1, "2026-09-12 19:05:15+00", PIUT_DASAR(CUT1));
    buildJangkar();
    // Build memakai sequence 0: jangkarnya berasal dari masa depan build ini.
    expect(baselineSah(0)).toEqual([]);
  });
});
