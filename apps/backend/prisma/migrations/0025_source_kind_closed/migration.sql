-- 0025_source_kind_closed — `source_kind` jadi DAFTAR TERTUTUP pada kedua tabel
-- append-only koreksi/reklasifikasi (0021).
--
-- Latar keputusan owner 12 Agu 2026: taut ke transaksi asli sengaja POLIMORFIK
-- (tanpa FOREIGN KEY), sebab model keuangan SUDAH berkomitmen pada buku kas
-- besar, lima buku bank, dan settlement EDC sebagai ledger terpisah (§1.3–§1.4).
-- Sumber kedua bukan kemungkinan, ia jadwal. FK ke `manual_entry` hari ini
-- berarti mencabutnya nanti — migrasi di tabel yang sudah berisi entri koreksi,
-- persis kelas pekerjaan yang gerbang §9 dibuat untuk mencegah.
--
-- ⛔ Tetapi "tanpa FK" TIDAK berarti "tanpa integritas". Dua penjaga:
--   1. di sini — `source_kind` hanya boleh bernilai dari daftar tertutup;
--   2. di aplikasi — penjaga YATIM (`keuangan-integritas.ts`) yang menemukan
--      baris yang `source_txn_id`-nya tidak ada di tabel yang ditunjuk.
--      Penjaga 1 mencegah salah ketik jenis; penjaga 2 mencegah taut yang
--      menunjuk ke ketiadaan. Keduanya perlu — satu tidak menggantikan yang lain.
--
-- 🔴 MENAMBAH NILAI KE DAFTAR INI = MENAMBAH SUMBER YANG BISA DIKOREKSI, dan itu
-- KEPUTUSAN OWNER, bukan keputusan pelaksana. Kalau ledger kedua lahir,
-- `source_kind` bertambah DAN penjaga yatim harus ikut diperluas DI PR YANG
-- SAMA — bukan menyusul. Penjaga yang tertinggal satu rilis adalah penjaga yang
-- buta terhadap justru sumber yang baru.
--
-- Hari ini isinya TEPAT SATU nilai: 'manual_entry'.
--
-- Idempoten / aman re-run.

ALTER TABLE "app"."reclassification" DROP CONSTRAINT IF EXISTS "reclassification_source_kind";
ALTER TABLE "app"."reclassification" ADD CONSTRAINT "reclassification_source_kind" CHECK (
    "source_kind" IN ('manual_entry')
);

ALTER TABLE "app"."correction_entry" DROP CONSTRAINT IF EXISTS "correction_entry_source_kind";
ALTER TABLE "app"."correction_entry" ADD CONSTRAINT "correction_entry_source_kind" CHECK (
    "source_kind" IN ('manual_entry')
);
