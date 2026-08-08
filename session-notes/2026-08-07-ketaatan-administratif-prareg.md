# Ketaatan Administratif — pra-registrasi prediksi (FASE 0, butir D)

Ditulis **SEBELUM** `EXPLAIN ANALYZE` dijalankan dan sebelum halaman diukur.
Kalau melesat, selisihnya dilaporkan apa adanya — bukan ceritanya yang disesuaikan.

## Beban query sekarang (dibaca dari kode, belum diukur)

`monitoring/ketaatan/page.tsx:30-36` — per unit 3 query paralel
(`getComplianceMatrix`, `getTankCount`, `getLastInputs`), 7 unit = **21 query**.
`getComplianceMatrix` sendiri = 3 sub-query berkorelasi × 14 baris `generate_series`.

## Prediksi (dikunci 2026-08-07, sebelum pengukuran)

| Besaran | Prediksi |
| --- | --- |
| P1 · EXPLAIN ANALYZE query A–I usulan, 1 unit × 14 hari | **150–400 ms** |
| P2 · indeks yang dipakai | index-scan pada `(unit_id, business_date)` untuk terra/pelanggan/voucher/edc; `sales_header (unit_id, dtgljual)` untuk A; `manual_entry_unit_id_business_date_section_idx` untuk F/G/I |
| P3 · perlu indeks BARU? | **tidak** — semua komponen sudah berkunci tanggal datar |
| P4 · render `/monitoring/ketaatan` SEKARANG, hangat | **0,8–1,5 dtk** |
| P5 · render `/monitoring/ketaatan` SEKARANG, dingin | **2,5–4,0 dtk** |
| P6 · render dengan indikator BARU, hangat | **1,2–2,0 dtk** (+1 query/unit, paralel dengan 3 yang sudah ada → tambahan ≈ query terlambat, bukan penjumlahan) |
| P7 · render dengan indikator BARU, dingin | **3,0–5,0 dtk** |
| P8 · delta hangat (baru − sekarang) | **+0,2 s … +0,6 s** |

## Alasan P6/P8

Query baru ditambahkan ke `Promise.all` yang sudah ada → wall-clock naik hanya
bila query baru lebih lambat dari `getComplianceMatrix` (query terlambat saat ini).
Karena A memindai `sales_detail` (tabel terbesar, 159k+ baris/unit) sementara
`getComplianceMatrix` hanya `count()` pada `sales_header`, saya menduga query baru
**akan** jadi jalur kritis yang baru — karena itu P8 positif, bukan nol.

## Risiko yang saya duga akan mengejutkan saya

- Komponen A (`sales_detail JOIN sales_header`) 14 hari bisa jauh lebih mahal dari
  dugaan bila join-nya tidak ber-index pada `ckdjualbbm`.
- Pool: 7 unit × 4 query = 28 koneksi diminta terhadap `max: 10` → antre.
  Ini persisnya mekanisme PR #31 / PR #160. Perlu diperiksa, bukan diasumsikan aman.

---

## HASIL — diisi setelah pengukuran (2026-08-07)

| | Prediksi | Terukur | Verdict |
| --- | --- | --- | --- |
| P1 query A–I, 1 unit × 14 hr | 150–400 ms | **7,8–20 ms hangat** (7–114 ms dingin) | ❌ **meleset 10–20×, terlalu pesimis** |
| P2 indeks | index scan semua sumber | benar, KECUALI `manual_entry` → Seq Scan (428 baris; planner benar) | ⚠️ hampir |
| P3 indeks baru | tidak perlu | tidak perlu | ✅ |
| P8 delta fan-out 7 unit, hangat | +200…+600 ms | **+188 ms** (1.576 → 1.764 ms) | ⚠️ **tepat di bawah pita** |
| P4–P7 render halaman | 0,8–5,0 dtk | **BELUM DIUKUR** — rute di balik OAuth, butuh deploy staging | ⏳ |

### Premis yang salah, bukan cuma angkanya

Saya menduga query A–I akan jadi jalur kritis baru karena memindai `sales_detail`.
Yang benar: **`getComplianceMatrix` lama sendiri 166–325 ms/unit hangat** — 15–40×
lebih mahal dari query baru — karena tiga sub-query BERKORELASI dijalankan 14×
per unit, didominasi pemindaian `opname`. Query baru bersembunyi di baliknya.

### Caveat pengukuran

Semua angka dari **Mac lewat cloud-sql-proxy ke asia-southeast2** → mengandung RTT
internet yang TIDAK dialami Cloud Run se-region. Pembanding lama (1.576 ms) diukur
dengan harness `pg` mentah, yang baru (1.764 ms) lewat kode produksi di vitest —
tidak sepenuhnya setara. Angka yang mengikat = pengukuran pasca-deploy staging.

### Bug yang tertangkap HANYA oleh tes DB-live

`count(*)::int FILTER (WHERE …)` adalah sintaks Postgres yang TIDAK VALID (cast
harus membungkus: `(count(*) FILTER (…))::int`). `pnpm check` **hijau penuh**
dengan bug ini di dalamnya, karena tak satu pun unit test menyentuh DB. Halaman
Ketaatan akan 500 di staging. Ditemukan `ketaatan-live.integration.test.ts`.

---

## KOREKSI & BASELINE — dari rekaman produksi owner (2026-08-07, pra-promosi)

### 1. Koreksi klaim yang lebih kuat dari buktinya

Saya menulis "Board dan halaman Ketaatan **hari ini sudah** menceritakan dua cerita
berbeda". **Itu overclaim.** Owner memuat `/monitoring/ketaatan` produksi tiga kali
berturut-turut; ketiganya menghasilkan `2017-08-24` — minimum yang benar, identik
dengan hitungan `anomalies.ts`. Divergensinya **mungkin secara konstruksi, TIDAK
teramati pada n=3**.

Yang salah **tanpa syarat** dan tetap berdiri: tanggal itu milik **Bundaran
Kotabaru**, tapi strip melabelinya **"SEMUA UNIT"**. Label salah adalah fakta;
non-determinisme adalah risiko yang belum terwujud.

### 2. BASELINE PRA-PERUBAHAN — indikator lama tidak pernah bersinyal

Rekaman owner: heatmap produksi **7 unit × 14 hari = 98 sel, SEMUANYA HIJAU**.
Nol kuning, nol merah. Itu pembenaran terkuat untuk perubahan ini dan **tidak ada
di laporan Fase 0 saya** — kelewatan saya.

Reproduksi saya (2026-08-07 13:46 WIB, kode produksi, DB pilot) memberi **91 hijau
+ 7 merah**, bukan 98 hijau. Ketujuh merah itu tepat kolom **hari berjalan
2026-08-07**, yang pada pukul 13:46 masih `0 shift / 0 opname` di ketujuh unit
(EasyMax menulis `sales_header` saat shift TUTUP).

⚠️ **KOREKSI PENJELASAN (owner, 2026-08-07).** Saya menduga rekaman owner diambil
ketika "hari ini" masih 2026-08-06. **Salah** — rekamannya juga 08-07, label harinya
sampai `07`. Yang sebenarnya terjadi: ketujuh sel hari berjalan dirender **bergaris
putus** (`.hm-cell.today`, outline dashed) dan **terhitung hijau saat dibaca mata**.
Jadi angkanya 91, penjelasan saya tentang KENAPA keliru. Dicatat karena tebakan yang
kebetulan mendarat di angka benar tetap tebakan.

Ini juga temuan desain kecil: sel merah bergaris putus **tidak terbaca sebagai merah**
oleh pembaca manusia. Relevan untuk verifikasi visual Fase 3.

Untuk **91 sel yang sudah settle, klaim owner terkonfirmasi bulat: 91/91 hijau =
nol sinyal dalam 13 hari.**

### 3. Sel yang berubah warna di bawah aturan BARU — jawabannya BUKAN nol

Atas 91 sel settle yang sama:

