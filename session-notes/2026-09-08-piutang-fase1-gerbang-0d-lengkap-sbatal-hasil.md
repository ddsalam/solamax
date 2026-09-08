# Piutang pelanggan Fase 1 — Gerbang 0D lengkap dan vonis `SBATAL` ledger

Tanggal konsolidasi: 2026-09-08 (WIB). Branch:
`codex/piutang-fase1-probe`. Instruksi:
`/Users/ddsalam/.codex/attachments/c3df07da-1f64-4a36-8516-14c4d333ae8d/pasted-text.txt`.

Dokumen ini adalah hasil baru dan append-only. Ia tidak menyunting enam segel
atau hasil sebelumnya. Metode S1–S4 sudah disegel sebelum query pada commit
`9d8c74c` di
[`2026-09-08-piutang-fase1-preregistrasi-6.md`](2026-09-08-piutang-fase1-preregistrasi-6.md),
lalu hasil mirror dicatat pada commit `89d7e01`. Karena probe itu sudah selesai,
S1–S4 **tidak dijalankan ulang**. Fakta Kotabaru diterima dari hasil SQL Manager
yang telah diverifikasi orkestrator, sesuai instruksi agar tidak meminta ulang.

Label lama “6 dari 7” dan status “menunggu Kotabaru” dicabut. Dokumen lama tetap
utuh sebagai catatan kronologis; status yang berlaku sekarang adalah **Gerbang
0D lengkap 7/7**. Gerbang 1 masih ditahan hanya sampai makna S1–S4 dikunci di
bagian 5 dokumen ini.

## 1. Gerbang 0D — armada lengkap 7/7

### 1.1 Faktur, jatuh tempo, dan pembayaran

Seluruh hitungan faktur memakai `COALESCE(SBATAL,0)=0`.

| Unit | ID | Faktur | Rentang `DTGL` | `jt_sama` | `jt_lambat` | `jt_awal` | Tempo min…maks | Faktur 12 bln | Bayar | Yatim | Bayar terakhir |
|---|---:|---:|---|---:|---:|---:|---|---:|---:|---:|---|
| Imam Bonjol | 1 | 2.353 | 2022-09-02…2026-09-07 | 1.068 | 1.283 | 2 | −24…45 | 762 | 1.938 | **0** | 2026-09-04 |
| Bakau | 2 | 848 | 2015-11-01…2026-09-07 | 701 | 147 | 0 | 0…101 | 316 | 742 | **0** | 2026-09-02 |
| Adisucipto | 3 | 100 | 2026-03-23…2026-09-08 | 100 | 0 | 0 | 0…0 | 100 | 93 | **0** | 2026-09-07 |
| **Kotabaru** | 4 | **7.275** | 2011-10-15…2026-09-07 | 2.641 | **4.616** | 18 | **−1.080…32.890** | 603 | 5.488 | **0** | 2026-08-26 |
| Batu Layang | 5 | 717 | 2020-05-21…2026-09-07 | 535 | 182 | 0 | 0…18 | 296 | 547 | **0** | 2026-09-07 |
| Korek | 6 | 783 | 2021-06-12…2026-09-07 | 763 | 19 | 1 | −1…23 | 459 | 97 | **0** | 2026-07-27 |
| 28 Oktober | 7 | 2.667 | 2018-06-21…2026-09-07 | 2.481 | 173 | 13 | −40…87 | 478 | 2.312 | **0** | 2026-07-16 |
| **Total** |  | **14.743** |  | **8.289** | **6.420** | **34** |  | **3.014** | **11.217** | **0** |  |

Sebanyak **6.420 dari 14.743 faktur (43,5%)** mempunyai `DTGLJT > DTGL`.
Penautan pembayaran ke faktur tidak mempunyai yatim pada ketujuh unit, sehingga
kondisi berhenti Gerbang 0D tidak terpicu.

### 1.2 `NSTATUS` dilawan ke keberadaan pembayaran

| Unit | `NSTATUS=0` n | Tanpa bayar | `NSTATUS=1` n | Tanpa bayar |
|---|---:|---:|---:|---:|
| Imam Bonjol | 442 | 441 | 1.911 | **0** |
| Bakau | 190 | 145 | 658 | **0** |
| Adisucipto | 8 | 8 | 92 | **0** |
| Kotabaru | 1.821 | 1.820 | 5.454 | **0** |
| Batu Layang | 173 | 173 | 544 | **0** |
| Korek | **686** | **686** | 97 | **0** |
| 28 Oktober | 379 | 357 | 2.288 | **0** |
| **Total** | **3.699** | **3.630** | **11.044** | **0** |

