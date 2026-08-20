-- 0035 — HAK DB TABEL AUTENTIKASI (GRANT SAJA, TANPA PERUBAHAN SKEMA)
--
-- ⛔ MIGRASI PERTAMA SESUDAH MODUL KEUANGAN MENYALA DI PRODUKSI.
--
-- MASALAH YANG DITUTUPNYA. Tujuh tabel jalur autentikasi dipakai kode tanpa
-- satu pun GRANT di migrasi mana pun. Keduanya tetap berfungsi karena haknya
-- dipasang DI LUAR migrasi saat deploy B1 lewat `ALTER DEFAULT PRIVILEGES` —
-- mekanisme yang DIRUJUK di komentar 0004 · 0006 · 0007 tetapi tak pernah
-- dieksekusi oleh migrasi mana pun. Akibatnya bukan "/admin mati di DB yang
-- dibangun ulang", melainkan LOGIN yang mati: DB dari migrasi murni tak bisa
-- memproses siapa pun masuk, dan tak ada satu baris pun di repo yang
-- mengatakannya. Keputusan owner 18 Agu 2026 → AUTH-RBAC-DESIGN.md §7.
--
-- ⛔ SENGAJA BUKAN `ALTER DEFAULT PRIVILEGES`. Ia memberi hak otomatis pada
--    tabel yang BELUM ADA — termasuk tabel yang sengaja lebih ketat. Contohnya
--    ada di repo ini: `app.cash_ledger` memang tanpa DELETE (tulis-VOID, bukan
--    hapus). Mekanisme yang murah hati secara diam-diam akan membatalkan
--    kehati-hatian itu tanpa ada yang menyadarinya.
--
-- ⛔ MENAMBAH, TIDAK PERNAH MENCABUT. Tak ada satu pun REVOKE di berkas ini.
--    Produksi hari ini memegang arwd pada ketujuhnya dari default privileges
--    tangan itu; migrasi ini TIDAK menyempitkannya. DB BARU mendapat hak yang
--    diturunkan di bawah; PRODUKSI tetap lebih longgar dari itu. Menyamakannya
--    = REVOKE di DB hidup = keputusan terpisah, gerbang owner.
--
-- IDEMPOTEN: GRANT pada hak yang sudah dipegang adalah no-op. Aman dijalankan
-- pada produksi dan `-rlsstg` yang sudah punya haknya.
--
-- ────────────────────────────────────────────────────────────────────────────
-- TURUNAN HAK — dari PEMAKAIAN, bukan borongan. Empat tabel pertama tidak
-- digerakkan kode kita melainkan oleh `@auth/pg-adapter`; turunannya dibaca
-- dari sumber adapter (node_modules/@auth/pg-adapter/index.js), bukan ditebak.
--
--   users               SELECT INSERT UPDATE DELETE
--                       adapter: createUser · getUser* (4× select) · updateUser
--                       · deleteUser. Kode kita hanya membaca (JOIN membership).
--   sessions            SELECT INSERT UPDATE DELETE
--                       adapter: createSession · getSessionAndUser · update
--                       · deleteSession (2× delete).
--   accounts            SELECT INSERT        DELETE
--                       adapter: linkAccount (insert) · unlinkAccount (delete)
--                       · getUserByAccount (`join accounts a on u.id = a.…`).
--                       TANPA UPDATE — adapter tak pernah meng-UPDATE accounts.
--   verification_token  SELECT INSERT        DELETE
--                       adapter: createVerificationToken (insert) ·
--                       useVerificationToken (`delete … RETURNING identifier,
--                       expires, token`). SELECT-nya BUKAN hiasan: RETURNING
--                       menuntut SELECT atas kolom yang dikembalikan.
--                       TANPA UPDATE — token dipakai lalu dihapus.
--
--   membership          SELECT INSERT UPDATE DELETE
--                       admin-actions.ts: insert (undang) · delete (cabut) ·
--                       update all_units · update status; auth-context.ts:
--                       insert (self-provision super_admin).
--   user_unit           SELECT INSERT        DELETE
--                       admin-actions.ts mengganti daftar unit dengan
--                       DELETE-lalu-INSERT. TANPA UPDATE — tak ada satu pun
--                       `UPDATE app.user_unit` di kode.
--   tenant              SELECT
--                       Hanya dibaca (11× FROM, 3× JOIN); tak ada satu pun DML
--                       di kode non-uji. Tenant baru lahir dari migrasi/seed.
--
-- ⚠️ YANG SAYA RAGUKAN, DISEBUT APA ADANYA (haknya sengaja diberi lebih SEMPIT):
--   · `accounts` UPDATE dan `verification_token` UPDATE tidak diberikan. Dasarnya
--     versi @auth/pg-adapter yang terpasang HARI INI. Versi adapter yang lain
--     bisa berperilaku lain; kalau login gagal dengan 42501 sesudah upgrade
--     adapter, di sinilah tempat melihatnya.
--   · `tenant` INSERT/UPDATE tidak diberikan. Kalau kelak tenant ke-8
--     didaftarkan LEWAT APLIKASI (bukan migrasi), hak itu harus ditambah sadar —
--     dan gagalnya akan berbunyi jelas, bukan diam.
--   · `user_unit` UPDATE tidak diberikan; pola DELETE-lalu-INSERT-nya tertulis
--     di admin-actions.ts dan penjaga `hak-dml.guard.test.ts` akan memerah bila
--     ada yang menambahkan UPDATE tanpa menambah haknya.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    -- Digerakkan @auth/pg-adapter
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."users"              TO dashboard_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."sessions"           TO dashboard_app;
    GRANT SELECT, INSERT,         DELETE ON "app"."accounts"           TO dashboard_app;
    GRANT SELECT, INSERT,         DELETE ON "app"."verification_token" TO dashboard_app;

    -- Digerakkan kode kita (RBAC / multi-tenant)
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."membership"         TO dashboard_app;
    GRANT SELECT, INSERT,         DELETE ON "app"."user_unit"          TO dashboard_app;
    GRANT SELECT                         ON "app"."tenant"             TO dashboard_app;

    -- Sequence: tanpa ini INSERT gagal di DB baru meski GRANT tabelnya lengkap,
    -- dan gagalnya terbaca seperti masalah lain.
    --
    -- SENGAJA TIGA NAMA, BUKAN `ALL SEQUENCES IN SCHEMA app`. Alasannya sama
    -- dengan penolakan default privileges: borongan memberi hak pada barang yang
    -- belum ada, dan penulis migrasi berikutnya tak akan tahu haknya sudah
    -- terberi. Himpunannya DIPERIKSA, bukan ditebak — pada `-rlsstg` 19 Agu 2026
    -- skema `app` memang berisi TEPAT tiga sequence, dan ketiganya milik tabel
    -- di bawah (`users`/`accounts`/`sessions` ber-`autoincrement()`; `tenant`
    -- dan `membership` ber-UUID, `user_unit` dan `verification_token` ber-PK
    -- komposit — ketiganya tak punya sequence sama sekali).
    --
    -- Kalau salah satu nama ini tak ada, migrasi GAGAL KERAS dan CD berhenti.
    -- Itu disengaja: melewatkannya diam-diam akan menghasilkan DB yang lulus
    -- migrasi lalu menolak INSERT pertama.
    GRANT USAGE, SELECT ON SEQUENCE "app"."users_id_seq"    TO dashboard_app;
    GRANT USAGE, SELECT ON SEQUENCE "app"."accounts_id_seq" TO dashboard_app;
    GRANT USAGE, SELECT ON SEQUENCE "app"."sessions_id_seq" TO dashboard_app;
  END IF;
END
$$;
