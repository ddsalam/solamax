import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, it, describe } from "vitest";
import { RECORD_SHIFT_SQL, UPSERT_POINTER_SQL } from "./snapshot-sql.js";
import {
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  READ_DOOMED_CYCLES_SQL,
} from "./source-capture-sql.js";
import {
  RLS_POSITIVE_CONTROL_SQL,
  UNACKNOWLEDGED_FROZEN_SHIFTS_SQL,
} from "../sync-health/frozen-shift.sql.js";

// Suite ini tak pernah membaca DATABASE_URL atau berkas kredensial lokal. URL
// opt-in menyebut layanan CI sekali-pakai, bukan salah satu tier Cloud SQL.
const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;
const migrations = resolve(__dirname, "../../prisma/migrations");

const CUT1 = "00000000-0000-4000-8000-0000000000c1";
const CUT2 = "00000000-0000-4000-8000-0000000000c2";
const CUT3 = "00000000-0000-4000-8000-0000000000c3";
const GEN_A = "00000000-0000-4000-8000-00000000000a";
const GEN_B = "00000000-0000-4000-8000-00000000000b";
const GEN_C = "00000000-0000-4000-8000-00000000000c";
const GEN_D = "00000000-0000-4000-8000-00000000000d";
const GEN_E = "00000000-0000-4000-8000-00000000000e";

// BEKU ≡ as_of_date < source_completed_at::date - 7 (definisi tunggal G5).
// Cut terakhir selesai 2026-09-15 ⇒ batasnya 2026-09-08.
const BEKU = "2026-08-31";
const DALAM_JENDELA = "2026-09-10";

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

/** `scope` null = SENGAJA tanpa app.unit_ids, untuk membuktikan jebakan RLS. */
function sql(statement: string, owner = true, scope: string | null = "1,2"): string {
  const prelude = owner
    ? `SET ROLE snapshot_ci_owner;${scope === null ? "" : ` SET app.unit_ids = '${scope}';`}`
    : "";
  return execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
    env: connection,
    input: `${prelude}\n${statement}`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
  }).trim();
}

function rows(statement: string, scope: string | null = "1,2"): Record<string, any>[] {
  return JSON.parse(
    sql(`SELECT COALESCE(json_agg(result), '[]'::json) FROM (${statement}) result;`, true, scope),
  );
}

function bind(statement: string, values: Array<string | number | null>): string {
  return statement.replace(/\$(\d+)/g, (_t, index: string) => {
    const value = values[Number(index) - 1];
    if (value === undefined) throw new Error(`Missing fixture argument ${index}`);
    return value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  });
}

function migrationText(prefix: string): string {
  return readFileSync(resolve(migrations, prefix, "migration.sql"), "utf8");
}

/** Skema kosong + 0037..0039. 0040 SENGAJA terpisah: uji backfill memasangnya
 *  SESUDAH manifest ada, supaya teks migrasi yang asli yang teruji. */
function resetSchema(): void {
  sql(`DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.unit CASCADE;
DROP TABLE IF EXISTS public.pelanggan_master;
CREATE SCHEMA app AUTHORIZATION snapshot_ci_owner;
CREATE TABLE public.unit(unit_id smallint PRIMARY KEY);
ALTER TABLE public.unit OWNER TO snapshot_ci_owner;
CREATE TABLE public.pelanggan_master(unit_id smallint,ckdplg char(12),vcnmplg text);
ALTER TABLE public.pelanggan_master OWNER TO snapshot_ci_owner;
INSERT INTO public.unit VALUES(1),(2);`, false);
  sql(migrationText("0037_saldo_pelanggan_snapshot"));
  sql(migrationText("0038_snapshot_manifest_row_count"));
  sql(migrationText("0039_snapshot_debet_kredit"));
  // 0041 hanya menyentuh source_cycle, jadi aman dipasang di sini walau 0040
  // sengaja dipasang belakangan oleh masing-masing uji.
  sql(migrationText("0041_source_cycle_rows_pruned_at"));
  sql(`
INSERT INTO app.saldo_pelanggan_source_cycle
(unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,
 pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,bphut_row_count,bphut_keyed_checksum)
VALUES
 (1,'${CUT1}',1,'complete','2026-09-12 19:05:15+00',now(),1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea)),
 (1,'${CUT2}',2,'complete','2026-09-14 19:05:15+00',now(),1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea)),
 (1,'${CUT3}',3,'complete','2026-09-15 19:05:15+00',now(),1,sha256('m'::bytea),1,sha256('p'::bytea),1,sha256('h'::bytea));`);
}

