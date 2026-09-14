-- Reconstruct every stored generation from its OWN immutable source cut.
-- This upgrade is atomic: no reader can observe nullable sides, old checksums,
-- or mixed generation references. No defaults stand in for missing evidence.
-- FORCE RLS stays enabled; the migration scopes one existing unit at a time.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Bound lock acquisition, not reconstruction duration. Deployment runs this
-- migration before serving v2 readers/builders; never execute it manually.
LOCK TABLE app.saldo_pelanggan_source_cycle,
  app.saldo_pelanggan_source_pelanggan,
  app.saldo_pelanggan_source_bppiut,
  app.saldo_pelanggan_source_bphut IN SHARE MODE;
LOCK TABLE app.saldo_pelanggan_snapshot_manifest,
  app.saldo_pelanggan_snapshot_row,
  app.saldo_pelanggan_snapshot_pointer,
  app.saldo_pelanggan_build_work,
  app.saldo_pelanggan_dirty IN ACCESS EXCLUSIVE MODE;

ALTER TABLE app.saldo_pelanggan_snapshot_row
  ADD COLUMN awal_piutang_lokal_debet NUMERIC,
  ADD COLUMN awal_piutang_lokal_kredit NUMERIC,
  ADD COLUMN akhir_piutang_lokal_debet NUMERIC,
  ADD COLUMN akhir_piutang_lokal_kredit NUMERIC,
  ADD COLUMN awal_piutang_online_debet NUMERIC,
  ADD COLUMN awal_piutang_online_kredit NUMERIC,
  ADD COLUMN akhir_piutang_online_debet NUMERIC,
  ADD COLUMN akhir_piutang_online_kredit NUMERIC,
  ADD COLUMN awal_hutang_lokal_debet NUMERIC,
  ADD COLUMN awal_hutang_lokal_kredit NUMERIC,
  ADD COLUMN akhir_hutang_lokal_debet NUMERIC,
  ADD COLUMN akhir_hutang_lokal_kredit NUMERIC;

ALTER TABLE app.saldo_pelanggan_snapshot_manifest
  ADD COLUMN awal_piutang_lokal_debet_total NUMERIC,
  ADD COLUMN awal_piutang_lokal_kredit_total NUMERIC,
  ADD COLUMN akhir_piutang_lokal_debet_total NUMERIC,
  ADD COLUMN akhir_piutang_lokal_kredit_total NUMERIC,
  ADD COLUMN awal_piutang_online_debet_total NUMERIC,
  ADD COLUMN awal_piutang_online_kredit_total NUMERIC,
  ADD COLUMN akhir_piutang_online_debet_total NUMERIC,
  ADD COLUMN akhir_piutang_online_kredit_total NUMERIC,
  ADD COLUMN awal_hutang_lokal_debet_total NUMERIC,
  ADD COLUMN awal_hutang_lokal_kredit_total NUMERIC,
  ADD COLUMN akhir_hutang_lokal_debet_total NUMERIC,
  ADD COLUMN akhir_hutang_lokal_kredit_total NUMERIC;

ALTER TABLE app.saldo_pelanggan_snapshot_manifest ALTER CONSTRAINT sps_manifest_base_generation_fkey DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_snapshot_row ALTER CONSTRAINT sps_row_generation_fkey DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_snapshot_pointer ALTER CONSTRAINT sps_pointer_generation_fkey DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_build_work ALTER CONSTRAINT sps_work_generation_fkey DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_dirty ALTER CONSTRAINT sps_dirty_coverage_generation_fkey DEFERRABLE;
SET CONSTRAINTS app.sps_manifest_base_generation_fkey, app.sps_row_generation_fkey, app.sps_pointer_generation_fkey, app.sps_work_generation_fkey, app.sps_dirty_coverage_generation_fkey DEFERRED;

