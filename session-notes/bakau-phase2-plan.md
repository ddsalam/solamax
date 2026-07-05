# SolaMax — Bakau Onboarding + Platform Hardening — LOCKED PLAN (Phase 2)

**Status:** PLAN ONLY. Nothing here is executed until owner releases each step. Written 2026-07-05.
**Companion docs:** [`bakau-parity-verdict.md`](bakau-parity-verdict.md) (Phase 1 close), [`bakau-probe-pack.sql`](bakau-probe-pack.sql).

Bakau = unit **6378301** (SolaGroup 63.783.01), owned by **PT Sola Petra Abadi** — the **same
tenant** as Imam Bonjol (6478111). Bakau is the first *added* unit that proves the multi-tenant
platform.

---

## 0. ORDERING & WHY IT IS SAFE

```
PHASE 1  Platform hardening        →  PHASE 2  Prod-env split       →  PHASE 3  Bakau onboarding
(RLS + audit + tenant rename +        (promote current→prod g1-small,  (cloud provisioning →
 per-unit monitoring), BUILT and       fresh staging instance,          local agent runbook →
 VERIFIED on a fresh staging           prod deploy path)                business-date backfill →
 instance with SYNTHETIC 2-unit                                         probe10 + Chrome accept)
 data before it ever touches
 live IB)
```

