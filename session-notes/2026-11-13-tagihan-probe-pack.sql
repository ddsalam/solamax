-- Tagihan pelanggan — paket probe pra-perencanaan (13 Nov 2026)
-- Rencana: docs/plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md
--
-- ATURAN
--   * SELECT saja. Jalankan sebagai readonly_sync di DB `easymax` tiap unit.
--   * Kompatibel MySQL 5.0.67 (tanpa CTE, tanpa window function).
--   * Semua keluaran berupa hitungan/agregat — tanpa nama pelanggan.
--   * Repo ini publik: JANGAN commit hasilnya ke sini. Hasil disimpan di vault.
--   * Belum pernah dijalankan terhadap MySQL (tidak ada MySQL di mesin penulis).
--     Bila satu kueri galat, kirim pesan galatnya; kueri lain tetap bisa jalan.
--
-- EKSPEKTASI TERSEGEL (ditulis sebelum hasil dilihat; jangan disunting sesudahnya)
--   T1  Jumlah faktur hidup per unit >= angka sensus 8 Sep 2026.
--   T2  SJENISTAG punya <= 3 nilai berbeda per unit.
--   T3  NGATOT = NTOTAL + NADM pada >= 99% faktur hidup.
--   T4  Faktur NSTATUS=1 dengan jumlah bayar < NGATOT: 0 atau sangat sedikit (< 1%).
--       Faktur NSTATUS=0 dengan bayar > 0: ada, dan bayarnya < NGATOT (bayar sebagian).
--   T5  Tidak ada dokumen penjualan yang masuk ke dua faktur hidup sekaligus.
--       Setiap faktur hidup punya >= 1 baris junction.
--   T6  Debit JP/UV hidup tahun 2026 yang tidak ada di junction: ada, terkonsentrasi
--       di bulan berjalan dan bulan sebelumnya.
--   T7  Di luar Kotabaru, tempo (DTGLJT - DTGL) seluruhnya 0..120 hari.
--   T8  NLASTSALDO TIDAK sama dengan (NGATOT - jumlah bayar) secara konsisten
--       (dugaan: ia saldo pelanggan saat faktur dibuat, bukan sisa faktur).


-- ── T1 · Sensus ulang ─────────────────────────────────────────────────────────
SELECT 'T1a' AS probe,
       COUNT(*)                                   AS faktur_hidup,
       SUM(NSTATUS = 1)                           AS lunas_flag,
       SUM(NSTATUS <> 1 OR NSTATUS IS NULL)       AS belum_lunas_flag,
       MIN(DTGL) AS dtgl_min, MAX(DTGL) AS dtgl_maks
FROM tr_htagihan
WHERE SBATAL = 0;

SELECT 'T1b' AS probe,
       COUNT(*) AS bayar_hidup, MIN(DTGL) AS bayar_min, MAX(DTGL) AS bayar_terakhir
FROM tr_byrtagih
WHERE SBATAL = 0;

SELECT 'T1c' AS probe, SBATAL, COUNT(*) AS n FROM tr_htagihan GROUP BY SBATAL;
SELECT 'T1d' AS probe, SBATAL, COUNT(*) AS n FROM tr_byrtagih GROUP BY SBATAL;


-- ── T2 · Arti SJENISTAG ───────────────────────────────────────────────────────
SELECT 'T2' AS probe, SJENISTAG, NSTATUS,
       COUNT(*)            AS n,
       SUM(NADM <> 0)      AS n_ber_adm,
       MIN(DTGL) AS dtgl_min, MAX(DTGL) AS dtgl_maks
FROM tr_htagihan
WHERE SBATAL = 0
GROUP BY SJENISTAG, NSTATUS
ORDER BY SJENISTAG, NSTATUS;


-- ── T3 · Biaya admin dan grand total ──────────────────────────────────────────
SELECT 'T3' AS probe,
       COUNT(*)                                                   AS faktur_hidup,
       SUM(NADM <> 0)                                             AS n_adm_nonnol,
       SUM(ABS(NGATOT - (NTOTAL + NADM)) < 0.5)                   AS n_gatot_eq_total_plus_adm,
       SUM(ABS(NGATOT - NTOTAL) < 0.5)                            AS n_gatot_eq_total,
       SUM(ABS(NGATOT - (NTOTAL + NADM)) >= 0.5
           AND ABS(NGATOT - NTOTAL) >= 0.5)                       AS n_gatot_lainnya,
       SUM(NGATOT <= 0)                                           AS n_gatot_nol_atau_negatif