CREATE TEMP TABLE sps_v2_map (
  unit_id SMALLINT NOT NULL, as_of_date DATE NOT NULL,
  old_generation_id UUID NOT NULL, new_generation_id UUID NOT NULL,
  new_epoch BIGINT NOT NULL,
  PRIMARY KEY (unit_id, as_of_date, old_generation_id)
) ON COMMIT DROP;
CREATE TEMP TABLE sps_v2_rows (LIKE app.saldo_pelanggan_snapshot_row) ON COMMIT DROP;

DO $upgrade$
DECLARE
  scoped_unit SMALLINT;
  g RECORD;
  invalid_count BIGINT;
  proof RECORD;
  previous_scope TEXT := current_setting('app.unit_ids', true);
BEGIN
  FOR scoped_unit IN SELECT unit_id FROM public.unit ORDER BY unit_id LOOP
    PERFORM set_config('app.unit_ids', scoped_unit::text, true);
    IF EXISTS (SELECT 1 FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id = scoped_unit AND status = 'building')
       OR EXISTS (SELECT 1 FROM app.saldo_pelanggan_build_work WHERE unit_id = scoped_unit AND state = 'leased') THEN
      RAISE EXCEPTION 'snapshot_v2_active_builder: finish or retire active builds before upgrade (unit %)', scoped_unit;
    END IF;
    IF EXISTS (SELECT 1 FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id = scoped_unit AND formula_version <> 'saldo-pelanggan-v1') THEN
      RAISE EXCEPTION 'snapshot_v2_unexpected_formula: unit %', scoped_unit;
    END IF;
    -- An offset above ALL previous work/manifest epochs avoids collision with
    -- unfinished queue tuples and retains the existing publication ordering.
    INSERT INTO sps_v2_map
    SELECT m.unit_id, m.as_of_date, m.generation_id, gen_random_uuid(),
      GREATEST(
        (SELECT COALESCE(max(x.rebuild_epoch), 0) FROM app.saldo_pelanggan_snapshot_manifest x WHERE x.unit_id = m.unit_id AND x.as_of_date = m.as_of_date),
        (SELECT COALESCE(max(w.rebuild_epoch), 0) FROM app.saldo_pelanggan_build_work w WHERE w.unit_id = m.unit_id AND w.as_of_date = m.as_of_date)
      ) + row_number() OVER (PARTITION BY m.unit_id, m.as_of_date ORDER BY m.rebuild_epoch, m.generation_id)
    FROM app.saldo_pelanggan_snapshot_manifest m WHERE m.unit_id = scoped_unit;

    FOR g IN
      SELECT m.*, x.new_generation_id, x.new_epoch
      FROM app.saldo_pelanggan_snapshot_manifest m
      JOIN sps_v2_map x ON x.unit_id = m.unit_id AND x.as_of_date = m.as_of_date AND x.old_generation_id = m.generation_id
      WHERE m.unit_id = scoped_unit ORDER BY m.as_of_date, m.generation_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM app.saldo_pelanggan_source_cycle c
        WHERE c.unit_id = g.unit_id AND c.source_cycle_id = g.source_cycle_id
          AND c.source_cycle_sequence = g.source_cycle_sequence AND c.status = 'complete'
          AND c.source_completed_at = g.source_completed_at
          AND c.pelanggan_keyed_checksum IS NOT NULL AND c.bppiut_keyed_checksum IS NOT NULL AND c.bphut_keyed_checksum IS NOT NULL
          AND c.pelanggan_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan p WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id)
          AND c.bppiut_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_bppiut p WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id)
          AND c.bphut_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_bphut h WHERE h.unit_id = c.unit_id AND h.source_cycle_id = c.source_cycle_id)
      ) THEN
        RAISE EXCEPTION 'snapshot_v2_source_cut_incomplete: unit %, generation %', g.unit_id, g.generation_id;
      END IF;

