-- 0055_pihak_lawan_unit_baru — unit SolaMax yang lahir SESUDAH 0049 ikut mendapat
-- pihak lawannya, OTOMATIS (temuan tinjauan kode #3; keputusan owner 29 Okt 2026:
-- trigger otomatis, bukan langkah runbook).
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
--
-- MASALAHNYA: seed 0049 hanya berjalan SEKALI, atas unit yang ada saat itu. Unit
-- kedelapan yang di-provision sesudahnya (runbook STEP 1: `INSERT INTO
-- public.unit`) tidak punya pihak lawan berjenis `unit` ke unit lain, unit lain
-- tak punya pihak lawan ke dia, dan dia tak punya "Outlet Bright" — padahal layar
-- dan pesan galat (`pihak-lawan-actions.ts`, `PihakLawanPanel.tsx`) berjanji
-- "Unit SolaMax sudah tersedia otomatis". Pasangan antar unit ke unit baru itu
-- mustahil dicatat, dan tak ada yang berbunyi.
--
--   app.pihak_lawan_pastikan_unit() — ensure IDEMPOTEN atas SEMUA unit: isi yang
--                                     sama persis dengan seed 0049, lalu BUKTIKAN
--   public.unit AFTER INSERT        — memanggilnya untuk unit baru
--   public.unit BEFORE DELETE       — melepas baris semaian (lihat butir 4)
--   + satu panggilan backfill di bawah untuk pasangan yang sudah terlanjur bolong
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **RLS dipenuhi dengan scope, BUKAN dengan melonggarkan policy.** pihak_lawan
--    ber-FORCE RLS (0049) dan peran migrasi/pemilik (`ingest`) TIDAK ber-
--    BYPASSRLS — tanpa `app.unit_ids`, INSERT dari trigger ditolak `42501`
--    (WITH CHECK) dan pemeriksaan bukti memulangkan nol baris TANPA galat.
--    Fungsi memasang scope = seluruh `public.unit` (tak ber-RLS, 0016/0019) lewat
--    `set_config(..., true)`, lalu MEMULIHKAN nilai pemanggil sebelum keluar —
--    pola backfill `cash_account` di 0049. Bila fungsi keluar lewat galat,
--    pernyataan pemanggil ikut gagal dan perubahan GUC lokal ikut dibatalkan
--    bersama transaksi/savepoint-nya; scope lebar tak pernah bocor ke pernyataan
--    pemanggil berikutnya.
--    ⛔ Jangan "merapikan" jadi klausa `SET "app.unit_ids" = ''` pada definisi
--    fungsi: untuk GUC placeholder, CREATE FUNCTION ... SET oleh non-superuser
--    ditolak `permission denied to set parameter` (dibuktikan di Postgres 16
--    sekali-pakai, 29 Okt 2026) — migrasi akan gagal di `migrate deploy`.
--
-- 2. **SECURITY INVOKER, bukan DEFINER.** Satu-satunya yang menulis public.unit
--    adalah `ingest` (pemilik tabel; `dashboard_app` tak punya INSERT/DELETE atas
--    public.unit) — ia sudah berhak penuh atas app.pihak_lawan. DEFINER tak
--    menambah apa-apa terhadap RLS (FORCE berlaku juga untuk pemilik), hanya
--    menambah permukaan. Fungsi tak membaca masukan pemanggil apa pun: semua
--    nilai diturunkan dari public.unit.
--
-- 3. **Isi = seed 0049, persis.** Kolom/nilai yang sama (`jenis 'unit'`, nama =
--    nama unit lawan, `aktif` = `active` unit lawan, `created_by_user_id` NULL =
--    semaian; `'titipan'` "Outlet Bright"), ON CONFLICT DO NOTHING pada unique
--    yang ada. Ensure berjalan atas SEMUA pasangan, bukan hanya unit baru —
--    lebih sederhana dan idempoten; jumlah unit satu digit. Sesudahnya bukti yang
--    sama dengan 0049: pasangan yang tetap bolong (bentrok nama — ON CONFLICT
--    menelannya tanpa suara) ⇒ RAISE, sehingga INSERT unit-nya GAGAL KERAS. Lebih
--    baik provisioning berhenti di STEP 1 daripada unit hidup tanpa pasangan.
--
-- 4. **BEFORE DELETE melepas baris SEMAIAN saja** (`created_by_user_id IS NULL`):
--    pihak lawan unit lain yang menunjuk unit itu, dan semaian milik unit itu
--    sendiri. Tanpa ini, setiap DELETE unit (rollback runbook STEP 1; unit fiktif
--    uji live B3/B4 yang dibersihkan sesudahnya) jatuh di FK
--    `pihak_lawan_lawan_unit_fk`. Baris semaian yang SUDAH DIPAKAI (baris kas,
--    saldo pembuka, setoran titipan menunjuknya) tak bisa dihapus — FK-nya
--    menggagalkan seluruh DELETE unit. Itu disengaja: unit yang punya riwayat
--    keuangan tidak boleh dihapus; nonaktifkan (`active = false`).
--
-- ⚠️ Yang TIDAK dilakukan, sebut apa adanya: perubahan NAMA atau `active` unit
-- sesudah lahir TIDAK disalin ke pihak lawannya (sama seperti 0049).
--
-- Tanpa tabel baru, tanpa model Prisma baru (trigger tak dimodelkan Prisma).
-- Idempoten / aman re-run.

