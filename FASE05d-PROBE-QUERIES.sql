-- =====================================================================
-- FASE 0.5d — PROBE READ-ONLY RONDE 3b (rekon final, kolom sudah pasti)
-- =====================================================================
-- 🔒 SELECT-ONLY. Jalankan: `pnpm --filter @solamax/agent probe4`
--    (harness: apps/agent/src/probe.ts runProbe4). Salinan review query.
-- Kolom pasti (ronde 3): vw_jualplg(DTGL,CKDPLG,VCNMPLG,Liter,TotalHarga,SBATAL,
--    NTAGIH,CKDDEPO); vw_edc3(ctgl 'YYYYMMDD', cshift, CKDKARTU, TotalHarga);
--    tm_card(CKDCARD,VCNMCARD).
-- Target: Pelanggan 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48
--         EDC 14Jun 90.974.097/11ch · 17Jun 116.565.499/9ch
-- ':date'='YYYY-MM-DD' (vw_jualplg.DTGL); ':ymd'='YYYYMMDD' (vw_edc3.ctgl).
-- =====================================================================

-- ---------------------------------------------------------------------
-- T1. PELANGGAN — vw_jualplg by DTGL
-- ---------------------------------------------------------------------
-- grand non-batal (utama):
SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_jualplg WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0;

-- pembanding tanpa filter batal:
SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_jualplg WHERE DTGL = ':date';

-- breakdown NTAGIH (tempo vs tunai?) & deposit-draw:
SELECT NTAGIH, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total
FROM vw_jualplg WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0 GROUP BY NTAGIH ORDER BY NTAGIH;

SELECT CASE WHEN CKDDEPO IS NULL OR CKDDEPO = '' THEN 'no_depo' ELSE 'depo' END AS pakai_depo,
       COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total
FROM vw_jualplg WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0
GROUP BY CASE WHEN CKDDEPO IS NULL OR CKDDEPO = '' THEN 'no_depo' ELSE 'depo' END;

-- per pelanggan (+nama) — cocokkan 18/48 baris PDF:
SELECT CKDPLG, VCNMPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_jualplg WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0
GROUP BY CKDPLG, VCNMPLG ORDER BY total DESC;

-- ---------------------------------------------------------------------
-- T2. EDC — vw_edc3 by ctgl (business-date EasyMax)
-- ---------------------------------------------------------------------
SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc3 WHERE ctgl = ':ymd';

SELECT v.CKDKARTU, c.VCNMCARD, COUNT(*) AS n, ROUND(SUM(v.TotalHarga),2) AS total
FROM vw_edc3 v LEFT JOIN tm_card c ON c.CKDCARD = v.CKDKARTU
WHERE v.ctgl = ':ymd' GROUP BY v.CKDKARTU, c.VCNMCARD ORDER BY total DESC;

SELECT cshift, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total
FROM vw_edc3 WHERE ctgl = ':ymd' GROUP BY cshift ORDER BY cshift;
