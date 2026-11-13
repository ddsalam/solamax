import type { TableConfig } from "./table-config.js";

/**
 * Cast eksplisit per kolom. Prisma mengirim string JS sebagai parameter
 * bertipe `text`; Postgres TIDAK meng-coerce text→date/timestamptz/jsonb
 * secara implisit (error 42804) — ditemukan saat E2E staging 2026-06-11.
 */
const COLUMN_CAST: Record<string, string> = {
  dtgljual: "date",
  dtgl: "date",
  dtaglopn: "date",
  dtgltrm: "date",
  dtgltbs: "date",
  dtgljt: "date",
  business_date: "date",
  dtgljam: "timestamptz",
  dtanggaljam: "timestamptz",
  tanggaljam: "timestamptz",
  perk_map: "jsonb",
};

/**
 * Kolom `numeric` mirror (skema Prisma `@db.Decimal`) — nilainya dikirim sebagai
 * **string** + cast `::numeric`, TIDAK sebagai JS `number`.
 *
 * Sebabnya (dibuktikan 2026-08-06, bukan penalaran): Prisma merender parameter
 * JS `number` ke **16 angka penting**, bukan shortest-roundtrip. Untuk nilai yang
 * galat double-nya melewati setengah-ulp di angka ke-16, yang mendarat di Postgres
 * bukan lagi desimal aslinya:
 *
 *     73867616.46     → 73867616.45999999    (bppiut PP2022100101473, unit 1)
 *     67.26           → 67.26000000000001    (pola sales_detail.nvolume)
 *     99213863301.15  → 99213863301.14999    (pola cash_header.ntotal)
 *
 * Sapuan mirror menemukan ±243.800 sel semacam ini di 7 unit (deviasi total
 * 0,0000746 — tak material, tapi kotor & terus diproduksi tiap sync).
 * Bukan Postgres (`73867616.46::float8::numeric` bersih) dan bukan `num()` di
 * agent (`JSON.stringify` shortest-roundtrip). `String(v)` memakai
 * shortest-roundtrip → memulihkan desimal sumber apa adanya.
 *
 * Berkunci NAMA kolom seperti COLUMN_CAST; diverifikasi lawan `information_schema`:
 * 0 nama kolom yang numeric di satu tabel tapi bertipe lain di tabel lain.
 * Detail: `session-notes/2026-08-06-artefak-float-numeric-ingest.md`.
 */
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  "nstandawal", "nstandakhir", "nvolume", "nhargajual", "nsubtotal",
  "ntotal", "njumlah", "nsaldo", "nharga", "nhrgjual",
  "nadm", "ngatot", "nlastsaldo",
  "nstockbk", "nstockop", "nvolselisih", "nvoldo", "nvolreal",
  "liter", "total",
  "nkapasitas", "ntinggi", "nsuhu", "ntinggiair", "nvolumeair",
]);

/** Bangun klausa VALUES terparam (unit_id + kolom cfg) + daftar params. */
function buildValues(
  cfg: TableConfig,
  unitId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): { cols: string[]; tuples: string[]; params: unknown[] } {
  const cols = ["unit_id", ...cfg.columns];
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const row of rows) {
    const ph: string[] = [];
    params.push(unitId);
    ph.push(`$${params.length}`);
    for (const c of cfg.columns) {
      let v = row[c] ?? null;
      if (v !== null && typeof v === "object") v = JSON.stringify(v);
      const cast = COLUMN_CAST[c] ?? (NUMERIC_COLUMNS.has(c) ? "numeric" : undefined);
      // Kolom numeric: kirim teks (shortest-roundtrip) — lihat NUMERIC_COLUMNS.
      if (cast === "numeric" && typeof v === "number") v = String(v);
      params.push(v);
      ph.push(cast ? `$${params.length}::${cast}` : `$${params.length}`);
    }
    tuples.push(`(${ph.join(",")})`);
  }
  return { cols, tuples, params };
}

/**
 * Builder bulk-UPSERT terparam:
 *   INSERT INTO t (unit_id, c1, c2, …) VALUES ($1,$2,…),(…) …
 *   ON CONFLICT (unit_id, k1, …) DO UPDATE SET c2 = EXCLUDED.c2, …
 * Satu statement per tabel per batch (1000 baris × ~16 kolom jauh di bawah
 * limit 65.535 parameter Postgres). Identifier dari TABLE_CONFIG (konstanta);
 * nilai SELALU lewat parameter — tak ada interpolasi nilai ke SQL.
 */
