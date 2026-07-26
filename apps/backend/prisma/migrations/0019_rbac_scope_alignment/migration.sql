-- 0019_rbac_scope_alignment — penugasan peran ber-scope (multi-unit / multi-tenant).
--
-- Desain lengkap + bukti rehearsal: session-notes/rbac-scope-design.md (GATE 1).
-- Empat perubahan struktural, semuanya di-DESAIN agar akses efektif 12 membership
-- yang hidup TIDAK bergeser satu unit pun (lihat §3 dokumen desain):
--
--   1. public.unit          — tenant WAJIB + kunci komposit (unit_id, tenant_id)
--   2. app.user_role        — invarian "satu role per orang", DEKLARATIF (FK komposit)
--   3. app.membership       — all_units eksplisit; unique (user_id,tenant_id) NULLS NOT DISTINCT
--   4. app.user_unit        — tenant_id + FK komposit ke DUA sisi ⇒ penugasan
--                             lintas-tenant MUSTAHIL SECARA SKEMA (bukan divalidasi)
--
-- ⚠️ URUTAN DEPLOY: MIGRASI DULU, image kemudian (kebalikan 0016). Skema baru adalah
--    superset yang DIABAIKAN image lama (image lama tak menyebut kolom baru), sedangkan
--    image baru TIDAK BISA hidup tanpa `all_units`. Prinsip pembeda: migrasi-dulu bila
--    skema baru superset yang diabaikan image lama; image-dulu bila migrasi MENGAKTIFKAN
--    penegakan yang image lama tak bisa penuhi (itu kasus 0016/RLS).
--
-- ⚠️ TIDAK menyentuh pengecualian RLS 0016: public.unit dan app.user_unit tetap TANPA
--    RLS — keduanya dibaca SEBELUM konteks ada, untuk membangun scope itu sendiri.
--
-- Rollback teruji: apps/backend/scripts/rbac-scope-rollback.sql (jalankan sebagai
-- `ingest`, SETELAH image lama dikembalikan melayani traffic).
--
-- PRASYARAT PRIVILEGE: role `ingest` butuh CREATE pada schema `public` (ADD CONSTRAINT
-- ... UNIQUE membuat index). Live sudah punya; instance test perlu sekali:
--     GRANT CREATE ON SCHEMA public TO ingest;   -- sebagai postgres

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. GUARD — prasyarat data. Salah satu meleset ⇒ transaksi abort, BUKAN
--    "diperbaiki sambil jalan". Migrasi yang menebak lebih buruk dari yang gagal.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.unit WHERE tenant_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '0019 batal: % unit tanpa tenant_id — tetapkan dulu', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT user_id FROM app.membership GROUP BY user_id HAVING count(DISTINCT role) > 1
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '0019 batal: % pengguna punya role BERBEDA antar-membership; '
                    'invarian satu-role-per-orang harus diselesaikan manual dulu', n;
  END IF;

  SELECT count(*) INTO n
    FROM app.user_unit uu
    JOIN app.membership m ON m.id = uu.membership_id
    JOIN public.unit un  ON un.unit_id = uu.unit_id
   WHERE un.tenant_id IS DISTINCT FROM m.tenant_id;
  IF n > 0 THEN
    RAISE EXCEPTION '0019 batal: % baris user_unit lintas-tenant (phantom grant) — '
                    'bersihkan dulu, FK komposit akan menolaknya', n;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. public.unit — tenant WAJIB + kunci komposit (target FK sisi unit)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "public"."unit" ALTER COLUMN "tenant_id" SET NOT NULL;

