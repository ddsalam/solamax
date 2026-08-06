# Pra-registrasi backfill artefak floating-point — APPEND-ONLY

Berkas ini ditulis **sebelum** langkah tulis apa pun ke `solamax-pg`. Aturannya:
**append-only** — angka dan prediksi yang sudah tertulis tidak diedit; hasil ditambahkan
di bawah. Kalau sebuah prediksi meleset, yang ditulis adalah **kenyataannya**, bukan
prediksinya yang disesuaikan.

Setiap pemeriksaan di sini dirancang **bisa berbunyi MERAH**. Pemeriksaan yang tak punya
kondisi gagal bukan pemeriksaan.

Konteks & sebab: [`2026-08-06-artefak-float-numeric-ingest.md`](2026-08-06-artefak-float-numeric-ingest.md).
Skrip: [`apps/backend/scripts/backfill-numeric-artifacts.sql`](../apps/backend/scripts/backfill-numeric-artifacts.sql).

## Kenapa backfill ini dijalankan — supaya tidak salah dibaca

**BUKAN demi angkanya.** Materialitasnya nihil dan itu terukur: deviasi maksimum satu sel
**0,00001**, deviasi **total seluruh ±243.800 sel = 0,0000746**, hanya **2** sel yang
menyimpang lebih dari 1e-6. Tak ada angka laporan yang bisa bergeser satu rupiah pun.
Siapa pun yang membaca backfill ini sebagai **perbaikan korektness** salah baca.

