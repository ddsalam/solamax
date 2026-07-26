import type { Role } from "./auth-context";

/**
 * Aturan wewenang admin MURNI (tanpa import server) — pasangan `scope-rule.ts`
 * untuk sisi administrasi. Dipisah agar bisa diuji unit langsung: aksi server di
 * `admin-actions.ts` HANYA memanggil fungsi-fungsi ini, tidak menyalin logikanya.
 *
 * Dua tingkat wewenang (keputusan owner GATE 2):
 *   super_admin      — semua tenant; satu-satunya yang boleh MEMBUAT membership
 *                      baru dan HARD-DELETE.
 *   admin_perusahaan — hanya tenant sendiri, hanya atas membership yang SUDAH ada.
 */

/** Role yang boleh diberikan super_admin lewat UI (super_admin sendiri: tidak pernah). */
export const GRANTABLE_ROLES = ["admin_perusahaan", "direksi", "pengawas"] as const;
/** A2 — admin terdelegasi tak pernah boleh mengangkat admin_perusahaan. */
export const DELEGABLE_ROLES = ["direksi", "pengawas"] as const;

export interface AdminAuthority {
  /** Pelaku. */
  userId: number;
  role: Role;
  /** Tenant tempat pelaku punya penugasan (dipakai bila bukan super_admin). */
  tenantIds: string[];
}

export const isSuper = (a: AdminAuthority): boolean => a.role === "super_admin";

/** Boleh membuka /admin sama sekali. */
export function canManageAccess(a: AdminAuthority): boolean {
  return a.role === "super_admin" || a.role === "admin_perusahaan";
}

/** Hanya super_admin yang boleh MEMBUAT membership (lihat catatan direktori pengguna). */
export function canCreateMembership(a: AdminAuthority): boolean {
  return isSuper(a);
}

/**
 * Hanya super_admin yang boleh HARD-DELETE. Admin terdelegasi memakai suspend:
 * kalau ia bisa memusnahkan baris tanpa bisa membuatnya, ia bisa menghancurkan
 * akses yang tak bisa ia pulihkan sendiri.
 */
export function canHardDelete(a: AdminAuthority): boolean {
  return isSuper(a);
}

/** A1 — tenant di luar wewenang. */
export function canTouchTenant(a: AdminAuthority, tenantId: string | null): boolean {
  if (isSuper(a)) return true;
  return !!tenantId && a.tenantIds.includes(tenantId);
}

export interface TargetMembership {
  userId: number;
  tenantId: string | null;
  role: Role;
}

/**
 * Gabungan A1 + A2 (super_admin tak pernah dikelola di sini) + A4 (bukan diri sendiri).
 * Mengembalikan alasan penolakan agar aksi server bisa melaporkannya apa adanya.
 */
export function checkTouchMembership(
  a: AdminAuthority,
  m: TargetMembership,
): { ok: true } | { ok: false; reason: string } {
  if (m.role === "super_admin") return { ok: false, reason: "super_admin tidak dikelola di sini" };
  if (!canTouchTenant(a, m.tenantId)) return { ok: false, reason: "tenant di luar wewenang Anda" };
  if (!isSuper(a) && m.userId === a.userId) {
    return { ok: false, reason: "tidak bisa mengubah akses diri sendiri" };
  }
  return { ok: true };
}

/** Role yang boleh dipilih pelaku ini. */
export function assignableRoles(a: AdminAuthority): readonly string[] {
  return isSuper(a) ? GRANTABLE_ROLES : DELEGABLE_ROLES;
}

/**
 * A3 — role bersifat GLOBAL per orang, jadi mengubahnya di satu PT ikut mengubahnya
 * di PT lain tempat orang itu punya penugasan. Admin terdelegasi karena itu hanya
 * boleh mengubah role bila SELURUH penugasan target ada di dalam tenant-nya.
 *
 * `targetTenantIds` = tenant SEMUA membership target (null = membership global).
 */
export function canChangeRole(
  a: AdminAuthority,
  targetTenantIds: (string | null)[],
): { ok: true } | { ok: false; reason: string } {
  if (isSuper(a)) return { ok: true };
  const luar = targetTenantIds.filter((t) => t === null || !a.tenantIds.includes(t));
  if (luar.length > 0) {
    return {
      ok: false,
      reason:
        "pengguna ini punya penugasan di perusahaan lain — hanya super_admin yang boleh mengubah rolenya",
    };
  }
  return { ok: true };
}