`NSTATUS=0` yang mempunyai sedikitnya satu pembayaran hanya 69 faktur: Bakau
45, 28 Oktober 22, Imam Bonjol 1, dan Kotabaru 1. Kelas itu nyata tetapi terlalu
langka untuk menjadi tiang rancangan.

## 2. Enam vonis Gerbang 0D yang dikunci

1. **Vonis sementara “`DTGLJT` tidak dipakai” gugur dan dicabut.** Vonis lama
   lahir dari lima contoh Kotabaru yang kebetulan seluruhnya mempunyai
   `DTGLJT=DTGL`. Populasi lengkap justru menunjukkan Kotabaru sebagai pemakai
   tempo tertinggi: 4.616/7.275 = **63,5%**. Pelajaran metode yang dikunci:
   **lima baris contoh bukan sampel**. Lima baris hanya membuktikan bahwa suatu
   bentuk ada; ia tidak pernah mengukur proporsi.
2. **Tempo nyata tersedia se-armada.** Sebanyak 6.420/14.743 = **43,5%** faktur
   bertermin. Fitur jatuh tempo dapat dibangun dari EasyMax dengan pagar kualitas
   pada vonis berikutnya.
3. **`DTGLJT` Kotabaru mengandung nilai sampah.** Tempo minimum −1.080 hari dan
   maksimum 32.890 hari (sekitar 90 tahun), sedangkan maksimum enam unit lain
   hanya 101 hari. Setiap pemakaian `DTGLJT` wajib melewati batas kewarasan;
   baris di luar batas ditandai, bukan dibuang diam-diam, dan tidak boleh dipakai
   menghitung “terlambat N hari”.
4. **Pemakaian tempo berbeda ekstrem per unit.** Porsi `jt_lambat` adalah
   Kotabaru 63,5%, Imam Bonjol 54,5%, Batu Layang 25,4%, Bakau 17,3%,
   28 Oktober 6,5%, Korek 2,4%, dan Adisucipto 0%. Sumber tempo digerbang per
   unit dan per baris pada keberadaan nilai yang waras. Bila `jt_sama` dominan,
   termin wajib datang dari master SolaMax; tanggal faktur yang tersalin tidak
   boleh disajikan sebagai “jatuh tempo hari ini”.
5. **`NSTATUS=1` berarti lunas pada populasi ini.** Seluruh 11.044 faktur
   `NSTATUS=1` di tujuh unit mempunyai pembayaran; pengecualian nol. Kolom ini
   boleh dipakai hanya dengan jaring kedua: `sum(tr_byrtagih.NTOTAL)` harus
   disilang terhadap `tr_htagihan.NGATOT` setelah domain tagihan tersedia di
   mirror. `NSTATUS` dipelihara POS dan dapat basi.
6. **Penautan pembayaran ke faktur utuh se-armada.** Yatim = 0 pada ketujuh
   unit, sehingga kondisi berhenti tersegel tidak terpicu. Ini tidak mengubah
   kewajiban menjaga `unit_id` pada relasi ketika domain dicerminkan.

## 3. Keputusan mengikat untuk kewarasan `DTGLJT`

Setiap konsumen masa depan harus menghitung `tempo_hari = DTGLJT - DTGL` dan
membawa tanggal mentah beserta status kualitasnya. Pagar konservatif awal yang
dikunci untuk Fase 1 adalah:

```text
tempo_waras := DTGLJT IS NOT NULL AND tempo_hari BETWEEN 0 AND 365
```

Angka 365 hari adalah pagar produk, bukan klaim tentang batas tipe database. Ia
memberi ruang jauh di atas maksimum waras yang teramati (101 hari) sambil
menutup nilai 32.890 hari. Perubahan pagar kelak harus eksplisit dan teruji;
tidak boleh melebar karena satu nilai ekstrem.

Perilaku wajib:

- simpan/tampilkan status `valid`, `sebelum_faktur`, `melewati_batas`, atau
  `tidak_tersedia`, dan pertahankan nilai mentah untuk audit;
