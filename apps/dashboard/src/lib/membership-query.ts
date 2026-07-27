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

/**
 * Daftar penugasan untuk layar /admin. `$1` = pelaku super_admin, `$2` = tenant si
 * pelaku (dipakai bila bukan super).
 *
 * ⚠️ FILTER TENANT DI SINI ADALAH SATU-SATUNYA PENJAGANYA. `app.membership` tak
 * ber-`unit_id`, jadi RLS 0016 TIDAK menjaganya — tak ada jaring kedua di bawah
 * query ini. Sejak layar dikelompokkan per ORANG, satu blok menampilkan semua
 * penugasan orang itu; tanpa filter ini blok tersebut akan membocorkan keanggotaan
 * lintas-tenant kepada admin terdelegasi — kerabat langsung dari kebocoran direktori
 * pengguna yang ditutup di GATE 1. Diuji terhadap DB nyata, bukan disalin ke tes.
 */
export const ADMIN_MEMBERSHIPS_SQL = `
  SELECT m.id, m.user_id, u.email, m.role, m.tenant_id, t.name AS tenant_name,
         m.status, m.all_units,
         COALESCE(array_agg(uu.unit_id) FILTER (WHERE uu.unit_id IS NOT NULL), '{}') AS unit_ids
    FROM app.membership m
    JOIN app.users u ON u.id = m.user_id
    LEFT JOIN app.tenant t ON t.id = m.tenant_id
    LEFT JOIN app.user_unit uu ON uu.membership_id = m.id
   WHERE $1::boolean OR m.tenant_id = ANY($2::uuid[])
   GROUP BY m.id, m.user_id, u.email, m.role, m.tenant_id, t.name, m.status, m.all_units
   ORDER BY u.email, m.role`;
