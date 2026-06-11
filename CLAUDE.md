# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SolaMax** — pipeline yang menarik data POS **EasyMax** (MySQL lokal di komputer server SPBU SolaGroup) secara berkala dan menampilkannya di web dashboard pengawasan kepatuhan input pengawas, lintas SPBU, real-time. Pilot 1 unit (Imam Bonjol, kode `6478111`); **arsitektur wajib siap replikasi ke 7 SPBU** (agent identik, beda API key + config).

Alur: **EasyMax MySQL (read-only) → sync agent → Cloud Run `/ingest` → Cloud SQL Postgres → Next.js dashboard.** GCP project: `solamax`.

## Status repo

- **Fase 0** ✅ selesai & terverifikasi (skema TERKUNCI by data, 2026-06-11):
  - [`ARCHITECTURE.md`](ARCHITECTURE.md) — diagram alur, skema Postgres, kontrak `/ingest`, strategi watermark, temuan terkunci (§0). **Baca ini sebelum kerja apa pun.**
  - [`VERIFICATION-QUERIES.sql`](VERIFICATION-QUERIES.sql) — query read-only yang sudah dijalankan untuk mengunci skema.
- **Fase 1** 🔨 sync agent terbangun di [`apps/agent`](apps/agent) — **menunggu smoke-test di mesin SPBU + approval** (gate). Checklist: [`apps/agent/README.md`](apps/agent/README.md).
- **Fase 2** (backend `/ingest`) & **Fase 3** (dashboard) — belum, menunggu gate.

Pekerjaan berfase dengan **approval gate** (Fase 0 → 1 → 2 → 3). Jangan lewati gate.

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
```

Catatan: `packages/shared` harus di-`build` sebelum agent dijalankan dari `dist` (vitest sudah alias ke source). Driver MySQL agent wajib kompatibel **MySQL 5.0.67** (lihat `apps/agent/README.md`).
