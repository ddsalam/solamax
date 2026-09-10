\set ON_ERROR_STOP on

-- Removes only deterministic B6 synthetic fixture keys from solamax-pg-rlsstg.
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
      'cleanup requires solamax-pg-rlsstg (database=solamax, system_identifier=7659054651798528016)';
  END IF;
END $$;

SELECT set_config(
  'app.unit_ids',
  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id)
   FROM public.unit WHERE code IN ('6478111', '6378301', '6478101')),
  true
);

DELETE FROM app.saldo_pelanggan_snapshot_pointer
WHERE generation_id IN (
  'b6000000-0000-4000-8000-00000000a111',
  'b6000000-0000-4000-8000-00000000a311'
);
DELETE FROM app.saldo_pelanggan_snapshot_row
WHERE generation_id IN (
  'b6000000-0000-4000-8000-00000000a111',
  'b6000000-0000-4000-8000-00000000a311'
);
DELETE FROM app.saldo_pelanggan_snapshot_manifest
WHERE generation_id IN (
  'b6000000-0000-4000-8000-00000000a111',
  'b6000000-0000-4000-8000-00000000a112',
  'b6000000-0000-4000-8000-00000000a311'
);
DELETE FROM app.saldo_pelanggan_source_cycle
WHERE source_cycle_id IN (
  'b6000000-0000-4000-8000-000000000111',
  'b6000000-0000-4000-8000-000000000112',
  'b6000000-0000-4000-8000-000000000311'
);
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

COMMIT;
