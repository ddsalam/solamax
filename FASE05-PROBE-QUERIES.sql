-- =====================================================================
-- FASE 0.5 — PROBE READ-ONLY (gate sebelum Fase 1)
-- =====================================================================
-- 🔒 SELECT-ONLY mutlak. Nol write/DDL. Dijalankan via user MySQL `readonly_sync`
--    di mesin SPBU lewat: `pnpm --filter @solamax/agent probe` (harness:
--    apps/agent/src/probe.ts, tiap query lewat roQuery → assertSelectOnly()).
--    File ini = salinan kanonik query untuk DI-REVIEW SEBELUM dijalankan.
--    Hasil disimpan/dirangkum untuk rekonsiliasi vs PDF (lihat ADR-001).
--
-- Tujuan: tuntaskan 5 titik falsifikasi & rekon EKSAK ke PDF unit 6478111
-- untuk 2 tanggal (14 & 17 Juni 2026). Target angka di ADR-001.
--
-- Konvensi: ':date' = tanggal bisnis 'YYYY-MM-DD'; ':next' = tanggal+1.
--   (Di harness diganti placeholder `?`; di sini ditulis literal utk review.)
-- EDC: cocokkan RUPIAH saja (PDF liter EDC = 0). Pelanggan/Deposit: vol + Rp.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. DISCOVERY SKEMA (DESCRIBE + sample) — pastikan nama kolom REAL
--    ⚠️ JALANKAN BLOK A DULU & BACA hasilnya sebelum percaya P1–P6.
--    Bila nama/casing kolom beda dari asumsi (mis. SBATAL, Tanggaljam vs
--    TanggalJam), sesuaikan query di bawah lalu jalankan ulang. Jangan
--    rekon di atas asumsi kolom. Harness: `pnpm --filter @solamax/agent probe:schema`.
-- ---------------------------------------------------------------------
DESCRIBE tr_edc;
SELECT * FROM tr_edc LIMIT 3;
DESCRIBE tm_card;
SELECT * FROM tm_card LIMIT 25;          -- 19 baris: lihat apakah QRIS = kartu

DESCRIBE tr_bppiut;
SELECT * FROM tr_bppiut LIMIT 3;
DESCRIBE pjpelanggan;
SELECT * FROM pjpelanggan LIMIT 3;
DESCRIBE pelanggan;
SELECT * FROM pelanggan LIMIT 3;

DESCRIBE tr_deposit;
SELECT * FROM tr_deposit LIMIT 3;

DESCRIBE tr_hkasbank;


-- ---------------------------------------------------------------------
-- P1. EDC ⊃ QRIS?  (falsifikasi #1)
--   Target 14 Jun: 90.974.097 (11 channel) · 17 Jun: 116.565.499 (9 channel)
-- ---------------------------------------------------------------------
-- Grand total per tanggal (cocokkan ke PDF, RUPIAH):
SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM tr_edc WHERE DATE(Tanggaljam) = ':date';

-- Rincian per kartu (cocokkan jumlah channel + nama; map kode via dump tm_card):
SELECT e.CKDKARTU, COUNT(*) AS n, ROUND(SUM(e.Liter),2) AS liter,
       ROUND(SUM(e.TotalHarga),2) AS total
FROM tr_edc e WHERE DATE(e.Tanggaljam) = ':date'
GROUP BY e.CKDKARTU ORDER BY total DESC;

-- Bila grand total < PDF → QRIS ada di tabel lain. Cari kandidat:
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND ( LOWER(TABLE_NAME) LIKE '%qr%'   OR LOWER(TABLE_NAME) LIKE '%edc%'
     OR LOWER(TABLE_NAME) LIKE '%card%' OR LOWER(TABLE_NAME) LIKE '%kartu%'
     OR LOWER(TABLE_NAME) LIKE '%nontunai%' OR LOWER(TABLE_NAME) LIKE '%non_tunai%' )
ORDER BY TABLE_NAME;


-- ---------------------------------------------------------------------
-- P2. PELANGGAN (penjualan tempo) — dua hipotesis (falsifikasi #2)
--   Target 14 Jun: 111.502.580 / 7.583,30 L (18 plg)
--   Target 17 Jun: 155.113.552 / 12.094,28 L (48 plg)
-- ---------------------------------------------------------------------
-- H2a) tr_bppiut (buku piutang, Rp saja) — pecah per jenis SJNSBP:
SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total
FROM tr_bppiut WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0
GROUP BY SJNSBP ORDER BY SJNSBP;

-- H2a) per pelanggan per jenis (cari jenis yang totalnya = PDF & jumlah plg cocok):
SELECT b.SJNSBP, b.CKDPLG, COUNT(*) AS n, ROUND(SUM(b.NJUMLAH),2) AS total
FROM tr_bppiut b WHERE b.DTGL = ':date' AND COALESCE(b.SBATAL,0) = 0
GROUP BY b.SJNSBP, b.CKDPLG ORDER BY b.SJNSBP, total DESC;

