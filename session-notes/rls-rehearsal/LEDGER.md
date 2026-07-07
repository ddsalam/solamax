# Rehearsal-Driven Change LEDGER

Every change the real-GCP dress rehearsal forced. This ledger + the validated runbook go to a
FINAL independent re-check before the live cutover. No script change is silently accepted.

| # | Change | Why (real-infra trigger) | Files | Re-verified |
|---|---|---|---|---|
| B1 | `ALTER ROLE` re-assert sets **password only** (not NOSUPERUSER/NOBYPASSRLS); attrs set at CREATE + fail-closed guard DO block | Cloud SQL admin is `cloudsqlsuperuser`, not a true superuser → `ALTER … NOSUPERUSER` errors "permission denied to alter role". Local Docker true-superuser masked it. | `apps/backend/scripts/roles-provision.sql` | Re-ran on `solamax-pg-rlsstg` → both roles `super=f bypass=f`, grants applied ✅ |
| L2 | **No change needed** — `--update-labels rls-aware=1` lands on BOTH serving revision AND service; preflight reads the revision label → works as-is | Label-scope question (Phase C2) | — | Real Cloud Run: rev+svc both `rls-aware=1`; preflight PASS ✅ |
| L3 | **Test-only** — `rls-surfaces.integration.test.ts` lazy-imports `./queries` inside `beforeAll` (was a static import → eager `db.ts` makePool → threw in CI with no DATABASE_URL). Mirrors grant/scope integration suites. | PR #62 CI red at module import | `apps/dashboard/src/lib/rls-surfaces.integration.test.ts` | No-DB: SKIPS clean (137✓/17↓); with DB: 154✓, 26/26. **CI-hygiene only, no mechanism change — no re-check (owner)** |
| L4 | **Test-only** — `ingest.test.ts` now expects the ingest txn to run **4** statements (`set_config('app.unit_ids')` FIRST, then header/detail/sync_state) + asserts the RLS context param `=["1"]`. | The RLS `set_config` added to ingest.service.ts (cleared mechanism) made the old `toHaveLength(3)` assertion stale; CI (first run on this branch) caught it. | `apps/backend/src/ingest/ingest.test.ts` | Full `pnpm check` (no DATABASE_URL) green: backend ingest 7✓; strengthens coverage (verifies context set first). No mechanism change |
| B2 | `grants-bootstrap.sql`: add `GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO dashboard_app` (+ default privileges) | Auth.js pg-adapter `createUser` INSERTs into `app.users` via `users_id_seq` → first **real login** on the fresh `-rlsstg` instance failed `permission denied for sequence users_id_seq`. Synthetic harness seeded users with explicit ids → never hit the sequence. **Live IB unaffected** (already had this grant out-of-git). | `apps/backend/scripts/grants-bootstrap.sql` | Granted on `solamax-pg-rlsstg` → `has_sequence_privilege(dashboard_app, users_id_seq)=t`; login retried by owner |
| B3 | `grants-bootstrap.sql`: grant **ingest USAGE on schema `app`** (was public only) | Applying `0016` as the LIVE OWNER role `ingest` failed `permission denied for schema app` on `app.usulan_so`/`manual_entry` (owner-of-table ≠ USAGE-on-schema) → DO-block rolled back → **0 policies**. Surfaced by the Task-3 owner-role rehearsal. | `apps/backend/scripts/grants-bootstrap.sql` | -rlsstg: after grant, `0016` as ingest → **26 policies+FORCE**, fail-closed 0/2/5; **proved postgres (non-owner) rollback → "must be owner of table sync_state"** (validates DDL-as-owner) |
| pre | Label-wiring: derived `--update-labels rls-aware` from source marker (CD trust anchor) | GATE A (F1) — automatic, tamper-resistant, not hand-set | `.github/workflows/deploy-staging.yml` | Phase C2/C3 on real Cloud Run |

## Phase C validations (not code changes — real-infra facts for the runbook)
| item | result |
|---|---|
| C4 max_connections (db-g1-small) | **50** (superuser_reserved 3 → **47 usable**); pool budget 16 fits. Runbook caveat CLOSED. |
| C3 load test under RLS (g1-small) | 20×150 qScoped txns = 3000 in 27s, **0 errors, peak 21 conns**. No June-style saturation. |
| WATCH (B1) FORCE-owner-scoped | **CONFIRMED on real infra**: post-0016 `postgres` no-context read = 0. Runbook note added (verify via context / pre-0016 / temp rollback). Not a blocker (migrations=DDL, app=context). |
| C2 label scope | RESOLVED — lands on serving revision + service; preflight unmodified. |

## Open item requiring OWNER action (not a code change)
- **C5 OAuth redirect-URI add** to the live OAuth client for `-rlsstg` must be done in the
  **API Console** (Google OAuth 2.0 web-client redirect URIs are not gcloud/API-manageable).
  Add-only; never edit an existing URI. Deferred — I did not touch the live OAuth client.
  RLS scoping (the core of C5) validated at the DB layer on real infra instead.

## Committed
- B1 fix + label-wiring: commit `26d3251`. This ledger + runbook → FINAL independent re-check.

