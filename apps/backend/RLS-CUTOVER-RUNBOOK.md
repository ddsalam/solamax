# RLS Cutover Runbook — applying migration 0016 to a live environment

Operational procedure for enabling the unit-scoped Row-Level Security backstop (migration
`0016`) + audit log (`0017`) on a **live** SolaMax environment (the promoted-current IB
instance). Addresses review findings F1 (ordering + preflight), F2 (grants-only on live),
F3 (tested rollback). **Do not deviate from the ordering.**

## Why the ordering is inverted for 0016 (and only 0016)

`0016` enforces RLS reading the per-request GUC `app.unit_ids`, which is set by the app:
`qScoped()` in the **dashboard** image ([db.ts](../dashboard/src/lib/db.ts)) and `set_config`
in the **backend/ingest** image ([ingest.service.ts](src/ingest/ingest.service.ts)). If `0016`
is enforced while an image that does NOT set that context is still serving:
- **Old dashboard revision serving** → `current_setting('app.unit_ids')` is NULL → predicate
  matches nothing → **0 rows → IB dashboard blank.**
- **Backend image not yet shipped** → every ingest write violates `WITH CHECK` → **500 →
  IB agent pipeline stalls.**

Fail-closed (no leak) and instantly recoverable, but a live **availability** outage. Hence:
**deploy BOTH RLS-aware images to 100% traffic, THEN apply 0016.** `0017` (audit table) and
every other migration follow the standard **migrate-before-image** rule — `0016` is the sole
exception.

## Sequence (live)

1. **Migrate `0017` (audit_log)** out-of-band — standard order, additive table, no image dep.
2. **Deploy the backend RLS-aware image** (`solamax-ingest`). CD/deploy sets the label
   AUTOMATICALLY, derived from source (never hand-set):
   `RLS_AWARE=$(grep -q "set_config('app.unit_ids'" apps/backend/src/ingest/ingest.service.ts && echo 1 || echo 0)`
   → `gcloud run deploy solamax-ingest … --update-labels rls-aware=${RLS_AWARE}`. Wait for
   **100% traffic**. (Rehearsal: the label lands on the serving revision the preflight reads.)
3. **Deploy the dashboard RLS-aware image** (`solamax-dashboard`) likewise — the dashboard CD
   ([deploy-staging.yml](../../.github/workflows/deploy-staging.yml)) derives `--update-labels
   rls-aware` from `apps/dashboard/src/lib/db.ts`. Wait for **100% traffic**.
4. **PREFLIGHT GATE (hard stop):**
   ```
   REGION=asia-southeast2 bash apps/backend/scripts/preflight-rls-cutover.sh
   ```
   Exits nonzero unless BOTH services serve a single `rls-aware=1` revision at 100%. **Do not
   proceed on a nonzero exit.** (Gate logic is unit-tested: `preflight-rls-cutover.sh --selftest`.)
5. **Apply `0016`** out-of-band (via `prisma migrate deploy`, or `psql -f` the migration).
6. **Verify** IB reads return data (spot-check `/board`, `/unit/6478111/laporan/<date>`) and
   ingest writes succeed (agent log: `ingest ok`, no 422/500).

## Rollback (instant)

If IB reads go empty or ingest 500s after step 5:
```
psql "$SUPERUSER_URL" -f apps/backend/scripts/rls-rollback.sql   # DISABLE RLS + drop policies, all tables
```
This reverts to app-layer-only scoping immediately. If the RLS-aware image is fine (it is
backward-compatible — `qScoped` sets a GUC that, with RLS off, is simply unread), no image
rollback is needed; otherwise roll the image back too. Re-enable = re-apply `0016`. Rehearsed
end-to-end (enable→disable→recover→re-enable) in `session-notes/rls-rehearsal/` (evidence `09`).

## Grants on live — NEVER reset passwords