| | LAMA | BARU |
| --- | ---: | ---: |
| hijau | **91** | 38 |
| kuning | 0 | 6 |
| merah | 0 | **47** |

**53 dari 91 sel (58%) berubah warna.** Rincian: 46 `belum_diisi`, 6 `lebih_setor`
(termasuk Bakau 2026-08-06 **+3.362.265** yang belum pernah terlihat), 1
`kurang_setor` (IB 2026-08-03 **−476.993**). Indikator baru bersinyal; ia tidak
mengganti buta dengan buta.

### 4. ⚠️ TAPI — 83% merahnya adalah PRA-ADOPSI, bukan kelalaian

Tanggal pemakaian pertama `app.manual_entry` per unit:

| Unit | Entri pertama | Sel merah | Pra-adopsi? |
| --- | --- | ---: | --- |
| Imam Bonjol | 2026-06-21 | 1 | tidak (kurang setor nyata) |
| Bakau | 2026-07-08 | 0 | — |
| Adisucipto | 2026-07-16 | 7 | **tidak** — celah asli pasca-adopsi |
| Bundaran Kotabaru | 2026-08-02 | 8 | **ya, semua** |
| Batu Layang | 2026-08-03 | 9 | **ya, semua** |
| Korek | 2026-08-06 | 12 | **ya, semua** |
| 28 Oktober | 2026-08-04 | 10 | **ya, semua** |

**39 dari 47 sel merah (83%) mendahului entri manual PERTAMA unit itu.** Bukan
pengawas lalai — fiturnya memang belum dipakai di sana. Tanpa penanganan, papan
pilot menyala merah pada hari promosi karena alasan yang bukan pelanggaran; itu
penyakit "melatih orang mengabaikan alarm" yang SAMA, cuma bentuk baru.

Usulan (BELUM dikerjakan, menunggu keputusan owner): **lantai adopsi** — jangan
nilai hari sebelum `min(business_date)` unit ybs. Efeknya pada data sekarang:
47 → **8 sel merah** (7 Adisucipto + 1 IB), semuanya celah asli.

### 5. Badge sidebar — premis kami berdua meleset

Badge sudah menunjukkan **"9+"** sekarang. Menambah 0–1 item merah **tidak akan
terlihat**. Peringatan saya di PR #202 benar secara mekanis tapi tak berarti secara
praktis: anomali administrasi baru TIDAK akan tampak di badge. Badge yang mentok
9+ adalah isu tersendiri — diusulkan, tidak dikerjakan.


---

## PRA-REGISTRASI LANTAI ADOPSI — dikunci 2026-08-07 SEBELUM menulis kode

Konteks: PR #203 sudah di-merge 13:51 WIB dan ter-deploy ke pilot. 47 sel merah
terkonfirmasi owner di papan live. Ini perbaikan PRODUKSI HIDUP, bukan pra-rilis.
Papan dilihat **21 pengguna yang semuanya sudah pernah login**, termasuk pengawas
tiap unit DAN direksi — orang yang dituduh papan itu bisa melihatnya sekarang.

Keputusan owner: lantai adopsi = **tanggal BEKU di config**, bukan `min()` hidup.
Alasan: `min()` hidup membuat masa lalu bisa berubah sendiri — satu entri
bertanggal mundur menurunkan lantai dan mengubah sederet hari netral jadi merah
surut. Indikator yang riwayatnya bergerak akan berhenti dipercaya.

### Prediksi (dikunci sebelum pengukuran)

Jendela pembanding **TETAP**: 91 sel settle `2026-07-25 … 2026-08-06`, 7 unit.

| # | Prediksi |
| --- | --- |
| L1 | sel MERAH: **47 → 8** (7 Adisucipto pasca-adopsi + 1 IB `kurang_setor`) |
| L2 | sel KUNING: **tetap 6** — lantai tak boleh menyentuh satu pun `lebih_setor` |
| L3 | sel `pra_adopsi` (netral bernama): **39** |
| L4 | Bakau 2026-08-06 `lebih_setor` **+3.362.265** → TETAP tertangkap |
| L5 | IB 2026-08-03 `kurang_setor` **−476.993** → TETAP tertangkap |
| L6 | total sel hijau: 38 → **38** (tak berubah; merah/kuning yang jadi netral) |

**Kalau L4 atau L5 gugur, lantainya SALAH dan lebih buruk daripada tidak ada.**

### Tiga syarat mengikat (owner)

1. **Non-adopsi harus tetap terlihat.** Unit tanpa tanggal adopsi TIDAK boleh jadi
   sederet sel netral yang diam — itu kegagalan indikator kas lama terbalik: dulu
   selalu merah dan tak bisa diselesaikan, sekarang selalu netral dan tak bisa
   memburuk. Status tersendiri yang menyuarakan dirinya.
2. **Unit tak terdaftar di config harus GAGAL NYARING.** Cabang default tak boleh
   "netral" atau "hijau" — keduanya berbohong.
3. **Sel pra-adopsi harus TERBACA** — state netral bernama + penjelasan, bukan
   kosong tanpa keterangan (yang akan dibaca sebagai bug).

### HASIL LANTAI ADOPSI — diukur setelah kode ditulis (jendela TETAP 91 sel)

| # | Prediksi | Terukur | Verdict |
| --- | --- | --- | --- |
| L1 | merah 47 → **8** | **8** (7 `belum_diisi` Adisucipto + 1 `kurang_setor` IB) | ✅ **tepat** |
| L2 | kuning tetap **6** | **6** | ✅ **tepat** |
| L3 | `pra_adopsi` **39** | **39** | ✅ **tepat** |
| L4 | Bakau 08-06 `lebih_setor` +3.362.265 tertangkap | `lebih_setor`, I−H = **+3.362.265** | ✅ |
| L5 | IB 08-03 `kurang_setor` −476.993 tertangkap | `kurang_setor`, I−H = **−476.993** | ✅ |
| L6 | hijau **38**, tak berubah | **38** (hitungan DOM owner) | ✅ **TEPAT — dua pengukuran saya yang gagal** |

⚠️ **KEKELIRUAN METRIK YANG HAMPIR SAYA LAPORKAN SEBAGAI KEBENARAN.** Pengukuran
pertama saya menghitung `adminStatus().tone`, BUKAN warna sel yang benar-benar
dirender. Keduanya berbeda: sel `pending` mengambil `tone` dasar dari sales/opname
(→ `success`) tetapi dirender lewat `pendingKind` sebagai kelas `pending`. Angka
baseline "38 hijau" yang saya kunci di L6 ternyata **artefak metrik itu** — ia
memasukkan 1 sel `belum_tempo_kosong` (2026-08-06, D+1) sebagai hijau. Warna
terender yang sebenarnya, sebelum DAN sesudah lantai, adalah **37 hijau**.

### L6 — PREDIKSINYA TEPAT; DUA PENGUKURAN SAYA YANG GAGAL

Owner menghitung kelas CSS ke-98 sel langsung dari DOM papan live (15:39 WIB):
`danger` **8** · `warning` **6** · `pending pra-adopsi` **39** · `success` **38**.
**Prediksi L6 = 38 TEPAT.**

Riwayat kegagalan saya, dicatat lengkap karena yang kedua lebih berbahaya:

1. **Pengukuran-1** menghitung `adminStatus().tone` → "hijau 37". Itu bukan warna
   sel terender: `tone` bisa `green` sementara kelas terender ditentukan
   `pendingKind`, dan sebaliknya.
2. **Pengukuran-2** menghitung `agg()` → "hijau 77". Juga bukan warna terender —
   ia mengabaikan `pendingKind` seluruhnya.
3. Lalu saya memakai hasil-1 untuk **MEMBATALKAN prediksi yang sudah tepat**, dan
   membungkusnya sebagai pelajaran metodologi yang terdengar meyakinkan
   ("metrik salah, bukan prediksi meleset"). Kalimatnya benar sebagai prinsip;
   penerapannya terbalik — yang salah memang metriknya, tapi korbannya adalah
   pengukuran saya, BUKAN prediksinya.