SELECT count(*) INTO invalid_count
FROM (
  SELECT p.ckdplg::text
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = g.unit_id::smallint
    AND p.source_cycle_id = g.source_cycle_id::uuid
    AND NULLIF(btrim(p.ckdplg), '') IS NULL
  UNION ALL
  SELECT b.ckdplg
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = g.unit_id::smallint
    AND b.source_cycle_id = g.source_cycle_id::uuid
    AND b.dtgl <= g.as_of_date::date
    AND COALESCE(sbatal, 0) = 0
    AND NULLIF(btrim(ckdplg), '') IS NULL
  UNION ALL
  SELECT h.ckdplg
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = g.unit_id::smallint
    AND h.source_cycle_id = g.source_cycle_id::uuid
    AND h.dtgl <= g.as_of_date::date
    AND COALESCE(sbatal, 0) = 0
    AND NULLIF(btrim(ckdplg), '') IS NULL
) invalid;
      IF invalid_count <> 0 THEN RAISE EXCEPTION 'snapshot_v2_invalid_customer_key'; END IF;

SELECT count(*) INTO invalid_count
FROM (
  SELECT b.sjnsbp
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = g.unit_id::smallint AND b.source_cycle_id = g.source_cycle_id::uuid
    AND b.dtgl <= g.as_of_date::date AND COALESCE(b.sbatal, 0) = 0
    AND (b.sjnsbp IS NULL OR b.sjnsbp NOT IN (1, 2))
    AND (position('.' in btrim(b.ckdplg)) > 0 OR EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_pelanggan p
      WHERE p.unit_id = b.unit_id AND p.source_cycle_id = b.source_cycle_id
        AND btrim(p.ckdplg) = btrim(b.ckdplg) AND p.sjenis IN (1, 5)
    ))
  UNION ALL
  SELECT h.sjnsbp
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = g.unit_id::smallint AND h.source_cycle_id = g.source_cycle_id::uuid
    AND h.dtgl <= g.as_of_date::date AND COALESCE(h.sbatal, 0) = 0
    AND (h.sjnsbp IS NULL OR h.sjnsbp NOT IN (1, 2))
) invalid;
      IF invalid_count <> 0 THEN RAISE EXCEPTION 'snapshot_v2_invalid_sjnsbp'; END IF;
      IF g.status = 'complete' AND g.row_keyed_checksum IS DISTINCT FROM (
        SELECT sha256(convert_to(COALESCE(string_agg(
          concat_ws('|', unit_id::text, as_of_date::text, customer_code,
            awal_piutang_lokal::text, akhir_piutang_lokal::text, awal_piutang_online::text, akhir_piutang_online::text, awal_hutang_lokal::text, akhir_hutang_lokal::text),
          E'\n' ORDER BY customer_code), ''), 'UTF8'))
        FROM app.saldo_pelanggan_snapshot_row
        WHERE unit_id = g.unit_id AND as_of_date = g.as_of_date AND generation_id = g.generation_id
      ) THEN
        RAISE EXCEPTION 'snapshot_v2_old_checksum_mismatch: unit %, generation %', g.unit_id, g.generation_id;
      END IF;

SELECT count(*) INTO invalid_count
FROM (
  SELECT b.njumlah
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = g.unit_id::smallint AND b.source_cycle_id = g.source_cycle_id::uuid
    AND b.dtgl <= g.as_of_date::date AND COALESCE(b.sbatal, 0) = 0
    AND b.njumlah IS NULL
    AND (position('.' in btrim(b.ckdplg)) > 0 OR EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_pelanggan p
      WHERE p.unit_id = b.unit_id AND p.source_cycle_id = b.source_cycle_id
        AND btrim(p.ckdplg) = btrim(b.ckdplg) AND p.sjenis IN (1, 5)
    ))
  UNION ALL
  SELECT h.njumlah
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = g.unit_id::smallint AND h.source_cycle_id = g.source_cycle_id::uuid
    AND h.dtgl <= g.as_of_date::date AND COALESCE(h.sbatal, 0) = 0
    AND h.njumlah IS NULL
) invalid;
      IF invalid_count <> 0 THEN RAISE EXCEPTION 'snapshot_v2_invalid_source_amount'; END IF;
      TRUNCATE sps_v2_rows;

