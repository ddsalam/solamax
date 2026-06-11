-- =============================================================================
-- SolaMax — Daftar Query Verifikasi (Fase 0)
-- =============================================================================
-- TUJUAN: mengunci asumsi skema EasyMax sebelum tulis kode. Dijalankan OLEH ANDA
--         di SQL Manager pada DB `easymax` (Imam Bonjol 6478111), lalu hasilnya
--         dilaporkan ke Claude.
--
-- 🔒 SEMUA query di file ini READ-ONLY (SELECT / DESCRIBE / SHOW). Tidak ada
--    INSERT/UPDATE/DELETE/DDL. Aman dijalankan saat pompa beroperasi.
--    LIMIT dipasang agar ringan. Jika ragu, jalankan satu per satu.
--
-- Cara lapor: copy hasil tiap blok (boleh sebagian baris + jumlah) ke Claude,
--             beri label ID-nya (mis. "Q-SALES-1: ...").
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Q-SCHEMA — Struktur kolom 7 tabel inti (tipe & nama persis)
-- -----------------------------------------------------------------------------
DESCRIBE tr_hjualbbm;
DESCRIBE tr_djualbbm;
DESCRIBE tr_hkasbank;
DESCRIBE tr_dkasbank;
DESCRIBE tr_hopnamebbm;
DESCRIBE tr_dopnamebbm;
DESCRIBE tr_terimabbm;
-- master pendukung
DESCRIBE tm_bbm;


-- -----------------------------------------------------------------------------
-- Q-VOL — Volume baris per tabel (validasi "puluhan baris/shift")
-- -----------------------------------------------------------------------------
SELECT 'tr_djualbbm'   AS tbl, COUNT(*) AS n FROM tr_djualbbm
UNION ALL SELECT 'tr_hjualbbm',   COUNT(*) FROM tr_hjualbbm
UNION ALL SELECT 'tr_dkasbank',   COUNT(*) FROM tr_dkasbank
UNION ALL SELECT 'tr_hkasbank',   COUNT(*) FROM tr_hkasbank
UNION ALL SELECT 'tr_dopnamebbm', COUNT(*) FROM tr_dopnamebbm
UNION ALL SELECT 'tr_terimabbm',  COUNT(*) FROM tr_terimabbm;


-- =============================================================================
-- DOMAIN 1 — PENJUALAN
-- =============================================================================

-- Q-SALES-1 — Apakah (CKDJUALBBM, CKDNOZZLE, NURUT) benar-benar unik?
--   Jika kedua angka SAMA → kunci komposit valid sebagai PK.
SELECT COUNT(*) AS total_baris,
       COUNT(DISTINCT CONCAT(CKDJUALBBM,'|',CKDNOZZLE,'|',NURUT)) AS distinct_key
FROM tr_djualbbm;

-- Q-SALES-1b — Contoh duplikat key (idealnya 0 baris hasil)
SELECT CKDJUALBBM, CKDNOZZLE, NURUT, COUNT(*) AS c
FROM tr_djualbbm
GROUP BY CKDJUALBBM, CKDNOZZLE, NURUT
HAVING COUNT(*) > 1
LIMIT 20;

-- Q-SALES-2 — Nilai NSHIFT yang muncul (format shift)
SELECT NSHIFT, COUNT(*) AS n FROM tr_hjualbbm GROUP BY NSHIFT ORDER BY NSHIFT;

-- Q-SALES-2b — Sebaran flag koreksi SUBAH / SEDIT
SELECT SUBAH, SEDIT, COUNT(*) AS n
FROM tr_djualbbm
GROUP BY SUBAH, SEDIT
ORDER BY n DESC;

-- Q-SALES-3 — Lag antara DTGLJAM (waktu rekam) dan DTGLJUAL (tanggal bisnis).
--   Untuk menetapkan safety re-scan window. Lihat lag terbesar.
SELECT d.CKDNOZZLE,
       h.DTGLJUAL,
       d.DTGLJAM,
       TIMESTAMPDIFF(MINUTE, CAST(h.DTGLJUAL AS DATETIME), d.DTGLJAM) AS lag_menit
FROM tr_djualbbm d
JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM
ORDER BY d.DTGLJAM DESC
LIMIT 50;

-- Q-SALES-3b — Rentang DTGLJAM tersedia (paling lama s/d terbaru)
SELECT MIN(DTGLJAM) AS paling_lama, MAX(DTGLJAM) AS terbaru FROM tr_djualbbm;

-- Q-SALES-4 — Sampel baris penuh (lihat isi nyata, operator, harga)
SELECT * FROM tr_djualbbm ORDER BY DTGLJAM DESC LIMIT 10;


-- =============================================================================
-- DOMAIN 2 — KAS / PENGELUARAN
-- =============================================================================