**Sebuah koreksi adalah KLAIM BARU.** Ia menanggung beban pembuktian yang sama
dengan klaim yang dikoreksinya. Saya memberi koreksi saya nol pemeriksaan.

### ⛔ LANGKAH WAJIB — jumlah kategori HARUS sama dengan total

Kontrol termurah yang tersedia akan menangkap ini dalam sepuluh detik:

    8 + 6 + 39 + 37 = 90  ≠  91   ← pengukuran saya, TIDAK menjumlah
    8 + 6 + 39 + 38 = 91  ✓        ← prediksi, menjumlah pas

Tidak butuh layar, tidak butuh DB, tidak butuh akses apa pun. **Setiap kali
melaporkan komposisi papan (atau komposisi apa pun), jumlahkan kategorinya dan
bandingkan dengan totalnya SEBELUM melaporkan.** Kalau tak sama, laporannya salah
— tak peduli seberapa masuk akal ceritanya.

### Keputusan lantai: hari adopsi IKUT dinilai

Perbandingan `businessDate < adopsi` (bukan `<=`) → hari pertama unit memakai
panel SUDAH dinilai. IB 2026-06-21 (pola `FG·`, tanpa setoran) karenanya MERAH.
Ditimbang dua sisi dan sengaja dipertahankan; alasannya ditulis di doc-comment
`ADOPSI_RINCIAN` supaya terbaca sebagai keputusan, bukan kebetulan.

Akurasi: 2026-06-21 **di luar** jendela 14 hari yang berjalan, jadi ia bukan
salah satu dari 8 sel merah terukur (8 = 7 Adisucipto + 1 IB `kurang_setor`
2026-08-03).

Warna terender, 91 sel settle:

| | sebelum lantai | sesudah lantai |
| --- | ---: | ---: |
| merah | **47** | **8** |
| kuning | 6 | 6 |
| hijau | 37 | 37 |
| netral | 1 (`belum_tempo`) | **40** (1 tempo + 39 `pra_adopsi`) |

### Uji mutasi lantai adopsi — 7 titik, semuanya bisa MERAH

`config_hilang`→netral · `config_hilang`→hijau · `belum_adopsi`→netral diam ·
lantai dimatikan · batas lantai digeser (`<` → `<=`) · lantai dilebarkan sampai
menelan L4/L5 · satu unit dihapus dari `ADOPSI_RINCIAN`. Pohon bersih hijau.

### Korek 2026-08-07 — belum bisa diukur, dan kenapa

Item Fase 3 ini **tidak bisa diselesaikan hari ini**: 2026-08-07 masih hari
berjalan, dan EasyMax menulis `sales_header` saat shift TUTUP. Pukul 13:46 WIB
ketujuh unit masih `0 shift`. Selisih Rp 355,9 juta baru bermakna setelah hari
itu settle, yaitu 2026-08-08. Dilaporkan setelah promosi, apa pun hasilnya.

---

## TEMUAN PAPAN HIDUP (owner, 2026-08-07 pasca-promosi 15:39 WIB)

Verifikasi owner: kelas CSS ke-98 sel diambil dari DOM + `aria-label` tanggalnya.
`danger` 8 · `warning` 6 · `pending pra-adopsi` 39 · `success` 38 → **91 sel settle
+ 7 sel kolom 08-07 = 98** ✓. L1/L2/L3 tepat; delapan merahnya persis Adisucipto
07-27…08-02 + IB 08-03.

### T1 · Teks kaki halaman BERBOHONG (diperbaiki)

Teks lama: "dua kolom terkanan belum dinilai". Di layar hanya kolom **08-07** yang
ber-kelas `pending`; **seluruh kolom 08-06 dinilai penuh**.

Sebabnya di `adminStatus`: `belumTempo` hanya melindungi cabang **yang KOSONG**.
Begitu hari terisi, ia langsung dinilai tanpa memandang jatuh tempo — **hari yang
belum jatuh tempo BISA menyala merah**.

**Keputusan owner: perilakunya BENAR, teksnya yang salah.** Umpan balik seketika
bagi pengawas yang sudah mengisi justru nilai "real-time" yang dikejar papan ini;
menahannya sampai lusa membunuh manfaat itu. `adminStatus` TIDAK disentuh.

Dikerjakan: teks kaki ditulis ulang jujur + **4 tes** mengunci perilakunya
(belum-tempo + kurang setor → MERAH; + lebih setor → kuning; + selaras → hijau;
hanya hari KOSONG yang ditahan). Dulu efek samping urutan cabang yang tak
tertulis, sekarang keputusan yang dijaga. Uji mutasi dua arah: menahan semua hari
belum-tempo → 4 tes merah; mencabut proteksi hari kosong → 3 tes merah.

### T2 · `tempo-terisi` punya NOL contoh di layar (dibuang)

Konsekuensi langsung T1: kalau hari terisi langsung dinilai, `belum_tempo_terisi`
hanya tersisa untuk kasus sempit (F/G ada, setoran masih null). Diukur:

| Ukuran | Hasil |
| --- | --- |
| unit-hari 30 hr yang BERAKHIR dengan F/G tanpa setoran | **0 dari 86** |
| jeda F/G → setoran, median | **2,7 menit** |
| jeda F/G → setoran, p95 | 17 menit |

Status itu hidup **median 2,7 menit** per unit-hari dan tak pernah bertahan sampai
akhir hari. Legenda yang memuat kotak seumur itu melatih orang berhenti membaca
legenda. **Dibuang dari legenda; varian visual `tempo-terisi` dihapus** (CSS +
`pendingKind`). Kode status `belum_tempo_terisi` TETAP ADA di `compliance.ts`
(keadaan logis yang sah, punya teks penjelas sendiri) tapi dirender arsir yang
sama dengan `tempo`.

Sinyal "siapa sudah mengisi hari ini" **tidak hilang** — justru jadi lebih kuat:
hari yang sudah diisi meninggalkan keadaan arsir sama sekali dan menampilkan
verdict aslinya (hijau/kuning/merah).

### T3 · Kolom hari ini TIDAK terpotong — dan itu memperburuk, bukan memperbaiki

Dugaan owner bahwa kolom 08-07 terpotong: **salah**, lebarnya 30px penuh sama
seperti kolom lain (diukur owner, tak perlu diukur ulang). Ia hanya TERLIHAT
seperti serpihan karena gayanya pucat. **Sel berukuran penuh yang terbaca sebagai
ruang kosong** — memperkuat kekhawatiran legibilitas. Masuk pemeriksaan mata
bersama tiga varian netral lainnya.

---

## FASE 3 — pengukuran render (diukur OWNER, jalur jaringan nyata)

Bukan proxy dari Mac ke asia-southeast2 — ini yang benar-benar dialami pengawas.
Halaman ini RSC streaming, jadi angka bermaknanya `responseEnd`, bukan TTFB
(TTFB 50–70 ms dan menyesatkan).

    muat 1 (dingin) 6.592 ms · 2.468 · 2.026 · 1.713 · 1.685 (plateau)

| | Prediksi terkunci | Terukur | |
| --- | --- | --- | --- |
| P6 hangat | 1,2–2,0 dtk | **1,69–1,71 dtk** | ✅ di dalam pita |
| P7 dingin | 3,0–5,0 dtk | **6,59 dtk** | ❌ meleset ~32% di atas plafon (n=1) |

### P4/P5 — HANGUS, jendela tertutup oleh promosi

**Bukan "belum diukur" — tidak akan pernah diukur.** Keduanya mengukur render
indikator **LAMA**, dan kode itu meninggalkan pilot pukul 15:39 WIB saat promosi.
Konsekuensi yang bisa diramalkan dari keputusan "perbaiki cepat, jangan rollback"
— bukan kelalaian. Dihapus dari daftar tugas: pengukuran yang tak akan pernah
datang harus berhenti muncul sebagai pekerjaan tertunda.

