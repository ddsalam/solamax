import type { Role } from "./auth-context";
import type { Assignment, ScopeCtx } from "./scope-rule";

/**
 * Pembangun ScopeCtx untuk TES SAJA (tidak diimpor kode produksi).
 *
 * Ada agar konversi suite lama ke bentuk `assignments[]` (migrasi 0019) bersifat
 * MEKANIS dan bisa dibaca baris-per-baris: `unitScope: "ALL"` → `ctxAll(...)`,
 * `unitScope: [n]` → `ctxUnits(..., [n])`. Tidak ada asersi yang dilonggarkan oleh
 * perubahan bentuk — hanya cara membangun konteksnya yang berubah.
 *
 * Sengaja TIDAK ada default "semua unit" tersembunyi: `ctxUnits` selalu menulis
 * `allUnits: false` eksplisit, sehingga daftar kosong tetap berarti DENY.
 */
export const ctxSuper = (): ScopeCtx => ({ role: "super_admin", assignments: [] });

export const ctxAll = (role: Role, tenantId: string): ScopeCtx => ({
  role,
  assignments: [{ membershipId: `m:${tenantId}`, tenantId, allUnits: true, unitIds: [] }],
});

export const ctxUnits = (role: Role, tenantId: string, unitIds: number[]): ScopeCtx => ({
  role,
  assignments: [{ membershipId: `m:${tenantId}`, tenantId, allUnits: false, unitIds }],
});

/** Beberapa penugasan sekaligus (multi-tenant tanpa super_admin). */
export const ctxMany = (role: Role, assignments: Omit<Assignment, "membershipId">[]): ScopeCtx => ({
  role,
  assignments: assignments.map((a, i) => ({ membershipId: `m:${i}`, ...a })),
});
