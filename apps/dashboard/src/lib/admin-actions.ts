"use server";

import { revalidatePath } from "next/cache";
import { getDataScope, type DataScope } from "./scope";
import { q } from "./db";
import {
  assignableRoles,
  canChangeRole,
  canCreateMembership,
  canHardDelete,
  canManageAccess,
  checkTouchMembership,
  type AdminAuthority,
} from "./admin-rules";
import type { Role } from "./auth-context";

/**
 * Aksi admin akses — SATU-SATUNYA jalan memberi/mengubah/mencabut akses.
 * Setiap aksi memverifikasi wewenang SERVER-SIDE (bukan sekadar sembunyi menu).
 *
 * DUA TINGKAT WEWENANG (keputusan owner GATE 2):
 *
 *   super_admin        — semua tenant; SATU-SATUNYA yang boleh MEMBUAT membership
 *                        baru dan melakukan HARD-DELETE.
 *   admin_perusahaan   — HANYA di dalam tenant-nya sendiri, dan hanya atas
 *                        membership yang SUDAH ada: ubah cakupan unit, suspend /
 *                        aktifkan, ubah role (tunduk A3), baca audit.
 *
 * Kenapa admin terdelegasi tak boleh hard-delete padahal boleh suspend: kalau ia
 * bisa MEMUSNAHKAN baris tapi tidak bisa MEMBUATNYA, ia bisa menghancurkan akses
 * yang tak bisa ia pulihkan sendiri. Itu jebakan operasional, bukan kontrol.
 *
 * Kenapa admin terdelegasi tak punya daftar/pencarian pengguna: `app.users` bukan
 * tabel ber-unit, jadi RLS 0016 maupun unitVisible TIDAK menjaganya — daftar polos
 * akan membocorkan direktori pengguna keenam PT lain. Pemberian akses ke orang BARU
 * karena itu milik super_admin saja, dan orakel keberadaan akun hilang di akarnya.
 *
 * A1 tenant sendiri · A2 tak pernah menyentuh super_admin / memberi admin_perusahaan ·
 * A3 ubah role hanya bila SELURUH membership target ada di tenant si admin ·
 * A4 tak pernah menyentuh diri sendiri · A5 semuanya masuk audit_log.
 */

interface AdminCtx {
  scope: DataScope;
  isSuper: boolean;
  /** Tenant yang boleh disentuh; kosong untuk super_admin (artinya: semua). */
  tenantIds: string[];
  authority: AdminAuthority;
}

interface MembershipRow {
  id: string;
  user_id: number;
  tenant_id: string | null;
  role: string;
  status: string;
}

function authorityOf(scope: DataScope): AdminAuthority {
  return { userId: scope.userId, role: scope.role, tenantIds: scope.tenantIds };
}

async function requireAdmin(): Promise<AdminCtx> {
  const scope = await getDataScope();
  const authority = authorityOf(scope);
  if (!canManageAccess(authority)) throw new Error("forbidden: bukan pengelola akses");
  return { scope, isSuper: scope.isSuperAdmin, tenantIds: scope.tenantIds, authority };
}

async function requireSuperAdmin(): Promise<AdminCtx> {
  const scope = await getDataScope();
  const authority = authorityOf(scope);
  if (!canCreateMembership(authority) || !canHardDelete(authority)) {
    throw new Error("forbidden: super_admin only");
  }
  return { scope, isSuper: true, tenantIds: scope.tenantIds, authority };
}

/** Ambil membership target + tegakkan A1, A2 (super_admin tak tersentuh), A4 (bukan diri). */
async function requireTargetMembership(ctx: AdminCtx, membershipId: string): Promise<MembershipRow> {
  if (!membershipId) throw new Error("membership tidak valid");
  const rows = await q<MembershipRow>(
    `SELECT id, user_id, tenant_id, role, status FROM app.membership WHERE id = $1`,
    [membershipId],
  );
  const m = rows[0];
  if (!m) throw new Error("membership tidak ditemukan");
  const verdict = checkTouchMembership(ctx.authority, {
    userId: m.user_id,
    tenantId: m.tenant_id,
    role: m.role as Role,
  });
  if (!verdict.ok) throw new Error(`forbidden: ${verdict.reason}`);
  return m;
}

