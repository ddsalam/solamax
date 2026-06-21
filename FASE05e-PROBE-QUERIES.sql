-- =====================================================================
-- FASE 0.5e — PROBE READ-ONLY RONDE 3d (sumber VOLUME penjualan voucher)
-- =====================================================================
-- 🔒 SELECT-ONLY. Jalankan: `pnpm --filter @solamax/agent probe6`
-- Konteks: pelanggan-gap (ronde 3c) = penjualan voucher (tr_bppiut VCREF=UV…).
-- Rp sudah eksak; ini mengunci sumber VOLUME per-pelanggan voucher.
-- Target gap volume 14 Jun: REHOBOT 670,95 / JNE 363,82 / INDOMARCO-kecil 57,79 / POL 11,35 = 1.103,91 L.
-- ':date' = 'YYYY-MM-DD'.
-- =====================================================================

-- V0. tabel/view voucher
SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND ( LOWER(TABLE_NAME) LIKE '%vouc%' OR LOWER(TABLE_NAME) LIKE '%usev%'
     OR LOWER(TABLE_NAME) LIKE '%tukar%' )
ORDER BY TABLE_NAME;

-- V1. DESCRIBE + sample kandidat (sebagian mungkin tak ada → error diabaikan)
DESCRIBE tr_husevouc;  SELECT * FROM tr_husevouc LIMIT 3;
DESCRIBE tr_dusevouc;  SELECT * FROM tr_dusevouc LIMIT 3;
DESCRIBE tr_usevouc;   SELECT * FROM tr_usevouc LIMIT 3;
DESCRIBE vw_usevouc;   SELECT * FROM vw_usevouc LIMIT 3;

-- V2. rekon per CKDPLG by tanggal (tebakan kolom Liter/TotalHarga/CKDPLG; date DTGL vs TanggalJam)
SELECT CKDPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_usevouc WHERE DTGL = ':date' GROUP BY CKDPLG ORDER BY total DESC;
SELECT CKDPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_usevouc WHERE DATE(TanggalJam) = ':date' GROUP BY CKDPLG ORDER BY total DESC;

-- V3. UV codes di tr_bppiut (untuk pemetaan join voucher)
SELECT b.CKDPLG, b.VCREF, ROUND(b.NJUMLAH,2) AS njumlah
FROM tr_bppiut b
WHERE b.DTGL = ':date' AND b.SJNSBP = 1 AND COALESCE(b.SBATAL,0) = 0 AND b.VCREF LIKE 'UV%'
ORDER BY njumlah DESC;
