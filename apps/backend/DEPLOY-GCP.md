# DEPLOY — Backend `/ingest` ke GCP (STAGING-FIRST)

> **🚨 PROSEDUR MANUAL DI BAWAH = BREAK-GLASS SAJA (sejak 2026-07-16).** Backend kini
> ber-CD penuh: push ke `staging` → migrasi DB test + deploy `solamax-ingest-rlsstg`
> (otomatis); push ke `main` → gate Environment `pilot` → migrasi DB live **lulus dulu**
> → deploy `solamax-ingest-staging`. Lihat [`DEPLOY.md`](../../DEPLOY.md) (root repo) dan
> [`deploy-backend.yml`](../../.github/workflows/deploy-backend.yml). Prosedur manual
> hanya untuk darurat saat CD mati, **atas instruksi eksplisit user**, dan wajib dicatat
> di §8.

Langkah yang **Anda** jalankan dari Mac (perlu `gcloud` CLI ter-login). Semua nama memakai
sufiks **staging**; promosi ke produksi = keputusan terpisah, **hanya atas instruksi eksplisit**.

> **⚠️ RLS AKTIF (sejak 2026-07-07).** `solamax-pg` kini pakai unit-scoped Row-Level Security
> (`0016`, 26 tabel ENABLE+FORCE) + audit log (`0017`). Konsekuensi deploy: (a) **semua DDL/migrasi
> dijalankan sebagai role pemilik `ingest`** (bukan `postgres` — cloudsqlsuperuser non-owner tak bisa
> ALTER/DROP POLICY); (b) image ingest **wajib RLS-aware** (`set_config('app.unit_ids',…)` di
> `ingest.service.ts`, label `rls-aware=1`); (c) query verifikasi/admin **harus set `app.unit_ids`**
> atau balik 0 baris (fail-closed, FORCE meng-scope owner juga). Prosedur cutover penuh + rollback:
> [`RLS-CUTOVER-RUNBOOK.md`](RLS-CUTOVER-RUNBOOK.md).

> Region: `asia-southeast2` (Jakarta). Project: `solamax`.
> Secret (password DB, API key) tak pernah masuk git — hanya Secret Manager / file gitignored.

## 0. Prasyarat sekali jalan

```bash
gcloud config set project solamax
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 1. Cloud SQL Postgres (instance terkecil)

```bash
# --edition=enterprise WAJIB: default Enterprise Plus menolak tier shared-core murah.
gcloud sql instances create solamax-pg \
  --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro \
  --region=asia-southeast2 --storage-size=10GB --storage-auto-increase

gcloud sql databases create solamax --instance=solamax-pg

# Password kuat untuk user aplikasi (catat di password manager — JANGAN di git):
gcloud sql users create ingest --instance=solamax-pg --password='GANTI_PASSWORD_DB'
```

## 2. Migrasi skema + seed (dari Mac, via Cloud SQL Auth Proxy)

```bash
# Terminal 1 — proxy:
brew install cloud-sql-proxy   # sekali saja
cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432

# Terminal 2 — dari root repo:
cd apps/backend
cp .env.example .env   # lalu edit: DATABASE_URL="postgresql://ingest:GANTI_PASSWORD_DB@127.0.0.1:5432/solamax?schema=public"

pnpm prisma:deploy     # menjalankan prisma/migrations → 12 tabel
pnpm gen-api-key       # CATAT "API key" (utk agent) & lihat hash-nya
SEED_API_KEY='<API_key_plaintext_dari_atas>' pnpm seed
```

`seed` membuat unit `6478111` (Imam Bonjol) dengan `api_key_hash` dari key tadi + sample sales kecil.

## 3. Secret DATABASE_URL → Secret Manager

```bash
printf 'postgresql://ingest:GANTI_PASSWORD_DB@localhost/solamax?host=/cloudsql/solamax:asia-southeast2:solamax-pg&schema=public' | \
  gcloud secrets create solamax-db-url-staging --data-file=-

# Izinkan service account default Cloud Run membaca secret (tanpa ini deploy
# gagal "Permission denied on secret"). Nomor project: gcloud projects describe solamax.
gcloud secrets add-iam-policy-binding solamax-db-url-staging \
  --member="serviceAccount:113869564052-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Deploy Cloud Run (staging)

Dari **root repo** (Dockerfile root membangun workspace + shared):

```bash
gcloud run deploy solamax-ingest-staging \
  --source . \
  --region=asia-southeast2 \
  --add-cloudsql-instances=solamax:asia-southeast2:solamax-pg \
  --set-secrets=DATABASE_URL=solamax-db-url-staging:latest \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=2 --memory=512Mi

# `--allow-unauthenticated` aman: /ingest tetap menolak tanpa API key valid (401).
```

