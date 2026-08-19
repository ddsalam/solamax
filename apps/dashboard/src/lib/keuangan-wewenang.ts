/**
 * Wewenang keuangan — DUA BENTUK yang sengaja tidak disatukan.
 *
 *   · MENYETUJUI penutupan di luar toleransi = **kapabilitas** (Head of
 *     Finance, lewat ENV) — §10.4, keputusan owner B4 12 Agustus 2026.
 *   · MENGISI buku keuangan = **peran** `keuangan` (migrasi 0032) —
 *     keputusan owner 15 Agustus 2026, pembuka K2.
 *
 * Yang menyetujui tidak mengetik; yang mengetik tidak menyetujui. Kalau kelak
 * ada yang menggabungkan keduanya "supaya sederhana", yang hilang adalah
 * pemisahan itu — dan tak ada angka yang akan terlihat salah karenanya.
 *
 * ⚠️ SATU PENGECUALIAN, DISENGAJA: **`super_admin` lolos KEDUANYA** — ia boleh
 * mengetik DAN boleh menyetujui. Ini break-glass, bukan kelalaian (§10.11):
 * satu-peran-per-orang membuat "sementara jadi `keuangan`" berarti kehilangan
 * `super_admin`, sehingga pemulihan keadaan mustahil justru saat dibutuhkan.
 * Pemisahan tugas di modul ini berlaku di antara peran OPERASIONAL; terhadap
 * `super_admin` yang menjaga hanyalah `app.audit_log` (0017) — jejak, bukan
 * pencegahan. Menyebutnya di sini supaya pembaca berikutnya tidak "menemukan"
 * lubang yang sebenarnya keputusan.
 *
 * Keputusan owner B4, 12 Agustus 2026 (KEUANGAN-HARIAN.md §10.4).
 *
 *     canCloseException = role ∈ {direksi, super_admin} ∨ isHeadOfFinance
 *
 * ⛔ JANGAN menyisipkan `head_of_finance` ke `ROLE_RANK`
 * ([`scope-rule.ts`](scope-rule.ts): `pengawas 0 · keuangan 1 · direksi 2 ·
 * admin_perusahaan 3 · super_admin 4` sejak migrasi 0032). Tangga itu mengatur
 * **cakupan data**, bukan wewenang keuangan. Menaruh HoF di atas `direksi` ⇒
 * HoF melihat lebih banyak data daripada Direksi; di bawah ⇒ Direksi kehilangan
 * wewenang HoF.
 *
 * ⚠️ Peran `keuangan` yang MASUK tangga itu (0032) bukan pembalikan aturan ini.
 * HoF sudah punya peran lain yang akan tercabut; pemegang `keuangan` tidak punya
 * peran lain untuk dicabut. Lihat {@link canInputKeuangan}.
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

/**
 * Boleh MENULIS di Layar 3 — Input Keuangan (harga beli, buku kas & bank,
 * settlement EDC, biaya yang tidak lewat pengawas).
 *
 * Keputusan owner 15 Agustus 2026: peran RBAC baru `keuangan` (migrasi 0032),
 * bukan kapabilitas ENV seperti HoF. Bedanya bukan selera — HoF adalah
 * kapabilitas yang menempel pada orang yang SUDAH punya peran lain, sedangkan
 * `keuangan` adalah pekerjaan yang menjadi SATU-SATUNYA peran pemegangnya.
 * Satu-peran-per-orang mematikan yang pertama dan justru pas untuk yang kedua
 * (§10.4 tetap berlaku utuh untuk HoF).
 *
 * ⛔ `pengawas` TIDAK ADA di sini, dan itu inti §2: pengawas memiliki FAKTA
 * transaksi, Finance memiliki klasifikasi & penyajian akuntansi. Pengawas yang
 * bisa mengetik harga beli meruntuhkan pemisahan itu tanpa satu pun angka
 * terlihat salah.
 *
 * ⛔ Ditulis BERDIRI SENDIRI — bukan turunan `canCloseException`, dan sengaja
 * TIDAK menyebut `isHeadOfFinance`. Mengisi buku bukan mengesahkan selisih:
 * HoF menyetujui penutupan (§3.2), ia tidak mengetik mutasi bank. Menyatukan
 * keduanya akan memberi hak tulis kepada penyetuju, dan penyetuju yang boleh
 * menulis adalah pemeriksa yang memeriksa pekerjaannya sendiri.
 *
 * `super_admin` ada karena ia harus bisa memulihkan keadaan tanpa memberi
 * dirinya peran lain — dan karena satu-peran-per-orang membuat "sementara
 * jadi keuangan" berarti kehilangan super_admin.
 *
 * ⛔ **IRISAN HoF × `keuangan` DITUTUP DI SINI** (§10.12, 16 Agu 2026). Pemegang
 * `HEAD_OF_FINANCE_EMAILS` yang entah bagaimana diberi peran `keuangan` **tidak**
 * mendapat hak tulis: ia sudah lolos `canCloseException`, dan menambahkan hak
 * tulis membuat satu orang mengetik sekaligus menyetujui — tepat pada orang yang
 * wewenang persetujuannya tertinggi setelah Direksi.
 *
 * Yang DICABUT adalah hak MENGETIK, bukan hak menyetujui: HoF diangkat sebagai
 * penyetuju, jadi itulah yang harus bertahan bila keduanya bertabrakan.
 *
 * ⚠️ Ini penjagaan **runtime**, bukan penjagaan yang bisa diuji statis: HoF
 * hidup di ENV, peran hidup di DB, dan tak ada satu proses pun yang melihat
 * keduanya di waktu build. Uji yang "memerah bila irisannya tak kosong" karena
 * itu MUSTAHIL sebagai uji unit — yang mungkin hanyalah membuat irisannya
 * TIDAK BERBAHAYA, dan itu yang dilakukan baris di bawah.
 */
