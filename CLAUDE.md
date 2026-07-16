# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SolaMax** — pipeline yang menarik data POS **EasyMax** (MySQL lokal di komputer server SPBU SolaGroup) secara berkala dan menampilkannya di web dashboard pengawasan kepatuhan input pengawas, lintas SPBU, real-time. Pilot 1 unit (Imam Bonjol, kode `6478111`); **arsitektur wajib siap replikasi ke 7 SPBU** (agent identik, beda API key + config).

Alur: **EasyMax MySQL (read-only) → sync agent → Cloud Run `/ingest` → Cloud SQL Postgres → Next.js dashboard.** GCP project: `solamax`.

## Status repo

- **Fase 0** ✅ selesai & terverifikasi (skema TERKUNCI by data, 2026-06-11):
  - [`ARCHITECTURE.md`](ARCHITECTURE.md) — diagram alur, skema Postgres, kontrak `/ingest`, strategi watermark, temuan terkunci (§0). **Baca ini sebelum kerja apa pun.**
  - [`VERIFICATION-QUERIES.sql`](VERIFICATION-QUERIES.sql) — query read-only yang sudah dijalankan untuk mengunci skema.
- **Fase 1** ✅ sync agent di [`apps/agent`](apps/agent) — approved; smoke-test mesin SPBU **LULUS** (MySQL 5.0.67 via mysql2, TZ WIB ✓, semua domain+masters tertarik). Bundle Windows: `pnpm --filter @solamax/agent bundle` + [`apps/agent/RUNBOOK-SPBU.md`](apps/agent/RUNBOOK-SPBU.md).
- **Fase 2** ✅ backend `/ingest` (NestJS + Prisma) **terbukti E2E di staging** (2026-06-12): Cloud Run `solamax-ingest-staging` + Cloud SQL `solamax-pg` (asia-southeast2); backfill penuh dari mesin SPBU — sales_detail 168.988, opname 28.994, delivery 8.134, cash 2.941/2.942, masters 8/46/7/181; idempoten & watermark benar. Runbook: [`apps/backend/DEPLOY-GCP.md`](apps/backend/DEPLOY-GCP.md). Catatan: API key staging & password DB sempat terekspos di sesi chat — **rotasi sebelum produksi**.
- **Fase 3** ✅ dashboard di [`apps/dashboard`](apps/dashboard) — dibangun ulang **pixel-faithful dari SolaMax Design Spec** (bundle `apps/dashboard/design/`, SolaGroup DS token + adherence lint 0 warning). Read-only `pg` SELECT murni; halaman: Hub `/`, `/board` (verdict/KPI/bauran-vs-target-workbook/ranking/anomali), Laporan Operasional, Rincian Penjualan (cetak), Monitoring (jaringan/denah/heatmap/anomali). Domain 4–7 = empty state eksplisit; config bisnis (target workbook 2026, unit display, kapasitas tangki) di `src/lib/config.ts`. **Gate aktif: review tampilan oleh user** (`apps/dashboard/README.md`).
- **Auth+RBAC+multi-tenant (B1)** ✅ **DEPLOYED live ke Cloud Run staging (2026-06-15)** — `solamax-dashboard-staging` (asia-southeast2), URL `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app`. Auth.js v5 + Google OAuth (invite-gated, sesi DB) + role `dashboard_app` (public SELECT-only, app RW). Desain: [`apps/dashboard/AUTH-RBAC-DESIGN.md`](apps/dashboard/AUTH-RBAC-DESIGN.md). **Scoping terpusat**: SETIAP query data per-unit menerima `ScopedUnitId` ber-brand dari `getDataScope()` (`src/lib/scope.ts` + aturan murni `unitVisible` di `src/lib/scope-rule.ts`) — lupa scope = error type-check. `/admin` (kelola membership) terkunci super_admin server-side. Uji akses-negatif (penegasan A) HIJAU: unit-test `scope.test.ts` (CI tiap commit via `pnpm check`) + DB-live `scope.integration.test.ts` fixture-free (SCOPE_LIVE_DB=1) + verifikasi Chrome prod (pengawas lintas-tenant → 404). Image via [`apps/dashboard/Dockerfile`](apps/dashboard/Dockerfile) + `cloudbuild.yaml`; secret (DATABASE_URL dashboard_app socket, AUTH_SECRET, AUTH_GOOGLE_SECRET) di **Secret Manager**, env (AUTH_GOOGLE_ID/AUTH_URL/SUPERADMIN_EMAILS) biasa. **Secret yang sempat terekspos sudah DIROTASI** (dashboard_app pw + AUTH_GOOGLE_SECRET; ingest/readonly_sync/API key dirotasi di B3). OAuth consent masih **Testing** (4 test user). Data EasyMax read-only.

- **RLS backstop (lapis-DB, hard gate tenant ke-2)** ✅ **LIVE di IB (2026-07-07)** — `0016_rls_unit_scope` di `solamax-pg`: **26 tabel unit-scoped RLS (ENABLE+FORCE)**, policy `unit_scope` baca GUC `app.unit_ids` (di-set `qScoped()` dashboard + `set_config` ingest). Backend `solamax-ingest-staging-00024-fzr` + dashboard `solamax-dashboard-staging-00036-v4w` keduanya **`rls-aware=1` @100%**; instance di-bump ke **db-g1-small** (max_connections=50). `0017_audit_log` (append-only) live. Terverifikasi: fail-closed (no-context=0 baris), cross-unit write ditolak WITH CHECK, **14/14 domain ingest menulis di bawah RLS**, 0 error 4xx/5xx. DDL dijalankan sebagai role pemilik `ingest`. Runbook [`apps/backend/RLS-CUTOVER-RUNBOOK.md`](apps/backend/RLS-CUTOVER-RUNBOOK.md); ledger `session-notes/rls-rehearsal/LEDGER.md`. Rollback instan `apps/backend/scripts/rls-rollback.sql` (as ingest) tersedia bila perlu.

