import { auth } from "@/auth";
import { q } from "./db";

/**
 * Otorisasi server-side. getAuthContext() = sumber kebenaran role+scope untuk
 * SETIAP query data (dipakai di Fase 3 untuk men-scope semua query). Default-deny:
 * tanpa membership aktif → status "no-access" (nol data).
 *
 * Hierarki role: super_admin (lintas-tenant) > admin_perusahaan > direksi
 * (semua unit tenant) > pengawas (unit di user_unit).
 */
export type Role = "super_admin" | "admin_perusahaan" | "direksi" | "pengawas";

export interface AuthContext {
  userId: number;
  email: string | null;
  name: string | null;
  role: Role;
  /** null = super_admin (lintas semua tenant). */
  tenantId: string | null;
  /** "ALL" = semua unit dalam scope tenant; number[] = unit_id tertentu (pengawas). */
  unitScope: "ALL" | number[];
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
      await q(
        `INSERT INTO app.membership (user_id, tenant_id, role, status)
         VALUES ($1, NULL, 'super_admin', 'active')
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='super_admin', status='active'`,
        [userId],
      );
    }
  }

  // Membership aktif (pilih yang tertinggi bila ada beberapa).
  const rows = await q<{ id: string; tenant_id: string | null; role: Role; status: string }>(
    `SELECT id, tenant_id, role, status FROM app.membership
     WHERE user_id = $1 AND status = 'active'
     ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin_perusahaan' THEN 1
                        WHEN 'direksi' THEN 2 ELSE 3 END
     LIMIT 1`,
    [userId],
  );
  const m = rows[0];
  if (!m) return { status: "no-access", email };

  // Scope unit: super_admin/admin/direksi = ALL (dalam tenant); pengawas = user_unit.
  let unitScope: "ALL" | number[] = "ALL";
  if (m.role === "pengawas") {
    const units = await q<{ unit_id: number }>(
      `SELECT unit_id FROM app.user_unit WHERE membership_id = $1`,
      [m.id],
    );
    unitScope = units.map((u) => u.unit_id);
  }

  return {
    status: "ok",
    ctx: {
      userId,
      email,
      name: user.name ?? null,
      role: m.role,
      tenantId: m.tenant_id,
      unitScope,
    },
  };
}
