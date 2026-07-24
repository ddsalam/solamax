# DEPLOY — model promosi dua-tier SolaMax

Sejak 2026-07-16 kedua app (dashboard + backend) ber-CD penuh via GitHub Actions.
**Deploy manual = break-glass saja** (lihat [`apps/backend/DEPLOY-GCP.md`](apps/backend/DEPLOY-GCP.md) §8).

## ⚠️ Jebakan nama (baca dulu)

- Service bersufiks **`-staging`** = **PILOT LIVE** (staging = prod pilot sampai tenant #2).
- Service bersufiks **`-rlsstg`** = **tier TESTING** (bekas rehearsal RLS, di-repurpose).

## ⚠️ Login `-rlsstg` (& `-staging`) — hanya lewat host `AUTH_URL`

Cloud Run mengekspos **dua** hostname untuk service yang sama
(`…-<hash>-<region>.a.run.app` **dan** `…-<projnum>.<region>.run.app`). Cookie
PKCE Auth.js bersifat **host-only**; login yang dimulai di host ≠ `AUTH_URL`
memutus callback → `InvalidCheck: pkceCodeVerifier … could not be parsed` →
`/api/auth/error?error=Configuration` (500). Ini **bukan** cacat kode/DB
(adapter & grant skema `app` terbukti sehat) — murni pemakaian.

**Aturan:** buka `-rlsstg` HANYA lewat host `AUTH_URL`-nya
(`https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app`),
**bukan** varian `…-wn6i64kvza-et.a.run.app`. Sama untuk pilot (`-staging`):
pakai `…-staging-113869564052…`. Bila terlanjur gagal, bersihkan cookie situs
lalu ulangi di host kanonik. (Ditemukan Gate 4b/5, 2026-07-25.)

## Alur promosi

| Trigger | App | Service Cloud Run | DB yang dimigrasi | Gate |
|---|---|---|---|---|
| push → `staging` | dashboard | `solamax-dashboard-rlsstg` | — | otomatis |
| push → `staging` | backend | `solamax-ingest-rlsstg` | `solamax-pg-rlsstg` (TEST) | otomatis |
| push → `main` | dashboard | `solamax-dashboard-staging` | — | Environment **`pilot`** (approval) |
| push → `main` | backend | `solamax-ingest-staging` | `solamax-pg` (**LIVE**) | Environment **`pilot`** (approval) |

Workflow: [`deploy-dashboard.yml`](.github/workflows/deploy-dashboard.yml) ·
[`deploy-backend.yml`](.github/workflows/deploy-backend.yml) ·
migrasi via composite action [`prisma-migrate`](.github/actions/prisma-migrate/action.yml).

## Cara promosi (rutinitas normal)

1. PR fitur → **`staging`** (CI + guard migrasi wajib hijau). Merge ⇒ tier testing
   ter-deploy otomatis; untuk backend, DB test dimigrasi **dulu**, baru image serve.
   Ini gladi resik yang melindungi DB live.
2. Puas dengan hasil di rlsstg → PR **`staging` → `main`**. Merge ⇒ pipeline pilot
   jalan sampai gate `pilot`, lalu **berhenti menunggu approval**.
3. Klik approve (reviewer: ddsalam). Backend: `prisma migrate deploy` ke DB live harus
   **lulus penuh sebelum** revisi baru menerima traffic. Dashboard: deploy image-only.

## Kalau migrasi gagal (halt-semantics)

Pipeline **berhenti**; job deploy tidak pernah jalan; revisi lama tetap melayani; tidak
ada auto-rollback. Perbaiki migrasinya lewat PR baru — `prisma migrate deploy` idempoten,
run berikutnya melanjutkan dari migrasi yang belum ter-apply.

## Aturan yang ditegakkan secara struktural

- **Migrate sebelum serve** — job `deploy` `needs: migrate`; tidak bisa dibalik.
- **Tier testing tak bisa menyentuh DB live** — guard di composite action menolak
  `DATABASE_URL` yang tidak menunjuk instance yang diharapkan (pilot juga menolak
  URL rlsstg via `forbid`); nilai secret tidak pernah di-echo ke log.
- **Tabrakan nomor migrasi mati di CI** — `scripts/ci/check-migrations.sh` (duplikat +
  out-of-order; PR dicek pada merge-preview). Konvensi: **rebase ke `staging`** sebelum
  menambah migrasi.
- **Label `rls-aware` diturunkan dari source** oleh CD (dashboard: `src/lib/db.ts`;
  backend: `src/ingest/ingest.service.ts`), tidak pernah di-set manual.
- **Deploy image-only** — env/secrets/cloudsql/scaling service tidak disentuh pipeline.
- **Auth WIF** (tanpa SA key); SA deploy `gh-deploy-dashboard@…` (nama historis —
  kini men-deploy kedua app).

## Break-glass (darurat saja)

Prosedur manual lama tetap terdokumentasi di
[`apps/backend/DEPLOY-GCP.md`](apps/backend/DEPLOY-GCP.md) — hanya untuk kondisi CD
mati/darurat, **atas instruksi eksplisit user**, dan wajib dicatat di §8 (riwayat
out-of-band).
