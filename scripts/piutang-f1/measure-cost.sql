-- F1 · PENGUKURAN BIAYA probe kesegaran — dijalankan Dion terhadap PRODUKSI
-- (`solamax:asia-southeast2:solamax-pg`) lewat cloud-sql-proxy, READ ONLY.
--
-- Prasyarat:
--   cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432
--   psql "$DATABASE_URL_DASHBOARD_RO" -X -v ON_ERROR_STOP=1 -f scripts/piutang-f1/measure-cost.sql
--
-- ⚠️ URUTANNYA MENGIKAT: probe ini TIDAK boleh masuk jalur baca sebelum angka
-- di bawah ada. `max(ingested_at)` atas ledger 2.134 MB bukan probe murah, dan
-- "murah" bukan sesuatu yang boleh diasumsikan dari bentuk kuerinya.
--
-- Tidak ada DDL di berkas ini. Keputusan indeks diambil SESUDAH membaca §3.
\set ON_ERROR_STOP on
\timing on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';

-- Scope RLS = SELURUH unit. Scope sempit memulangkan nol tanpa galat.
SELECT set_config('app.unit_ids',
                  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit),
                  true) AS scope_terpasang;

-- ── §1 · Subjek: berapa besar yang harus dilewati ───────────────────────────
SELECT 'bppiut' AS tabel,
       pg_size_pretty(pg_total_relation_size('public.bppiut')) AS ukuran,
       (SELECT count(*) FROM public.bppiut) AS baris_terlihat
UNION ALL
SELECT 'bphut',
       pg_size_pretty(pg_total_relation_size('public.bphut')),
       (SELECT count(*) FROM public.bphut);

SELECT relname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS ukuran, idx_scan
FROM pg_stat_user_indexes WHERE relname IN ('bppiut', 'bphut') ORDER BY relname, indexrelname;

-- ── §2 · Biaya SEKARANG (tanpa indeks atas ingested_at) ────────────────────
\set unit 1
SELECT m.source_cycle_id AS cut_id,
       m.source_completed_at AS cut_at,
       m.as_of_date AS as_of
FROM app.saldo_pelanggan_snapshot_manifest m
JOIN app.saldo_pelanggan_snapshot_pointer p
  ON p.unit_id = m.unit_id AND p.as_of_date = m.as_of_date AND p.generation_id = m.generation_id
WHERE m.unit_id = :unit
ORDER BY m.as_of_date DESC
LIMIT 1 \gset

\echo 'Cut aktif yang diukur:' :cut_id :cut_at :as_of

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING ON)
SELECT count(*), max(ingested_at)
FROM public.bppiut
WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz;

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING ON)
SELECT count(*), max(ingested_at)
FROM public.bphut
WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz;

-- Berapa baris yang SEBENARNYA berubah sejak cut. Ini yang menentukan apakah
-- himpunan kandidatnya memang kecil, atau kecilnya cuma harapan.
SELECT 'bppiut' AS tabel,
       count(*) AS berubah_sejak_cut,
       count(*) FILTER (WHERE dtgl <= :'as_of'::date) AS berdtgl_material
FROM public.bppiut WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz
UNION ALL
SELECT 'bphut', count(*), count(*) FILTER (WHERE dtgl <= :'as_of'::date)
FROM public.bphut WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz;

-- ── §3 · Angka yang memutuskan BENTUK indeksnya ────────────────────────────
-- Korelasi fisik `ingested_at` menentukan apakah BRIN cukup. Baris yang
-- di-UPDATE mendarat di ujung heap membawa ingested_at terbaru, jadi korelasi
-- di sini bisa TINGGI justru KARENA 74% bangkai itu. Kalau |correlation| tinggi,
-- BRIN (puluhan KB, nyaris nol beban tulis) mengalahkan btree (~90 MB bppiut +
-- ~17 MB bphut, ikut ke setiap UPDATE dan ikut ke gerbang 9 GB).
SELECT tablename, attname, correlation, n_distinct
FROM pg_stats
WHERE schemaname = 'public' AND tablename IN ('bppiut', 'bphut')
  AND attname IN ('ingested_at', 'unit_id', 'dtgl')
ORDER BY tablename, attname;

SELECT pg_size_pretty(pg_database_size(current_database())) AS ukuran_database_sekarang;

ROLLBACK;
