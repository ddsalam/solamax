# RLS Staging-Hardening Slice — CUTOVER-READY REVIEW PACKAGE (GATE 3)

**Purpose:** exhibit for the independent adversarial review that gates the **live-IB RLS
cutover**. Everything was built + run on a **fresh, synthetic Postgres 16** (Docker, zero
live data). **Nothing touched live IB, prod, or Bakau. Nothing deployed. No agent installed.**

**Reproduce from a clean checkout — ONE command:**
```
bash session-notes/rls-rehearsal/rebuild-and-verify.sh
```
It drops/recreates the container, applies migrations `0001→0017`, runs `roles-bootstrap`,
seeds synthetic data, renames the tenant, and runs every exhibit below. Requires `docker`,
`psql`, `node>=18`. **The reviewer re-derives all evidence this way — no dependence on the
current `:55433` container state.**

**Substrate:** local Postgres **16.13** (identical RLS semantics to Cloud SQL PG16). The one
deferred physical step is `gcloud sql instances create solamax-pg-staging` — migrations/tests
here re-run against it unchanged.

---

## 0. Bottom line

| Claim | Evidence |
|---|---|
| **Every** per-unit data read runs through `qScoped` (RLS-scoped) — zero bare `q<>` reads remain | §2 grep-proof |
| Write paths (`manual_entry`, `usulan_so`, ingest) set unit context in-transaction | §3 |
| Full-app-under-RLS: **26/26** RLS tables return exactly the superuser-filtered truth per scope | §4, `06-full-app-under-rls.txt` |
| Bootstrap tables read before scope exists are **all** RLS-excluded (the lockout that bit once) | §5, `08-bootstrap-exclusion.txt` |
| Zero-rows failure reproduced, fixed, rolled back | §6, `03-rehearsal-and-tests.txt` |
| Integration suites (scope + grant + surfaces) run as `dashboard_app` for direksi + pengawas | §7 — **121/121 tests pass** |
| Out-of-git `ingest` grants reproduced | §8, `roles-bootstrap.sql` |
| Connection budget + g1-small caveat | §9 |

**Cutover-ready.** The remaining work is the live deploy discipline itself (image-before-migrate,
§6) + one app-render check that needs the running Next server (§10) — not a DB/RLS gap.

---

## 1. Artifact index

| Artifact | Path |
|---|---|
| RLS migration | [`apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql`](../../apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql) |
| Audit migration | [`apps/backend/prisma/migrations/0017_audit_log/migration.sql`](../../apps/backend/prisma/migrations/0017_audit_log/migration.sql) |
| qScoped executor | `apps/dashboard/src/lib/db.ts` |
| Converted reads (all) | `apps/dashboard/src/lib/queries.ts` |
| Write paths | `apps/dashboard/src/lib/manual-entry-actions.ts`, `usulan-actions.ts`, `apps/backend/src/ingest/ingest.service.ts` |
| Audit inserts | `apps/dashboard/src/lib/admin-actions.ts` |
| Grant-gap repro | [`apps/backend/scripts/roles-bootstrap.sql`](../../apps/backend/scripts/roles-bootstrap.sql) |
| Tenant rename | [`apps/backend/scripts/rename-tenant.sql`](../../apps/backend/scripts/rename-tenant.sql) |
| Synthetic fixture | [`synthetic-seed.sql`](synthetic-seed.sql) |
| One-command rebuild | [`rebuild-and-verify.sh`](rebuild-and-verify.sh) |
| Rehearsal + 5 tests | [`run-rehearsal.sh`](run-rehearsal.sh) |
| Full-app-under-RLS check | [`full-app-rls-check.sh`](full-app-rls-check.sh) |
| Surface integration test | `apps/dashboard/src/lib/rls-surfaces.integration.test.ts` |
| **Raw evidence** | `01`…`08` `.txt` in this dir |

---

## 2. Conversion completeness — grep-proof

All per-unit data reads now use `qScoped` (transaction-local `set_config('app.unit_ids',…,true)`
→ RLS filters at the DB layer, under the retained app-level `WHERE unit_id`). Proof:

```
$ grep -nE "\bq<" apps/dashboard/src/lib/queries.ts
(empty — all 30 converted; getSyncByUnit + getSalesByProduct converted earlier = 32 total)
```
The only bare `q()` left in `queries.ts` is a comment. `admin-actions.ts` / `auth-context.ts`
keep `q()` deliberately — they read the **non-RLS** `app.membership` / Auth.js tables (no
`unit_id`) and the RLS-**excluded** bootstrap tables (§5).

---

## 3. Write paths under RLS

- **`manual-entry-actions.ts`** — `addManualEntry` / `voidManualEntry` now `qScoped(unit.unit_id, …)`.
- **`usulan-actions.ts`** — its existing `pool.connect()` transaction gets
  `set_config('app.unit_ids', <unit>, true)` as the first statement (UPDATE+INSERTs then pass
  USING/WITH CHECK).
- **ingest** (`ingest.service.ts`) — `set_config` first inside the existing `$transaction`.

Proven live in §6 Test 4 (ingest cross-unit write rejected) and §7 (grant suite: `manual_entry`
INSERT/UPDATE succeed under context, DELETE denied).

---

## 4. Full-app-under-RLS — exhaustive (`06-full-app-under-rls.txt`)

For **every** RLS table: `count(dashboard_app, ctx)` == `count(superuser WHERE unit_id)` for
pengawas (ctx=1), other unit (ctx=2), direksi (ctx=1,2). **26/26 PASS.** Non-empty tables
(sales, opname, delivery, real_tank, nozzle, deposit, edc, pelanggan_sale, product, sync_state,
manual_entry, usulan_so) show correct **non-zero** scoping; empty tables are annotated
`genuinely-empty-in-synthetic` (0==0, **not** RLS-starved — the exact distinction requested).

