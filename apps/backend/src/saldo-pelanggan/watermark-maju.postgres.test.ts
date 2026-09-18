import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLEAR_DIRTY_IF_COVERED_SQL } from "./snapshot-sql.js";
import { MARK_STALE_POINTERS_SQL } from "./source-capture-sql.js";

const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");

const CUT9 = "00000000-0000-4000-8000-000000000109";
const CUT10 = "00000000-0000-4000-8000-000000000110";
const TANGGAL = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];

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

/** Kelompok terakhir UUID WAJIB 12 heksadesimal; kurang satu pun ditolak Postgres. */
const gen = (date: string, seq: number) =>
  `00000000-0000-4000-8000-${`${seq}${date.replaceAll("-", "")}`.padStart(12, "0")}`;

function seedManifest(date: string, seq: number, cut: string): void {
  sql(`INSERT INTO app.saldo_pelanggan_snapshot_manifest
 (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,
  source_completed_at,status,published,validation_passed,computed_at,completed_at,published_at,
  customer_key_count,row_count,row_keyed_checksum,
  source_pelanggan_row_count,source_pelanggan_keyed_checksum,
  source_bppiut_row_count,source_bppiut_keyed_checksum,
  source_bphut_row_count,source_bphut_keyed_checksum,
  awal_piutang_lokal_total,akhir_piutang_lokal_total,awal_piutang_online_total,
  akhir_piutang_online_total,awal_hutang_lokal_total,akhir_hutang_lokal_total,
  awal_piutang_lokal_debet_total,awal_piutang_lokal_kredit_total,
  akhir_piutang_lokal_debet_total,akhir_piutang_lokal_kredit_total,
  awal_piutang_online_debet_total,awal_piutang_online_kredit_total,
  akhir_piutang_online_debet_total,akhir_piutang_online_kredit_total,
  awal_hutang_lokal_debet_total,awal_hutang_lokal_kredit_total,
  akhir_hutang_lokal_debet_total,akhir_hutang_lokal_kredit_total)
 VALUES (1,'${date}','${gen(date, seq)}','saldo-pelanggan-v2','${cut}',${seq},
  '2026-09-10 19:05:15+00','complete',true,true,now(),now(),now(),1,1,sha256('r'::bytea),
  1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea),
  0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,0,0,0)
 ON CONFLICT DO NOTHING;`);
}

function pointTo(date: string, seq: number, pending: boolean): void {
  sql(`INSERT INTO app.saldo_pelanggan_snapshot_pointer
 (unit_id,as_of_date,generation_id,generation_status,generation_published,
  generation_validation_passed,source_cycle_sequence,rebuild_epoch,activated_at,
  stale_invalid_from,pending_replacement,pending_since)
 VALUES (1,'${date}','${gen(date, seq)}','complete',true,true,${seq},0,now(),
   ${pending ? "'2026-01-01'" : "NULL"}, ${pending}, ${pending ? "now()" : "NULL"})
 ON CONFLICT (unit_id, as_of_date) DO UPDATE
 SET generation_id=EXCLUDED.generation_id, source_cycle_sequence=EXCLUDED.source_cycle_sequence,
     pending_replacement=EXCLUDED.pending_replacement,
     stale_invalid_from=EXCLUDED.stale_invalid_from, pending_since=EXCLUDED.pending_since;`);
}

/** Arahkan pointer ke generasi pada cut tertentu, manifestnya disemai lebih dulu. */
function arahkan(date: string, seq: number, pending: boolean): void {
  seedManifest(date, seq, seq === 10 ? CUT10 : CUT9);
  pointTo(date, seq, pending);
}

/** Satu tanggal dibangun ulang pada cut terbaru, lalu publikasinya memicu CLEAR_DIRTY. */
function bangunUlang(date: string, statement: string = CLEAR_DIRTY_IF_COVERED_SQL): void {
  seedManifest(date, 10, CUT10);
  pointTo(date, 10, false);
  sql(bind(statement, [1, date]));
}

