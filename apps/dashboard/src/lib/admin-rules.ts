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
 * Form "beri akses" TIDAK BOLEH mengubah role. Role bersifat global per orang, dan
 * `grantAccess` dulu meng-upsert `app.user_role` — sehingga admin yang menambahkan
 * perusahaan kedua untuk seorang PENGAWAS, tanpa menyentuh select Role yang default-nya
 * "Direksi", diam-diam menaikkannya jadi direksi di SEMUA perusahaannya lewat
 * ON UPDATE CASCADE. Kelas cacat yang tak tertangkap suite: kedua keadaan sama-sama
 * sah, dan uji UI selalu memilih role secara sengaja sehingga tak pernah melewati
 * jalur default.
 *
 * Aturannya: role yang dikirim harus SAMA dengan yang sudah dimiliki. Hanya pengguna
 * yang belum punya baris `app.user_role` (membership pertamanya) yang boleh menentukan
 * role di sini. Perubahan role punya aksinya sendiri (`setUserRole`) yang tunduk A3.
 */
export function roleGrantAllowed(
  existing: Role | null,
  submitted: string,
): { ok: true } | { ok: false; reason: string } {
  if (existing === null) return { ok: true }; // pengguna baru — satu-satunya kasus sah
  if (existing === submitted) return { ok: true };
  return {
    ok: false,
    reason:
      `pengguna ini sudah ber-role "${existing}"; form ini tidak mengubah role ` +
      `(role berlaku di SEMUA perusahaannya). Pakai kontrol "Set" di baris penugasannya.`,
  };
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
    // ⚠️ Pesan NETRAL dengan sengaja. Menyebut "punya penugasan di perusahaan lain"
    // akan MENGONFIRMASI keberadaan penugasan lintas-tenant kepada admin yang tak
    // berhak mengetahuinya — kebocoran yang sama dengan daftar penugasan lintas-PT,
    // lewat pintu pesan galat. Alasan sebenarnya hanya ada di komentar ini.
    return {
      ok: false,
      reason: "perubahan role pengguna ini di luar wewenang Anda — hubungi super admin",
    };
  }
  return { ok: true };
}

/**
 * UMPAN BALIK AKSI ADMIN — cermin terbalik dari cacat yang ditutup #141.
 *
 * Dulu UI diam-diam berbuat LEBIH dari yang dimaksud (menaikkan role lewat default
 * select). Setelah penegakan server dipasang, ia diam-diam berbuat KURANG: aksi yang
 * ditolak melempar, dan build produksi Next.js menyembunyikan pesannya sama sekali —
 * admin menekan tombol, tak terjadi apa-apa, tanpa satu pun keterangan. Di layar
 * PEMBERIAN AKSES, admin yang mengira berhasil padahal ditolak memegang keyakinan
 * SALAH tentang siapa boleh melihat apa.
 *
 * ⚠️ NETRALITAS: SEMUA penolakan wewenang dipetakan ke SATU kode yang sama, apa pun
 * sebabnya (tenant lain / diri sendiri / super_admin / A3 lintas-tenant). Menambah
 * umpan balik TIDAK BOLEH mengembalikan kebocoran yang ditutup #142 — pesan yang
 * membedakan sebab akan mengonfirmasi keberadaan penugasan lintas-tenant.
 */
export type KodeHasil = "ok" | "wewenang" | "input";

export function kodeGagal(err: unknown): Exclude<KodeHasil, "ok"> {
  const pesan = err instanceof Error ? err.message : String(err);
  // Semua aturan A1–A4 + roleGrantAllowed melempar dengan awalan "forbidden:".
  return pesan.startsWith("forbidden:") ? "wewenang" : "input";
}

export const PESAN_HASIL: Record<KodeHasil, { nada: "ok" | "gagal"; teks: string }> = {
  ok: { nada: "ok", teks: "Perubahan tersimpan." },
  wewenang: {
    nada: "gagal",
    teks:
      "Aksi ditolak — di luar wewenang Anda. Tidak ada yang diubah. " +
      "Hubungi super admin bila menurut Anda ini keliru.",
  },
  input: {
    nada: "gagal",
    teks: "Aksi gagal — data isian tidak valid. Tidak ada yang diubah.",
  },
};
