-- =====================================================================
-- FASE 0.5b — PROBE READ-ONLY RONDE 2 (tindak lanjut item GAGAL ronde 1)
-- =====================================================================
-- 🔒 SELECT-ONLY mutlak. Jalankan: `pnpm --filter @solamax/agent probe2`
--    (harness: apps/agent/src/probe.ts runProbe2). Salinan review query.
-- Konteks hasil ronde 1: ADR-001 (Deposit LULUS; EDC/Pelanggan GAGAL exact;
--    Pengeluaran inconclusive krn tr_bpbank belum dicek; PK EDC error kolom).
-- Kolom REAL (dari discovery ronde 1): tr_edc.TanggalJam, tr_edc.NoNozle,
--    tm_card.CKDCARD/VCNMCARD, tr_edc TANPA SBATAL.
-- ':date' = tanggal bisnis; di harness = '?'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- R1. PK unik tr_edc (kolom benar: NoNozle) — tentukan UNIQUE key
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS total,
       COUNT(DISTINCT CNOTRACE) AS d_cnotrace,
       COUNT(DISTINCT CONCAT(CAST(TanggalJam AS CHAR), '|',
                             COALESCE(NoNozle,''), '|', COALESCE(CNOTRACE,''))) AS d_composite,
       SUM(CASE WHEN CNOTRACE IS NULL OR CNOTRACE = '' THEN 1 ELSE 0 END) AS empty_cnotrace
FROM tr_edc;

-- ---------------------------------------------------------------------
-- R2. Modul kas pengganti? (gate Pengeluaran) — rule-out tr_bpbank/tr_dkasbank
-- ---------------------------------------------------------------------
DESCRIBE tr_bpbank;
SELECT * FROM tr_bpbank LIMIT 5;
-- asumsi kolom tanggal DTGL (cek dari DESCRIBE; sesuaikan bila beda):
SELECT MIN(DTGL) AS mn, MAX(DTGL) AS mx, COUNT(*) AS n,
       SUM(CASE WHEN DTGL >= '2026-01-01' THEN 1 ELSE 0 END) AS n2026
FROM tr_bpbank;
DESCRIBE tr_dkasbank;
SELECT COUNT(*) AS n2026
FROM tr_dkasbank d JOIN tr_hkasbank h ON h.CKDKB = d.CKDKB
WHERE h.DTGL >= '2026-01-01';

-- ---------------------------------------------------------------------
-- R3. EDC sumber riil — business-date per shift, Jenis, settlement
-- ---------------------------------------------------------------------
DESCRIBE tr_hjualbbm;
DESCRIBE tr_trmedc;
SELECT COUNT(*) AS n FROM tr_trmedc;
SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND ( LOWER(TABLE_NAME) LIKE '%edc%' OR LOWER(TABLE_NAME) LIKE '%rekap%'
     OR LOWER(TABLE_NAME) LIKE '%harian%' OR LOWER(TABLE_NAME) LIKE '%daily%'
     OR LOWER(TABLE_NAME) LIKE '%setor%' )
ORDER BY TABLE_NAME;

-- Span waktu penjualan utk tanggal bisnis (shift) → batas window EDC bisnis:
SELECT h.NSHIFT, MIN(d.DTGLJAM) AS mn, MAX(d.DTGLJAM) AS mx, COUNT(*) AS n
FROM tr_djualbbm d JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM
WHERE h.DTGLJUAL = ':date' GROUP BY h.NSHIFT ORDER BY h.NSHIFT;

-- EDC dalam span penjualan biz-day (uji apakah ini = angka PDF):
SELECT COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM tr_edc
WHERE TanggalJam >= (SELECT MIN(d.DTGLJAM) FROM tr_djualbbm d
                     JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM WHERE h.DTGLJUAL = ':date')
  AND TanggalJam <= (SELECT MAX(d.DTGLJAM) FROM tr_djualbbm d
                     JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM WHERE h.DTGLJUAL = ':date');

-- Distribusi per Jenis (mungkin ada jenis non-sales yg harus dikecualikan):
SELECT Jenis, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total
FROM tr_edc WHERE DATE(TanggalJam) = ':date' GROUP BY Jenis ORDER BY Jenis;

-- ---------------------------------------------------------------------
-- R4. Pelanggan — master nama + 6 pelanggan hilang + view lengkap
-- ---------------------------------------------------------------------
SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND ( LOWER(TABLE_NAME) LIKE '%pelang%' OR LOWER(TABLE_NAME) LIKE '%cust%'
     OR LOWER(TABLE_NAME) LIKE '%plg%'    OR LOWER(TABLE_NAME) LIKE '%piut%' )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ( COLUMN_NAME LIKE '%CKDPLG%' OR COLUMN_NAME LIKE '%NMPLG%'
     OR COLUMN_NAME LIKE '%NAMAPLG%' OR COLUMN_NAME LIKE '%VCNMPLG%' )
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Semua kombinasi SJNSBP×SBATAL (lihat apakah ada jenis posting lain):
SELECT SJNSBP, SBATAL, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total
FROM tr_bppiut WHERE DTGL = ':date' GROUP BY SJNSBP, SBATAL ORDER BY SJNSBP, SBATAL;

-- Pelanggan ber-deposit s/d tanggal (apakah 6 plg hilang = pemakai deposit?):
SELECT CKDPLG, ROUND(SUM(NTOTAL),2) AS total_topup, COUNT(*) AS n
FROM tr_deposit WHERE DTGL <= ':date' AND COALESCE(SBATAL,0) = 0
GROUP BY CKDPLG ORDER BY total_topup DESC;
