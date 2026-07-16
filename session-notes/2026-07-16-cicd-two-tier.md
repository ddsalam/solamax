# Sesi 2026-07-16 — Restrukturisasi CI/CD: model promosi dua-tier

Arc berfase (audit → desain → eksekusi → evaluasi E2E), semua gate di-approve owner.
Rujukan operasional: [`DEPLOY.md`](../DEPLOY.md) (root repo).

## Apa yang berubah

Sebelum: push `staging` men-deploy dashboard LANGSUNG ke pilot live (satu klik approval);
`main` tidak men-deploy apa pun; backend 100% manual (proxy + `prisma migrate deploy` +
`gcloud run deploy --source .`) — pola yang sudah 3× nyaris/benar-benar terbakar
(migrate-after-serve, tabrakan 0012/0013, near-miss drift).

Sesudah:

| Trigger | App | Service Cloud Run | DB dimigrasi | Gate |
|---|---|---|---|---|
| push → `staging` | dashboard | `solamax-dashboard-rlsstg` | — | otomatis |
| push → `staging` | backend | `solamax-ingest-rlsstg` | `solamax-pg-rlsstg` (TEST) | otomatis |
| push → `main` | dashboard | `solamax-dashboard-staging` | — | Environment **`pilot`** |
| push → `main` | backend | `solamax-ingest-staging` | `solamax-pg` (**LIVE**) | Environment **`pilot`** |

Inti: backend **build → migrate → deploy** — migrasi lulus penuh SEBELUM traffic; gagal =
HALT (revisi lama tetap serve). Guard salah-target (+`forbid: rlsstg` di pilot) tanpa echo
secret; guard tabrakan nomor migrasi di CI (`scripts/ci/check-migrations.sh`); label
`rls-aware` diturunkan dari source; deploy image-only; auth WIF tanpa SA key.

## Rantai PR

- **#93** — workflow `deploy-dashboard.yml` + `deploy-backend.yml` + composite
  `prisma-migrate` + guard tabrakan + docs (DEPLOY.md, DEPLOY-GCP §8 → break-glass).
- **#94** — promosi pertama ke `main` (bukti gate `pilot`; migrate live = no-op 17/17).
- **#95** — smoke: migrasi `0018_cd_pipeline_smoke` (comment-only) + no-op dashboard.
- **#96** — promosi smoke: migrate-pilot **MENERAPKAN 0018 di DB live** sebelum traffic
  (apply 16:48:16 → migrate selesai 16:48:20 → deploy mulai 16:48:23); ledger 18/18 di
  KEDUA DB; idempoten (re-run dispatch = "No pending"); edc tetap 0 dup.
- **#97** — cleanup (point of no return): hapus `deploy-staging.yml`; environment
  `staging` dihapus pasca-merge.

## 9 mutasi infra

1. Ledger `solamax-pg-rlsstg`: `migrate resolve --applied` 0016+0017 (rehearsal RLS dulu
   apply DDL manual → drift ledger; tanpa DDL baru).
2. IAM `roles/cloudsql.client` → `gh-deploy-dashboard@` (project) *(oleh owner)*.
3. IAM `secretAccessor` per-secret `solamax-db-url-ingest-rlsstg` *(oleh owner)*.
4. GitHub Environment `pilot` dibuat: reviewer ddsalam, branch `main` saja.
5. GitHub Environment `testing` dikonfigurasi: tanpa reviewer, branch `staging` saja.
6. IAM `secretAccessor` per-secret `solamax-db-url-staging`.
7. WIF attribute-condition → `assertion.repository=='ddsalam/solamax' &&
   (assertion.ref=='refs/heads/staging' || assertion.ref=='refs/heads/main')`.
8. `deploy-staging.yml` **disable** (pasca insiden, lihat bawah) → **delete** (PR #97).
9. GitHub Environment `staging` **dihapus**.

Tanpa SA baru, tanpa key JSON, tanpa secret di log/commit.

## ⚠️ Insiden approval-refleks (pelajaran bernama)

Dialog pending-deployments GitHub **membatch gate dari environment BERBEDA dalam satu
layar**. Saat meng-approve gate `pilot` yang sah, dua run workflow lama (environment
`staging`) ikut ter-approve refleks → jalur lama men-deploy dashboard pilot dua kali:
revisi orphan **00051-crk** & **00053-ckg** (konten harmless — build docs/komentar saja,
tersusul deploy ber-gate). Mitigasi terlembaga: **disable workflow segera setelah
penggantinya terbukti, hapus formal belakangan** (disable = reversibel satu perintah;
klik refleks tidak) — dan baca kolom environment tiap baris sebelum approve.

## Residu (carry-forward)

- **Data DB test basi**: `solamax-pg-rlsstg` tak menerima sync agent; ledger-nya hanya
  maju lewat migrasi. Cukup utk uji pipeline; menyesatkan utk QA berbasis data.
- **Biaya rlsstg**: db-f1-micro + 2 service Cloud Run nyaris idle, jalan terus.
- **Pin versi proxy**: composite action pin cloud-sql-proxy v2.14.2 + sha256 — sesekali
  bump & re-checksum.
- **File lama inert di `main`**: `deploy-staging.yml` masih ada di `main` (disabled;
  trigger hanya push `staging`, file sudah absen di sana) sampai promosi berikutnya
  membawa penghapusannya.
- Nama SA `gh-deploy-dashboard@` historis (kini deploy kedua app); OAuth client dibagi
  dua tier (consent masih Testing); merge shared-path menjalankan `pnpm check` 3×
  (ci + kedua pipeline) — bisa dirapikan nanti.
