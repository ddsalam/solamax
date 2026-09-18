-- UJI PENERIMAAN backfill pengawas pergerakan angka BEKU (migrasi 0040).
--
-- SEKALI JALAN, sesudah 0040 mendarat di produksi. Ia BUKAN gerbang berulang —
-- gerbang berulangnya adalah G5/G6 di 01-build-malam.sql.
--
-- Empat kaki, dan keempatnya harus setuju:
--
--   KAKI 1  ORAKEL PEMILIK. Lima peristiwa beku yang Dion hitung sendiri dari
--           manifest produksi 17-09-2026. Daftar ini memang dipatok — itulah
--           gunanya orakel. Ia menjawab "apakah definisi beku saya menyimpang
--           dari G5", dan jawaban itu tidak bisa datang dari sistem yang sedang
--           diuji.
--   KAKI 2  REKONSTRUKSI MANDIRI dari manifest, memakai kunci urutan pointer
--           (source_cycle_sequence, rebuild_epoch) dan ambang >= 1 rupiah pada
--           salah satu dari ENAM total. Ini menjawab "apakah backfill-nya
--           melewatkan atau mengarang sesuatu".
--   KAKI 3  ISI TABEL yang benar-benar terbit.
--   KAKI 4  PROVENANS tiap baris orakel yang ditambahkan belakangan, dibuktikan
--           dari source_change. Ia yang menjaga KAKI 1 tetap berdiri sendiri:
--           orakel yang dipatok ulang dengan menyalin tabel peristiwa tidak
--           menguji apa pun.
--
-- 📌 DIPATOK ULANG 18-09-2026: 5 -> 12. Orakel lama BASI, bukan salah — cut 206
--    menggeser tujuh tanggal beku unit 1 lewat 403 sisipan bppiut yang
--    menjangkau mundur sampai 2026-01-07. KAKI 2 memulangkan NOL selisih pada
--    saat itu, jadi definisi bekunya terbukti TIDAK menyimpang; yang berubah
--    kenyataannya. Ambangnya tidak dilonggarkan sedikit pun.
--
-- ⛔ Definisi beku tidak ditulis ulang di sini selain satu kali, dan bentuknya
--    HARUS sama dengan G5: as_of_date < source_completed_at::date - 7.
--
-- Jalankan: psql "$DATABASE_URL_PILOT" -X -f scripts/piutang-verifikasi/02-pengawas-beku.sql
\set ON_ERROR_STOP on
\timing on

