import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_FORMULA_VERSION,
  SNAPSHOT_OPERATIONAL_LIMITS,
} from "./snapshot-config.js";
import {
  ASSERT_VALID_SOURCE_KEYS_SQL,
  COMPLETE_MANIFEST_SQL,
  COMPLETE_WORK_SQL,
  INSERT_BUILDING_MANIFEST_SQL,
  LOCK_PUBLICATION_SQL,
  MATERIALIZE_DELTA_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  READ_READY_SNAPSHOT_SQL,
  SET_UNIT_SCOPE_SQL,
  SOURCE_CYCLE_EVIDENCE_SQL,
  UPSERT_POINTER_SQL,
  VALIDATE_GENERATION_SQL,
} from "./snapshot-sql.js";

describe("saldo pelanggan snapshot operational contract", () => {
  it("keeps the accepted B1 limits fixed in code", () => {
    expect(SNAPSHOT_FORMULA_VERSION).toBe("saldo-pelanggan-v1");
    expect(SNAPSHOT_OPERATIONAL_LIMITS).toEqual({
      timezone: "Asia/Pontianak",
      buildWindowStartMinutes: 120,
      buildWindowEndMinutes: 300,
      latestLeaseMinutes: 285,
      globalConcurrency: 1,
      databaseReviewBytes: 9_000_000_000,
      leaseSeconds: 120,
      heartbeatSeconds: 30,
      attemptSeconds: 900,
      statementSeconds: 600,
      publishSeconds: 30,
      poolAcquireMilliseconds: 1_000,
      maxAttempts: 5,
    });
    expect(Object.isFrozen(SNAPSHOT_OPERATIONAL_LIMITS)).toBe(true);
  });
});

describe("saldo pelanggan snapshot SQL contract", () => {
  it("sets one exact transaction-local RLS unit", () => {
    expect(SET_UNIT_SCOPE_SQL).toContain("set_config('app.unit_ids', $1, true)");
  });

  it("accepts only a complete immutable source cut with full evidence", () => {
    expect(SOURCE_CYCLE_EVIDENCE_SQL).toContain('FROM app.saldo_pelanggan_source_cycle');
    expect(SOURCE_CYCLE_EVIDENCE_SQL).toContain("status = 'complete'");
    expect(SOURCE_CYCLE_EVIDENCE_SQL).toMatch(/pelanggan_row_count IS NOT NULL/);
    expect(SOURCE_CYCLE_EVIDENCE_SQL).toMatch(/bppiut_keyed_checksum IS NOT NULL/);
    expect(SOURCE_CYCLE_EVIDENCE_SQL).toMatch(/bphut_keyed_checksum IS NOT NULL/);
    expect(ASSERT_VALID_SOURCE_KEYS_SQL).toContain("COALESCE(sbatal, 0) = 0");
    expect(ASSERT_VALID_SOURCE_KEYS_SQL).toContain("NULLIF(btrim(ckdplg), '') IS NULL");
  });

  it("materializes exact NUMERIC full-history buckets from the source cut", () => {
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain('app.saldo_pelanggan_source_pelanggan');
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain('app.saldo_pelanggan_source_bppiut');
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain('app.saldo_pelanggan_source_bphut');
    expect(MATERIALIZE_FULL_HISTORY_SQL).not.toContain("public.bppiut");
    expect(MATERIALIZE_FULL_HISTORY_SQL).not.toContain("::float8");
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain("sjenis IN (1, 5)");
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain("position('.' in");
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain("dtgl < $2::date");
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain("dtgl <= $2::date");
    expect(MATERIALIZE_FULL_HISTORY_SQL).toContain("COALESCE(sbatal, 0) = 0");
  });

  it("materializes target dates as previous-month ending plus current-month deltas", () => {
    expect(MATERIALIZE_DELTA_SQL).toContain('app.saldo_pelanggan_snapshot_row');
    expect(MATERIALIZE_DELTA_SQL).toContain('app.saldo_pelanggan_source_pelanggan');
    expect(MATERIALIZE_DELTA_SQL).toContain("date_trunc('month', $2::date)::date");
    expect(MATERIALIZE_DELTA_SQL).toContain("dtgl < $2::date");
    expect(MATERIALIZE_DELTA_SQL).toContain("dtgl <= $2::date");
    expect(MATERIALIZE_DELTA_SQL).not.toContain("::float8");
  });

  it("validates row count, six totals, and a deterministic SHA-256 row checksum", () => {
    expect(VALIDATE_GENERATION_SQL).toContain("count(*)");
    expect(VALIDATE_GENERATION_SQL).toContain("sha256(convert_to(");
    expect(VALIDATE_GENERATION_SQL).toContain("string_agg(");
    expect(VALIDATE_GENERATION_SQL).toContain("ORDER BY customer_code");
    for (const name of [
      "awal_piutang_lokal",
      "akhir_piutang_lokal",
      "awal_piutang_online",
      "akhir_piutang_online",
      "awal_hutang_lokal",
      "akhir_hutang_lokal",
    ]) expect(VALIDATE_GENERATION_SQL).toContain(`sum(${name})`);
  });

  it("keeps publication transaction pieces ordered around a lexicographic CAS", () => {
    expect(INSERT_BUILDING_MANIFEST_SQL).toContain("status");
    expect(INSERT_BUILDING_MANIFEST_SQL).toContain("'building'");
    expect(LOCK_PUBLICATION_SQL).toContain("FOR UPDATE");
    expect(COMPLETE_MANIFEST_SQL).toContain("validation_passed = true");
    expect(COMPLETE_MANIFEST_SQL).toContain("published = true");
    expect(UPSERT_POINTER_SQL).toContain("ON CONFLICT (unit_id, as_of_date)");
    expect(UPSERT_POINTER_SQL).toContain("source_cycle_sequence");
    expect(UPSERT_POINTER_SQL).toContain("rebuild_epoch");
    expect(COMPLETE_WORK_SQL).toContain("state = 'done'");
  });

  it("reads only pointer-selected complete generations in one statement", () => {
    expect(READ_READY_SNAPSHOT_SQL).toContain("saldo_pelanggan_snapshot_pointer");
    expect(READ_READY_SNAPSHOT_SQL).toContain("saldo_pelanggan_snapshot_manifest");
    expect(READ_READY_SNAPSHOT_SQL).toContain("saldo_pelanggan_snapshot_row");
    expect(READ_READY_SNAPSHOT_SQL).toContain("m.status = 'complete'");
    expect(READ_READY_SNAPSHOT_SQL.trim().split(";").filter(Boolean)).toHaveLength(1);
  });
});
