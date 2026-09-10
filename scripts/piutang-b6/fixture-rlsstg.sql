\set ON_ERROR_STOP on

-- Synthetic-only visual fixture for solamax-pg-rlsstg. Never run on solamax-pg.
BEGIN;
DO $$
DECLARE
  actual_system_identifier text;
BEGIN
  SELECT system_identifier::text
  INTO actual_system_identifier
  FROM pg_control_system();
  IF current_database() <> 'solamax'
     OR actual_system_identifier <> '7659054651798528016' THEN
    RAISE EXCEPTION
      'fixture requires solamax-pg-rlsstg (database=solamax, system_identifier=7659054651798528016)';
  END IF;
END $$;

SELECT set_config(
  'app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id)
   FROM public.unit WHERE code IN ('6478111', '6378301', '6478101')),
  true
);

-- Refuse a duplicate or partial installation. A partial fixture is evidence to
-- inspect, not state this script may silently overwrite.
DO $$
DECLARE
  pointer_count bigint;
  row_count bigint;
  manifest_count bigint;
  cycle_count bigint;
  customer_count bigint;
BEGIN
  SELECT count(*) INTO pointer_count
  FROM app.saldo_pelanggan_snapshot_pointer
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO row_count
  FROM app.saldo_pelanggan_snapshot_row
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO manifest_count
  FROM app.saldo_pelanggan_snapshot_manifest
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a112',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO cycle_count
  FROM app.saldo_pelanggan_source_cycle
  WHERE source_cycle_id IN (
    'b6000000-0000-4000-8000-000000000111',
    'b6000000-0000-4000-8000-000000000112',
    'b6000000-0000-4000-8000-000000000311'
  );
  WITH fixture_customers AS (
    SELECT u.unit_id, 'B6-' || lpad(n::text, 3, '0') AS customer_code
    FROM public.unit u CROSS JOIN generate_series(1, 52) n
    WHERE u.code = '6478111'
    UNION ALL
    SELECT u.unit_id, customer_code
    FROM public.unit u
    CROSS JOIN (VALUES ('B6.000.0001'), ('NOL/02')) fixture(customer_code)
    WHERE u.code = '6478111'
    UNION ALL
    SELECT u.unit_id, 'AS-B6-' || lpad(n::text, 2, '0') AS customer_code
    FROM public.unit u CROSS JOIN generate_series(1, 5) n
    WHERE u.code = '6478101'
  )
  SELECT count(*) INTO customer_count
  FROM public.pelanggan_master p
  JOIN fixture_customers fixture
    ON fixture.unit_id = p.unit_id
   AND fixture.customer_code = btrim(p.ckdplg);

  IF pointer_count + row_count + manifest_count + cycle_count + customer_count <> 0 THEN
    RAISE EXCEPTION
      'B6 fixture already or partially exists: pointer=%, rows=%, manifest=%, cycle=%, customers=%',
      pointer_count, row_count, manifest_count, cycle_count, customer_count;
  END IF;
END $$;

-- Labels remain in the live master because the strict reader uses it only as a label source.
WITH ib AS (SELECT unit_id FROM public.unit WHERE code = '6478111')
INSERT INTO public.pelanggan_master(unit_id, ckdplg, vcnmplg, sjenis, saktif)
SELECT ib.unit_id,
       ('B6-' || lpad(n::text, 3, '0'))::char(12),
       ('Pelanggan Sintetis ' || lpad(n::text, 3, '0'))::text,
       1, 1
FROM ib CROSS JOIN generate_series(1, 52) n
UNION ALL SELECT unit_id, 'B6.000.0001', 'Pelanggan Online Sintetis', 3, 1 FROM ib
UNION ALL SELECT unit_id, 'NOL/02', 'Pelanggan Saldo Nol', 5, 1 FROM ib;

WITH ad AS (SELECT unit_id FROM public.unit WHERE code = '6478101')
INSERT INTO public.pelanggan_master(unit_id, ckdplg, vcnmplg, sjenis, saktif)
SELECT ad.unit_id,
       ('AS-B6-' || lpad(n::text, 2, '0'))::char(12),
       ('Adisucipto Sintetis ' || n)::text,
       1, 1
FROM ad CROSS JOIN generate_series(1, 5) n;