- **CI/CD dua-tier (2026-07-16)** ✅ — kedua app ber-CD ([`DEPLOY.md`](DEPLOY.md)): push `staging` → tier **testing** `-rlsstg` (otomatis; backend migrasi DB test `solamax-pg-rlsstg` **sebelum** serve) · push `main` → **pilot live** `-staging` (gated GitHub Environment `pilot`, reviewer ddsalam; backend `prisma migrate deploy` ke DB live lulus penuh **sebelum** traffic). Migrasi gagal = pipeline HALT (revisi lama tetap serve). Guard salah-target di [`prisma-migrate`](.github/actions/prisma-migrate/action.yml); guard tabrakan nomor migrasi di CI (`scripts/ci/check-migrations.sh` — rebase ke `staging` sebelum menambah migrasi). **Deploy manual = break-glass** ([`apps/backend/DEPLOY-GCP.md`](apps/backend/DEPLOY-GCP.md) §8). Jebakan nama tetap: `-staging` = pilot LIVE, `-rlsstg` = testing.

Pekerjaan berfase dengan **approval gate** (Fase 0 → 1 → 2 → 3). Jangan lewati gate.

## Pre-production / pre-scale hardening (roadmap — JANGAN kerjakan tanpa instruksi eksplisit)

Dashboard app-auth sudah live di staging (pilot). Yang **sudah** beres: deploy, bersih fixture placeholder dari prod, rotasi semua secret yang bocor. Sisa item menunggu aba-aba:

1. **Postgres RLS backstop (lapis-DB)** — ✅ **SATISFIED — live di IB 2026-07-07.** Unit-scoped RLS (`0016_rls_unit_scope`) live di `solamax-pg`: 26 tabel ENABLE+FORCE, jaring kedua di bawah scoping aplikasi (defense-in-depth). **HARD GATE sebelum tenant nyata ke-2 → TERPENUHI.** Detail lihat status di atas + runbook/ledger.
2. **Audit log** — ✅ **tabel live** (`0017_audit_log`, append-only: `dashboard_app` INSERT/SELECT, UPDATE/DELETE di-REVOKE; non-unit-scoped = visibilitas global). App menulis pada grant/revoke `/admin` (`admin-actions.ts`). Logging akses-data (opsional) = belum.
3. **OAuth consent → Publish / tambah test user** saat board dipakai lebih luas (scope dasar tak butuh verifikasi Google). Gate terpisah.
4. **Promosi produksi** — domain produksi + redirect URI-nya ke OAuth client. Gate terpisah.

## 🔒 Aturan tak bisa dinegosiasi

1. **Koneksi MySQL EasyMax HARUS read-only.** DB `easymax` dipakai pompa beroperasi. Gunakan user MySQL ber-privilege `SELECT` saja. Kode agent **tidak boleh** pernah eksekusi `INSERT`/`UPDATE`/`DELETE`/DDL ke `easymax`. Tegakkan di level kode (whitelist: hanya `SELECT`) + dokumentasikan cara buat user `SELECT`-only.
2. **Deploy staging-first.** Jangan buka PR langsung ke `main`. Lewati staging dulu; promosi ke produksi hanya atas instruksi eksplisit user.
3. **Semua secret di file yang di-`.gitignore`.** Tidak pernah ada kredensial (DB password, API key) di git — via env / config file lokal. Jangan commit `.env`.

## Cara kerja

Investigation-first: jangan menebak skema, kunci hipotesis dengan bukti (query verifikasi), hormati tiap approval gate, dan **jangan deploy/push tanpa instruksi user**. Sumber kebenaran skema EasyMax: `ARCHITECTURE.md` + wiki recon di `~/Repo/Obsidian-Vault/wikis/spbu-sola/`.

## Stack & monorepo

Monorepo pnpm workspaces. Sudah ada: `packages/shared` (tipe domain + skema validasi payload zod, dipakai agent & backend), `apps/agent` (sync agent Node.js/TS). Menyusul: `apps/backend` (NestJS + Prisma, `/ingest`), `apps/dashboard` (Next.js). DB Postgres via Prisma.

### Commands

```bash
pnpm install                                  # dari root
pnpm -r build                                 # build semua paket (shared dulu)
pnpm -r test                                  # semua test (vitest, berbasis mock)
pnpm --filter @solamax/agent typecheck        # typecheck agent
pnpm --filter @solamax/agent test             # test agent saja
pnpm --filter @solamax/agent test-connection  # tes koneksi read-only MySQL (mesin SPBU)
pnpm --filter @solamax/agent dry-run          # tarik & cetak payload TANPA kirim
pnpm --filter @solamax/agent bundle           # bundle deploy Windows → apps/agent/bundle-out/
pnpm --filter @solamax/dashboard dev          # dashboard lokal :3000 (butuh cloud-sql-proxy + .env.local)
```

Catatan: `packages/shared` harus di-`build` sebelum agent dijalankan dari `dist` (vitest sudah alias ke source). Di worktree/clone segar, backend juga butuh Prisma client di-generate dulu (`cd apps/backend && pnpm exec prisma generate`) sebelum `pnpm check` lulus. Driver MySQL agent wajib kompatibel **MySQL 5.0.67** (lihat `apps/agent/README.md`).