/** Manifest complete dengan keenam total terisi. */
function seedManifest(
  date: string, gen: string, cut: string, seq: number, completedAt: string, epl: string,
): void {
  sql(`
INSERT INTO app.saldo_pelanggan_snapshot_manifest
 (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,
  source_completed_at,status,published,validation_passed,
  computed_at,completed_at,published_at,customer_key_count,row_count,row_keyed_checksum,
  source_pelanggan_row_count,source_pelanggan_keyed_checksum,
  source_bppiut_row_count,source_bppiut_keyed_checksum,
  source_bphut_row_count,source_bphut_keyed_checksum,
  awal_piutang_lokal_total,akhir_piutang_lokal_total,
  awal_piutang_online_total,akhir_piutang_online_total,
  awal_hutang_lokal_total,akhir_hutang_lokal_total,
  awal_piutang_lokal_debet_total,awal_piutang_lokal_kredit_total,
  akhir_piutang_lokal_debet_total,akhir_piutang_lokal_kredit_total,
  awal_piutang_online_debet_total,awal_piutang_online_kredit_total,
  akhir_piutang_online_debet_total,akhir_piutang_online_kredit_total,
  awal_hutang_lokal_debet_total,awal_hutang_lokal_kredit_total,
  akhir_hutang_lokal_debet_total,akhir_hutang_lokal_kredit_total)
VALUES (1,'${date}','${gen}','saldo-pelanggan-v2','${cut}',${seq},'${completedAt}',
  'complete',true,true,
  '${completedAt}','${completedAt}','${completedAt}',1,1,sha256('${gen}'::bytea),
  1,sha256('m'::bytea), 1,sha256('p'::bytea), 1,sha256('h'::bytea),
  0,${epl}, 0,0, 0,0,
  -- CHECK 0039: total = debet - kredit. Sisi kredit nol; nilainya duduk di debet.
  0,0, ${epl},0, 0,0, 0,0, 0,0, 0,0);`);
}

function pointTo(date: string, gen: string, seq: number): void {
  sql(bind(UPSERT_POINTER_SQL, [1, date, gen, seq, 0]));
}

/** INSERT ... RETURNING tidak bisa dibungkus subquery; jalankan apa adanya dan
 *  hitung baris yang dipulangkan. */
function record(date: string, gen: string): number {
  const out = sql(bind(RECORD_SHIFT_SQL, [1, date, gen]));
  return out === "" ? 0 : out.split("\n").length;
}

function belumDiakui(scope: string | null = "1,2"): Record<string, any>[] {
  return rows(UNACKNOWLEDGED_FROZEN_SHIFTS_SQL, scope);
}

function ack(date: string, gen: string, email = "damiandionsalam@gmail.com"): void {
  sql(`INSERT INTO app.saldo_pelanggan_shift_ack
 (unit_id,as_of_date,generation_id,acknowledged_by_email)
 VALUES (1,'${date}','${gen}','${email}');`);
}

