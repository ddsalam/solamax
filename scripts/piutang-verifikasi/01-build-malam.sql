-- VERIFIKASI BUILD MALAM — read-only, ber-vonis sendiri, TANPA angka dipatok.
--
-- ⚠️ KENAPA TIDAK ADA DAFTAR UNIT MAUPUN RENTANG TANGGAL YANG DITULIS TANGAN.
-- Versi pertama memakai `unit_id IN (1,2,4)` dan rentang `2026-09-08..15`.
-- Pada 15-09-2026 malam, ketujuh unit mulai mengirim cut — dan versi itu akan
-- HIJAU sambil mengabaikan empat unit. Vonis yang lulus hampa adalah kelas yang
-- sudah ditolak tiga kali dalam arc ini (registry vs unit ber-cut, ambang total
-- vs per-unit, "nol baris" tanpa subjek). Melebarkannya jadi (1,...,7) hanya
-- mengulang cacatnya dengan angka lain: unit ke-8 akan diabaikan diam-diam.
--
-- Keduanya kini DITURUNKAN dari database:
--   · unit sasaran   = unit yang benar-benar punya source cycle;
--   · jendela tanggal = [cut complete terbaru − 7, cut complete terbaru],
--     yaitu definisi jendela backfill itu sendiri (SNAPSHOT_BACKFILL_LIMITS
--     .defaultDays = 7), bukan tanggal yang kebetulan benar hari ini.
--
-- AMBANG (ditulis sebelum angkanya ada):
--   G0 SENTINEL  — nol unit sasaran, atau nol subjek = GAGAL. Daftar kosong
--                  berarti kueri gagal atau scope RLS tidak terpasang; ia TIDAK
--                  BOLEH terbaca sebagai "bersih".
--   G1 CAKUPAN   — tiap unit sasaran punya >= 7 dari 8 tanggal jendelanya
--                  ber-pointer aktif, published, validation_passed.
--                  < 7 = GAGAL. Tepat 7 = PERIKSA (item superseded itu jinak).
--                  Unit sasaran TANPA cut complete = GAGAL: build-nya tak jalan.
--   G2 FORMULA   — setiap manifest `saldo-pelanggan-v2`. Satu pun bukan = GAGAL.
--   G3 KONTINUITAS — dalam CUT YANG SAMA, awal(D) HARUS SAMA dengan akhir(D−1);
--                  predikatnya identik (`dtgl < D` vs `dtgl <= D−1`). Satu
--                  pelanggaran = GAGAL. INI vonis yang benar-benar dapat merah:
--                  pasangan debet−kredit dijamin CHECK 0039, jadi memakainya
--                  sebagai bukti adalah uji yang tak bisa berbunyi.
--   G4 KONTROL   — keduabelas CHECK `_sides` ada.
--   G5 STABILITAS — tanggal yang sudah terbit boleh bergeser saat di-rebuild
--                  (pembayaran dicatat mundur; terukur IB 13-09 −536.588.685).
--                  Ambangnya LETAK, bukan rupiah — rebuild menyentuh 7 tanggal
--                  tiap malam, jadi ambang rupiah jadi alarm yang selalu
--                  menyala. Di DALAM jendela = PERIKSA; DI LUAR = GAGAL.
--
-- Jalankan: psql "$DATABASE_URL_PILOT" -X -f scripts/piutang-verifikasi/01-build-malam.sql
\set ON_ERROR_STOP on
\timing on
-- ⚠️ TEMP VIEW dibuat DI LUAR transaksi: `CREATE VIEW` ditolak di dalam
-- transaksi READ ONLY. Membuatnya di luar tidak melemahkan apa pun — view hanya
-- definisi; seluruh PEMBACAAN tetap terjadi di dalam transaksi read-only yang
-- diakhiri ROLLBACK, dan scope RLS-nya lokal terhadap transaksi itu.
CREATE TEMP VIEW v_sasaran AS
  SELECT DISTINCT unit_id FROM app.saldo_pelanggan_source_cycle;

