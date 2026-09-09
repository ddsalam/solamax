-- 0037 — immutable source cuts and saldo-pelanggan snapshots (BUILD B1).
--
-- This migration is additive. It deliberately does not alter the live EasyMax
-- mirrors: later ingest/build phases write complete, numbered source cuts here,
-- validate them, and atomically move a separate active snapshot pointer.
--
-- IMPORTANT: run as the table-owner role (`ingest` in deployed databases).
-- Every table below is unit-scoped and gets the exact fail-closed RLS predicate
-- from 0016, including FORCE ROW LEVEL SECURITY.

-- One manifest row owns each staged full-sync cut. A complete cut proves that
-- pelanggan_master, bppiut, and bphut came from the same numbered source cycle.
CREATE TABLE "app"."saldo_pelanggan_source_cycle" (
    "unit_id" SMALLINT NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "source_cycle_sequence" BIGINT NOT NULL,
    "previous_source_cycle_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'staging',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_completed_at" TIMESTAMPTZ,
    "promoted_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "pelanggan_row_count" BIGINT,
    "pelanggan_keyed_checksum" BYTEA,
    "bppiut_row_count" BIGINT,
    "bppiut_keyed_checksum" BYTEA,
    "bphut_row_count" BIGINT,
    "bphut_keyed_checksum" BYTEA,
    "failure_summary" TEXT,

    CONSTRAINT "sps_cycle_pkey"
        PRIMARY KEY ("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_cycle_unit_fkey"
        FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("unit_id"),
    CONSTRAINT "sps_cycle_previous_fkey"
        FOREIGN KEY ("unit_id", "previous_source_cycle_id")
        REFERENCES "app"."saldo_pelanggan_source_cycle"("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_cycle_sequence_positive"
        CHECK ("source_cycle_sequence" > 0),
    CONSTRAINT "sps_cycle_status_valid"
        CHECK ("status" IN ('staging', 'complete', 'failed')),
    CONSTRAINT "sps_cycle_previous_distinct"
        CHECK ("previous_source_cycle_id" IS NULL OR "previous_source_cycle_id" <> "source_cycle_id"),
    CONSTRAINT "sps_cycle_counts_valid"
        CHECK (
            ("pelanggan_row_count" IS NULL OR "pelanggan_row_count" >= 0) AND
            ("bppiut_row_count" IS NULL OR "bppiut_row_count" >= 0) AND
            ("bphut_row_count" IS NULL OR "bphut_row_count" >= 0)
        ),
    CONSTRAINT "sps_cycle_checksums_valid"
        CHECK (
            ("pelanggan_keyed_checksum" IS NULL OR octet_length("pelanggan_keyed_checksum") = 32) AND
            ("bppiut_keyed_checksum" IS NULL OR octet_length("bppiut_keyed_checksum") = 32) AND
            ("bphut_keyed_checksum" IS NULL OR octet_length("bphut_keyed_checksum") = 32)
        ),
    CONSTRAINT "sps_cycle_lifecycle_valid"
        CHECK (
            (
                "status" = 'staging' AND
                "source_completed_at" IS NULL AND
                "promoted_at" IS NULL AND
                "failed_at" IS NULL AND
                "failure_summary" IS NULL
            ) OR (
                "status" = 'complete' AND
                "source_completed_at" IS NOT NULL AND
                "promoted_at" IS NOT NULL AND
                "failed_at" IS NULL AND
                "pelanggan_row_count" IS NOT NULL AND
                "pelanggan_keyed_checksum" IS NOT NULL AND
                "bppiut_row_count" IS NOT NULL AND
                "bppiut_keyed_checksum" IS NOT NULL AND
                "bphut_row_count" IS NOT NULL AND
                "bphut_keyed_checksum" IS NOT NULL AND
                "failure_summary" IS NULL
            ) OR (
                "status" = 'failed' AND
                "promoted_at" IS NULL AND
                "failed_at" IS NOT NULL AND
                NULLIF(btrim("failure_summary"), '') IS NOT NULL
            )
        ),
    CONSTRAINT "sps_cycle_unit_id_sequence_key"
        UNIQUE ("unit_id", "source_cycle_id", "source_cycle_sequence"),
    CONSTRAINT "sps_cycle_complete_target_key"
        UNIQUE ("unit_id", "source_cycle_id", "source_cycle_sequence", "status"),
    CONSTRAINT "sps_cycle_unit_sequence_key"
        UNIQUE ("unit_id", "source_cycle_sequence")
);

-- Full-key staged copy of pelanggan_master. A blank source key is retained in
-- the cut so the builder can fail the generation visibly; it is never silently
-- coalesced into an invented customer or admitted to snapshot rows.
CREATE TABLE "app"."saldo_pelanggan_source_pelanggan" (
    "unit_id" SMALLINT NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "ckdplg" CHAR(12) NOT NULL,
    "vcnmplg" TEXT,
    "sjenis" SMALLINT,
    "saktif" SMALLINT,
    "row_keyed_checksum" BYTEA NOT NULL,

    CONSTRAINT "sps_pelanggan_pkey"
        PRIMARY KEY ("unit_id", "source_cycle_id", "ckdplg"),
    CONSTRAINT "sps_pelanggan_cycle_fkey"
        FOREIGN KEY ("unit_id", "source_cycle_id")
        REFERENCES "app"."saldo_pelanggan_source_cycle"("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_pelanggan_checksum_valid"
        CHECK (octet_length("row_keyed_checksum") = 32)
);

-- Full-key staged copies of both ledgers. Nullable customer codes are retained
-- so a source invariant violation remains observable and can fail the build.
CREATE TABLE "app"."saldo_pelanggan_source_bppiut" (
    "unit_id" SMALLINT NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "ckdbppiut" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "njumlah" NUMERIC,
    "sjnsbp" SMALLINT,
    "sbatal" SMALLINT,
    "row_keyed_checksum" BYTEA NOT NULL,

    CONSTRAINT "sps_bppiut_pkey"
        PRIMARY KEY ("unit_id", "source_cycle_id", "ckdbppiut"),
    CONSTRAINT "sps_bppiut_cycle_fkey"
        FOREIGN KEY ("unit_id", "source_cycle_id")
        REFERENCES "app"."saldo_pelanggan_source_cycle"("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_bppiut_key_nonempty"
        CHECK (NULLIF(btrim("ckdbppiut"), '') IS NOT NULL),
    CONSTRAINT "sps_bppiut_checksum_valid"
        CHECK (octet_length("row_keyed_checksum") = 32)
);

CREATE TABLE "app"."saldo_pelanggan_source_bphut" (
    "unit_id" SMALLINT NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "ckdbphut" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "njumlah" NUMERIC,
    "sjnsbp" SMALLINT,
    "sbatal" SMALLINT,
    "row_keyed_checksum" BYTEA NOT NULL,

    CONSTRAINT "sps_bphut_pkey"
        PRIMARY KEY ("unit_id", "source_cycle_id", "ckdbphut"),
    CONSTRAINT "sps_bphut_cycle_fkey"
        FOREIGN KEY ("unit_id", "source_cycle_id")
        REFERENCES "app"."saldo_pelanggan_source_cycle"("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_bphut_key_nonempty"
        CHECK (NULLIF(btrim("ckdbphut"), '') IS NOT NULL),
    CONSTRAINT "sps_bphut_checksum_valid"
        CHECK (octet_length("row_keyed_checksum") = 32)
);

-- Old/new evidence from a complete full-key diff. Non-label changes carry the
-- earliest affected snapshot date; ledger omissions retain their old date.
CREATE TABLE "app"."saldo_pelanggan_source_change" (
    "unit_id" SMALLINT NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "change_kind" TEXT NOT NULL,
    "old_business_date" DATE,
    "new_business_date" DATE,
    "old_customer_code" VARCHAR(12),
    "new_customer_code" VARCHAR(12),
    "old_row_keyed_checksum" BYTEA,
    "new_row_keyed_checksum" BYTEA,
    "classification_changed" BOOLEAN NOT NULL DEFAULT false,
    "label_only" BOOLEAN NOT NULL DEFAULT false,
    "invalid_from_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sps_change_pkey"
        PRIMARY KEY ("unit_id", "source_cycle_id", "domain", "source_key", "change_kind"),
    CONSTRAINT "sps_change_cycle_fkey"
        FOREIGN KEY ("unit_id", "source_cycle_id")
        REFERENCES "app"."saldo_pelanggan_source_cycle"("unit_id", "source_cycle_id"),
    CONSTRAINT "sps_change_domain_valid"
        CHECK ("domain" IN ('pelanggan_master', 'bppiut', 'bphut')),
    CONSTRAINT "sps_change_kind_valid"
        CHECK ("change_kind" IN ('insert', 'update', 'delete')),
    CONSTRAINT "sps_change_key_nonempty"
        CHECK (
            "domain" = 'pelanggan_master' OR
            NULLIF(btrim("source_key"), '') IS NOT NULL
        ),
    CONSTRAINT "sps_change_checksums_valid"
        CHECK (
            ("old_row_keyed_checksum" IS NULL OR octet_length("old_row_keyed_checksum") = 32) AND
            ("new_row_keyed_checksum" IS NULL OR octet_length("new_row_keyed_checksum") = 32)
        ),
    CONSTRAINT "sps_change_old_new_valid"
        CHECK (
            ("change_kind" = 'insert' AND "old_row_keyed_checksum" IS NULL AND "new_row_keyed_checksum" IS NOT NULL) OR
            ("change_kind" = 'update' AND "old_row_keyed_checksum" IS NOT NULL AND "new_row_keyed_checksum" IS NOT NULL) OR
            ("change_kind" = 'delete' AND "old_row_keyed_checksum" IS NOT NULL AND "new_row_keyed_checksum" IS NULL)
        ),
    CONSTRAINT "sps_change_invalidation_valid"
        CHECK (
            (
                "label_only" AND
                "domain" = 'pelanggan_master' AND
                "change_kind" = 'update' AND
                NOT "classification_changed" AND
                "invalid_from_date" IS NULL
            ) OR (
                NOT "label_only" AND
                "invalid_from_date" IS NOT NULL
            )
        ),
    CONSTRAINT "sps_change_ledger_date_valid"
        CHECK (
            (
                "domain" = 'pelanggan_master' AND
                "old_business_date" IS NULL AND
                "new_business_date" IS NULL
            ) OR (
                "domain" IN ('bppiut', 'bphut') AND
                (
                    (
                        "change_kind" = 'insert' AND
                        "old_business_date" IS NULL AND
                        "new_business_date" IS NOT NULL AND
                        "invalid_from_date" = "new_business_date"
                    ) OR (
                        "change_kind" = 'update' AND
                        "old_business_date" IS NOT NULL AND
                        "new_business_date" IS NOT NULL AND
                        "invalid_from_date" = LEAST("old_business_date", "new_business_date")
                    ) OR (
                        "change_kind" = 'delete' AND
                        "old_business_date" IS NOT NULL AND
                        "new_business_date" IS NULL AND
                        "invalid_from_date" = "old_business_date"
                    )
                )
            )
        ),
    CONSTRAINT "sps_change_classification_valid"
        CHECK (
            NOT "classification_changed" OR
            ("domain" = 'pelanggan_master' AND NOT "label_only")
        )
);

-- Each immutable generation belongs to one complete source cut. NUMERIC totals
-- and a keyed row checksum make swaps between customers detectable even when
-- the six fleet totals happen to remain equal.
CREATE TABLE "app"."saldo_pelanggan_snapshot_manifest" (
    "unit_id" SMALLINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "generation_id" UUID NOT NULL,
    "formula_version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "base_month_end" DATE,
    "base_generation_id" UUID,
    "source_cycle_id" UUID NOT NULL,
    "source_cycle_sequence" BIGINT NOT NULL,
    "source_cycle_status" TEXT NOT NULL DEFAULT 'complete',
    "source_completed_at" TIMESTAMPTZ NOT NULL,
    "rebuild_epoch" BIGINT NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ,
    "validation_passed" BOOLEAN NOT NULL DEFAULT false,
    "customer_key_count" BIGINT,
    "row_count" BIGINT,
    "row_keyed_checksum" BYTEA,
    "awal_piutang_lokal_total" NUMERIC,
    "akhir_piutang_lokal_total" NUMERIC,
    "awal_piutang_online_total" NUMERIC,
    "akhir_piutang_online_total" NUMERIC,
    "awal_hutang_lokal_total" NUMERIC,
    "akhir_hutang_lokal_total" NUMERIC,
    "source_pelanggan_row_count" BIGINT,
    "source_pelanggan_keyed_checksum" BYTEA,
    "source_bppiut_row_count" BIGINT,
    "source_bppiut_keyed_checksum" BYTEA,
    "source_bphut_row_count" BIGINT,
    "source_bphut_keyed_checksum" BYTEA,
    "failure_code" TEXT,
    "failure_summary" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sps_manifest_pkey"
        PRIMARY KEY ("unit_id", "as_of_date", "generation_id"),
    CONSTRAINT "sps_manifest_source_cycle_fkey"
        FOREIGN KEY (
            "unit_id", "source_cycle_id", "source_cycle_sequence", "source_cycle_status"
        )
        REFERENCES "app"."saldo_pelanggan_source_cycle"
            ("unit_id", "source_cycle_id", "source_cycle_sequence", "status"),
    CONSTRAINT "sps_manifest_base_generation_fkey"
        FOREIGN KEY ("unit_id", "base_month_end", "base_generation_id")
        REFERENCES "app"."saldo_pelanggan_snapshot_manifest"
            ("unit_id", "as_of_date", "generation_id"),
    CONSTRAINT "sps_manifest_status_valid"
        CHECK ("status" IN ('building', 'complete', 'failed')),
    CONSTRAINT "sps_manifest_formula_nonempty"
        CHECK (NULLIF(btrim("formula_version"), '') IS NOT NULL),
    CONSTRAINT "sps_manifest_rebuild_epoch_valid"
        CHECK ("rebuild_epoch" >= 0),
    CONSTRAINT "sps_manifest_source_complete"
        CHECK ("source_cycle_status" = 'complete'),
    CONSTRAINT "sps_manifest_base_valid"
        CHECK (
            ("base_month_end" IS NULL AND "base_generation_id" IS NULL) OR
            ("base_month_end" IS NOT NULL AND "base_generation_id" IS NOT NULL AND "base_month_end" < "as_of_date")
        ),
    CONSTRAINT "sps_manifest_counts_valid"
        CHECK (
            ("customer_key_count" IS NULL OR "customer_key_count" >= 0) AND
            ("row_count" IS NULL OR "row_count" >= 0) AND
            ("source_pelanggan_row_count" IS NULL OR "source_pelanggan_row_count" >= 0) AND
            ("source_bppiut_row_count" IS NULL OR "source_bppiut_row_count" >= 0) AND
            ("source_bphut_row_count" IS NULL OR "source_bphut_row_count" >= 0)
        ),
    CONSTRAINT "sps_manifest_checksums_valid"
        CHECK (
            ("row_keyed_checksum" IS NULL OR octet_length("row_keyed_checksum") = 32) AND
            ("source_pelanggan_keyed_checksum" IS NULL OR octet_length("source_pelanggan_keyed_checksum") = 32) AND
            ("source_bppiut_keyed_checksum" IS NULL OR octet_length("source_bppiut_keyed_checksum") = 32) AND
            ("source_bphut_keyed_checksum" IS NULL OR octet_length("source_bphut_keyed_checksum") = 32)
        ),
    CONSTRAINT "sps_manifest_lifecycle_valid"
        CHECK (
            (
                "status" = 'building' AND
                NOT "published" AND
                NOT "validation_passed" AND
                "computed_at" IS NULL AND
                "completed_at" IS NULL AND
                "published_at" IS NULL AND
                "failure_code" IS NULL AND
                "failure_summary" IS NULL
            ) OR (
                "status" = 'complete' AND
                "published" AND
                "validation_passed" AND
                "computed_at" IS NOT NULL AND
                "completed_at" IS NOT NULL AND
                "published_at" IS NOT NULL AND
                "customer_key_count" IS NOT NULL AND
                "row_count" = "customer_key_count" AND
                "row_keyed_checksum" IS NOT NULL AND
                "awal_piutang_lokal_total" IS NOT NULL AND
                "akhir_piutang_lokal_total" IS NOT NULL AND
                "awal_piutang_online_total" IS NOT NULL AND
                "akhir_piutang_online_total" IS NOT NULL AND
                "awal_hutang_lokal_total" IS NOT NULL AND
                "akhir_hutang_lokal_total" IS NOT NULL AND
                "source_pelanggan_row_count" IS NOT NULL AND
                "source_pelanggan_keyed_checksum" IS NOT NULL AND
                "source_bppiut_row_count" IS NOT NULL AND
                "source_bppiut_keyed_checksum" IS NOT NULL AND
                "source_bphut_row_count" IS NOT NULL AND
                "source_bphut_keyed_checksum" IS NOT NULL AND
                "failure_code" IS NULL AND
                "failure_summary" IS NULL AND
                NOT "retryable"
            ) OR (
                "status" = 'failed' AND
                NOT "published" AND
                NOT "validation_passed" AND
                "completed_at" IS NOT NULL AND
                "published_at" IS NULL AND
                NULLIF(btrim("failure_code"), '') IS NOT NULL AND
                NULLIF(btrim("failure_summary"), '') IS NOT NULL
            )
        ),
    CONSTRAINT "sps_manifest_pointer_target_key"
        UNIQUE (
            "unit_id", "as_of_date", "generation_id", "status", "published",
            "validation_passed", "source_cycle_sequence", "rebuild_epoch"
        ),
    CONSTRAINT "sps_manifest_coverage_target_key"
        UNIQUE ("unit_id", "as_of_date", "generation_id", "source_cycle_sequence")
);

-- There can be only one in-progress writer and only one successful publication
-- for a source-cycle/rebuild tuple. A superseded retry must finish as failed.
CREATE UNIQUE INDEX "sps_manifest_one_building"
    ON "app"."saldo_pelanggan_snapshot_manifest"("unit_id", "as_of_date")
    WHERE "status" = 'building';

CREATE UNIQUE INDEX "sps_manifest_one_published_epoch"
    ON "app"."saldo_pelanggan_snapshot_manifest"
        ("unit_id", "as_of_date", "source_cycle_sequence", "rebuild_epoch")
    WHERE "status" = 'complete' AND "published" AND "validation_passed";

-- The only read-ready selector. Constant CHECK columns plus the composite FK
-- make it impossible to point at building, failed, unpublished, or unvalidated
-- generations. The PK gives exactly one active generation per unit/date.
CREATE TABLE "app"."saldo_pelanggan_snapshot_pointer" (
    "unit_id" SMALLINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "generation_id" UUID NOT NULL,
    "generation_status" TEXT NOT NULL DEFAULT 'complete',
    "generation_published" BOOLEAN NOT NULL DEFAULT true,
    "generation_validation_passed" BOOLEAN NOT NULL DEFAULT true,
    "source_cycle_sequence" BIGINT NOT NULL,
    "rebuild_epoch" BIGINT NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_invalid_from" DATE,
    "pending_replacement" BOOLEAN NOT NULL DEFAULT false,
    "pending_since" TIMESTAMPTZ,

    CONSTRAINT "sps_pointer_pkey"
        PRIMARY KEY ("unit_id", "as_of_date"),
    CONSTRAINT "sps_pointer_complete_only"
        CHECK (
            "generation_status" = 'complete' AND
            "generation_published" AND
            "generation_validation_passed"
        ),
    CONSTRAINT "sps_pointer_rebuild_epoch_valid"
        CHECK ("rebuild_epoch" >= 0),
    CONSTRAINT "sps_pointer_stale_valid"
        CHECK (
            (
                NOT "pending_replacement" AND
                "stale_invalid_from" IS NULL AND
                "pending_since" IS NULL
            ) OR (
                "pending_replacement" AND
                "stale_invalid_from" IS NOT NULL AND
                "stale_invalid_from" <= "as_of_date" AND
                "pending_since" IS NOT NULL
            )
        ),
    CONSTRAINT "sps_pointer_generation_fkey"
        FOREIGN KEY (
            "unit_id", "as_of_date", "generation_id", "generation_status",
            "generation_published", "generation_validation_passed",
            "source_cycle_sequence", "rebuild_epoch"
        ) REFERENCES "app"."saldo_pelanggan_snapshot_manifest" (
            "unit_id", "as_of_date", "generation_id", "status", "published",
            "validation_passed", "source_cycle_sequence", "rebuild_epoch"
        )
);

-- Six separate NUMERIC buckets at the accepted unit/date/trimmed-customer grain.
-- A complete generation includes zero-balance customers; readiness comes only
-- from the manifest and pointer above, never from row presence or all-zero data.
CREATE TABLE "app"."saldo_pelanggan_snapshot_row" (
    "unit_id" SMALLINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "generation_id" UUID NOT NULL,
    "customer_code" VARCHAR(12) NOT NULL,
    "awal_piutang_lokal" NUMERIC NOT NULL,
    "akhir_piutang_lokal" NUMERIC NOT NULL,
    "awal_piutang_online" NUMERIC NOT NULL,
    "akhir_piutang_online" NUMERIC NOT NULL,
    "awal_hutang_lokal" NUMERIC NOT NULL,
    "akhir_hutang_lokal" NUMERIC NOT NULL,

    CONSTRAINT "sps_row_pkey"
        PRIMARY KEY ("unit_id", "as_of_date", "generation_id", "customer_code"),
    CONSTRAINT "sps_row_generation_fkey"
        FOREIGN KEY ("unit_id", "as_of_date", "generation_id")
        REFERENCES "app"."saldo_pelanggan_snapshot_manifest"
            ("unit_id", "as_of_date", "generation_id"),
    CONSTRAINT "sps_row_customer_normalized"
        CHECK (
            NULLIF("customer_code", '') IS NOT NULL AND
            "customer_code" = btrim("customer_code")
        )
);

-- Durable LEAST watermark. Clearing it preserves which complete generation and
-- source sequence covered the invalidated range; a failed/abandoned cycle
-- cannot erase the dirty date by merely disappearing from a retry payload.
CREATE TABLE "app"."saldo_pelanggan_dirty" (
    "unit_id" SMALLINT NOT NULL,
    "dirty_invalid_from" DATE,
    "dirty_source_cycle_id" UUID,
    "dirty_source_cycle_sequence" BIGINT,
    "dirty_since" TIMESTAMPTZ,
    "covered_through_date" DATE,
    "covered_by_generation_id" UUID,
    "covered_source_cycle_sequence" BIGINT,
    "version" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sps_dirty_pkey" PRIMARY KEY ("unit_id"),
    CONSTRAINT "sps_dirty_unit_fkey"
        FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("unit_id"),
    CONSTRAINT "sps_dirty_source_cycle_fkey"
        FOREIGN KEY ("unit_id", "dirty_source_cycle_id", "dirty_source_cycle_sequence")
        REFERENCES "app"."saldo_pelanggan_source_cycle"
            ("unit_id", "source_cycle_id", "source_cycle_sequence"),
    CONSTRAINT "sps_dirty_coverage_generation_fkey"
        FOREIGN KEY (
            "unit_id", "covered_through_date", "covered_by_generation_id",
            "covered_source_cycle_sequence"
        ) REFERENCES "app"."saldo_pelanggan_snapshot_manifest" (
            "unit_id", "as_of_date", "generation_id", "source_cycle_sequence"
        ),
    CONSTRAINT "sps_dirty_version_valid" CHECK ("version" >= 0),
    CONSTRAINT "sps_dirty_state_valid"
        CHECK (
            (
                "dirty_invalid_from" IS NULL AND
                "dirty_source_cycle_id" IS NULL AND
                "dirty_source_cycle_sequence" IS NULL AND
                "dirty_since" IS NULL
            ) OR (
                "dirty_invalid_from" IS NOT NULL AND
                "dirty_source_cycle_id" IS NOT NULL AND
                "dirty_source_cycle_sequence" IS NOT NULL AND
                "dirty_since" IS NOT NULL
            )
        ),
    CONSTRAINT "sps_dirty_coverage_valid"
        CHECK (
            (
                "covered_through_date" IS NULL AND
                "covered_by_generation_id" IS NULL AND
                "covered_source_cycle_sequence" IS NULL
            ) OR (
                "covered_through_date" IS NOT NULL AND
                "covered_by_generation_id" IS NOT NULL AND
                "covered_source_cycle_sequence" IS NOT NULL
            )
        )
);

-- Durable queue, separate from generation status. Idempotency is the accepted
-- (unit,date,cycle,epoch) tuple; expired leases can retry without duplicating a
-- publication. Global one-lease uniqueness enforces the initial concurrency-1
-- production budget at the database boundary.
CREATE TABLE "app"."saldo_pelanggan_build_work" (
    "unit_id" SMALLINT NOT NULL,
    "work_id" UUID NOT NULL,
    "as_of_date" DATE NOT NULL,
    "source_cycle_id" UUID NOT NULL,
    "source_cycle_sequence" BIGINT NOT NULL,
    "source_cycle_status" TEXT NOT NULL DEFAULT 'complete',
    "rebuild_epoch" BIGINT NOT NULL DEFAULT 0,
    "generation_id" UUID,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ,
    "heartbeat_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "sps_work_pkey" PRIMARY KEY ("unit_id", "work_id"),
    CONSTRAINT "sps_work_source_cycle_fkey"
        FOREIGN KEY (
            "unit_id", "source_cycle_id", "source_cycle_sequence", "source_cycle_status"
        )
        REFERENCES "app"."saldo_pelanggan_source_cycle"
            ("unit_id", "source_cycle_id", "source_cycle_sequence", "status"),
    CONSTRAINT "sps_work_generation_fkey"
        FOREIGN KEY ("unit_id", "as_of_date", "generation_id")
        REFERENCES "app"."saldo_pelanggan_snapshot_manifest"
            ("unit_id", "as_of_date", "generation_id"),
    CONSTRAINT "sps_work_idempotency_key"
        UNIQUE ("unit_id", "as_of_date", "source_cycle_id", "rebuild_epoch"),
    CONSTRAINT "sps_work_state_valid"
        CHECK ("state" IN ('queued', 'leased', 'retry_wait', 'dead_letter', 'done')),
    CONSTRAINT "sps_work_attempt_valid"
        CHECK ("attempt_count" BETWEEN 0 AND 5),
    CONSTRAINT "sps_work_rebuild_epoch_valid"
        CHECK ("rebuild_epoch" >= 0),
    CONSTRAINT "sps_work_source_complete"
        CHECK ("source_cycle_status" = 'complete'),
    CONSTRAINT "sps_work_generation_valid"
        CHECK ("generation_id" IS NULL OR "attempt_count" > 0),
    CONSTRAINT "sps_work_lease_valid"
        CHECK (
            (
                "state" = 'leased' AND
                NULLIF(btrim("lease_owner"), '') IS NOT NULL AND
                "lease_expires_at" IS NOT NULL AND
                "heartbeat_at" IS NOT NULL AND
                "completed_at" IS NULL
            ) OR (
                "state" IN ('queued', 'retry_wait') AND
                "lease_owner" IS NULL AND
                "lease_expires_at" IS NULL AND
                "heartbeat_at" IS NULL AND
                "completed_at" IS NULL
            ) OR (
                "state" IN ('dead_letter', 'done') AND
                "lease_owner" IS NULL AND
                "lease_expires_at" IS NULL AND
                "heartbeat_at" IS NULL AND
                "completed_at" IS NOT NULL
            )
        )
);

-- Coalesce one not-yet-leased successor per unit/date while allowing an older
-- leased cycle to finish and lose the manifest CAS. Only one work may hold the
-- global lease, matching the accepted initial concurrency budget.
CREATE UNIQUE INDEX "sps_work_one_pending_per_date"
    ON "app"."saldo_pelanggan_build_work"("unit_id", "as_of_date")
    WHERE "state" IN ('queued', 'retry_wait');

CREATE UNIQUE INDEX "sps_work_one_global_lease"
    ON "app"."saldo_pelanggan_build_work"("state")
    WHERE "state" = 'leased';

CREATE INDEX "sps_work_ready_idx"
    ON "app"."saldo_pelanggan_build_work"("state", "available_at", "created_at");

CREATE INDEX "sps_change_invalid_from_idx"
    ON "app"."saldo_pelanggan_source_change"("unit_id", "invalid_from_date")
    WHERE "invalid_from_date" IS NOT NULL;

CREATE INDEX "sps_bppiut_cycle_date_customer_idx"
    ON "app"."saldo_pelanggan_source_bppiut"
        ("unit_id", "source_cycle_id", "dtgl", "ckdplg");

CREATE INDEX "sps_bphut_cycle_date_customer_idx"
    ON "app"."saldo_pelanggan_source_bphut"
        ("unit_id", "source_cycle_id", "dtgl", "ckdplg");

CREATE INDEX "sps_pointer_stale_idx"
    ON "app"."saldo_pelanggan_snapshot_pointer"("unit_id", "stale_invalid_from")
    WHERE "pending_replacement";

-- 0016 only covered tables that existed when it ran. Apply its predicate
-- verbatim and explicitly to every table introduced by this migration.
DO $$
DECLARE
  r record;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
    ))$p$;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'saldo_pelanggan_source_cycle',
      'saldo_pelanggan_source_pelanggan',
      'saldo_pelanggan_source_bppiut',
      'saldo_pelanggan_source_bphut',
      'saldo_pelanggan_source_change',
      'saldo_pelanggan_snapshot_manifest',
      'saldo_pelanggan_snapshot_pointer',
      'saldo_pelanggan_snapshot_row',
      'saldo_pelanggan_dirty',
      'saldo_pelanggan_build_work'
    ]) AS table_name
  LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      r.table_name, predicate, predicate
    );
  END LOOP;
END
$$;

-- dashboard_app reads only published snapshot surfaces. It cannot read source
-- cuts, changes, dirty state, or work scheduling, and cannot write any new
-- table. Guard role existence so local migrations remain portable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "app"."saldo_pelanggan_snapshot_manifest" TO dashboard_app;
    GRANT SELECT ON "app"."saldo_pelanggan_snapshot_pointer" TO dashboard_app;
    GRANT SELECT ON "app"."saldo_pelanggan_snapshot_row" TO dashboard_app;

    REVOKE SELECT ON "app"."saldo_pelanggan_source_cycle" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_source_pelanggan" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_source_bppiut" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_source_bphut" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_source_change" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_dirty" FROM dashboard_app;
    REVOKE SELECT ON "app"."saldo_pelanggan_build_work" FROM dashboard_app;

    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_source_cycle" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_source_pelanggan" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_source_bppiut" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_source_bphut" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_source_change" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_snapshot_manifest" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_snapshot_pointer" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_snapshot_row" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_dirty" FROM dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_build_work" FROM dashboard_app;
  END IF;
END
$$;
