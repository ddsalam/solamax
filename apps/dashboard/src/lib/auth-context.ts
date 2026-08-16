import { auth } from "@/auth";
import { q } from "./db";
import {
  ACTIVE_MEMBERSHIPS_SQL,
  toAssignments,
  type MembershipRow,
} from "./membership-query";
import { resolveRole, type Assignment } from "./scope-rule";

/**
 * Otorisasi server-side. getAuthContext() = sumber kebenaran role+scope untuk
 * SETIAP query data. Default-deny: tanpa membership aktif → status "no-access".
 *
 * MODEL (migrasi 0019): hak efektif = GABUNGAN seluruh penugasan aktif.
 * Sebelumnya fungsi ini mengambil SATU membership (`ORDER BY role LIMIT 1`),
 * sehingga membership tenant kedua senyap tak berefek.
 *
 * ROLE TUNGGAL PER ORANG (keputusan owner): role tidak bervariasi antar-PT — yang
 * melebar hanyalah cakupan unit/tenant. Invariannya ditegakkan DEKLARATIF di DB
 * (app.user_role + FK komposit); di sini hanya resolusi fail-closed bila data
 * pernah dilanggar lewat penulisan manual (paling restriktif menang).
 *
 * ⚠️ Dibaca dari DB pada SETIAP request (tanpa cache(), tanpa JWT) — itulah yang
 *    membuat pencabutan akses berlaku SEKETIKA pada request berikutnya, tanpa
 *    logout. Jangan pindahkan scope ke JWT.
 */
export type Role =
  | "super_admin"
  | "admin_perusahaan"
  | "direksi"
  | "pengawas"
  /**
   * Staf keuangan unit — satu-satunya peran yang boleh MENULIS di Layar 3
   * (harga beli, buku kas & bank, settlement EDC, biaya di luar pengawas).
   * Keputusan owner 15 Agu 2026; migrasi 0032. Predikatnya `canInputKeuangan`
   * di keuangan-wewenang.ts — JANGAN dibaca dari peran ini secara langsung di
   * tempat lain.
   */
  | "keuangan";

export interface AuthContext {
  userId: number;
  email: string | null;
  name: string | null;
  /** Global per orang (keputusan owner). */
  role: Role;
  /** Gabungan penugasan aktif. Kosong untuk super_admin. */
  assignments: Assignment[];
  /** true = DB memuat >1 role untuk orang ini (invarian dilanggar) → banner /admin. */
  roleConflict: boolean;
}

export type AuthState =
  | { status: "unauthenticated" }
  | { status: "no-access"; email: string | null }
  | { status: "ok"; ctx: AuthContext };

const SUPERADMINS = (process.env.SUPERADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

interface SessionUser {
  id?: string | number;
  email?: string | null;
  name?: string | null;
}

/** Resolusi sesi → membership → konteks otorisasi. */
export async function getAuthContext(): Promise<AuthState> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.id) return { status: "unauthenticated" };
  const userId = Number(user.id);
  const email = user.email ?? null;

  // Bootstrap super_admin: email di SUPERADMIN_EMAILS & belum punya membership →
  // buat membership(role=super_admin, tenant_id=NULL). Anti telur-ayam.
  if (email && SUPERADMINS.includes(email.toLowerCase())) {
    const existing = await q<{ id: string }>(
      `SELECT id FROM app.membership WHERE user_id = $1 AND role = 'super_admin' LIMIT 1`,
      [userId],
    );
    if (existing.length === 0) {
      // user_role DULU: membership.(user_id, role) ber-FK komposit ke sini (0019).
      await q(
        `INSERT INTO app.user_role (user_id, role) VALUES ($1, 'super_admin')
         ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin'`,
        [userId],
      );
      // Sejak 0019 unique-nya NULLS NOT DISTINCT → ON CONFLICT ini benar-benar
      // cocok saat tenant_id NULL (sebelumnya tidak pernah → baris ganda saat balapan).
      await q(
        `INSERT INTO app.membership (user_id, tenant_id, role, status)
         VALUES ($1, NULL, 'super_admin', 'active')
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='super_admin', status='active'`,
        [userId],
      );
    }
  }

  // SEMUA membership aktif + unit-nya, dalam satu query (SQL dipakai bersama tes T-REV).
  const rows = await q<MembershipRow>(ACTIVE_MEMBERSHIPS_SQL, [userId]);
  if (rows.length === 0) return { status: "no-access", email };

  const { role, conflict } = resolveRole(rows.map((r) => r.role));
  if (conflict) {
    // Jalur BACA — jangan menulis DB di sini. Sinyal yang terlihat = banner /admin.
    console.error(
      `[rbac] invarian role dilanggar: user ${userId} punya role ${[
        ...new Set(rows.map((r) => r.role)),
      ].join("/")} — dipakai yang paling restriktif: ${role}`,
    );
  }

  // super_admin tak punya assignment (cabang lintas-tenant di unitVisible).
  const assignments: Assignment[] = toAssignments(rows);

  return {
    status: "ok",
    ctx: { userId, email, name: user.name ?? null, role, assignments, roleConflict: conflict },
  };
}
