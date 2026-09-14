-- Fixture generasi v1 untuk gerbang deploy (scripts/ci/check-migrate-deploy.sh).
-- Bentuknya meniru satu unit nyata: master pelanggan, potongan sumber bppiut /
-- bphut, dan SATU generasi `complete` yang totals + checksum-nya dihitung DARI
-- baris yang disimpan — jadi generasi itu konsisten dengan dirinya sendiri.
--
-- Variabel psql:
--   :perturb = 'none'   generasi konsisten; rebuild 0039 harus memulangkan
--                       angka yang sama persis (kontrol HIJAU dengan subjek).
--   :perturb = 'amount' satu nilai tersimpan digeser SESUDAH checksum dihitung
--                       ulang, sehingga `snapshot_v2_old_checksum_mismatch`
--                       TIDAK menyala lebih dulu dan yang diuji benar-benar
--                       `snapshot_v2_legacy_balance_mismatch` (migration.sql:311).
--   :building = 'yes'   tambahan manifest tersangkut `building`, bentuk sisa
--                       fixture B6 yang menjatuhkan deploy 13 September 2026.
\set ON_ERROR_STOP on
SET app.unit_ids = '1';

INSERT INTO app.tenant(id, name, slug, status)
VALUES ('11111111-1111-4111-8111-111111111111', 'Gate', 'gate', 'active')
ON CONFLICT DO NOTHING;
INSERT INTO public.unit(unit_id, code, name, api_key_hash, tenant_id)
VALUES (1, '6478111', 'Imam Bonjol', 'gate', '11111111-1111-4111-8111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO app.saldo_pelanggan_source_cycle
  (unit_id, source_cycle_id, source_cycle_sequence, status, source_completed_at, promoted_at,
   pelanggan_row_count, pelanggan_keyed_checksum, bppiut_row_count, bppiut_keyed_checksum,
   bphut_row_count, bphut_keyed_checksum)
VALUES (1, '00000000-0000-4000-8000-000000000001', 1, 'complete',
        '2026-09-12 19:05:15+00', now(),
        5, sha256('master'::bytea), 7, sha256('piut'::bytea), 2, sha256('hut'::bytea));

INSERT INTO app.saldo_pelanggan_source_pelanggan(unit_id, source_cycle_id, ckdplg, vcnmplg, sjenis, row_keyed_checksum)
SELECT 1, '00000000-0000-4000-8000-000000000001', code, code, kind, sha256(code::bytea)
FROM (VALUES ('IBLOCAL',1),('01.000.0003',3),('HUT',3),('ZERO',5),('N4',4)) v(code, kind);

INSERT INTO app.saldo_pelanggan_source_bppiut(unit_id, source_cycle_id, ckdbppiut, dtgl, ckdplg, njumlah, sjnsbp, sbatal, row_keyed_checksum)
SELECT 1, '00000000-0000-4000-8000-000000000001', key, date::date, code, amount, side, 0, sha256(key::bytea)
FROM (VALUES
  ('P1','2026-08-30','IBLOCAL',100::numeric,1),
  ('P2','2026-08-30','IBLOCAL',20::numeric,2),
  ('P3','2026-09-12','IBLOCAL',122345938194::numeric,1),
  ('P4','2026-09-12','IBLOCAL',109293254086.50::numeric,2),
  ('P5','2026-09-12','01.000.0003',10505841::numeric,1),
  ('P6','2026-09-12','01.000.0003',9605841::numeric,2),
  ('P7','2026-09-12','N4',6411357535::numeric,1)) v(key, date, code, amount, side);

INSERT INTO app.saldo_pelanggan_source_bphut(unit_id, source_cycle_id, ckdbphut, dtgl, ckdplg, njumlah, sjnsbp, sbatal, row_keyed_checksum)
SELECT 1, '00000000-0000-4000-8000-000000000001', key, '2026-09-12', 'HUT', amount, side, 0, sha256(key::bytea)
FROM (VALUES ('H1',53549062678.5::numeric,1),('H2',54222073216.5::numeric,2)) v(key, amount, side);

INSERT INTO app.saldo_pelanggan_snapshot_manifest
  (unit_id, as_of_date, generation_id, formula_version, status,
   source_cycle_id, source_cycle_sequence, source_completed_at)
VALUES (1, '2026-09-13', 'aaaaaaaa-0000-4000-8000-00000000a001', 'saldo-pelanggan-v1', 'building',
        '00000000-0000-4000-8000-000000000001', 1, '2026-09-12 19:05:15+00');

-- Baris tersimpan = hasil formula v1 atas potongan sumber di atas.
INSERT INTO app.saldo_pelanggan_snapshot_row
  (unit_id, as_of_date, generation_id, customer_code,
   awal_piutang_lokal, akhir_piutang_lokal, awal_piutang_online, akhir_piutang_online,
   awal_hutang_lokal, akhir_hutang_lokal)
SELECT 1, '2026-09-13'::date, 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid, v.*
FROM (VALUES
  ('IBLOCAL', 13052684187.50, 13052684187.50, 0, 0, 0, 0),
  ('01.000.0003', 0, 0, 900000, 900000, 0, 0),
  ('HUT', 0, 0, 0, 0, -673010538, -673010538),
  ('ZERO', 0, 0, 0, 0, 0, 0),
  ('N4', 0, 0, 0, 0, 0, 0)) v;

-- Perturbasi DULU, checksum SESUDAHNYA: kalau urutannya dibalik, guard yang
-- menyala adalah `old_checksum_mismatch` dan kasus ini berhenti menguji apa pun.
UPDATE app.saldo_pelanggan_snapshot_row
SET akhir_piutang_lokal = akhir_piutang_lokal + 1,
    awal_piutang_lokal = awal_piutang_lokal + 1
WHERE generation_id = 'aaaaaaaa-0000-4000-8000-00000000a001'
  AND customer_code = 'IBLOCAL'
  AND :'perturb' = 'amount';

UPDATE app.saldo_pelanggan_snapshot_manifest m SET
  status = 'complete', published = true, validation_passed = true,
  computed_at = now(), completed_at = now(), published_at = now(),
  customer_key_count = 5, row_count = 5,
  row_keyed_checksum = (
    SELECT sha256(convert_to(string_agg(concat_ws('|', unit_id::text, as_of_date::text, customer_code,
      awal_piutang_lokal::text, akhir_piutang_lokal::text, awal_piutang_online::text,
      akhir_piutang_online::text, awal_hutang_lokal::text, akhir_hutang_lokal::text),
      E'\n' ORDER BY customer_code), 'UTF8'))
    FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  awal_piutang_lokal_total = (SELECT sum(awal_piutang_lokal) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  akhir_piutang_lokal_total = (SELECT sum(akhir_piutang_lokal) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  awal_piutang_online_total = (SELECT sum(awal_piutang_online) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  akhir_piutang_online_total = (SELECT sum(akhir_piutang_online) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  awal_hutang_lokal_total = (SELECT sum(awal_hutang_lokal) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  akhir_hutang_lokal_total = (SELECT sum(akhir_hutang_lokal) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
  source_pelanggan_row_count = 5, source_pelanggan_keyed_checksum = sha256('master'::bytea),
  source_bppiut_row_count = 7, source_bppiut_keyed_checksum = sha256('piut'::bytea),
  source_bphut_row_count = 2, source_bphut_keyed_checksum = sha256('hut'::bytea)
WHERE m.generation_id = 'aaaaaaaa-0000-4000-8000-00000000a001';

INSERT INTO app.saldo_pelanggan_snapshot_pointer(unit_id, as_of_date, generation_id, source_cycle_sequence, rebuild_epoch)
VALUES (1, '2026-09-13', 'aaaaaaaa-0000-4000-8000-00000000a001', 1, 0);

-- Sisa berbentuk fixture B6: manifest yang tidak pernah selesai dibangun.
INSERT INTO app.saldo_pelanggan_snapshot_manifest
  (unit_id, as_of_date, generation_id, formula_version, status,
   source_cycle_id, source_cycle_sequence, source_completed_at)
SELECT 1, '2026-09-09', 'b6000000-0000-4000-8000-00000000a112', 'saldo-pelanggan-v1', 'building',
       '00000000-0000-4000-8000-000000000001', 1, '2026-09-12 19:05:15+00'
WHERE :'building' = 'yes';
