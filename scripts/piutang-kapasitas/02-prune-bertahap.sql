-- KAPASITAS · §2 KURAS BERTAHAP — MENULIS. Hanya baris milik cycle `failed`.
--
-- ⚠️ KENAPA HANYA `failed`, padahal aplikasi juga memensiunkan `complete` yang
-- tersalip: cabang `complete` punya tiga `NOT EXISTS` yang halus (manifest
-- building, work aktif, dirty). Menyalin logika itu ke skrip operator berarti
-- dua definisi yang bisa menyimpang diam-diam. Tumpukan 11 GB ada di cycle
-- `failed`, dan `failed` tidak ambigu — jadi skrip ini mengambil bagian yang
-- aman saja dan menyerahkan sisanya ke aplikasi.
--
-- ⚠️ KENAPA BERTAHAP: satu DELETE atas belasan juta baris menahan XID panjang,
-- menggembungkan WAL, dan bila gagal mengembalikan NOL kemajuan. Tiap batch
-- COMMIT sendiri; berhenti di tengah tetap meninggalkan kemajuan.
--
-- Peran berkas ini BERULANG, bukan sekali pakai: dijalankan ketika tumpukan
-- cycle `failed` menumpuk (pemicu retirement mati, atau jeda panjang).
-- Ia menahan/membersihkan LAJU; ia TIDAK mengembalikan ruang ke OS — lihat
-- README.md di direktori ini.
--
-- Jalankan TANPA membungkusnya dalam transaksi (COMMIT di dalam DO hanya sah
-- di level teratas). Aman diulang; aman dihentikan Ctrl-C.
\set ON_ERROR_STOP on
\timing on

SELECT set_config('app.unit_ids',
                  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit),
                  false) AS scope_sesi;

DO $kuras$
DECLARE
  batch    int := 20000;
  tabel    text;
  terhapus bigint;
  total    bigint;
  mulai    timestamptz := clock_timestamp();
BEGIN
  IF current_setting('app.unit_ids', true) IS NULL
     OR current_setting('app.unit_ids', true) = '' THEN
    RAISE EXCEPTION 'app.unit_ids kosong — RLS akan memulangkan nol baris tanpa galat, dan nol itu bukan fakta';
  END IF;

  FOREACH tabel IN ARRAY ARRAY[
    'app.saldo_pelanggan_source_pelanggan',
    'app.saldo_pelanggan_source_bppiut',
    'app.saldo_pelanggan_source_bphut'
  ] LOOP
    total := 0;
    LOOP
      EXECUTE format($f$
        WITH doomed AS (
          SELECT s.ctid AS row_ctid
          FROM %s s
          JOIN app.saldo_pelanggan_source_cycle c
            ON c.unit_id = s.unit_id AND c.source_cycle_id = s.source_cycle_id
          WHERE c.status = 'failed'
          LIMIT %s
        )
        DELETE FROM %s s USING doomed d WHERE s.ctid = d.row_ctid
      $f$, tabel, batch, tabel);
      GET DIAGNOSTICS terhapus = ROW_COUNT;
      total := total + terhapus;
      COMMIT;
      EXIT WHEN terhapus < batch;
    END LOOP;
    RAISE NOTICE 'KURAS % — % baris dihapus (kumulatif %)', tabel, total,
      justify_interval(clock_timestamp() - mulai);
  END LOOP;
  RAISE NOTICE 'SELESAI dalam %', justify_interval(clock_timestamp() - mulai);
END
$kuras$;