CREATE TEMP VIEW v_jendela AS
  SELECT s.unit_id, c.cut_date, c.cut_date - 7 AS dari, c.cut_date AS sampai
  FROM v_sasaran s
  LEFT JOIN (
    SELECT unit_id, max(source_completed_at)::date AS cut_date
    FROM app.saldo_pelanggan_source_cycle WHERE status = 'complete' GROUP BY unit_id
  ) c ON c.unit_id = s.unit_id;

CREATE TEMP VIEW v_aktif AS
  SELECT m.unit_id, m.as_of_date, m.source_cycle_id, m.formula_version,
         m.published, m.validation_passed, m.row_count,
         m.awal_piutang_lokal_total AS apl, m.akhir_piutang_lokal_total AS epl,
         m.awal_piutang_online_total AS apo, m.akhir_piutang_online_total AS epo,
         m.awal_hutang_lokal_total AS ahl, m.akhir_hutang_lokal_total AS ehl
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_manifest m
    ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
  JOIN v_jendela j ON j.unit_id = m.unit_id
  WHERE m.as_of_date BETWEEN j.dari AND j.sampai;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '180s';

SELECT set_config('app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), true) AS scope;

\echo '--- SUBJEK per unit (jendela diturunkan dari cut, bukan dipatok) ---'
SELECT j.unit_id, j.cut_date, j.dari, j.sampai,
       count(a.*) AS tanggal_dalam_jendela,
       count(a.*) FILTER (WHERE a.published AND a.validation_passed) AS terbit_lolos,
       count(a.*) FILTER (WHERE a.formula_version = 'saldo-pelanggan-v2') AS v2
FROM v_jendela j LEFT JOIN v_aktif a ON a.unit_id = j.unit_id
GROUP BY j.unit_id, j.cut_date, j.dari, j.sampai ORDER BY j.unit_id;

\echo '--- G3: kontinuitas awal(D) = akhir(D-1) dalam cut yang sama ---'
SELECT a.unit_id, a.as_of_date::text AS tanggal,
       a.apl - k.epl AS beda_piutang_lokal, a.apo - k.epo AS beda_piutang_online,
       a.ahl - k.ehl AS beda_hutang_lokal
FROM v_aktif a JOIN v_aktif k
  ON k.unit_id = a.unit_id AND k.as_of_date = a.as_of_date - 1
 AND k.source_cycle_id = a.source_cycle_id
WHERE a.apl IS DISTINCT FROM k.epl OR a.apo IS DISTINCT FROM k.epo OR a.ahl IS DISTINCT FROM k.ehl
ORDER BY a.unit_id, a.as_of_date;
\echo '   (nol baris = G3 LULUS)'

\echo '--- G5: pergeseran antar-generasi ---'
WITH gen AS (
  SELECT unit_id, as_of_date, rebuild_epoch, source_completed_at,
         akhir_piutang_lokal_total AS epl, akhir_piutang_online_total AS epo,
         akhir_hutang_lokal_total AS ehl,
         row_number() OVER (PARTITION BY unit_id, as_of_date
                            ORDER BY rebuild_epoch DESC, completed_at DESC) AS rn
  FROM app.saldo_pelanggan_snapshot_manifest WHERE status = 'complete'
)
SELECT b.unit_id, b.as_of_date::text AS tanggal,
       (b.epl - l.epl) AS geser_piutang_lokal, (b.epo - l.epo) AS geser_piutang_online,
       (b.ehl - l.ehl) AS geser_hutang_lokal,
       CASE WHEN b.as_of_date >= b.source_completed_at::date - 7
            THEN 'dalam jendela (wajar)' ELSE 'DI LUAR JENDELA' END AS letak
FROM gen b JOIN gen l ON l.unit_id = b.unit_id AND l.as_of_date = b.as_of_date AND l.rn = 2
WHERE b.rn = 1 AND abs(b.epl - l.epl) + abs(b.epo - l.epo) + abs(b.ehl - l.ehl) >= 1
ORDER BY b.unit_id, b.as_of_date;

\echo '--- VONIS ---'
WITH cakupan AS (
  SELECT j.unit_id, j.cut_date,
         count(a.*) FILTER (WHERE a.published AND a.validation_passed) AS n
  FROM v_jendela j LEFT JOIN v_aktif a ON a.unit_id = j.unit_id
  GROUP BY j.unit_id, j.cut_date
), langgar AS (
  SELECT count(*) AS n FROM v_aktif a JOIN v_aktif k
    ON k.unit_id = a.unit_id AND k.as_of_date = a.as_of_date - 1
   AND k.source_cycle_id = a.source_cycle_id
  WHERE a.apl IS DISTINCT FROM k.epl OR a.apo IS DISTINCT FROM k.epo OR a.ahl IS DISTINCT FROM k.ehl
), gen AS (
  SELECT unit_id, as_of_date, rebuild_epoch, source_completed_at,
         akhir_piutang_lokal_total AS epl, akhir_piutang_online_total AS epo,
         akhir_hutang_lokal_total AS ehl,
         row_number() OVER (PARTITION BY unit_id, as_of_date
                            ORDER BY rebuild_epoch DESC, completed_at DESC) AS rn
  FROM app.saldo_pelanggan_snapshot_manifest WHERE status = 'complete'
), geser AS (
  SELECT (b.as_of_date < b.source_completed_at::date - 7) AS luar
  FROM gen b JOIN gen l ON l.unit_id = b.unit_id AND l.as_of_date = b.as_of_date AND l.rn = 2
  WHERE b.rn = 1 AND abs(b.epl - l.epl) + abs(b.epo - l.epo) + abs(b.ehl - l.ehl) >= 1
)
SELECT
  (SELECT count(*) FROM v_sasaran) AS unit_sasaran,
  (SELECT count(*) FROM v_aktif)   AS baris_subjek,
  CASE WHEN (SELECT count(*) FROM v_sasaran) = 0
         THEN 'GAGAL G0: nol unit ber-cut — kueri gagal atau scope RLS tak terpasang'
       WHEN (SELECT count(*) FROM v_aktif) = 0
         THEN 'GAGAL G0: nol subjek — tak ada snapshot di jendela mana pun'
       WHEN EXISTS (SELECT 1 FROM cakupan WHERE cut_date IS NULL)
         THEN 'GAGAL G1: ada unit ber-cut TANPA cut complete — build-nya tidak jalan'
       WHEN EXISTS (SELECT 1 FROM cakupan WHERE n < 7)
         THEN 'GAGAL G1: ada unit dengan < 7 tanggal terbit di jendelanya'
       WHEN EXISTS (SELECT 1 FROM v_aktif WHERE formula_version <> 'saldo-pelanggan-v2')
         THEN 'GAGAL G2: ada manifest bukan saldo-pelanggan-v2'
       WHEN (SELECT n FROM langgar) > 0
         THEN 'GAGAL G3: kontinuitas awal(D)=akhir(D-1) dilanggar'
       WHEN (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_sides') < 12
         THEN 'GAGAL G4: CHECK sisi debet-kredit tidak lengkap'
       WHEN (SELECT count(*) FROM geser WHERE luar) > 0
         THEN 'GAGAL G5: tanggal DI LUAR jendela bergeser antar-generasi'
       WHEN EXISTS (SELECT 1 FROM cakupan WHERE n = 7) OR (SELECT count(*) FROM geser) > 0
         THEN 'LULUS dengan PERIKSA: cakupan 7/8 dan/atau pergeseran dalam jendela'
       ELSE 'LULUS' END AS vonis;

ROLLBACK;

DROP VIEW v_aktif, v_jendela, v_sasaran;
