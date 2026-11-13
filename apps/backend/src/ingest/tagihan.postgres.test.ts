import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IngestPayload } from "@solamax/shared";
import { IngestService } from "./ingest.service.js";
import { createIngestServiceSqlAdapter } from "./gl-content-revision.test-support.js";

/**
 * Domain `tagihan` terhadap PostgreSQL 16 SUNGGUHAN (rencana 2026-11-13 U1+U2).
 *
 * Yang dijalankan adalah `IngestService` ASLI beserta SQL yang dibangunnya dan
 * DDL migrasi `0063_tagihan_mirror` ASLI — bukan tiruan keduanya. Adapter hanya
 * menyediakan transaksi dan jumlah baris terdampak.
 *
 * Gerbang & sasaran sama dengan suite snapshot lain: `SNAPSHOT_POSTGRES_CI=1` +
 * `SNAPSHOT_POSTGRES_CI_URL` yang HARUS menunjuk basis data sekali-pakai CI.
 * Tanpa itu seluruh suite di-skip. Tak pernah membaca DATABASE_URL.
 *
 * Suite ini bekerja di SKEMA MILIKNYA SENDIRI (`tagihan_ingest_<acak>`): kualifikasi
 * `"public".` di migrasi dipetakan ke skema itu HANYA di sini, jadi ia tak pernah
 * menimpa tabel `public`/`app` suite lain di basis data yang sama, dan membuang
 * skemanya sendiri saat selesai.
 *
 * 🔴 RLS diuji sebagai role NOSUPERUSER NOBYPASSRLS (`snapshot_ci_owner`).
 * Superuser SELALU menembus RLS — menguji sebagai `snapshot_ci_admin` akan
 * hijau tanpa membuktikan apa pun. Kontrol positifnya ada di tiap uji RLS.
 *
 * Seluruh nilai di berkas ini ilustratif.
 */
const enabled = process.env.SNAPSHOT_POSTGRES_CI === "1";
const suite = enabled ? describe.sequential : describe.skip;

const CI_DATABASE = "solamax_snapshot_ci";
const CI_USER = "snapshot_ci_admin";
const CI_ROLE = "snapshot_ci_owner";
const TABLES = ["tagihan_header", "tagihan_detail", "tagihan_bayar", "tagihan_cycle"] as const;
const MIRROR = ["tagihan_header", "tagihan_detail", "tagihan_bayar"] as const;
const U1 = 1;
const U2 = 2;

type Row = Record<string, unknown>;
interface NativeClient {
  connect(): Promise<void>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  end(): Promise<void>;
}

function ciTarget(raw: string | undefined) {
  if (!raw) throw new Error("SNAPSHOT_POSTGRES_CI_URL is required for the opt-in CI suite");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.pathname !== `/${CI_DATABASE}` || url.username !== CI_USER
    || url.password !== "snapshot_ci_only" || url.search || url.hash
    || !url.port || Number(url.port) < 1024) {
    throw new Error("Snapshot CI requires the fixed disposable localhost database and test-only account");
  }
  return { host: url.hostname, port: Number(url.port), database: CI_DATABASE,
    user: CI_USER, password: "snapshot_ci_only" };
}

const migration = (name: string) =>
  readFileSync(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");

let client: NativeClient;
let schema: string;
let service: IngestService;

/** Satu transaksi sebagai role ber-RLS, di skema milik suite ini. */
async function transaction<T>(body: (c: NativeClient) => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Baca DENGAN konteks unit (`scope` = isi GUC; `null` = tanpa konteks sama sekali). */
async function baca<T = Row>(scope: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return transaction(async (c) => {
    if (scope !== null) await c.query("SELECT set_config('app.unit_ids', $1, true)", [scope]);
    return (await c.query<T>(sql, params)).rows;
  });
}

const hitung = async (table: string, unit: number, scope: string | null = String(unit)) =>
  Number((await baca<{ n: string }>(scope,
    `SELECT count(*) AS n FROM "${table}" WHERE unit_id = $1`, [unit]))[0]!.n);

/** Identitas FISIK tiap baris: berubah bila baris ditulis ulang, sekalipun isinya sama. */
async function jejakFisik(unit: number): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of MIRROR) {
    out[t] = (await baca<{ j: string }>(String(unit),
      `SELECT ctid::text || '/' || xmin::text AS j FROM "${t}" WHERE unit_id = $1 ORDER BY 1`, [unit]))
      .map((r) => r.j);
  }
  return out;
}