WITH master_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = g.unit_id::smallint AND p.source_cycle_id = g.source_cycle_id::uuid
), local_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = g.unit_id::smallint
    AND p.source_cycle_id = g.source_cycle_id::uuid
    AND p.sjenis IN (1, 5)
), live_piut AS (
  SELECT btrim(b.ckdplg) AS customer_code,
         b.dtgl, b.sjnsbp, b.njumlah,
         b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = g.unit_id::smallint
    AND b.source_cycle_id = g.source_cycle_id::uuid
    AND b.dtgl <= g.as_of_date::date
    AND COALESCE(sbatal, 0) = 0
), live_hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
         h.dtgl, h.sjnsbp, h.njumlah,
         h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = g.unit_id::smallint
    AND h.source_cycle_id = g.source_cycle_id::uuid
    AND h.dtgl <= g.as_of_date::date
    AND COALESCE(sbatal, 0) = 0
), customer_keys AS (
  SELECT customer_code FROM master_keys
  UNION SELECT customer_code FROM live_piut
  UNION SELECT customer_code FROM live_hut
), piut AS (
  SELECT p.customer_code,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL
        AND position('.' in p.customer_code) = 0
        AND p.dtgl < g.as_of_date::date
    ), 0) AS awal_piutang_lokal,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL
        AND position('.' in p.customer_code) = 0
        AND p.dtgl <= g.as_of_date::date
    ), 0) AS akhir_piutang_lokal,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < g.as_of_date::date AND p.sjnsbp = 1), 0) AS awal_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < g.as_of_date::date AND p.sjnsbp = 2), 0) AS awal_piutang_lokal_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= g.as_of_date::date AND p.sjnsbp = 1), 0) AS akhir_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= g.as_of_date::date AND p.sjnsbp = 2), 0) AS akhir_piutang_lokal_kredit,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl < g.as_of_date::date
    ), 0) AS awal_piutang_online,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl <= g.as_of_date::date
    ), 0) AS akhir_piutang_online,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < g.as_of_date::date AND p.sjnsbp = 1), 0) AS awal_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < g.as_of_date::date AND p.sjnsbp = 2), 0) AS awal_piutang_online_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= g.as_of_date::date AND p.sjnsbp = 1), 0) AS akhir_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= g.as_of_date::date AND p.sjnsbp = 2), 0) AS akhir_piutang_online_kredit
  FROM live_piut p
  LEFT JOIN local_keys l ON l.customer_code = p.customer_code
  GROUP BY p.customer_code
), hut AS (
  SELECT h.customer_code,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl < g.as_of_date::date), 0)
      AS awal_hutang_lokal,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl <= g.as_of_date::date), 0)
      AS akhir_hutang_lokal,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < g.as_of_date::date AND h.sjnsbp = 1), 0) AS awal_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < g.as_of_date::date AND h.sjnsbp = 2), 0) AS awal_hutang_lokal_kredit,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= g.as_of_date::date AND h.sjnsbp = 1), 0) AS akhir_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= g.as_of_date::date AND h.sjnsbp = 2), 0) AS akhir_hutang_lokal_kredit
  FROM live_hut h
  GROUP BY h.customer_code
)
INSERT INTO sps_v2_rows (
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal,
  awal_piutang_lokal_debet,
  awal_piutang_lokal_kredit,
  akhir_piutang_lokal_debet,
  akhir_piutang_lokal_kredit,
  awal_piutang_online_debet,
  awal_piutang_online_kredit,
  akhir_piutang_online_debet,
  akhir_piutang_online_kredit,
  awal_hutang_lokal_debet,
  awal_hutang_lokal_kredit,
  akhir_hutang_lokal_debet,
  akhir_hutang_lokal_kredit
)
SELECT g.unit_id::smallint, g.as_of_date::date, g.new_generation_id::uuid, k.customer_code,
       COALESCE(p.awal_piutang_lokal, 0), COALESCE(p.akhir_piutang_lokal, 0),
       COALESCE(p.awal_piutang_online, 0), COALESCE(p.akhir_piutang_online, 0),
       COALESCE(h.awal_hutang_lokal, 0), COALESCE(h.akhir_hutang_lokal, 0),
       COALESCE(p.awal_piutang_lokal_debet, 0),
       COALESCE(p.awal_piutang_lokal_kredit, 0),
       COALESCE(p.akhir_piutang_lokal_debet, 0),
       COALESCE(p.akhir_piutang_lokal_kredit, 0),
       COALESCE(p.awal_piutang_online_debet, 0),
       COALESCE(p.awal_piutang_online_kredit, 0),
       COALESCE(p.akhir_piutang_online_debet, 0),
       COALESCE(p.akhir_piutang_online_kredit, 0),
       COALESCE(h.awal_hutang_lokal_debet, 0),
       COALESCE(h.awal_hutang_lokal_kredit, 0),
       COALESCE(h.akhir_hutang_lokal_debet, 0),
       COALESCE(h.akhir_hutang_lokal_kredit, 0)
