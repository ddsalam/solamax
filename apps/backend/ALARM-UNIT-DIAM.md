# Alarm unit diam — penyediaan & pembuktian

Alarm pertama di SolaMax. Ia menjawab satu pertanyaan yang sudah **dua kali** dijawab oleh
manusia, bukan oleh sistem:

| insiden | lama diam | yang menemukan |
|---|---|---|
| Bakau, 23–24 Jul 2026 | 34,5 jam | Dion, kebetulan membuka layar Ketaatan |
| Imam Bonjol, 16–17 Sep 2026 | 23,3 jam | Dion, melapor datanya hilang |

Kedua kali datanya **sudah ada** di `public.sync_state` sepanjang waktu. Yang tidak ada adalah
sesuatu yang membacanya tanpa diminta.

## Bentuknya

```
Cloud Scheduler (tiap jam)
   └─ POST /sync-health  (header x-sync-health-secret)
        └─ backend membaca MAX(last_run_at) per unit aktif
             ├─ semua segar  → log INFO  "sync_health_ok"        → senyap
             └─ ada yang diam → log ERROR "sync_health_incident"  → metrik → policy → email
```

**Ambang 120 menit** (`SYNC_STALE_THRESHOLD_MINUTES`, bisa ditimpa tanpa deploy). Dipilih dari
pengukuran: pada armada sehat 17-09-2026 unit terbaru berumur **0,01–0,05 jam** di ketujuh unit,
sementara unit yang mati berumur **23,2 jam**. Ambangnya duduk di tengah jurang tiga ordo besaran.

**Sekali per insiden.** Backend menerbitkan satu baris ERROR tiap probe selama keadaan bertahan;
yang men-dedup adalah **alert policy** (incident dibuka saat metrik > 0, menutup sendiri saat
berhenti). Sengaja tidak ada state di basis data — state kedua hanya menambah yang bisa basi.

## ⚠️ URUTAN TIDAK BOLEH DIBALIK

`deploy-backend.yml` sekarang memasang `--update-secrets=…,SYNC_HEALTH_SECRET=solamax-sync-health-secret:latest`.
**Secret itu harus ada SEBELUM PR ini ter-deploy**, kalau tidak `gcloud run deploy` gagal dan
deploy-nya HALT. Jalankan Langkah 1 lebih dulu.

---

## Langkah 1 — secret (SEBELUM merge)

Rahasianya **terpisah** dari `SNAPSHOT_TRIGGER_SECRET` dengan sengaja: probe baca-saja tidak
boleh memegang kunci yang bisa memicu build produksi.

```bash
gcloud secrets create solamax-sync-health-secret --replication-policy=automatic
openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64 \
  | gcloud secrets versions add solamax-sync-health-secret --data-file=-
gcloud secrets add-iam-policy-binding solamax-sync-health-secret \
  --member=serviceAccount:113869564052-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

SA runtime di atas dan peran `secretAccessor` menyalin persis pola `solamax-warm-board-secret`
yang sudah dipakai.

## Langkah 2 — merge PR, biarkan CD men-deploy

Verifikasi **di tingkat revisi**, bukan dari `spec.template` (itu cetakan revisi *berikutnya*):

```bash
gcloud run revisions list --service=solamax-ingest-staging --region=asia-southeast2 --limit=3
gcloud run services describe solamax-ingest-staging --region=asia-southeast2 --format='value(status.traffic)'
```

## Langkah 3 — job Scheduler

Job snapshot yang sudah ada memakai auth **header**, tanpa OIDC; ini mengikutinya.

```bash
SECRET="$(gcloud secrets versions access latest --secret=solamax-sync-health-secret)"
gcloud scheduler jobs create http solamax-sync-health \
  --location=asia-southeast2 \
  --schedule="7 * * * *" \
  --time-zone="Asia/Jakarta" \
  --uri="https://solamax-ingest-staging-wn6i64kvza-et.a.run.app/sync-health" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-sync-health-secret=${SECRET}" \
  --attempt-deadline=60s \
  --max-retry-attempts=1