-- Source-cycle rows exist solely to satisfy the immutable manifest's provenance FK.
WITH targets AS (
  SELECT unit_id, code FROM public.unit WHERE code IN ('6478111', '6478101')
), cycles AS (
  SELECT unit_id,
         CASE code WHEN '6478111' THEN 'b6000000-0000-4000-8000-000000000111'::uuid
                   ELSE 'b6000000-0000-4000-8000-000000000311'::uuid END AS cycle_id,
         900001::bigint AS seq
  FROM targets
  UNION ALL
  SELECT unit_id, 'b6000000-0000-4000-8000-000000000112'::uuid, 900002::bigint
  FROM targets WHERE code = '6478111'
)
INSERT INTO app.saldo_pelanggan_source_cycle(
  unit_id, source_cycle_id, source_cycle_sequence, status,
  source_completed_at, promoted_at,
  pelanggan_row_count, pelanggan_keyed_checksum,
  bppiut_row_count, bppiut_keyed_checksum,
  bphut_row_count, bphut_keyed_checksum
)
SELECT unit_id, cycle_id, seq, 'complete',
       '2026-09-09 16:10:00+00', '2026-09-09 16:11:00+00',
       0, decode(repeat('11', 32), 'hex'),
       0, decode(repeat('22', 32), 'hex'),
       0, decode(repeat('33', 32), 'hex')
FROM cycles;

WITH ib AS (SELECT unit_id FROM public.unit WHERE code = '6478111'),
     ad AS (SELECT unit_id FROM public.unit WHERE code = '6478101')
INSERT INTO app.saldo_pelanggan_snapshot_manifest(
  unit_id, as_of_date, generation_id, formula_version, status,
  source_cycle_id, source_cycle_sequence, source_cycle_status,
  source_completed_at, rebuild_epoch
)
SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a111'::uuid,
       'saldo-pelanggan-v1', 'building',
       'b6000000-0000-4000-8000-000000000111'::uuid, 900001, 'complete',
       '2026-09-09 16:10:00+00'::timestamptz, 0 FROM ib
UNION ALL
SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a311'::uuid,
       'saldo-pelanggan-v1', 'building',
       'b6000000-0000-4000-8000-000000000311'::uuid, 900001, 'complete',
       '2026-09-09 16:10:00+00'::timestamptz, 0 FROM ad;

WITH ib AS (SELECT unit_id FROM public.unit WHERE code = '6478111')
INSERT INTO app.saldo_pelanggan_snapshot_row(
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal
)
SELECT ib.unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a111'::uuid,
       'B6-' || lpad(n::text, 3, '0'),
       CASE WHEN n <= 45 THEN n * 10000 ELSE 0 END,
       CASE WHEN n <= 45 THEN n * 12000 ELSE 0 END,
       0, 0,
       CASE WHEN n % 7 = 0 THEN n * -1500 ELSE 0 END,
       CASE WHEN n % 7 = 0 THEN n * -1250 ELSE 0 END
FROM ib CROSS JOIN generate_series(1, 52) n
UNION ALL SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a111'::uuid,
                 'B6.000.0001', 0, 0, 250000, 275000, 0, 0 FROM ib
UNION ALL SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a111'::uuid,
                 'NOL/02', 0, 0, 0, 0, 0, 0 FROM ib;

WITH ad AS (SELECT unit_id FROM public.unit WHERE code = '6478101')
INSERT INTO app.saldo_pelanggan_snapshot_row(
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal
)
SELECT ad.unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a311'::uuid,
       'AS-B6-' || lpad(n::text, 2, '0'), n * 50000, n * 55000, 0, 0, 0, n * -1000
FROM ad CROSS JOIN generate_series(1, 5) n;

-- Seal the two active generations using the exact reader checksum contract.
WITH aggregates AS (
  SELECT unit_id, as_of_date, generation_id,
         count(*)::bigint AS row_count,
         sha256(convert_to(string_agg(
           concat_ws('|', unit_id::text, as_of_date::text, customer_code,
             awal_piutang_lokal::text, akhir_piutang_lokal::text,
             awal_piutang_online::text, akhir_piutang_online::text,
             awal_hutang_lokal::text, akhir_hutang_lokal::text),
           E'\n' ORDER BY customer_code), 'UTF8')) AS row_keyed_checksum,
         sum(awal_piutang_lokal) apl, sum(akhir_piutang_lokal) epl,
         sum(awal_piutang_online) apo, sum(akhir_piutang_online) epo,
         sum(awal_hutang_lokal) ahl, sum(akhir_hutang_lokal) ehl
  FROM app.saldo_pelanggan_snapshot_row
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  )
  GROUP BY unit_id, as_of_date, generation_id
)
UPDATE app.saldo_pelanggan_snapshot_manifest m
SET status = 'complete', computed_at = '2026-09-09 16:12:00+00',
    completed_at = '2026-09-09 16:12:00+00', published = true,
    published_at = '2026-09-09 16:12:00+00', validation_passed = true,
    customer_key_count = a.row_count, row_count = a.row_count,
    row_keyed_checksum = a.row_keyed_checksum,
    awal_piutang_lokal_total = a.apl, akhir_piutang_lokal_total = a.epl,
    awal_piutang_online_total = a.apo, akhir_piutang_online_total = a.epo,
    awal_hutang_lokal_total = a.ahl, akhir_hutang_lokal_total = a.ehl,
    source_pelanggan_row_count = 0, source_pelanggan_keyed_checksum = decode(repeat('11', 32), 'hex'),
    source_bppiut_row_count = 0, source_bppiut_keyed_checksum = decode(repeat('22', 32), 'hex'),
    source_bphut_row_count = 0, source_bphut_keyed_checksum = decode(repeat('33', 32), 'hex')
