import { notFound, redirect } from "next/navigation";
import { getAuthContext, type AuthContext, type Role } from "./auth-context";
import { q } from "./db";
import { unitVisible, type ScopedUnit, type ScopedUnitId } from "./scope-rule";

/**
 * CHOKE-POINT SCOPING (Fase 3 — keamanan inti multi-tenant), lapisan SERVER.
 * Aturan murni `unitVisible` + tipe ber-brand `ScopedUnitId` ada di scope-rule.ts
 * (bisa diuji tanpa import server). Di sini: gerbang otorisasi + resolusi unit.
 *
 * Prinsip: MUSTAHIL menjalankan query data per-unit tanpa unit yang lolos otorisasi.
 * Setiap query menerima `ScopedUnitId` yang HANYA bisa dibuat di sini (cast tunggal
 * setelah filter). Lupa men-scope = error TypeScript, bukan kebocoran diam-diam.
 *
 * Default-deny: unauth→/login, no-access→/no-access, di luar scope→notFound.
 */

export { unitVisible } from "./scope-rule";
export type { ScopedUnit, ScopedUnitId, ScopeCtx } from "./scope-rule";

/** Pegangan scope ter-otorisasi. Hanya dibuat oleh getDataScope(). */
export class DataScope {
  readonly role: Role;
  readonly email: string | null;
  readonly tenantId: string | null;
  readonly units: ScopedUnit[];

  constructor(ctx: AuthContext, units: ScopedUnit[]) {
    this.role = ctx.role;
    this.email = ctx.email;
    this.tenantId = ctx.tenantId;
    this.units = units;
  }

  get isSuperAdmin(): boolean {
    return this.role === "super_admin";
  }

  /** unit_id yang boleh dilihat caller (untuk query agregat lintas-unit). */
  get unitIds(): ScopedUnitId[] {
    return this.units.map((u) => u.unit_id);
  }

  /**
   * Unit dari `code`, HANYA bila dalam scope caller. Di luar scope ATAU tidak ada
   * → notFound() (404 identik — tidak membocorkan keberadaan unit lintas-tenant).
   */
  requireUnit(code: string): ScopedUnit {
    const u = this.units.find((x) => x.code === code);
    if (!u) notFound();
    return u;
  }
}

/**
 * Choke-point: konteks otorisasi → daftar unit ter-scope. Dipanggil di SETIAP
 * halaman/aksi yang menyentuh data. Redirect default-deny dilakukan di sini.
 */
export async function getDataScope(): Promise<DataScope> {
  const state = await getAuthContext();
  if (state.status === "unauthenticated") redirect("/login");
  if (state.status === "no-access") redirect("/no-access");
  const ctx = state.ctx;

  // Kandidat = semua unit aktif (schema-qualified). Filter via aturan tunggal.
  const all = await q<{ unit_id: number; code: string; name: string; tenant_id: string | null }>(
    `SELECT unit_id, code, name, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
  );
  const units: ScopedUnit[] = all
    .filter((u) => unitVisible(ctx, u))
    .map((u) => ({ unit_id: u.unit_id as ScopedUnitId, code: u.code, name: u.name }));

  return new DataScope(ctx, units);
}