Alasannya **permukaan laten**: pola `GREATEST(0, a − b)` di Sisa DO
([`queries.ts:693-694`](../apps/dashboard/src/lib/queries.ts#L693), `:778`) membandingkan
**selisih dua kolom**, dan perbandingan eksak-nol adalah tempat epsilon menggigit. Hari ini
kedua kolomnya (`tebus_detail.nvolume`, `delivery.nvoldo`) **kebetulan** bersih — kebetulan,
bukan desain. Backfill mengubah **"kebetulan bersih"** menjadi **"tidak mungkin kotor"**.

## T0 — baseline, diukur SEBELUM fix live

Diambil **2026-08-06 22:30:21 WIB** sebagai `dashboard_app` (SELECT-only), detektor
`scale(kolom) >= 5`, GUC `app.unit_ids = 1..7`.

| kolom | u1 | u2 | u3 | u4 | u5 | u6 | u7 | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `bppiut.njumlah` | 1 | – | – | – | – | – | – | **1** |
| `cash_detail.njumlah` | 1 | – | – | 1 | – | – | – | **2** |
| `cash_header.ntotal` | 1 | – | – | 1 | – | – | – | **2** |
| `delivery.nvolreal` | – | – | – | – | 1 | – | – | **1** |
| `delivery.nvolselisih` | – | – | – | – | 1 | – | – | **1** |
| `edc.liter` | 2326 | 3139 | 114 | 4327 | 1885 | 284 | 7941 | **20016** |
| `opname.nstockbk` | 1037 | 2147 | – | 3914 | 3846 | 1928 | 3745 | **16617** |
| `opname.nstockop` | 1005 | 2047 | – | 3663 | 3366 | 1844 | 3688 | **15613** |
| `opname.nvolselisih` | 1355 | 1949 | – | 3035 | 2115 | 1038 | 2804 | **12296** |
| `pelanggan_sale.liter` | 16227 | 6 | – | 115 | 310 | 304 | 1673 | **18635** |
| `real_tank.ntinggi` | – | – | – | – | – | – | 1 | **1** |
| `real_tank.nvolume` | – | – | – | – | 1 | – | – | **1** |
| `sales_detail.nstandakhir` | 8533 | 10333 | – | 14010 | 13555 | 2171 | 7822 | **56424** |
| `sales_detail.nstandawal` | 8531 | 10336 | – | 14013 | 13563 | 2168 | 7822 | **56433** |
| `sales_detail.nsubtotal` | 27 | 4 | – | 12 | 6 | 4 | 23 | **76** |
| `sales_detail.nvolume` | 7581 | 7274 | – | 13292 | 5081 | 3714 | 9201 | **46143** |
| `tera.liter` | 7 | – | – | 27 | 5 | 10 | 11 | **60** |
| `terra_resmi.nvolume` | 4 | 1 | – | 15 | 6 | 2 | 3 | **31** |
| `voucher_sale.liter` | 285 | 332 | 52 | 650 | 39 | 143 | 5 | **1506** |
| **TOTAL** | **46921** | **37568** | **166** | **57075** | **43780** | **13610** | **44739** | **243859** |

Catatan: sapuan pertama sesi ini (21:50 WIB) mencatat **243.829**. Empat puluh menit
kemudian **243.859** — naik **30**. Itu bukan kebisingan pengukuran, itu jalur tulis lama
yang **masih memproduksi artefak** karena fix belum live. Angka T0 karena itu **bukan**
target; target diukur ulang tepat sebelum tiap unit dijalankan (lihat P4).

## Prediksi — semua bisa MERAH

### P1 · Sebelum fix live, hitungan MASIH NAIK
Pengukuran berikutnya sebelum promosi live ≥ 243.859.
**MERAH bila**: turun tanpa ada yang menjalankan backfill (berarti ada jalur tulis lain yang
tak dipahami).

### P2 · Setelah fix live, produksi artefak BARU berhenti
Dua pengukuran berjarak ≥ 60 menit setelah revisi backend baru serve → **selisih 0**.

**Kontrol wajib (inilah yang membuatnya bisa merah):** pada jendela yang sama, buktikan
data baru memang masuk — `max(ingested_at)` pada `sales_detail`/`edc` maju dan jumlah baris
bertambah. Tanpa kontrol ini, "0 artefak baru" bisa saja berarti "0 data baru", dan itu
bukan bukti apa-apa.
**MERAH bila**: hitungan naik meski revisi baru sudah serve → fix tidak bekerja di prod dan
backfill **dibatalkan**.

### P3 · Baris pemicu sembuh sendiri — kontrol jalur tulis
`bppiut PP2022100101473` (unit 1) berubah `73867616.45999999` → **`73867616.46`** pada sync
penuh pertama domain `piutang` setelah fix live. Ini kontrol yang membuktikan jalur tulis
sudah benar **sebelum** menyentuh 243.800 sel lain.
**MERAH bila**: masih `73867616.45999999` setelah `sync_state` domain `piutang` menunjukkan
`last_run_at` maju melewati waktu deploy → jangan lanjut ke backfill.

### P4 · Backfill per unit: unit yang dikerjakan → 0, unit lain → TIDAK BERGERAK
Urutan: **3 → 6 → 5 → 2 → 7 → 1 → 4** (kecil dulu; unit besar terakhir).

Untuk tiap unit U, tepat sebelum dijalankan, ukur ulang **T1_U** (hitungan sel `scale ≥ 5`
per tabel untuk unit U) **dan** hitungan untuk semua unit yang belum disentuh. Lalu:
- sesudah run: unit U = **0** sel;
- unit yang belum disentuh: **persis sama** dengan angka T1 yang baru diukur itu.

**MERAH bila**: unit U ≠ 0 (skrip sendiri sudah `EXCEPTION` + rollback), **atau** angka unit
lain bergerak — yang kedua berarti `-v units` tidak mengurung sasaran seperti yang diyakini,
dan itu **berhenti total**, bukan lanjut.

### P5 · Angka yang TAMPIL tidak bergerak
Satu tanggal per unit, diambil **sebelum & sesudah**, pada Laporan Operasional dan Rincian
Penjualan. Keduanya harus identik.
**MERAH bila**: ada satu angka bergeser → itu temuan (berarti ada jalur baca yang membaca
`numeric` tanpa cast, berlawanan dengan hasil investigasi) → **berhenti**, jangan lanjut ke
unit berikutnya.

## Pagar yang berlaku saat menjalankan

- `-v units="<U>"` **eksplisit** per unit — tanpa itu skrip ABORT sebelum menulis apa pun.
- `round(k, 4)`, **bukan** 2 desimal: `tera.liter` punya **10 nilai sah** ber-3/4 desimal.
- Pembersihan tak tuntas → `WARNING` + `EXCEPTION` + **rollback** (nol ter-commit).
- Dijalankan sebagai role pemilik `ingest` (FORCE RLS berlaku juga bagi pemilik).
- MySQL EasyMax **tidak disentuh**.
- Meleset di tengah = **berhenti**. Backfill separuh jalan yang konsisten per-unit jauh
  lebih mudah dipulihkan daripada tujuh unit yang setengah tersentuh.

---

# Tambahan pra-registrasi — tanggal uji P5 (dikunci 2026-08-06 22:43 WIB, sebelum langkah tulis)

Tanggal P5 tidak boleh dipilih sembarang: kalau tanggalnya **tidak memuat sel artefak**,
backfill tak mengubah apa pun di sana dan "angka tidak bergerak" jadi benar secara hampa.
Karena itu tiap unit memakai tanggal dengan **sel artefak terbanyak** dalam jendela
1 Jun–20 Jul 2026 (cukup lama untuk berada di luar jendela rescan harian, sehingga
pergeseran yang muncul berasal dari backfill, bukan dari sync yang sedang berjalan).

| unit | tanggal P5 | sel artefak pada tanggal itu | sumber |
| ---: | --- | ---: | --- |
| 1 | 2026-06-24 | 24 | `sales_detail` |
| 2 | 2026-06-11 | 18 | `sales_detail` |
| 3 | **2026-05-01** | 6 | `edc` — unit 3 **nol** artefak `sales_detail`, jadi tanggal ala unit lain akan vakum |
| 4 | 2026-06-21 | 23 | `sales_detail` |
| 5 | 2026-06-09 | 22 | `sales_detail` |
| 6 | 2026-06-10 | 10 | `sales_detail` |
| 7 | 2026-06-05 | 16 | `sales_detail` |

Alat: `apps/dashboard/p5-snapshot.mts` (probe untracked) memanggil **fungsi query dashboard
yang asli** (`getSalesByProduct`, `getDailyGlByProduct`, `getSaldoPelanggan`, dst.), bukan SQL
tiruan — supaya yang diuji benar-benar jalur baca halaman. Keluarannya JSON terurut tetap,
dibandingkan byte-per-byte sebelum vs sesudah.

Dua perangkap yang sudah ditutup di alat itu:
- tiga fungsi menerima `(from, to)`, bukan `date`; dipanggil dengan satu tanggal ia
  mengembalikan larik **kosong tanpa error** — dan dua snapshot kosong cocok sempurna;
- karena itu ada **pagar anti-vakum**: bila `sales` atau `gl` kosong, skrip keluar dengan
  kode 2 dan menolak dipakai sebagai bukti.

---

# HASIL (append-only — ditambahkan setelah tiap langkah)

## 2026-08-06 22:34–23:20 WIB — promosi ke pilot GAGAL MENDARAT; backfill TETAP TERKUNCI

**Nol langkah tulis dijalankan.** DB live tak tersentuh sama sekali.

PR promosi #194 di-merge owner (`06c8475`, 15:34:31Z). Pipeline `Deploy backend` dijalankan
tiga kali; tak satu pun menempatkan image fix pada traffic:

| percobaan | migrate-pilot | deploy-pilot | sebab |
| ---: | --- | --- | --- |
| 1 | **failure** | skipped | GitHub Actions gagal di *Prepare all required actions* (`Service Unavailable` → `Internal Server Error`) — **sebelum** `prisma-migrate` jalan |
| 2 | success | **failure** | tukar token WIF gagal: `Unable to retrieve Identity Pool subject token … reset reason: overflow` — `gcloud run deploy` tak pernah dieksekusi |
| 3 | success | **cancelled** | job menunggu 15 menit (16:01:32Z→16:16:32Z) tanpa satu langkah pun berjalan |

Percobaan 1 diverifikasi tidak menyentuh DB dengan **kontrol dua arah**: pencarian jejak
`prisma migrate|migration|cloud-sql-proxy|Applying migration` di log = **0**, sementara
kontrol positif (`workload_identity_provider`) = **1** → log-nya memang terbaca, dan memang
tak ada aktivitas migrasi.

### Temuan yang membatalkan prasyarat: CD hijau ≠ image baru menyajikan

`solamax-ingest-staging` traffic-nya **dipatok ke nama revisi**
(`{'percent': 100, 'revisionName': 'solamax-ingest-staging-00031-tk9'}`), bukan
`latestRevision`. Pada service yang dipatok, `gcloud run deploy --image` polos membuat revisi
baru lalu **membiarkan traffic** — dan mencetak baris yang terbaca seperti sukses:

> `Service [solamax-ingest-staging] revision [solamax-ingest-staging-00031-tk9] has been deployed and is serving 100 percent of traffic.`

padahal revisi yang ia buat adalah `-00032-mcl`. Label `serving.knative.dev/route` hanya
menempel di `-00031-tk9`.

**Kontrol yang membedakan**: `solamax-dashboard-staging` memakai `latestRevision: True` dan
sehat (revisi terbaru `-00082-ww5` serve). Dua layanan, satu desain CD — hanya yang dipatok
yang terkena. Jadi cacatnya di **state layanan**, bukan di YAML.

**Umur kebasian**, dari digest image yang ber-tag commit:
- serve sekarang: `-00031-tk9` = tag `1e6d069` = **PR #183, 5 Agu 16:17 WIB**;
- dibuat tapi mandek: `-00032-mcl` = tag `e2268fb` = **PR #188, 6 Agu 17:57 WIB** — promosi
  yang tampak hijau tapi tak pernah mendarat.

Langkah `Health check` tidak menutup celah ini: ia `curl` URL layanan, yang menyajikan revisi
**lama** — hijau justru karena revisi lama sehat.

### Status prediksi

- **P1** (sebelum fix live hitungan masih naik) — konsisten: 243.829 (21:50) → **243.859**
  (22:30). Belum ditutup; jalur tulis lama masih serve.
- **P2, P3, P4, P5** — **belum bisa diuji**. P3 adalah prasyarat backfill dan tak mungkin
  terpenuhi selama traffic terpatok di revisi pra-fix.

### Yang TIDAK dilakukan, dan alasannya

- Tidak memindahkan traffic dan tidak melepas pin: keduanya perubahan pada **pilot LIVE**,
  dan pin itu bisa jadi sisa rollback yang masih disengaja — melepasnya berisiko
  mengembalikan sesuatu yang sengaja ditahan.
- Tidak menekan approve environment `pilot` meski `gh` di mesin ini melaporkan
  `can_approve=true` — itu gerbang owner.
- Re-run dihentikan setelah percobaan ke-3: selama pin bertahan, deploy sukses pun tak
  membuat fix menyajikan, jadi re-run berikutnya tak membuka apa pun.


## 2026-08-07 00:05–00:40 WIB — fix TERBUKTI live; backfill 5 dari 7 unit; **BERHENTI pada P5 unit 7**

### P3 HIJAU — baris pemicu sembuh sendiri, tanpa satu pun tulisan manual
`bppiut PP2022100101473` (unit 1): `73867616.45999999` → **`73867616.46`**, ter-ingest
**00:05:20 WIB** pada sync penuh `piutang` unit 1 (`sync_state.last_run_at` 00:06:08).
Persis seperti yang dipra-registrasikan: domain `mode:"full"` menulis ulang sendiri.

### P2 HIJAU — dengan kontrol yang memisahkannya dari "nol data"
Laju penulisan `sales_detail` per jendela 15 menit:

| jendela WIB | baris ditulis | baris ber-artefak |
| --- | ---: | ---: |
| 06 Agu 23:15 | 66 | 12 |
| 06 Agu 23:30 | 1.032 | 68 |
| 06 Agu 23:45 | 2.454 | **259** |
| 07 Agu 00:00 | **1.056** | **0** |

Data terus mengalir sementara produksi artefak jatuh ke nol persis — keduanya diukur pada
baris yang sama, jadi tak bisa tertukar. **P1 tertutup**: laju kenaikan berhenti.

Efek samping yang menguntungkan: seluruh kelas `fullsync` (bppiut/bphut/terra_resmi/
real_tank/deposit) **sembuh sendiri 34 → 0** tanpa backfill, dan baris di dalam jendela
rescan ikut bersih sendiri (243.859 → 243.456 sebelum backfill dimulai).

### Kontrol dipertajam sebelum menulis (dan satu salah-baca yang tertangkap)
Pengukur pertama menghitung **baris**, sedangkan T0 menghitung **sel per kolom** — beda
satuan, dan sempat terbaca seperti penurunan 42.000 yang tak pernah terjadi. Diperbaiki ke
satuan sel sebelum dipakai.

Kontrol "unit lain tak bergerak" tidak bisa memakai total apa adanya: baris di dalam jendela
rescan **sembuh sendiri terus-menerus**, jadi total unit lain memang menyusut → MERAH palsu.
Kontrol dipersempit ke **baris bertanggal < 2026-06-01**, di luar semua jendela rescan
(sales/cash/tebus 7 hari, edc 5, pelanggan 3, unit 3 resync bulanan) — baris yang **hanya**
bisa berubah oleh backfill. Diverifikasi tidak vakum: tiap unit punya isi (terkecil unit 3 = 74).

### Hasil per unit (urutan pra-registrasi 3 → 6 → 5 → 2 → 7)

| unit | sel ditulis ulang | AFTER | kontrol unit-lain | P5 |
| ---: | ---: | ---: | --- | --- |
| 3 | 156 | 0 | ✓ enam unit identik | ✓ identik (5.023 B) |
| 6 | 13.540 | 0 | ✓ | ✓ identik (14.980 B) |
| 5 | 43.767 | 0 | ✓ | ✓ identik (8.047 B) |
| 2 | 37.437 | 0 | ✓ | ✓ identik (16.073 B) |
| 7 | 44.724 | 0 | ✓ | ❌ **BERGERAK** |

**Unit 1 dan 4 TIDAK dijalankan** — berhenti sesuai aturan.

### ❌ P5 unit 7 MERAH — temuan yang mengoreksi analisis awal

Satu nilai bergerak di bagian `pelanggan`:
`"liter": 151.48999999999998` → `"liter": 151.49` (selisih 2,84 × 10⁻¹⁴).

**Sebabnya mengoreksi klaim "jalur baca kebal karena `::float8`".** Klaim itu benar untuk
nilai TUNGGAL, tapi `getPelangganForDate` melakukan `COALESCE(sum(u.liter),0)::float8`
([queries.ts:1119](../apps/dashboard/src/lib/queries.ts#L1119)) — cast terjadi **sesudah
`sum()`**. Galat per-baris terakumulasi lebih dulu dalam aritmetika numeric yang eksak, lalu
jatuh ke double yang berbeda dari double nilai bersihnya. Jadi **agregat memang bisa
bergeser**, walau tiap nilai tunggalnya tidak.

**Arah pergeserannya menuju nilai BENAR** (…98 → 151,49): backfill membuat agregat lebih
tepat, bukan merusaknya.

**Tidak bisa mencapai layar.** `fmtL`/`idn` membulatkan saat render; diuji pada presisi
0,1,2,3,4,6 desimal — teksnya **identik di semuanya** ("151", "151,5", "151,49", …). Jadi
P5 sebagaimana diimplementasikan **lebih ketat** daripada "angka yang tampil": ia
membandingkan keluaran query sebelum pemformatan, dan justru karena itu ia menangkap
pergeseran 10⁻¹⁴ yang tak akan pernah terlihat pengguna.

Keempat unit sebelumnya lolos karena agregat pada tanggal sampelnya kebetulan jatuh ke
double yang sama — bukan karena pergeseran ini mustahil di sana.

### Status data saat berhenti

| unit | sel windowed tersisa |
| ---: | ---: |
| 1 | 46.805 |
| 2 | 0 |
| 3 | 0 |
| 4 | 56.923 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| **total** | **103.728** |

Kelas `fullsync` 0 di semua unit. Backfill unit 7 sudah **COMMIT** sebelum P5 dijalankan;
tidak di-rollback karena perubahannya menuju nilai benar dan tak terlihat di layar —
membatalkannya justru mengembalikan artefak.

### Menunggu keputusan owner
Lanjut ke unit 1 dan 4, atau tidak. Rekomendasi: **lanjut** — P5 MERAH ini menandai batas
yang lebih halus dari yang diantisipasi, bukan kerusakan.
