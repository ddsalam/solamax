-- Setoran Tunai — seksi MANUAL ketiga (input pengawas: rupiah yang disetor ke
-- bank). Reuse penuh tabel `app.manual_entry` + write-path ber-scope/void-only;
-- total non-void = "I · Setoran Tunai" pada rekonsiliasi, dibandingkan vs H.
--
-- ⚠️ Migrasi ini HANYA menambah nilai enum — TIDAK boleh memakainya di txn yang
-- sama (ADD VALUE pada PG12+ aman dalam txn selama nilainya tak langsung dipakai).
-- Urutan deploy: jalankan migrate-deploy ini DULU, baru deploy image dashboard
-- yang mereferensikan 'setoran_tunai'. IF NOT EXISTS → idempoten / aman re-run.
ALTER TYPE "app"."manual_entry_section" ADD VALUE IF NOT EXISTS 'setoran_tunai';
