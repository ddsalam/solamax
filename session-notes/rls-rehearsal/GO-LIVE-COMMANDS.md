# LIVE-IB RLS Cutover — exact command sheet (staged; run only on explicit go)

Region `asia-southeast2`, project `solamax`. Live services **`solamax-ingest-staging`** +
**`solamax-dashboard-staging`**, instance **`solamax-pg`**. Runbook: `apps/backend/RLS-CUTOVER-RUNBOOK.md`.

## ⚠️ CRITICAL live-specific caveat (divergence from the rehearsal) — resolve BEFORE go
The rehearsal ran all DDL as the instance admin **`postgres`**, which **owned** the tables.
On live, per `apps/backend/DEPLOY-GCP.md`, migrations have historically run as **`ingest`** →
**`ingest` likely owns the public tables**. On Cloud SQL, `postgres` is `cloudsqlsuperuser`
(NOT a true superuser) and **cannot `ALTER`/`DROP POLICY` on another role's tables**. Therefore:
- **`0016` apply AND `rls-rollback.sql` MUST run as the LIVE TABLE-OWNER role** (the role prior
  migrations ran as — expected `ingest`). Running them as `postgres` will error "must be owner".
- **CONFIRM the owner role** before STEP 6 (read-only: `\dt+` ownership, or recall which role
  ran 0012). `$LIVE_OWNER_URL` below = that role's connection via proxy. If it differs from the
  rehearsal in any other way → STOP and report.

```
# fill at execution (owner-supplied; from Secret Manager, never committed):
LIVE_OWNER_URL='postgresql://<owner-role>:<pw>@127.0.0.1:5432/solamax'   # ingest/owner via proxy — used for 0017/0016/rollback DDL
PROXY='cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432'   # terminal 1
```

## STEP 0 — g1-small bump (FIRST live mutation) + verify max_connections (R1/R2)
```
gcloud sql instances patch solamax-pg --tier=db-g1-small          # ~5-min restart; brief IB blip
gcloud sql instances describe solamax-pg --format='value(settings.tier,state)'   # → db-g1-small RUNNABLE
psql "$LIVE_OWNER_URL" -tAc "SHOW max_connections;"               # → 50 (expect; 47 usable)
```

## STEP 1 — apply 0017 (audit) out-of-band, migrate-before-image
```
psql "$LIVE_OWNER_URL" -v ON_ERROR_STOP=1 -f apps/backend/prisma/migrations/0017_audit_log/migration.sql
apps/backend/node_modules/.bin/prisma migrate resolve --applied 0017_audit_log --schema apps/backend/prisma/schema.prisma
psql "$LIVE_OWNER_URL" -tAc "SELECT to_regclass('app.audit_log');"   # → app.audit_log
```

## STEP 2 — labeled RLS-aware BACKEND deploy → 100%
```
RLS_AWARE=$(grep -q "set_config('app.unit_ids'" apps/backend/src/ingest/ingest.service.ts && echo 1 || echo 0)  # → 1
gcloud run deploy solamax-ingest-staging --source . --region=asia-southeast2 \
  --add-cloudsql-instances=solamax:asia-southeast2:solamax-pg \
  --set-secrets=DATABASE_URL=solamax-db-url-staging:latest \
  --allow-unauthenticated --min-instances=0 --max-instances=2 --memory=512Mi \
  --update-labels rls-aware=${RLS_AWARE}
curl -s "$(gcloud run services describe solamax-ingest-staging --region=asia-southeast2 --format='value(status.url)')/health"  # → {"ok":true}
```

## STEP 3 — labeled RLS-aware DASHBOARD via CD (OWNER merges PR #62)
Owner merges PR #62 → `staging` → CD builds + deploys the labeled dashboard image (approve the
protected `staging` environment). Then confirm:
```
gcloud run services describe solamax-dashboard-staging --region=asia-southeast2 --format='value(status.traffic[0].revisionName,status.traffic[0].percent)'
rev=<serving-rev>; gcloud run revisions describe $rev --region=asia-southeast2 --format='value(metadata.labels.rls-aware)'  # → 1
```

## STEP 4 — PREFLIGHT GATE (must PASS)
```
REGION=asia-southeast2 BACKEND_SVC=solamax-ingest-staging DASHBOARD_SVC=solamax-dashboard-staging \
  bash apps/backend/scripts/preflight-rls-cutover.sh   # exit 0 required; nonzero → STOP, do not migrate
```

## STEP 5 — apply 0016 (RLS enable) out-of-band — POINT OF NO RETURN (as LIVE OWNER)
```
psql "$LIVE_OWNER_URL" -v ON_ERROR_STOP=1 -f apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql
apps/backend/node_modules/.bin/prisma migrate resolve --applied 0016_rls_unit_scope --schema apps/backend/prisma/schema.prisma
psql "$LIVE_OWNER_URL" -tAc "SELECT count(*) FROM pg_policy WHERE polname='unit_scope';"   # → 26
```

## STEP 6 — SMOKE TEST (must pass; R3 browser-login included)
- **Browser login**: an IB direksi + a pengawas sign in → **board/laporan render IB numbers, NOT blank**.
- `/board`, `/unit/6478111/laporan/<yesterday>` render; ingest agent log `ingest ok` (no 422/500);
  compare a known daily figure vs pre-cutover (no zero-row regression).

## ROLLBACK (instant; run as LIVE OWNER) — if smoke fails
```
psql "$LIVE_OWNER_URL" -v ON_ERROR_STOP=1 -f apps/backend/scripts/rls-rollback.sql   # DISABLE RLS + drop policies
```
Restores pre-RLS reads immediately. RLS-aware images, g1-small, and 0017 may stay. Report serving state.

## STEP 7 — post-cutover
- Confirm ingest still writing under context (agent `ingest ok`); `app.audit_log` captures a grant/revoke.
- Re-assert grants-only if needed (NEVER roles-provision on live): `psql "$LIVE_OWNER_URL" -f apps/backend/scripts/grants-bootstrap.sql`
- Record timings/outputs in the runbook + ledger.
