/**
 * Wewenang KEUANGAN sebagai KAPABILITAS, bukan sebagai peran.
 *
 * Keputusan owner B4, 12 Agustus 2026 (KEUANGAN-HARIAN.md §10.4).
 *
 *     canCloseException = role ∈ {direksi, super_admin} ∨ isHeadOfFinance
 *
 * ⛔ JANGAN menyisipkan `head_of_finance` ke `ROLE_RANK`
 * ([`scope-rule.ts`](scope-rule.ts): `pengawas 0 · direksi 1 · admin_perusahaan 2
 * · super_admin 3`). Tangga itu mengatur **cakupan data**, bukan wewenang
 * keuangan. Menaruh HoF di atas `direksi` ⇒ HoF melihat lebih banyak data
 * daripada Direksi; di bawah ⇒ Direksi kehilangan wewenang HoF.
 *
 * 🔴 BUKTI KONKRET kenapa HoF-sebagai-peran MUSTAHIL, bukan sekadar tidak rapi
 * (diverifikasi owner 12 Agu 2026):
 *
 *   · pemegang HoF = `ddsalam@solagroup.co` = `app.users` **id 15**, dengan
 *     **6 membership** dan peran **`admin_perusahaan`**;
 *   · `app.user_role.user_id` adalah **PRIMARY KEY** ⇒ satu peran per orang,
 *     ditegakkan STRUKTURAL, bukan konvensi.
 *
 * Maka memberinya peran `head_of_finance` akan **MENCABUT** `admin_perusahaan` —
 * satu-satunya yang memberi akses `/admin`. Hasilnya: menunjuk seseorang jadi
 * Head of Finance justru mencabut wewenangnya mengelola akses. Kapabilitas
 * terpisah bukan pilihan yang lebih rapi; ia **satu-satunya bentuk yang mungkin**.
 *
 * Karena itu keanggotaan HoF hidup di ENV (`HEAD_OF_FINANCE_EMAILS`), pola yang
 * sama dengan `SUPERADMIN_EMAILS` — di luar `app.user_role`, sehingga ia tidak
 * bisa bertabrakan dengan peran mana pun.
 */
import type { Role } from "./auth-context";

/**
 * Email pemegang HoF, dari env. Dibaca sekali saat modul dimuat — sama seperti
 * `SUPERADMINS` di `auth-context.ts`, dan sama-sama berarti: mengubah daftar
 * butuh deploy ulang. Itu disengaja untuk wewenang sekelas ini.
 */
export const HEAD_OF_FINANCE_EMAILS: readonly string[] = (
  process.env.HEAD_OF_FINANCE_EMAILS ?? ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Apakah email ini pemegang Head of Finance?
 *
 * `null`/kosong ⇒ false. Daftar kosong ⇒ **selalu** false: kalau env belum
 * dipasang, tak seorang pun jadi HoF secara tak sengaja. Fail-closed.
 */
export function isHeadOfFinance(
  email: string | null | undefined,
  daftar: readonly string[] = HEAD_OF_FINANCE_EMAILS,
): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (e === "") return false;
  return daftar.includes(e);
}

/** Bagian AuthContext yang dibutuhkan — sengaja sempit supaya mudah diuji. */
export interface WewenangCtx {
  role: Role;
  email: string | null;
}

/**
 * Boleh menutup hari yang selisihnya DI LUAR toleransi (§3.2)?
 *
 * ⚠️ Ini **bukan** seluruh tangga §3.2. Tangganya bertingkat:
 *   · ≤ Rp 10.000 → penutup operasional (tak butuh kapabilitas ini);
 *   · Rp 10.001–100.000 → **Head of Finance**;
 *   · > Rp 100.000 → **hanya Direksi**.
 *
 * Predikat di bawah menjawab tingkat KEDUA. Tingkat ketiga punya predikatnya
 * sendiri: {@link canOverrideAboveMax}.
 *
 * ⛔ JANGAN memakai `canCloseException` untuk menjaga tingkat ketiga. Ia akan
 * meloloskan HoF pada ambang yang §3.2 batasi ke Direksi — pelonggaran senyap,
 * persis kelas kesalahan yang tangga ini dibuat untuk mencegah.
 */
export function canCloseException(ctx: WewenangCtx, daftar?: readonly string[]): boolean {
  return (
    ctx.role === "direksi" ||
    ctx.role === "super_admin" ||
    isHeadOfFinance(ctx.email, daftar ?? HEAD_OF_FINANCE_EMAILS)
  );
}

/**
 * Boleh meng-override penutupan hari yang selisihnya **> Rp 100.000** (tingkat
 * ketiga §3.2). Keputusan owner 13 Agustus 2026: **`direksi` DAN `super_admin`**,
 * **TANPA** Head of Finance.
 *
 * ⛔ Ditulis BERDIRI SENDIRI, sengaja — bukan `canCloseException(...) && …`.
 *
 * Beda kedua predikat hanya **satu suku** (`isHeadOfFinance`), dan justru suku
 * itulah yang membuat tangga §3.2 punya arti. Kalau keduanya disatukan "toh cuma
 * beda HoF", tangganya runtuh **tanpa satu pun tes merah** — kecuali predikatnya
 * memang dua, dan ada tes yang memerah saat HoF bisa menutup di atas Rp 100.000.
 *
 * Menyusunnya sebagai turunan (`canCloseException` lalu disaring) akan membuat
 * perubahan pada tingkat kedua merembes ke tingkat ketiga tanpa disadari. Dua
 * ambang berbeda = dua predikat berbeda.
 */
export function canOverrideAboveMax(ctx: WewenangCtx): boolean {
  return ctx.role === "direksi" || ctx.role === "super_admin";
}
