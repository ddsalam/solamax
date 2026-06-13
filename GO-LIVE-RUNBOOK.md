# SolaMax — GO-LIVE RUNBOOK (pilot Imam Bonjol 6478111)

> **Status: RENCANA — belum dieksekusi.** Dokumen ini menyusun langkah go-live agar
> tiap butir punya prasyarat, langkah (dengan penanggung jawab), verifikasi, dan rollback.
> **Tidak ada perintah di sini yang dijalankan sampai Anda memberi aba-aba per butir.**
>
> Penanggung jawab: **☁️ Cloud** = Claude (dari Mac, `gcloud`/deploy) · **🖥️ SPBU** = Anda
> (mesin server SPBU via Chrome Remote Desktop). Aturan tetap: read-only ke data EasyMax;
> tak ada push/deploy/rotasi tanpa instruksi eksplisit.

State saat ini (akhir fase pilot):
- Cloud Run **`solamax-ingest-staging`** (asia-southeast2) ✔ hidup, E2E terbukti.
- Cloud SQL **`solamax-pg`** (asia-southeast2, db `solamax`, user `ingest`) ✔ terisi backfill.
- Secret **`solamax-db-url-staging`** ✔. Agent di SPBU jalan **manual `--once`** (belum terjadwal).
- Dashboard **belum di-deploy** (baru lokal via cloud-sql-proxy).
- ⚠️ Utang keamanan: API key agent & password DB **sempat terekspos di sesi chat** → rotasi
  wajib sebelum dianggap produksi.

---

## Urutan & dependensi (ringkas)

```
B3 Rotasi kredensial ──► B4 Penjadwalan agent (pakai key baru)
      │                        │
      │                        ▼  (sync kontinu → opname penutup harian masuk →
      │                            tanggal "provisional" jadi final)
      ▼
B2 Auth dashboard ──► B1 Deploy dashboard staging ──► B5 Promosi produksi + rollback
   (keputusan Anda)     (☁️, butuh user DB read-only)     (gate terakhir)
```

**Kenapa urutan ini:**
1. **B3 Rotasi dulu** — semua langkah lain harus memakai kredensial bersih; percuma deploy/
   jadwalkan lalu rotasi lagi.
2. **B4 Penjadwalan agent** segera setelah rotasi (agent pakai key baru) — ini juga yang
   membuat data mengalir kontinu, syarat agar dashboard produksi tidak penuh "provisional".
3. **B2 keputusan auth** diperlukan **sebelum** B1 deploy (cara deploy berbeda per opsi auth).
4. **B1 Deploy dashboard** butuh **user DB read-only** (dibuat saat B3).
5. **B5 Promosi** = gate terakhir setelah B1–B4 terverifikasi di staging.

> Anda boleh menjalankan B3+B4 (mengamankan + mengaktifkan pipeline) lebih dulu, lalu menata
> B2→B1→B5 (dashboard) terpisah. Keduanya hanya bertemu di B5.

---

## B3 · Rotasi API key agent + password DB  ☁️+🖥️

Memutar kredensial yang sempat terekspos. Dilakukan **sebelum** produksi.

**Prasyarat**
- `gcloud` ter-login, project `solamax` (☁️).
- Akses Remote Desktop ke mesin SPBU + lokasi `config.local.json` agent (🖥️).
- Jendela pemeliharaan singkat (agent boleh tertinggal beberapa menit; buffer lokal menahan).

**Langkah**
1. ☁️ **Generate API key unit baru** (plaintext + hash):
   `pnpm --filter @solamax/backend gen-api-key` → catat **API key** (utk agent) & **hash** (utk DB).
2. ☁️ **Pasang hash baru di DB** (lewat cloud-sql-proxy + psql, satu UPDATE — ini satu-satunya
   tulis yang disengaja, ke tabel kontrol `unit`, bukan data EasyMax):
   `UPDATE unit SET api_key_hash='<hash-baru>' WHERE code='6478111';`
3. ☁️ **Putar password DB** user `ingest`:
   `gcloud sql users set-password ingest --instance=solamax-pg --password='<pw-baru>'`
