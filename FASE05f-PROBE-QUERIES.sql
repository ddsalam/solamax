-- =====================================================================
-- FASE 0.5f — PROBE READ-ONLY RONDE 3e (latensi pelanggan + delta 15 Jun)
-- =====================================================================
-- 🔒 SELECT-ONLY. Jalankan: `pnpm --filter @solamax/agent probe7`
-- Tujuan: (1) ukur latensi vw_jualplg (view materialisasi berat di 5.0) vs
--   base-table; buktikan base = view per-tanggal 14–18 (eksak) → kandidat ganti
--   sumber pelanggan_sale. (2) Isolasi delta 15 Jun (dry-run +235.705/+10,03L).
-- =====================================================================

-- L. LATENSI (harness cetak ⏱ ms). View 2× (cold/warm), lalu base-table.
SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS rp
FROM vw_jualplg WHERE DTGL >= '2026-06-06' AND COALESCE(SBATAL,0) = 0;            -- run-1 cold
SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS rp
FROM vw_jualplg WHERE DTGL >= '2026-06-06' AND COALESCE(SBATAL,0) = 0;            -- run-2 warm?
SELECT COUNT(*) AS n, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp
FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG
WHERE h.DTGL >= '2026-06-06' AND COALESCE(h.SBATAL,0) = 0;                        -- BASE

-- C. KOREKTNESS base = view per-tanggal 14–18 (harus identik plg/liter/rp).
SELECT DTGL, COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS rp
FROM vw_jualplg WHERE DTGL BETWEEN '2026-06-14' AND '2026-06-18' AND COALESCE(SBATAL,0) = 0
GROUP BY DTGL ORDER BY DTGL;
SELECT h.DTGL, COUNT(DISTINCT h.CKDPLG) AS plg, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp
FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG
WHERE h.DTGL BETWEEN '2026-06-14' AND '2026-06-18' AND COALESCE(h.SBATAL,0) = 0
GROUP BY h.DTGL ORDER BY h.DTGL;

-- D. DELTA 15 Jun (PDF 148.157.618 / 12.279,03 L / 39 plg).
SELECT h.CKDPLG, p.VCNMPLG, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp
FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG
LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG
WHERE h.DTGL = '2026-06-15' AND COALESCE(h.SBATAL,0) = 0
GROUP BY h.CKDPLG, p.VCNMPLG ORDER BY rp DESC;

SELECT CKDPLG, VCNMPLG, ROUND(SUM(liter),2) AS liter, ROUND(SUM(NJUMLAHUSE),2) AS rp
FROM vw_usevouc WHERE DTGL = '2026-06-15' AND COALESCE(SBATAL,0) = 0
GROUP BY CKDPLG, VCNMPLG ORDER BY rp DESC;

-- Jejak telat: business-date 15/6 tapi dispense-date ≠ 15/6 (rentang waras).
SELECT h.CKDPLG, p.VCNMPLG, h.CKDJUALPLG, d.TanggalJam, d.CKDBBM,
       ROUND(d.Liter,2) AS liter, ROUND(d.TotalHarga,2) AS rp
FROM tr_hjualplg h JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG
LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG
WHERE h.DTGL = '2026-06-15' AND COALESCE(h.SBATAL,0) = 0
  AND d.TanggalJam >= '2026-06-15' AND d.TanggalJam < '2026-07-01'
  AND DATE(d.TanggalJam) <> '2026-06-15'
ORDER BY d.TanggalJam;