const fakturDiMirror = async (unit: number) =>
  (await baca<{ k: string }>(String(unit),
    `SELECT trim(ckdtagih) AS k FROM tagihan_header WHERE unit_id = $1 ORDER BY 1`, [unit])).map((r) => r.k);
const bayarDiMirror = async (unit: number) =>
  (await baca<{ k: string }>(String(unit),
    `SELECT trim(ckdbyr) AS k FROM tagihan_bayar WHERE unit_id = $1 ORDER BY 1`, [unit])).map((r) => r.k);
const tautanDiMirror = async (unit: number) =>
  (await baca<{ k: string }>(String(unit),
    `SELECT trim(ckdtagih) || '>' || trim(ckdjualplg) AS k FROM tagihan_detail
      WHERE unit_id = $1 ORDER BY 1`, [unit])).map((r) => r.k);
const siklus = async (unit: number) =>
  (await baca<{ cycle_id: string; completed_at: string; header_count: number; bayar_count: number }>(
    String(unit),
    `SELECT cycle_id::text, completed_at::text, header_count, bayar_count
       FROM tagihan_cycle WHERE unit_id = $1`, [unit]))[0];

// ── Pembangun payload: SETIAP masukan melewati DTO yang sama dengan batas HTTP ──
const faktur = (id: string, extra: Row = {}): Row => ({
  ckdtagih: id, dtgl: "2026-01-05", dtgljt: "2026-01-05", ckdplg: "PLG-A", vcket: null,
  ntotal: 10000000, nadm: 0, ngatot: 10000000, nstatus: 0, sbatal: 0, vcalasan: null,
  nlastsaldo: 10000000, sjenistag: 1, ...extra,
});
const bayar = (id: string, tagih: string, extra: Row = {}): Row => ({
  ckdbyr: id, dtgl: "2026-01-20", ckdtagih: tagih, vcbukti: null, vcket: null,
  ctmpkas: null, ntotal: 4000000, sbatal: 0, vcalasan: null, capprovecode: null,
  cnamereq: null, ...extra,
});
const tautan = (tagih: string, ...dok: string[]): Row[] =>
  dok.map((d) => ({ ckdtagih: tagih, ckdjualplg: d }));

const potongan = (headers: Row[], details: Row[], payments: Row[]) => IngestPayload.parse({
  unit_code: "synthetic-fixture", domain: "tagihan", watermark_high: null,
  tables: { tagihan_header: headers, tagihan_detail: details, tagihan_bayar: payments },
});
const manifest = (headerKeys: string[], bayarKeys: string[], cycleId: string = randomUUID()) =>
  IngestPayload.parse({
    unit_code: "synthetic-fixture", domain: "tagihan", watermark_high: null,
    tagihan_manifest: { cycle_id: cycleId, header_keys: headerKeys, bayar_keys: bayarKeys },
    tables: {},
  });

/** Siklus acuan: tiga faktur, tautan pada dua di antaranya, dua pembayaran. */
const SIKLUS_A = () => potongan(
  [faktur("TG-1"), faktur("TG-2"), faktur("TG-3")],
  [...tautan("TG-1", "JP-1", "JP-2", "JP-3"), ...tautan("TG-2", "JP-4")],
  [bayar("BY-1", "TG-1"), bayar("BY-2", "TG-2")],
);
const MANIFEST_A = () => manifest(["TG-1", "TG-2", "TG-3"], ["BY-1", "BY-2"]);