async function audit(
  ctx: AdminCtx,
  action: string,
  target: string,
  tenantId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await q(
    `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, tenant_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [ctx.scope.userId, ctx.scope.email, action, target, tenantId, JSON.stringify(detail)],
  );
}

/** Tulis ulang daftar unit sebuah membership (idempoten). tenant_id diambil dari
 *  membership — FK komposit 0019 yang menolak unit lintas-tenant, bukan kode ini. */
async function writeUnits(m: MembershipRow, allUnits: boolean, unitIds: number[]): Promise<void> {
  await q(`DELETE FROM app.user_unit WHERE membership_id = $1`, [m.id]);
  if (allUnits) return; // all_units=true → daftar unit tak dipakai
  for (const uid of unitIds) {
    try {
      await q(
        `INSERT INTO app.user_unit (membership_id, unit_id, tenant_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [m.id, uid, m.tenant_id],
      );
    } catch (err) {
      throw new Error(
        `unit ${uid} bukan milik perusahaan penugasan ini (ditolak constraint DB): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function parseScopeFields(formData: FormData): { allUnits: boolean; unitIds: number[] } {
  const allUnits = String(formData.get("unitMode") ?? "") === "all";
  const unitIds = formData
    .getAll("unitIds")
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n));
  return { allUnits, unitIds };
}

/* ─────────────────────────── super_admin saja ─────────────────────────── */

/** Membuat / memperbarui membership. HANYA super_admin (lihat catatan direktori). */
export async function grantAccess(formData: FormData): Promise<void> {
  const ctx = await requireSuperAdmin();
  const scope = ctx.scope;

  const userId = Number(formData.get("userId"));
  const role = String(formData.get("role") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "") || null;
  const { allUnits, unitIds } = parseScopeFields(formData);

  if (!Number.isInteger(userId)) throw new Error("user tidak valid");
  if (!assignableRoles(ctx.authority).includes(role)) throw new Error("role tidak valid");
  if (!tenantId) throw new Error("tenant wajib untuk role ini");

  // Role TUNGGAL per orang: set di app.user_role dulu (FK komposit membership → sini).
  // ON UPDATE CASCADE merambatkan perubahan role ke seluruh membership orang itu.
  await q(
    `INSERT INTO app.user_role (user_id, role) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, role],
  );

  const rows = await q<{ id: string }>(
    `INSERT INTO app.membership (user_id, tenant_id, role, status, all_units, invited_by_email)
     VALUES ($1, $2, $3, 'active', $4, $5)
     ON CONFLICT (user_id, tenant_id)
       DO UPDATE SET role = EXCLUDED.role, status = 'active', all_units = EXCLUDED.all_units
     RETURNING id`,
    [userId, tenantId, role, allUnits, scope.email],
  );
  const membershipId = rows[0]!.id;

  await writeUnits(
    { id: membershipId, user_id: userId, tenant_id: tenantId, role, status: "active" },
    allUnits,
    unitIds,
  );

  await audit(ctx, "grant_access", String(userId), tenantId, {
    membership_id: membershipId,
    role,
    tenant_id: tenantId,
    all_units: allUnits,
    unit_ids: allUnits ? "ALL" : unitIds,
  });
  revalidatePath("/admin");
}

/** HARD-DELETE membership. HANYA super_admin; admin terdelegasi memakai suspend. */
export async function revokeAccess(formData: FormData): Promise<void> {
  const ctx = await requireSuperAdmin();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!membershipId) throw new Error("membership tidak valid");

  // super_admin tak bisa dicabut lewat UI (jaga akses bootstrap).
  const deleted = await q<{ id: string; user_id: number; tenant_id: string | null }>(
    `DELETE FROM app.membership WHERE id = $1 AND role <> 'super_admin'
     RETURNING id, user_id, tenant_id`,
    [membershipId],
  );
  if (deleted.length > 0) {
    const d = deleted[0]!;
    await audit(ctx, "revoke_access", membershipId, d.tenant_id, {
      membership_id: membershipId,
      user_id: d.user_id,
    });
  }
  revalidatePath("/admin");
}

/* ───────────────── super_admin + admin_perusahaan (dlm tenant) ───────────────── */

/** Ubah cakupan unit sebuah penugasan (all_units ↔ daftar unit). */
export async function updateScope(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const m = await requireTargetMembership(ctx, String(formData.get("membershipId") ?? ""));
  const { allUnits, unitIds } = parseScopeFields(formData);

  await q(`UPDATE app.membership SET all_units = $2 WHERE id = $1`, [m.id, allUnits]);
  await writeUnits(m, allUnits, unitIds);

  await audit(ctx, "update_scope", m.id, m.tenant_id, {
    membership_id: m.id,
    user_id: m.user_id,
    all_units: allUnits,
    unit_ids: allUnits ? "ALL" : unitIds,
  });
  revalidatePath("/admin");
}

/** Suspend / aktifkan kembali (menggantikan hard-delete bagi admin terdelegasi). */
export async function setMembershipStatus(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const m = await requireTargetMembership(ctx, String(formData.get("membershipId") ?? ""));
  const status = String(formData.get("status") ?? "");
  if (!["active", "disabled"].includes(status)) throw new Error("status tidak valid");

  await q(`UPDATE app.membership SET status = $2 WHERE id = $1`, [m.id, status]);
  await audit(ctx, status === "disabled" ? "suspend_access" : "reactivate_access", m.id, m.tenant_id, {
    membership_id: m.id,
    user_id: m.user_id,
    status,
  });
  revalidatePath("/admin");
}

/**
 * Ubah role seseorang. Role bersifat GLOBAL per orang, jadi perubahan ini berlaku di
 * SEMUA PT tempat ia punya membership — itulah sebabnya A3 ada: admin terdelegasi
 * hanya boleh mengubahnya bila SELURUH membership target berada di tenant-nya.
 */
export async function setUserRole(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const m = await requireTargetMembership(ctx, String(formData.get("membershipId") ?? ""));
  const role = String(formData.get("role") ?? "");

  if (!assignableRoles(ctx.authority).includes(role)) throw new Error("role tidak valid"); // A2

  // A3 — role GLOBAL per orang: cek SELURUH penugasan target, bukan hanya yang ini.
  const semua = await q<{ tenant_id: string | null }>(
    `SELECT tenant_id FROM app.membership WHERE user_id = $1`,
    [m.user_id],
  );
  const verdict = canChangeRole(ctx.authority, semua.map((r) => r.tenant_id));
  if (!verdict.ok) throw new Error(`forbidden: ${verdict.reason}`);

  // Satu UPDATE; ON UPDATE CASCADE (0019) merambatkannya ke semua membership.
  await q(`UPDATE app.user_role SET role = $2 WHERE user_id = $1`, [m.user_id, role]);
  await audit(ctx, "set_role", String(m.user_id), m.tenant_id, {
    membership_id: m.id,
    user_id: m.user_id,
    role_lama: m.role,
    role_baru: role,
  });
  revalidatePath("/admin");
}
