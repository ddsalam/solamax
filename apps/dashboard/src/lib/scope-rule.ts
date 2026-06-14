/**
 * Aturan otorisasi MURNI (tanpa import server) — bisa diuji unit langsung.
 * Lapisan server (DataScope, getDataScope) ada di lib/scope.ts dan meng-import ini.
 */
import type { Role } from "./auth-context";

declare const scopedBrand: unique symbol;
/** number ber-brand: hanya dibuat di lib/scope.ts setelah otorisasi. */
export type ScopedUnitId = number & { readonly [scopedBrand]: true };

export interface ScopedUnit {
  unit_id: ScopedUnitId;
  code: string;
  name: string;
}

/** Konteks minimal untuk aturan visibilitas (subset AuthContext). */
export interface ScopeCtx {
  role: Role;
  tenantId: string | null;
  unitScope: "ALL" | number[];
}

/**
 * SATU-SATUNYA aturan visibilitas unit (sumber kebenaran; diuji di scope.test.ts).
 * Penegasan A (isolasi) ditegakkan di sini: beda tenant → selalu false; pengawas
 * di luar user_unit → false.
 */
export function unitVisible(
  ctx: ScopeCtx,
  unit: { unit_id: number; tenant_id: string | null },
): boolean {
  if (ctx.role === "super_admin") return true;
  // Isolasi tenant: caller harus punya tenant & unit harus tenant yang sama.
  if (ctx.tenantId === null || unit.tenant_id !== ctx.tenantId) return false;
  if (ctx.role === "pengawas") {
    return ctx.unitScope !== "ALL" && ctx.unitScope.includes(unit.unit_id);
  }
  // admin_perusahaan / direksi: semua unit dalam tenant.
  return true;
}