function dirty(): Record<string, any> {
  return rows(`SELECT dirty_invalid_from::text AS watermark,
    dirty_source_cycle_sequence AS dirty_cut, covered_through_date::text AS tercakup, version
    FROM app.saldo_pelanggan_dirty WHERE unit_id=1`)[0]!;
}

function tandaiBasi(): void {
  sql(bind(MARK_STALE_POINTERS_SQL, [1]));
}

function pending(): string[] {
  return rows(`SELECT to_char(as_of_date,'MM-DD') AS d
    FROM app.saldo_pelanggan_snapshot_pointer
    WHERE unit_id=1 AND pending_replacement ORDER BY as_of_date`).map((r) => r.d);
}

/**
 * Mutan: satu klausa predikat dibuang. `expect` pada jumlah penggantian membuat
 * uji ini GAGAL kalau teksnya bergeser — mutan yang gagal memutasi adalah uji
 * yang hampa, dan hampanya tak terlihat.
 */
function mutan(buang: string): string {
  expect(CLEAR_DIRTY_IF_COVERED_SQL).toContain(buang);
  return CLEAR_DIRTY_IF_COVERED_SQL.replace(buang, "");
}
const BUANG_PENDING = "p.pending_replacement\n      OR ";
const BUANG_SEQUENCE = "\n      OR p.source_cycle_sequence < d.dirty_source_cycle_sequence";