4. ☁️ **Perbarui Secret Manager** (versi baru DATABASE_URL dgn pw baru):
   `printf '<DATABASE_URL pw-baru>' | gcloud secrets versions add solamax-db-url-staging --data-file=-`
   lalu redeploy/restart Cloud Run agar mengambil versi terbaru
   (`gcloud run services update solamax-ingest-staging --region=asia-southeast2 --update-secrets=DATABASE_URL=solamax-db-url-staging:latest`).
5. 🖥️ **Update config agent di mesin SPBU**: buka `config.local.json`, ganti `backend.apiKey`
   = **API key baru**; simpan. (Password MySQL `readonly_sync` TIDAK termasuk di sini — itu lokal
   SPBU dan tak pernah terekspos; rotasi opsional, lihat catatan.)
6. ☁️ **Buat user DB read-only khusus dashboard** (dipakai B1; jangan pakai `ingest`):
   ```sql
   CREATE USER dashboard_ro WITH PASSWORD '<pw-ro>';
   GRANT CONNECT ON DATABASE solamax TO dashboard_ro;
   GRANT USAGE ON SCHEMA public TO dashboard_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_ro;
   ```
   Simpan `DATABASE_URL` read-only sebagai secret terpisah `solamax-db-url-ro`.

**Verifikasi**
- 🖥️ Jalankan `3-sync-once.bat` sekali → `output-sync-once.txt` harus `ingest ok` (key baru
  diterima); kalau `401`, key di config belum cocok dengan hash di DB.
- ☁️ Key LAMA harus ditolak: `curl -H "Authorization: Bearer <key-lama>" .../ingest` → `401/403`.
- ☁️ `dashboard_ro` hanya bisa SELECT: coba `INSERT` → ditolak `permission denied`.

**Rollback**
- Secret Manager menyimpan versi lama → `gcloud secrets versions access` / arahkan Cloud Run
  ke versi sebelumnya, dan kembalikan `api_key_hash` lama (catat nilai lama sebelum UPDATE).
- Agent: simpan salinan `config.local.json` lama sebelum edit; pulihkan bila perlu.

> Catatan: rotasi password MySQL `readonly_sync` (lokal SPBU) tidak wajib karena tak pernah
> keluar dari LAN; bila tetap diputar, ikuti RUNBOOK-SPBU Bagian C lalu update `config.local.json`.

---

## B4 · Penjadwalan agent (Task Scheduler Windows)  🖥️

Agar sync berjalan kontinu — **inilah yang membuat opname penutup harian (sesi pagi D+1)
tersync**, sehingga tanggal yang kini "provisional" di dashboard menjadi final otomatis.

