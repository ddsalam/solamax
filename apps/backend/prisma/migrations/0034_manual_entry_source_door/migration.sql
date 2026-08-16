-- 0034_manual_entry_source_door — PINTU MANA yang melahirkan baris biaya.
--
-- §2.4: biaya operasional & pendapatan lain-lain punya DUA pintu masuk —
-- pengawas (Rincian Penjualan) dan Finance (yang tidak lewat pengawas) — dengan
-- SATU daftar kategori. Layar 3 blok 4 menampilkan keping asal-usul tiap baris,
-- dan keping itu harus benar bertahun-tahun kemudian.
--
-- ⛔ KENAPA KOLOM, BUKAN TURUNAN. Godaannya adalah menurunkan asal-usul dari
-- peran `created_by_user_id` saat dibaca. Itu SALAH, dan salahnya senyap: peran
-- orang berubah. Seorang pengawas yang kelak diangkat jadi staf keuangan akan
-- membuat SELURUH baris lamanya berubah asal-usul secara surut — sejarah yang
-- ditulis ulang oleh perubahan yang tak ada hubungannya dengan baris itu.
--
-- Asal-usul adalah FAKTA SAAT PENULISAN. Ia direkam sekali, lalu beku.
--
-- DEFAULT 'pengawas' + NOT NULL: seluruh baris yang sudah ada memang lahir dari
-- Rincian Penjualan — satu-satunya pintu yang pernah ada sampai hari ini. Sejak
-- PostgreSQL 11 penambahan kolom ber-DEFAULT tidak menulis ulang tabel, jadi ini
-- aman untuk `app.manual_entry` yang berisi data pengawas bertahun-tahun.
--
-- ⚠️ Ini SATU-SATUNYA migrasi K2 yang menyentuh tabel yang sudah dipakai
-- produksi. Dampaknya diperiksa terpisah di tinjauan pra-promosi.
--
-- Idempoten / aman re-run.

ALTER TABLE "app"."manual_entry"
    ADD COLUMN IF NOT EXISTS "source_door" TEXT NOT NULL DEFAULT 'pengawas';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_source_door_check') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_source_door_check"
      CHECK ("source_door" IN ('pengawas', 'finance'));
  END IF;
END
$$;

-- Jalur baca blok 4: baris satu unit+tanggal, dipisah per pintu.
CREATE INDEX IF NOT EXISTS "manual_entry_source_door_idx"
    ON "app"."manual_entry"("unit_id", "business_date", "source_door")
    WHERE NOT "void";

-- Catatan untuk yang menambah pintu KETIGA kelak: daftarnya ada di CHECK di
-- atas DAN di tipe `PintuBiaya` di apps/dashboard/src/lib/keuangan-biaya-model.ts.
-- Yang di TypeScript menjaga dirinya sendiri lewat Record<PintuBiaya, …>; yang
-- di sini tidak, sebab Postgres tak punya cara memberi tahu bahwa sebuah string
-- sah. Ada tes yang membandingkan keduanya dan memerah bila berselisih.
