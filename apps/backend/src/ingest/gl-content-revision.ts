import type { TableConfig } from "./table-config.js";

/** Actual query dependencies, not payload.domain: table/domain membership is
 * intentionally not enforced by the existing ingest contract. */
const GL_TABLES = new Set([
  "sales_header", "sales_detail", "opname", "delivery", "terra_resmi", "product",
]);

export const contributesToGl = (table: string): boolean => GL_TABLES.has(table);

/** Reuse the established null-safe comparison of every stored source column.
 * Keep ingested_at out of that comparison; heartbeat lives in sync_state. */
export function glContentConfig(cfg: TableConfig): TableConfig {
  return contributesToGl(cfg.table) ? { ...cfg, skipUnchanged: true } : cfg;
}

/** Replacement retains exactly the old DELETE-window + UPSERT-all business
 * values, but does not delete/reinsert unchanged keys merely to discover that
 * nothing changed. Keys deliberately use the real schema's comparison types:
 * delivery CHAR ignores padding; terra VARCHAR preserves significant spaces.
 * Empty payloads still delete the complete window; rows outside it still upsert.
 */
export function buildGlWindowPrune(
  domain: "delivery" | "terra_resmi",
  unitId: number,
  window: { from: string; to: string },
  rows: ReadonlyArray<Record<string, unknown>>,
): { sql: string; params: unknown[] } {
  if (domain === "delivery") {
    return {
      sql: `DELETE FROM "delivery" t WHERE t."unit_id" = $1
        AND t."dtgltrm" >= $2::date AND t."dtgltrm" < $3::date
        AND NOT EXISTS (SELECT 1 FROM unnest($4::bpchar[]) AS k(id)
                        WHERE k.id = t."ckdtrm")`,
      params: [unitId, window.from, window.to, rows.map(r => r.ckdtrm)],
    };
  }
  return {
    sql: `DELETE FROM "terra_resmi" t WHERE t."unit_id" = $1
      AND t."business_date" >= $2::date AND t."business_date" < $3::date
      AND NOT EXISTS (SELECT 1 FROM unnest($4::varchar(15)[], $5::varchar(5)[]) AS k(id, nozzle)
                      WHERE k.id = t."ckdterra" AND k.nozzle = t."ckdnozzle")`,
    params: [unitId, window.from, window.to,
      rows.map(r => r.ckdterra), rows.map(r => r.ckdnozzle)],
  };
}

/** $5 is true only for an affected INSERT/UPDATE/DELETE on a G/L input table.
 * The counter and handshake commit with the mirror. An old backend updates
 * last_run_at without the handshake; the next new writer must advance even on
 * a no-op, preventing A -> old-writer B -> new no-op B from reusing A's token.
 * Health/watermark/accepted-row-count behavior remains unchanged.
 */
export const UPDATE_SYNC_STATE_WITH_GL_REVISION_SQL = `
  INSERT INTO "sync_state"
    ("unit_id","domain","last_watermark","last_run_at","last_row_count",
     "gl_revision","gl_revision_run_at")
  VALUES ($1,$2,$3::timestamptz,now(),$4,CASE WHEN $5::boolean THEN 1 ELSE 0 END,now())
  ON CONFLICT ("unit_id","domain") DO UPDATE SET
    "last_watermark" = GREATEST(COALESCE(EXCLUDED."last_watermark", "sync_state"."last_watermark"), COALESCE("sync_state"."last_watermark", EXCLUDED."last_watermark")),
    "last_run_at" = now(),
    "last_row_count" = EXCLUDED."last_row_count",
    "gl_revision" = COALESCE("sync_state"."gl_revision",0) +
      CASE WHEN $5::boolean OR "sync_state"."gl_revision" IS NULL
        OR "sync_state"."gl_revision_run_at" IS NULL
        OR "sync_state"."gl_revision_run_at" IS DISTINCT FROM "sync_state"."last_run_at"
      THEN 1 ELSE 0 END,
    "gl_revision_run_at" = now()`;
