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