-- H2b) pjpelanggan (log per-kendaraan, punya Liter+TotalHarga) — FILTER tanggal waras
--      (kolom tanggal korup: jangan MAX naif). Window [:date 00:00, :next 00:00):
SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total
FROM pjpelanggan
WHERE TanggalJam >= ':date 00:00:00' AND TanggalJam < ':next 00:00:00';

SELECT IDCust, COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter,
       ROUND(SUM(TotalHarga),2) AS total
FROM pjpelanggan
WHERE TanggalJam >= ':date 00:00:00' AND TanggalJam < ':next 00:00:00'
GROUP BY IDCust ORDER BY total DESC;


-- ---------------------------------------------------------------------
-- P3. PENGELUARAN benar-benar mati?  (falsifikasi #3)
--   Harap: MAX(DTGL) tr_hkasbank = 2019-04-17, nol baris 2026, tak ada modul pengganti.
-- ---------------------------------------------------------------------
SELECT MIN(DTGL) AS mindtgl, MAX(DTGL) AS maxdtgl, COUNT(*) AS n FROM tr_hkasbank;
SELECT COUNT(*) AS n_2026 FROM tr_hkasbank WHERE DTGL >= '2026-01-01';

SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND ( LOWER(TABLE_NAME) LIKE '%kas%'     OR LOWER(TABLE_NAME) LIKE '%biaya%'
     OR LOWER(TABLE_NAME) LIKE '%keluar%'  OR LOWER(TABLE_NAME) LIKE '%pengeluaran%'
     OR LOWER(TABLE_NAME) LIKE '%expense%' OR LOWER(TABLE_NAME) LIKE '%bank%' )
ORDER BY TABLE_NAME;


-- ---------------------------------------------------------------------
-- P4. PK unik tr_edc  (falsifikasi #4) — full scan one-off
--   Tentukan UNIQUE key: CNOTRACE saja, atau (Tanggaljam,NoNozzle,CNOTRACE)?
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS total,
       COUNT(DISTINCT CNOTRACE) AS d_cnotrace,
       COUNT(DISTINCT CONCAT(CAST(Tanggaljam AS CHAR), '|',
                             COALESCE(NoNozzle,''), '|', COALESCE(CNOTRACE,''))) AS d_composite,
       SUM(CASE WHEN CNOTRACE IS NULL OR CNOTRACE = '' THEN 1 ELSE 0 END) AS empty_cnotrace
FROM tr_edc;


-- ---------------------------------------------------------------------
-- P5. Business-date EDC (falsifikasi #5) — deteksi spillover shift-3 lewat tengah malam.
--   Window MELEWATI tengah malam s/d ':next 06:00' supaya jam 00:00–06:00 hari :next
--   ikut terlihat (GROUP BY DATE → baris d=:next muncul bila ada spillover).
--   Gate utama tetap: P1 grand DATE() naif = PDF (kalau eksak, spillover praktis nihil).
-- ---------------------------------------------------------------------
SELECT DATE(Tanggaljam) AS d, HOUR(Tanggaljam) AS hr, COUNT(*) AS n,
       ROUND(SUM(TotalHarga),2) AS total
FROM tr_edc
WHERE Tanggaljam >= ':date 00:00:00' AND Tanggaljam < ':next 06:00:00'
GROUP BY DATE(Tanggaljam), HOUR(Tanggaljam) ORDER BY d, hr;


-- ---------------------------------------------------------------------
-- P6. DEPOSIT (Pendapatan Non Tunai)  — konfirmasi tr_deposit
--   Target 14 Jun: 0 · 17 Jun: 47.000.000 (6 deposit)
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS n, ROUND(SUM(NTOTAL),2) AS total
FROM tr_deposit WHERE DTGL = ':date' AND COALESCE(SBATAL,0) = 0;

SELECT CKDDEPO, DTGL, CKDPLG, ROUND(NTOTAL,2) AS ntotal, ROUND(NSALDO,2) AS nsaldo, SBATAL
FROM tr_deposit WHERE DTGL = ':date' ORDER BY NTOTAL DESC;