FROM customer_keys k
LEFT JOIN piut p ON p.customer_code = k.customer_code
LEFT JOIN hut h ON h.customer_code = k.customer_code
;
      -- Complete generations must retain every key and every old amount.
      -- Failed generations are rebuilt but remain failed and cannot be read.
      IF g.status = 'complete' AND EXISTS (
        SELECT 1 FROM (
          SELECT * FROM app.saldo_pelanggan_snapshot_row
          WHERE unit_id = g.unit_id AND as_of_date = g.as_of_date AND generation_id = g.generation_id
        ) old FULL JOIN sps_v2_rows fresh USING (customer_code)
        WHERE old.customer_code IS NULL OR fresh.customer_code IS NULL
          OR ROW(old.awal_piutang_lokal, old.akhir_piutang_lokal, old.awal_piutang_online, old.akhir_piutang_online, old.awal_hutang_lokal, old.akhir_hutang_lokal) IS DISTINCT FROM ROW(fresh.awal_piutang_lokal, fresh.akhir_piutang_lokal, fresh.awal_piutang_online, fresh.akhir_piutang_online, fresh.awal_hutang_lokal, fresh.akhir_hutang_lokal)
      ) THEN
        RAISE EXCEPTION 'snapshot_v2_legacy_balance_mismatch: unit %, generation %', g.unit_id, g.generation_id;
      END IF;
      SELECT count(*)::bigint AS row_count,
        sha256(convert_to(COALESCE(string_agg(
          concat_ws('|', unit_id::text, as_of_date::text, customer_code,
            awal_piutang_lokal::text,
            akhir_piutang_lokal::text,
            awal_piutang_online::text,
            akhir_piutang_online::text,
            awal_hutang_lokal::text,
            akhir_hutang_lokal::text,
            awal_piutang_lokal_debet::text,
            awal_piutang_lokal_kredit::text,
            akhir_piutang_lokal_debet::text,
            akhir_piutang_lokal_kredit::text,
            awal_piutang_online_debet::text,
            awal_piutang_online_kredit::text,
            akhir_piutang_online_debet::text,
            akhir_piutang_online_kredit::text,
            awal_hutang_lokal_debet::text,
            awal_hutang_lokal_kredit::text,
            akhir_hutang_lokal_debet::text,
            akhir_hutang_lokal_kredit::text),
          E'\n' ORDER BY customer_code), ''), 'UTF8')) AS checksum,
        COALESCE(sum(awal_piutang_lokal), 0) AS awal_piutang_lokal_total,
        COALESCE(sum(akhir_piutang_lokal), 0) AS akhir_piutang_lokal_total,
        COALESCE(sum(awal_piutang_online), 0) AS awal_piutang_online_total,
        COALESCE(sum(akhir_piutang_online), 0) AS akhir_piutang_online_total,
        COALESCE(sum(awal_hutang_lokal), 0) AS awal_hutang_lokal_total,
        COALESCE(sum(akhir_hutang_lokal), 0) AS akhir_hutang_lokal_total,
        COALESCE(sum(awal_piutang_lokal_debet), 0) AS awal_piutang_lokal_debet_total,
        COALESCE(sum(awal_piutang_lokal_kredit), 0) AS awal_piutang_lokal_kredit_total,
        COALESCE(sum(akhir_piutang_lokal_debet), 0) AS akhir_piutang_lokal_debet_total,
        COALESCE(sum(akhir_piutang_lokal_kredit), 0) AS akhir_piutang_lokal_kredit_total,
        COALESCE(sum(awal_piutang_online_debet), 0) AS awal_piutang_online_debet_total,
        COALESCE(sum(awal_piutang_online_kredit), 0) AS awal_piutang_online_kredit_total,
        COALESCE(sum(akhir_piutang_online_debet), 0) AS akhir_piutang_online_debet_total,
        COALESCE(sum(akhir_piutang_online_kredit), 0) AS akhir_piutang_online_kredit_total,
        COALESCE(sum(awal_hutang_lokal_debet), 0) AS awal_hutang_lokal_debet_total,
        COALESCE(sum(awal_hutang_lokal_kredit), 0) AS awal_hutang_lokal_kredit_total,
        COALESCE(sum(akhir_hutang_lokal_debet), 0) AS akhir_hutang_lokal_debet_total,
        COALESCE(sum(akhir_hutang_lokal_kredit), 0) AS akhir_hutang_lokal_kredit_total
      INTO proof FROM sps_v2_rows;
      IF g.status = 'complete' AND (
        g.row_count IS DISTINCT FROM proof.row_count OR
        ROW(g.awal_piutang_lokal_total, g.akhir_piutang_lokal_total, g.awal_piutang_online_total, g.akhir_piutang_online_total, g.awal_hutang_lokal_total, g.akhir_hutang_lokal_total) IS DISTINCT FROM ROW(proof.awal_piutang_lokal_total, proof.akhir_piutang_lokal_total, proof.awal_piutang_online_total, proof.akhir_piutang_online_total, proof.awal_hutang_lokal_total, proof.akhir_hutang_lokal_total)
      ) THEN
        RAISE EXCEPTION 'snapshot_v2_manifest_mismatch: unit %, generation %', g.unit_id, g.generation_id;
      END IF;
      DELETE FROM app.saldo_pelanggan_snapshot_row WHERE unit_id = g.unit_id AND as_of_date = g.as_of_date AND generation_id = g.generation_id;
      INSERT INTO app.saldo_pelanggan_snapshot_row SELECT * FROM sps_v2_rows;
      UPDATE app.saldo_pelanggan_snapshot_manifest SET
        generation_id = g.new_generation_id, rebuild_epoch = g.new_epoch,
        formula_version = 'saldo-pelanggan-v2',
        computed_at = CASE WHEN status = 'complete' THEN clock_timestamp() ELSE computed_at END,
        completed_at = CASE WHEN status = 'complete' THEN clock_timestamp() ELSE completed_at END,
        published_at = CASE WHEN status = 'complete' AND published THEN clock_timestamp() ELSE published_at END,
        customer_key_count = proof.row_count, row_count = proof.row_count,
        row_keyed_checksum = proof.checksum,
        awal_piutang_lokal_total = proof.awal_piutang_lokal_total,
        akhir_piutang_lokal_total = proof.akhir_piutang_lokal_total,
        awal_piutang_online_total = proof.awal_piutang_online_total,
        akhir_piutang_online_total = proof.akhir_piutang_online_total,
        awal_hutang_lokal_total = proof.awal_hutang_lokal_total,
        akhir_hutang_lokal_total = proof.akhir_hutang_lokal_total,
        awal_piutang_lokal_debet_total = proof.awal_piutang_lokal_debet_total,
        awal_piutang_lokal_kredit_total = proof.awal_piutang_lokal_kredit_total,
        akhir_piutang_lokal_debet_total = proof.akhir_piutang_lokal_debet_total,
        akhir_piutang_lokal_kredit_total = proof.akhir_piutang_lokal_kredit_total,
        awal_piutang_online_debet_total = proof.awal_piutang_online_debet_total,
        awal_piutang_online_kredit_total = proof.awal_piutang_online_kredit_total,
        akhir_piutang_online_debet_total = proof.akhir_piutang_online_debet_total,
        akhir_piutang_online_kredit_total = proof.akhir_piutang_online_kredit_total,
        awal_hutang_lokal_debet_total = proof.awal_hutang_lokal_debet_total,
        awal_hutang_lokal_kredit_total = proof.awal_hutang_lokal_kredit_total,
        akhir_hutang_lokal_debet_total = proof.akhir_hutang_lokal_debet_total,
        akhir_hutang_lokal_kredit_total = proof.akhir_hutang_lokal_kredit_total
      WHERE unit_id = g.unit_id AND as_of_date = g.as_of_date AND generation_id = g.generation_id;
    END LOOP;
    UPDATE app.saldo_pelanggan_snapshot_manifest m SET base_generation_id = x.new_generation_id
    FROM sps_v2_map x WHERE m.unit_id = scoped_unit AND x.unit_id = m.unit_id AND x.as_of_date = m.base_month_end AND x.old_generation_id = m.base_generation_id;
    UPDATE app.saldo_pelanggan_snapshot_pointer p SET generation_id = x.new_generation_id, rebuild_epoch = x.new_epoch, activated_at = clock_timestamp()
    FROM sps_v2_map x WHERE p.unit_id = scoped_unit AND x.unit_id = p.unit_id AND x.as_of_date = p.as_of_date AND x.old_generation_id = p.generation_id;
    UPDATE app.saldo_pelanggan_build_work w SET generation_id = x.new_generation_id, rebuild_epoch = x.new_epoch, updated_at = clock_timestamp()
    FROM sps_v2_map x WHERE w.unit_id = scoped_unit AND x.unit_id = w.unit_id AND x.as_of_date = w.as_of_date AND x.old_generation_id = w.generation_id;
    UPDATE app.saldo_pelanggan_dirty d SET covered_by_generation_id = x.new_generation_id, version = d.version + 1, updated_at = clock_timestamp()
    FROM sps_v2_map x WHERE d.unit_id = scoped_unit AND x.unit_id = d.unit_id AND x.as_of_date = d.covered_through_date AND x.old_generation_id = d.covered_by_generation_id;
  END LOOP;
  PERFORM set_config('app.unit_ids', COALESCE(previous_scope, ''), true);