/**
 * Runtuhkan baris ber-conflict-key sama dalam satu batch → maksimal satu baris per
 * natural-key. Mencegah Postgres 21000 ("ON CONFLICT … cannot affect row a second
 * time") saat sumber punya >1 baris per natural-key dalam satu payload. Berlaku
 * untuk SETIAP tabel ber-`conflict` (upsert maupun replace-per-business_date/edc).
 * - `sumOnConflict` di-set (mis. tr_dtebus produk sama beberapa baris per DO):
 *   jumlahkan kolom itu, pertahankan nilai pertama untuk kolom lain.
 * - selain itu (mis. edc): **keep-last** — baris terakhir menang, persis semantik
 *   `ON CONFLICT DO UPDATE SET … = EXCLUDED`. Aman: hanya menelan kembar sejati
 *   (natural-key sudah terverifikasi unik per transaksi; probe edc 0 tabrakan).
 */
function collapseByConflict(
  cfg: TableConfig,
  rows: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  if (cfg.conflict.length === 0) return rows;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = JSON.stringify(cfg.conflict.map((c) => row[c] ?? null));
    const ex = byKey.get(key);
    if (!ex) {
      byKey.set(key, { ...row });
      continue;
    }
    if (cfg.sumOnConflict && cfg.sumOnConflict.length > 0) {
      for (const sc of cfg.sumOnConflict) {
        ex[sc] = Number(ex[sc] ?? 0) + Number(row[sc] ?? 0);
      }
    } else {
      byKey.set(key, { ...row }); // keep-last (= EXCLUDED)
    }
  }
  return [...byKey.values()];
}

/**
 * Klausa `WHERE` untuk `DO UPDATE` pada tabel ber-`skipUnchanged`: hanya tulis
 * ulang baris yang benar-benar berubah.
 *
 * `IS DISTINCT FROM` (bukan `<>`) karena hampir semua kolom mirror NULLABLE:
 * `NULL <> NULL` menghasilkan NULL → WHERE tak pernah benar → baris ber-NULL
 * BERHENTI diperbarui selamanya. `IS DISTINCT FROM` memperlakukan NULL sebagai
 * nilai yang bisa dibandingkan, jadi NULL→nilai, nilai→NULL, dan NULL→NULL
 * semuanya terputuskan benar.
 *
 * Bentuk row-wise `(a, b) IS DISTINCT FROM (c, d)` dipakai supaya predikatnya
 * DITURUNKAN dari daftar kolom yang sama dengan `SET` — bukan daftar kedua yang
 * bisa menyimpang diam-diam. Kolom yang terlewat = perubahan nyata berhenti
 * mendarat, dan itu kegagalan SENYAP; `sql.test.ts` mengunci kesamaan kedua
 * daftar itu.
 *
 * `ingested_at` sengaja di luar predikat: ia selalu `now()`, jadi menyertakannya
 * membuat setiap baris selalu "berbeda" dan meniadakan seluruh mekanismenya.
 */
export function skipUnchangedClause(
  cfg: TableConfig,
  updateCols: readonly string[],
): string {
  if (!cfg.skipUnchanged || updateCols.length === 0) return "";
  const lhs = updateCols.map((c) => `"${cfg.table}"."${c}"`).join(", ");
  const rhs = updateCols.map((c) => `EXCLUDED."${c}"`).join(", ");
  return ` WHERE (${lhs}) IS DISTINCT FROM (${rhs})`;
}

