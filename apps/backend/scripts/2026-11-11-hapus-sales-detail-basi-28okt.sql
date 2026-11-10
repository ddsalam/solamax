-- SolaMax — hapus sales_detail BASI, 28 Oktober (unit 7)
--   08-10-2026 shift 3 JB202600843: 30 baris NURUT 0 (16.767,96 L / Rp 196.049.639)
--   Kelas cacat = detail-penjualan-basi (sama dgn BL 23-09, skrip 2026-09-24-...-bl.sql):
--   baris lahir NURUT 0 + DTGLJAM NULL (jam sintetis 00:00 WIB), di-ingest 09-10 06:47 WIB;
--   EasyMax lalu menulisnya ulang sbg NURUT 1 (ingest 07:52 WIB). NURUT 0 lenyap di sumber,
--   mirror tak pernah memangkasnya (agent unit 7 belum memakai bundle replace_details #392).
--   Tiap NURUT 0 di sini memulai meteran di nstandawal yang SAMA dgn kembarnya NURUT 1.
-- Jalankan sbg role `ingest`. Transaksi batal bila jumlah/volume/rupiah tak persis.
-- JANGAN dijalankan tanpa gerbang owner.
\set ON_ERROR_STOP on
SET app.unit_ids = '7';

CREATE TEMP TABLE target AS
SELECT * FROM sales_detail
WHERE unit_id = 7 AND ckdjualbbm = 'JB202600843' AND nurut = 0
  AND id BETWEEN 34526480 AND 34526509;

\copy (SELECT * FROM target ORDER BY id) TO 'backup-sales-detail-basi-28okt-2026-11-11.csv' CSV HEADER

BEGIN;
DO $$
DECLARE n int; c int; v numeric; r numeric; kembar int;
BEGIN
  SELECT count(*), sum(nvolume), sum(nsubtotal) INTO c, v, r FROM target;
  -- tiap target wajib punya kembar NURUT 1 pd nozzle yg sama, mulai di meteran yg sama
  SELECT count(*) INTO kembar FROM target t JOIN sales_detail b
    ON b.unit_id = 7 AND b.ckdjualbbm = t.ckdjualbbm AND b.ckdnozzle = t.ckdnozzle
   AND b.nurut = 1 AND b.nstandawal = t.nstandawal;
  IF c <> 30 OR v <> 16767.96 OR r <> 196049639 OR kembar <> 30 THEN
    RAISE EXCEPTION 'penjaga: target tak sesuai (% baris, % L, Rp %, kembar %)', c, v, r, kembar;
  END IF;
  DELETE FROM sales_detail d USING target t WHERE d.id = t.id AND d.unit_id = 7;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 30 THEN RAISE EXCEPTION 'penjaga: terhapus % baris, harus 30', n; END IF;
  -- Kunci cache G/L historis dashboard (getGlSourceRevision) ikut bergeser.
  UPDATE sync_state SET gl_revision = gl_revision + 1 WHERE unit_id = 7 AND domain = 'sales';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'penjaga: sync_state sales unit 7 tak ditemukan'; END IF;
  RAISE NOTICE 'OK: terhapus 30 baris, gl_revision sales unit 7 dinaikkan';
END $$;
COMMIT;

\echo == sesudah: 08-10 harus 51311.48 L; 07-10 & 09-10 tak berubah (51799.39 / 49076.12)
SELECT h.dtgljual, count(*) det, sum(sd.nvolume) vol, sum(sd.nsubtotal) rp
FROM sales_detail sd JOIN sales_header h ON h.unit_id=sd.unit_id AND h.ckdjualbbm=sd.ckdjualbbm
WHERE sd.unit_id=7 AND h.dtgljual BETWEEN '2026-10-07' AND '2026-10-09' GROUP BY 1 ORDER BY 1;

-- ROLLBACK (bila perlu, sbg `ingest`, SET app.unit_ids='7'):
--   \copy sales_detail FROM 'backup-sales-detail-basi-28okt-2026-11-11.csv' CSV HEADER
--   UPDATE sync_state SET gl_revision = gl_revision + 1 WHERE unit_id = 7 AND domain = 'sales';
