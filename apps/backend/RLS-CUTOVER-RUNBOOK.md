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

0. **PRECONDITION — bump the instance to `db-g1-small` FIRST (R1).** Do this **before** the
   RLS-aware images serve prod load: the rehearsal peaked at **21 connections** vs f1-micro's
   **22 usable** — too tight, and the qScoped transaction-wrapping holds a client slightly longer.
   ```
   gcloud sql instances patch solamax-pg --tier=db-g1-small     # ~5-min restart; brief IB blip, ingest buffers+retries
   ```
   Wait RUNNABLE, then **verify `SHOW max_connections` = 50 (47 usable) on the live instance (R2)**
   via cloud-sql-proxy. This is the FIRST live mutation.
1. **Migrate `0017` (audit_log)** out-of-band — additive; must exist **before** the RLS-aware
   dashboard image (which references `AuditLog`) serves.
2. **Deploy the backend RLS-aware image** (`solamax-ingest-staging`). The label is set
   AUTOMATICALLY, derived from source (never hand-set):
   `RLS_AWARE=$(grep -q "set_config('app.unit_ids'" apps/backend/src/ingest/ingest.service.ts && echo 1 || echo 0)`
   → `gcloud run deploy solamax-ingest-staging … --update-labels rls-aware=${RLS_AWARE}`. Wait
   for **100% traffic**; `/health` ok. (Rehearsal: label lands on the serving revision the preflight reads.)
3. **Deploy the dashboard RLS-aware image** (`solamax-dashboard-staging`) via CD — since
   2026-07-16 the pilot deploys from `main` behind the `pilot` gate
   ([deploy-dashboard.yml](../../.github/workflows/deploy-dashboard.yml); see
   [DEPLOY.md](../../DEPLOY.md)), which derives `--update-labels rls-aware` from
   `apps/dashboard/src/lib/db.ts`. Confirm **100% traffic** AND the `rls-aware=1` label on
   the serving revision.
4. **PREFLIGHT GATE (hard stop):**
   ```
   REGION=asia-southeast2 BACKEND_SVC=solamax-ingest-staging DASHBOARD_SVC=solamax-dashboard-staging \
     bash apps/backend/scripts/preflight-rls-cutover.sh
   ```
   Exits nonzero unless BOTH services serve a single `rls-aware=1` revision at 100%. **Do not
   proceed on a nonzero exit.** (Gate logic is unit-tested: `preflight-rls-cutover.sh --selftest`.)
5. **Apply `0016`** out-of-band (via `prisma migrate deploy`, or `psql -f` the migration). **POINT OF NO RETURN.**
6. **Smoke test (R3) — must include a BROWSER-LOGIN check:** an IB user (direksi and pengawas)
   **logs in via the browser and sees IB data — the board/laporan render real numbers, NOT blank**.
   Plus: `/board`, `/unit/6478111/laporan/<date>` render; ingest writes succeed (agent log
   `ingest ok`, no 422/500); no zero-row regression vs pre-cutover.
7. **If the smoke test FAILS → immediately** `psql "$LIVE_OWNER_URL" -f apps/backend/scripts/rls-rollback.sql`
   (DISABLE RLS + drop policies → instant pre-RLS read behavior), **then report**. A failed RLS
   state is an IB outage — restore first. The RLS-aware images, g1-small tier, and `0017` may all stay.

## Rollback (instant)

If IB reads go empty or ingest 500s after step 5:
```
psql "$LIVE_OWNER_URL" -f apps/backend/scripts/rls-rollback.sql   # DISABLE RLS + drop policies, all tables
```
This reverts to app-layer-only scoping immediately. If the RLS-aware image is fine (it is
backward-compatible — `qScoped` sets a GUC that, with RLS off, is simply unread), no image
rollback is needed; otherwise roll the image back too. Re-enable = re-apply `0016`. Rehearsed
end-to-end (enable→disable→recover→re-enable) in `session-notes/rls-rehearsal/` (evidence `09`).

## Grants on live — NEVER reset passwords

To (re-)assert grants on the live/promoted-prod instance use **grants-only**, which never
touches passwords or role attributes:
```
psql "$LIVE_OWNER_URL" -f apps/backend/scripts/grants-bootstrap.sql
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
4. **ALL DDL runs as the TABLE-OWNER role, never `postgres` (ledger B3).** Live confirmed:
   `ingest` owns all 26 RLS tables. `postgres` (cloudsqlsuperuser, non-owner) **cannot**
   `ENABLE RLS`/`DROP POLICY` — rehearsal error `must be owner of table sync_state`. So `0017`,
   `0016`, `rls-rollback.sql`, and `grants-bootstrap.sql` all run as `$LIVE_OWNER_URL` (`ingest`).
   Enabling RLS on the 2 **app-schema** RLS tables also needs the owner to have **USAGE on schema
   `app`** — grants-bootstrap now grants it (ingest already owns schema `app` on live).

---

## ✅ LIVE-IB CUTOVER — EXECUTED 2026-07-07 (COMPLETE)

Ran on live `solamax-pg` / `solamax-ingest-staging` / `solamax-dashboard-staging`, gated per step,
DDL as `ingest` (credential re-verified `current_user=ingest` before each). Full evidence +
per-step timings in [`session-notes/rls-rehearsal/LEDGER.md`](../../session-notes/rls-rehearsal/LEDGER.md)
(§ LIVE-IB CUTOVER RUN).

- **STEP 0** db-f1-micro → **db-g1-small**, `max_connections=50`; post-restart health gate passed
  (dashboard 307, ingest `/health` ok, agent reconnected + draining).
- **STEP 1** grants-bootstrap (as ingest, **0 warnings** — see ledger DEVIATION: live public ACL
  pre-provisioned, equal-or-better) + `0017_audit_log` applied; `app.audit_log` present, append-only.
- **STEP 2** backend `solamax-ingest-staging-00024-fzr` @100% `rls-aware=1`.
- **STEP 3** owner merged PR #62 → dashboard `solamax-dashboard-staging-00036-v4w` @100% `rls-aware=1`.
- **STEP 4** preflight **GATE PASSED** (both services RLS-aware @100%).
- **STEP 5** `0016_rls_unit_scope` applied 06:51:00Z → **`pg_policy` unit_scope = 26**.
- **STEP 6** query-layer: no-context read 0 (fail-closed), IB ctx reads 172,530 rows, cross-unit write
  rejected; browser `/unit/6478111/laporan/2026-07-06` renders full IB data (omset Rp 983,3 jt), not blank.
- **STEP 7** **14/14 domains writing under RLS**, zero 4xx/5xx from `/ingest`; audit_log ready
  (append-only, non-unit-scoped); board `today` empty = no source data for that business date (not RLS).

**Final serving state:** db-g1-small RUNNABLE · ingest `00024-fzr` @100% `rls-aware=1` · dashboard
`00036-v4w` @100% `rls-aware=1` · migrations `0016`+`0017` applied. Rollback was never needed.
