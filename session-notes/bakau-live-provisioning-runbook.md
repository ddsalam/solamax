# Bakau — LIVE cloud-provisioning runbook (unit #2)

**Status: PLAN. Run only on the explicit live-Bakau dispatch (separate from this one).** IB day-1
under RLS is CLEAN, so this is cleared to run after GATE 3. Provisions Bakau (`unit_id=2`,
code `6378301`) as the 2nd unit under the existing PT tenant. Rehearsed end-to-end on `-rlsstg`
(GATE 2): DB-layer RLS isolation + app-scope isolation (6/6) + tenant rename + D1/D3.

Companion: **(b)** [`bakau-machine-side-runbook.md`](bakau-machine-side-runbook.md) (Dion runs the
agent install + backfill). RLS discipline: [`apps/backend/DEPLOY-GCP.md`](../apps/backend/DEPLOY-GCP.md).

> **No maintenance window needed.** Provisioning is additive DML (one `unit` INSERT + one
> `tenant` UPDATE) + a dashboard image deploy — **no instance restart, no RLS toggle**. IB is
> unaffected. `public.unit` and `app.tenant` are **RLS-excluded**, so writes need **no unit context**.

---

## Guardrail — before ANY write (same as the RLS cutover)
All DDL/DML here runs as the table-owner role `ingest` (`postgres`/cloudsqlsuperuser is a non-owner
and cannot write owner tables under FORCE RLS). Fetch the connection from Secret Manager **without
echoing it**, and fail-fast unless it authenticates as `ingest`:
```bash
cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432          # terminal 1 (live)
ING_CRED=$(gcloud secrets versions access latest --secret=solamax-db-url-staging | sed -E 's|^postgresql://([^@]+)@.*|\1|')
LIVE_OWNER_URL="postgresql://${ING_CRED}@127.0.0.1:5432/solamax"        # not printed
psql "$LIVE_OWNER_URL" -tAc "SELECT current_user" | grep -qx ingest \
  || { echo "ABORT: DDL role is not 'ingest'"; }
```

---

## Ordering (why it is safe)
```
STEP 0 gen key ─┐
STEP 1 unit row (with api_key_hash)  ─── MUST exist BEFORE the agent's first /ingest push
STEP 2 tenant rename                      (else 401 unknown key / 403 unit_code / RLS WITH CHECK fail)
STEP 3 raw key → Secret Manager + agent config (machine-side)
STEP 4 config deploy (dashboard image)
        ── then MACHINE-SIDE (runbook b): agent install + one-time backfill ──
STEP 5 OAuth test-user add   (owner console; needed only for pengawas login)
STEP 6 pengawas grant         (after first login; dashboard access only, independent of ingest)
```
**Hard rule:** STEP 1 (unit row + `api_key_hash`) precedes the agent starting. STEPS 5–6 are
dashboard-login concerns and can happen any time. Direksi/admin of the PT **auto-see Bakau** once
STEP 1 lands (no grant needed — proven in Phase 2).

---

## STEP 0 — generate the API key (raw never echoed)
```bash
node apps/backend/scripts/gen-api-key.mjs > "$SCRATCH/bakau-key.txt" 2>&1   # $SCRATCH = gitignored/temp
HASH=$(grep -oE '[0-9a-f]{64}' "$SCRATCH/bakau-key.txt" | head -1)          # sha256 → DB (safe to show)
# raw key stays in the scratch file → goes to Secret Manager (STEP 3) + agent config only.
```
**Rollback/void:** discard the scratch file; if already in Secret Manager, destroy that version and
regenerate (rotate). The hash is only referenced by the unit row (removed in the STEP 1 rollback).

## STEP 1 — insert the Bakau unit row (as ingest; RLS-excluded, no context)
```bash
# tenant_id is fetched live (do NOT hardcode) — Bakau shares IB's PT tenant:
psql "$LIVE_OWNER_URL" -v ON_ERROR_STOP=1 -v hash="$HASH" <<'SQL'
INSERT INTO public.unit (unit_id, code, name, api_key_hash, timezone, active, tenant_id)
SELECT 2, '6378301', 'Bakau', :'hash', 'Asia/Pontianak', true, tenant_id
FROM public.unit WHERE code = '6478111';           -- inherit IB's PT tenant_id
SQL
psql "$LIVE_OWNER_URL" -c "SELECT unit_id,code,name,timezone,active,tenant_id FROM public.unit ORDER BY unit_id;"
```
Expect: unit 2 = Bakau, same `tenant_id` as unit 1. **Precondition:** `unit_id=2` is free (confirmed
2026-07-07: live has only unit 1). **Rollback:** `DELETE FROM public.unit WHERE unit_id=2;` (safe
while no data has been ingested) — or soft: `UPDATE public.unit SET active=false WHERE unit_id=2;`.

