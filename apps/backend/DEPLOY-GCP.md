# DEPLOY — Backend `/ingest` ke GCP (STAGING-FIRST)

Langkah yang **Anda** jalankan dari Mac (perlu `gcloud` CLI ter-login). Semua nama memakai
sufiks **staging**; promosi ke produksi = keputusan terpisah, **hanya atas instruksi eksplisit**.

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

## 8. Catatan: backend BELUM ber-CD — deploy manual = pengecualian, butuh approval

Backend `/ingest` **tidak** punya job CD. `deploy-staging.yml` hanya membangun &
men-deploy **dashboard** (`solamax-dashboard-staging`) di belakang GitHub
Environment terproteksi `staging` (required reviewer). Backend di-deploy **manual**
(langkah 2 migrasi + langkah 4 image, di atas) dan **hanya atas instruksi eksplisit
user** — tak ada gerbang approval otomatis seperti dashboard.

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
