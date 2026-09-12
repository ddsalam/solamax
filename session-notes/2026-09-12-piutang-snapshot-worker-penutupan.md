# Penutupan arc worker snapshot saldo pelanggan

Tanggal: 12 September 2026 WIB

Branch: `codex/piutang-snapshot-trigger` dari `origin/staging` `e8e09187`

PR aktif: [#342](https://github.com/ddsalam/solamax/pull/342) ke `staging`

Catatan ini adalah indeks keadaan akhir setelah pemicu builder dipilih Dion dan
dibangun. Ia tidak menggantikan bukti per tahap. Sumber utama untuk operasi
selanjutnya adalah:

- [runbook pemicu snapshot](./2026-09-12-piutang-snapshot-trigger-runbook.md);
- [penutupan Fase 1](./2026-09-11-piutang-fase1-penutupan-arc.md);
- [hasil B6](./2026-09-10-piutang-build-b6-hasil.md);
- [preregistrasi B5a](./2026-09-10-piutang-build-b5a-preregistrasi.md).

## Vonis penutupan

Fase 1 sudah mempunyai seluruh rantai kode dari source cut sampai layar, dan PR
#342 menambahkan pemicu HTTP yang dapat dijadwalkan. Namun **snapshot produksi
belum pernah dibangun**. Saat catatan ini ditulis, endpoint belum mendarat di
`staging` atau `main`, belum terpasang di pilot LIVE, kanari endpoint belum
dijalankan, dan tujuh job Cloud Scheduler belum dibuat.

Dengan demikian, status yang benar adalah **builder lengkap dan pemicunya siap
ditinjau, tetapi aktivasi masih dorman**. Tidak ada resource GCP, migrasi,
snapshot produksi, atau rollout enam agent lain yang dibuat dari PR #342.

| Lapisan | Keadaan saat penutupan |
|---|---|
| Migrasi `0037`/`0038` | hidup di produksi; `0037` tetap beku |
| Capture/diff/invalidation B3 | hidup di backend produksi; kedatangan `source_cut` dari agent belum terbukti di DB |
| Builder + work queue + publikasi atomik B2 | hidup di backend produksi; belum pernah dipicu sampai membuat manifest |
| Reader transisi B4 | hidup; memakai snapshot hanya bila unit/tanggal `ready`, selain itu tetap membaca ledger lama |
| Layar B6 | hidup tetapi menampilkan belum siap selama snapshot tidak ada |
| Agent baru | baru ditukar di Imam Bonjol; enam mesin lain masih bundle lama |
| Endpoint PR #342 | kode dan runbook siap; PR masih menuju `staging` |
| Cloud Scheduler | belum ada tujuh job; perintah hanya tersedia di runbook |
| B5a/B5b | B5a tersegel tetapi oracle 0/6 belum dibuka; B5b belum dimulai |

SHA-256 migrasi beku:

```text
0037_saldo_pelanggan_snapshot/migration.sql
54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd
```

## Rantai perubahan yang menjadi dasar

| PR | Peran |
|---|---|
| [#327](https://github.com/ddsalam/solamax/pull/327) | B1: `0037`/`0038`, kontrak penyimpanan, RLS, dan grant |
| [#328](https://github.com/ddsalam/solamax/pull/328) | promosi awal yang menghidupkan migrasi di produksi |
| [#329](https://github.com/ddsalam/solamax/pull/329) | B2: builder, durable work queue, lease, dan publikasi atomik |
| [#330](https://github.com/ddsalam/solamax/pull/330) | B3: `source_cut`, capture, diff, dan invalidasi |
| [#331](https://github.com/ddsalam/solamax/pull/331) | B4: reader, cache, dan gerbang transisi |
| [#333](https://github.com/ddsalam/solamax/pull/333) | B6: layar daftar/detail dan ekspor |
| [#334](https://github.com/ddsalam/solamax/pull/334) | back-merge yang mempertahankan sapuan `terra_resmi` dan `source_cut` |
| [#332](https://github.com/ddsalam/solamax/pull/332) | promosi B2–B6 ke `main`, merge `fb2d65cc` |
| [#335](https://github.com/ddsalam/solamax/pull/335) | usul guard divergensi dan fixture B6; guard belum dipasang |
| [#340](https://github.com/ddsalam/solamax/pull/340) | koreksi bukti kanari dan pencatatan bahwa builder tidak mempunyai pemicu |
| [#342](https://github.com/ddsalam/solamax/pull/342) | endpoint rahasia, deadline, lease/status, deploy config, dan runbook Scheduler |

## Isi PR #342 dan batasnya

Endpoint `POST /snapshot-worker` menerima tepat satu `unit_id` dan memanggil
`SnapshotWorkerService.runOnce`. Secret wajib dan dibandingkan constant-time.
Secret salah/absen, unit invalid, dan unit tidak aktif/tidak ada semuanya
menghasilkan respons 404 yang identik. Lookup atau worker yang gagal tidak
membuka oracle keberadaan unit.

Lease unik di database tetap menjadi penjaga global concurrency `1`. Pemanggil
kedua selama lease aktif menerima `busy`, bukan builder kedua. Status HTTP
membedakan `done`, `idle`, `superseded`, `busy`, `skipped`, `retry_wait`, dan
kegagalan terminal. Timeout Cloud Run 20 menit, deadline endpoint 18 menit, dan
batas attempt builder 15 menit memberi ruang untuk menyimpan kegagalan dan
mengirim respons sebelum gateway memutus request.

PR juga menyiapkan tujuh jadwal eksplisit dalam zona `Asia/Pontianak`, satu job
per unit, tanpa retry Scheduler. **Perintah itu belum dijalankan.** Secret header
yang tersimpan di resource Scheduler merupakan batas operasional: rotasi secret
memerlukan pembaruan binding service dan ketujuh job, dan konfigurasi job harus
hanya diperiksa dengan keluaran tersanitasi.

Target lengkap yang tidak boleh disingkat:

- testing: service `solamax-ingest-rlsstg`, instance
  `solamax:asia-southeast2:solamax-pg-rlsstg`;
- pilot LIVE: service `solamax-ingest-staging`, instance
  `solamax:asia-southeast2:solamax-pg`.

## Bukti kanari agent yang sah—dan yang belum dibuktikan

Dion menukar bundle agent di Imam Bonjol pada 11 September 2026. Proses baru
hidup, 14/14 domain `sync_state` maju, dan 1.000 request ingest sejak swap
seluruhnya HTTP 200. Itu membuktikan bundle dapat berjalan dan payload yang
diterima tidak merusak ingest.

Bukti tersebut **tidak** membuktikan field opsional `source_cut` terkirim,
source cycle lengkap, work queue tersedia, builder dipanggil, atau snapshot
dipublikasikan. Pemeriksaan berikutnya tetap harus memakai kanal read-only yang
disetujui Dion pada instance
`solamax:asia-southeast2:solamax-pg`. Jangan menggantinya dengan role ingest
yang mampu menulis.

## Dua kelas near-regression yang nyaris lolos

### 1. Konsumen dipindah sebelum produsen snapshot aktif

Cutover reader semula dapat membuat angka hidup menghilang ketika tabel snapshot
masih kosong. Perlindungan akhirnya adalah gerbang per unit/tanggal: snapshot
dipakai hanya bila `ready`; selain itu wrapper agregat tetap membaca ledger lama.
Tipe `getSaldoPelangganCached` juga non-nullable, sehingga regresi menjadi galat
kompiler, bukan sekadar aturan yang harus diingat.

Pelajaran: deployment kode produsen bukan bukti produsen pernah menghasilkan
data. Transisi harus mempertahankan jalur lama sampai bukti aktivasi jalur baru
ada, dan bukti itu harus berasal dari tanggal/unit yang benar-benar dipakai.

### 2. Hotfix langsung ke `main` dapat hilang pada promosi berikutnya

PR #324 membawa jalur delete-capable `terra_resmi` langsung ke `main`, melewati
aturan staging-first. Divergensi diam selama tiga hari dan baru terlihat karena
B3 kebetulan menyentuh `apps/agent/src/sync.ts`. Mengambil sisi `staging` saat
konflik akan menghapus perbaikan produksi itu. Back-merge #334 menggabungkan
`replace_window`/sapuan dari `main` dengan `source_cut` dari `staging`.

Audit menemukan sembilan berkas main-only lain dan semuanya bagian dari #324;
tidak ditemukan hotfix main-only kedua. PR #335 menyiapkan usul dan self-test
guard divergensi, tetapi guard itu **belum** didaftarkan ke workflow atau branch
protection. Pelajaran: aturan yang hanya bekerja bila seseorang ingat belum
menjadi penjaga.

## Mengapa builder dapat lengkap tetapi tidak pernah berjalan

Sebelum PR #342, satu-satunya pemanggil `SnapshotWorkerService.runOnce` adalah
CLI manual `snapshot:worker`. Pagar 02.00–05.00 WIB hanya membatasi kapan worker
boleh bekerja; pagar itu tidak membangunkan worker. Heartbeat lease hanya
memperbarui pekerjaan yang sudah berjalan; ia bukan scheduler. Karena tidak ada
call-site terjadwal, semua suite dapat hijau sementara manifest, pointer, dan
row snapshot produksi tetap nol.

Pencegahan yang harus dibawa ke pekerjaan sejenis:

1. Definition of Done harus mengaudit call-site atau scheduler, bukan hanya
   implementasi service.
2. Bukti deployment harus dipisahkan dari bukti aktivasi.
3. Setelah jendela, dead-man check harus menuntut hasil `done` per unit; tujuh
   respons 2xx tidak cukup karena `idle` dan `superseded` juga 2xx.
4. Tes E2E aktivasi harus membuktikan pemicu sampai manifest/pointer/row, bukan
   berhenti pada status control plane.

PR #342 menutup kekurangan call-site yang dapat dijadwalkan. Pembuatan resource,
kanari, dan monitor dead-man tetap tindakan pascapromosi milik Dion.

## `terra_resmi` tetap inert dalam tiga lapisan

Perbaikan #324 belum aktif di produksi karena ketiga syarat berikut berlaku
bersama:

1. `terraResmiAutoSweepEnabled` default `false`; kunci config yang hilang juga
   efektif `false`.
2. Scheduler sync sengaja mengecualikan `terra_resmi` sampai flag diaktifkan per
   unit. Sapuan dapat menghapus baris dan harus di-rollout terpisah.
3. Kode baru baru mencapai satu mesin ketika bundle Imam Bonjol ditukar. Config
   lama mesin itu tidak mempunyai opt-in; enam mesin lain masih memakai bundle
   lama.

Jangan mengaktifkan `terra_resmi` sebagai bagian kanari snapshot. Ia memerlukan
arc sendiri: preview selisih sumber-versus-Postgres, satu unit off-peak, amati
hasil delete, lalu lanjut per unit hanya sesudah diterima.

## Perangkap swap bundle dan dua checksum

`solamax-agent-main-fb2d65c.zip` memuat `config.local.json` placeholder. Ekstrak
ke folder sementara dan salin semua berkas **kecuali** `config.local.json` ke
`C:\solamax-agent`. Menimpa config hidup dapat mengganti identitas unit, database
EasyMax, atau referensi secret meskipun hash bundle benar.

| Objek | SHA-256 |
|---|---|
| `solamax-agent-main-fb2d65c.zip` | `6ec8b917909fb903eab4a2ea2007060127914029192c3619af93ccc10062176d` |
| `C:\solamax-agent\solamax-agent.cjs` setelah salin | `bf326a9f3c8ceb2690bbc63c57454d64537dd91ea0510c1fe73b82e7b1af538d` |

Hash zip dan `.cjs` menjaga objek berbeda; jangan membandingkan keduanya satu
sama lain. Sebelum restart, periksa `unitCode`, keberadaan `apiKey` tanpa
mencetak nilainya, dan `mysql.database`. Usul mengganti template menjadi
`config.local.json.contoh` belum diterapkan.

## Pelajaran metode yang harus dipertahankan

- Contoh adalah ilustrasi, bukan sampel yang mewakili populasi.
- Hasil pencarian nol bukan bukti ketidakadaan tanpa kontrol positif bahwa
  target, scope RLS, dan query benar.
- Pada `n=6`, p95 nearest-rank sama dengan nilai maksimum; angka itu bukan vonis
  SLO representatif.
- Kolom mirror harus dibedakan dari schema sumber. Kesamaan nama bukan bukti
  bahwa bentuk dan semantiknya sama.
- Bila sistem mengembalikan keadaan yang tidak diprediksi, hentikan kesimpulan
  yang bergantung padanya. Bila alat sendiri rusak, perbaiki alat dan lanjutkan.
- Bukti tes, deploy, aktivasi, dan pembacaan pengguna adalah empat bukti berbeda.
- Transisi data memerlukan jalur lama dan baru hidup berdampingan sampai urutan
  migrasi, produsen, validasi, lalu konsumen terbukti.
- Aturan yang menuntut manusia selalu ingat harus diberi penjaga otomatis atau
  dicatat jujur sebagai governance yang belum ditegakkan.

## Yang belum selesai

- Butir Dion #2/#3/#4—tagihan dibuat, dibayar, belum dibayar, dan jatuh
  tempo—belum dibangun.
- Peringatan dan kebijakan limit/tempo belum dibangun.
- Endpoint PR #342 belum dipromosikan; kanari endpoint Imam Bonjol belum
  dijalankan.
- Tujuh job Cloud Scheduler dan alarm dead-man belum dibuat.
- Kedatangan `source_cut` agent Imam Bonjol belum diverifikasi di produksi.
- Snapshot produksi belum terbentuk; parity snapshot-versus-legacy produksi B5b
  belum diuji.
- B5a masih menunggu enam workbook asli EasyMax; oracle 0/6 belum dibuka.
- Enam mesin agent selain Imam Bonjol belum ditukar.
- Sapuan `terra_resmi` belum pernah diaktifkan.
- Pengukuran runtime produksi representatif dengan `n >= 20` dan keputusan SLO
  belum ada.
- Guard CI divergensi `main`/`staging` baru usul; belum dipasang.

## Paparan kredensial dan keputusan owner

Nilai kredensial tidak diulang di catatan ini. `.env.local` pernah terekspos dan
rotasinya sengaja ditunda oleh owner. Secara terpisah, password role
`dashboard_ro` pernah tercetak oleh orkestrator, bukan oleh Dion atau Codex, dan
perlu dirotasi. Waktu, urutan, dan pelaksanaan kedua rotasi tetap keputusan
Dion. Tidak ada kredensial yang dibaca, dicetak, atau diputar dalam PR #342.

## Urutan lanjut yang sah

1. Dion meninjau dan merge PR #342 ke `staging`.
2. Pipeline testing membuktikan revisi `solamax-ingest-rlsstg` pada
   `solamax:asia-southeast2:solamax-pg-rlsstg`.
3. Setelah promosi normal dan persetujuan gerbang pilot, verifikasi revisi yang
   benar-benar melayani 100% traffic pada `solamax-ingest-staging`.
4. Jalankan kanari endpoint **sekali untuk Imam Bonjol**, lalu buktikan
   manifest, pointer, row count, parity tanggal manifest, dan enam nilai RECAP
   sesuai runbook.
5. Hanya bila kanari diterima, Dion membuat tujuh job Scheduler dan memasang
   pemeriksaan dead-man.
6. Workbook B5a, B5b, rollout enam agent lain, aktivasi `terra_resmi`, dan butir
   produk berikutnya tetap pekerjaan terpisah.

Tidak ada langkah pada daftar ini yang dijalankan oleh sesi penutupan. Sesi
berhenti setelah catatan ini ditambahkan ke PR #342; tidak memulai pekerjaan
baru, tidak membuka PR ke `main`, dan tidak menyentuh
`apps/agent/solamax-agent-bundle/`.