FROM tr_htagihan
WHERE SBATAL = 0;


-- ── T4 · Pembayaran terhadap nilai faktur ─────────────────────────────────────
SELECT 'T4' AS probe, t.NSTATUS,
       CASE
         WHEN t.dibayar IS NULL OR t.dibayar = 0 THEN '1_tanpa_bayar'
         WHEN t.dibayar <  t.NGATOT - 0.5        THEN '2_sebagian'
         WHEN t.dibayar <= t.NGATOT + 0.5        THEN '3_pas'
         ELSE                                         '4_lebih'
       END AS kelas,
       COUNT(*)            AS n,
       MAX(t.n_bayar)      AS bayar_per_faktur_maks
FROM (
  SELECT h.CKDTAGIH, h.NSTATUS, h.NGATOT,
         SUM(b.NTOTAL)  AS dibayar,
         COUNT(b.CKDBYR) AS n_bayar
  FROM tr_htagihan h
  LEFT JOIN tr_byrtagih b ON b.CKDTAGIH = h.CKDTAGIH AND b.SBATAL = 0
  WHERE h.SBATAL = 0
  GROUP BY h.CKDTAGIH, h.NSTATUS, h.NGATOT
) t
GROUP BY t.NSTATUS, kelas
ORDER BY t.NSTATUS, kelas;

-- T4b · sama, tetapi dibandingkan dengan NTOTAL (tanpa adm) — hanya berarti bila T3 menunjukkan NADM dipakai
SELECT 'T4b' AS probe, t.NSTATUS,
       SUM(t.dibayar IS NOT NULL AND ABS(t.dibayar - t.NTOTAL) < 0.5) AS n_bayar_eq_ntotal,
       SUM(t.dibayar IS NOT NULL AND ABS(t.dibayar - t.NGATOT) < 0.5) AS n_bayar_eq_ngatot
FROM (
  SELECT h.CKDTAGIH, h.NSTATUS, h.NTOTAL, h.NGATOT, SUM(b.NTOTAL) AS dibayar
  FROM tr_htagihan h
  LEFT JOIN tr_byrtagih b ON b.CKDTAGIH = h.CKDTAGIH AND b.SBATAL = 0
  WHERE h.SBATAL = 0
  GROUP BY h.CKDTAGIH, h.NSTATUS, h.NTOTAL, h.NGATOT
) t
GROUP BY t.NSTATUS;

-- T4c · pembayaran hidup yang menunjuk faktur batal atau faktur yang tidak ada
SELECT 'T4c' AS probe,
       SUM(h.CKDTAGIH IS NULL) AS bayar_yatim,
       SUM(h.SBATAL = 1)       AS bayar_ke_faktur_batal
FROM tr_byrtagih b
LEFT JOIN tr_htagihan h ON h.CKDTAGIH = b.CKDTAGIH
WHERE b.SBATAL = 0;


-- ── T5 · Kelengkapan junction faktur ↔ penjualan ──────────────────────────────
SELECT 'T5a' AS probe,
       COUNT(*)                      AS baris_junction,
       COUNT(DISTINCT CKDTAGIH)      AS faktur_berjunction,
       COUNT(DISTINCT CKDJUALPLG)    AS dokumen_berbeda
FROM tr_dtagihan;

SELECT 'T5b' AS probe, LEFT(CKDJUALPLG, 2) AS prefiks, COUNT(*) AS n
FROM tr_dtagihan
GROUP BY LEFT(CKDJUALPLG, 2)
ORDER BY n DESC;

-- faktur hidup tanpa satu pun baris junction
SELECT 'T5c' AS probe, COUNT(*) AS faktur_hidup_tanpa_junction
FROM tr_htagihan h
LEFT JOIN tr_dtagihan d ON d.CKDTAGIH = h.CKDTAGIH
WHERE h.SBATAL = 0 AND d.CKDTAGIH IS NULL;

-- dokumen penjualan yang muncul di lebih dari satu faktur HIDUP
SELECT 'T5d' AS probe, COUNT(*) AS dokumen_di_lebih_dari_satu_faktur_hidup
FROM (
  SELECT d.CKDJUALPLG
  FROM tr_dtagihan d
  JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
  GROUP BY d.CKDJUALPLG
  HAVING COUNT(DISTINCT d.CKDTAGIH) > 1
) x;

