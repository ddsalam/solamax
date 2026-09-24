-- Menandai cut sumber yang baris-barisnya SUDAH terkuras habis.
--
-- ⚠️ KENAPA INI ADA. Pemensiunan mencari baris yang layak dihapus dengan cara
-- MEMINDAI seluruh tabel sumber, dan pemindaian itu berjalan penuh justru
-- ketika tidak ada yang bisa dihapus — LIMIT baru berhenti setelah menemukan
-- cukup baris, jadi nol kecocokan berarti pindai sampai habis.
--
-- Terukur di produksi 24-09-2026, unit 7, EXPLAIN ANALYZE:
--   Seq Scan on saldo_pelanggan_source_bppiut  (actual time=177..6855)
--   Buffers: shared read=178.334        -- +-1,4 GB I/O
--   Limit                               (actual rows=0) total 7.630 ms
-- Satu unit yang TIDAK punya apa pun untuk dihapus membakar 7,6 detik pada satu
-- tabel dari tiga, lalu gagal pada timeout transaksi 30 detik. Pada hari itu
-- kegagalannya 11 kali; tiga hari sebelumnya 4 kali. Ia memburuk sendiri karena
-- tabelnya tumbuh.
--
-- Kolom ini membuat KEMAJUAN TERSIMPAN: cut yang sudah kosong tidak diperiksa
-- lagi besok. Prinsip yang sama dengan watermark-maju — pekerjaan yang sudah
-- selesai tidak boleh diulang dari nol tiap putaran.
--
-- NULL berarti "belum pernah dinyatakan kosong", bukan "berisi". Seluruh cut
-- yang ada hari ini bernilai NULL dan akan diperiksa sekali lagi pada putaran
-- pertama sesudah migrasi ini — sesudah itu daftarnya menyusut sendiri.
ALTER TABLE "app"."saldo_pelanggan_source_cycle"
    ADD COLUMN "rows_pruned_at" TIMESTAMPTZ;

-- Daftar "cut yang masih perlu dikuras" dibaca tiap putaran pemensiunan, per
-- unit. Indeks parsial ini membuatnya berhenti memindai tabel cut begitu
-- sebagian besar cut sudah bertanda kosong.
CREATE INDEX "sps_cycle_belum_terkuras_idx"
    ON "app"."saldo_pelanggan_source_cycle" ("unit_id", "source_cycle_sequence")
    WHERE "rows_pruned_at" IS NULL;