CREATE OR REPLACE FUNCTION "app"."pihak_lawan_pastikan_unit"()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  scope_lama text := current_setting('app.unit_ids', true);
  n bigint;
BEGIN
  PERFORM set_config('app.unit_ids',
    COALESCE((SELECT string_agg("unit_id"::text, ',' ORDER BY "unit_id") FROM "public"."unit"), ''),
    true
  );
  IF COALESCE(current_setting('app.unit_ids', true), '') = ''
     AND EXISTS (SELECT 1 FROM "public"."unit")
  THEN
    RAISE EXCEPTION 'pihak_lawan_pastikan_unit: app.unit_ids kosong padahal public.unit berisi — '
                    'ensure akan menyentuh nol baris tanpa galat';
  END IF;

  INSERT INTO "app"."pihak_lawan" ("unit_id", "jenis", "nama", "lawan_unit_id", "aktif")
  SELECT "u"."unit_id", 'unit', "lawan"."name", "lawan"."unit_id", "lawan"."active"
    FROM "public"."unit" "u"
    JOIN "public"."unit" "lawan" ON "lawan"."unit_id" <> "u"."unit_id"
  ON CONFLICT DO NOTHING;

  INSERT INTO "app"."pihak_lawan" ("unit_id", "jenis", "nama")
  SELECT "u"."unit_id", 'titipan', 'Outlet Bright'
    FROM "public"."unit" "u"
  ON CONFLICT DO NOTHING;

  -- Bukti (pola 0049): ON CONFLICT menelan bentrok nama tanpa suara.
  SELECT count(*) INTO n
    FROM "public"."unit" "u"
    JOIN "public"."unit" "lawan" ON "lawan"."unit_id" <> "u"."unit_id"
   WHERE NOT EXISTS (
     SELECT 1 FROM "app"."pihak_lawan" "p"
      WHERE "p"."unit_id" = "u"."unit_id" AND "p"."lawan_unit_id" = "lawan"."unit_id"
   );
  IF n > 0 THEN
    RAISE EXCEPTION 'pihak_lawan_pastikan_unit: % pasangan unit tanpa pihak lawan berjenis unit '
                    '(nama unit bentrok dengan pihak lawan yang ada?) — selesaikan dulu', n;
  END IF;

  SELECT count(*) INTO n
    FROM "public"."unit" "u"
   WHERE NOT EXISTS (
     SELECT 1 FROM "app"."pihak_lawan" "p"
      WHERE "p"."unit_id" = "u"."unit_id" AND "p"."jenis" = 'titipan' AND "p"."nama" = 'Outlet Bright'
   );
  IF n > 0 THEN
    RAISE EXCEPTION 'pihak_lawan_pastikan_unit: % unit tanpa pihak lawan titipan "Outlet Bright" '
                    '(nama "Outlet Bright" dipakai jenis lain?) — selesaikan dulu', n;
  END IF;

  PERFORM set_config('app.unit_ids', COALESCE(scope_lama, ''), true);
END
$fn$;

CREATE OR REPLACE FUNCTION "app"."unit_pihak_lawan_otomatis"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM "app"."pihak_lawan_pastikan_unit"();
  RETURN NULL; -- AFTER ... FOR EACH STATEMENT: nilai balik diabaikan
END
$fn$;

-- FOR EACH STATEMENT: ensure atas SEMUA pasangan cukup sekali per pernyataan,
-- berapa pun baris unit yang disisipkan sekaligus.
DROP TRIGGER IF EXISTS "unit_pihak_lawan_otomatis" ON "public"."unit";
CREATE TRIGGER "unit_pihak_lawan_otomatis"
    AFTER INSERT ON "public"."unit"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "app"."unit_pihak_lawan_otomatis"();

CREATE OR REPLACE FUNCTION "app"."unit_pihak_lawan_lepas"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  scope_lama text := current_setting('app.unit_ids', true);
BEGIN
  PERFORM set_config('app.unit_ids',
    COALESCE((SELECT string_agg("unit_id"::text, ',' ORDER BY "unit_id") FROM "public"."unit"), ''),
    true
  );
  -- Hanya semaian (created_by_user_id IS NULL). Bila salah satunya sudah
  -- dirujuk baris kas / saldo pembuka / setoran titipan, FK-nya menggagalkan
  -- DELETE ini — dan karenanya DELETE unit seluruhnya (keputusan 4).
  DELETE FROM "app"."pihak_lawan"
   WHERE "created_by_user_id" IS NULL
     AND ("lawan_unit_id" = OLD."unit_id"
          OR ("unit_id" = OLD."unit_id"
              AND ("jenis" = 'unit' OR ("jenis" = 'titipan' AND "nama" = 'Outlet Bright'))));
  PERFORM set_config('app.unit_ids', COALESCE(scope_lama, ''), true);
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS "unit_pihak_lawan_lepas" ON "public"."unit";
CREATE TRIGGER "unit_pihak_lawan_lepas"
    BEFORE DELETE ON "public"."unit"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."unit_pihak_lawan_lepas"();

-- Backfill sekali: pasangan unit yang lahir sesudah 0049 dan sebelum trigger ini.
-- Scope dipasang & dipulihkan oleh fungsinya sendiri (keputusan 1).
SELECT "app"."pihak_lawan_pastikan_unit"();
