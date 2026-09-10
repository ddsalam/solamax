import { describe, expect, it } from "vitest";
import {
  CLAIM_DOMAIN_COMPLETE_SQL,
  COMPLETE_DOMAIN_SQL,
  DIFF_LEDGER_SQL,
  DIFF_PELANGGAN_SQL,
  DOMAIN_EVIDENCE_SQL,
  ENQUEUE_STALE_POINTERS_SQL,
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  LOCK_SOURCE_CAPTURE_SQL,
  LOCK_SOURCE_CYCLE_ALLOCATION_SQL,
  MARK_STALE_POINTERS_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  PROMOTE_SOURCE_CYCLE_SQL,
  STAGE_BPHUT_SQL,
  STAGE_BPPIUT_SQL,
  STAGE_PELANGGAN_SQL,
  SUPERSEDE_PENDING_WORK_SQL,
  UPSERT_DIRTY_WATERMARK_SQL,
} from "./source-capture-sql.js";

describe("source-cut capture SQL contract", () => {
  it("stages only the immutable fields consumed by the snapshot formula", () => {
    expect(STAGE_PELANGGAN_SQL).toContain("jsonb_to_recordset");
    expect(STAGE_PELANGGAN_SQL).toContain("row_keyed_checksum");
    expect(STAGE_BPPIUT_SQL).toContain("ckdbppiut text, dtgl date");
    expect(STAGE_BPHUT_SQL).toContain("ckdbphut text, dtgl date");
    expect(STAGE_BPPIUT_SQL).not.toContain("vcref");
    expect(STAGE_BPHUT_SQL).not.toContain("vcket");
  });

  it("keeps request capture bounded by deferring full-domain evidence to the worker", () => {
    expect(CLAIM_DOMAIN_COMPLETE_SQL.bppiut).toContain("decode(repeat('00', 32)");
    expect(CLAIM_DOMAIN_COMPLETE_SQL.bppiut).not.toContain("string_agg");
    expect(DOMAIN_EVIDENCE_SQL.bppiut).toContain("bit_xor");
    expect(DOMAIN_EVIDENCE_SQL.bppiut).not.toContain("string_agg");
    expect(DOMAIN_EVIDENCE_SQL.bppiut).toContain("int8send(count(*)::bigint)");
    expect(COMPLETE_DOMAIN_SQL.bppiut).toContain("bppiut_keyed_checksum = $4::bytea");
    expect(LOCK_SOURCE_CYCLE_ALLOCATION_SQL).toContain("source-sequence");
    expect(LOCK_SOURCE_CYCLE_ALLOCATION_SQL).not.toBe(LOCK_SOURCE_CAPTURE_SQL);
  });

  it.each([DIFF_LEDGER_SQL.bppiut, DIFF_LEDGER_SQL.bphut])(
    "ledger diff records insert/update/delete with the exact earliest date",
    (sql) => {
      expect(sql).toContain("WITH old_rows AS");
      expect(sql).toContain("source_cycle_id = $3::uuid");
      expect(sql).toContain("FULL OUTER JOIN");
      expect(sql).toContain("WHEN o.");
      expect(sql).toContain("THEN 'insert'");
      expect(sql).toContain("THEN 'delete'");
      expect(sql).toContain("ELSE LEAST(o.dtgl, n.dtgl)");
      expect(sql).toContain("WHEN n.");
      expect(sql).toContain("THEN o.dtgl");
    },
  );

  it("master diff invalidates classification/key changes from oldest stored snapshot", () => {
    expect(DIFF_PELANGGAN_SQL).toContain("min(as_of_date)");
    expect(DIFF_PELANGGAN_SQL).toContain("o.sjenis <> n.sjenis");
    expect(DIFF_PELANGGAN_SQL).toContain("(o.sjenis IS NULL) <> (n.sjenis IS NULL)");
    expect(DIFF_PELANGGAN_SQL).toContain("NOT c.classification_changed");
    expect(DIFF_PELANGGAN_SQL).toContain("THEN o.invalid_from_date ELSE NULL");
  });

  it("uses durable LEAST, keeps active pointers, and queues only after complete promotion", () => {
    expect(UPSERT_DIRTY_WATERMARK_SQL).toContain("dirty_invalid_from = LEAST");
    expect(UPSERT_DIRTY_WATERMARK_SQL).toContain(
      "dirty_source_cycle_sequence = EXCLUDED.dirty_source_cycle_sequence",
    );
    expect(MARK_STALE_POINTERS_SQL).toContain("pending_replacement = true");
    expect(MARK_STALE_POINTERS_SQL).toContain("NOT p.pending_replacement");
    expect(MARK_STALE_POINTERS_SQL).not.toContain("generation_id =");
    expect(PROMOTE_SOURCE_CYCLE_SQL).toContain("pelanggan_row_count IS NOT NULL");
    expect(PROMOTE_SOURCE_CYCLE_SQL).toContain("bppiut_row_count IS NOT NULL");
    expect(PROMOTE_SOURCE_CYCLE_SQL).toContain("bphut_row_count IS NOT NULL");
    expect(SUPERSEDE_PENDING_WORK_SQL).toContain("state = 'dead_letter'");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("source_cycle_status");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("'complete'");
    expect(SUPERSEDE_PENDING_WORK_SQL).not.toContain("RETURNING");
    expect(ENQUEUE_STALE_POINTERS_SQL).not.toContain("RETURNING");
    expect(FAIL_SUPERSEDED_STAGING_CYCLES_SQL).toContain("status = 'failed'");
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL).toHaveLength(3);
    expect(PRUNE_RETIRED_SOURCE_ROWS_SQL.join("\n")).toContain("w.state IN ('queued', 'leased', 'retry_wait')");
  });

  it("bootstraps the unit business date when the first complete cut has no pointer yet", () => {
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("FROM public.unit u");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("clock_timestamp() AT TIME ZONE u.timezone");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("NOT EXISTS");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("saldo_pelanggan_snapshot_pointer");
    expect(ENQUEUE_STALE_POINTERS_SQL).toContain("UNION ALL");
  });

  it("red control MAX is observably different from the accepted minimum", () => {
    const changedDates = ["2026-01-10", "2026-03-10"];
    const green = changedDates.reduce((a, b) => (a < b ? a : b));
    const redMax = changedDates.reduce((a, b) => (a > b ? a : b));
    expect(green).toBe("2026-01-10");
    expect(redMax).not.toBe(green);
    expect(UPSERT_DIRTY_WATERMARK_SQL).toContain("min(invalid_from_date)");
    expect(UPSERT_DIRTY_WATERMARK_SQL).toContain("dirty_invalid_from = LEAST");
    expect(UPSERT_DIRTY_WATERMARK_SQL).not.toContain("max(invalid_from_date)");
  });
});
