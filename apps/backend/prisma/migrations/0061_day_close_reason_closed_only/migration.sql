-- 0061_day_close_reason_closed_only — perbaikan CHECK `day_close_reason_required`
-- (0026). Rilis 2026-11-11.
--
-- 🔴 CACATNYA. 0026 menulis CHECK `difference_rp = 0 OR reason_code IS NOT NULL`
-- untuk SEMUA baris. Padahal baris `day_close` LAHIR berstatus `open` saat
-- Layar 4 dibuka (`pastikanBarisDayClose`, §10.15) — dan pada saat itu belum
-- ada yang memilih kode alasan; kode dipilih SAAT MENUTUP (`tutupHari`). Jadi
-- setiap hari dengan selisih bukan nol gagal mendapat barisnya (23514), galatnya
-- ditelan, dan `tutupHari` menolak "belum punya baris penilaian". Akibatnya:
-- `day_close` 0 baris di ketujuh unit; tak satu pun hari berselisih bisa ditutup.
--
-- ✅ PERBAIKANNYA. Kewajiban §4.6 ("reason_code WAJIB bila selisih bukan nol")
-- adalah syarat PENUTUPAN, jadi ia berlaku pada baris `closed` saja. Baris `open`
-- adalah penilaian berjalan, bukan keputusan. Ini idiom yang sama dengan
-- `day_close_approval_required` di 0026 (`… OR "status" = 'open' OR …`).
--
-- Constraint 0026 lainnya TIDAK disentuh dan sudah diperiksa tidak menolak
-- baris `open` berselisih tanpa alasan:
--   · reason_shadow      — kode & bayangan sama-sama NULL ⇒ lolos.
--   · target_required/target_clean — tanpa kode ⇒ target NULL ⇒ lolos.
--   · tier_matches_difference — tier selalu dari `tierFor()` ⇒ lolos (tetap dijaga).
--   · approval_required  — sudah membebaskan `status = 'open'`.
--   · approval_clean / closed_audit — tak bergantung pada alasan.
--
-- ⛔ 0026 TIDAK DISUNTING — checksum `prisma migrate deploy`.
--
-- Aman: hanya MELONGGARKAN untuk baris `open`; baris `closed` tetap dituntut
-- persis seperti sebelumnya. Tak ada baris lama yang bisa melanggar CHECK baru
-- (CHECK lama lebih ketat). Idempoten / aman re-run.
--
-- ROLLBACK (jalankan sebagai role pemilik `ingest`; gagal bila sudah ada baris
-- `open` berselisih tanpa alasan — itu memang bentuk cacat lama):
--   ALTER TABLE "app"."day_close" DROP CONSTRAINT IF EXISTS "day_close_reason_required";
--   ALTER TABLE "app"."day_close" ADD CONSTRAINT "day_close_reason_required"
--     CHECK ("difference_rp" = 0 OR "reason_code" IS NOT NULL);

ALTER TABLE "app"."day_close" DROP CONSTRAINT IF EXISTS "day_close_reason_required";
ALTER TABLE "app"."day_close" ADD CONSTRAINT "day_close_reason_required" CHECK (
    "status" <> 'closed' OR "difference_rp" = 0 OR "reason_code" IS NOT NULL
);