-- baris junction kembar persis (tabel tanpa PK)
SELECT 'T5e' AS probe, COUNT(*) AS pasangan_kembar
FROM (
  SELECT CKDTAGIH, CKDJUALPLG
  FROM tr_dtagihan
  GROUP BY CKDTAGIH, CKDJUALPLG
  HAVING COUNT(*) > 1
) x;

-- junction yang menunjuk faktur batal atau faktur yang tidak ada
SELECT 'T5f' AS probe,
       SUM(h.CKDTAGIH IS NULL) AS junction_yatim,
       SUM(h.SBATAL = 1)       AS junction_ke_faktur_batal
FROM tr_dtagihan d
LEFT JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH;


-- ── T6 · Penjualan kredit 2026 yang belum masuk faktur ────────────────────────
SELECT 'T6' AS probe,
       DATE_FORMAT(p.DTGL, '%Y-%m')   AS bulan,
       LEFT(p.VCREF, 2)               AS prefiks,
       COUNT(*)                       AS debit_hidup,
       SUM(f.CKDJUALPLG IS NULL)      AS belum_difaktur
FROM tr_bppiut p
LEFT JOIN (
  SELECT DISTINCT d.CKDJUALPLG
  FROM tr_dtagihan d
  JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
) f ON f.CKDJUALPLG = p.VCREF
WHERE p.SBATAL = 0
  AND p.SJNSBP = 1
  AND p.DTGL >= '2026-01-01'
  AND (p.VCREF LIKE 'JP%' OR p.VCREF LIKE 'UV%')
GROUP BY DATE_FORMAT(p.DTGL, '%Y-%m'), LEFT(p.VCREF, 2)
ORDER BY bulan, prefiks;

-- T6b · arah sebaliknya: dokumen di junction (faktur hidup) yang tidak punya debit hidup di buku piutang
SELECT 'T6b' AS probe, LEFT(d.CKDJUALPLG, 2) AS prefiks,
       COUNT(*)                 AS baris_junction_faktur_hidup,
       SUM(p.VCREF IS NULL)     AS tanpa_debit_hidup
FROM tr_dtagihan d
JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
LEFT JOIN (
  SELECT DISTINCT VCREF FROM tr_bppiut WHERE SBATAL = 0 AND SJNSBP = 1
) p ON p.VCREF = d.CKDJUALPLG
WHERE h.DTGL >= '2026-01-01'
GROUP BY LEFT(d.CKDJUALPLG, 2);


-- ── T7 · Sebaran tempo (DTGLJT − DTGL) ────────────────────────────────────────
SELECT 'T7' AS probe,
       CASE
         WHEN DTGLJT IS NULL OR DTGLJT = '0000-00-00' THEN '0_kosong'
         WHEN DATEDIFF(DTGLJT, DTGL) <  0   THEN '1_negatif'
         WHEN DATEDIFF(DTGLJT, DTGL) =  0   THEN '2_nol'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 7   THEN '3_1-7'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 14  THEN '4_8-14'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 30  THEN '5_15-30'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 60  THEN '6_31-60'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 120 THEN '7_61-120'
         WHEN DATEDIFF(DTGLJT, DTGL) <= 365 THEN '8_121-365'
         ELSE                                    '9_lebih_365'
       END AS kelas_tempo,
       COUNT(*)                                   AS n_semua,
       SUM(DTGL >= '2026-01-01')                  AS n_2026,
       SUM(NSTATUS <> 1 OR NSTATUS IS NULL)       AS n_belum_lunas_flag
FROM tr_htagihan
WHERE SBATAL = 0
GROUP BY kelas_tempo
ORDER BY kelas_tempo;


-- ── T8 · Arti NLASTSALDO ──────────────────────────────────────────────────────
SELECT 'T8' AS probe,
       COUNT(*)                                                          AS faktur_hidup,
       SUM(t.NLASTSALDO = 0)                                             AS n_nol,
       SUM(ABS(t.NLASTSALDO - (t.NGATOT - IFNULL(t.dibayar, 0))) < 0.5)  AS n_eq_sisa_faktur,
       SUM(ABS(t.NLASTSALDO - t.NGATOT) < 0.5)                           AS n_eq_ngatot,
       SUM(t.NLASTSALDO > t.NGATOT + 0.5)                                AS n_lebih_besar_dari_ngatot