export function buildUpsert(
  cfg: TableConfig,
  unitId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): { sql: string; params: unknown[] } {
  if (rows.length === 0) throw new Error("buildUpsert: rows kosong");

  const { cols, tuples, params } = buildValues(cfg, unitId, collapseByConflict(cfg, rows));

  const conflictCols = ["unit_id", ...cfg.conflict];
  const updateCols = cfg.columns.filter((c) => !cfg.conflict.includes(c));
  const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`);
  if (cfg.hasIngestedAt) setClauses.push(`"ingested_at" = now()`);

  const sql =
    `INSERT INTO "${cfg.table}" (${cols.map((c) => `"${c}"`).join(",")}) ` +
    `VALUES ${tuples.join(",")} ` +
    `ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(",")}) ` +
    (setClauses.length > 0
      ? `DO UPDATE SET ${setClauses.join(", ")}${skipUnchangedClause(cfg, updateCols)}`
      : `DO NOTHING`);

  return { sql, params };
}

/**
 * REPLACE per (unit_id, business_date) — utk tabel surrogate-id tanpa PK baris
 * bersih (edc/pelanggan_sale/voucher_sale; tr_edc tanpa SBATAL). Dua statement:
 *   1) DELETE baris (unit_id, business_date ∈ payload)  2) INSERT semua baris.
 * Dijalankan berurutan dalam transaksi /ingest → idempoten & menangkap koreksi
 * tanpa collapse. Agent WAJIB kirim satu business_date utuh per payload.
 *
 * Bila `cfg.conflict` diisi (edc), INSERT memakai ON CONFLICT (unit_id, …conflict)
 * DO UPDATE. Tanpa ini, DUA /ingest tumpang-tindih utk business_date yang belum
 * berisi tetap menggandakan: masing-masing DELETE tak melihat baris uncommitted
 * lawan, lalu keduanya INSERT (insiden 2026-06-22). Dengan kunci unik, INSERT
 * kedua memblok pada baris lawan lalu DO UPDATE → 0 baris kembar, tetap idempoten.
 * Butuh index unik fisik pada kolom yang sama (migrasi 0012, NULLS NOT DISTINCT).
 */
export function buildReplace(
  cfg: TableConfig,
  unitId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<{ sql: string; params: unknown[] }> {
  if (rows.length === 0) throw new Error("buildReplace: rows kosong");

  const dates = [...new Set(rows.map((r) => r["business_date"] as string))];
  const del = {
    sql: `DELETE FROM "${cfg.table}" WHERE "unit_id" = $1 AND "business_date" = ANY($2::date[])`,
    params: [unitId, dates] as unknown[],
  };

  // Runtuhkan kembar intra-batch per natural-key (edc dsb.) → hindari 21000 pada
  // INSERT … ON CONFLICT. DELETE tetap pakai `dates` dari rows asli (di atas).
  const { cols, tuples, params } = buildValues(cfg, unitId, collapseByConflict(cfg, rows));

  // ON CONFLICT opsional: jaring anti-kembar saat REPLACE bersamaan. Kolom non-key
  // di-refresh (DO UPDATE); bila tak ada kolom non-key, DO NOTHING.
  let onConflict = "";
  if (cfg.conflict.length > 0) {
    const conflictCols = ["unit_id", ...cfg.conflict];
    const updateCols = cfg.columns.filter((c) => !cfg.conflict.includes(c));
    const setClauses = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`);
    if (cfg.hasIngestedAt) setClauses.push(`"ingested_at" = now()`);
    onConflict =
      ` ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(",")}) ` +
      (setClauses.length > 0
        ? `DO UPDATE SET ${setClauses.join(", ")}`
        : `DO NOTHING`);
  }

  const ins = {
    sql:
      `INSERT INTO "${cfg.table}" (${cols.map((c) => `"${c}"`).join(",")}) ` +
      `VALUES ${tuples.join(",")}` +
      onConflict,
    params,
  };

  return [del, ins];
}

/**
 * DELETE jendela tanggal-bisnis [from, to) untuk domain `replace_window`
 * (tebus/delivery/terra_resmi) — dijalankan SEBELUM UPSERT baris payload dalam transaksi
 * yang sama, sehingga mirror = snapshot sumber per jendela: baris yang DIHAPUS
 * atau di-RENUMBER di EasyMax ikut hilang dari mirror (UPSERT saja tak pernah
 * membersihkan — akar phantom Sisa DO Bakau 2026-07-12). `tebus_detail` tak
 * punya kolom tanggal → dihapus via join header SEBELUM header-nya. Identifier
 * konstanta; nilai via parameter. RLS `unit_scope` tetap membatasi ke unit GUC.
 */
/**
 * Pangkas `sales_detail` basi untuk header yang detailnya dibawa LENGKAP oleh
 * payload `replace_details` (rescan per tanggal-bisnis). Hapus baris mirror milik
 * header-header itu yang `(ckdnozzle, nurut)`-nya tak ada di payload.
 *
 * Cakupan per HEADER, bukan per jendela: himpunan header diambil dari baris
 * DETAIL payload (bukan dari sales_header), jadi header tanpa detail di payload —
 * termasuk sumber kosong — tak pernah tersentuh. Perbandingan `bpchar` mengabaikan
 * spasi pengisi kolom `character(n)`.
 */
export function buildSalesDetailPrune(
  unitId: number,
  details: Record<string, unknown>[],
): { sql: string; params: unknown[] } | null {
  const headers = [...new Set(details.map((r) => String(r["ckdjualbbm"])))];
  if (headers.length === 0) return null;
  return {
    sql:
      `DELETE FROM "sales_detail" d WHERE d."unit_id" = $1 ` +
      `AND d."ckdjualbbm" = ANY($2::bpchar[]) ` +
      `AND NOT EXISTS (SELECT 1 FROM unnest($3::bpchar[], $4::bpchar[], $5::int[]) AS k(j, n, u) ` +
      `WHERE k.j = d."ckdjualbbm" AND k.n = d."ckdnozzle" AND k.u = d."nurut")`,
    params: [
      unitId,
      headers,
      details.map((r) => String(r["ckdjualbbm"])),
      details.map((r) => String(r["ckdnozzle"])),
      details.map((r) => Number(r["nurut"])),
    ],
  };
}

