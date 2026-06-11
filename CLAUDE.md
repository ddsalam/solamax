# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SolaMax** — pipeline yang menarik data POS **EasyMax** (MySQL lokal di komputer server SPBU SolaGroup) secara berkala dan menampilkannya di web dashboard pengawasan kepatuhan input pengawas, lintas SPBU, real-time. Pilot 1 unit (Imam Bonjol, kode `6478111`); **arsitektur wajib siap replikasi ke 7 SPBU** (agent identik, beda API key + config).

Alur: **EasyMax MySQL (read-only) → sync agent → Cloud Run `/ingest` → Cloud SQL Postgres → Next.js dashboard.** GCP project: `solamax`.

## Status repo

Pra-implementasi. Belum ada kode aplikasi — hanya dokumen rancangan Fase 0:
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — diagram alur, skema Postgres tujuan, kontrak API `/ingest`, strategi watermark. **Baca ini sebelum kerja apa pun.**
- [`VERIFICATION-QUERIES.sql`](VERIFICATION-QUERIES.sql) — query read-only yang dijalankan user di DB live untuk mengunci skema.

Pekerjaan berfase dengan **approval gate** (Fase 0 rancangan → Fase 1 agent → Fase 2 backend → Fase 3 dashboard). Jangan lewati gate. Keputusan skema bertanda 🏷️ **PROVISIONAL** di `ARCHITECTURE.md` bergantung pada hasil query verifikasi (Q-ID) dan belum dikunci.

## 🔒 Aturan tak bisa dinegosiasi

1. **Koneksi MySQL EasyMax HARUS read-only.** DB `easymax` dipakai pompa beroperasi. Gunakan user MySQL ber-privilege `SELECT` saja. Kode agent **tidak boleh** pernah eksekusi `INSERT`/`UPDATE`/`DELETE`/DDL ke `easymax`. Tegakkan di level kode (whitelist: hanya `SELECT`) + dokumentasikan cara buat user `SELECT`-only.
2. **Deploy staging-first.** Jangan buka PR langsung ke `main`. Lewati staging dulu; promosi ke produksi hanya atas instruksi eksplisit user.
3. **Semua secret di file yang di-`.gitignore`.** Tidak pernah ada kredensial (DB password, API key) di git — via env / config file lokal. Jangan commit `.env`.

## Cara kerja

Investigation-first: jangan menebak skema, kunci hipotesis dengan bukti (query verifikasi), hormati tiap approval gate, dan **jangan deploy/push tanpa instruksi user**. Sumber kebenaran skema EasyMax: `ARCHITECTURE.md` + wiki recon di `~/Repo/Obsidian-Vault/wikis/spbu-sola/`.

## Stack rencana (belum di-scaffold)

Monorepo (pnpm workspaces): `apps/agent` (Node.js/TS sync agent), `apps/backend` (NestJS + Prisma, endpoint `/ingest`), `apps/dashboard` (Next.js), `packages/shared` (tipe domain + validasi payload). DB Postgres via Prisma. Commands build/lint/test ditambah ke file ini saat tiap app dibuat.