Cek sehat — `xxxxx` adalah placeholder; pakai **URL asli** dari baris `Service URL:` di
output deploy, atau:

```bash
URL=$(gcloud run services describe solamax-ingest-staging --region=asia-southeast2 --format='value(status.url)')
curl "$URL/health"   # → {"ok":true}  (BUKAN /healthz — path itu dicegat Google Frontend di run.app)
```

## 5. SATU sync nyata end-to-end (agent → backend → Cloud SQL)

Di **mesin SPBU** (bundle yang sudah ada), edit `config.local.json`:

```jsonc
"backend": {
  "baseUrl": "https://solamax-ingest-staging-xxxxx.run.app",  // URL dari langkah 4
  "apiKey": "<API_key_plaintext_dari_langkah_2>",
  "requestTimeoutMs": 60000
}
```

> Bundle perlu di-rebuild dulu di Mac (`pnpm --filter @solamax/agent bundle`) karena ada
> perbaikan watermark/chunking pasca smoke-test — salin ulang `solamax-agent.cjs` saja.
> Lalu di mesin SPBU jalankan **`3-sync-once.bat`** (ada di bundle baru) atau:
> `node solamax-agent.cjs --once --config config.local.json`

Run pertama = **backfill penuh** (~169 batch sales × 1000; beberapa menit). Watermark
maju per batch hanya setelah backend konfirmasi — aman diputus & dilanjutkan.

## 6. Verifikasi baris mendarat (psql via proxy, read-only)

```sql
-- Jumlah per tabel (bandingkan: sales_detail ≈ 169k; cash_detail = 2942;
-- product 8, nozzle 46, tangki 7, account 181):
SELECT 'sales_detail' t, count(*) FROM sales_detail
UNION ALL SELECT 'sales_header', count(*) FROM sales_header
UNION ALL SELECT 'cash_header',  count(*) FROM cash_header
UNION ALL SELECT 'cash_detail',  count(*) FROM cash_detail
UNION ALL SELECT 'opname',       count(*) FROM opname
UNION ALL SELECT 'delivery',     count(*) FROM delivery
UNION ALL SELECT 'product',      count(*) FROM product
UNION ALL SELECT 'nozzle',       count(*) FROM nozzle
UNION ALL SELECT 'tangki',       count(*) FROM tangki
UNION ALL SELECT 'account',      count(*) FROM account;

-- Watermark per domain (sales harus ≈ NOW WIB − beberapa menit):
SELECT * FROM sync_state ORDER BY domain;

-- Sanity penjualan terbaru (volume × harga = subtotal):
SELECT ckdjualbbm, ckdnozzle, nvolume, nhargajual, nsubtotal, dtgljam
FROM sales_detail ORDER BY dtgljam DESC LIMIT 10;

-- Idempotensi: jalankan agent --once SEKALI LAGI → count TIDAK berubah.
```

## 7. Rollback / bersih-bersih staging

```bash
gcloud run services delete solamax-ingest-staging --region=asia-southeast2
gcloud sql instances delete solamax-pg   # HATI-HATI: menghapus data
```

## 8. Deploy manual = BREAK-GLASS — riwayat out-of-band

Backend **sudah ber-CD** sejak 2026-07-16 (lihat banner di atas + [`DEPLOY.md`](../../DEPLOY.md)).
Deploy manual (langkah 2 migrasi + langkah 4 image, di atas) hanya untuk darurat saat
pipeline mati, **hanya atas instruksi eksplisit user**, dan **wajib dicatat di bagian
ini** setelah kejadian. Ingat urutan yang ditegakkan CD dan berlaku juga saat manual:
**migrasi lulus penuh dulu, baru image serve traffic**; migrasi sebagai role `ingest`;
verifikasi target instance sebelum `migrate deploy` (jangan sampai menyasar DB test/live
yang salah).

**Riwayat out-of-band:**