## STEP 2 — tenant rename (REQUIRED on live; verbatim rehearsed statement)
Live tenant is still `solagroup`; both scope integration tests key on slug `pt-sola-petra-abadi`.
```bash
psql "$LIVE_OWNER_URL" -v ON_ERROR_STOP=1 <<'SQL'
UPDATE app.tenant SET name='PT Sola Petra Abadi', slug='pt-sola-petra-abadi'
 WHERE slug='solagroup';
SQL
psql "$LIVE_OWNER_URL" -c "SELECT id,name,slug FROM app.tenant;"
```
Expect one row: `PT Sola Petra Abadi / pt-sola-petra-abadi`. `tenant_id` (uuid) is unchanged → no FK
impact. **Rollback (only if aborting the whole onboarding):**
`UPDATE app.tenant SET name='SolaGroup', slug='solagroup' WHERE slug='pt-sola-petra-abadi';`

## STEP 3 — store the raw key (Secret Manager + agent config)
```bash
# raw key → a dedicated secret (never echoed). Example:
gcloud secrets create solamax-bakau-agent-key --replication-policy=automatic 2>/dev/null || true
grep -oiE 'API key[^:]*:[[:space:]]*\S+' "$SCRATCH/bakau-key.txt" | sed -E 's/.*:[[:space:]]*//' \
  | gcloud secrets versions add solamax-bakau-agent-key --data-file=-
```
The machine-side runbook reads this into the agent config (`backend.apiKey` / `SOLAMAX_API_KEY`).
**Void:** `gcloud secrets versions destroy` the version (and rotate via STEP 0 if exposed).

## STEP 4 — deploy the Bakau dashboard config (CD)
Config already committed on `claude/bakau-onboard` (`config.ts`: BK 12-month bauran+volume +
`UNIT_DISPLAY`). **Owner merges `claude/bakau-onboard` → `staging`** → dashboard CD deploys the image
(approve the protected env). Harmless before unit 2 has data (config is keyed by code, returns `null`
for empty months). **Address placeholder** in `UNIT_DISPLAY["6378301"]` — supply the real address in
this same PR before merge if available. **Rollback:** revert the dashboard revision (previous image).

## STEP 5 — OAuth test-user add (OWNER CONSOLE ACTION)
Add `spbu6378301sbbl@solagroup.co` to the OAuth client's **Testing** test-user list
(Google Cloud Console → APIs & Services → OAuth consent screen → Test users). **Add-only**; this is
console-only (not gcloud-manageable), same as the earlier `-rlsstg` redirect-URI add. **Void:** remove
the test user from the list.

## STEP 6 — pengawas grant (after first login)
1. Pengawas signs in once at the dashboard (creates the `app.users` row).
2. A super_admin opens `/admin` → grants **role=pengawas**, tenant=PT Sola Petra Abadi, **units={Bakau}**.
   This writes `app.membership(role='pengawas')` + `app.user_unit(unit_id=2)`
   ([admin-actions.ts:36-54](../apps/dashboard/src/lib/admin-actions.ts)).
   Scripted alternative (if not using the UI), as ingest — `user_unit`/`membership` are RLS-excluded:
   ```sql
   -- after the user row exists (get its id from app.users WHERE email=...):
   WITH m AS (
     INSERT INTO app.membership (user_id, tenant_id, role, status, invited_by_email)
     SELECT u.id, t.id, 'pengawas', 'active', 'provisioning'
     FROM app.users u, app.tenant t
     WHERE u.email='spbu6378301sbbl@solagroup.co' AND t.slug='pt-sola-petra-abadi'
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='pengawas', status='active'
     RETURNING id)
   INSERT INTO app.user_unit (membership_id, unit_id) SELECT m.id, 2 FROM m
   ON CONFLICT DO NOTHING;
   ```
**Rollback:** revoke via `/admin`, or `DELETE FROM app.user_unit WHERE unit_id=2; DELETE FROM
app.membership WHERE user_id=<...> AND role='pengawas';`.

---

## Post-provisioning verification (read-only)
```bash
# both scope integration tests now pass against LIVE (rename landed + Bakau exists):
SCOPE_LIVE_DB=1 DATABASE_URL="$LIVE_DASHBOARD_URL" \
  pnpm --filter @solamax/dashboard exec vitest run src/lib/scope.integration.test.ts src/lib/scope.bakau.integration.test.ts
# unit 2 present + RLS isolation (context reads) as in Phase 2 chunk 3.
```
Then hand off to **runbook (b)** for the agent + backfill. After acceptance (probe10 + Cloud SQL row
counts), Bakau is live.

## FULL ROLLBACK (abort onboarding)
As ingest, in order: revoke pengawas (STEP 6) → remove OAuth test-user (STEP 5) → revert dashboard
image (STEP 4) → `DELETE FROM public.unit WHERE unit_id=2` **after** purging any ingested unit-2 data
(context `set_config('app.unit_ids','2',true)` then `DELETE … WHERE unit_id=2` per the Phase-2 DO-loop
pattern) → revert the tenant rename (STEP 2) → destroy the key secret (STEP 3/0). IB is never touched.