export function canInputKeuangan(ctx: WewenangCtx, daftar?: readonly string[]): boolean {
  if (ctx.role === "super_admin") return true;
  if (ctx.role !== "keuangan") return false;
  return !isHeadOfFinance(ctx.email, daftar ?? HEAD_OF_FINANCE_EMAILS);
}

/**
 * Kenapa pemanggil ini tidak boleh menulis — SATU sumber untuk pesan di layar
 * dan pesan dari server action. Dua pesan yang ditulis terpisah akan berselisih,
 * dan yang berselisih di sini adalah penjelasan tentang wewenang.
 */
export type AlasanTakBolehInput = "bukan_keuangan" | "hof_tidak_mengetik";

export function alasanTakBolehInput(
  ctx: WewenangCtx,
  daftar?: readonly string[],
): AlasanTakBolehInput | null {
  if (canInputKeuangan(ctx, daftar)) return null;
  if (ctx.role === "keuangan") return "hof_tidak_mengetik";
  return "bukan_keuangan";
}

export const PESAN_TAK_BOLEH_INPUT: Record<AlasanTakBolehInput, string> = {
  bukan_keuangan: "Hanya peran Keuangan yang boleh mengisi input keuangan.",
  hof_tidak_mengetik:
    "Akun ini terdaftar sebagai Head of Finance, jadi ia menyetujui — bukan mengetik. " +
    "Pemisahan itu hilang bila satu orang melakukan keduanya. Minta staf Keuangan mengisinya.",
};

/**
 * Boleh MEMBACA Laporan Keuangan Harian (Layar 2)?
 *
 * Keputusan owner 17 Agustus 2026 — §10.13, ditulis ke repo sebelum dipakai.
 *
 * ⛔ `pengawas` TIDAK termasuk. Laba, ekuitas, saldo tujuh rekening, gaji
 * karyawan, dan kontribusi ke pusat tidak terlihat oleh pengawas unit —
 * 15 dari 21 pengguna produksi berperan pengawas. Alasannya sejalan §2:
 * pengawas memiliki FAKTA transaksi, bukan penyajian keuangannya.
 *
 * ⛔ Ditulis BERDIRI SENDIRI — ini gerbang **BACA**, dan ia sengaja BUKAN
 * turunan {@link canInputKeuangan}. Keduanya berbeda ke dua arah: seorang
 * `direksi` boleh membaca tetapi tidak boleh mengisi; seorang `keuangan` boleh
 * keduanya. Menyusun yang satu dari yang lain akan membuat perubahan pada
 * gerbang tulis merembes ke gerbang baca tanpa ada yang memutuskannya.
 *
 * Ongkos yang diterima sadar (§10.13): pengawas tidak bisa melihat akibat dari
 * angka yang ia isi sendiri.
 */
export function canViewLaporanKeuangan(ctx: WewenangCtx): boolean {
  return (
    ctx.role === "keuangan" ||
    ctx.role === "direksi" ||
    ctx.role === "admin_perusahaan" ||
    ctx.role === "super_admin"
  );
}

/**
 * Boleh MENONAKTIFKAN akun kas? **Head of Finance saja** (§10.18).
 *
 * ⛔ Ditulis BERDIRI SENDIRI, dan asimetrinya terhadap {@link canInputKeuangan}
 * DISENGAJA — jangan "merapikan" keduanya jadi satu predikat:
 *
 *   · **Menambah** akun (`canInputKeuangan`) menambah sesuatu yang **TERLIHAT**:
 *     ia muncul sebagai baris baru di papan, jadi kesalahannya menampakkan diri.
 *   · **Menonaktifkan** mengurangi sesuatu sehingga ia **berhenti terlihat** —
 *     dan menghilangkan akun adalah cara membuat saldo hilang dari pandangan.
 *     Yang menghilang tidak menampakkan diri.
 *
 * Bedanya bukan kerapian; ia alasan keduanya dibedakan. Menyatukannya menghapus
 * alasan itu tanpa satu pun angka terlihat salah.
 *
 * `super_admin` ikut, sejalan break-glass §10.11.
 */
export function canNonaktifkanAkunKas(ctx: WewenangCtx, daftar?: readonly string[]): boolean {
  return ctx.role === "super_admin" || isHeadOfFinance(ctx.email, daftar ?? HEAD_OF_FINANCE_EMAILS);
}