END
$upgrade$;

-- Validate all reference moves before restoring the original immediate FKs.
SET CONSTRAINTS app.sps_manifest_base_generation_fkey, app.sps_row_generation_fkey, app.sps_pointer_generation_fkey, app.sps_work_generation_fkey, app.sps_dirty_coverage_generation_fkey IMMEDIATE;
ALTER TABLE app.saldo_pelanggan_snapshot_manifest ALTER CONSTRAINT sps_manifest_base_generation_fkey NOT DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_snapshot_row ALTER CONSTRAINT sps_row_generation_fkey NOT DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_snapshot_pointer ALTER CONSTRAINT sps_pointer_generation_fkey NOT DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_build_work ALTER CONSTRAINT sps_work_generation_fkey NOT DEFERRABLE;
ALTER TABLE app.saldo_pelanggan_dirty ALTER CONSTRAINT sps_dirty_coverage_generation_fkey NOT DEFERRABLE;

ALTER TABLE app.saldo_pelanggan_snapshot_row
  ALTER COLUMN awal_piutang_lokal_debet SET NOT NULL,
  ALTER COLUMN awal_piutang_lokal_kredit SET NOT NULL,
  ALTER COLUMN akhir_piutang_lokal_debet SET NOT NULL,
  ALTER COLUMN akhir_piutang_lokal_kredit SET NOT NULL,
  ALTER COLUMN awal_piutang_online_debet SET NOT NULL,
  ALTER COLUMN awal_piutang_online_kredit SET NOT NULL,
  ALTER COLUMN akhir_piutang_online_debet SET NOT NULL,
  ALTER COLUMN akhir_piutang_online_kredit SET NOT NULL,
  ALTER COLUMN awal_hutang_lokal_debet SET NOT NULL,
  ALTER COLUMN awal_hutang_lokal_kredit SET NOT NULL,
  ALTER COLUMN akhir_hutang_lokal_debet SET NOT NULL,
  ALTER COLUMN akhir_hutang_lokal_kredit SET NOT NULL;
