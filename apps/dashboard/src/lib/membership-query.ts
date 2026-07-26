import type { Role } from "./auth-context";
import type { Assignment } from "./scope-rule";

/**
 * SQL penugasan aktif — dipisah dari `auth-context.ts` (yang meng-import `@/auth`)
 * supaya bisa dijalankan langsung oleh tes DB-live TANPA menarik Auth.js.
 * Tes memakai query yang SAMA PERSIS dengan produksi, bukan salinannya.
 *
 * Dibaca pada SETIAP request: itulah yang membuat pencabutan akses berlaku seketika
 * pada request berikutnya, tanpa logout (dibuktikan T-REV).
 */
export const ACTIVE_MEMBERSHIPS_SQL = `
  SELECT m.id, m.tenant_id, m.role, m.all_units,
         COALESCE(
           array_agg(uu.unit_id) FILTER (WHERE uu.unit_id IS NOT NULL), '{}'
         ) AS unit_ids
    FROM app.membership m
    LEFT JOIN app.user_unit uu ON uu.membership_id = m.id
   WHERE m.user_id = $1 AND m.status = 'active'
   GROUP BY m.id, m.tenant_id, m.role, m.all_units`;

export interface MembershipRow {
  id: string;
  tenant_id: string | null;
  role: Role;
  all_units: boolean;
  unit_ids: number[];
}

/** Baris membership → penugasan. super_admin (tenant NULL) tidak punya penugasan. */
export function toAssignments(rows: readonly MembershipRow[]): Assignment[] {
  return rows
    .filter((r): r is MembershipRow & { tenant_id: string } => r.tenant_id !== null)
    .map((r) => ({
      membershipId: r.id,
      tenantId: r.tenant_id,
      allUnits: r.all_units,
      unitIds: r.unit_ids.map(Number),
    }));
}
