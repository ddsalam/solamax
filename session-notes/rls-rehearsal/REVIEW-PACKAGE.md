# RLS Staging-Hardening Slice — REVIEW PACKAGE (post-review, cutover-runbook ready)

Exhibit for the independent adversarial review. Built + run on a **fresh synthetic Postgres
16** (Docker, zero live data). **Nothing touched live IB, prod, or Bakau. Nothing deployed.**

The independent review **cleared the RLS mechanism** (could not falsify isolation) and raised
F1–F7. This revision resolves them. Proven parts (predicate coverage, transaction-local
semantics, FORCE/NOSUPERUSER/NOBYPASSRLS, 26-table coverage) are unchanged **except** the one
sanctioned additive touch: the F7 fail-closed cast guard.

**Reproduce from a clean checkout — ONE command:**
```
bash session-notes/rls-rehearsal/rebuild-and-verify.sh
```
Rebuilds container → migrations `0001→0017` → **roles-provision + grants-only** → seed →
rename → full-app-under-RLS → rehearsal+5 tests → **rollback+cast-guard+preflight guards** →
integration suites. Requires `docker`, `psql`, `node>=18`.

---

## Review findings → resolution

| # | Sev | Finding | Resolution | Evidence |
|---|---|---|---|---|
| F1 | BLOCKER | 0016 ordering spans both services; no rollout guard | [`RLS-CUTOVER-RUNBOOK.md`](../../apps/backend/RLS-CUTOVER-RUNBOOK.md) (backend→100%→dashboard→100%→preflight→0016) + [`preflight-rls-cutover.sh`](../../apps/backend/scripts/preflight-rls-cutover.sh) hard-fails unless BOTH services serve `rls-aware=1` @100% | `09` (preflight self-test ALL-PASS) |
| F2 | BLOCKER | roles-bootstrap resets passwords on live | **Split**: [`grants-bootstrap.sql`](../../apps/backend/scripts/grants-bootstrap.sql) (grants-only, live-safe, NO password) + [`roles-provision.sql`](../../apps/backend/scripts/roles-provision.sql) (fresh-instance only). Runbook references grants-only on live | rebuild §3 (provision+grants) |
| F3 | non-blk | no scripted rollback; dangling "0016_rollback note" | [`rls-rollback.sql`](../../apps/backend/scripts/rls-rollback.sql) (DISABLE + drop policy, all tables); 0016 reference fixed | `09` (enable→disable→recover→re-enable) |
| F4 | doc | metadata/topology + OAuth tokens outside the backstop | Documented in runbook §F4 + below; hardening = separate post-cutover initiative (not attempted) | — |
| F5 | fold | hardcoded "SolaGroup" ≠ renamed tenant | Replaced tenant/direksi display strings + app title/manifest → "PT Sola Petra Abadi" (left "SolaGroup DS", workbook name, asset filename) | tests updated, 154 pass |
| F6 | fold | mocks drop the unit arg → scope wiring untested | [`queries.scope-wiring.test.ts`](../../apps/dashboard/src/lib/queries.scope-wiring.test.ts): all **32** converted fns asserted to pass their authorized unit to qScoped | `07` (33 new tests) |
| F7 | nit | malformed context → error, not 0 rows | 0016 predicate now filters numeric tokens before cast → fail-closed 0 rows, no throw; legit scoping unchanged | `09` (probes) |

---

## Artifact index