Excerpt:
```
public.sales_detail   |  2/2  3/3  5/5 | ✅ PASS non-empty
public.real_tank      |  2/2  1/1  3/3 | ✅ PASS non-empty
app.manual_entry      |  2/2  1/1  3/3 | ✅ PASS non-empty
public.tera           |  0/0  0/0  0/0 | ✅ PASS genuinely-empty-in-synthetic
… PASS=26 FAIL=0
```

---

## 5. Bootstrap-exclusion — the lockout, closed (`08-bootstrap-exclusion.txt`)

Every table read **before** unit context exists — proven `rls_enabled = f`:

| pre-context table | read by | rls? |
|---|---|---|
| `public.unit` | getDataScope (scope.ts:68) | **f** (excluded in 0016) |
| `app.user_unit` | getAuthContext (auth-context.ts:81) | **f** (excluded in 0016) |
| `app.membership` | getAuthContext (:52,:67) | **f** (no unit_id) |
| `app.users`, `app.accounts`, `app.sessions`, `app.verification_token` | Auth.js `auth()` | **f** (no unit_id) |

The two `unit_id`-bearing ones are explicitly excluded in
[`0016` line 43–45](../../apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql). This
is the failure the rehearsal caught first pass (RLS on `unit`/`user_unit` → getDataScope reads 0
→ total lockout).

---

## 6. Image-before-migrate ordering + reproduced failure/fix/rollback (`03-rehearsal-and-tests.txt`)

**Why inverted:** enabling `0016` **before** the qScoped image → `current_setting('app.unit_ids')`
NULL → `ANY(NULL)` → **0 rows for everyone = IB outage**. So **deploy the image first**, **then**
run `0016`. Rollback: `ALTER TABLE … DISABLE ROW LEVEL SECURITY` (instant).

Reproduced: **Exhibit A** RLS-on/no-context → 0 rows (the outage). **Exhibit B** qScoped txn →
2 rows (the fix). **Exhibit C** DISABLE → 6 rows (recovery), ENABLE → 0 (re-armed). Plus the
5-test bar (cross-unit negative, DB-layer independence, direksi-both, ingest WITH CHECK, audit
append-only): **10/10 PASS**, roles `rolsuper=f rolbypassrls=f`.

---

## 7. Integration suites as `dashboard_app` (`07-integration-suites.txt`)

Run with `DATABASE_URL`/`DASHBOARD_APP_DATABASE_URL` = the **dashboard_app** connection:
- `scope.integration.test.ts` — real wiring + `unitVisible` (tenant renamed → slug
  `pt-sola-petra-abadi`; IB under the PT). ✅
- `grant.integration.test.ts` — public SELECT-only, `app.manual_entry` INSERT/UPDATE under RLS
  context, DELETE denied. ✅ (updated to a dedicated client + `set_config`).
- `rls-surfaces.integration.test.ts` (**new**) — drives real query fns: `getSalesByProduct`
  (no cross-unit name leak), `getSyncByUnit` (direksi `[1,2]` vs pengawas `[1]`), `getRealTank`
  /`getNozzles` (monitoring), `getManualEntries` (rincian), `getUsulanSoList` (usulan). ✅

**Full run: 22 files / 121 tests pass, 0 fail** (10 pre-existing unit tests whose `./db` mock
now also delegates `qScoped`).

---

## 8. Grant-gap reproduction (`01-roles-and-rls-state.txt`)

`roles-bootstrap.sql` recreates `ingest` + `dashboard_app` (both `NOSUPERUSER NOBYPASSRLS`),
public/app grants, and re-asserts append/void `REVOKE`s — the single reproducible source for
the previously out-of-git `ingest` grants. Verified: `rolsuper=f, rolbypassrls=f` for both.

---

## 9. Connection budget (prod-split step, NOT this slice)

- f1-micro today: `25 − 3 = 22 usable`. Demand ≈ **16–18** (dashboard `max:5×≤2` + ingest
  `3×≤2` + headroom), **flat in unit count** (units share the services). qScoped adds **no**
  net connections (one pooled client/query, wrapped in BEGIN/COMMIT).
- **⚠️ At prod time, VERIFY `SHOW max_connections;` on the patched g1-small** — do not assume
  the ~150–200 default. Keep pool `max:5`; re-budget only when raising Cloud Run `maxScale`.

---

## 10. Residual for the live cutover (explicitly out of this slice)

1. **Deploy discipline** — ship the (now fully-converted) image FIRST, then run `0016`
   out-of-band (image-before-migrate); pair rollback with an image rollback.
2. **Monitoring multi-unit UI render** — the scoped *data* is proven (§4/§7); visually
   confirming the Monitoring/denah pages render N units needs the running Next server (not a
   DB/RLS concern). Do this in the maintenance-window dry-run.
3. **Adversarial angles** (for the reviewer): GUC injection (ids are `Number()`-coerced branded
   ids, not free text); empty-scope → 0 rows (never "see all"); confirm no future superuser-owned
   data table; `WITH CHECK` on all ingest UPSERT/REPLACE paths (set_config is first in the txn).

---

## 11. Teardown
Disposable: `docker rm -f solamax-staging-pg`. No cloud resources created; no live systems touched.

**GATE 3 — STOP.** Live-IB RLS cutover, prod split, and Bakau onboarding remain **not started**,
pending this package's independent adversarial review + a maintenance-window dry-run.
