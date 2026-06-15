"use server";

import { revalidatePath } from "next/cache";
import { getDataScope, type DataScope } from "./scope";
import { q } from "./db";

/**
 * Aksi admin akses — SATU-SATUNYA jalan memberi/mencabut akses (membership).
 * Setiap aksi memverifikasi super_admin SERVER-SIDE (bukan sekadar sembunyi menu).
 * super_admin TIDAK bisa diberikan lewat UI (hanya bootstrap SUPERADMIN_EMAILS).
 */

const GRANTABLE = ["admin_perusahaan", "direksi", "pengawas"] as const;

async function assertSuperAdmin(): Promise<DataScope> {
  const scope = await getDataScope();
  if (!scope.isSuperAdmin) throw new Error("forbidden: super_admin only");
  return scope;
}

export async function grantAccess(formData: FormData): Promise<void> {
  const scope = await assertSuperAdmin();

  const userId = Number(formData.get("userId"));
  const role = String(formData.get("role") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "") || null;
  const unitIds = formData
    .getAll("unitIds")
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n));

  if (!Number.isInteger(userId)) throw new Error("user tidak valid");
  if (!(GRANTABLE as readonly string[]).includes(role)) throw new Error("role tidak valid");
  if (!tenantId) throw new Error("tenant wajib untuk role ini");

  const rows = await q<{ id: string }>(
    `INSERT INTO app.membership (user_id, tenant_id, role, status, invited_by_email)
     VALUES ($1, $2, $3, 'active', $4)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
     RETURNING id`,
    [userId, tenantId, role, scope.email],
  );
  const membershipId = rows[0]!.id;

  // user_unit: hanya untuk pengawas. Reset lalu set ulang (idempoten).
  await q(`DELETE FROM app.user_unit WHERE membership_id = $1`, [membershipId]);
  if (role === "pengawas") {
    for (const uid of unitIds) {
      await q(
        `INSERT INTO app.user_unit (membership_id, unit_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [membershipId, uid],
      );
    }
  }

  revalidatePath("/admin");
}

export async function revokeAccess(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!membershipId) throw new Error("membership tidak valid");
  // super_admin tak bisa dicabut lewat UI (jaga akses bootstrap).
  await q(`DELETE FROM app.membership WHERE id = $1 AND role <> 'super_admin'`, [membershipId]);
  revalidatePath("/admin");
}