- hanya status `valid` boleh menghasilkan tanggal jatuh tempo operasional dan
  hitungan hari terlambat;
- status lain tidak menjadi nol, tidak dianggap “jatuh tempo hari ini”, dan
  tidak dihapus dari hitungan kualitas data;
- termin master SolaMax menjadi fallback pada unit/baris tanpa tempo EasyMax
  yang valid;
- UI wajib membedakan tanggal dari EasyMax, tanggal hasil termin master, dan
  tanggal yang tidak dapat ditentukan.

Kelas `sebelum_faktur` teramati di empat unit: Kotabaru 18 baris sampai −1.080
hari, 28 Oktober 13 sampai −40, Imam Bonjol 2 sampai −24, dan Korek 1 sampai −1.
Kelas ini dicatat sekarang dan tidak diinvestigasi lebih lanjut pada arc ini.

## 4. Sinyal operasional untuk Dion

Korek berbeda tajam dari armada: **686 dari 783 faktur (87,6%)** berstatus belum
lunas dan tidak satu pun mempunyai pembayaran tercatat. Laju armada adalah
3.699/14.743 = **25,1%**. Pembayaran terakhir Korek tercatat 2026-07-27,
sedangkan faktur terus terbit sampai 2026-09-07.

Di 28 Oktober, pembayaran terakhir tercatat **2026-07-16** sementara faktur juga
terus terbit sampai 2026-09-07.

Kedua sinyal harus diteruskan sebagai sinyal bertanggal dengan dua tafsir yang
sama-sama mungkin:

1. uang memang belum diterima; atau
2. uang sudah diterima tetapi pembayaran belum diinput ke EasyMax.

Data saat ini tidak dapat memilih salah satunya. Karena arah tidak diketahui,
tidak ada angka rupiah “belum tertagih” yang boleh ditulis untuk Korek maupun
28 Oktober.

## 5. Probe `SBATAL` ledger S1–S4

### 5.1 Kontras yang memotivasi probe

| Sumber | `SBATAL=0` | `SBATAL=1` | Porsi `SBATAL=1` |
|---|---:|---:|---:|
| `bppiut` mirror | 764.163 | 2.024.215 | **72,6%** |
| `bphut` mirror | 115.876 | 426.356 | **78,6%** |
| `tr_htagihan` Imam Bonjol | 2.353 | 165 | **6,6%** |
| `tr_htagihan` Kotabaru | 7.275 | 237 | **3,2%** |

Kontras **3,2% pada tagihan Kotabaru melawan sekitar 73% pada `bppiut`**—serta
6,6% melawan 78,6% pada pasangan IB/`bphut`—membuktikan bahwa nama kolom sama
tidak cukup untuk menyamakan semantik operasionalnya. Formula saldo tidak dibuka
kembali: `SBATAL=0` tetap oracle-exact. Yang diuji hanya arti populasi histori.

### 5.2 Ringkasan empat probe

| Probe | Hasil | Arah bukti | Vonis |
|---|---|---|---|
| S1 · waktu | Baris batal tersebar lintas tahun; level berubah bertahap dan bervariasi antar ledger/unit | mekanisme sistemik, bukan satu peristiwa | sistemik tetapi bervariasi |
| S2 · pasangan | Pada ±7 hari, pasangan nyata `bphut` 47,2994% dan `bppiut` 49,0015%, jauh di atas kontrol | koreksi/penulisan ulang | mendukung reversal/koreksi |
| S3 · `vcref`/`vcket` | Prefiks batal overlap 100% dengan hidup; 6/10 contoh batal menyebut `Pembalik` | pembalik pada kelas transaksi yang sama | mendukung reversal/koreksi |
| S4 · kardinalitas | Median batal per hidup 3,8000 (`bphut`) dan 2,6861 (`bppiut`); maksimum 16 dan 54 | jauh dari penulisan ulang satu-kali | suntingan berulang |

### 5.3 S2 dengan kontrol pelanggan acak

Kontrol mempertahankan ledger, unit, `sjnsbp`, `njumlah`, dan tanggal, tetapi
memindahkan `ckdplg` secara deterministik ke pelanggan lain dalam unit yang sama.