-- View di LUAR transaksi: CREATE VIEW ditolak di dalam READ ONLY. Seluruh
-- PEMBACAAN tetap di dalam transaksi read-only yang diakhiri ROLLBACK.
CREATE TEMP VIEW v_orakel (unit_id, as_of_date, cut, provenans) AS
VALUES
  -- ── LIMA yang lama, 17-09-2026 ────────────────────────────────────────────
  -- Dihitung pemilik langsung dari manifest produksi SEBELUM pengawas ini ada.
  -- ⛔ JANGAN DIHAPUS dan jangan ditulis ulang: ini satu-satunya baris yang
  -- MENDAHULUI sistem yang diuji. Begitu ia diganti dengan sesuatu yang
  -- diturunkan dari sistem, KAKI 1 runtuh menjadi salinan KAKI 2.
  (1, DATE '2026-07-31', 171, 'manifest-pemilik-17-09'),
  (1, DATE '2026-08-31', 126, 'manifest-pemilik-17-09'),
  (1, DATE '2026-08-31', 171, 'manifest-pemilik-17-09'),
  (4, DATE '2026-08-31',  74, 'manifest-pemilik-17-09'),
  (4, DATE '2026-09-08',  74, 'manifest-pemilik-17-09'),
  -- ── TUJUH dari cut 206, 18-09-2026 ────────────────────────────────────────
  -- Ditambahkan karena orakel lama BASI, bukan karena ambangnya dilonggarkan:
  -- KAKI 2 (rekonstruksi mandiri) memulangkan NOL selisih, jadi definisi
  -- bekunya tidak menyimpang — yang berubah adalah kenyataannya.
  --
  -- Provenansnya TERPISAH dari tabel peristiwa: 403 baris bppiut ber-
  -- change_kind='insert' pada cut 206, menjangkau mundur sampai 2026-01-07.
  -- Tiap tanggal di bawah dibuktikan ulang oleh KAKI 4, dari source_change.
  -- Menyalinnya dari saldo_pelanggan_shift akan membuat KAKI 1 runtuh.
  --
  -- Jumlah baris bukti pada saat dipatok (source_change, cut 206,
  -- invalid_from_date <= tanggalnya): 30 / 39 / 49 / 51 / 52 / 58 / 58.
  (1, DATE '2026-04-30', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-05-31', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-06-30', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-07-31', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-08-31', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-09-08', 206, 'source_change-bppiut-206'),
  (1, DATE '2026-09-09', 206, 'source_change-bppiut-206');

-- KAKI 4 — PROVENANS. Tiap baris orakel yang mengaku berasal dari
-- source_change harus benar-benar punya buktinya di sana: sekurangnya satu
-- perubahan pada cut yang disebut, yang menjangkau mundur sampai <= tanggalnya.
--
-- Ini yang menjaga KAKI 1 tetap berdiri sendiri. Tanpa kaki ini, "patok ulang"
-- tidak bisa dibedakan dari "menyalin apa pun yang kebetulan diterbitkan
-- pengawasnya" — dan orakel yang menyalin sistem yang diuji tidak menguji apa
-- pun. Satu baris yang tak terbukti = GAGAL, dan itu berarti pengawasnya
-- mengarang peristiwa.
CREATE TEMP VIEW v_provenans AS
SELECT o.unit_id, o.as_of_date, o.cut, o.provenans,
       count(ch.*) AS baris_bukti,
       min(ch.invalid_from_date) AS bukti_terjauh
FROM v_orakel o
LEFT JOIN app.saldo_pelanggan_source_cycle c
  ON c.unit_id = o.unit_id AND c.source_cycle_sequence = o.cut
LEFT JOIN app.saldo_pelanggan_source_change ch
  ON ch.unit_id = o.unit_id AND ch.source_cycle_id = c.source_cycle_id
 AND ch.invalid_from_date IS NOT NULL
 AND ch.invalid_from_date <= o.as_of_date
WHERE o.provenans = 'source_change-bppiut-206'
GROUP BY o.unit_id, o.as_of_date, o.cut, o.provenans;

CREATE TEMP VIEW v_rekonstruksi AS
WITH gen AS (
  SELECT m.unit_id, m.as_of_date, m.generation_id, m.source_cycle_sequence,
         m.source_completed_at,
         m.awal_piutang_lokal_total   AS apl, m.akhir_piutang_lokal_total   AS epl,
         m.awal_piutang_online_total  AS apo, m.akhir_piutang_online_total  AS epo,
         m.awal_hutang_lokal_total    AS ahl, m.akhir_hutang_lokal_total    AS ehl,
         lag(m.awal_piutang_lokal_total)   OVER w AS p_apl,
         lag(m.akhir_piutang_lokal_total)  OVER w AS p_epl,
         lag(m.awal_piutang_online_total)  OVER w AS p_apo,
         lag(m.akhir_piutang_online_total) OVER w AS p_epo,
         lag(m.awal_hutang_lokal_total)    OVER w AS p_ahl,
         lag(m.akhir_hutang_lokal_total)   OVER w AS p_ehl,
         lag(m.generation_id)              OVER w AS p_gen
  FROM app.saldo_pelanggan_snapshot_manifest m
  WHERE m.status = 'complete'
  WINDOW w AS (PARTITION BY m.unit_id, m.as_of_date
               ORDER BY m.source_cycle_sequence, m.rebuild_epoch)
)
SELECT unit_id, as_of_date, source_cycle_sequence AS cut, generation_id,
       (as_of_date < source_completed_at::date - 7) AS frozen
FROM gen
WHERE p_gen IS NOT NULL
  AND (   abs(COALESCE(apl,0)-COALESCE(p_apl,0)) >= 1
       OR abs(COALESCE(epl,0)-COALESCE(p_epl,0)) >= 1
       OR abs(COALESCE(apo,0)-COALESCE(p_apo,0)) >= 1
       OR abs(COALESCE(epo,0)-COALESCE(p_epo,0)) >= 1
       OR abs(COALESCE(ahl,0)-COALESCE(p_ahl,0)) >= 1
       OR abs(COALESCE(ehl,0)-COALESCE(p_ehl,0)) >= 1);

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '180s';

-- 🔴 Tanpa ini setiap kueri di bawah memulangkan NOL BARIS TANPA GALAT, dan
-- "tak kurang tak lebih" akan lulus dengan sempurna atas dasar kekosongan.
SELECT set_config('app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), true) AS scope;

\echo '--- SUBJEK: apakah permukaannya benar-benar terbaca? ---'
SELECT (SELECT count(*) FROM public.unit)                              AS unit_terlihat,
       (SELECT count(*) FROM app.saldo_pelanggan_snapshot_manifest)    AS manifest_terlihat,
       (SELECT count(*) FROM app.saldo_pelanggan_shift)                AS peristiwa_terbit,
       (SELECT count(*) FROM app.saldo_pelanggan_shift WHERE frozen)   AS peristiwa_beku;

\echo '--- PERISTIWA BEKU yang terbit (harus persis lima) ---'
SELECT s.unit_id, s.as_of_date::text AS tanggal, s.source_cycle_sequence AS cut,
       trim_scale(COALESCE(s.after_akhir_piutang_lokal,0)  - COALESCE(s.before_akhir_piutang_lokal,0))  AS geser_piutang_lokal,
       trim_scale(COALESCE(s.after_akhir_piutang_online,0) - COALESCE(s.before_akhir_piutang_online,0)) AS geser_piutang_online,
       trim_scale(COALESCE(s.after_akhir_hutang_lokal,0)   - COALESCE(s.before_akhir_hutang_lokal,0))   AS geser_hutang_lokal
FROM app.saldo_pelanggan_shift s WHERE s.frozen
ORDER BY s.unit_id, s.as_of_date, s.source_cycle_sequence;

\echo '--- KAKI 4: PROVENANS tiap baris cut-206 (semua harus TERBUKTI) ---'
SELECT unit_id, as_of_date::text AS tanggal, cut, baris_bukti,
       bukti_terjauh::text,
       CASE WHEN baris_bukti > 0 THEN 'TERBUKTI' ELSE 'TIDAK TERBUKTI' END AS vonis
FROM v_provenans ORDER BY unit_id, as_of_date;

\echo '--- SELISIH terhadap ORAKEL PEMILIK (nol baris = cocok) ---'
SELECT 'kurang' AS arah, o.unit_id, o.as_of_date::text AS tanggal, o.cut
FROM v_orakel o
WHERE NOT EXISTS (SELECT 1 FROM app.saldo_pelanggan_shift s
                   WHERE s.frozen AND s.unit_id = o.unit_id
                     AND s.as_of_date = o.as_of_date AND s.source_cycle_sequence = o.cut)
UNION ALL
SELECT 'lebih', s.unit_id, s.as_of_date::text, s.source_cycle_sequence
FROM app.saldo_pelanggan_shift s
WHERE s.frozen
  AND NOT EXISTS (SELECT 1 FROM v_orakel o
                   WHERE o.unit_id = s.unit_id AND o.as_of_date = s.as_of_date
                     AND o.cut = s.source_cycle_sequence)
ORDER BY 1, 2, 3;

\echo '--- SELISIH terhadap REKONSTRUKSI MANDIRI (nol baris = cocok) ---'
SELECT 'kurang' AS arah, r.unit_id, r.as_of_date::text AS tanggal, r.cut, r.frozen
FROM v_rekonstruksi r
WHERE NOT EXISTS (SELECT 1 FROM app.saldo_pelanggan_shift s
                   WHERE s.unit_id = r.unit_id AND s.as_of_date = r.as_of_date
                     AND s.generation_id = r.generation_id AND s.frozen = r.frozen)
UNION ALL
SELECT 'lebih', s.unit_id, s.as_of_date::text, s.source_cycle_sequence, s.frozen
FROM app.saldo_pelanggan_shift s
WHERE NOT EXISTS (SELECT 1 FROM v_rekonstruksi r
                   WHERE r.unit_id = s.unit_id AND r.as_of_date = s.as_of_date
                     AND r.generation_id = s.generation_id AND r.frozen = s.frozen)
ORDER BY 1, 2, 3;

\echo '--- VONIS ---'
SELECT CASE
  WHEN (SELECT count(*) FROM public.unit) = 0
    THEN 'GAGAL G0: nol unit — scope RLS tak terpasang atau koneksinya salah'
  WHEN (SELECT count(*) FROM app.saldo_pelanggan_snapshot_manifest) = 0
    THEN 'GAGAL G0: nol manifest terlihat — tak ada subjek untuk diuji'
  WHEN (SELECT count(*) FROM app.saldo_pelanggan_shift) = 0
    THEN 'GAGAL: backfill 0040 tidak menerbitkan satu peristiwa pun'
  WHEN EXISTS (SELECT 1 FROM v_provenans WHERE baris_bukti = 0)
    THEN 'GAGAL KAKI 4: ada baris orakel tanpa bukti di source_change — orakelnya tidak layak pakai'
  WHEN EXISTS (
    SELECT 1 FROM v_orakel o
     WHERE NOT EXISTS (SELECT 1 FROM app.saldo_pelanggan_shift s
                        WHERE s.frozen AND s.unit_id = o.unit_id
                          AND s.as_of_date = o.as_of_date AND s.source_cycle_sequence = o.cut))
    THEN 'GAGAL: ada peristiwa beku di orakel pemilik yang TIDAK terbit'
  WHEN (SELECT count(*) FROM app.saldo_pelanggan_shift WHERE frozen)
       <> (SELECT count(*) FROM v_orakel)
    THEN 'GAGAL: jumlah peristiwa beku tidak sama dengan orakel pemilik'
  WHEN EXISTS (
    SELECT 1 FROM v_rekonstruksi r
     WHERE NOT EXISTS (SELECT 1 FROM app.saldo_pelanggan_shift s
                        WHERE s.unit_id = r.unit_id AND s.as_of_date = r.as_of_date
                          AND s.generation_id = r.generation_id AND s.frozen = r.frozen))
    THEN 'GAGAL: rekonstruksi mandiri menemukan pergeseran yang tidak terbit'
  ELSE 'LULUS: orakel pemilik, rekonstruksi mandiri, isi tabel, dan provenansnya bersepakat'
  END AS vonis;

ROLLBACK;

DROP VIEW v_provenans, v_rekonstruksi, v_orakel;