FROM aggregates a
WHERE m.unit_id = a.unit_id AND m.as_of_date = a.as_of_date AND m.generation_id = a.generation_id;

-- A newer building attempt keeps the previous complete pointer readable and
-- produces the mixed/stale-ready banner required by the B6 visual proof.
WITH ib AS (SELECT unit_id FROM public.unit WHERE code = '6478111')
INSERT INTO app.saldo_pelanggan_snapshot_manifest(
  unit_id, as_of_date, generation_id, formula_version, status,
  source_cycle_id, source_cycle_sequence, source_cycle_status,
  source_completed_at, rebuild_epoch
)
SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a112'::uuid,
       'saldo-pelanggan-v1', 'building',
       'b6000000-0000-4000-8000-000000000112'::uuid, 900002, 'complete',
       '2026-09-09 16:10:00+00'::timestamptz, 0
FROM ib;

WITH ib AS (SELECT unit_id FROM public.unit WHERE code = '6478111'),
     ad AS (SELECT unit_id FROM public.unit WHERE code = '6478101')
INSERT INTO app.saldo_pelanggan_snapshot_pointer(
  unit_id, as_of_date, generation_id, source_cycle_sequence, rebuild_epoch,
  pending_replacement, stale_invalid_from, pending_since
)
SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a111'::uuid, 900001, 0,
       true, '2026-09-09'::date, '2026-09-09 16:13:00+00'::timestamptz FROM ib
UNION ALL
SELECT unit_id, '2026-09-09'::date, 'b6000000-0000-4000-8000-00000000a311'::uuid, 900001, 0,
       false, NULL::date, NULL::timestamptz FROM ad;

DO $$
DECLARE
  pointer_count bigint;
  row_count bigint;
  manifest_count bigint;
  cycle_count bigint;
  customer_count bigint;
BEGIN
  SELECT count(*) INTO pointer_count
  FROM app.saldo_pelanggan_snapshot_pointer
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO row_count
  FROM app.saldo_pelanggan_snapshot_row
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO manifest_count
  FROM app.saldo_pelanggan_snapshot_manifest
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a112',
    'b6000000-0000-4000-8000-00000000a311'
  );
  SELECT count(*) INTO cycle_count
  FROM app.saldo_pelanggan_source_cycle
  WHERE source_cycle_id IN (
    'b6000000-0000-4000-8000-000000000111',
    'b6000000-0000-4000-8000-000000000112',
    'b6000000-0000-4000-8000-000000000311'
  );
  WITH fixture_customers AS (
    SELECT u.unit_id, 'B6-' || lpad(n::text, 3, '0') AS customer_code
    FROM public.unit u CROSS JOIN generate_series(1, 52) n
    WHERE u.code = '6478111'
    UNION ALL
    SELECT u.unit_id, customer_code
    FROM public.unit u
    CROSS JOIN (VALUES ('B6.000.0001'), ('NOL/02')) fixture(customer_code)
    WHERE u.code = '6478111'
    UNION ALL
    SELECT u.unit_id, 'AS-B6-' || lpad(n::text, 2, '0') AS customer_code
    FROM public.unit u CROSS JOIN generate_series(1, 5) n
    WHERE u.code = '6478101'
  )
  SELECT count(*) INTO customer_count
  FROM public.pelanggan_master p
  JOIN fixture_customers fixture
    ON fixture.unit_id = p.unit_id
   AND fixture.customer_code = btrim(p.ckdplg);

  IF (pointer_count, row_count, manifest_count, cycle_count, customer_count)
     <> (2::bigint, 59::bigint, 3::bigint, 3::bigint, 59::bigint) THEN
    RAISE EXCEPTION
      'B6 fixture count mismatch: pointer=%, rows=%, manifest=%, cycle=%, customers=%',
      pointer_count, row_count, manifest_count, cycle_count, customer_count;
  END IF;
  RAISE NOTICE
    'B6_FIXTURE_OK pointer=% rows=% manifest=% cycle=% customers=%',
    pointer_count, row_count, manifest_count, cycle_count, customer_count;
END $$;

COMMIT;