| Ledger | Skenario | Hari sama | ±1 hari | ±7 hari | ±30 hari |
|---|---|---:|---:|---:|---:|
| `bphut` | nyata | 47,0358% | 47,1193% | **47,2994%** | 47,5241% |
| `bphut` | pelanggan acak | 0,0443% | 0,0905% | **0,2754%** | 0,5115% |
| `bppiut` | nyata | 48,8200% | 48,8827% | **49,0015%** | 49,0931% |
| `bppiut` | pelanggan acak | 0,4728% | 0,9522% | **2,0614%** | 3,3820% |

Pada jendela utama ±7 hari, `bphut` unggul 171,75× dan +47,0240 poin;
`bppiut` unggul 23,77× dan +46,9401 poin. Keduanya melewati ambang tersegel 10×
dan +20 poin pada level armada. Kontrol `bphut` unit 6 dan `bppiut` unit 2 lebih
tinggi serta tidak memenuhi 10× secara individual, tetapi tetap unggul lebih
dari 20 poin; pengecualian ini tidak disembunyikan.

### 5.4 Vonis gabungan

S1–S4 koheren dan tidak memicu kondisi berhenti:

> **`SBATAL=1` pada `bppiut` dan `bphut` terutama merupakan jejak
> koreksi/pembalikan/penulisan ulang berulang, bukan sekadar kumpulan transaksi
> yang dibatalkan satu kali.**

Mirror tidak dapat menentukan apakah pembalik dibuat otomatis oleh POS, saat
edit pengguna, ketika menutup shift, atau melalui kombinasi proses. Untuk
pertanyaan “tagihan yang sudah dibuat”, sumber kanonik tetap open-item
`tr_htagihan` setelah domain itu dicerminkan. Ledger `SBATAL=1` adalah lapisan
histori/audit yang harus dapat dijelaskan; ia bukan saldo aktif dan tidak boleh
dimasukkan kembali ke formula saldo.

Dengan vonis ini, Gerbang 0D dan S1–S4 selesai. **Gerbang 1 secara evidensial
boleh dibuka untuk perancangan**, tetapi tidak dimulai pada dokumen ini.

## 6. Prasyarat keputusan sync tagihan

Dua uji tidak dapat dijalankan sekarang karena `tr_htagihan`, `tr_dtagihan`, dan
`tr_byrtagih` belum dicerminkan:

- silang `sum(tr_byrtagih.NTOTAL)` terhadap `tr_htagihan.NGATOT` sebagai jaring
  kedua untuk `NSTATUS`;
- kuantifikasi pembayaran sebagian, termasuk membedakannya dari status yang
  basi atau input pembayaran yang tidak lengkap.

Keduanya adalah **prasyarat**, bukan pekerjaan tertunda dalam arc ini. Artinya,
sebagian pertanyaan Dion tidak dapat dijawab sampai modul tagihan dicerminkan;
fakta itu menjadi bahan utama keputusan Dion tentang penambahan domain sync.

## 7. Ruang yang tetap ditahan

- **Gerbang 1:** secara bukti sudah tidak terblokir, tetapi rancangan layar belum
  dikerjakan pada arc ini.
- **Domain sync tagihan:** nol kode, nol migrasi, dan nol perubahan agent;
  keputusan tetap milik Dion.
- **Snapshot:** sudah dirancang, belum dibangun.
- **Limit kredit:** arc berikutnya; `tm_plg` terbukti tidak menyimpannya.
- **FIFO-imputed:** batal permanen.

## 8. Yang masih belum diketahui

- Penyebab operasional pasti dan waktu pembuatan baris pembalik di POS.
- Apakah `NSTATUS` tetap konsisten ketika total pembayaran dibandingkan langsung
  dengan `NGATOT`; uji menunggu domain tagihan di mirror.
- Apakah 69 faktur `NSTATUS=0` yang mempunyai pembayaran benar-benar merupakan
  pembayaran sebagian; kuantifikasi juga menunggu sync.
- Keputusan Dion apakah domain tagihan akan dicerminkan.
- Ambang adopsi per-unit untuk memilih tempo EasyMax sebagai sumber utama;
  perilaku per-baris dan pagar 0…365 hari sudah terkunci, tetapi keputusan UI
  armada tetap milik Gerbang 1.
- Tafsir sinyal Korek dan 28 Oktober: uang belum masuk atau pembayaran belum
  diinput.
- Bentuk UI akhir, SLA kesegaran snapshot, dan sumber master termin/limit kredit.

## 9. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only (aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS. Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk pengawas. **Penegakannya tetap manusia.**