FROM (
  SELECT h.CKDTAGIH, h.NGATOT, h.NLASTSALDO, SUM(b.NTOTAL) AS dibayar
  FROM tr_htagihan h
  LEFT JOIN tr_byrtagih b ON b.CKDTAGIH = h.CKDTAGIH AND b.SBATAL = 0
  WHERE h.SBATAL = 0
  GROUP BY h.CKDTAGIH, h.NGATOT, h.NLASTSALDO
) t;


-- ── T9 · Tambahan sesudah tinjauan rencana (13 Nov 2026) ──────────────────────
-- EKSPEKTASI TERSEGEL
--   T9a Debit yang belum difaktur terkonsentrasi di SJENIS 1/5 dan kode bertitik.
--       SJENIS 4 (penjualan tunai) punya debit yang tidak pernah difaktur.
--   T9b Tidak ada dokumen UV di faktur hidup yang debitnya HANYA ada di buku hutang.
--   T9c SJENISTAG 1 = dokumen JP, SJENISTAG 2 = dokumen UV (tanpa campuran).
--   T9d Sebagian besar kelebihan bayar <= Rp 10.000 (pembulatan).

SELECT 'T9a' AS probe, m.SJENIS,
       (p.CKDPLG LIKE '%.%')        AS kode_bertitik,
       COUNT(*)                     AS debit_hidup,
       SUM(f.CKDJUALPLG IS NULL)    AS belum_difaktur
FROM tr_bppiut p
LEFT JOIN tm_plg m ON m.CKDPLG = p.CKDPLG
LEFT JOIN (
  SELECT DISTINCT d.CKDJUALPLG
  FROM tr_dtagihan d
  JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
) f ON f.CKDJUALPLG = p.VCREF
WHERE p.SBATAL = 0 AND p.SJNSBP = 1 AND p.DTGL >= '2026-01-01'
  AND (p.VCREF LIKE 'JP%' OR p.VCREF LIKE 'UV%')
GROUP BY m.SJENIS, (p.CKDPLG LIKE '%.%')
ORDER BY m.SJENIS;

SELECT 'T9b' AS probe,
       COUNT(*)                                        AS baris_junction_uv_faktur_hidup,
       SUM(q.VCREF IS NOT NULL)                        AS ada_di_bphut,
       SUM(q.VCREF IS NOT NULL AND p.VCREF IS NULL)    AS hanya_di_bphut
FROM tr_dtagihan d
JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
LEFT JOIN (SELECT DISTINCT VCREF FROM tr_bphut  WHERE SBATAL = 0 AND SJNSBP = 1) q ON q.VCREF = d.CKDJUALPLG
LEFT JOIN (SELECT DISTINCT VCREF FROM tr_bppiut WHERE SBATAL = 0 AND SJNSBP = 1) p ON p.VCREF = d.CKDJUALPLG
WHERE d.CKDJUALPLG LIKE 'UV%' AND h.DTGL >= '2026-01-01';

SELECT 'T9c' AS probe, h.SJENISTAG, LEFT(d.CKDJUALPLG, 2) AS prefiks, COUNT(*) AS n
FROM tr_dtagihan d
JOIN tr_htagihan h ON h.CKDTAGIH = d.CKDTAGIH AND h.SBATAL = 0
GROUP BY h.SJENISTAG, LEFT(d.CKDJUALPLG, 2)
ORDER BY h.SJENISTAG, prefiks;

SELECT 'T9d' AS probe,
       CASE
         WHEN t.lebih <= 100     THEN '1_sd_100'
         WHEN t.lebih <= 1000    THEN '2_sd_1rb'
         WHEN t.lebih <= 10000   THEN '3_sd_10rb'
         WHEN t.lebih <= 100000  THEN '4_sd_100rb'
         ELSE                         '5_lebih_100rb'
       END AS kelas_lebih,
       COUNT(*) AS n
FROM (
  SELECT h.CKDTAGIH, SUM(b.NTOTAL) - h.NGATOT AS lebih
  FROM tr_htagihan h
  JOIN tr_byrtagih b ON b.CKDTAGIH = h.CKDTAGIH AND b.SBATAL = 0
  WHERE h.SBATAL = 0
  GROUP BY h.CKDTAGIH, h.NGATOT
  HAVING SUM(b.NTOTAL) > h.NGATOT + 0.5
) t
GROUP BY kelas_lebih
ORDER BY kelas_lebih;
