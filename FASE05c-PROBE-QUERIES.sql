-- =====================================================================
-- FASE 0.5c — PROBE READ-ONLY RONDE 3 (rekon sumber temuan ronde 2)
-- =====================================================================
-- 🔒 SELECT-ONLY. Jalankan: `pnpm --filter @solamax/agent probe3`
--    (harness: apps/agent/src/probe.ts runProbe3). Salinan review query.
-- Konteks: ADR-001. Pelanggan sumber = tr_hjualplg/tr_djualplg (+tm_plg,
--    vw_jualplg); EDC via vw_edc*; tr_trmedc kosong; tr_bpbank = setoran bank.
-- Kolom base table = TEBAKAN pola tr_*jualbbm (CKDJUALPLG/NVOLUME/NSUBTOTAL/
--    DTGLJUAL) — DESCRIBE+sample dicetak utk verifikasi; perbaiki bila beda.
-- Target PDF: Pelanggan 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48
--             EDC 14Jun 90.974.097 · 17Jun 116.565.499
-- =====================================================================

-- ---------------------------------------------------------------------
-- S1. PELANGGAN — discovery + rekon
-- ---------------------------------------------------------------------
DESCRIBE tr_hjualplg;   SELECT * FROM tr_hjualplg LIMIT 3;
DESCRIBE tr_djualplg;   SELECT * FROM tr_djualplg LIMIT 3;
DESCRIBE tm_plg;        SELECT * FROM tm_plg LIMIT 3;
DESCRIBE vw_jualplg;    SELECT * FROM vw_jualplg LIMIT 3;

-- grand (tebakan kolom) per tanggal bisnis:
SELECT COUNT(DISTINCT h.CKDPLG) AS plg, ROUND(SUM(d.NVOLUME),2) AS liter,
       ROUND(SUM(d.NSUBTOTAL),2) AS total
FROM tr_djualplg d JOIN tr_hjualplg h ON h.CKDJUALPLG = d.CKDJUALPLG
WHERE h.DTGLJUAL = ':date';

-- per pelanggan (+nama) — cocokkan ke 18/48 baris PDF:
SELECT h.CKDPLG, p.VCNMPLG, ROUND(SUM(d.NVOLUME),2) AS liter, ROUND(SUM(d.NSUBTOTAL),2) AS total
FROM tr_djualplg d JOIN tr_hjualplg h ON h.CKDJUALPLG = d.CKDJUALPLG
LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG
WHERE h.DTGLJUAL = ':date' GROUP BY h.CKDPLG, p.VCNMPLG ORDER BY total DESC;

-- ---------------------------------------------------------------------
-- S2. EDC — view mana yang rekon ke PDF?
-- ---------------------------------------------------------------------
DESCRIBE vw_edc;   SELECT * FROM vw_edc LIMIT 5;
DESCRIBE vw_edc2;  SELECT * FROM vw_edc2 LIMIT 5;
DESCRIBE vw_edc3;  SELECT * FROM vw_edc3 LIMIT 5;

-- dua tebakan kolom tanggal per view (TanggalJam vs DTGLJUAL); cari = PDF:
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc  WHERE DATE(TanggalJam) = ':date';
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc  WHERE DTGLJUAL = ':date';
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc2 WHERE DATE(TanggalJam) = ':date';
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc2 WHERE DTGLJUAL = ':date';
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc3 WHERE DATE(TanggalJam) = ':date';
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc3 WHERE DTGLJUAL = ':date';

-- ---------------------------------------------------------------------
-- S3. PK EDC — JrnKey & komposit kaya
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS total, COUNT(DISTINCT JrnKey) AS d_jrnkey,
       COUNT(DISTINCT CONCAT(CAST(TanggalJam AS CHAR), '|', COALESCE(NoNozle,''), '|',
             COALESCE(CNOTRACE,''), '|', CAST(TotalHarga AS CHAR), '|', COALESCE(CKDKARTU,''))) AS d_rich,
       SUM(CASE WHEN JrnKey IS NULL THEN 1 ELSE 0 END) AS null_jrnkey
FROM tr_edc;

-- ---------------------------------------------------------------------
-- S4. tr_bpbank isi pada tanggal (gate Pengeluaran + lokasi SETORAN BRIGHT)
--   Pendapatan Lain PDF: 14Jun 11.284.400 · 17Jun 23.041.400 (SETORAN BRIGHT IB)
-- ---------------------------------------------------------------------
SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total
FROM tr_bpbank WHERE DTGL = ':date' GROUP BY SJNSBP ORDER BY SJNSBP;

SELECT CKDBPBANK, CKDBANK, VCKET, ROUND(NJUMLAH,2) AS njumlah, SJNSBP, SBATAL
FROM tr_bpbank WHERE DTGL = ':date' ORDER BY NJUMLAH DESC LIMIT 40;