## ANATOMI 6,6 DETIK "DINGIN" — diukur, bukan diduga

Ketiga tersangka diukur TERPISAH terhadap DB pilot (kode produksi):

| Komponen | Di mana | Terukur (3 kali) |
| --- | --- | ---: |
| A · `getSyncByUnit` | layout `(app)` | 183 / 173 / 141 ms |
| B · `buildAnomalies` **tak ber-cache** | layout `(app)`, badge sidebar | **7.741 / 5.384 / 5.594 ms** |
| C · 2 query × 7 unit | halaman Ketaatan sendiri | 1.852 / 1.679 / 1.665 ms |

Rekonstruksi: hangat ≈ A + C ≈ **1,8 dtk** (owner: 1,69–1,71) · dingin ≈ A + B + C
≈ **7,2 dtk** (owner: 6,59). Angka saya sedikit lebih tinggi karena mengandung RTT
proxy dari Mac; selisihnya kecil, jadi **tak ada suku besar yang tak terjelaskan.**

### Ketiga tersangka, dihakimi

1. **Cloud Run dingin — BUKAN penyebabnya.** `minScale=1` (terverifikasi
   `gcloud run services describe`): selalu ada instance hidup. `maxScale=2`,
   `startup-cpu-boost=true`. Sisa yang tak terjelaskan setelah B+C hampir nol,
   jadi suku kontainer kecil.
2. **Cache kedaluwarsa — INI penyebabnya.** `getAnomalies` ber-`unstable_cache`
   TTL **120 detik** (`ANOMALIES_TTL_S`). Halaman Ketaatan sendiri **tidak**
   memakai cache apa pun (`force-dynamic`).
3. **Query DB dingin — bukan.** C stabil 1,67–1,85 dtk; B stabil 5,4–5,6 dtk
   setelah muat pertama. Tak ada efek cache-DB yang besar.

### ⛔ KLAIM FREKUENSI SAYA DIBANTAH OLEH DATA PRODUKSI

**Yang saya tulis pertama:** `/monitoring/ketaatan` realtime → AutoRefresh 60 dtk,
TTL anomali 120 dtk → "~5 detik tersendat setiap dua menit, selamanya, untuk
siapa pun yang tab-nya terbuka".

**Itu ARITMETIKA TTL, bukan pengamatan — dan pengamatan membantahnya.** Owner
memuat halaman setelah jeda jauh lebih lama dari 120 dtk dan mendapat 1.713 ms
(hangat). Pola yang sama dengan koreksi L6: kesimpulan yang terdengar kuat,
dibangun di atas satu angka yang tak diperiksa asal-usulnya.

Dua cacat, keduanya milik saya:
1. **Sampel 6,59 dtk diambil tak lama setelah deploy 15:39** — itu permintaan
   PERTAMA ke revisi baru, jadi **dingin-DEPLOY, bukan dingin-CACHE**. Saya
   memakai angka owner tanpa memeriksa asal dinginnya.
2. **21 pengguna × AutoRefresh** → satu tab siapa pun yang terbuka menjaga cache
   hangat; TTL tak pernah sempat habis selama ada aktivitas.

### KEBERSIHAN DATA — pengamat dikeluarkan dari pengamatan

Trafik pengukuran owner ada di log dan dikenali dari query param
(`?s=1..4`, `?t=cold`, `?r=1..2`, `?m=`): **13 permintaan**, dibuang sebelum
menghitung apa pun tentang perilaku pengguna. Kali ini tak mengubah kesimpulan;
analisis yang memasukkan pengamatnya sendiri terkontaminasi sejak awal.

### DENOMINATOR SAYA SALAH — dan itu mengubah kesimpulan, bukan cuma angkanya

Filter saya: `resource.type="cloud_run_revision"`, service
`solamax-dashboard-staging`, `httpRequest.status=200`, membuang
`/(brand|_next|api)/` dan berkas statis. Cakupannya **SELURUH halaman `(app)`**,
bukan `/monitoring/ketaatan` saja.

Cacatnya: filter itu **memasukkan prefetch RSC** (`?_rsc=`), yang murah dan bukan
render sungguhan.

| | n | median |
| --- | ---: | ---: |
| prefetch RSC (`?_rsc=`) | **987** | 0,058 dtk |
| **dokumen penuh (render sungguhan)** | **201** | 0,644 dtk |
| di antaranya `/monitoring/ketaatan` | **7** | — |

Jadi rasio "2,34%" dihitung atas denominator yang **diencerkan ~5×** oleh
prefetch. Angka yang benar:

**21 dari 201 render dokumen ≥ 4 dtk = 10,4%** (bukan 2,34%).

Laju trafik: **4,2 dokumen/jam** selama 47,5 jam — cocok dengan hitungan owner
(~5/jam), dan **`/monitoring/ketaatan` cuma 7 render dalam 47,5 jam (0,1/jam)**.

⛔ **Konsekuensi yang lebih penting dari rasionya:** 7 render dalam dua hari
berarti **TIDAK ADA orang yang tab-nya tertinggal terbuka di halaman ini**.
Premis saya "tersendat bagi siapa pun yang membiarkan tab terbuka" bukan cuma tak
terbukti — pola trafiknya menunjukkan **kebalikannya**.

### MEKANISMENYA MELEKAT PADA INSTANCE, BUKAN PADA CACHE

Dugaan `stale-while-revalidate` saya **dicabut** — tak diperlukan. `labels.instanceId`
menjelaskan seluruh polanya, dan bisa ditunjukkan alih-alih dikira-kira.

**17 dari 21 render dokumen lambat terjadi dalam 120 detik setelah instance-nya
LAHIR atau BANGUN dari idle panjang.** Sisanya menyusul pada instance yang sama
di menit-menit berikutnya. Render lambat datang **berkelompok pada satu instance**,
bukan tersebar acak menurut jam.

Kontrol yang diperketat (hanya dokumen penuh): render <2 dtk setelah idle >15
menit ada **6** — tapi empat di antaranya `/login` dan `/icon.svg` (tak menarik
data sama sekali) dan dua sisanya halaman hub `/` (1,70 dan 1,50 dtk). Jadi idle
panjang **tidak otomatis** berarti lambat; yang mahal adalah **halaman berat di
instance yang belum panas**.

Catatan kejujuran: instance yang baru lahir juga punya cache KOSONG, jadi pada
permintaan pertama kedua penjelasan **berimpit** dan data ini tak bisa
memisahkannya. Tapi kasus "idle lalu lambat" **tak terjelaskan oleh cache sama
sekali** (cache-nya masih terisi), sementara identitas instance menjelaskan
keduanya — dan ia **teramati**, bukan disimpulkan.

### KOREKSI: klaster 18:48 BUKAN kontensi pool

