-- SolaMax — hapus sales_detail BASI, Batu Layang (unit 5)
--   23-09-2026 JB202600798: 14 baris NURUT 0 (15.610,80 L / Rp 196.068.215) — terbukti oracle EasyMax
--   25-07-2026 JB202600618: 22 baris NURUT 0 kembar identik NURUT 1 (2.793,51 L / Rp 34.296.980)
-- Jalankan sbg role `ingest`. Transaksi batal bila jumlah/volume tak persis.
\set ON_ERROR_STOP on
SET app.unit_ids = '5';

CREATE TEMP TABLE target AS
SELECT * FROM sales_detail
WHERE unit_id = 5 AND nurut = 0 AND id = ANY('{
  29655780,29655781,29655782,29655783,29655784,29655785,29655790,
  29655791,29655792,29655793,29655794,29655795,29655796,29655797,
  9204985,9204986,9204987,9204988,9204989,9204990,9204995,9204996,9204997,9204998,9204999,
  9205000,9205001,9205002,9205003,9205004,9205005,9205006,9205007,9205008,9205009,9205010}'::bigint[]);

\copy (SELECT * FROM target ORDER BY id) TO 'backup-sales-detail-basi-2026-09-24.csv' CSV HEADER

BEGIN;
DO $$
DECLARE n int; a798 int; a618 int; v798 numeric; v618 numeric;
BEGIN
  SELECT count(*) FILTER (WHERE ckdjualbbm='JB202600798'), count(*) FILTER (WHERE ckdjualbbm='JB202600618'),
         sum(nvolume) FILTER (WHERE ckdjualbbm='JB202600798'), sum(nvolume) FILTER (WHERE ckdjualbbm='JB202600618')
    INTO a798, a618, v798, v618 FROM target;
  IF a798 <> 14 OR a618 <> 22 OR v798 <> 15610.80 OR v618 <> 2793.51 THEN
    RAISE EXCEPTION 'penjaga: target tak sesuai (798: % baris % L; 618: % baris % L)', a798, v798, a618, v618;
  END IF;
  DELETE FROM sales_detail d USING target t WHERE d.id = t.id AND d.unit_id = 5;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 36 THEN RAISE EXCEPTION 'penjaga: terhapus % baris, harus 36', n; END IF;
  RAISE NOTICE 'OK: terhapus % baris', n;
END $$;
COMMIT;

\echo == sesudah: omset harian (harus 23-09 = 44302.50 L / 520013802.5)
SELECT h.dtgljual, count(*) det, sum(sd.nvolume) vol, sum(sd.nsubtotal) rp
FROM sales_detail sd JOIN sales_header h ON h.unit_id=sd.unit_id AND h.ckdjualbbm=sd.ckdjualbbm
WHERE sd.unit_id=5 AND h.dtgljual IN ('2026-07-25','2026-09-23') GROUP BY 1 ORDER BY 1;
