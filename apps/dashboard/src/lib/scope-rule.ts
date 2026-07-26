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

/**
 * SATU penugasan peran ber-scope = (principal, role, scope). `role` sengaja TIDAK
 * ada di sini: keputusan owner = role TUNGGAL per orang, global (lihat auth-context).
 * Yang melebar antar-penugasan hanyalah cakupan tenant/unit-nya.
 *
 * `allUnits` adalah kolom EKSPLISIT, bukan turunan dari `unitIds.length`:
 *   true  → semua unit tenant ini; unit BARU (SPBU ke-8 dst.) ikut OTOMATIS.
 *   false → hanya `unitIds`; beku, unit baru TIDAK ikut.
 * Himpunan `unitIds` kosong berarti DENY — TIDAK PERNAH "semua". Membalik makna itu
 * akan melebarkan setiap pengawas terbatas yang sudah ada secara senyap.
 */
export interface Assignment {
  membershipId: string;
  tenantId: string;
  allUnits: boolean;
  unitIds: number[];
}

/** Konteks minimal untuk aturan visibilitas (subset AuthContext). */
export interface ScopeCtx {
  role: Role;
  /** Kosong untuk super_admin (lintas semua tenant lewat cabang khusus). */
  assignments: Assignment[];
}

/**
 * SATU-SATUNYA aturan visibilitas unit (sumber kebenaran; diuji di scope.test.ts).
 * Hak efektif = GABUNGAN seluruh penugasan aktif — satu orang boleh punya
 * penugasan di beberapa PT sekaligus tanpa menjadi super_admin.
 *
 * Penegasan A (isolasi) ditegakkan di sini: sebuah unit hanya terlihat lewat
 * penugasan yang tenant-nya PERSIS sama. Sejak migrasi 0019 pemeriksaan tenant ini
 * adalah REDUNDANSI MURAH, bukan gerbang tunggal: `app.user_unit` membawa
 * `tenant_id` dengan FK komposit ke DUA sisi (unit dan membership), sehingga
 * penugasan lintas-tenant mustahil TERSIMPAN. Cek di sini tetap ada karena
 * biayanya nol dan ia melindungi jalur baca atas baris apa pun yang lebih tua.
 */
export function unitVisible(
  ctx: ScopeCtx,
  unit: { unit_id: number; tenant_id: string | null },
): boolean {
  if (ctx.role === "super_admin") return true;
  if (unit.tenant_id === null) return false;
  return ctx.assignments.some(
    (a) =>
      a.tenantId === unit.tenant_id && (a.allUnits || a.unitIds.includes(unit.unit_id)),
  );
}

/**
 * Urutan hak dari yang PALING RESTRIKTIF. Dipakai untuk resolusi fail-closed bila
 * invarian "satu role per orang" pernah dilanggar lewat penulisan manual.
 */
export const ROLE_RANK: Record<Role, number> = {
  pengawas: 0,
  direksi: 1,
  admin_perusahaan: 2,
  super_admin: 3,
};

/**
 * Fail-closed: bila baris membership memuat lebih dari satu role, yang PALING
 * RESTRIKTIF menang. Bukan "tolak sama sekali" — keduanya fail-closed, tetapi hanya
 * ini yang tidak menciptakan pemadaman sendiri dari satu baris data rusak. Dalam
 * model 0019 role TIDAK lagi menentukan luas unit (itu tugas `all_units`), jadi
 * menurunkan role hanya mencabut kemampuan admin = pembacaan least-privilege.
 *
 * Secara skema ini seharusnya tak tercapai (FK komposit app.user_role), jadi
 * `conflict` dipakai untuk menampilkan peringatan di /admin.
 */
export function resolveRole(roles: readonly Role[]): { role: Role; conflict: boolean } {
  const distinct = [...new Set(roles)];
  const role = distinct.reduce((min, r) => (ROLE_RANK[r] < ROLE_RANK[min] ? r : min), distinct[0]!);
  return { role, conflict: distinct.length > 1 };
}
