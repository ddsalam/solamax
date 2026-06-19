# Dashboard — deploy (Cloud Run staging = the live pilot)

Staging **is** the pilot production (no separate prod env yet — see "main → prod" below).
Treat every staging deploy as production.

## Automated CD (the normal path)

```
merge to `staging`  →  CI gate (pnpm check + lint:ds)  →  approve in Actions  →  image-only deploy
```

1. Land your change on `staging` (PR or fast-forward). Path-filtered: a deploy only runs if the
   push touches `apps/dashboard/**`, `packages/shared/**`, `pnpm-lock.yaml`, or the workflow itself.
2. [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) runs:
   - **`ci`** job — `pnpm check` (typecheck + all tests, incl. the negative-access `scope.test.ts`)
     + `pnpm --filter @solamax/dashboard lint:ds`. Deploy only proceeds on green.
   - **`deploy`** job — gated by the protected **`staging` GitHub Environment** (required reviewer).
     Go to **Actions → the run → Review deployments → approve `staging`**. Then it:
     - builds the image **in-runner with Docker** (`apps/dashboard/Dockerfile`) and pushes to
       Artifact Registry, tagged by commit SHA;
     - **image-only** `gcloud run deploy solamax-dashboard-staging --region=asia-southeast2 --image …`
       — env, secrets, Cloud SQL, and scaling **carry forward unchanged** from the prior revision.

Nothing reaches the pilot without the approval click. Auth is **Workload Identity Federation**
(no service-account key); the GH→GCP identity is restricted to `repository == ddsalam/solamax` and
`ref == refs/heads/staging`.

`workflow_dispatch` is declared but **not usable from the UI** until the workflow also exists on the
default branch (`main`) — by design we don't merge it there yet.

## Why in-runner Docker build (not `gcloud builds submit`)

`cloudbuild.yaml` is just a thin `docker build -f apps/dashboard/Dockerfile` wrapper, so the runner
build produces the **identical image**. We switched away from `gcloud builds submit` because under
WIF it fails at source-staging:

> `ERROR: (gcloud.builds.submit) The user is forbidden from accessing the bucket [solamax_cloudbuild]
> … "serviceusage.services.use" permission.`

**IAM gotcha (so it's not rediscovered):** `gcloud builds submit` stages source in GCS and, with a
WIF `external_account` credential, forces an `x-goog-user-project` / `serviceusage.services.use`
check. We granted `roles/serviceusage.serviceUsageConsumer` to **both** the deploy SA and the WIF
principalSet, plus `storage.admin` on `gs://solamax_cloudbuild`, and it **still 403'd** (the check
behaves badly for external_account creds). The reliable fix was to drop Cloud Build entirely and
build on the runner — Docker → Artifact Registry needs only `artifactregistry.writer` + the minted
OAuth access token (`token_format: access_token`). If you ever go back to `builds submit`, you'll
need the serviceusage grants above — and you'll likely still hit the wall.

## Manual deploy (break-glass / fallback)

From repo root, authenticated as a human with deploy rights (region is **asia-southeast2** — the
gcloud default is southeast1, so always pass `--region`):

```bash
# build + push (or use cloudbuild.yaml if running as a human, not the WIF SA)
gcloud builds submit --config apps/dashboard/cloudbuild.yaml \
  --substitutions=_IMAGE=asia-southeast2-docker.pkg.dev/solamax/solamax/solamax-dashboard-staging:<tag> .
# image-only deploy (preserves env/secrets/cloudsql/scaling)
gcloud run deploy solamax-dashboard-staging --region=asia-southeast2 \
  --image asia-southeast2-docker.pkg.dev/solamax/solamax/solamax-dashboard-staging:<tag>
```

**Never** add `--set-env-vars` / `--set-secrets` / `--clear-*` — that full-replaces and wipes config.
After any deploy, diff `gcloud run services describe … --format=export` before vs after: only the
image + revision name should change.

## Rollback (traffic shift only — DB untouched)

```bash
gcloud run services update-traffic solamax-dashboard-staging --region=asia-southeast2 \
  --to-revisions=<PREVIOUS_REVISION>=100
```

## main → production (inactive stub — deferred)

There is **no prod Cloud Run service / DB yet**; the pilot runs on staging. The workflow carries a
commented `deploy-prod` stub. Activate it when a prod service (e.g. `solamax-dashboard-prod`) + its
own DB exist — gated on tenant #2 / the Postgres-RLS hard-requirement (see root `CLAUDE.md`). It
mirrors the staging deploy with a separate `production` protected environment and the WIF provider
widened to allow `refs/heads/main`.

## Key resources

| | |
|---|---|
| Service | `solamax-dashboard-staging` · region `asia-southeast2` · project `solamax` (113869564052) |
| URL | https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app |
| Image | `asia-southeast2-docker.pkg.dev/solamax/solamax/solamax-dashboard-staging:<sha>` |
| Cloud SQL | `solamax:asia-southeast2:solamax-pg` (db `solamax`) |
| Secrets (Secret Manager) | `solamax-dashboard-db-url-staging`, `solamax-auth-secret-staging`, `solamax-auth-google-secret-staging` |
| Plain env | `AUTH_TRUST_HOST`, `AUTH_GOOGLE_ID`, `SUPERADMIN_EMAILS`, `AUTH_URL` |
| Deploy SA | `gh-deploy-dashboard@solamax.iam.gserviceaccount.com` (WIF, no key) |
| Scaling | min 0 / max 2 · 512Mi · 1 vCPU |