**Why this order is safe:**
1. **Hardening before the 2nd unit's data exists.** RLS + audit are the DB-layer isolation
   backstop under the `ScopedUnitId` choke-point. They must be live and proven *before* Bakau
   rows enter, so no window exists where two units share a DB with only app-layer isolation
   (owner decision A; CLAUDE.md roadmap #1 "HARD GATE sebelum tenant nyata ke-2").
2. **Everything that touches live IB is rehearsed on a throwaway replica first.** Phase 1's
   first sub-step stands up a **fresh staging instance seeded with schema + SYNTHETIC data**
   (never a copy of live pilot data). RLS, the tenant rename, and the audit log are developed
   and green there — including a synthetic 2-unit/1-tenant fixture that reproduces the exact
   Bakau⊥IB visibility question — before any DDL runs against prod.
3. **The prod "split" is a rename + tier bump, not a data migration.** IB's live data stays in
   the current `solamax-pg` instance; we promote that instance to prod identity and bump it to
   `db-g1-small`. No IB data is moved or re-ingested → zero data-loss surface.
4. **Bakau last.** Only after the platform is hardened and prod is real do we provision Bakau's
   cloud rows, install its agent, backfill, and run acceptance.

---

## PHASE 1 — PLATFORM HARDENING (unit-scoped RLS + audit + tenant rename + monitoring)

> All of Phase 1 is built and verified on the **fresh staging instance** (created in Step 1.0)
> with **synthetic** data. It is applied to the live/prod instance only in Phase 2, after green.

### Step 1.0 — Bootstrap the fresh staging instance (verification bed)  · BUILT NOW
- **Goal:** a safe replica to develop RLS/rename/audit against, seeded with schema + synthetic
  2-unit data (IB-like `6478111` + Bakau-like `6378301`, one PT Sola Petra Abadi tenant, plus a
  synthetic SECOND tenant "PT Synthetic B" for cross-tenant regression).
- **Commands (execution-time, not now):**
  - `gcloud sql instances create solamax-pg-staging --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro --region=asia-southeast2 --storage-size=10GB --storage-auto-increase` (staging can stay f1-micro — synthetic load only).
  - `prisma migrate deploy` (all 0001–0015 + the new 0016/0017 below) against staging via cloud-sql-proxy.
  - Reproduce the `ingest` / `dashboard_app` roles + grants (see **Grant-reproduction gap**, §Phase 2).
  - Seed synthetic rows: extend [`apps/backend/prisma/seed.ts`](../apps/backend/prisma/seed.ts) with a `SEED_SYNTHETIC=1` path adding tenant(s), unit 6378301, memberships (a pengawas scoped to each unit, a direksi over the PT), and a handful of sales/opname/tm_bbm rows per unit. **Never** point this at live data.
- **Risk:** none to prod (separate instance). **Rollback:** delete the staging instance.
- **Designed-for-N:** the synthetic fixture is parameterized by a unit list so future branches reuse it.

### Step 1.1 — Migration `0016_rls_unit_scope` (RLS backstop)  · BUILT NOW (policies) / DESIGNED-FOR-N (predicate covers any unit set)
- **Goal:** DB-layer row filtering keyed on a per-request unit context, as a backstop *under*
  (not replacing) the app choke-point ([`scope.ts:73`](../apps/dashboard/src/lib/scope.ts)).
- **Predicate (unit-scoped, per LOCKED tenant model):**
  ```sql
  -- current_setting('app.unit_ids', true) = comma list set per request; NULL when unset.
  USING ( unit_id = ANY (string_to_array(current_setting('app.unit_ids', true), ',')::int[]) )
  ```
- **Tables (every public mirror carrying unit_id):** `sales_header`, `sales_detail`, `opname`,
  `delivery`, `tebus_header`, `tebus_detail`, `tera`, `terra_resmi`, `cash_header`, `cash_detail`,
  `deposit`, `edc`, `pelanggan_sale`, `voucher_sale`, `bppiut`, `bphut`, `pelanggan_master`,
  `product`, `nozzle`, `tangki`, `real_tank`, `card`(no unit_id → skip/verify), plus `app.manual_entry`
  and `app.usulan_so`. (Confirm final list against `information_schema` at execution; card/master
  tables without `unit_id` are excluded.)
- **Per table:** `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;`
  `CREATE POLICY unit_scope ON … USING (<predicate>) WITH CHECK (<predicate>);`
  Idempotent, wrapped in the repo's `DO $$ … pg_roles … $$` guard pattern (see 0007).
- **Which role sees what:** `dashboard_app` (read) and `ingest` (write) are both non-owner granted
  roles → RLS applies. Migration-runner/superuser owns the tables → runs migrations unfiltered.
  No role gets `BYPASSRLS` (keeps the write path inside the backstop).
- **App wiring (ships in the IMAGE, see ordering):**
  - New `qScoped(scope, text, params)` in [`db.ts`](../apps/dashboard/src/lib/db.ts): checks out a
    client, `BEGIN; SELECT set_config('app.unit_ids',$ids,true); <query>; COMMIT`. Route all 33+
    scoped `queries.ts` functions through it (they already receive `ScopedUnitId[]`/`ScopedUnitId`).
    `set_config(...,true)` = transaction-local → safe with the shared pool ([`db.ts:49`](../apps/dashboard/src/lib/db.ts) currently does bare `pool.query`, which leaks session state — hence transaction-scoped).
  - Ingest ([`ingest.service.ts`](../apps/backend/src/ingest/ingest.service.ts) already runs a
    per-payload transaction): add `SELECT set_config('app.unit_ids', $unitId, true)` at the top of
    that transaction so writes satisfy `WITH CHECK`.
- **⚠️ MIGRATE-AFTER-IMAGE (inverted ordering — critical):** enabling RLS *before* the
  context-setting code is deployed makes `current_setting('app.unit_ids',true)` NULL →
  `unit_id = ANY(NULL)` → **zero rows for everyone = IB outage.** Therefore:
  1. **Deploy the image first** (`qScoped` + ingest `set_config`) — harmless no-op while RLS is off (setting a GUC nothing enforces).
  2. **Then run 0016** (ENABLE/FORCE + policies) out-of-band.
  This is the exception to the usual migrate-before-image rule; call it out on the runbook.
- **Risk:** mis-scoped predicate or a query not routed through `qScoped` → that query returns 0
  rows (fail-closed, not a leak). **Rollback:** `ALTER TABLE … DISABLE ROW LEVEL SECURITY` per
  table (instant, reversible); image rollback separate.
- **Verify on staging:** run the existing `scope.integration.test.ts` + new RLS tests (§Tests) with
  RLS ON; prove IB-synthetic unit sees only its rows at the DB layer even when the app context is
  forced to the wrong unit.

### Step 1.2 — Migration `0017_audit_log` (grant/revoke + optional data-access audit)  · BUILT NOW
- **Goal:** durable trail for `/admin` membership grant/revoke (owner decision A item 2). Currently
  only soft-audit columns exist on `app.manual_entry`.
- **Schema:**
  ```sql
  CREATE TABLE "app"."audit_log" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id INTEGER NOT NULL,
    actor_email   TEXT,
    action        TEXT NOT NULL,        -- grant_access | revoke_access | (later) data_access
    target        TEXT,                 -- e.g. membership id / user email / unit code
    detail        JSONB,                -- old/new role, unit scope, etc.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  GRANT SELECT, INSERT ON "app"."audit_log" TO dashboard_app;  -- append-only
  REVOKE UPDATE, DELETE ON "app"."audit_log" FROM dashboard_app;
  ```
- **App wiring:** insert an audit row inside `grantAccess`/`revokeAccess`
  ([`admin-actions.ts`](../apps/dashboard/src/lib/admin-actions.ts):~21/~60) in the same action.
  Data-access audit = **DESIGNED-FOR-N**, left as an opt-in flag (don't log every read at pilot scale).
- **Ordering:** standard **migrate-before-image** (table must exist before the image inserts to it).
- **Risk:** low (additive table). **Rollback:** `DROP TABLE app.audit_log` + image rollback.

### Step 1.3 — Tenant rename "SolaGroup" → "PT Sola Petra Abadi"  · BUILT NOW
- **Goal:** reflect the LOCKED tenant model (tenant = legal entity). Additive/reversible **data**
  update, not a delete/recreate.
- **Change:** idempotent script `apps/backend/scripts/rename-tenant.mjs` (or one-line SQL run
  out-of-band): `UPDATE app.tenant SET name='PT Sola Petra Abadi', slug='pt-sola-petra-abadi' WHERE slug='solagroup';`
  Verify `unit.tenant_id` for IB already points at this tenant (set during B1). No membership/unit
  FK changes.
- **Ordering:** data-only; run after 0016/0017 are green on the target instance. No image dependency
  (display name is read live). If any code hardcodes the slug `solagroup`, grep first and fix in the
  image (none found in Phase 1 recon; re-grep at execution).
- **Risk:** cosmetic/display only. **Rollback:** rename back to `SolaGroup`/`solagroup`.

### Step 1.4 — Per-unit monitoring readiness  · MOSTLY PRESENT / verify-for-N
- **Finding:** monitoring is already unit-scoped — `getComplianceMatrix`, `getLastInputs`,
  `getCorrections`, `getDoAnomalies`, `getDoSuspectSO` all take `ScopedUnitId`
  ([`queries.ts`](../apps/dashboard/src/lib/queries.ts)); board ranking already iterates `scope.units`.
- **Work:** confirm the Monitoring pages render **N units** from `scope.units` (not a single-unit
  assumption); denah/heatmap are data-driven from `tangki`/`nozzle`/`real_tank` (auto-populate for
  Bakau once data lands). Verify on staging with the synthetic 2-unit fixture.
- **BUILT NOW:** any single-unit assumption fix. **DESIGNED-FOR-N:** already generic.
- **Risk/Rollback:** UI-only; revert commit.

---

## PHASE 2 — PROD-ENV SPLIT (promote current→prod @ g1-small; fresh staging is permanent)

### Step 2.1 — Promote current `solamax-pg` to PRODUCTION + bump tier  · BUILT NOW
- **Goal:** end the "staging = pilot prod" deferral. IB's live data **stays in place** (no migration).
- **Actions (execution-time):**
  - `gcloud sql instances patch solamax-pg --tier=db-g1-small` (removes the June f1-micro
    22-connection ceiling; brief restart — schedule off-peak, WIB 02:00–05:00 per agent off-peak window).
  - Treat `solamax-pg` as prod; the Step 1.0 `solamax-pg-staging` becomes the permanent staging.
- **Connection budget recompute (at g1-small):**
  - f1-micro was `max_connections=25 − 3 reserved = 22` ([`prisma.service.ts:6`](../apps/backend/src/prisma.service.ts), [`db.ts:24`](../apps/dashboard/src/lib/db.ts)).
  - db-g1-small default `max_connections` ≈ **~150–200** (memory-derived; **VERIFY** with
    `SHOW max_connections;` on the patched instance — do not assume).
  - Demand is **near-flat in the number of units** (units share one ingest service + one dashboard
    service): dashboard pool `max:5 × ≤2 Cloud Run instances = 10` + ingest `connection_limit=3 × ≤2 = 6`
    + admin/migration headroom ≈ **~16–18 concurrent**, unchanged by adding Bakau. The g1-small bump is
    **headroom + ceiling-removal**, not a per-unit necessity. Keep pool `max:5` (update the [`db.ts:24`](../apps/dashboard/src/lib/db.ts) comment to the new tier math; do not raise `max` without recomputing).
- **Reassess-before-N:** re-run this budget when adding branch #3+ (more Cloud Run instances / higher `maxScale`).
- **Risk:** brief restart blip during tier patch. **Rollback:** `--tier=db-f1-micro` (but keep g1-small; the ceiling is the reason to bump).

### Step 2.2 — Reproduce out-of-git role grants on BOTH instances  · BUILT NOW (gap to close)
- **Gap (flagged Phase 1):** the `ingest` role and its grants were created outside Prisma → **not in
  git**. `dashboard_ro` (legacy) likewise. Only `dashboard_app`'s data grants live in migrations.
- **Action:** author `apps/backend/DEPLOY-GCP.md` role-bootstrap SQL (idempotent `DO $$ … pg_roles … $$`)
  capturing: `ingest` (INSERT/UPDATE/SELECT on public data tables it writes), `dashboard_app`
  (public SELECT + app SELECT/INSERT/UPDATE, DELETE revoked), and the RLS `set_config` grant needs.
  Apply to the fresh staging instance (Step 1.0) and re-confirm on prod. Commit the bootstrap SQL so
  it is reproducible for branch #3.
- **Risk:** missing a grant → ingest 500s / dashboard permission-denied (caught on staging first).
- **Rollback:** re-grant; grants are additive.

### Step 2.3 — Prod deploy path (main→prod) + secrets/WIF/OAuth  · BUILT NOW (define) / partially DESIGNED-FOR-N
- **Current:** `main→prod` is a **stub** ([`.github/workflows/deploy-staging.yml:87`](../.github/workflows/deploy-staging.yml)); dashboard CD is staging-only (image-only, protected env, WIF); backend deploys manually; migrations out-of-band.
- **Define:**
  - `deploy-prod.yml` (or a `deploy-prod` job) mirroring the staging job: `on: push: branches:[main]`,
    `environment: production` (SEPARATE protected gate), `env.SERVICE/IMAGE → solamax-dashboard-prod`.
    Image-only deploy; **migrations remain out-of-band** (documented manual promotion), preserving the
    migrate-before-image discipline (and the RLS image-before-migrate exception from Step 1.1).
  - **New Secret Manager entries:** `solamax-db-url-prod` (dashboard_app on prod socket),
    `solamax-db-url-ingest-prod`, plus prod `AUTH_SECRET` / `AUTH_GOOGLE_SECRET` if rotating per-env
    (recommend distinct prod secrets). Staging keeps its own. **Names only — values via Secret Manager, never git.**
  - **WIF bindings:** grant the prod deploy SA the same roles the staging SA has, scoped to prod services.
  - **OAuth:** stay in **Testing** (owner decision). Add the prod dashboard URL
    `https://<prod-url>/api/auth/callback/google` to the OAuth client's redirect URIs; add Bakau's
    pengawas Google accounts to the test-user allowlist (Phase 3). Update `AUTH_URL` env on the prod service.
- **Risk:** redirect-URI / secret mismatch → login failures (verify on staging URL first).
- **Rollback:** disable the prod job; revert service to prior image; redirect URIs are additive.

---

## PHASE 3 — BAKAU ONBOARDING (cloud → local agent → backfill → acceptance)

### Step 3.1 — Cloud provisioning (prod)  · BUILT NOW
- **Rows (idempotent, extend [`seed.ts`](../apps/backend/prisma/seed.ts) pattern or a one-off script):**
  1. `gen-api-key.mjs` → new Bakau plaintext key (→ agent config, gitignored) + sha256 hash (→ DB). Never echo the key.
  2. `public.unit` upsert: `unitId=2, code='6378301', name='Bakau', apiKeyHash=<hash>, timezone='Asia/Pontianak', tenant_id=<PT Sola Petra Abadi id>`.
  3. `app.membership` + `app.user_unit`: Bakau pengawas (scoped to unit 2); existing direksi/admin over the PT already see all units — verify.
- **Business config = PLACEHOLDER TODO only** ([`config.ts`](../apps/dashboard/src/lib/config.ts)):
  add commented `"6378301"` slots to `UNIT_DISPLAY`, `TARGET_BAURAN`, `TARGET_VOLUME_PER_DAY` with
  `// TODO(owner): supply Bakau 2026 workbook numbers`. **Do not invent values.** Tank capacity is
  data-driven (no config).
- **Ordering:** rows/migration before the agent sends (ingest 403s on unknown unit_code otherwise).
- **Risk:** wrong tenant_id → Bakau mis-scoped. **Rollback:** set `unit.active=false` (soft), or delete the unit row (no data yet).

### Step 3.2 — Local machine runbook (NOT run now — execution runbook)  · BUILT NOW (doc)
Mirror [`RUNBOOK-SPBU.md`](../apps/agent/RUNBOOK-SPBU.md) for the Bakau PC:
1. **MySQL `readonly_sync` SELECT-only user** on Bakau's EasyMax (5.0.67): `CREATE USER … ; GRANT SELECT ON easymax.* …; FLUSH;` verify `SHOW GRANTS` + `LENGTH(password)=41` (old_passwords=0). This is the *only* write to the Bakau box and it touches no EasyMax data.
2. **Per-unit config** `config.local.json` (gitignored): `unitCode:"6378301"`, `mysql.{host:127.0.0.1,user:readonly_sync,password:<via SOLAMAX_MYSQL_PASSWORD env>}`, `backend.{baseUrl:<prod ingest URL>, apiKey:<Bakau key via SOLAMAX_API_KEY env>}`. Bakau's driver/charset may need the mysql/mysql2 + LATIN1 fallbacks per the runbook troubleshooting table.
3. **Deploy bundle**: `pnpm --filter @solamax/agent bundle` → copy `solamax-agent.cjs` + config to `C:\solamax-agent`.
4. **Task Scheduler**: "Run whether user is logged on or not"; loop (no `--once`).
5. **`.cjs`-loaded-once gotcha**: on any bundle swap, End the task + kill `node.exe` + Run again (overwriting the file does not reload the running process — [`RUNBOOK-SPBU.md:183`](../apps/agent/RUNBOOK-SPBU.md)).
- **Risk:** auth-protocol/charset quirks (covered by runbook troubleshooting). **Rollback:** stop the scheduled task; no cloud data trusted until acceptance.

### Step 3.3 — Backfill + catch-up (business-date, to ~2022-08)  · BUILT NOW
- **Depth (owner decision):** match IB — one-time catch-up sweep from **~2022-08**, NOT full 2015 inception.
- **Correctness-minimum lookback (state + reason):**
  - **Windowed domains** (sales/opname/delivery/tera/edc): 2022-08 floor is fine; daily G/L and reports are date-bounded.
  - **Full-snapshot, date-agnostic domains** (`piutang`/`bppiut`, `hutang`/`bphut`, `deposit`): the agent
    already full-syncs these (no watermark) — the RECAP saldo block needs the **entire** balance history
    regardless of the 2022-08 floor, so **do not** window them. Confirm the agent's piutang/hutang/deposit
    sync remains full (it is, per Phase 1 read-path map).
  - **DO/tera open-balances** (per-SO via `CNOSO`, tera RESUME method): need enough trailing history that
    open SO balances and tera resume values are seeded correctly at the floor. Set the catch-up floor a
    margin **before** 2022-08 (e.g. start 2022-06) so the first in-window opname/DO has a correct opening.
- **⚠️ D2 — business-date sweep is mandatory:** Bakau's NULL-DTGLJAM is pervasive across **all 3 shifts**
  (~9,600 rows). An incremental `DTGLJAM > watermark` sync **permanently skips** them. The one-time
  catch-up MUST run the **business-date** `SALES_RESYNC`/deep-sweep path (`--deep-sweep <domain> <days>`,
  ~1,430 days back for ~2022-08), not the incremental path. Note this hazard is broader at Bakau than IB.
- **Verify by ROW COUNTS in Cloud SQL, not the batch log** (the "tera:2" false-alarm caveat): after the
  first scheduled cycle + catch-up, `SELECT count(*)` per domain per unit_id=2 in prod.
- **Risk:** stranded pre-floor data (accepted, matches IB); NULL rows missed if incremental used (mitigated by mandating business-date sweep). **Rollback:** re-run deep-sweep with a wider floor.

### Step 3.4 — Acceptance (probe10 + Chrome visual)  · BUILT NOW
- **probe10 gold-check** ([`probe.ts:823`](../apps/agent/src/probe.ts)) on Bakau dates: OMSET/PELANGGAN/
  EDC/DEPOSIT section totals must match EasyMax **to the rupiah**, reconciled against Bakau's real
  "Laporan Penjualan Harian" PDFs for a chosen set of dates.
- **Chrome visual pass** on Bakau's real pages before declaring live: `/board`, `/unit/6378301/laporan/<date>`,
  Rincian (cetak), `/monitoring/*` (denah/heatmap render Bakau tanks/nozzles), verify pengawas-Bakau sees
  only Bakau and IB-pengawas cannot see Bakau (cross-unit negative, live).
- **The 3 deltas as explicit acceptance items:**
  - **D1 (LOW):** prove per-product Rincian folds by **canonical NAME** with **no double-listing** —
    `BB-01`+`BB-07`→PERTALITE and `BB-03`+`BB-05`→SOLAR must SUM, not pick-one. **Confirm with owner**
    whether SOLAR + BIO SOLAR should stay merged for the PSO/NPSO bauran split, or BIO SOLAR must be a
    distinct line — flag if distinct.
  - **D2 (MEDIUM):** confirm the ~9,600 NULL-DTGLJAM rows landed (business-date sweep worked): sales row
    counts + daily omzet for Bakau reconcile to EasyMax including shift-3-lately-keyed days.
  - **D3 (MEDIUM):** **acceptance INVESTIGATION** — query whether Bakau `tm_plg` SJENIS 2 & 4 (dominant,
    575) customers carry `tr_bppiut`/`tr_bphut` balances the locked RECAP rule (Lokal{1,5}/Online{3})
    would omit/misclassify. **If they do: STOP and flag for an owner decision — do NOT silently change
    the locked RECAP classification.**
- **Risk:** number mismatch → do not go live; investigate. **Rollback:** keep unit `active=false` until green.

---

## TEST LIST

1. **Cross-unit negative (app layer), one tenant** — extend the fixture-free synthetic style of
   `scope.test.ts` / `scope.integration.test.ts`: pengawas@IB requesting Bakau unit → `notFound()`/404;
   pengawas@Bakau ⊥ IB; **direksi over PT Sola Petra Abadi sees BOTH** units.
2. **DB-layer RLS isolation (independent of the app choke-point)** — new integration test: connect as
   `dashboard_app`, `set_config('app.unit_ids','2',true)` in a txn, `SELECT` a public table, assert **zero**
   IB (unit_id=1) rows returned even though the SQL has no `WHERE unit_id` — proves RLS, not the app filter,
   enforces isolation. Repeat with the wrong context to prove fail-closed.
3. **IB-unaffected regression** — with RLS ON + tenant renamed, all 33+ scoped `queries.ts` functions
   return correct IB data; existing `grant.integration.test.ts` (public SELECT-only, app no-DELETE) still green;
   `pnpm check` green in CI.
4. **Ingest write-path under RLS** — ingest transaction with `set_config` writes unit-2 rows; a forged
   `unit_code`/context mismatch is rejected by `WITH CHECK` (defense-in-depth over the existing 403 in
   [`ingest.controller.ts`](../apps/backend/src/ingest/ingest.controller.ts)).
5. **Audit trail** — grant then revoke a synthetic membership → two `app.audit_log` rows with actor + detail;
   confirm append-only (UPDATE/DELETE denied to `dashboard_app`).

All of the above run on the **fresh staging instance with synthetic data** before any prod DDL.

---

## OPEN DECISIONS NEEDED AT EXECUTION TIME

1. **Bakau business-config numbers** — `UNIT_DISPLAY` (dotted name / PT / address), `TARGET_BAURAN`
   (PSO/NPSO gasoline+gasoil per month), `TARGET_VOLUME_PER_DAY` per product/month from Bakau's 2026 workbook.
2. **D1 — SOLAR vs BIO SOLAR** — keep merged for bauran, or split BIO SOLAR as a distinct product line?
3. **D3 — SJENIS 2/4 saldo** — if those customers carry piutang/hutang, how to classify them in RECAP
   (owner call; the current rule is LOCKED and I will not change it silently).
4. **Prod domain** — custom domain (e.g. `solamax.solagroup.id`) for prod, or keep the `run.app` URL?
   (drives OAuth redirect URIs + `AUTH_URL`).
5. **Per-env secret rotation** — distinct prod `AUTH_SECRET`/`AUTH_GOOGLE_SECRET`, or shared with staging?
6. **Staging tier** — keep `solamax-pg-staging` at f1-micro (synthetic-only) — confirm.
7. **Exact catch-up floor date** — 2022-08 vs a 2022-06 margin for DO/tera open-balance seeding (recommend the margin).
8. **Maintenance window** — confirm the WIB 02:00–05:00 off-peak window for the g1-small tier patch + RLS enable.

---

## GATE 2 — awaiting owner go. Nothing above is executed. Execution released step by step.