-- ON DELETE SET NULL bertabrakan dengan NOT NULL: menghapus tenant yang masih
-- punya unit harus DITOLAK, bukan diam-diam meyatimkan unit.
ALTER TABLE "public"."unit" DROP CONSTRAINT "unit_tenant_id_fkey";
ALTER TABLE "public"."unit" ADD CONSTRAINT "unit_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "public"."unit" ADD CONSTRAINT "unit_unit_id_tenant_id_key"
  UNIQUE ("unit_id", "tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. app.user_role — "satu role per orang" sebagai KONSEKUENSI KUNCI
--
-- user_role punya TEPAT SATU baris per user (PK user_id). FK komposit di bawah
-- memaksa (user_id, role) setiap membership menunjuk baris tunggal itu ⇒ invarian
-- lintas-baris — yang biasanya tak deklaratif di Postgres — menjadi konsekuensi
-- kunci, bukan trigger yang bisa di-DISABLE atau cek aplikasi yang bisa lupa.
-- Bonus: ubah role = SATU UPDATE di sini; ON UPDATE CASCADE merambatkannya.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE "app"."user_role" (
  "user_id" INTEGER NOT NULL,
  "role"    TEXT    NOT NULL,
  CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_role_role_check"
    CHECK ("role" IN ('super_admin', 'admin_perusahaan', 'direksi', 'pengawas')),
  CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "app"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  -- target FK komposit dari membership (butuh UNIQUE eksplisit, PK saja tak cukup)
  CONSTRAINT "user_role_user_id_role_key" UNIQUE ("user_id", "role")
);

-- Aman karena guard §0 sudah menuntut count(DISTINCT role) = 1 per pengguna.
INSERT INTO "app"."user_role" ("user_id", "role")
SELECT "user_id", min("role") FROM "app"."membership" GROUP BY "user_id";

ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_user_id_role_fkey"
  FOREIGN KEY ("user_id", "role") REFERENCES "app"."user_role"("user_id", "role")
  ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. app.membership — all_units eksplisit + perbaikan unique NULL
-- ═══════════════════════════════════════════════════════════════════════════
-- DEFAULT false DISENGAJA: himpunan kosong TIDAK PERNAH berarti "semua unit".
-- Membalik makna itu akan melebarkan setiap pengawas terbatas yang sudah ada
-- secara senyap — kelas kegagalan terburuk dari perubahan ini.
ALTER TABLE "app"."membership" ADD COLUMN "all_units" BOOLEAN NOT NULL DEFAULT false;

-- Pemetaan TEPAT aturan lama → aturan baru:
--   lama: pengawas ⇒ user_unit;  role lain ⇒ semua unit tenant
--   baru: all_units=false ⇒ user_unit;  all_units=true ⇒ semua unit tenant
UPDATE "app"."membership" SET "all_units" = ("role" <> 'pengawas');

-- POST-CONDITION: akses efektif TIDAK BOLEH bergeser satu unit pun.
-- Bandingkan himpunan unit terlihat menurut aturan LAMA (role='pengawas' ⇒ user_unit)
-- vs aturan BARU (all_units) untuk SETIAP membership, sebagai ARRAY terurut — bukan
-- count(), yang bisa cocok kebetulan padahal himpunannya beda. Pelebaran akses senyap
-- adalah kegagalan terburuk perubahan ini; di sini ia MEMBATALKAN migrasi.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM "app"."membership" m
  WHERE m."tenant_id" IS NOT NULL
    AND COALESCE((SELECT array_agg(x.unit_id ORDER BY x.unit_id) FROM public.unit x
                   WHERE x.active AND x.tenant_id = m."tenant_id"
                     AND (m."role" <> 'pengawas'
                          OR EXISTS (SELECT 1 FROM "app"."user_unit" uu
                                      WHERE uu.membership_id = m."id" AND uu.unit_id = x.unit_id))), '{}')
     IS DISTINCT FROM
        COALESCE((SELECT array_agg(x.unit_id ORDER BY x.unit_id) FROM public.unit x
                   WHERE x.active AND x.tenant_id = m."tenant_id"
                     AND (m."all_units"
                          OR EXISTS (SELECT 1 FROM "app"."user_unit" uu
                                      WHERE uu.membership_id = m."id" AND uu.unit_id = x.unit_id))), '{}');
  IF bad > 0 THEN
    RAISE EXCEPTION '0019 batal: backfill all_units MENGGESER akses efektif % membership', bad;
  END IF;
END $$;

-- Unique lama menganggap NULL saling berbeda ⇒ ON CONFLICT (user_id, tenant_id)
-- pada bootstrap super_admin TIDAK PERNAH cocok ⇒ baris ganda saat balapan.
-- (Dibuktikan di GATE 0: dua INSERT identik menghasilkan 2 baris.) PG 15+ .
DROP INDEX "app"."membership_user_id_tenant_id_key";
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_user_id_tenant_id_key"
  UNIQUE NULLS NOT DISTINCT ("user_id", "tenant_id");

-- Target FK komposit sisi membership.
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_id_tenant_id_key"
  UNIQUE ("id", "tenant_id");

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. app.user_unit — keselarasan unit↔tenant MUSTAHIL SECARA SKEMA
--
-- tenant_id hanya satu kolom, jadi hanya ada tiga isi yang mungkin dan ketiganya
-- tertutup:
--   tenant UNIT (jujur)          → FK sisi membership menolak (membership bukan di situ)
--   tenant MEMBERSHIP (palsu)    → FK sisi unit menolak       (unit bukan di situ)
--   tenant ketiga apa pun        → keduanya menolak
-- Tak ada nilai yang lolos. Karena itu cek tenant di aplikasi (scope-rule.ts)
-- turun status menjadi redundansi murah, bukan gerbang tunggal.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "app"."user_unit" ADD COLUMN "tenant_id" UUID;

UPDATE "app"."user_unit" uu SET "tenant_id" = m."tenant_id"
  FROM "app"."membership" m WHERE m."id" = uu."membership_id";

ALTER TABLE "app"."user_unit" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "app"."user_unit" DROP CONSTRAINT "user_unit_unit_id_fkey";
ALTER TABLE "app"."user_unit" DROP CONSTRAINT "user_unit_membership_id_fkey";

ALTER TABLE "app"."user_unit" ADD CONSTRAINT "user_unit_unit_tenant_fkey"
  FOREIGN KEY ("unit_id", "tenant_id") REFERENCES "public"."unit"("unit_id", "tenant_id")
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "app"."user_unit" ADD CONSTRAINT "user_unit_membership_tenant_fkey"
  FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "app"."membership"("id", "tenant_id")
  ON UPDATE CASCADE ON DELETE CASCADE;

-- Mekanisme DEFAULT, BUKAN kontrol keamanan (penegaknya kedua FK di atas).
-- Dua gunanya: (i) jendela deploy "skema baru + image lama" tidak kehilangan fungsi
-- apa pun — image lama menulis user_unit tanpa tenant_id dan tetap berhasil;
-- (ii) tenant_id tak bisa dipalsukan karena penulis mana pun boleh mengabaikannya.
-- Menghapus trigger ini TIDAK melemahkan isolasi; ia hanya membuat kolomnya wajib
-- diisi eksplisit.
CREATE FUNCTION "app"."user_unit_fill_tenant"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."tenant_id" IS NULL THEN
    SELECT "tenant_id" INTO NEW."tenant_id" FROM "app"."membership" WHERE "id" = NEW."membership_id";
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "user_unit_fill_tenant" BEFORE INSERT ON "app"."user_unit"
  FOR EACH ROW EXECUTE FUNCTION "app"."user_unit_fill_tenant"();

COMMENT ON TRIGGER "user_unit_fill_tenant" ON "app"."user_unit" IS
  'Mekanisme DEFAULT, bukan kontrol keamanan: mengisi tenant_id dari membership bila '
  'penulis mengabaikannya. Penegak keselarasan unit<->tenant adalah kedua FK komposit '
  '(user_unit_unit_tenant_fkey + user_unit_membership_tenant_fkey), bukan trigger ini.';

COMMENT ON COLUMN "app"."user_unit"."tenant_id" IS
  'Turunan dari membership; ada semata agar FK komposit ke DUA sisi bisa mengunci '
  'keselarasan unit<->tenant secara struktural. Jangan diisi tangan — trigger mengisinya.';

COMMENT ON COLUMN "app"."membership"."all_units" IS
  'true = semua unit tenant ini (unit BARU ikut otomatis); false = hanya daftar di '
  'user_unit (beku, unit baru TIDAK ikut). Himpunan user_unit kosong TIDAK PERNAH '
  'berarti "semua" — default false = DENY.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. app.audit_log — kolom tenant + backfill (pembaca ber-scope)
--
-- Append-only TIDAK dilonggarkan: UPDATE di bawah dijalankan oleh migrasi sebagai
-- role `ingest` (pemilik tabel); grant dashboard_app tetap SELECT+INSERT saja.
-- ═══════════════════════════════════════════════════════════════════════════
-- IF NOT EXISTS disengaja: rollback SENGAJA tidak membuang kolom ini (append-only,
-- dan kolom tambahan tak mengganggu image lama). Tanpa ini, urutan
-- pasang → rollback → pasang-lagi GAGAL di sini — ditemukan saat menjalankan
-- rollback-nya, bukan saat menulisnya.
ALTER TABLE "app"."audit_log" ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

UPDATE "app"."audit_log"
   SET "tenant_id" = ("detail"->>'tenant_id')::uuid
 WHERE "tenant_id" IS NULL AND ("detail" ? 'tenant_id');

-- revoke_access tak membawa tenant_id (membership-nya sudah dihapus) — pulihkan
-- dari baris grant untuk membership yang sama.
UPDATE "app"."audit_log" r
   SET "tenant_id" = g."tenant_id"
  FROM "app"."audit_log" g
 WHERE r."tenant_id" IS NULL
   AND g."tenant_id" IS NOT NULL
   AND r."detail"->>'membership_id' = g."detail"->>'membership_id';

CREATE INDEX IF NOT EXISTS "audit_log_tenant_id_idx" ON "app"."audit_log" ("tenant_id");

COMMENT ON COLUMN "app"."audit_log"."tenant_id" IS
  'Tenant yang disentuh aksi ini. NULL = aksi global ⇒ hanya terlihat super_admin '
  '(fail-closed untuk pembaca admin terdelegasi).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Grant untuk role aplikasi (pola 0017 — idempoten, aman bila role belum ada)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."user_role" TO dashboard_app;
    -- audit_log TETAP append-only (0017): tegaskan ulang setelah ADD COLUMN.
    REVOKE UPDATE, DELETE ON "app"."audit_log" FROM dashboard_app;
  END IF;
END
$$;