export function buildReplaceWindowDeletes(
  domain: "tebus" | "delivery" | "terra_resmi",
  unitId: number,
  window: { from: string; to: string },
): Array<{ sql: string; params: unknown[] }> {
  const params = [unitId, window.from, window.to] as unknown[];
  // terra_resmi: kolom tanggal-bisnis langsung, kasus paling sederhana. Tanpa ini
  // penghapusan sesi tera di POS jadi baris yatim ABADI (3 kejadian produksi 2026).
  if (domain === "terra_resmi") {
    return [
      {
        sql:
          `DELETE FROM "terra_resmi" WHERE "unit_id" = $1 ` +
          `AND "business_date" >= $2::date AND "business_date" < $3::date`,
        params,
      },
    ];
  }
  if (domain === "delivery") {
    return [
      {
        sql: `DELETE FROM "delivery" WHERE "unit_id" = $1 AND "dtgltrm" >= $2::date AND "dtgltrm" < $3::date`,
        params,
      },
    ];
  }
  return [
    {
      sql:
        `DELETE FROM "tebus_detail" td USING "tebus_header" th ` +
        `WHERE td."unit_id" = $1 AND th."unit_id" = $1 AND th."ckdtbs" = td."ckdtbs" ` +
        `AND th."dtgltbs" >= $2::date AND th."dtgltbs" < $3::date`,
      params,
    },
    {
      sql: `DELETE FROM "tebus_header" WHERE "unit_id" = $1 AND "dtgltbs" >= $2::date AND "dtgltbs" < $3::date`,
      params,
    },
  ];
}

/**
 * Ganti tautan faktur PER FAKTUR (domain `tagihan`): hapus baris `tagihan_detail`
 * milik faktur-faktur payload yang pasangan `(ckdtagih, ckdjualplg)`-nya tak ada
 * lagi di payload. Tautan yang masih ada tidak disentuh (INSERT-nya DO NOTHING),
 * jadi siklus tanpa perubahan tak menulis apa pun.
 *
 * Cakupan diambil dari HEADER payload, bukan dari baris tautannya: faktur yang
 * tautannya kini NOL di sumber tetap harus kehilangan tautan lamanya. Faktur yang
 * tak ada di payload tak pernah tersentuh — agent memotong per faktur, jadi
 * tautan sebuah faktur selalu sepayload dengan header-nya (ditegakkan skema
 * @solamax/shared). Perbandingan `bpchar` mengabaikan spasi pengisi.
 */
export function buildTagihanDetailPrune(
  unitId: number,
  headers: ReadonlyArray<Record<string, unknown>>,
  details: ReadonlyArray<Record<string, unknown>>,
): { sql: string; params: unknown[] } | null {
  const invoices = [...new Set(headers.map((r) => String(r["ckdtagih"])))];
  if (invoices.length === 0) return null;
  return {
    sql:
      `DELETE FROM "tagihan_detail" d WHERE d."unit_id" = $1 ` +
      `AND d."ckdtagih" = ANY($2::bpchar[]) ` +
      `AND NOT EXISTS (SELECT 1 FROM unnest($3::bpchar[], $4::bpchar[]) AS k(t, j) ` +
      `WHERE k.t = d."ckdtagih" AND k.j = d."ckdjualplg")`,
    params: [
      unitId,
      invoices,
      details.map((r) => String(r["ckdtagih"])),
      details.map((r) => String(r["ckdjualplg"])),
    ],
  };
}

/**
 * Pangkas-saat-lengkap domain `tagihan` — HANYA untuk payload ber-`tagihan_manifest`.
 * Empat statement, dijalankan berurutan dalam transaksi /ingest di bawah kunci
 * per-unit:
 *   1) hapus pembayaran yang kuncinya tak ada di manifest;
 *   2) hapus header yang kuncinya tak ada di manifest;
 *   3) hapus tautan yang fakturnya tak ada lagi di mirror (sesudah langkah 2 —
 *      jadi tak ada tautan yatim sesudah siklus lengkap);
 *   4) stempel siklus lengkap unit itu (`tagihan_cycle`).
 *
 * Fungsi ini HANYA membangun SQL; ia tak menjaga apa pun. Penjaganya
 * (daftar kosong pada mirror berisi, manifest basi, jumlah mirror ≠ jumlah
 * kunci) ada di `IngestService.applyTagihanManifest`, yang menjalankan tiga
 * DELETE ini, menguji jumlahnya, baru menstempel — dan membatalkan seluruh
 * transaksi bila ditolak. Jangan menjalankan statement ini di luar jalur itu.
 *
 * Setiap statement membawa `"unit_id" = $1` SENDIRI; RLS `unit_scope` (GUC
 * `app.unit_ids` yang di-set di awal transaksi) adalah jaring kedua, bukan
 * satu-satunya pembatas.
 */
