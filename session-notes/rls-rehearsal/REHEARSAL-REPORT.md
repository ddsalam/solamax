# RLS Cutover — REAL-GCP STAGING DRESS REHEARSAL (evidence report)

Rehearsing the cutover runbook on a **new, separate** GCP staging env with **synthetic data**.
Live IB (`solamax-pg`, `solamax-dashboard-staging`, `solamax-ingest-staging`, their secrets)
untouched. Project `solamax`, region `asia-southeast2`.

## Provisioned resources (all `-rlsstg`, synthetic)

| Resource | Name / detail |
|---|---|
| Cloud SQL | `solamax-pg-rlsstg` — POSTGRES_16, enterprise, **db-f1-micro**, 10GB, DB `solamax` |
| Cloud Run (ingest) | `solamax-ingest-rlsstg` — rev `…-00001-shk`, healthy (`/health` `{"ok":true}`), **unlabeled** |
| Cloud Run (dashboard) | `solamax-dashboard-rlsstg` — rev `…-00001-2hm`, `307 → /login`, **unlabeled** |
| Secrets | `solamax-db-url-ingest-rlsstg`, `solamax-db-url-dashboard-rlsstg`, `solamax-auth-secret-rlsstg` (SA accessor bound) |
| Image | `…/solamax/solamax-dashboard-rlsstg:v1` (Cloud Build) |

Roles `dashboard_app` + `ingest` provisioned **NOSUPERUSER NOBYPASSRLS**; grants via
`grants-bootstrap.sql`. Schema baseline = **migrations 0001→0015 only** (mirrors current live
IB; 0016/0017 NOT applied — they are the cutover being rehearsed). Tenant renamed
`SolaGroup → PT Sola Petra Abadi` (IB-eq unit 1 + Bakau-eq unit 2); foreign tenant PT Synthetic B
(unit 99).

## Ground truth (recorded PRE-RLS, for post-0016 comparison)

| table | unit 1 | unit 2 | unit 99 |
|---|---|---|---|
| sales_detail | 2 | 3 | 1 |
| opname | 2 | 1 | — |
| app.manual_entry | 2 | 1 | — |

## ⚠️ FINDING B1 (real-infra) — Cloud SQL role ALTER (script fixed)

`roles-provision.sql`'s idempotent `ALTER ROLE … NOSUPERUSER NOBYPASSRLS PASSWORD` **failed on
Cloud SQL**: `ERROR: permission denied to alter role — Only roles with the SUPERUSER attribute
may change the SUPERUSER attribute`. Cloud SQL's admin is `cloudsqlsuperuser`, **not** a true
superuser (my local Docker tests used a real superuser, which masked this).

- **Fix (applied, uncommitted):** the re-assert ALTER now sets **password only**; the
  NOSUPERUSER/NOBYPASSRLS attributes are set at `CREATE` (defaults, settable everywhere) with a
  fail-closed `DO` guard that raises if either role ever carries `rolsuper`/`rolbypassrls`.
  Re-ran → both roles created `super=false bypass=false`, grants applied. ✅
- **Runbook impact:** this is *good* for the live cutover — on Cloud SQL, `cloudsqlsuperuser`
  also cannot **grant** SUPERUSER/BYPASSRLS, so `dashboard_app`/`ingest` can never gain an
  RLS-bypassing attribute there.
- **Related note for Phase C:** because Cloud SQL `postgres` is not a true superuser, with
  `FORCE ROW LEVEL SECURITY` the table-owner (`postgres`) is **also** subject to RLS after 0016
  — so "ground truth" must be read pre-0016 (done above) or via a temporary RLS-disable, not by
  assuming the admin bypasses RLS. Will validate in Phase C.

## Cost so far
db-f1-micro (prorated pennies), Cloud Run idle (~$0), 2 Cloud Build runs (~$0.02), secrets (~$0).

## Status: PHASE B COMPLETE — checkpoint before Phase C.
cloud-sql-proxy running on :5434 (ADC) for psql access. Next: Phase C (deploy labeled images →
preflight → tier bump + max_connections → 0016/0017 → verify → rollback), checkpointing each.

## PHASE C — real-infra rehearsal (checkpointed)
- **C1** 0017 applied (migrate-before-image); `app.audit_log` INSERT/SELECT only; 0016 not yet.
- **C2** `--update-labels rls-aware=1` → lands on serving revision AND service (label-scope resolved, no preflight fix). Both services 100% on labeled revisions.
- **C3** real preflight **PASS** on labeled `-rlsstg`; identical preflight **hard-FAILs** on unlabeled live-IB staging. Both paths captured.
- **C4** tier bump → **db-g1-small: max_connections=50 (47 usable)**; 0016 applied out-of-band (26 tables RLS+FORCE); `dashboard_app`+ctx == ground truth; **owner `postgres` also scoped post-0016 (FORCE + cloudsqlsuperuser)** — WATCH confirmed. Load test: 20×150 qScoped txns, **3000 in 27s, 0 errors, peak 21 conns**.
- **C5** no zero-row regression (sales 2/3/5, opname 2/1/3, manual_entry 2/1/3; foreign unit99 never). OAuth redirect-URI add = **owner console step** (add-only) — deferred.
- **C6** rollback (`rls-rollback.sql`) → recovery → re-enable → fail-closed. Instant, on real infra.
- Tier reverted g1-small → **db-f1-micro** for the kept permanent staging env.

## FINAL end-to-end DRY-RUN — ingest-owner, one continuous pass (2026-07-06)
Reset -rlsstg to the live baseline (0001–0015, RLS off, f1-micro, **ingest owns app schema +
all tables + sequences**, public schema default-owned — mirrors live), then replayed
GO-LIVE STEP 0→7 as ingest. **Clean end-to-end:**
- STEP 0 g1-small bump **320s (~5.3 min)**; `max_connections=50`.
- STEP 1 grants-bootstrap as ingest (benign `WARNING: no privileges were granted for "public"`
  — ingest owns app not public; public USAGE already exists on live, harmless) + `0017` **1s**;
  `dashboard_app` on audit_log = INSERT,SELECT.
- STEP 2/3 labeled backend + dashboard (derived label) → 100% (dry-run used `services update`,
  no rebuild — see window note); STEP 4 preflight **PASS**.
- STEP 5 `0016` **as ingest** → **26 tables RLS+FORCE** (instant).
- STEP 6 scoped reads 0/2/5; ingest write-path: unit-2 allowed, cross-unit REJECTED; audit
  INSERT ok / UPDATE denied.
- STEP 7 rollback as ingest → recover → re-enable → fail-closed. Tier reverted → f1-micro.

**Maintenance-window estimate (LIVE):** the dry-run relabeled via `services update` (seconds),
but on live STEP 2/3 are IMAGE deploys — backend `gcloud run deploy --source .` (~5–8 min) +
dashboard CD build+deploy (~8–12 min). DB DDL (0017/0016) is ~1s each; the g1-small bump is
~5 min. **Total live window ≈ 25–35 min**, dominated by the bump + the two image builds.

**Guardrails baked into GO-LIVE-COMMANDS.md:** fetch `$LIVE_OWNER_URL` from Secret Manager
without echoing; assert `current_user='ingest'` before any DDL; grants-bootstrap (incl B3)
before 0016; all 0017/0016/rollback DDL as ingest.
