-- =====================================================================
-- FASE 0.5d2 — PROBE READ-ONLY RONDE 3c (kunci query Pelanggan LENGKAP)
-- =====================================================================
-- 🔒 SELECT-ONLY. Jalankan: `pnpm --filter @solamax/agent probe5`
--    (harness: apps/agent/src/probe.ts runProbe5). EDC sudah LULUS (ronde 3b).
-- Tujuan: query Pelanggan yang rekon EKSAK 18/48 (vol+Rp). Hipotesis:
--    Pelanggan = vw_jualplg ⊎ tr_bppiut (dedup CKDPLG). Cek juga apakah
--    vw_djlplg/vw_djlplg2 sudah = laporan 18/48 (sumber tunggal).
-- Target: 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48
-- =====================================================================

-- U1. view daftar-jual-plg alternatif (mungkin = laporan langsung)
DESCRIBE vw_djlplg;   SELECT * FROM vw_djlplg LIMIT 3;
DESCRIBE vw_djlplg2;  SELECT * FROM vw_djlplg2 LIMIT 3;

-- rekon (tebakan kolom DTGL/Liter/TotalHarga/SBATAL/CKDPLG):
SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_djlplg  WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0;
SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM vw_djlplg2 WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0;

-- U2. pelanggan di tr_bppiut yg TAK ada di vw_jualplg (gap count+Rp):
SELECT COUNT(*) AS plg_extra, ROUND(SUM(b.t),2) AS total_extra
FROM (SELECT CKDPLG, SUM(NJUMLAH) AS t FROM tr_bppiut
      WHERE DTGL = ':date' AND SJNSBP = 1 AND COALESCE(SBATAL,0) = 0 GROUP BY CKDPLG) b
WHERE b.CKDPLG NOT IN (SELECT DISTINCT CKDPLG FROM vw_jualplg
                       WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0);

-- U3. linkage tr_bppiut.VCREF → tr_hjualplg → tr_djualplg (sumber VOLUME bppiut-only):
SELECT b.CKDPLG, b.VCREF, ROUND(b.NJUMLAH,2) AS njumlah, h.DTGL AS hdr_dtgl,
       ROUND(SUM(d.Liter),2) AS det_liter, ROUND(SUM(d.TotalHarga),2) AS det_total
FROM tr_bppiut b
LEFT JOIN tr_hjualplg h ON h.CKDJUALPLG = b.VCREF
LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG
WHERE b.DTGL = ':date' AND b.SJNSBP = 1 AND COALESCE(b.SBATAL,0) = 0
  AND b.CKDPLG NOT IN (SELECT DISTINCT CKDPLG FROM vw_jualplg WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0)
GROUP BY b.CKDPLG, b.VCREF, b.NJUMLAH, h.DTGL ORDER BY njumlah DESC;