export function buildTagihanManifestPrune(
  unitId: number,
  manifest: {
    cycle_id: string;
    header_keys: readonly string[];
    bayar_keys: readonly string[];
  },
): Array<{ sql: string; params: unknown[] }> {
  return [
    {
      sql:
        `DELETE FROM "tagihan_bayar" b WHERE b."unit_id" = $1 ` +
        `AND NOT EXISTS (SELECT 1 FROM unnest($2::bpchar[]) AS k(id) WHERE k.id = b."ckdbyr")`,
      params: [unitId, [...manifest.bayar_keys]],
    },
    {
      sql:
        `DELETE FROM "tagihan_header" h WHERE h."unit_id" = $1 ` +
        `AND NOT EXISTS (SELECT 1 FROM unnest($2::bpchar[]) AS k(id) WHERE k.id = h."ckdtagih")`,
      params: [unitId, [...manifest.header_keys]],
    },
    {
      sql:
        `DELETE FROM "tagihan_detail" d WHERE d."unit_id" = $1 ` +
        `AND NOT EXISTS (SELECT 1 FROM "tagihan_header" h ` +
        `WHERE h."unit_id" = d."unit_id" AND h."ckdtagih" = d."ckdtagih")`,
      params: [unitId],
    },
    {
      sql:
        `INSERT INTO "tagihan_cycle" ("unit_id","cycle_id","completed_at","header_count","bayar_count") ` +
        `VALUES ($1,$2::uuid,now(),$3,$4) ` +
        `ON CONFLICT ("unit_id") DO UPDATE SET "cycle_id" = EXCLUDED."cycle_id", ` +
        `"completed_at" = EXCLUDED."completed_at", "header_count" = EXCLUDED."header_count", ` +
        `"bayar_count" = EXCLUDED."bayar_count"`,
      params: [unitId, manifest.cycle_id, manifest.header_keys.length, manifest.bayar_keys.length],
    },
  ];
}

/**
 * Keadaan unit SEBELUM pangkas-manifest (satu baris, selalu ada):
 * `ada_header` — mirror masih berisi faktur; `stamped` — cycle_id yang terakhir
 * distempel; `token` — lihat TAGIHAN_TOKEN_SQL.
 */
export const TAGIHAN_MANIFEST_STATE_SQL =
  `SELECT EXISTS (SELECT 1 FROM "tagihan_header" h WHERE h."unit_id" = $1) AS "ada_header", ` +
  `(SELECT c."cycle_id"::text FROM "tagihan_cycle" c WHERE c."unit_id" = $1) AS "stamped", ` +
  `(SELECT s.xmin::text || ':' || to_char(s."last_run_at" AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US') ` +
  `FROM "sync_state" s WHERE s."unit_id" = $1 AND s."domain" = 'tagihan') AS "token"`;

/** Jumlah header & pembayaran unit di mirror (dibaca SESUDAH pangkas). */
export const TAGIHAN_MANIFEST_COUNT_SQL =
  `SELECT (SELECT count(*) FROM "tagihan_header" h WHERE h."unit_id" = $1)::int AS "header", ` +
  `(SELECT count(*) FROM "tagihan_bayar" b WHERE b."unit_id" = $1)::int AS "bayar"`;

/**
 * Token "payload tagihan terakhir untuk unit ini" = identitas penulisan baris
 * `sync_state(unit, 'tagihan')`: `xmin` (transaksi penulisnya) + `last_run_at`.
 * Setiap payload domain tagihan yang ter-commit menulis ulang baris itu, jadi
 * tokennya berubah — TANPA kolom atau tabel baru. Nilainya buram bagi agent:
 * hanya dibandingkan sama/tidak, tak pernah diurutkan.
 */
export const TAGIHAN_TOKEN_SQL =
  `SELECT s.xmin::text || ':' || to_char(s."last_run_at" AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US') AS "token" ` +
  `FROM "sync_state" s WHERE s."unit_id" = $1 AND s."domain" = 'tagihan'`;