ALTER TABLE app.saldo_pelanggan_snapshot_row
  ADD CONSTRAINT sps_row_awal_piutang_lokal_sides CHECK (awal_piutang_lokal = awal_piutang_lokal_debet - awal_piutang_lokal_kredit),
  ADD CONSTRAINT sps_row_akhir_piutang_lokal_sides CHECK (akhir_piutang_lokal = akhir_piutang_lokal_debet - akhir_piutang_lokal_kredit),
  ADD CONSTRAINT sps_row_awal_piutang_online_sides CHECK (awal_piutang_online = awal_piutang_online_debet - awal_piutang_online_kredit),
  ADD CONSTRAINT sps_row_akhir_piutang_online_sides CHECK (akhir_piutang_online = akhir_piutang_online_debet - akhir_piutang_online_kredit),
  ADD CONSTRAINT sps_row_awal_hutang_lokal_sides CHECK (awal_hutang_lokal = awal_hutang_lokal_debet - awal_hutang_lokal_kredit),
  ADD CONSTRAINT sps_row_akhir_hutang_lokal_sides CHECK (akhir_hutang_lokal = akhir_hutang_lokal_debet - akhir_hutang_lokal_kredit);

ALTER TABLE app.saldo_pelanggan_snapshot_manifest
  ADD CONSTRAINT sps_manifest_awal_piutang_lokal_sides CHECK (status <> 'complete' OR (awal_piutang_lokal_debet_total IS NOT NULL AND awal_piutang_lokal_kredit_total IS NOT NULL AND awal_piutang_lokal_total = awal_piutang_lokal_debet_total - awal_piutang_lokal_kredit_total)),
  ADD CONSTRAINT sps_manifest_akhir_piutang_lokal_sides CHECK (status <> 'complete' OR (akhir_piutang_lokal_debet_total IS NOT NULL AND akhir_piutang_lokal_kredit_total IS NOT NULL AND akhir_piutang_lokal_total = akhir_piutang_lokal_debet_total - akhir_piutang_lokal_kredit_total)),
  ADD CONSTRAINT sps_manifest_awal_piutang_online_sides CHECK (status <> 'complete' OR (awal_piutang_online_debet_total IS NOT NULL AND awal_piutang_online_kredit_total IS NOT NULL AND awal_piutang_online_total = awal_piutang_online_debet_total - awal_piutang_online_kredit_total)),
  ADD CONSTRAINT sps_manifest_akhir_piutang_online_sides CHECK (status <> 'complete' OR (akhir_piutang_online_debet_total IS NOT NULL AND akhir_piutang_online_kredit_total IS NOT NULL AND akhir_piutang_online_total = akhir_piutang_online_debet_total - akhir_piutang_online_kredit_total)),
  ADD CONSTRAINT sps_manifest_awal_hutang_lokal_sides CHECK (status <> 'complete' OR (awal_hutang_lokal_debet_total IS NOT NULL AND awal_hutang_lokal_kredit_total IS NOT NULL AND awal_hutang_lokal_total = awal_hutang_lokal_debet_total - awal_hutang_lokal_kredit_total)),
  ADD CONSTRAINT sps_manifest_akhir_hutang_lokal_sides CHECK (status <> 'complete' OR (akhir_hutang_lokal_debet_total IS NOT NULL AND akhir_hutang_lokal_kredit_total IS NOT NULL AND akhir_hutang_lokal_total = akhir_hutang_lokal_debet_total - akhir_hutang_lokal_kredit_total));

COMMIT;
