-- 0032_role_keuangan — peran RBAC kelima: `keuangan`.
--
-- Keputusan owner 15 Agustus 2026, pembuka K2 (Layar 3 · Input Keuangan).
-- Pertanyaannya: SIAPA yang boleh menulis harga beli, mutasi kas/bank,
-- settlement EDC, dan biaya yang tidak lewat pengawas. Sampai putaran ini
-- jawabannya tidak tertulis di mana pun — §2 menyebut "Finance" sebagai pemilik
-- klasifikasi akuntansi, tetapi `Finance` bukan peran yang ada.
--
-- ⛔ HUBUNGANNYA DENGAN §10.4 — jangan disalahbaca sebagai pembalikan.
--
-- §10.4 menolak menjadikan **Head of Finance** sebuah peran, dan alasannya
-- tetap berlaku sepenuhnya: pemegang HoF (`ddsalam@solagroup.co`) SUDAH
-- ber-peran `admin_perusahaan`, dan `app.user_role.user_id` adalah PRIMARY KEY
-- ⇒ satu peran per orang, struktural. Memberinya peran `head_of_finance` akan
-- MENCABUT `admin_perusahaan` — menunjuk seseorang jadi HoF justru mencabut
-- wewenangnya mengelola akses.
--
-- `keuangan` tidak punya masalah itu, dan bedanya bukan selera:
--
--   · HoF   = KAPABILITAS yang menempel pada orang yang sudah punya peran lain
--             (ia menyetujui; pekerjaan hariannya bukan keuangan).
--   · keuangan = PEKERJAAN yang menjadi satu-satunya peran pemegangnya
--             (staf yang mengisi buku kas tiap hari; tak punya peran lain).
--
-- Satu-peran-per-orang mematikan yang pertama dan justru pas untuk yang kedua.
-- HoF TETAP kapabilitas lewat `HEAD_OF_FINANCE_EMAILS`. Keduanya hidup
-- berdampingan; jangan menyatukannya.
--
-- ⚠️ YANG **TIDAK** DIDAPAT PERAN INI, dan itu disengaja:
--   · `/admin` — tetap hanya super_admin & admin_perusahaan (`canManageAccess`);
--   · penutupan hari di luar toleransi §3.2 — `canCloseException` /
--     `canOverrideAboveMax` TIDAK menyebut `keuangan`, dan ada tes yang memerah
--     bila kelak ia menyusup ke sana. Mengisi buku bukan mengesahkan selisih.
--
-- Cakupan DATA tidak datang dari peran ini. Sejak 0019, luas unit ditentukan
-- `membership.all_units` + `app.user_unit`, bukan peran — jadi seorang
-- `keuangan` melihat persis unit yang ditugaskan kepadanya, tak lebih.
--
-- Migrasi ini HANYA melonggarkan dua CHECK. Tidak ada tabel baru, tidak ada
-- seed, tidak ada kebijakan RLS (`app.membership` & `app.user_role` bukan tabel
-- unit-scoped — lihat 0016). Tidak ada baris yang berubah nilainya.
--
-- Idempoten / aman re-run.

-- Kedua CHECK menyebut daftar peran yang sama dan HARUS bergerak bersama:
-- `app.membership.role` menunjuk `app.user_role(user_id, role)` lewat FK
-- komposit, jadi daftar yang berbeda di antara keduanya membuat peran yang sah
-- di satu tabel mustahil dirujuk dari tabel lainnya.

ALTER TABLE "app"."membership" DROP CONSTRAINT IF EXISTS "membership_role_check";
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_role_check"
  CHECK ("role" IN ('super_admin', 'admin_perusahaan', 'direksi', 'pengawas', 'keuangan'));

ALTER TABLE "app"."user_role" DROP CONSTRAINT IF EXISTS "user_role_role_check";
ALTER TABLE "app"."user_role" ADD CONSTRAINT "user_role_role_check"
  CHECK ("role" IN ('super_admin', 'admin_perusahaan', 'direksi', 'pengawas', 'keuangan'));

-- Catatan untuk yang menambah peran BERIKUTNYA: daftarnya ada di TIGA tempat —
-- dua CHECK di atas, dan `Role` di `apps/dashboard/src/lib/auth-context.ts`.
-- Yang di TypeScript menjaga dirinya sendiri (setiap `Record<Role, …>` gagal
-- type-check sampai anggota barunya ditangani); yang di sini tidak, karena
-- Postgres tak punya cara memberitahu bahwa sebuah string sah. Karena itu ada
-- tes yang membandingkan kedua daftar ini dengan `Role` dan memerah bila
-- keduanya berselisih.
