-- 0038 — close the NULL hole in complete saldo-pelanggan manifests.
--
-- Migration 0037 requires row_count = customer_key_count for a complete
-- manifest, but PostgreSQL CHECK constraints accept UNKNOWN. When row_count is
-- NULL that comparison is UNKNOWN, so the original lifecycle constraint does
-- not reject the row. Keep 0037 byte-for-byte frozen and add the missing
-- invariant here.

ALTER TABLE "app"."saldo_pelanggan_snapshot_manifest"
    ADD CONSTRAINT "sps_manifest_complete_row_count_required"
    CHECK ("status" <> 'complete' OR "row_count" IS NOT NULL);