suite("watermark maju, bukan hanya dicabut (PostgreSQL 16)", () => {
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
                     "0039_snapshot_debet_kredit", "0040_saldo_pelanggan_shift"]) {
      sql(readFileSync(resolve(migrations, m, "migration.sql"), "utf8"));
    }
    sql(`INSERT INTO app.saldo_pelanggan_source_cycle
 (unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,
  pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,
  bphut_row_count,bphut_keyed_checksum)
 VALUES (1,'${CUT9}',9,'complete','2026-09-09 19:05:15+00',now(),1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea)),
        (1,'${CUT10}',10,'complete','2026-09-10 19:05:15+00',now(),1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea));`);
    for (const d of TANGGAL) { seedManifest(d, 9, CUT9); pointTo(d, 9, true); }
    sql(`INSERT INTO app.saldo_pelanggan_dirty
 (unit_id,dirty_invalid_from,dirty_source_cycle_id,dirty_source_cycle_sequence,dirty_since,version,updated_at)
 VALUES (1,'2026-01-01','${CUT10}',10,now(),1,now());`);
  });

  // 🔴 INTI: kemajuan jadi TAHAN LAMA lintas putaran.
  it("tunggakan 5 dengan anggaran 2 selesai dalam tiga malam, bukan tak pernah", () => {
    expect(dirty().watermark).toBe("2026-01-01");

    // Malam 1 — anggaran 2.
    bangunUlang("2026-09-01");
    bangunUlang("2026-09-02");
    expect(dirty().watermark).toBe("2026-09-03");

    // Cut berikutnya menandai basi TANPA SYARAT. Inilah yang dulu menghapus
    // kemajuan: dengan watermark di 2026-01-01, kelima tanggal kotor lagi.
    tandaiBasi();
    expect(pending()).toEqual(["09-03", "09-04", "09-05"]);

    // Malam 2.
    bangunUlang("2026-09-03");
    bangunUlang("2026-09-04");
    expect(dirty().watermark).toBe("2026-09-05");
    tandaiBasi();
    expect(pending()).toEqual(["09-05"]);

    // Malam 3 — sisa terakhir, barulah dicabut.
    bangunUlang("2026-09-05");
    const akhir = dirty();
    expect(akhir.watermark).toBeNull();
    expect(akhir.dirty_cut).toBeNull();
    expect(akhir.tercakup).toBe("2026-09-05");
  });

  // KONTROL: tanpa watermark yang maju, kemajuan yang sama bernilai NOL.
  it("watermark yang tidak maju membuat kemajuan dua malam terhapus seluruhnya", () => {
    bangunUlang("2026-09-01");
    bangunUlang("2026-09-02");
    expect(pending()).toEqual(["09-03", "09-04", "09-05"]);

    // Kembalikan watermark ke bentuk lama (tidak pernah maju), lalu cut berikutnya.
    sql(`UPDATE app.saldo_pelanggan_dirty SET dirty_invalid_from='2026-01-01' WHERE unit_id=1;`);
    tandaiBasi();
    expect(pending()).toEqual(["09-01", "09-02", "09-03", "09-04", "09-05"]);
  });

  // T2 — tanpa thrash.
  it("publikasi yang tidak memindahkan watermark TIDAK menyentuh version/updated_at", () => {
    bangunUlang("2026-09-01");
    const sesudah1 = dirty();
    expect(sesudah1.watermark).toBe("2026-09-02");

    // 09-03 bukan sisa tertua, jadi watermark tak berpindah.
    bangunUlang("2026-09-03");
    const sesudah2 = dirty();
    expect(sesudah2.watermark).toBe("2026-09-02");
    expect(sesudah2.version).toBe(sesudah1.version);

    const jam = rows(`SELECT updated_at::text AS t FROM app.saldo_pelanggan_dirty WHERE unit_id=1`)[0]!.t;
    bangunUlang("2026-09-04");
    expect(rows(`SELECT updated_at::text AS t FROM app.saldo_pelanggan_dirty WHERE unit_id=1`)[0]!.t)
      .toBe(jam);
  });

  // 🔴 T1 — predikatnya harus komplemen PERSIS. Dua mutan, dua kelas terdampar.
  it("klausa pending hilang ⇒ tanggal pending di cut terbaru TERDAMPAR di bawah watermark", () => {
    // 09-02 kotor HANYA karena pending; sequence-nya sudah terbaru.
    arahkan("2026-09-02", 10, true);
    for (const d of ["2026-09-03", "2026-09-04", "2026-09-05"]) arahkan(d, 10, false);

    // Bentuk asli: 09-02 masih terhitung sisa, jadi watermark berhenti di sana.
    bangunUlang("2026-09-01");
    expect(dirty().watermark).toBe("2026-09-02");

    // Mutan: 09-02 tak lagi terhitung sisa -> dirty DICABUT sementara 09-02 kotor.
    sql(`UPDATE app.saldo_pelanggan_dirty SET dirty_invalid_from='2026-01-01' WHERE unit_id=1;`);
    bangunUlang("2026-09-01", mutan(BUANG_PENDING));
    expect(dirty().watermark).toBeNull();
    expect(pending()).toEqual(["09-02"]); // kotor, tapi tak ada lagi yang menandainya
  });

  it("klausa sequence hilang ⇒ tanggal tertinggal cut TERDAMPAR di bawah watermark", () => {
    // 09-02 kotor HANYA karena sequence-nya tertinggal; ia tidak pending.
    arahkan("2026-09-02", 9, false);
    for (const d of ["2026-09-03", "2026-09-04", "2026-09-05"]) arahkan(d, 10, false);

    bangunUlang("2026-09-01");
    expect(dirty().watermark).toBe("2026-09-02");

    sql(`UPDATE app.saldo_pelanggan_dirty SET dirty_invalid_from='2026-01-01' WHERE unit_id=1;`);
    bangunUlang("2026-09-01", mutan(BUANG_SEQUENCE));
    expect(dirty().watermark).toBeNull();
    expect(rows(`SELECT source_cycle_sequence AS s FROM app.saldo_pelanggan_snapshot_pointer
      WHERE unit_id=1 AND as_of_date='2026-09-02'`)[0]!.s).toBe(9);
  });

  it("unit tanpa baris dirty tidak tersentuh sama sekali", () => {
    sql(`DELETE FROM app.saldo_pelanggan_dirty WHERE unit_id=1;`);
    bangunUlang("2026-09-01");
    expect(rows(`SELECT count(*) AS n FROM app.saldo_pelanggan_dirty`)[0]!.n).toBe(0);
  });
});