## Final end-to-end dry-run (2026-07-06)
Replayed GO-LIVE STEP 0→7 as ingest-owner on -rlsstg, clean end-to-end (26 policies, scoped 0/2/5, ingest write-path, rollback→recover→re-enable). **No new hard gap.** Note: grants-bootstrap as ingest warns benignly `no privileges were granted for public` (public USAGE pre-exists on live). Timings: bump 320s, 0017/0016 ~1s; live window ≈25–35 min (dominated by bump + backend/dashboard image builds).

---

# 🟢 LIVE-IB CUTOVER RUN (executed on live `solamax-pg` / `solamax-ingest-staging` / `solamax-dashboard-staging`)

Gated execution, owner go per step. Credential (`solamax-db-url-staging`) re-verified `current_user=ingest`
before every DDL. Rollback (`rls-rollback.sql` as ingest) kept standing by until STEP 7 clean.

| STEP | Action | Result / timing |
|---|---|---|
| pre | Credential identity | `current_user=ingest`, `current_database=solamax` ✅ (secret never echoed) |
| pre | Live baseline read-only | 0015, db-f1-micro, both revisions unlabeled, PR #62 unmerged ✅ |
| 0 | Bump f1-micro → **db-g1-small** | RUNNABLE; **`max_connections=50`** (superuser_reserved 3 → 47 usable) ✅. Post-restart health gate: dashboard 307, ingest `/health` ok, agent reconnected+draining (all realtime domains `last_run_at` ~1 min) ✅ |
| 1 | grants-bootstrap (as ingest) + **0017** | grants-bootstrap **0 warnings/errors** (see DEVIATION below); `has_schema_privilege(ingest,app,USAGE)=t`. 0017 apply exit 0 (CREATE TABLE + 2 idx + DO), `prisma migrate resolve` ok, `to_regclass('app.audit_log')` present, append-only `S=t I=t U=f D=f` ✅ |
| 2 | Labeled RLS-aware **backend** deploy (`--source .`) | rev **`solamax-ingest-staging-00024-fzr` @100%**, `rls-aware=1` (source-derived), `/health` ok; agent write landed on new rev, no 422/500 ✅ |
| 3 | **Owner merged PR #62** → dashboard CD | merge `87b35ee`, workflow `Deploy dashboard → staging` run 28846661093 **success**; rev **`solamax-dashboard-staging-00036-v4w` @100%**, `rls-aware=1`, 307→/login, /login 200 ✅ |
| 4 | **Preflight gate** (both live services) | **GATE PASSED**, clean exit 0 (both RLS-aware @100%) ✅ |
| 5 | Apply **0016** (as ingest) — point of no return | applied **2026-07-07 06:51:00Z**, exit 0, **`pg_policy` unit_scope = 26** ✅ |
| 6 | Query-layer smoke + browser | no-context read **0** (fail-closed); IB ctx(1) `sales_detail=172,530`/`opname=29,526`; write-path ctx(1) allowed, **cross-unit(999) rejected** (`new row violates row-level security policy`); no probe rows persisted. Browser (owner session, live): `/unit/6478111/laporan/2026-07-06` renders **full IB data** (omset Rp 983,3 jt, all 6 products, saldo, DO) — NOT blank ✅ |
| 7 | Steady-state | **14/14 domains wrote under RLS** (`last_run_at > 0016`; realtime @07:05:32Z, hutang/piutang/masters/pelanggan @07:07–07:08Z), **zero 4xx/5xx** from `/ingest`; audit_log ready (append-only, correctly NON-unit-scoped, 0 rows — no grant/revoke yet); board today empty = **no source data for business date 07-07** (07-06 renders fully) ✅ |

**Final serving state:** instance **db-g1-small** RUNNABLE · ingest **00024-fzr** @100% `rls-aware=1` · dashboard **00036-v4w** @100% `rls-aware=1` · migrations **0016+0017** applied.

### DEVIATION (accepted, benign) — absent `public USAGE` warning
grants-bootstrap on live produced **0 warnings** — the `-rlsstg` replay produced a benign
`WARNING: no privileges were granted for "public"`. Diagnosed: live `public` schema is owned by
`pg_database_owner` and its ACL **already pre-grants** USAGE to `ingest`/`dashboard_app`/`dashboard_ro`
(`ingest=U/pg_database_owner`), and `has_schema_privilege(ingest,public,CREATE)=t` — so ingest had
standing to (re)grant on public cleanly; a fresh `-rlsstg` did not, hence its warning. Equal-or-better:
every intended grant is present, nothing skipped, and the 0016 prerequisite (`ingest` USAGE on `app`) = t.
grants-bootstrap `RAISE EXCEPTION`s on real failure — it never silently skips. Owner accepted; not a hard gap.

### Notes
- Wall-clock spanned two calendar days: an owner-paced pause (incl. a gcloud CLI re-auth) fell between
  STEP 2 (07-06) and STEP 3 (07-07), both reversible pre-0016 steps. Each DDL op itself was ~1s; the
  RLS-on → smoke-confirmed window (STEP 5→6) was a few minutes. Rollback never needed.
- Post-0016, `FORCE RLS` scopes the `ingest` owner too: **admin/verification reads must set
  `app.unit_ids` context** or they return 0 (this is the fail-closed guarantee, not a bug).