suite("ingest domain tagihan (PostgreSQL 16)", () => {
  beforeAll(async () => {
    const target = ciTarget(process.env.SNAPSHOT_POSTGRES_CI_URL);
    // pg sudah menjadi dependensi dashboard; jangan menambah paket backend dan
    // jangan memuat modul DB dashboard (yang membaca kredensial terkonfigurasi).
    const { Client } = createRequire(new URL("../../../dashboard/package.json", import.meta.url))("pg") as {
      Client: new (options: Row) => NativeClient;
    };
    client = new Client({ ...target, ssl: false, connectionTimeoutMillis: 5_000,
      application_name: "solamax_tagihan_ingest_fixture_ci",
      options: "-c statement_timeout=20000 -c lock_timeout=5000" });
    await client.connect();
    const identity = (await client.query<{ database: string; role: string; version: number }>(
      `SELECT current_database() AS database, current_user AS role,
              current_setting('server_version_num')::int AS version`)).rows[0]!;
    expect(identity).toMatchObject({ database: CI_DATABASE, role: CI_USER });
    expect(identity.version).toBeGreaterThanOrEqual(160000);
    expect(identity.version).toBeLessThan(170000);

    await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${CI_ROLE}')
      THEN CREATE ROLE ${CI_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$;`);
    schema = `tagihan_ingest_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}" AUTHORIZATION ${CI_ROLE}`);
    // Sejak sini SEMUA pernyataan berjalan sebagai role ber-RLS, di skema sendiri.
    await client.query(`SET ROLE ${CI_ROLE}`);
    await client.query(`SET search_path TO "${schema}", pg_catalog`);
    const lokasi = (await client.query<{ s: string; r: string; su: string }>(
      `SELECT current_schema() AS s, current_user AS r, current_setting('is_superuser') AS su`)).rows[0]!;
    expect(lokasi).toEqual({ s: schema, r: CI_ROLE, su: "off" });

    // DDL migrasi SUNGGUHAN. 0001 tak berkualifikasi skema → mendarat di skema ini;
    // sisanya dipetakan dari "public". (hanya di fixture). Bagian GRANT 0013 dibuang
    // seperti di suite G/L; GRANT 0063 dibiarkan jalan — tiap role-nya dijaga IF EXISTS.
    const remap = (sql: string) => sql.replaceAll('"public".', `"${schema}".`);
    await client.query(migration("0001_init"));
    await client.query(remap(migration("0048_gl_content_revision")));
    await client.query(remap(migration("0013_recap_saldo_tables").split("-- Grant SELECT")[0]!));
    await client.query(remap(migration("0063_tagihan_mirror")));

    service = new IngestService(createIngestServiceSqlAdapter({
      transaction: (body) => transaction((c) => body({
        query: async (sql, params) => {
          const r = await c.query(sql, params);
          return { rows: r.rows as never[], rowCount: r.rowCount };
        },
      })),
    }));
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.query("ROLLBACK");
      await client.query("RESET ROLE");
      if (schema && /^tagihan_ingest_[a-f0-9]{32}$/.test(schema)) {
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await client.end();
    }
  });

  beforeEach(async () => {
    // TRUNCATE tak tunduk pada RLS (hak pemilik tabel) → bersih lintas unit.
    await client.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")}, "sync_state", "bppiut"`);
  });

  // ── U1: migrasi & RLS ─────────────────────────────────────────────────────
  it("0063: keempat tabel ENABLE + FORCE RLS dengan policy unit_scope", async () => {
    const rows = (await client.query<{ t: string; rls: boolean; force: boolean; policy: string | null }>(
      `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              (SELECT p.polname FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policy
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY 1`, [schema, [...TABLES]])).rows;
    expect(rows).toEqual([...TABLES].sort().map((t) => ({ t, rls: true, force: true, policy: "unit_scope" })));
  });

  it("🔴 RLS: tanpa app.unit_ids = nol baris; unit lain = nol baris; unit yang benar = ada baris", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());
    for (const t of TABLES) {
      // Kontrol positif DULU — tanpa ini, "nol baris" bisa berarti tabelnya kosong.
      expect(await hitung(t, U1), `${t}: kontrol positif`).toBeGreaterThan(0);
      expect(await hitung(t, U1, null), `${t}: tanpa konteks`).toBe(0);
      expect(await hitung(t, U1, ""), `${t}: konteks kosong`).toBe(0);
      expect(await hitung(t, U1, String(U2)), `${t}: konteks unit lain`).toBe(0);
      expect(await hitung(t, U1, "bukan-angka"), `${t}: konteks rusak (fail-closed)`).toBe(0);
      expect(await hitung(t, U1, `${U2},${U1}`), `${t}: konteks multi-unit`).toBeGreaterThan(0);
    }
  });

  it("🔴 RLS WITH CHECK: menulis baris unit lain ditolak walau konteks sah untuk unit sendiri", async () => {
    await expect(transaction(async (c) => {
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(U1)]);
      await c.query(`INSERT INTO tagihan_header (unit_id, ckdtagih) VALUES ($1, 'TG-ASING')`, [U2]);
    })).rejects.toThrow(/row-level security/);
    expect(await hitung("tagihan_header", U2)).toBe(0);
  });

  it("index bppiut dipakai oleh bentuk `trim(vcref) = …` (alasan memilih index ekspresi)", async () => {
    const plan = await transaction(async (c) => {
      // Tabel kosong → planner memilih seq scan; matikan untuk melihat apakah
      // index-nya DAPAT dipakai oleh predikat itu (bukan apakah ia termurah).
      await c.query("SET LOCAL enable_seqscan = off");
      await c.query("SET LOCAL enable_bitmapscan = off");
      const explain = (q: string) => c.query<{ "QUERY PLAN": string }>(`EXPLAIN ${q}`)
        .then((r) => r.rows.map((x) => x["QUERY PLAN"]).join("\n"));
      return {
        trim: await explain(`SELECT 1 FROM bppiut b WHERE b.unit_id = 1 AND trim(b.vcref) = 'JP-1'`),
        polos: await explain(`SELECT 1 FROM bppiut b WHERE b.unit_id = 1 AND b.vcref = 'JP-1'`),
      };
    });
    expect(plan.trim).toContain("bppiut_unit_id_vcref_trim_idx");
    // Kondisi atas vcref harus berada DI DALAM Index Cond (bukan Filter sesudahnya).
    expect(plan.trim).toMatch(/Index Cond: .*vcref/);
    // DAYA-BEDA + ongkos yang disebut di migrasi: bentuk TANPA trim tak terlayani
    // sebagai kondisi index.
    expect(plan.polos).not.toMatch(/Index Cond: .*vcref/);
  });

  // ── U2: perilaku ingest ───────────────────────────────────────────────────
  it("siklus pertama mendarat utuh; nilai rupiah & tanggal tersimpan apa adanya", async () => {
    await service.ingest(U1, potongan(
      [faktur("TG-1", { ntotal: 73867616.46, ngatot: 73867616.46, dtgljt: null })],
      tautan("TG-1", "JP-1"),
      [bayar("BY-1", "TG-1", { ntotal: 67.26, dtgl: null })],
    ));
    const h = (await baca<Row>(String(U1),
      `SELECT ntotal::text, ngatot::text, dtgl::text, dtgljt::text FROM tagihan_header`))[0];
    // Artefak 16-angka-penting Prisma (73867616.45999999) tak boleh muncul.
    expect(h).toEqual({ ntotal: "73867616.46", ngatot: "73867616.46", dtgl: "2026-01-05", dtgljt: null });
    const b = (await baca<Row>(String(U1), `SELECT ntotal::text, dtgl::text FROM tagihan_bayar`))[0];
    expect(b).toEqual({ ntotal: "67.26", dtgl: null });
  });

  it("siklus kedua yang IDENTIK tidak menulis apa pun di ketiga tabel", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());
    const sebelum = await jejakFisik(U1);
    expect(sebelum.tagihan_header).toHaveLength(3);
    expect(sebelum.tagihan_detail).toHaveLength(4);
    expect(sebelum.tagihan_bayar).toHaveLength(2);

    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());
    // ctid/xmin sama persis = tak ada tuple baru, bukan sekadar "isinya sama".
    expect(await jejakFisik(U1)).toEqual(sebelum);
  });

  it("kontrol: detektor 'tak menulis' memang MERAH bila sebuah baris ditulis ulang", async () => {
    await service.ingest(U1, SIKLUS_A());
    const sebelum = await jejakFisik(U1);
    await baca(String(U1), `UPDATE tagihan_header SET vcket = vcket WHERE ckdtagih = 'TG-1'`);
    expect(await jejakFisik(U1)).not.toEqual(sebelum);
  });

  it("flag status yang berubah memperbarui barisnya — dan hanya baris itu", async () => {
    await service.ingest(U1, SIKLUS_A());
    const sebelum = await jejakFisik(U1);
    await service.ingest(U1, potongan(
      [faktur("TG-1", { nstatus: 1, nlastsaldo: 0 }), faktur("TG-2"), faktur("TG-3")],
      [...tautan("TG-1", "JP-1", "JP-2", "JP-3"), ...tautan("TG-2", "JP-4")],
      [bayar("BY-1", "TG-1"), bayar("BY-2", "TG-2")],
    ));
    const rows = await baca<Row>(String(U1),
      `SELECT trim(ckdtagih) AS k, nstatus, nlastsaldo::text AS sisa FROM tagihan_header ORDER BY 1`);
    expect(rows).toEqual([
      { k: "TG-1", nstatus: 1, sisa: "0" },
      { k: "TG-2", nstatus: 0, sisa: "10000000" },
      { k: "TG-3", nstatus: 0, sisa: "10000000" },
    ]);
    const sesudah = await jejakFisik(U1);
    expect(sesudah.tagihan_header!.filter((j) => !sebelum.tagihan_header!.includes(j))).toHaveLength(1);
    expect(sesudah.tagihan_detail).toEqual(sebelum.tagihan_detail);
    expect(sesudah.tagihan_bayar).toEqual(sebelum.tagihan_bayar);
  });

  it("pembayaran yang dibatalkan (sbatal 0→1) mendarat; NULL→nilai juga", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, potongan([faktur("TG-1")], tautan("TG-1", "JP-1", "JP-2", "JP-3"),
      [bayar("BY-1", "TG-1", { sbatal: 1, vcalasan: "salah input" })]));
    expect(await baca<Row>(String(U1),
      `SELECT sbatal, vcalasan FROM tagihan_bayar WHERE ckdbyr = 'BY-1'`))
      .toEqual([{ sbatal: 1, vcalasan: "salah input" }]);
  });

  it("faktur yang tautannya menyusut berakhir dengan himpunan yang lebih kecil", async () => {
    await service.ingest(U1, SIKLUS_A());
    expect(await tautanDiMirror(U1)).toEqual(["TG-1>JP-1", "TG-1>JP-2", "TG-1>JP-3", "TG-2>JP-4"]);

    // Hanya TG-1 di payload: tautannya menyusut 3 → 1 (+1 baru). TG-2 tak di payload.
    await service.ingest(U1, potongan([faktur("TG-1")], tautan("TG-1", "JP-2", "JP-9"), []));
    expect(await tautanDiMirror(U1)).toEqual(["TG-1>JP-2", "TG-1>JP-9", "TG-2>JP-4"]);

    // Faktur yang tautannya kini NOL di sumber kehilangan semuanya.
    await service.ingest(U1, potongan([faktur("TG-1")], [], []));
    expect(await tautanDiMirror(U1)).toEqual(["TG-2>JP-4"]);
  });

  it("baris yang tak ada di manifest dihapus — header, pembayaran, dan tautan fakturnya", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());

    // Siklus berikutnya: TG-2 dan BY-2 sudah dihapus di sumber.
    await service.ingest(U1, potongan(
      [faktur("TG-1"), faktur("TG-3")], tautan("TG-1", "JP-1", "JP-2", "JP-3"), [bayar("BY-1", "TG-1")],
    ));
    await service.ingest(U1, manifest(["TG-1", "TG-3"], ["BY-1"]));

    expect(await fakturDiMirror(U1)).toEqual(["TG-1", "TG-3"]);
    expect(await bayarDiMirror(U1)).toEqual(["BY-1"]);
    expect(await tautanDiMirror(U1)).toEqual(["TG-1>JP-1", "TG-1>JP-2", "TG-1>JP-3"]);
  });

  it("🔴 TANPA manifest tak ada yang dihapus, berapa pun potongan yang datang", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());

    // Siklus yang putus di tengah: hanya satu faktur terkirim, manifest tak pernah datang.
    await service.ingest(U1, potongan([faktur("TG-1")], tautan("TG-1", "JP-1", "JP-2", "JP-3"), []));
    await service.ingest(U1, potongan([faktur("TG-1")], tautan("TG-1", "JP-1", "JP-2", "JP-3"), []));

    expect(await fakturDiMirror(U1)).toEqual(["TG-1", "TG-2", "TG-3"]);
    expect(await bayarDiMirror(U1)).toEqual(["BY-1", "BY-2"]);
    expect(await tautanDiMirror(U1)).toEqual(["TG-1>JP-1", "TG-1>JP-2", "TG-1>JP-3", "TG-2>JP-4"]);
  });

  it("🔴 manifest satu unit tak pernah menyentuh unit lain", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());
    await service.ingest(U2, SIKLUS_A()); // kunci SAMA di unit lain — kasus terburuk
    await service.ingest(U2, MANIFEST_A());
    const u2Sebelum = await jejakFisik(U2);
    const u2Siklus = await siklus(U2);

    // Unit 1 menyatakan sumbernya kosong → seluruh barisnya terhapus.
    await service.ingest(U1, manifest([], []));

    for (const t of MIRROR) expect(await hitung(t, U1), `${t} unit 1`).toBe(0);
    expect(await jejakFisik(U2)).toEqual(u2Sebelum);
    expect(await siklus(U2)).toEqual(u2Siklus);
    expect(await siklus(U1)).toMatchObject({ header_count: 0, bayar_count: 0 });
  });

  it("waktu siklus-lengkap bergerak HANYA oleh manifest", async () => {
    expect(await siklus(U1)).toBeUndefined();
    await service.ingest(U1, SIKLUS_A());
    // Potongan saja: sync_state maju, tetapi siklus-lengkap belum ada.
    expect(await siklus(U1)).toBeUndefined();
    expect((await client.query(`SELECT 1 FROM sync_state WHERE unit_id = $1 AND domain = 'tagihan'`, [U1])).rowCount).toBe(1);

    const idA = randomUUID();
    await service.ingest(U1, manifest(["TG-1", "TG-2", "TG-3"], ["BY-1", "BY-2"], idA));
    const a = await siklus(U1);
    expect(a).toMatchObject({ cycle_id: idA, header_count: 3, bayar_count: 2 });

    await service.ingest(U1, SIKLUS_A());
    expect(await siklus(U1)).toEqual(a); // potongan berikutnya tak menggesernya

    const idB = randomUUID();
    await service.ingest(U1, manifest(["TG-1", "TG-2", "TG-3"], ["BY-1", "BY-2"], idB));
    const b = await siklus(U1);
    expect(b!.cycle_id).toBe(idB);
    expect(Date.parse(b!.completed_at)).toBeGreaterThan(Date.parse(a!.completed_at));
    expect(await hitung("tagihan_cycle", U1)).toBe(1); // satu baris per unit
  });

  it("manifest yang menyebut kunci yang tak pernah tiba TIDAK menggagalkan transaksi", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, manifest(
      ["TG-1", "TG-2", "TG-3", "TG-TAK-PERNAH-TIBA"], ["BY-1", "BY-2", "BY-TAK-PERNAH-TIBA"],
    ));
    expect(await fakturDiMirror(U1)).toEqual(["TG-1", "TG-2", "TG-3"]);
    expect(await bayarDiMirror(U1)).toEqual(["BY-1", "BY-2"]);
    expect(await siklus(U1)).toMatchObject({ header_count: 4, bayar_count: 3 });
  });

  it("tautan yatim (fakturnya tak pernah ada di mirror) ikut hilang saat siklus lengkap", async () => {
    await service.ingest(U1, SIKLUS_A());
    // Ditanam langsung: keadaan yang tak bisa dihasilkan payload sah, tetapi bisa
    // tertinggal dari versi lama / perbaikan tangan.
    await baca(String(U1),
      `INSERT INTO tagihan_detail (unit_id, ckdtagih, ckdjualplg) VALUES ($1, 'TG-HANTU', 'JP-7')`, [U1]);
    await service.ingest(U1, MANIFEST_A());
    expect(await tautanDiMirror(U1)).toEqual(["TG-1>JP-1", "TG-1>JP-2", "TG-1>JP-3", "TG-2>JP-4"]);
  });

  it("pangkas gagal di tengah → SELURUH transaksi batal: tak ada yang terhapus, stempel tak bergerak", async () => {
    await service.ingest(U1, SIKLUS_A());
    await service.ingest(U1, MANIFEST_A());
    const sebelum = await jejakFisik(U1);
    const siklusSebelum = await siklus(U1);
    // cycle_id yang lolos skema tetapi ditolak Postgres hanya bisa dibuat dengan
    // melewati DTO — itu disengaja: yang diuji adalah atomisitas, bukan validasi.
    const rusak = { ...manifest(["TG-1"], []), tagihan_manifest: {
      cycle_id: "bukan-uuid", header_keys: ["TG-1"], bayar_keys: [] } } as IngestPayload;
    await expect(service.ingest(U1, rusak)).rejects.toThrow();
    expect(await jejakFisik(U1)).toEqual(sebelum);
    expect(await siklus(U1)).toEqual(siklusSebelum);
  });
});