-- Q-CASH-1 — Apakah tr_dkasbank punya kolom line-id unik per baris?
--   (Lihat output DESCRIBE tr_dkasbank di Q-SCHEMA — cari kolom NURUT/ID/dst.)
--   Cek apakah CKDKB saja unik di detail (jika tiap KB hanya 1 detail) atau banyak:
SELECT CKDKB, COUNT(*) AS jml_detail
FROM tr_dkasbank
GROUP BY CKDKB
ORDER BY jml_detail DESC
LIMIT 20;

-- Q-CASH-1c — Apakah (CKDKB, CKDPERK) sudah unik, atau ada duplikat?
--   Ini PENENTU: jika distinct_key == total_baris → (CKDKB,CKDPERK) bisa jadi
--   natural key (tak perlu surrogate). Jika distinct_key < total_baris → ADA
--   duplikat → WAJIB surrogate key (auto-increment) karena tak ada natural PK.
SELECT COUNT(*) AS total_baris,
       COUNT(DISTINCT CONCAT(CKDKB,'|',CKDPERK)) AS distinct_key
FROM tr_dkasbank;

-- Q-CASH-1d — Contoh duplikat (CKDKB, CKDPERK) bila ada (idealnya 0 baris hasil)
SELECT CKDKB, CKDPERK, COUNT(*) AS c
FROM tr_dkasbank
GROUP BY CKDKB, CKDPERK
HAVING COUNT(*) > 1
LIMIT 20;

-- Q-CASH-1b — Sampel baris penuh detail kas (lihat semua kolom yang ada)
SELECT * FROM tr_dkasbank LIMIT 15;

-- Q-CASH-2 — CKDPERK: berapa kode akun berbeda dipakai? perlu chart-of-accounts?
SELECT CKDPERK, COUNT(*) AS n, SUM(NJUMLAH) AS total_rp
FROM tr_dkasbank
GROUP BY CKDPERK
ORDER BY n DESC
LIMIT 30;

-- Q-CASH-2b — Adakah tabel master perkiraan/akun? (cari nama tabel mengandung 'perk')
SHOW TABLES LIKE '%perk%';
-- (jika ada, mis. tm_perkiraan, jalankan: DESCRIBE <nama>; SELECT * FROM <nama> LIMIT 20;)

-- Q-CASH-3 — Nilai SJNSTRANS (jenis transaksi masuk/keluar) + contoh keterangan
SELECT SJNSTRANS, COUNT(*) AS n
FROM tr_hkasbank
GROUP BY SJNSTRANS;

SELECT SJNSTRANS, VCKET, NTOTAL, DTGL
FROM tr_hkasbank
ORDER BY DTGL DESC
LIMIT 20;

-- Q-CASH-4 — Rentang DTGL tersedia
SELECT MIN(DTGL) AS paling_lama, MAX(DTGL) AS terbaru FROM tr_hkasbank;


-- =============================================================================
-- DOMAIN 3 — STOK (OPNAME) & PENERIMAAN
-- =============================================================================

-- Q-OPN-1 — Apakah (CKDOPNBBM, CKDTANGKI) unik di tr_dopnamebbm?
SELECT COUNT(*) AS total_baris,
       COUNT(DISTINCT CONCAT(CKDOPNBBM,'|',CKDTANGKI)) AS distinct_key
FROM tr_dopnamebbm;

-- Q-OPN-1b — Sampel baris opname penuh
SELECT * FROM tr_dopnamebbm ORDER BY DTGLJAM DESC LIMIT 10;

-- Q-OPN-2 — Rentang DTGLJAM opname
SELECT MIN(DTGLJAM) AS paling_lama, MAX(DTGLJAM) AS terbaru FROM tr_dopnamebbm;

-- Q-TRM-1 — Struktur PK tr_terimabbm: lihat kolom apa yang bisa jadi kunci.
--   (Lihat DESCRIBE tr_terimabbm di Q-SCHEMA; cek apakah CNODO unik.)
SELECT COUNT(*) AS total_baris,
       COUNT(DISTINCT CNODO) AS distinct_nodo
FROM tr_terimabbm;

-- Q-TRM-1b — Sampel baris terima penuh
SELECT * FROM tr_terimabbm ORDER BY DTGLJAM DESC LIMIT 10;

-- Q-TRM-2 — Rentang DTGLJAM terima
SELECT MIN(DTGLJAM) AS paling_lama, MAX(DTGLJAM) AS terbaru FROM tr_terimabbm;


-- =============================================================================
-- LINGKUNGAN
-- =============================================================================

-- Q-TZ — Zona waktu & jam mesin server SPBU (untuk konversi timestamptz)
SELECT @@global.time_zone AS tz_global,
       @@session.time_zone AS tz_session,
       NOW() AS jam_mesin_sekarang;

-- Q-VERSI — Versi MySQL (untuk fitur SQL yang aman dipakai agent)
SELECT VERSION() AS mysql_version;

-- Q-PRIV — (opsional, dijalankan sebagai user integrasi nanti) konfirmasi
--   user integrasi HANYA punya SELECT. Ganti 'solamax_ro'@'%' sesuai user dibuat.
-- SHOW GRANTS FOR CURRENT_USER();
