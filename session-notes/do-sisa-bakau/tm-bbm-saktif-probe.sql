-- Probe READ-ONLY: apakah tm_bbm punya flag aktif produk (dugaan: SAKTIF)?
-- Jalankan di mesin SPBU dengan user MySQL SELECT-only (tool yang sama dgn
-- VERIFICATION-QUERIES.sql). JANGAN menebak skema — kirim output apa adanya.
-- Tujuan: bila flag ada → rencana sync `product.saktif` (pengganti/penguat aturan
-- "produk aktif = dipetakan tangki"); bila tidak ada → aturan tangki permanen.

-- 1) Struktur penuh tm_bbm (recon 2026-06-11 terpotong "dst." — perlu lengkap)
DESCRIBE tm_bbm;

-- 2) Isi penuh (8 baris produk) — perhatikan nilai kolom flag (bila ada) untuk
--    PREMIUM (BB-01) dan BIO SOLAR (BB-05) vs 6 produk aktif
SELECT * FROM tm_bbm;

-- 3) Pembanding: flag tangki (SAKTIF terkonfirmasi ada di tm_tangki)
DESCRIBE tm_tangki;
SELECT CKDTANGKI, CKDBBM, VCNMTANGKI, SAKTIF FROM tm_tangki;
