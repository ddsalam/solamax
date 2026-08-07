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

### Frekuensi SEBENARNYA — dari log permintaan Cloud Run

`httpRequest.latency` untuk render halaman (aset statis dibuang), **n = 1.196**
permintaan, 2026-08-05 19:40 → 2026-08-07 18:56 WIB (±47 jam):

| | jumlah | porsi |
| --- | ---: | ---: |
| ≥ 4 dtk | **28** | **2,34%** |
| 2–4 dtk | 93 | 7,78% |
| < 2 dtk | 1.075 | 89,9% |

**Latensi vs lama jeda sebelum permintaan** — ini yang mematikan model TTL saya:

| jeda sebelum permintaan | n | median | p90 | ≥4 dtk |
| --- | ---: | ---: | ---: | ---: |
| < 2 mnt (di dalam TTL) | 1.032 | 0,06 dtk | 1,30 | 13 |
| **2–5 mnt (SUDAH lewat TTL)** | **81** | **1,46 dtk** | 2,34 | **1** |
| 5–15 mnt | 57 | 1,72 dtk | 2,46 | 3 |
| 15–60 mnt | 14 | 3,34 dtk | 6,92 | **6 (43%)** |
| > 60 mnt | 11 | 2,90 dtk | 7,22 | **5 (45%)** |

Kalau TTL 120 dtk adalah kedaluwarsa KERAS, ke-81 permintaan setelah jeda 2–5
menit harus ~6 dtk. Mediannya **1,46 dtk** dan hanya SATU yang ≥4 dtk.
**Menyeberangi TTL tidak dengan sendirinya membayar 5 detik.**

Yang benar-benar berkorelasi adalah **diam panjang (≥15 menit)**: di situ 43–45%
permintaan ≥4 dtk. Mekanismenya belum saya buktikan — dugaan paling sesuai adalah
`unstable_cache` ber-perilaku *stale-while-revalidate* (nilai basi disajikan
seketika, revalidasi di latar) sehingga yang benar-benar mahal hanyalah cache yang
**kosong sama sekali**: revisi baru, instance baru, atau eviction setelah idle
panjang. **Itu dugaan berdasar perilaku, bukan mekanisme yang saya verifikasi.**

**Pengawas pukul 07.00 — n=2, TIDAK KONKLUSIF:**
2026-08-06 07:33 (jeda 384 mnt) → **0,01 dtk**; 2026-08-07 07:27 (jeda 151 mnt)
→ **2,90 dtk**. Skenario "orang pertama tiap pagi menanggung 6 detik" **tidak
terkonfirmasi**. Jam yang benar-benar nol permintaan: **02, 05, 06, 20 WIB**.

### Ringkasan jujur

- **Biaya per-miss: 5,4–7,7 dtk** — terukur langsung, kokoh.
- **Seberapa sering miss terjadi: 2,34% permintaan ≥4 dtk**, terkonsentrasi
  setelah diam ≥15 menit. **Bukan tiap 120 detik.**
- Mekanisme pastinya **belum diketahui**; butuh instrumentasi hit/miss
  `getAnomalies` untuk memastikannya, bukan penalaran TTL lagi.

### ⚠️ Mode kegagalan LAIN yang muncul di data (bukan cache)

2026-08-07 18:48:19–18:48:25 WIB, empat permintaan `/monitoring/ketaatan` nyaris
bersamaan: **14,37 · 13,73 · 8,99 · 4,91 dtk**. Jeda sebelumnya < 2 menit — cache
hangat. Ini **kontensi**, bukan cache: beberapa render serentak berebut pool
`max: 10`. Layak jadi penyelidikan tersendiri; tidak dikerjakan sekarang.

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
3. **Naikkan TTL** (120 → 600 dtk): termurah — TAPI karena menyeberangi TTL
   terbukti TIDAK dengan sendirinya membayar 5 detik, dasar manfaatnya kini
   goyah. Jangan kerjakan sebelum mekanismenya dipastikan.
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
