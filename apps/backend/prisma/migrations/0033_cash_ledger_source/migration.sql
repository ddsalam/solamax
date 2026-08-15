-- 0033_cash_ledger_source — tautan dari baris buku kas ke setoran pengawas
-- yang MELAHIRKANNYA.
--
-- Konteks (Layar 3 blok 2, mockup): nilai setoran per shift SUDAH diketahui
-- SolaMax — pengawas mengisinya di Rincian Penjualan (`app.manual_entry`,
-- section `setoran_tunai`). Mengetiknya ulang di buku kas berarti dua orang
-- mengetik angka yang sama dan berselisih diam-diam.
--
-- Karena itu barisnya **DITAWARKAN** dengan nominal terisi, bukan diposting
-- (§1.4). Yang lahir di buku kas hanya baris yang DISETUJUI, dan
-- `created_by_user_id` pada baris itu adalah jejak siapa menyetujuinya.
--
-- ⛔ MASALAH YANG DITUTUP KOLOM INI: tanpa tautan, "sudah pernah disetujui
-- belum?" hanya bisa ditebak dengan mencocokkan tanggal + nominal + keterangan.
-- Tebakan itu gagal justru pada kasus yang paling mungkin — dua shift dengan
-- nominal kebetulan sama — dan gagalnya ke arah yang paling mahal: setoran yang
-- sama dibukukan DUA KALI, kas terlihat lebih besar, dan tak ada satu pun
-- angka yang tampak salah.
--
-- Indeks unik parsial di bawah membuat "satu setoran = satu baris kas" menjadi
-- KONSEKUENSI SKEMA, bukan kedisiplinan aplikasi.
--
-- FK LANGSUNG ke `app.manual_entry`, bukan polimorfik. Alasannya sama dengan
-- 0031: sumber kedua belum ada, dan polimorfisme yang dibangun untuk pemakai
-- yang belum ada adalah beban yang dibayar sekarang untuk kemungkinan nanti.
--
-- Tidak ada tabel baru, tidak ada seed, dan RLS `app.cash_ledger` sudah aktif
-- sejak 0029 — menambah kolom tidak mengubah kebijakannya (§4.1b).
--
-- Idempoten / aman re-run.

ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "source_manual_entry_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_source_manual_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_source_manual_fk"
      FOREIGN KEY ("source_manual_entry_id") REFERENCES "app"."manual_entry"("id");
  END IF;
END
$$;

-- SATU setoran pengawas = PALING BANYAK SATU baris kas aktif.
-- `WHERE NOT void` disengaja: baris yang dibatalkan harus boleh diganti dengan
-- baris baru dari setoran yang sama — pembatalan yang tak bisa diperbaiki
-- mendorong orang membuat baris kembar bernominal sama sebagai gantinya.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_ledger_source_manual_uq"
    ON "app"."cash_ledger"("source_manual_entry_id")
    WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void";

-- Jalur baca "tawaran mana yang sudah diterima" untuk satu unit+tanggal.
CREATE INDEX IF NOT EXISTS "cash_ledger_source_manual_idx"
    ON "app"."cash_ledger"("unit_id", "business_date")
    WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void";
