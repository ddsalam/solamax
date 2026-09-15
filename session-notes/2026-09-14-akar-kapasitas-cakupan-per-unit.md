# Akar kapasitas: cakupan pemensiunan bersifat per-unit

Tanggal: 2026-09-14 · Worker: Claude Opus 5 · PR [#362](https://github.com/ddsalam/solamax/pull/362)

---

## 1 · Akarnya unit 4, dan kenapa tak seorang pun melihatnya

```
unit 4 | staging | 32 cycle | seq 7..38  -> 30,3 juta baris bppiut
/snapshot-worker/retire {"unit_id":4}
  -> stagingBefore 32, stagingAfter 1, rowsDeleted 12.717.355, 90 detik
unit 2,3,5,6,7 -> nol.   unit 1 -> sudah bersih (stagingBefore 1).
```

Pemensiunan bersifat **per unit**, dan hanya unit 1 punya penjadwal. Agent unit 4
mengirim cut terus-menerus dan tidak ada yang pernah memensiunkannya.

**Kenapa ini luput dari saya berkali-kali.** Setiap pengukuran yang saya dan
pendahulu saya lakukan di-scope ke **unit 1** — gerbang pra-merge 13-09
(`app.unit_ids='1'`), dan setiap kesimpulan "unit 1 bersih". Layar bersih itu
BENAR dan sekaligus menyesatkan: ia mengukur satu-satunya unit yang memang
dipensiunkan. Saya menulis `01-ukur.sql` dengan `GROUP BY unit_id` dan
`check-snapshot-quiescent.sh` dengan scope seluruh unit — **keduanya akan
menunjukkan ini** — tetapi tidak satu pun sempat dijalankan terhadap produksi.
Alat yang benar, tidak dipakai, sama tidak bergunanya dengan alat yang salah.

## 2 · Keputusan: satu endpoint yang mengiterasi, BUKAN satu job per unit

`unit_id` pada `/snapshot-worker/retire` kini **opsional**; tanpa ia, seluruh
unit aktif.

| | satu job per unit | **satu endpoint mengiterasi** |
|---|---|---|
| isolasi kegagalan | lebih baik | ditebus: galat per unit ditangkap, iterasi lanjut |
| starvation | tidak ada | ditebus: urut backlog-terbanyak-dulu, sisanya dilaporkan `skipped` |
| **cakupan unit baru** | **bergantung ingatan** | **otomatis** |
| jumlah objek infra | N job, N header, N rotasi | 1 |

Yang menentukan adalah baris ketiga. Kegagalan yang baru terjadi PERSIS
berbentuk *"ada unit yang tidak punya job"*. Satu job per unit menyerahkan
cakupan kepada seseorang yang harus ingat menambah job setiap kali unit baru
di-onboard — ketergantungan yang **sudah terbukti gagal**, dan yang akan diuji
lagi pada setiap unit berikutnya. Dengan mengiterasi, cakupan menjadi **sifat
sistem**, bukan sifat ingatan.

## 3 · Ambang per-unit — dan alasan saya yang terbalik

Komentar versi pertama saya menulis: *"menilainya atas total akan menenggelamkan
satu unit yang membengkak"*. **Itu terbalik.** Total selalu ≥ unit terbesar,
jadi ambang atas total justru **lebih mudah** menyala.

Cacat yang sesungguhnya ada di arah sebaliknya: tujuh unit yang **masing-masing
sehat** (1 cut) berjumlah 7 dan melewati ambang 4 **tiap jam, selamanya** —
alarm yang selalu menyala, yang lalu berhenti dibaca. Kelas yang sama dengan
425 yang menyamarkan `disk_review_required`.

Yang menemukannya bukan saya, melainkan **uji kontrol**: mengganti aturan ke
total tidak menjatuhkan uji yang saya kira akan jatuh. Komentar dan uji
keduanya dikoreksi, dan kontrol negatifnya kini memakai tujuh unit sehat —
kasus yang **hanya** jatuh bila seseorang menggantinya dengan total.

## 4 · Tiga cacat pada pekerjaan saya sendiri, ditemukan oleh menjalankannya sungguhan

1. **Gerbang menjatuhkan job BUILD yang tidak keliru.** Aturan "job sementara"
   berlaku untuk semua job; job build memang menunjuk `/snapshot-worker`
   selamanya. Ketahuan saat gerbang dijalankan **end-to-end terhadap job
   produksi nyata**, bukan terhadap fixture.
2. **Backtick di dalam heredoc tak ter-quote DIEKSEKUSI** (`--uri: command not
   found`). Kejadian **ketiga** untuk kelas yang sama hari ini, sesudah
   `git commit -m` dan sesudah pesan galat di gerbang lain.
3. **Dua uji lulus secara hampa.** Sesudah pengecualian job-build ditambahkan,
   kasus 6 mulai lulus karena fixture-nya tidak menyetel `JOB_ROLE`; dan kasus
   12 ternyata tidak pernah menguji pengecualian itu (ia lulus lewat cabang
   lain). **CI yang menangkapnya, bukan pemeriksaan lokal saya** — karena saya
   menyalurkan keluaran self-test ke `tail` dan kehilangan exit code-nya.
   Kasus 14 ditambahkan sebagai yang benar-benar dapat menjatuhkannya.

Aturan yang saya bawa keluar: **verifikasi lewat exit code, bukan lewat ekor
keluaran**; dan **jalankan gerbang terhadap objek yang sebenarnya**, karena
fixture hanya menguji dunia yang saya bayangkan.

## 5 · 🔴 Temuan HIDUP: job per jam masih mematok unit 1

Dijalankan terhadap job produksi hari ini:

```
solamax-snapshot-unit-1         role=build   uri=/snapshot-worker        -> HIJAU
solamax-snapshot-retire-unit-1  role=retire  uri=/snapshot-worker/retire
                                             body unit_id=1              -> MERAH
```

⇒ **Pemensiunan per jam yang sedang berjalan hanya mencakup unit 1.** Enam unit
lain kembali tidak terpensiunkan sejak Dion membersihkan unit 4 secara manual.

**Urutan perbaikannya MENGIKAT**, dan gerbangnya menegakkannya:

1. **Deploy PR #362 lebih dulu.** Sebelum itu `/retire` menuntut `unit_id`;
   mengosongkan body sekarang membuat permintaannya **404** dan pemensiunan
   **berhenti sama sekali** — lebih buruk daripada cakupan yang kurang.
2. **Baru kemudian** kosongkan body:

```bash
gcloud scheduler jobs update http solamax-snapshot-retire-unit-1 \
  --project=solamax --location=asia-southeast2 \
  --message-body='{}' --format='value(name)'
```

3. Verifikasi (nilai header tidak pernah tercetak):

```bash
gcloud scheduler jobs describe solamax-snapshot-retire-unit-1 \
  --project=solamax --location=asia-southeast2 --format=json \
  | python3 scripts/ci/scheduler-job-facts.py
```

`JOB_BODY_UNIT` harus kosong; `JOB_CONTENT_TYPE=application/json`;
`JOB_HEADER_KEYS` memuat `x-snapshot-secret`.

Gerbang menuntut body kosong **hanya** bila revisi ter-deploy sudah mendukungnya
(`ALL_UNITS_ADA`), sehingga langkah 2 tidak dapat mendahului langkah 1.

## 6 · `--uri` mempertahankan header — kini TERBUKTI

Dulu saya menuliskannya sebagai asumsi lalu mengubahnya jadi instruksi
verifikasi. Sekarang ia pengamatan: job diarahkan ke `/retire` di produksi dan
`Content-Type` serta `x-snapshot-secret` tetap utuh. Yang **mengganti** set
header adalah `--update-headers`, bukan `--uri`. Pesan gerbang sudah mengutip
buktinya alih-alih berhedge.

## 7 · Penjaga baru: skrip yang dirujuk workflow harus ada

Promosi tertahan `deploy-test exit 127` karena langkah lama memanggil
`check-temporary-retire-job.sh` sesudah skrip itu di-rename. YAML sah, job
terdaftar, penjaga lama hijau — ia hanya memeriksa **bentuk**, bukan **rujukan**.
`check-workflows.sh` kini menolaknya, dengan kontrol dua arah.

## 8 · Yang butuh Dion

1. **Merge #362, lalu langkah §5.2.** Sampai itu, enam unit tidak terpensiunkan.
2. `05-kurva.sh` tiap jam sesudah `VACUUM FULL` selesai — kurvanya, bukan satu
   titik. Prediksi masih terkunci (mendatar ≤ 6 jam pada ≤ ~1 GB).
3. Batas disk (`README` kapasitas) — angkanya milik Anda; puncak terukur 22,15 GB.
4. F1 menyusul sesudah (b) stabil.

---

# Adendum — lubang KEDUA: penjadwal BUILD juga per-unit

## 9 · Kembaran persis, di sisi yang tidak saya periksa

Sesudah cakupan pemensiunan ditemukan, sisi **build** ternyata punya lubang yang
sama bentuknya:

```
unit 4 (Bundaran Kotabaru): 39 cycle, complete = 0, sejak 12 September
cut seq 38 LENGKAP: 935.132 bppiut / 95.969 bphut
sebabnya: hanya solamax-snapshot-unit-1 yang ada
```

Dua hari snapshot hilang. Cut-nya lengkap dan benar — tidak pernah ada yang
membangunnya. **Saya merancang cakupan otomatis untuk `/retire` dan tidak
menanyakan apakah sisi build punya masalah yang sama.** Perbaikan yang berhenti
di satu sisi meninggalkan sisi lain persis seperti semula.

## 10 · Kenapa build TIDAK bisa ikut mengiterasi

Build memegang **lease global-1** dan anggaran 18 menit per permintaan. Tujuh
build dalam satu permintaan tidak muat di jendela Cloud Run 20 menit. Jadi build
**tetap per-unit**, di-stagger di dalam jendela 02:00–05:00 WIB — dan karena itu
cakupannya tetap bergantung pada job, yang berarti tetap butuh gerbang.

Asimetri ini disengaja dan perlu ditulis: pemensiunan murah dan idempoten,
sehingga mengiterasinya aman; build mahal dan saling mengunci, sehingga tidak.

## 11 · Gerbangnya, dan premis pertama saya yang salah

`scripts/ci/check-snapshot-unit-coverage.sh` — dua sisi, tujuh keadaan
di-self-test, berjalan di tier **pilot** (input `coverage-check`).

**Percobaan pertama saya memakai registry `ADOPSI_RINCIAN` (tujuh kode) sebagai
"unit yang harus punya job". Itu salah.** Unit 3, 5, 6, 7 belum menukar bundle
agent, jadi mereka belum mengirim cut dan belum boleh dituntut punya job build.
Gerbang berbasis registry akan menyala **tiap hari sampai unit terakhir
di-onboard** — alarm yang selalu menyala, kelas yang sama dengan 425 yang
menyamarkan `disk_review_required`.

Sumber yang benar: **unit yang BENAR-BENAR mengirim cut**, dibaca dari
`app.saldo_pelanggan_source_cycle`. Karena itu gerbangnya ditaruh di
`prisma-migrate` — satu-satunya tempat yang punya kredensial DB **dan** gcloud.

**Kontrol anti-vakum** ditambahkan karena kejadiannya nyata saat pengembangan:
`sed` BSD tidak mengenal `\+`, daftar job jadi kosong, dan gerbangnya berbunyi
atas nol. Kalau arah salahnya kebetulan terbalik, ia akan **lulus** atas nol.
Kini `UNIT_BERCUT` kosong ditolak sebagai **galat**, bukan dibaca sebagai
"tidak ada unit".

Dijalankan end-to-end terhadap penjadwal produksi nyata: cut dari unit 1, 2, 4
dan build job untuk 1, 2, 4 → **HIJAU**.

## 12 · Nilai #362, diargumentasikan ulang

Tujuh job retire per-unit sudah dibuat, jadi #362 **bukan lagi penahan
kapasitas**. Nilainya kini:

1. **Menghapus ketergantungan pada ingatan.** Unit ke-8 dan seterusnya tercakup
   pemensiunan otomatis pada hari ia mulai mengirim cut — tanpa siapa pun perlu
   ingat. Itu tepat ketergantungan yang gagal dua kali hari ini.
2. **Menghapus tujuh objek infrastruktur.** Tujuh job = tujuh header ber-secret
   yang harus ikut setiap rotasi. Rotasi 14-09 sudah membuktikan satu header
   yang tertinggal cukup untuk menghabiskan semalam build.
3. **Alarm per-unit.** `staging_review` dinilai per unit lalu di-OR, sehingga
   satu unit yang tertinggal berbunyi walau enam lainnya sehat.

Ia tetap tidak mendesak. Ia hanya membuat kelas kegagalan hari ini tidak dapat
terulang lewat pintu yang sama.

## 13 · Kurva kapasitas — titik awal, bukan kesimpulan

Sesudah `VACUUM FULL` kedua selesai 18:30 WIB, dengan job pemensiunan per jam
hidup untuk seluruh unit:

```
18:44 WIB  8,33 GB
18:59 WIB  8,41 GB   +88 MB
19:14 WIB  8,38 GB   −35 MB
```

Mendatar — **tetapi 30 menit bukan 6 jam**, dan prediksi yang saya kunci
berbicara tentang `pg_relation_size` selama ≤ 6 jam, bukan tentang disk selama
setengah jam. Ini titik awal kurva, bukan konfirmasinya. `05-kurva.sh` tetap
alat yang menjawabnya.
