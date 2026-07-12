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
  business_date: "date",
  dtgljam: "timestamptz",
  dtanggaljam: "timestamptz",
  tanggaljam: "timestamptz",
  perk_map: "jsonb",
};

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
      params.push(v);
      const cast = COLUMN_CAST[c];
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
      ? `DO UPDATE SET ${setClauses.join(", ")}`
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
 * (tebus/delivery) — dijalankan SEBELUM UPSERT baris payload dalam transaksi
 * yang sama, sehingga mirror = snapshot sumber per jendela: baris yang DIHAPUS
 * atau di-RENUMBER di EasyMax ikut hilang dari mirror (UPSERT saja tak pernah
 * membersihkan — akar phantom Sisa DO Bakau 2026-07-12). `tebus_detail` tak
 * punya kolom tanggal → dihapus via join header SEBELUM header-nya. Identifier
 * konstanta; nilai via parameter. RLS `unit_scope` tetap membatasi ke unit GUC.
 */
export function buildReplaceWindowDeletes(
  domain: "tebus" | "delivery",
  unitId: number,
  window: { from: string; to: string },
): Array<{ sql: string; params: unknown[] }> {
  const params = [unitId, window.from, window.to] as unknown[];
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
