\set ON_ERROR_STOP on

-- Removes only deterministic B6 synthetic fixture keys from solamax-pg-rlsstg.
BEGIN;
DO $$
DECLARE
  actual_system_identifier text;
  expected_unit_ids integer[];
  expected_scope text;
  unit_row_count integer;
  unit_code_count integer;
  unit_id_count integer;
BEGIN
  SELECT system_identifier::text
  INTO actual_system_identifier
  FROM pg_control_system();
  IF current_database() <> 'solamax'
     OR actual_system_identifier <> '7659054651798528016' THEN
    RAISE EXCEPTION
      'cleanup requires solamax-pg-rlsstg (database=solamax, system_identifier=7659054651798528016)';
  END IF;

  SELECT array_agg(unit_id::integer ORDER BY unit_id),
         count(*),
         count(DISTINCT code),
         count(DISTINCT unit_id)
  INTO expected_unit_ids, unit_row_count, unit_code_count, unit_id_count
  FROM public.unit
  WHERE code IN ('6478111', '6378301', '6478101');

  IF unit_row_count <> 3 OR unit_code_count <> 3 OR unit_id_count <> 3 THEN
    RAISE EXCEPTION
      'cleanup requires exactly three distinct units for codes 6478111, 6378301, 6478101 (rows=%, codes=%, unit_ids=%)',
      unit_row_count, unit_code_count, unit_id_count;
  END IF;

  expected_scope := array_to_string(expected_unit_ids, ',');
  PERFORM set_config('app.unit_ids', expected_scope, true);
  IF current_setting('app.unit_ids', true) IS DISTINCT FROM expected_scope THEN
    RAISE EXCEPTION
      'cleanup RLS scope mismatch: expected %, got %',
      expected_scope, current_setting('app.unit_ids', true);
  END IF;
END $$;

-- Refuse a second, no-op, or partial cleanup before any DELETE. The exact RLS
-- scope above makes these counts a complete view of the deterministic fixture.
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

  IF pointer_count <> 2
     OR row_count <> 59
     OR manifest_count <> 3
     OR cycle_count <> 3
     OR customer_count <> 59 THEN
    RAISE EXCEPTION
      'B6 cleanup refused: expected installed fixture pointer=2 rows=59 manifest=3 cycle=3 customers=59; found pointer=% rows=% manifest=% cycle=% customers=%',
      pointer_count, row_count, manifest_count, cycle_count, customer_count;
  END IF;
END $$;

DO $$
DECLARE
  deleted_pointers bigint;
  deleted_rows bigint;
  deleted_manifests bigint;
  deleted_cycles bigint;
  deleted_customers bigint;
BEGIN
  DELETE FROM app.saldo_pelanggan_snapshot_pointer
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  GET DIAGNOSTICS deleted_pointers = ROW_COUNT;
  IF deleted_pointers <> 2 THEN
    RAISE EXCEPTION 'B6 cleanup expected to delete 2 pointers, deleted %', deleted_pointers;
  END IF;

  DELETE FROM app.saldo_pelanggan_snapshot_row
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a311'
  );
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  IF deleted_rows <> 59 THEN
    RAISE EXCEPTION 'B6 cleanup expected to delete 59 snapshot rows, deleted %', deleted_rows;
  END IF;

  DELETE FROM app.saldo_pelanggan_snapshot_manifest
  WHERE generation_id IN (
    'b6000000-0000-4000-8000-00000000a111',
    'b6000000-0000-4000-8000-00000000a112',
    'b6000000-0000-4000-8000-00000000a311'
  );
  GET DIAGNOSTICS deleted_manifests = ROW_COUNT;
  IF deleted_manifests <> 3 THEN
    RAISE EXCEPTION 'B6 cleanup expected to delete 3 manifests, deleted %', deleted_manifests;
  END IF;

  DELETE FROM app.saldo_pelanggan_source_cycle
  WHERE source_cycle_id IN (
    'b6000000-0000-4000-8000-000000000111',
    'b6000000-0000-4000-8000-000000000112',
    'b6000000-0000-4000-8000-000000000311'
  );
  GET DIAGNOSTICS deleted_cycles = ROW_COUNT;
  IF deleted_cycles <> 3 THEN
    RAISE EXCEPTION 'B6 cleanup expected to delete 3 source cycles, deleted %', deleted_cycles;
  END IF;

  WITH fixture_customers AS (
    SELECT u.unit_id, 'B6-' || lpad(n::text, 3, '0') AS customer_code
    FROM public.unit u
    CROSS JOIN generate_series(1, 52) n
    WHERE u.code = '6478111'

    UNION ALL

    SELECT u.unit_id, customer_code
    FROM public.unit u
    CROSS JOIN (VALUES ('B6.000.0001'), ('NOL/02')) fixture(customer_code)
    WHERE u.code = '6478111'

    UNION ALL

    SELECT u.unit_id, 'AS-B6-' || lpad(n::text, 2, '0') AS customer_code
    FROM public.unit u
    CROSS JOIN generate_series(1, 5) n
    WHERE u.code = '6478101'
  )
  DELETE FROM public.pelanggan_master p
  USING fixture_customers fixture
  WHERE p.unit_id = fixture.unit_id
    AND btrim(p.ckdplg) = fixture.customer_code;
  GET DIAGNOSTICS deleted_customers = ROW_COUNT;
  IF deleted_customers <> 59 THEN
    RAISE EXCEPTION 'B6 cleanup expected to delete 59 customers, deleted %', deleted_customers;
  END IF;
END $$;

\pset format unaligned
\pset tuples_only on
WITH residue AS (
  SELECT
    (SELECT count(*)
     FROM app.saldo_pelanggan_snapshot_pointer
     WHERE generation_id IN (
       'b6000000-0000-4000-8000-00000000a111',
       'b6000000-0000-4000-8000-00000000a311'
     )) AS pointer_count,
    (SELECT count(*)
     FROM app.saldo_pelanggan_snapshot_row
     WHERE generation_id IN (
       'b6000000-0000-4000-8000-00000000a111',
       'b6000000-0000-4000-8000-00000000a311'
     )) AS row_count,
    (SELECT count(*)
     FROM app.saldo_pelanggan_snapshot_manifest
     WHERE generation_id IN (
       'b6000000-0000-4000-8000-00000000a111',
       'b6000000-0000-4000-8000-00000000a112',
       'b6000000-0000-4000-8000-00000000a311'
     )) AS manifest_count,
    (SELECT count(*)
     FROM app.saldo_pelanggan_source_cycle
     WHERE source_cycle_id IN (
       'b6000000-0000-4000-8000-000000000111',
       'b6000000-0000-4000-8000-000000000112',
       'b6000000-0000-4000-8000-000000000311'
     )) AS cycle_count,
    (SELECT count(*)
     FROM public.pelanggan_master p
     JOIN (
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
     ) fixture
       ON fixture.unit_id = p.unit_id
      AND fixture.customer_code = btrim(p.ckdplg)) AS customer_count
)
SELECT format(
  'B6_CLEANUP_OK pointer=%s rows=%s manifest=%s cycle=%s customers=%s assert_zero=%s',
  pointer_count,
  row_count,
  manifest_count,
  cycle_count,
  customer_count,
  1 / CASE
        WHEN pointer_count + row_count + manifest_count + cycle_count + customer_count = 0 THEN 1
        ELSE 0
      END
)
FROM residue;

COMMIT;
