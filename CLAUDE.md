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
- **Auth+RBAC+multi-tenant (B1)** ✅ terbukti E2E lokal (2026-06-14) — Auth.js v5 + Google OAuth (invite-gated, sesi DB) + role `dashboard_app` (public SELECT-only, app RW). Desain: [`apps/dashboard/AUTH-RBAC-DESIGN.md`](apps/dashboard/AUTH-RBAC-DESIGN.md). **Scoping terpusat**: SETIAP query data per-unit menerima `ScopedUnitId` ber-brand dari `getDataScope()` (`src/lib/scope.ts` + aturan murni `unitVisible` di `src/lib/scope-rule.ts`) — lupa scope = error type-check. `/admin` (kelola membership) terkunci super_admin server-side. Uji akses-negatif (penegasan A) HIJAU: unit-test `scope.test.ts` + DB-live `scope.integration.test.ts` (SCOPE_LIVE_DB=1) + verifikasi Chrome (pengawas lintas-tenant → 404). **Belum deploy** (data EasyMax read-only; promosi nunggu instruksi). Catatan: API key staging & password DB sempat terekspos di chat — **rotasi sebelum produksi**.

Pekerjaan berfase dengan **approval gate** (Fase 0 → 1 → 2 → 3). Jangan lewati gate.

## Pre-production / pre-scale hardening (roadmap — JANGAN kerjakan tanpa instruksi eksplisit)

Auth+RBAC sudah deployable-candidate (scoping terpusat + CHECK role/status + CI-gate uji negatif). Sebelum produksi / onboarding tenant nyata, item berikut menunggu aba-aba:

1. **Postgres RLS backstop (lapis-DB)** — **HARD GATE sebelum tenant nyata ke-2.** Row-Level Security pada tabel data sebagai jaring kedua di bawah scoping aplikasi (defense-in-depth, bukan pengganti).
2. **Audit log** — catat grant/revoke `/admin` + (opsional) akses data.
3. **Bersihkan fixture** — hapus tenant/unit placeholder (`9990001` / "PT Placeholder") & finalkan role `ddsalam@solagas.com` (saat ini pengawas-placeholder untuk uji isolasi).
4. **Rotasi secret** — API key staging & password DB sempat terekspos di chat (lihat catatan Fase 2/B1).
5. **Deploy** — dashboard → Cloud Run staging (app-auth) + tambah redirect URI domain produksi ke OAuth client. **Gate terpisah, tunggu instruksi.**

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

Catatan: `packages/shared` harus di-`build` sebelum agent dijalankan dari `dist` (vitest sudah alias ke source). Driver MySQL agent wajib kompatibel **MySQL 5.0.67** (lihat `apps/agent/README.md`).