suite("pengawas pergerakan angka BEKU (PostgreSQL 16)", () => {
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

  it("merekam pergeseran pada tanggal BEKU, dengan nilai sebelum = yang dilihat pengguna", () => {
    resetSchema();
    sql(migrationText("0040_saldo_pelanggan_shift"));

    seedManifest(BEKU, GEN_A, CUT1, 1, "2026-09-12 19:05:15+00", "14411866896.50");
    pointTo(BEKU, GEN_A, 1);
    seedManifest(BEKU, GEN_B, CUT2, 2, "2026-09-14 19:05:15+00", "13721798165.5");

    // Dipanggil SEBELUM pointer bertukar — persis seperti di transaksi publikasi.
    expect(record(BEKU, GEN_B)).toBe(1);

    const [event] = rows(`SELECT frozen, previous_generation_id,
      before_akhir_piutang_lokal::text AS sebelum, after_akhir_piutang_lokal::text AS sesudah
      FROM app.saldo_pelanggan_shift WHERE generation_id='${GEN_B}'`);
    expect(event).toMatchObject({ frozen: true, previous_generation_id: GEN_A });
    expect(Number(event!.sesudah) - Number(event!.sebelum)).toBe(-690068731);
  });

  it("pergeseran DI DALAM jendela tercatat tetapi tidak beralarm", () => {
    seedManifest(DALAM_JENDELA, GEN_D, CUT1, 1, "2026-09-12 19:05:15+00", "100");
    pointTo(DALAM_JENDELA, GEN_D, 1);
    seedManifest(DALAM_JENDELA, GEN_E, CUT3, 3, "2026-09-15 19:05:15+00", "250");
    expect(record(DALAM_JENDELA, GEN_E)).toBe(1);

    expect(rows(`SELECT frozen FROM app.saldo_pelanggan_shift WHERE generation_id='${GEN_E}'`))
      .toEqual([{ frozen: false }]);
    // Alarm hanya melihat yang beku.
    expect(belumDiakui().map((r) => r.generation_id)).toEqual([GEN_B]);
  });

  it("pergeseran di bawah 1 rupiah tidak menerbitkan peristiwa", () => {
    pointTo(BEKU, GEN_B, 2);
    seedManifest(BEKU, GEN_C, CUT3, 3, "2026-09-15 19:05:15+00", "13721798165.9");
    expect(record(BEKU, GEN_C)).toBe(0);
    sql(`DELETE FROM app.saldo_pelanggan_snapshot_manifest WHERE generation_id='${GEN_C}'`);
  });

  // 🔴 SYARAT 4 — PERSETUJUAN TERIKAT PADA NILAI, BUKAN PADA BARIS.
  it("setujui -> geser lagi -> HARUS merah, dan kunci (unit,tanggal) terbukti TIDAK bisa merah", () => {
    ack(BEKU, GEN_B);
    expect(belumDiakui()).toHaveLength(0); // hijau setelah diakui

    // Angkanya bergerak LAGI pada tanggal yang sama.
    seedManifest(BEKU, GEN_C, CUT3, 3, "2026-09-15 19:05:15+00", "13725530902.5");
    expect(record(BEKU, GEN_C)).toBe(1);

    const merah = belumDiakui();
    expect(merah).toHaveLength(1);
    expect(merah[0]).toMatchObject({ generation_id: GEN_C });
    expect(Number(merah[0]!.geser_piutang_lokal)).toBe(3732737);

    // KONTROL: predikat yang sama persis, kecuali kuncinya melupakan generasi.
    // Kalau ini juga merah, uji di atas tidak membedakan apa pun.
    const kunciBaris = rows(`
      SELECT s.generation_id FROM app.saldo_pelanggan_shift s
      WHERE s.frozen AND NOT EXISTS (
        SELECT 1 FROM app.saldo_pelanggan_shift_ack a
        WHERE a.unit_id = s.unit_id AND a.as_of_date = s.as_of_date)`);
    expect(kunciBaris).toHaveLength(0);
  });

  // 🔴 SYARAT 6 — NOL BARIS KARENA RLS TIDAK BOLEH TERBACA SEBAGAI BERSIH.
  it("tanpa app.unit_ids semuanya nol TANPA GALAT, dan kontrol positif membedakannya", () => {
    const berScope = rows(RLS_POSITIVE_CONTROL_SQL)[0]!;
    expect(Number(berScope.pointer_rows)).toBeGreaterThan(0);
    expect(Number(berScope.shift_rows)).toBeGreaterThan(0);
    expect(belumDiakui()).toHaveLength(1);

    // Tanpa scope: daftar pergeseran kosong — BENTUK YANG SAMA PERSIS dengan sehat.
    expect(belumDiakui(null)).toHaveLength(0);
    // Yang membedakannya adalah kontrol positif, yang ikut nol.
    const tanpaScope = rows(RLS_POSITIVE_CONTROL_SQL, null)[0]!;
    expect(Number(tanpaScope.pointer_rows)).toBe(0);
    expect(Number(tanpaScope.shift_rows)).toBe(0);
  });

  // SYARAT 8 — PERISTIWA TIDAK IKUT DIPENSIUNKAN.
  it("pemensiunan sumber tidak menyentuh peristiwa maupun pengakuan", () => {
    const sebelum = rows(`SELECT
      (SELECT count(*) FROM app.saldo_pelanggan_shift) AS peristiwa,
      (SELECT count(*) FROM app.saldo_pelanggan_shift_ack) AS pengakuan`)[0]!;
    // Cut di bawah sequence complete tertinggi otomatis masuk pensiun; tak ada
    // status 'retired'. Baris sumber disemai lebih dulu supaya pemensiunannya
    // benar-benar MENGHAPUS sesuatu — prune yang tak menghapus apa pun tidak
    // membuktikan bahwa peristiwa selamat.
    sql(`INSERT INTO app.saldo_pelanggan_source_pelanggan
 (unit_id,source_cycle_id,ckdplg,vcnmplg,sjenis,row_keyed_checksum)
 VALUES (1,'${CUT1}','A','A',1,sha256('a'::bytea)),
        (1,'${CUT2}','B','B',1,sha256('b'::bytea));`);
    const sumberSebelum = Number(rows(`SELECT count(*) AS n FROM app.saldo_pelanggan_source_pelanggan`)[0]!.n);
    expect(sumberSebelum).toBe(2);
    // Prune kini per-CUT: daftar cut dibaca lebih dulu, lalu tiap cut ditembak
    // lewat PK-nya. Uji ini hanya perlu pemensiunannya benar-benar MENGHAPUS —
    // yang dijaganya adalah bahwa peristiwa pergeseran TIDAK ikut terhapus.
    for (const { source_cycle_id: cut } of rows(bind(READ_DOOMED_CYCLES_SQL, [1]))) {
      for (const statement of PRUNE_RETIRED_SOURCE_ROWS_SQL) {
        sql(bind(statement, [1, cut, 20000]));
      }
    }
    expect(Number(rows(`SELECT count(*) AS n FROM app.saldo_pelanggan_source_pelanggan`)[0]!.n)).toBe(0);
    const sesudah = rows(`SELECT
      (SELECT count(*) FROM app.saldo_pelanggan_shift) AS peristiwa,
      (SELECT count(*) FROM app.saldo_pelanggan_shift_ack) AS pengakuan`)[0]!;
    expect(sesudah).toEqual(sebelum);
  });

  // UJI PENERIMAAN BACKFILL — bentuknya sama dengan yang pemilik hitung di produksi.
  it("backfill 0040 menerbitkan tepat pasangan berurutan yang bergeser, dengan beku yang benar", () => {
    resetSchema();
    seedManifest(BEKU, GEN_A, CUT1, 1, "2026-09-12 19:05:15+00", "14411866896.50");
    seedManifest(BEKU, GEN_B, CUT2, 2, "2026-09-14 19:05:15+00", "13721798165.5");
    seedManifest(BEKU, GEN_C, CUT3, 3, "2026-09-15 19:05:15+00", "13725530902.5");
    seedManifest(DALAM_JENDELA, GEN_D, CUT1, 1, "2026-09-12 19:05:15+00", "100");
    seedManifest(DALAM_JENDELA, GEN_E, CUT3, 3, "2026-09-15 19:05:15+00", "250");
    // Generasi yang KALAH publikasi tak pernah dilihat pengguna: harus diabaikan.
    sql(`INSERT INTO app.saldo_pelanggan_snapshot_manifest
 (unit_id,as_of_date,generation_id,formula_version,source_cycle_id,source_cycle_sequence,
  source_completed_at,status,completed_at,failure_code,failure_summary,akhir_piutang_lokal_total)
 VALUES (1,'${BEKU}','00000000-0000-4000-8000-00000000000f','saldo-pelanggan-v2','${CUT3}',3,
  '2026-09-15 19:05:15+00','failed',now(),'superseded','kalah urutan publikasi', 999999999);`);

    sql(migrationText("0040_saldo_pelanggan_shift"));

    const hasil = rows(`SELECT as_of_date::text AS tanggal, generation_id, frozen,
      -- trim_scale: skala numeric ikut berubah tanpa nilainya berubah, jadi
      -- perbandingan teks mentah akan merah karena "-690068731.00" vs
      -- "-690068731.0". Yang diuji nilainya, bukan renderingnya.
      trim_scale(COALESCE(after_akhir_piutang_lokal,0)-COALESCE(before_akhir_piutang_lokal,0))::text AS geser
      FROM app.saldo_pelanggan_shift ORDER BY as_of_date, source_cycle_sequence`);

    expect(hasil).toEqual([
      { tanggal: BEKU, generation_id: GEN_B, frozen: true, geser: "-690068731" },
      { tanggal: BEKU, generation_id: GEN_C, frozen: true, geser: "3732737" },
      { tanggal: DALAM_JENDELA, generation_id: GEN_E, frozen: false, geser: "150" },
    ]);
  });
});
