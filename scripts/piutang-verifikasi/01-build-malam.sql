-- VERIFIKASI BUILD MALAM 14→15 SEPTEMBER 2026 — read-only, ber-vonis sendiri.
--
-- Dijalankan sesudah tiga build terjadwal (unit 1 @02:05, unit 4 @03:05,
-- unit 2 @03:35). Ia TIDAK melaporkan "deploy hijau"; ia melaporkan apakah
-- DATANYA benar.
--
-- ⚠️ AMBANG DITULIS SEBELUM ANGKANYA ADA (15-09-2026, sebelum akses DB):
--
--   G1 CAKUPAN   — tiap unit (1,2,4) harus punya >= 7 dari 8 tanggal
--                  (2026-09-08..2026-09-15) ber-pointer aktif, published,
--                  validation_passed. < 7 = GAGAL. Tepat 7 = PERIKSA, bukan
--                  gagal: log build unit 1 memulangkan completed 7 /
--                  superseded 1, yang berarti satu item digantikan cut lebih
--                  baru — jinak, dan malam berikutnya mengantrekannya lagi.
--   G2 FORMULA   — setiap manifest harus `saldo-pelanggan-v2`. Satu pun bukan
--                  = GAGAL (0039 sudah live sejak 16:52 WIB 14-09).
--   G3 KONTINUITAS — untuk tanggal berurutan yang dibangun dari CUT YANG SAMA,
--                  awal(D) HARUS SAMA PERSIS dengan akhir(D−1), karena kedua
--                  predikatnya identik (`dtgl < D` vs `dtgl <= D−1`). Satu
--                  pelanggaran = GAGAL.
--                  INI pemeriksaan yang benar-benar dapat MERAH. Pasangan
--                  debet−kredit TIDAK dipakai sebagai vonis: 0039 memasang
--                  CHECK constraint untuknya, jadi ia mustahil gagal — memakainya
--                  sebagai "bukti" adalah uji yang tak bisa berbunyi.
--   G4 KONTROL   — keduabelas CHECK `_sides` harus ADA. Kalau ia hilang, G3
--                  saja tidak cukup dan vonis LULUS jadi terlalu murah.
--
-- Jalankan: psql "$DATABASE_URL_PILOT" -X -f scripts/piutang-verifikasi/01-build-malam.sql
\set ON_ERROR_STOP on
\timing on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';

SELECT set_config('app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), true) AS scope;

\echo '--- SUBJEK: tanggal ber-pointer aktif per unit (kontrol: harus ada isinya) ---'
SELECT p.unit_id, count(*) AS tanggal_aktif,
       min(p.as_of_date)::text AS dari, max(p.as_of_date)::text AS sampai,
       count(*) FILTER (WHERE m.formula_version = 'saldo-pelanggan-v2') AS v2,
       count(*) FILTER (WHERE m.published AND m.validation_passed) AS terbit_lolos
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
WHERE p.as_of_date BETWEEN '2026-09-08' AND '2026-09-15'
GROUP BY p.unit_id ORDER BY p.unit_id;

\echo '--- G3: kontinuitas awal(D) = akhir(D-1) dalam CUT YANG SAMA ---'
WITH aktif AS (
  SELECT m.unit_id, m.as_of_date, m.source_cycle_id,
         m.awal_piutang_lokal_total AS apl, m.akhir_piutang_lokal_total AS epl,
         m.awal_piutang_online_total AS apo, m.akhir_piutang_online_total AS epo,
         m.awal_hutang_lokal_total AS ahl, m.akhir_hutang_lokal_total AS ehl
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_manifest m
    ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
  WHERE m.status = 'complete' AND p.as_of_date BETWEEN '2026-09-08' AND '2026-09-15'
)
SELECT a.unit_id, a.as_of_date::text AS tanggal,
       a.apl - k.epl AS beda_piutang_lokal,
       a.apo - k.epo AS beda_piutang_online,
       a.ahl - k.ehl AS beda_hutang_lokal
FROM aktif a JOIN aktif k
  ON k.unit_id = a.unit_id AND k.as_of_date = a.as_of_date - 1
 AND k.source_cycle_id = a.source_cycle_id
WHERE a.apl IS DISTINCT FROM k.epl OR a.apo IS DISTINCT FROM k.epo OR a.ahl IS DISTINCT FROM k.ehl
ORDER BY a.unit_id, a.as_of_date;
\echo '   (nol baris = G3 LULUS)'

\echo '--- VONIS ---'
WITH aktif AS (
  SELECT m.unit_id, m.as_of_date, m.source_cycle_id, m.formula_version,
         m.published, m.validation_passed, m.row_count,
         m.awal_piutang_lokal_total AS apl, m.akhir_piutang_lokal_total AS epl,
         m.awal_piutang_online_total AS apo, m.akhir_piutang_online_total AS epo,
         m.awal_hutang_lokal_total AS ahl, m.akhir_hutang_lokal_total AS ehl
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_manifest m
    ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
  WHERE p.as_of_date BETWEEN '2026-09-08' AND '2026-09-15'
), cakupan AS (
  SELECT unit_id, count(*) FILTER (WHERE published AND validation_passed) AS n
  FROM aktif GROUP BY unit_id
), langgar AS (
  SELECT count(*) AS n FROM aktif a JOIN aktif k
    ON k.unit_id = a.unit_id AND k.as_of_date = a.as_of_date - 1
   AND k.source_cycle_id = a.source_cycle_id
  WHERE a.apl IS DISTINCT FROM k.epl OR a.apo IS DISTINCT FROM k.epo OR a.ahl IS DISTINCT FROM k.ehl
)
SELECT
  (SELECT count(*) FROM aktif) AS baris_subjek,
  CASE WHEN (SELECT count(*) FROM aktif) = 0 THEN 'GAGAL: nol subjek — scope RLS atau tak ada snapshot'
       WHEN EXISTS (SELECT 1 FROM cakupan WHERE unit_id IN (1,2,4) AND n < 7)
         OR (SELECT count(*) FROM cakupan WHERE unit_id IN (1,2,4)) < 3
         THEN 'GAGAL G1: ada unit 1/2/4 dengan < 7 tanggal terbit'
       WHEN EXISTS (SELECT 1 FROM aktif WHERE formula_version <> 'saldo-pelanggan-v2')
         THEN 'GAGAL G2: ada manifest bukan saldo-pelanggan-v2'
       WHEN (SELECT n FROM langgar) > 0
         THEN 'GAGAL G3: kontinuitas awal(D)=akhir(D-1) dilanggar'
       WHEN (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_sides') < 12
         THEN 'GAGAL G4: CHECK sisi debet-kredit tidak lengkap'
       WHEN EXISTS (SELECT 1 FROM cakupan WHERE unit_id IN (1,2,4) AND n = 7)
         THEN 'LULUS dengan PERIKSA: ada unit dengan tepat 7/8 (lihat superseded)'
       ELSE 'LULUS' END AS vonis;

ROLLBACK;
