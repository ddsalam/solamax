-- Unit yang BENAR-BENAR mengirim source cut, plus sentinel yang membuktikan
-- kuerinya berjalan. Read-only.
--
-- Sentinel ada karena DB testing yang kosong memulangkan baris kosong yang
-- TIDAK dapat dibedakan dari sambungan yang gagal — dan "tidak ada keluaran"
-- bukan sinyal. Scope RLS seluruh unit: tanpa itu jawabannya nol tanpa galat.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), true) \g /dev/null
SELECT 'KUERI_JALAN' || '|' || COALESCE(
  (SELECT string_agg(u::text, ',' ORDER BY u)
   FROM (SELECT DISTINCT unit_id AS u FROM app.saldo_pelanggan_source_cycle) t), '');
ROLLBACK;