| Artifact | Path |
|---|---|
| RLS migration (+ F7 guard) | [`0016_rls_unit_scope/migration.sql`](../../apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql) |
| Audit migration | [`0017_audit_log/migration.sql`](../../apps/backend/prisma/migrations/0017_audit_log/migration.sql) |
| Rollback (F3) | [`scripts/rls-rollback.sql`](../../apps/backend/scripts/rls-rollback.sql) |
| Grants-only, live-safe (F2a) | [`scripts/grants-bootstrap.sql`](../../apps/backend/scripts/grants-bootstrap.sql) |
| Role provisioning, fresh-only (F2b) | [`scripts/roles-provision.sql`](../../apps/backend/scripts/roles-provision.sql) |
| Preflight gate (F1) | [`scripts/preflight-rls-cutover.sh`](../../apps/backend/scripts/preflight-rls-cutover.sh) |
| Cutover runbook (F1/F2/F3/F4) | [`RLS-CUTOVER-RUNBOOK.md`](../../apps/backend/RLS-CUTOVER-RUNBOOK.md) |
| Tenant rename | [`scripts/rename-tenant.sql`](../../apps/backend/scripts/rename-tenant.sql) |
| qScoped executor + conversions | `apps/dashboard/src/lib/{db,queries,manual-entry-actions,usulan-actions,admin-actions}.ts`, `apps/backend/src/ingest/ingest.service.ts` |
| Scope-wiring test (F6) | `apps/dashboard/src/lib/queries.scope-wiring.test.ts` |
| One-command rebuild | [`rebuild-and-verify.sh`](rebuild-and-verify.sh) |
| Guards rehearsal (F3/F7/F1) | [`rollback-and-guards.sh`](rollback-and-guards.sh) |
| **Raw evidence** | `01`…`09` `.txt` in this dir |

---

## Verified (this revision, clean rebuild)

- **Full-app-under-RLS 26/26** — `dashboard_app`+ctx == superuser-filtered truth (pengawas / other unit / direksi). `06`.
- **Rehearsal + 5 tests 10/10** (zero-rows failure → qScoped fix → rollback → re-arm; cross-unit negative; DB-layer independence; direksi-both; ingest WITH CHECK; audit append-only). `03`.
- **F3 rollback rehearsal** — committed `rls-rollback.sql` drops all 26 policies → dashboard_app reads full data (recovered) → re-apply 0016 → fail-closed again. `09`.
- **F7 fail-closed cast guard** — unset/empty/` `/`abc`/`-1`/`0`/`x,y`/`1a` → **0 rows, no error**; `1`→2, `1,2`→5 unchanged. `09`.
- **F1 preflight gate** — self-test ALL-PASS: PASS on 100%+`rls-aware=1`; clean FAIL on split rollout / missing label / label=0 / no active revision. `09`.
- **Integration + scope-wiring** — 23 files / **154 tests pass** as `dashboard_app` (scope, grant, rls-surfaces, and the 32-function scope-wiring suite). `07`.
- Typecheck clean; branded `ScopedUnitId` still guarantees only authorized units reach qScoped.

## Ordering (unchanged, now enforced) & rollback

`0016` is the sole **image-before-migrate** exception: deploy backend RLS-aware image →100% →
dashboard RLS-aware image →100% → **preflight gate** → apply `0016`. `0017` + all else stay
migrate-before-image. Rollback = `rls-rollback.sql` (instant, tested). See the runbook.

## Connection budget (prod-split step, NOT this slice)

Demand ≈16–18 (dashboard `max:5×≤2` + ingest `3×≤2` + headroom), flat in unit count; qScoped
adds no net connections. **⚠️ At prod time, verify `SHOW max_connections;` on the patched
g1-small — do not assume the ~150–200 default.**

## F4 — backstop scope (deferred)

RLS protects per-unit **data** rows. It excludes the auth/identity tables `public.unit`,
`app.user_unit`, `app.membership`, `app.users` (topology/membership) and `app.accounts`
(OAuth tokens) — `dashboard_app` reads those because auth resolves before any unit context
exists. A compromised `dashboard_app` could enumerate all units/members + read tokens
regardless of RLS. Low while IB is the sole PT; higher across PTs. **Metadata/token hardening
is a separate post-cutover security initiative — not attempted here.**

---

## GATE — STOP. Blocker fixes (F1–F3) go to a targeted re-check before any live run.
Live-IB RLS cutover, prod split, and Bakau onboarding remain **not started**. Nothing deployed.
Teardown: `docker rm -f solamax-staging-pg`.
