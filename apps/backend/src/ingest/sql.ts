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
  dtgljam: "timestamptz",
  perk_map: "jsonb",
};

/**
 * Builder bulk-UPSERT terparam:
 *   INSERT INTO t (unit_id, c1, c2, …) VALUES ($1,$2,…),(…) …
 *   ON CONFLICT (unit_id, k1, …) DO UPDATE SET c2 = EXCLUDED.c2, …
 * Satu statement per tabel per batch (1000 baris × ~16 kolom jauh di bawah
 * limit 65.535 parameter Postgres). Identifier dari TABLE_CONFIG (konstanta);
 * nilai SELALU lewat parameter — tak ada interpolasi nilai ke SQL.
 */
export function buildUpsert(
  cfg: TableConfig,
  unitId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): { sql: string; params: unknown[] } {
  if (rows.length === 0) throw new Error("buildUpsert: rows kosong");

  const cols = ["unit_id", ...cfg.columns];
  const params: unknown[] = [];
  const tuples: string[] = [];

  for (const row of rows) {
    const ph: string[] = [];
    params.push(unitId);
    ph.push(`$${params.length}`);
    for (const c of cfg.columns) {
      let v = row[c] ?? null;
      // jsonb (mis. product.perk_map): kirim sebagai string JSON.
      if (v !== null && typeof v === "object") v = JSON.stringify(v);
      params.push(v);
      const cast = COLUMN_CAST[c];
      ph.push(cast ? `$${params.length}::${cast}` : `$${params.length}`);
    }
    tuples.push(`(${ph.join(",")})`);
  }

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
