# Rehearsal-Driven Change LEDGER

Every change the real-GCP dress rehearsal forced. This ledger + the validated runbook go to a
FINAL independent re-check before the live cutover. No script change is silently accepted.

| # | Change | Why (real-infra trigger) | Files | Re-verified |
|---|---|---|---|---|
| B1 | `ALTER ROLE` re-assert sets **password only** (not NOSUPERUSER/NOBYPASSRLS); attrs set at CREATE + fail-closed guard DO block | Cloud SQL admin is `cloudsqlsuperuser`, not a true superuser → `ALTER … NOSUPERUSER` errors "permission denied to alter role". Local Docker true-superuser masked it. | `apps/backend/scripts/roles-provision.sql` | Re-ran on `solamax-pg-rlsstg` → both roles `super=f bypass=f`, grants applied ✅ |
| L2 | *(reserved — label-scope resolution, Phase C2)* | | | |
| pre | Label-wiring: derived `--update-labels rls-aware` from source marker (CD trust anchor) | GATE A (F1) — automatic, tamper-resistant, not hand-set | `.github/workflows/deploy-staging.yml` | Phase C2/C3 on real Cloud Run |

## WATCH items (from B1)
- **FORCE RLS + Cloud SQL owner**: `postgres` is not a true superuser, so post-`0016` the table
  owner is ALSO scoped. Ground truth captured pre-0016. Any post-0016 op needing all rows
  (migrations DDL = fine; verification = read pre-0016 or temporary RLS-disable). Confirm in C4.