Atribusi saya sebelumnya ("beberapa render serentak berebut pool `max: 10`)
**salah dan tanpa bukti**. Keempatnya ada di **satu instance …378083** yang
baru lahir:

| waktu WIB | latensi | umur instance |
| --- | ---: | --- |
| 18:48:19 | **14,37 dtk** | permintaan **PERTAMA** |
| 18:48:20 | 4,91 dtk | +0,8 dtk |
| 18:48:20 | 13,73 dtk | +0,8 dtk |
| 18:48:25 | 8,99 dtk | +5,8 dtk |

Deploy #208 selesai 11:46:59Z; keempatnya 80–146 detik sesudahnya. Permintaan
owner 55 detik kemudian **di instance yang sama: 1,616 dtk**. Itu cold start,
titik.

### Ringkasan jujur — P7 DITUTUP

- **Biaya per-miss 5,4–7,7 dtk** — terukur langsung, tetap sah.
- **Frekuensi: 10,4% render dokumen ≥4 dtk**, terkonsentrasi pada instance yang
  baru lahir/bangun. **Bukan tiap 120 detik**; TTL cache tidak menjelaskan apa pun.
- **Trafik `/monitoring/ketaatan` 0,1 render/jam** — tak ada tab yang ditinggal
  terbuka.

### Konsekuensi untuk prioritas

Dengan mekanisme = **cold start / instance idle** dan trafik ~5 render/jam,
obatnya **bukan lagi soal cache**. Yang relevan: `minScale`, CPU-always-on, dan
**ukuran kerja yang dilakukan di jalur kritis layout**.

**"Keluarkan badge dari jalur kritis" tetap paling menyerang akar — dan
argumennya kini LEBIH KUAT dari yang saya pakai sebelumnya:** ia mengecilkan
biaya *cold start* untuk **SEMUA** halaman `(app)`, bukan sekadar menghindari
satu cache miss di satu halaman. Tidak dikerjakan; dicatat.

### Pre-warm 06:00 WIB — TIDAK bisa dipakai ulang, dan sebabnya bukan plumbing

`/api/warm-board` + `board-warm.ts` mengisi `getDailyGlWindow` (TTL **24 jam**)
dan cache saldo. Mekanismenya cocok — panggil fungsi ber-cache dengan key
identik. **Tapi TTL anomali 120 DETIK.** Pre-warm sekali sehari akan menghangatkan
cache selama dua menit lalu dingin lagi. Ketidakcocokannya **TTL, bukan pipa**;
memasang pre-warm di sini akan jadi teater.

### Usulan — BELUM dikerjakan, menunggu keputusan owner

Diurutkan dari yang paling menyerang akar:

1. **Keluarkan badge dari jalur kritis layout** (Suspense/streaming): shell tayang
   segera, badge menyusul. Menyembuhkan SEMUA halaman `(app)`, bukan cuma ini.
2. **Murahkan `buildAnomalies`**: loop unit SERIAL × 8 query paralel = 56 query.
   `getAdminDays` sudah membuktikan pola multi-unit satu-query bisa (7→1). Komentar
   `ANOMALIES_TTL_S` menolak ini pada 2026-07-24 karena berarti menulis ulang
   `getDailyGlByProduct`; itu **masih** alasan yang sah.
3. ~~**Naikkan TTL** (120 → 600 dtk)~~ — **DICORET**. Mekanismenya cold start /
   instance idle, bukan kedaluwarsa cache; menaikkan TTL tak menyentuh apa pun.
4. **Pertanyakan badge-nya sendiri.** Ia mentok "9+" dan tak bisa menampilkan
   sinyal baru. Kalau tampilannya diperbaiki dulu, biaya 5,4 dtk mungkin sedang
   dibayar untuk sesuatu yang bentuknya salah sejak awal.

---

## PENILAIAN VARIAN SEL — LULUS (dikerjakan owner, jangan diulang)

Diuji pada **1456px** dan **1034px** (lebar tempat owner dulu salah baca):

- `pra-adopsi` = isian pucat rata, border **bertitik**
- `belum diisi · belum tempo` = **berarsir diagonal**, border putus-putus
- sel berwarna di kolom hari ini tampil **tegas** (Korek 07 oranye jelas)

**Arsiran itu obatnya.** Objektif: `danger` dan `danger today` menghasilkan isian
merah **IDENTIK** (`rgb(185,28,28)`) — `today` tak lagi mengencerkan warna.
**Mode kegagalan lama (sel merah terbaca hijau) TERTUTUP.**

### Batas yang diketahui (arsip, bukan tugas)

Kedua isian netral hanya beda **~2% luminansi** (`rgb(239,239,239)` vs
`rgb(245,245,247)`); **seluruh pembedanya bertumpu pada gaya border dan tekstur**.
Aman di desktop; **belum diuji di ponsel atau di bawah silau**.

---

## REKONSILIASI KOREK — replika saya TIDAK menyimpang; datanya bergerak (ketiga kali)

Owner membaca layar Rincian beberapa menit setelah pembacaan saya dan mendapat
H berbeda ~Rp 3,98 juta. Dua kemungkinan, dan bedanya besar: **data bergerak
lagi**, atau **replika query saya menyimpang dari model produksi**.

**Eksperimen penentu:** jalankan KEDUA model PRODUKSI (`getAdminDays` — dipakai
Ketaatan & feed anomali — dan `buildRincianModel` — dipakai layar Rincian & PDF)
berturut-turut dalam satu snapshot, lalu bandingkan.

```
SNAP 2026-08-07 22:15:22 → 22:15:23 WIB
ADMIN   A=294.467.294,5  B=0  C=17.999.091  D=9.798.025  F=4.205.200  G=618.000
ADMIN   H=270.257.378,5
RINCIAN H=Rp 270.257.379
DELTA H = 0
```

**Kedua model produksi identik.** Replika saya tidak menyimpang.

Yang bergerak, terkuantifikasi:

| waktu | A | C | H |
| --- | ---: | ---: | ---: |
| 21:52 (saya) | 294.217.252,50 | 14.017.450 | 273.988.977,50 |
| ~22:0x (layar owner) | 294.217.253 | — | 270.007.337 |
| 22:15 (produksi ×2) | 294.467.294,50 | 17.999.091 | 270.257.378,50 |

Selisih owner-vs-saya **3.981.640,50**; pertumbuhan C **3.981.641,00**. Beda
**Rp 0,50** — artefak pembulatan `rp()` di layar. **Cocok.** Sisanya (250.042)
adalah pertumbuhan A.

`pelanggan_sale`/`voucher_sale` punya watermark sendiri, jadi C bertambah tanpa
menunggu shift tutup. **Pelajaran yang saya bayar untuk kedua kalinya:** angka
dari populasi yang sedang bergerak harus **dibekukan snapshot-nya** sebelum
dilaporkan — sama seperti episode n=95/96/97.

---

## GERBANG SHIFT — perbaikan pagi menutup KASUS, bukan KELASNYA

Bukti hidupnya ada di papan: Korek 2026-08-07 pukul 22:15, **2 dari 3 shift**,
menulis **"⚠ Setoran MELEBIHI uang tunai Rp 89.189.622"**. Penyebabnya IDENTIK
dengan artefak Rp 355,9 juta pukul 13:46 — ingest parsial — hanya lebih kecil
karena lebih banyak data sudah masuk. `tak_terhitung` tak menangkapnya karena ia
hanya menguji `shifts <= 0`: begitu shift PERTAMA tutup, hari itu dinilai seolah
lengkap.

Saya menemukan kasus nol-shift dan menutup kasus nol-shift. **Kelasnya adalah
"H masih dirakit".**

### Keputusan owner, dilaksanakan

`shifts <= 0` → **`shifts < SHIFT_TARGET`** dengan `SHIFT_TARGET = 3` — angka
yang **sudah** dipakai `salesStatus`, kini satu konstanta bersama, jadi tak ada
asumsi baru yang diperkenalkan.

"Hari yang sudah diisi dinilai SEKETIKA" **TETAP UTUH** untuk hari yang datanya
lengkap. Yang ditahan hanya perbandingan I-vs-H selama H masih dirakit — itu
bukan pengecualian terhadap aturan, itu **prasyarat aturannya bisa bermakna**.

### Dampak pada riwayat: NOL

| | |
| --- | ---: |
| sel settle (2026-07-25…08-06) | 91 |
| dinilai SEBELUM perubahan | 91 |
| dinilai SESUDAH perubahan | **91** |
| sel yang berubah kode | **0** |
| sel settle dengan 1–2 shift | **0** |

Setiap hari yang sudah settle punya 3 shift, jadi gerbang ini **membungkam
artefak tanpa membungkam satu pun temuan nyata**. Bakau 08-06 dan IB 08-03 tetap
tertangkap.

### Sinyal "penjualan belum lengkap" tidak hilang

`salesStatus` tetap **kuning** untuk 1–2 shift dan **merah** untuk 0 — modul
Penjualan di sel yang sama tetap bersuara. `getZeroClosingEvents` tak menyentuh
`shifts` sama sekali → tak terdampak.

### Uji mutasi — tiga arah

| mutasi | hasil |
| --- | --- |
| kembali ke `shifts <= 0` (kasus saja) | **MERAH** — Korek 2-shift lolos jadi `lebih_setor` |
| gerbang dilebarkan `shifts < 4` | **MERAH** — hari LENGKAP ikut ditahan, aturan lumpuh |
| `SHIFT_TARGET` dipisah dari `salesStatus` | **MERAH** — dua ambang tak diizinkan |

Fixture bernama **`KOREK_08_07`** memakai angka nyata snapshot 22:15:22, dengan
kontrol eksplisit `setoranStatus(h, I) === "lebih_setor"` — membuktikan
gerbangnyalah yang mengubah hasil, bukan kebetulan.

### Prediksi Korek TETAP BERLAKU — tidak dilebarkan

Dikunci sebelum pengukuran final: **`kurang_setor`**, I − H antara **−15 juta**
dan **−65 juta**, dan Rp 355,9 juta tak muncul di angka final.

Catatan untuk penilaian besok: pukul **22:15** nilainya masih **+89.189.622**
(I − H). Agar prediksi saya benar, **shift 3 harus menambah >100 juta ke H**.
**Kalau meleset, dilaporkan melesetnya — pitanya TIDAK dilebarkan setelah
melihat hasil.**

---

## DISTRIBUSI SHIFT — DATA, bukan kesimpulan

Klaim "nol sel settle punya 1–2 shift" adalah **seluruh argumen keamanan** gerbang
`shifts < SHIFT_TARGET`: ia yang membedakan "membungkam artefak" dari "membungkam
temuan". Owner mencoba memeriksanya dari papan hidup dan **tidak berhasil** membuka
panel detail per-sel — jadi sejauh itu ia klaim saya sendirian. Diterbitkan sebagai
tabel supaya bisa diperiksa ulang tanpa akses DB.

**91 sel settle, `2026-07-25` … `2026-08-06`, 7 unit:**

| jumlah shift | sel | % |
| ---: | ---: | ---: |
| 0 | **0** | 0,0 |
| 1 | **0** | 0,0 |
| 2 | **0** | 0,0 |
| **3** | **91** | **100,0** |

Per unit (13 sel masing-masing) — kalau ada yang menyimpang ia terlihat di sini:

| unit | sel | 0 | 1 | 2 | ≥3 | maks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 28 Oktober | 13 | 0 | 0 | 0 | 13 | 3 |
| Adisucipto | 13 | 0 | 0 | 0 | 13 | 3 |
| Bakau | 13 | 0 | 0 | 0 | 13 | 3 |
| Batu Layang | 13 | 0 | 0 | 0 | 13 | 3 |
| Bundaran Kotabaru | 13 | 0 | 0 | 0 | 13 | 3 |
| Imam Bonjol | 13 | 0 | 0 | 0 | 13 | 3 |
| Korek | 13 | 0 | 0 | 0 | 13 | 3 |

**Maks = 3 di semua unit** — jadi tak ada hari ber-4-shift yang bisa menyembunyikan
hari ber-2-shift dalam agregat.

---

## EKOR C/D — PENGUKURAN PERTAMA SAYA GAGAL, DAN KENAPA

Pertanyaan owner: setelah shift ke-3 tutup, berapa lama C dan D masih bergerak?

### Percobaan 1 — `ingested_at`: CONFOUNDED, jangan dipakai

| komponen | n | p50 | p90 | maks |
| --- | ---: | ---: | ---: | ---: |
| C (pelanggan+voucher) | 210 | 7.347,8 mnt | 23.654,7 | 31.898,1 |
| D (edc) | 210 | 7.347,9 mnt | 23.655,4 | 31.901,2 |

Median "ekor" 5 hari itu **tidak masuk akal**, dan C vs D beda **0,1 menit** — dua
tabel berbeda mustahil berhenti bergerak sedekat itu secara kebetulan. Itu tanda
**satu sebab bersama**.

Kontrol yang membongkarnya:

```
max(ingested_at) pelanggan_sale, unit 1, 30 hari terakhir:
  08-07 03:37:21  dibagi 7 TANGGAL BISNIS berbeda
  08-07 03:37:53  dibagi 7
  08-07 03:38:26  dibagi 6
  08-07 03:36:49  dibagi 5
```

Tujuh tanggal bisnis berbeda berbagi stempel **detik yang sama** = **sapuan tier-2
full-history agent** (`apps/agent/src/config.ts:99`) menulis ulang baris secara
batch. `ingested_at` mengukur **kapan baris terakhir DITULIS ULANG**, bukan **kapan
nilainya berubah**. Upsert menulis ulang nilai yang identik.

⚠️ **Berlaku umum:** setiap pengukuran masa-depan yang bersandar pada `ingested_at`
di tabel mirror akan terkonfound cara yang sama.

### Percobaan 2 — NILAI vs baseline nyata: terbatas tapi sah

Membandingkan H hari SETTLE terhadap angka yang **sudah saya catat** di sesi ini:

| unit-hari | dicatat | jam | diukur ulang 22:31 | bergerak? |
| --- | ---: | --- | ---: | --- |
| Bakau 2026-08-06 | I−H **+3.362.265** | ~14:44 | **+3.362.264,50** | **tidak** |
| IB 2026-08-03 | H **539.143.993,50** | ~12:50 | **539.143.993,50** | **tidak** |
| 28 Oktober 2026-08-04 | H **291.635.952,00** | ~12:49 | **291.635.952,00** | **tidak** |

**Tiga unit-hari settle, 8–10 jam terpisah, identik sampai rupiah** (selisih 0,50
pada Bakau adalah pembulatan laporan saya, bukan pergerakan data).

### Yang BELUM terjawab, dan saya tidak berpura-pura sebaliknya

Jendela kritisnya adalah **jam-jam tepat setelah shift ke-3 tutup** — dan untuk itu
**tak ada baseline** yang saya punya. Ketiga hari di atas sudah lama settle saat
saya catat pertama kali. Yang saya tahu bergerak: Korek 2026-08-07 (hari BERJALAN,
2 shift) C tumbuh **+3.981.641 dalam 23 menit**.

Jadi: **hari yang sudah lama settle stabil; jendela segera-setelah-tutup belum
terukur.** Kalau ekornya menit, gerbang shift sudah cukup. Kalau jam, gerbangnya
perlu bersandar pada sesuatu selain jumlah shift.

**Yang akan menjawabnya** (BELUM dikerjakan, menunggu owner): rekam `sum(C)` dan
`sum(D)` per (unit, tanggal) setiap ~15 menit selama satu malam penuh melewati
tutup shift ke-3, lalu laporkan kapan nilainya berhenti berubah. Read-only, satu
tabel scratch, satu malam. **Itu satu-satunya cara mendapat baseline pada jendela
yang benar** — dan ia harus mengukur NILAI, bukan `ingested_at`.

---

## ⛔ KOREKSI SEBELUM ARSIP — gerbang shift menutup SEPARUH permukaan

Catatan di atas menggambarkan gerbang `shifts < SHIFT_TARGET` sebagai "membungkam
artefak". **Itu benar untuk halaman Ketaatan, dan SALAH untuk halaman Rincian.**
Owner memeriksa layar setelah deploy pilot:

- Papan Ketaatan **sembuh** — Korek 08-07 `warning today` → `pending tempo today`,
  ketujuh sel hari berjalan seragam netral, distribusi sel settle **tidak
  bergeser sedikit pun** (8 danger / 39 pra-adopsi / 38 success / 6 warning,
  identik sebelum & sesudah). "Nol sel settle terpengaruh" **terverifikasi
  independen** — bukan lagi klaim saya sendirian.
- Halaman Rincian **TIDAK sembuh**: masih menulis
  **"⚠ Setoran MELEBIHI uang tunai (selisih Rp 89.189.622)"**.

### Sebabnya: DUA pembuat vonis, gerbang dipasang di satu

| | gerbang `shifts` |
| --- | --- |
| `compliance.ts::adminStatus` | ✅ dapat |
| `rincian-model.ts` | ❌ menghitung verdict SENDIRI; `RincianRaw` tak menerima `shifts` |

Pagi ini kami menyatukan **RUMUS H** ke `lib/rekon.ts` dan menyatakan sumber
tunggal tercapai. Yang berduplikat ternyata **VONISNYA**.

> **Menyatukan INPUT tidak menyatukan KEPUTUSAN.**

Dan permukaan yang terlewat adalah yang **lebih terlihat**: lembar cetak yang
**ditandatangani pengawas**, bukan heatmap internal.

### Ini juga ujian pertama G4, dan G4 benar

Owner **menahan #223** karena catatannya akan mengarsipkan klaim pada siklus yang
sama ia diasersikan — persis yang G4 larang. Tanpa penahanan itu, arsip akan
memuat "gerbang membungkam artefak" tanpa syarat, dan pembaca berikutnya akan
menalar dari klaim yang hanya benar separuh.

**Perbaikannya di PR terpisah** (vonis diangkat ke `adminStatus`, `RincianRaw.
konteks` dibuat wajib sehingga omisi = error type-check). Kedua pengukuran di
bawah — distribusi shift 91/91 dan pembongkaran `ingested_at` sebagai confound —
**tidak terpengaruh dan tidak diubah**.

---

# PAGI 2026-08-08 — PEREKAM HILANG, dan itu yang harus dibaca lebih dulu

## ⛔ Rekaman semalam TIDAK ADA

Direktori scratchpad **kosong** pukul 09:53 WIB: skrip perekam, JSONL, dan
seluruh perkakas hilang; prosesnya tak berjalan. `/private/tmp` dibersihkan dan
proses latar ikut mati. **Nol snapshot bertahan** dari 32 yang dijadwalkan.

**Kesalahan saya, dan bentuknya:** saya menaruh pengukuran yang HARUS hidup
melewati sesi di penyimpanan yang **didokumentasikan sebagai session-specific**,
lalu menjalankan prosesnya di latar sesi itu.

> **Pengukuran yang harus hidup melewati sesi tak boleh tinggal di penyimpanan
> yang lingkupnya sesi.**

Pilihan yang benar: worktree repo (ber-gitignore) atau `launchd`. Saya memilih
tempat yang nyaman, bukan tempat yang tahan.

**Akibatnya:** ekor C/D **tetap tak terukur** pada jendela yang penting.
Jendelanya lewat dan tak kembali malam itu.

## Yang MASIH bisa diselamatkan — dan kontrolnya HOLD

Nilai baseline 23:40:47 tercatat di percakapan, jadi ada dua titik untuk
`2026-08-06` (kontrol) dan tiga untuk Korek.

**KONTROL `2026-08-06` (Korek), 23:40:47 → 09:55 (10 jam 15 mnt):**

| | 23:40:47 | 09:55 | bergerak? |
| --- | ---: | ---: | --- |
| A | 417.328.912,0 | 417.328.912,0 | **tidak** |
| C | 44.348.243 | 44.348.243 | **tidak** |
| D | 17.121.002 | 17.121.002 | **tidak** |

**Kontrol DIAM.** Hari yang sudah settle tidak bergerak selama 10¼ jam — jadi
pergerakan pada 08-07 memang milik hari itu, bukan derau global. Itu satu-satunya
bagian rencana semalam yang selamat, dan ia tetap bermakna.

**Resolusi yang HILANG:** dengan 3 titik (22:15 · 23:40 · 09:55) saya hanya tahu
C bergerak **di suatu tempat dalam jendela 10 jam** bersama mendaratnya shift 3.
Pertanyaan "berapa lama setelah shift ke-3 tutup" **tetap tak terjawab**, dan
saya tidak akan menyajikan bound 10 jam sebagai jawabannya.

---

# KOREK 2026-08-07 FINAL — prediksi saya MELESET

Pukul **09:55 WIB**, shift **3/3**, hari sudah settle:

| | 23:40 (2 shift) | **09:55 FINAL (3 shift)** | delta |
| --- | ---: | ---: | ---: |
| A | 294.467.294,50 | **395.471.252,50** | +101.003.958 |
| C | 17.999.091 | **31.691.356** | +13.692.265 |
| D | 9.798.025 | **11.797.225** | +1.999.200 |
| **H** | 273.988.977,50 | **355.569.871,50** | +81.580.894 |
| I | 359.447.000 | **359.447.000** | 0 |
| **I − H** | +85.458.022,50 | **+3.877.128,50** | — |

**Vonis final: `lebih_setor` (KUNING).**

## Penilaian prediksi terkunci — apa adanya

| # | Prediksi | Hasil | |
| --- | --- | --- | --- |
| K1 | berakhir **`kurang_setor` (MERAH)** | **`lebih_setor` (KUNING)** | ❌ **SALAH** |
| K2 | I − H antara **−15 jt … −65 jt** | **+3.877.128,50** | ❌ **SALAH — tanda pun terbalik** |
| K3 | Rp 355,9 juta tak muncul di angka final | tak muncul (H final 355,57 jt ≠ 355,86 jt) | ✅ benar |

**Pitanya TIDAK saya lebarkan.** K1 dan K2 gagal telak.

### Kenapa saya salah — dan ini menyakitkan karena saya sendiri yang menemukannya

Saya memodelkan shift 3 hanya menambah **A**: rata-rata 147,1 jt/shift → H naik
~100–150 jt → H final 374–424 jt. Shift 3 memang menambah **101,0 juta** ke A —
**tepat di dalam** pita tebakan saya.

Yang saya lupakan: **C dan D ikut tumbuh bersama shift 3, dan keduanya
MENGURANGI H.** C +13,7 jt dan D +2,0 jt = **15,7 juta terpotong**. Jadi
H = 294,5 + 101,0 − 15,7 ≈ **355,6**, bukan ~380.

Dan **saya sudah menemukan sendiri, beberapa jam sebelumnya**, bahwa C bergerak
dengan watermark-nya sendiri — temuan yang memicu seluruh pertanyaan ekor C/D.
**Saya meramal memakai model yang saya sendiri sudah buktikan tidak lengkap.**

Itu bukan "pita terlalu sempit". Itu memakai pengetahuan lama setelah punya
pengetahuan baru — kelas yang sama dengan koreksi L6 dan aritmetika TTL.

### Angka yang layak diperhatikan owner

Selisih final **+3.877.128,50** adalah **kelebihan setor NYATA** pada hari yang
sudah lengkap — bukan artefak. Ia lolos toleransi Rp 1.000 lebih dari 3.800×.
Setoran Korek `359.447.000` **identik** dengan setoran 2026-08-06 (yang di sana
`selaras`, I−H = +133). **Dua hari berturut-turut dengan nilai setoran yang sama
persis** layak diperiksa manusia — saya tidak menyimpulkan apa pun darinya.

---

# U3 — temuan owner MEMBESAR, bukan mengecil

Owner melaporkan glyph ⚠ dan menyebut tidak berhasil mengisolasi warnanya, serta
lebih suka temuannya diperkecil oleh bukti. **Buktinya justru memperbesarnya.**

`SummaryRow.note.tone` hanya punya **dua** nilai (`ok | warn`), dan **setiap**
non-ok dirender sebagai bahaya di **empat** tempat:

| permukaan | penanda |
| --- | --- |
| layar Rincian (baris summary) | `t-danger` (**#B91C1C merah**) + `dot danger` + **⚠** |
| **PDF bertanda tangan** | `color: PDF.danger` + **⚠** |
| kartu Setoran Tunai (`manual-recon`) | latar `--color-danger-bg` + teks danger + `dot danger` + **⚠** |
| tipe `ManualRecon` | kanal `ok\|warn` yang sama |

Jadi bukan glyph saja: **warna, titik, latar, dan glyph — empat penanda, semuanya
berkata "masalah"** — untuk keadaan yang teksnya berkata "belum bisa dinilai".
Dan itu ikut tercetak di lembar yang ditandatangani.

**Akar:** kanal dua-nilai dipaksa membawa fakta tiga-nilai — bentuk yang sama
dengan `.toBe(34)` dan `enforce_admins`.

**Perbaikan:** tambah nada **`info`** (netral) ke union; `tak_terhitung` →
`info`; render netral di keempat permukaan (`t-tertiary` / `PDF.textMuted` /
`.manual-recon.info` / `dot muted`, glyph `·`). Dijaga tes yang **dibuktikan
merah**: mengembalikan nada ke `warn` → `expected 'warn' to be 'info'`.

**Sapuan state `pending` lain:** `pra_adopsi`, `belum_tempo_*`, `belum_adopsi`,
`config_hilang` **tidak menghasilkan note sama sekali** di Rincian (→ `undefined`),
jadi tak ada ketidakcocokan di sana. Di halaman Ketaatan, `modTone` sudah
memetakan `pending` ke kelas netral. **Ketidakcocokannya terbatas pada satu
keadaan, di empat permukaan render.**

---

# 2026-08-08 PAGI — TIGA KOREKSI, dan yang terbesar datang tak sengaja

## 1. Interpretasi saya DIBALIK owner, lalu jejak audit memperkayanya lagi

Owner membuka Korek **2026-08-06** dan menemukan bahwa `359.447.000` adalah
pembulatan ke ribuan dari H hari **08-06** (`359.446.867`, meleset Rp 133) —
jadi selisih Rp 3,88 juta di 08-07 **bukan kelebihan setor**, melainkan **angka
kemarin yang tersalin**.

**Jejak auditnya mengubah urutannya:**

| tanggal bisnis | jumlah | dibuat | dibatalkan |
| --- | ---: | --- | --- |
| 2026-08-07 | 359.447.000 | **08-07 10:28** | **08-08 10:11** |
| 2026-08-06 | 359.447.000 | **08-07 10:43** | — |
| 2026-08-07 | **332.053.000** | 08-08 10:11 | — |

Entri **08-07 dibuat LEBIH DULU** (10:28), baru 15 menit kemudian entri 08-06
(10:43) dengan angka yang sama. Jadi bukan "kemarin tersalin ke hari ini" secara
kronologis — nilainya **milik** 08-06 (pembulatannya cocok di sana) tapi
**diketik ke 08-07 lebih dulu**. Pengawas **sudah mengoreksinya sendiri**
pukul 08-08 10:11.

> **Bentuk yang layak dibawa:** saat sebuah angka mencurigakan karena SAMA PERSIS
> dengan angka lain, **hari sebelumnya adalah tempat pertama yang dilihat.**

## 2. ⛔ EKOR C/D TERLIHAT — dan `shifts >= 3` TIDAK CUKUP

Ini datang tak sengaja, dan ia lebih penting dari yang saya cari.

Korek **2026-08-07**, **3 dari 3 shift sejak sebelum 09:55**:

| jam | shift | A | H | I | I − H |
| --- | ---: | ---: | ---: | ---: | ---: |
| 09:55 | 3 | 395.471.252,50 | **355.569.871,50** | 359.447.000 | +3.877.128,50 |
| 10:13 | 3 | 395.471.252,50 | **332.052.949,50** | 332.053.000 | **+50,50** |

**A tidak bergerak. H turun 23.516.922 dalam 18 MENIT** — seluruhnya dari
pertumbuhan C+D (43.488.581 → 67.005.503).

**Konsekuensi untuk gerbang yang kami kirim semalam:** `shifts >= SHIFT_TARGET`
menutup artefak BESAR (nol/sebagian shift), tapi **tidak menjamin H sudah
berhenti dirakit**. Hari dengan 3 shift penuh masih bisa bergeser 23 juta.
Gerbangnya benar dan perlu — **tapi tidak cukup**, dan sekarang ada bukti langsung
alih-alih dugaan.

⚠️ Ini juga berarti angka "FINAL" yang saya pakai menilai prediksi Korek
**diukur pada jendela yang masih bergerak**. Vonis Korek 08-07 sekarang
**`selaras` (+50,50)**, bukan `lebih_setor`. Prediksi K1/K2 tetap **MELESET**
(saya menebak `kurang_setor`, −15…−65 jt), tapi saya salah menyebut angka 09:55
sebagai final. **Hari itu belum terbukti settle**; penilaian akhir menunggu
rekaman yang berjalan sekarang.

## 3. Frekuensi salin-setoran — dan DUA pengukuran saya yang gagal lebih dulu

Prasyarat owner: berapa sering setoran identik berturut-turut muncul?

- **Percobaan 1** — hanya baris hidup → **0**. Salah: koreksi pengawas
  **menghapus buktinya**; mengukur data-entry error dari baris yang sudah
  dikoreksi selalu menghitung kurang.
- **Percobaan 2** — termasuk baris void, tapi **dijumlahkan** per hari → **0**.
  Salah lagi: menjumlahkan baris void + hidup menghasilkan 691,5 juta, bukan
  359.447.000.
- **Percobaan 3** — bandingkan **tiap NILAI yang pernah dimasukkan**, termasuk
  void, per hari berurutan → **1 pasangan dalam 40 hari × 7 unit**, dan ia
  **persis kasus Korek 08-06/08-07**.

**Nol keluaran dua kali berturut-turut, dan dua-duanya bug saya** — kontrolnya
adalah bahwa saya TAHU satu kasus ada, jadi 0 mustahil.

**Basis keputusan aturan:** 1 kejadian / 40 hari / 7 unit = **sangat sunyi**.
Deteksi tersendiri tidak akan bising. Aturannya layak dibangun.

## 4. Perekam sekarang TAHAN — dan uji lintas-batasnya langsung menggigit

Dipindahkan ke `.measure/` di worktree repo (ber-gitignore), dijadwalkan
**launchd** tiap 15 menit, bukan proses latar sesi.

**Uji lintas-batas dijalankan SEBELUM bersandar padanya**, dan ia **menangkap
kegagalan nyata**: jalan pertama dari launchd **gagal** —
`command not found: node` (launchd memberi PATH minimal). Log menunjukkan
`baris=21` tak bertambah. Setelah PATH dipasang eksplisit, jalan berikutnya dari
launchd menulis **`baris=42`** — 21 baris baru, dari proses yang **tidak saya
panggil**.

> **Bentuk yang sudah dibayar dua kali hari ini:** sebelum bersandar pada sesuatu
> yang harus hidup melewati batas, **lewati batas itu sekali dan lihat ia masih
> hidup.** Gerbang K1 dinyatakan terpasang tanpa pernah berjalan; perekam
> pertama dinyatakan berjalan tanpa pernah dibuktikan bertahan.

## 5. Bentuk dari prediksi yang meleset

Bukan "pitanya terlalu sempit". Saya meramal shift 3 dengan model yang hanya
menambah **A**, padahal **beberapa jam sebelumnya saya sendiri menemukan** bahwa
C punya watermark sendiri — temuan yang memicu seluruh pertanyaan ekor C/D.

> **Temuan yang belum dipindahkan ke dalam MODEL yang kita pakai untuk meramal
> belum benar-benar dimiliki.**

Bukti bahwa ini bukan kesialan: C+D bertumbuh **23,5 juta setelah shift lengkap**
— besaran yang, kalau ada di model saya, akan menggeser pita prediksi ke arah
yang benar.