unset SECRET
```

> 🛑 **`gcloud scheduler jobs describe` MENCETAK NILAI HEADER apa adanya.** Perintah baca yang
> tampak jinak itu akan menumpahkan rahasianya ke terminal/transkrip. Untuk memeriksa job ini
> pakai `--format` yang tidak menyentuh header:
> ```bash
> gcloud scheduler jobs describe solamax-sync-health --location=asia-southeast2 \
>   --format='value(schedule,state,httpTarget.uri)'
> ```

## Langkah 4 — log-based metric

Penanda `sync_health_incident` adalah **kontrak** dengan kode; `sync-health.controller.test.ts`
mengunci nilainya supaya perubahan menjatuhkan CI, bukan menjatuhkan alarm diam-diam.

```bash
gcloud logging metrics create solamax_sync_health_incident \
  --description="Unit SolaMax berhenti mengirim (agent diam melewati ambang)" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="solamax-ingest-staging"
severity>=ERROR
textPayload:"sync_health_incident"'
```

## Langkah 5 — saluran email + policy

Saluran email perlu verifikasi lewat tautan yang dikirim Google; paling mudah dibuat di Console
(**Monitoring → Alerting → Notification channels**). Lewat CLI:

```bash
gcloud beta monitoring channels create \
  --display-name="Dion — SolaMax" \
  --type=email \
  --channel-labels=email_address=damiandionsalam@gmail.com
```

Ambil `name`-nya (`projects/solamax/notificationChannels/…`), lalu:

```bash
CHANNEL="projects/solamax/notificationChannels/GANTI_DENGAN_ID"
gcloud monitoring policies create \
  --display-name="SolaMax — unit berhenti mengirim" \
  --condition-display-name="sync_health_incident > 0" \
  --condition-filter='metric.type="logging.googleapis.com/user/solamax_sync_health_incident" AND resource.type="cloud_run_revision"' \
  --if="> 0" \
  --duration=0s \
  --aggregation='{"alignmentPeriod":"600s","perSeriesAligner":"ALIGN_SUM"}' \
  --combiner=OR \
  --notification-channels="${CHANNEL}"
```

---

## Langkah 6 — BUKTIKAN ia berbunyi (jangan lewati)

> **Konfigurasi yang benar bukan bukti kawat yang menyala.** SolaQ tertipu dua kali oleh panel
> penyedia yang hijau sementara kiriman sungguhan gagal. Alarm yang belum pernah berbunyi adalah
> alarm yang belum pernah diuji.

Pancing satu insiden dengan memperketat ambang sementara:

```bash
gcloud run services update solamax-ingest-staging --region=asia-southeast2 \
  --update-env-vars=SYNC_STALE_THRESHOLD_MINUTES=1
```

Tunggu probe berikutnya (atau picu manual dengan perintah Langkah 3 yang sama, `curl -XPOST`
berheader rahasia). Yang harus terjadi berurutan:

1. Log Cloud Run memuat baris **ERROR** `sync_health_incident` menyebut unit + `age_hours`.
2. Metrik `solamax_sync_health_incident` bergerak > 0.
3. **Email masuk.** ← ini satu-satunya bukti yang sah.

Lalu **KEMBALIKAN**, dan verifikasi di tingkat revisi:

```bash
gcloud run services update solamax-ingest-staging --region=asia-southeast2 \
  --remove-env-vars=SYNC_STALE_THRESHOLD_MINUTES
gcloud run revisions list --service=solamax-ingest-staging --region=asia-southeast2 --limit=3
gcloud run services describe solamax-ingest-staging --region=asia-southeast2 --format='value(status.traffic)'
```

⚠️ `services update` dapat **membuat revisi tanpa memindahkan trafik** bila trafik dipaku ke nama
revisi — dan pesan CLI-nya menyesatkan. Dua perintah verifikasi di atas wajib, bukan opsional.

## Menyenyapkan sementara

Bila satu unit memang sedang dimatikan terencana:

```bash
gcloud monitoring snoozes create --display-name="perawatan <unit>" ...
```

Jangan menonaktifkan policy-nya — snooze berakhir sendiri, policy nonaktif tidak.

## Yang TIDAK ditutup alarm ini

- **Agent hidup tapi mengirim data salah.** Alarm ini hanya melihat *kapan terakhir mengirim*.
- **Pengawas tidak menginput.** Itu urusan layar Ketaatan — dan sel merahnya masih belum
  membedakan "pengawas tak input" dari "agent mati". Celah itu masih terbuka.
- **Domain tunggal yang macet** sementara domain lain jalan. Alarm memakai MAX (lihat
  `sync-health.sql.ts` untuk alasannya); unit begitu tetap terbaca segar.