To (re-)assert grants on the live/promoted-prod instance use **grants-only**, which never
touches passwords or role attributes:
```
psql "$SUPERUSER_URL" -f apps/backend/scripts/grants-bootstrap.sql
```
**Do NOT** run `roles-provision.sql` on a live instance — it `ALTER ROLE … PASSWORD` and would
break the running dashboard + IB agent DB auth until Secret Manager secrets are rotated in
lockstep. `roles-provision.sql` is for standing up a **fresh** instance only (fresh = provision
then grants).

## F4 — scope of the backstop (known limitation, deferred)

The RLS backstop protects per-unit **data** rows. It deliberately EXCLUDES the authorization/
identity tables `public.unit`, `app.user_unit`, `app.membership`, `app.users` (topology +
membership) and `app.accounts` (OAuth tokens) — `dashboard_app` can read those, because auth
resolution needs them before any unit context exists. So a compromised `dashboard_app`
connection can enumerate all units/members and read OAuth tokens regardless of RLS. Low risk
while IB is the sole PT tenant; higher across multiple PTs. Metadata/token hardening (e.g.
column encryption, a separate auth role, token-store isolation) is tracked as a **separate
post-cutover security initiative** — out of scope for the RLS cutover.

---

## REAL-INFRA VALIDATION — dress rehearsal on `solamax-pg-rlsstg` (synthetic, 2026-07-05)

Full runbook rehearsed end-to-end on a separate real GCP staging env (live IB untouched).
Observed on real infra:

- **max_connections (db-g1-small) = 50**, `superuser_reserved_connections = 3` → **47 usable**
  (vs f1-micro's 22). Pool budget dashboard `5×2` + ingest `3×2` = **16** — fits with wide margin.
- **Concurrent-load test under RLS on g1-small:** 20 parallel `dashboard_app` clients × 150
  qScoped transactions (`BEGIN; set_config; SELECT; COMMIT`) = **3,000 txns in 27s, 0 errors,
  peak 21 connections**. The transaction-wrapping does not reproduce the June saturation at
  g1-small headroom (21 would be at f1-micro's 22 edge — the reason for the prod bump).
- **Label scope RESOLVED:** `gcloud run … --update-labels rls-aware=1` lands on **both the
  serving revision and the service**; `preflight-rls-cutover.sh` reads the *revision* label →
  works unmodified. Preflight PASSED on labeled `-rlsstg` @100%; still hard-FAILs on unlabeled
  revisions. No preflight change needed.
- **Ordering rehearsed:** 0017 (audit) migrate-before-image → both RLS-aware images labeled →
  100% → preflight PASS → **then** 0016 out-of-band. RLS then enforced: `dashboard_app`+context
  matches ground truth (pengawas own unit, direksi = union, no-context = 0), 26 tables RLS+FORCE.
- **Rollback:** `rls-rollback.sql` on real infra → 0 policies → full recovery → re-apply 0016 →
  fail-closed again. Instant.

### ⚠️ Cloud SQL specifics for the LIVE cutover (from the rehearsal)
1. **Role provisioning:** on Cloud SQL the admin is `cloudsqlsuperuser`, NOT a true superuser —
   it cannot `ALTER ROLE … NOSUPERUSER/NOBYPASSRLS` (nor GRANT those attrs). `roles-provision.sql`
   sets attributes at CREATE + password-only on the re-assert (fixed; ledger B1). Fresh instances only.
2. **FORCE RLS scopes the table owner too.** Post-0016, reads as `postgres` return 0 without
   context. Migrations (DDL) and ingest/app (context-set) are unaffected. **Any admin/verification
   query that must see all rows** must set `app.unit_ids`, or read pre-0016, or temporarily
   `rls-rollback.sql`. Capture ground truth PRE-0016.
3. **OAuth redirect URI** for a new service must be **added in the API Console** (Credentials →
   the OAuth client) — Google OAuth 2.0 web-client redirect URIs are not gcloud/API-manageable.
   Add-only; never edit an existing URI. (Rehearsal: deferred to owner console action.)