**Prasyarat**
- B3 selesai (agent pakai API key baru, `--once` terbukti `ingest ok`).
- Node.js terpasang di mesin SPBU (sudah, dari smoke-test).
- Folder bundle agent permanen, mis. `C:\solamax-agent\`.

**Langkah (🖥️, di mesin SPBU)**
1. Tentukan mode loop. Dua pilihan:
   - **(a) Mode loop bawaan agent** (disarankan): jalankan tanpa `--once` → agent loop sendiri
     tiap `pollIntervalMs` (default 2 menit). Task Scheduler cukup memastikan ia *hidup* &
     *restart saat boot*.
   - **(b) Task berkala**: Scheduler memanggil `--once` tiap N menit. Lebih banyak overhead start.
   → Pakai (a).
2. Buat file `jalankan-agent.bat` di folder agent:
   `node solamax-agent.cjs --config config.local.json` (tanpa `--once`).
3. Buka **Task Scheduler** → Create Task (bukan Basic):
   - General: "SolaMax Agent", **Run whether user is logged on or not**, **Run with highest
     privileges** (opsional), centang **hidden** bila perlu.
   - Triggers: **At startup** + (cadangan) **Daily, repeat every 5 min indefinitely** dengan
     aksi yang sama hanya jika belum jalan — atau cukup At startup karena agent loop sendiri.
   - Actions: Start a program → `C:\solamax-agent\jalankan-agent.bat`, "Start in" =
     `C:\solamax-agent\`.
   - Settings: **Restart on failure** tiap 1 menit, hingga 3×; "If the task is already running:
     Do not start a new instance".
4. Start task manual sekali untuk uji.

**Verifikasi**
- 🖥️ Task Scheduler → History/Last Run Result = `0x0`; proses `node` terlihat di Task Manager.
- ☁️ Query `sync_state` (psql RO via proxy): `last_run_at` semua domain bergerak maju tiap
  beberapa menit; `SELECT max(last_run_at) FROM sync_state` ≈ now.
- ☁️ Setelah ≥1 siklus pagi berikutnya: buka dashboard `/unit/6478111/laporan/<kemarin>` →
  badge "Gain/Losses belum final" **hilang** (opname penutup sudah masuk).
- 🖥️ Uji tahan-mati: reboot mesin → task auto-start → `sync_state` lanjut.

**Rollback**
- Disable/Delete task di Task Scheduler → agent berhenti. DB & EasyMax tak terdampak (agent
  read-only ke MySQL; idempoten ke cloud). Tak ada data rusak.

---

## B2 · Auth dashboard — KEPUTUSAN ANDA  (pilih sebelum B1)

Dashboard berisi data operasional lintas SPBU → **tidak boleh publik**. Tiga opsi:

| Opsi | Siapa bisa akses | Effort (☁️) | Biaya/bln | Catatan |
|---|---|---|---|---|
| **A. Cloud IAP** (Identity-Aware Proxy) di depan Cloud Run via HTTPS Load Balancer | Akun Google yang Anda allowlist (per email/grup) | Sedang — perlu LB + IAP + OAuth consent | ~Rp80–150rb (LB minimum) | Tanpa kode auth di app; log akses & pencabutan per akun; paling rapi untuk korporat |
| **B. Login di aplikasi** (mis. NextAuth/middleware + password atau Google sign-in) | Siapa pun yang Anda beri kredensial / Google sign-in | Sedang — perlu nulis lapisan auth + simpan secret | ~Rp0 (di atas Cloud Run) | Kendali penuh di kode; menambah permukaan kode & pemeliharaan; perlu kelola sesi |
| **C. IP allowlist** (Cloud Run ingress internal + Cloud Armor / LB allowlist IP kantor/VPN) | Hanya dari IP kantor/VPN SolaGroup | Rendah–sedang | ~Rp80rb+ (bila pakai LB/Armor) | Sederhana bila akses cukup dari jaringan kantor; rapuh bila direksi akses dari mana saja (IP berubah) |

**Rekomendasi saya:** **Opsi A (Cloud IAP)** untuk pilot→produksi — paling sesuai prinsip
"data operasional, akses per orang, bisa dicabut & diaudit", tanpa menaruh logika auth di kode
dashboard. Jika ingin **cepat & murah untuk pilot internal jangka pendek**, **Opsi B dengan
Google sign-in dibatasi domain** adalah kompromi wajar. **Opsi C** hanya bila akses memang
selalu dari jaringan kantor.

> ⛔ **Tindakan saya menunggu pilihan Anda (A / B / C).** Setelah Anda pilih, saya lengkapi
> langkah persis B1 sesuai opsi itu (mis. A = setup LB+IAP; B = tambah lapisan auth di
> `apps/dashboard` lalu deploy).

---

## B1 · Deploy dashboard ke staging Cloud Run  ☁️ (+🖥️ nihil)

**Prasyarat**
- B2 diputuskan (langkah final tergantung opsi auth).
- `dashboard_ro` + secret `solamax-db-url-ro` dibuat (B3 langkah 6).
- `apps/dashboard` build bersih (sudah: `output: "standalone"`, lint:ds 0, 27 test hijau).

**Langkah (kerangka; detail auth menyusul setelah B2)**
1. Tambah `Dockerfile` dashboard (Next standalone) atau pakai buildpacks; build dari root
   (workspace `@solamax/*`), mirip backend.
2. `gcloud run deploy solamax-dashboard-staging --source . --region=asia-southeast2
   --add-cloudsql-instances=solamax:asia-southeast2:solamax-pg
   --set-secrets=DATABASE_URL=solamax-db-url-ro:latest` **+ flag auth sesuai B2**
   (A: `--ingress=internal-and-cloud-load-balancing` + IAP; B: `--allow-unauthenticated` lalu
   auth di app; C: `--ingress=internal` / Cloud Armor).
3. Set `min-instances=0`, memory 512Mi; pakai user **read-only** (bukan `ingest`).

**Verifikasi**
- Tanpa auth yang sah → akses ditolak (A/C: ditolak di edge; B: redirect ke login).
- Dengan auth sah → `/`, `/board`, `/unit/6478111/laporan/<tgl>`, `/monitoring/*` render data
  staging; angka G/L sama dengan review lokal.
- Cek dashboard **tak bisa menulis** (user RO) — tidak ada operasi tulis di kode, dan RO grant
  menjamin.

**Rollback**
- `gcloud run services update solamax-dashboard-staging --no-traffic` ke revisi baru, atau
  `gcloud run services delete solamax-dashboard-staging` — tidak menyentuh DB/agent.

---

## B5 · Promosi staging → produksi + rollback  ☁️ (gate terakhir)

**Prasyarat (semua harus hijau di staging):** B3 rotasi ✔ · B4 agent terjadwal & `sync_state`
maju ✔ · B1 dashboard ter-deploy + auth aktif ✔ · review akhir Anda.

**Pilihan model produksi**
- **(i) Harden-in-place (disarankan untuk pilot 1 unit):** perlakukan environment saat ini
  sebagai produksi pilot setelah B3/B4/B1 — cukup rename/aliaskan service tanpa sufiks
  `-staging` atau petakan domain `solamax.solagroup.id`. Murah, cepat.
- **(ii) Environment produksi terpisah (untuk rollout 7 SPBU):** project/instance & service
  `solamax-ingest` + `solamax-dashboard` produksi terpisah dari staging; staging tetap untuk uji.
  Lebih bersih untuk skala, lebih banyak setup.

**Langkah (model i)**
1. ☁️ Petakan domain kustom ke Cloud Run dashboard + backend (Cloud Run domain mapping / LB).
2. ☁️ Pastikan secret produksi = kredensial hasil rotasi B3 (bukan nilai lama).
3. ☁️ Tandai revisi "good" saat ini sebagai baseline (catat nama revisi untuk rollback).
4. 🖥️ Konfirmasi agent terjadwal mengarah ke `baseUrl` produksi (bila domain berubah, update
   `config.local.json` → restart task).

**Verifikasi**
- E2E produksi: `3-sync-once` (atau loop) → baris mendarat → dashboard produksi menampilkannya;
  `/healthz`→`/health` OK; auth menolak yang tak berhak.
- Idempotensi & watermark seperti staging.

**Rollback**
- Cloud Run menyimpan revisi: `gcloud run services update-traffic <svc> --to-revisions=<rev-baik>=100`
  mengembalikan instan ke revisi sebelumnya.
- Domain mapping bisa dicabut; agent dikembalikan ke `baseUrl` staging via config.
- DB: tak ada migrasi merusak; bila perlu, Cloud SQL automated backup (PITR) tersedia.

---

## Keputusan TERKUNCI (2026-06-13)

1. **Auth dashboard (B2) = OPSI A — Cloud IAP.** Allowlist per-akun Google **@solagroup.co**
   (board + owner + admin pusat); bisa dicabut & diaudit; nol kode auth; biaya LB diterima.
2. **Model produksi (B5) = (i) HARDEN-IN-PLACE** untuk pilot 1 unit sekarang.
   **(ii) environment produksi terpisah = rencana saat komit rollout 7 SPBU** (jangan
   over-build infra untuk 1 unit).
3. **Urutan eksekusi = B3 → B4 → B1 → B5.** B1/B2 boleh disiapkan paralel, tapi **deploy B1
   hanya setelah B3+B4 hijau di staging.**

Dikerjakan **per sub-langkah atas aba-aba eksplisit**; tiap perintah ditunjukkan sebelum jalan.