- **2026-06-28 — hotfix idempotensi EDC (PR #23).** EDC ter-ingest ganda saat dua
  `/ingest` REPLACE bersamaan (retry agent menimpa request yang masih commit).
  Migrasi `0012_edc_natural_key` (dedup + index unik `NULLS NOT DISTINCT`)
  di-apply manual via role `ingest`, lalu image di-deploy `gcloud run deploy
  --source .` → revisi `solamax-ingest-staging-00016-zdt`. Urutan: **migrasi dulu**
  (ON CONFLICT butuh index sebagai arbiter). No-drift terverifikasi: tree sumber
  build == `origin/staging`. Pengecualian SATU KALI karena mendesak.

**Tindak lanjut disarankan:** tutup celah ini dengan job CD backend yang mencerminkan
pola dashboard (Environment `staging` terproteksi + required reviewer), agar deploy
backend berikutnya lewat pipeline ber-approval, bukan manual.

- **2026-08-07 — fix artefak floating-point numeric (PR #193 → promosi #194).** CD backend
  pilot gagal **empat kali berturut-turut**, semuanya di sisi GitHub/Google dan **tak satu pun
  menyentuh kode**: (1) `Failed to resolve action download info` — `Service Unavailable` lalu
  `Internal Server Error`, gagal sebelum `prisma-migrate` sempat jalan; (2) tukar token WIF
  `Unable to retrieve Identity Pool subject token … reset reason: overflow`, `gcloud run deploy`
  tak pernah dieksekusi; (3) & (4) job `deploy-pilot` **tidak pernah mendapat runner** — cancelled
  tepat pada 15:01 menit dengan `runner_name` kosong (`cancel-in-progress: false`, jadi bukan
  concurrency).

  **Urutan runbook TETAP terpenuhi**: `migrate-pilot` sudah **sukses lewat CD** pada percobaan
  ke-2 (migrasi lulus sebelum image serve; nol migrasi baru pada promosi ini).

  **Image yang dipakai = artefak `build` CD, BUKAN build lokal** —
  `…/solamax-ingest-staging@sha256:99deed0ca21ba33a4a5a6414b7624b5aca977967726990730e0bb44151961235`,
  ber-tag `06c8475f64e3dd85c5959f843d19d847bdb9cb4e` (HEAD `main`). Jadi tak ada risiko drift
  sumber: yang di-deploy manual persis artefak yang akan di-deploy pipeline.

  **Dieksekusi oleh owner (ddsalam)** dari mesinnya, atas instruksi eksplisit; agen berhenti di
  batas izin (lihat catatan batas operasional di bawah). Perintahnya `gcloud run deploy` image-only
  + `--update-labels rls-aware=1`, lalu `update-traffic --to-latest`.

  **Temuan yang lebih besar dari deploy-nya sendiri:** service ini traffic-nya **dipatok**
  (`revisionName: solamax-ingest-staging-00031-tk9`) — sisa rollback yang tak pernah dilepas.
  Selama pin terpasang, `gcloud run deploy` membuat revisi baru **tanpa memindahkan traffic**,
  exit code 0, sambil mencetak baris yang menyebut revisi **lama** "is serving 100 percent of
  traffic". Akibatnya promosi PR #188 (6 Agu 17:57 WIB) tampak hijau tapi **tidak pernah
  mendarat**; pilot menyajikan image PR #183 (5 Agu) selama ~30 jam. Kontrol pembeda:
  `solamax-dashboard-staging` memakai `latestRevision: True` dan sehat.

  **Urutan sengaja dibalik dari instruksi awal** (deploy dulu, baru lepas pin): saat itu revisi
  terbaru adalah `-00032-mcl` (image #188), sehingga `--to-latest` lebih dulu akan memindahkan
  traffic ke revisi yang tak dipilih siapa pun — berisiko tertinggal di sana kalau deploy gagal
  untuk kelima kalinya. Hasilnya traffic melompat langsung `-00031-tk9` → `-00033-zv9`;
  `-00032-mcl` tak pernah menyajikan satu request pun.

  **Verifikasi akhir dari state, bukan dari pesan gcloud**: `spec.traffic` = `latestRevision: true`;
  `status.traffic[0].revisionName` = `solamax-ingest-staging-00033-zv9`; digest revisi yang serve
  = `sha256:99deed0c…`; label `rls-aware=1` terjaga; `serving.knative.dev/route` pindah ke revisi
  baru. Bukti fungsional di data: produksi artefak baru pada `sales_detail` jatuh dari 259 baris
  (jendela 23:45) ke **0** (jendela 00:00) sementara 1.056 baris tetap ditulis pada jendela yang
  sama — kontrol yang memisahkan "nol artefak" dari "nol data".

  **Tindak lanjut:** (a) aturan `--to-latest` setelah rollback sudah ditambahkan ke
  [`DEPLOY.md`](../../DEPLOY.md) dan [`GO-LIVE-RUNBOOK.md`](../../GO-LIVE-RUNBOOK.md);
  (b) guard CD yang membandingkan **nama revisi** (bukan exit code) sedang disiapkan sebagai PR
  terpisah ke `staging`.
