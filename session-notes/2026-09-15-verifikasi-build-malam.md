# Verifikasi build malam 14→15 September 2026

Tanggal: 2026-09-15 · Worker: Claude Opus 5

---

## 0 · Kerangka waktunya sudah bergeser

Permintaan berbunyi "selesai MALAM INI" dan menyiapkan daftar periksa "segera
sesudah 03:35". Saat saya membacanya, jam menunjukkan **15-09-2026 19:15 WIB** —
ketiga build sudah berlalu **±16 jam**. Jadi ini bukan persiapan; ini verifikasi
yang terlambat, dan saya menjalankannya sekarang.

## 1 · Tingkat invokasi: 3/3 BERHASIL

Dari Cloud Logging `solamax-ingest-staging` (UTC → WIB +7):

| Jadwal | Unit | Status | processed | completed | superseded | durasi |
|---|---|---|---|---:|---:|---:|
| 02:05 WIB | 1 | `done` | 8 | **7** | **1** | 56,3 s |
| 03:05 WIB | 4 | `done` | 8 | 8 | 0 | 44,5 s |
| 03:35 WIB | 2 | `done` | 8 | 8 | 0 | 22,2 s |

`processed_count = 8` pada ketiganya = 7 tanggal backfill + hari berjalan, yaitu
`defaultDays 7` / `defaultItems 8`. Backfill berjalan.

**Unit 1 memulangkan completed 7, superseded 1** — satu item digantikan cut yang
lebih baru. Itu jinak (pekerjaannya kalah, bukan gagal), tetapi berarti unit 1
mungkin hanya punya **7 dari 8** tanggal. Ambang §2 sengaja menampungnya sebagai
**PERIKSA**, bukan GAGAL.

⚠️ **Ini bukti tingkat LOG, bukan bukti DATA.** Ia mengatakan worker selesai;
ia tidak mengatakan angkanya benar. Bagian itu butuh psql, yang masih diblokir
classifier untuk sesi ini — jadi ia diserahkan sebagai satu perintah, §3.

Satu anomali dicatat, bukan didiamkan: **HTTP 404 pada `/snapshot-worker` pukul
04:26 WIB**, di luar ketiga jadwal. Ia tidak memengaruhi build mana pun (ketiganya
sudah `done` sebelum itu), tetapi 404 berarti ditolak di pintu — layak dilihat
bila berulang.

## 2 · Ambang — DITULIS SEBELUM ANGKANYA ADA

Tertanam di `scripts/piutang-verifikasi/01-build-malam.sql`, dan skripnya
**memvonis dirinya sendiri** (tidak menyerahkan tabel untuk ditafsirkan):

| Kode | Aturan | Vonis |
|---|---|---|
| **G1** | tiap unit 1/2/4 punya ≥ 7 dari 8 tanggal (08–15 Sep) ber-pointer, `published`, `validation_passed` | < 7 = **GAGAL**; tepat 7 = **PERIKSA** |
| **G2** | setiap manifest `saldo-pelanggan-v2` | satu pun bukan = **GAGAL** |
| **G3** | untuk tanggal berurutan dari **cut yang sama**, `awal(D)` = `akhir(D−1)` persis | satu pelanggaran = **GAGAL** |
| **G4** | keduabelas CHECK `_sides` ada | kurang = **GAGAL** |
| — | nol subjek | **GAGAL**, bukan "bersih" |

**Kenapa G3 yang jadi vonis, bukan pasangan debet−kredit.** Migrasi 0039
memasang CHECK untuk `saldo = debet − kredit`, jadi pemeriksaan itu **mustahil
gagal** — memakainya sebagai bukti adalah uji yang tak bisa berbunyi. G3
sebaliknya tidak dijamin apa pun: `awal(D)` dan `akhir(D−1)` memakai predikat
yang identik (`dtgl < D` vs `dtgl <= D−1`), jadi dalam satu cut keduanya WAJIB
sama — dan tidak ada constraint yang memaksanya. G4 tetap ada sebagai kontrol,
supaya vonis LULUS tidak jadi murah bila constraint-nya hilang.

### Dibuktikan LIMA ARAH di PostgreSQL 16 lokal

| Keadaan | Vonis |
|---|---|
| database kosong | `GAGAL: nol subjek` |
| fixture kontinu 3 unit × 8 tanggal | `LULUS` (24 subjek) |
| kontinuitas dirusak 1 tanggal | `GAGAL G3` |
| satu manifest `v1` | `GAGAL G2` |
| satu unit turun ke 6/8 | `GAGAL G1` |
| satu unit tepat 7/8 | `LULUS dengan PERIKSA` |

Pemeriksa yang hanya bisa merah sama tak bergunanya dengan yang hanya bisa
hijau; keduanya diuji.

## 3 · Satu perintah untuk Dion

```bash
psql "$DATABASE_URL_PILOT" -X -f scripts/piutang-verifikasi/01-build-malam.sql
```

Baris terakhirnya memuat vonis. Kirimkan keluarannya apa adanya.

## 4 · Bila satu unit GAGAL — apa yang dilakukan tanpa menunggu

**Jujur lebih dulu: hampir tidak ada yang dapat diperbaiki malam ini.** Gerbang
`evaluateOperationalGate` menolak build di luar **02:00–05:00 WIB**, dan
melebarkan jendela itu menuntut deploy produksi di jam operasi — jalur yang
sudah dua kali menghabiskan semalam. Jadi:

1. **Tanggal yang hilang pada unit yang jobnya ADA** — tidak perlu tindakan.
   Cut berikutnya mengantrekan ulang tanggal yang belum terbangun, jadi cron
   malam berikutnya menyembuhkannya sendiri. Catat tanggalnya, jangan paksa.
2. **Unit yang jobnya TIDAK ADA** — ini yang benar-benar mendesak, karena tanpa
   job ia tidak akan pernah sembuh sendiri. Jalankan gerbang cakupan:

   ```bash
   UNIT_BERCUT="<dari DB>" BUILD_UNITS="<dari scheduler>" RETIRE_UNITS="..." \
     RETIRE_ITERASI=false bash scripts/ci/check-snapshot-unit-coverage.sh
   ```

   Pesan gagalnya memuat perintah `jobs create` lengkap. Membuat job adalah
   tindakan owner (§6.3) — siapkan, jangan jalankan sendiri.
3. **`GAGAL G3`** — JANGAN diperbaiki dengan membangun ulang. Kontinuitas yang
   pecah di dalam satu cut berarti formulanya, bukan penjadwalannya. Itu aturan
   berhenti: laporkan angkanya, jangan tambal.

## 5 · #362

Label sudah dipasang Dion; PR CLEAN dan seluruh check hijau. Ia **tidak memuat
apa pun yang dibutuhkan data malam ini** — fiturnya sudah di produksi sejak
16:52 WIB 14-09. Menggambarkannya sebagai penahan akan salah.

Promosi ke `main` ditahan sampai verifikasi §3 bersih, dan dijalankan **di luar
02:00–05:00** karena deploy me-restart backend dan dapat menjatuhkan build yang
sedang berjalan.

---

# Adendum — vonis keenam, batas di layar, dan kurva

## 6 · Hasil verifikasi data (dijalankan sesi peninjau)

```
27 pointer · 3 unit · 9 tanggal · nol pending_replacement
manifest 29 complete + 1 failed (superseded, jinak) — semuanya v2
unit 1: 07-31 08-31 09-08..09-13 09-15   (14-09 HILANG = item superseded)
unit 2: 08-31 09-08..09-15      unit 4: 08-31 09-08..09-15
G3: 8 pasangan per unit, NOL pelanggaran
kapasitas 4.828 MB, gerbang TERBUKA (dari 13,97 GB kemarin)
```

Kelima vonis berperilaku sesuai pendaftaran; **G1 = LULUS dengan PERIKSA** pada
unit 1 (8 dari 9). Jendela backfill besok (09-09..09-16) mencakup 14-09, jadi
ia sembuh sendiri — **jangan dipaksa**.

## 7 · 🔴 G5 — angka historis BERGERAK, dan G3 buta terhadapnya

```
IB 13-09 saat diverifikasi vs EasyMax : 13.052.684.187,50
IB 13-09 sekarang                     : 12.516.095.502,50
selisih −536.588.685, hampir seluruhnya dari kredit (+712 juta)
```

Sebabnya snapshot 13-09 **dibangun ulang** semalam dari cut 15-Sep, sehingga
memuat pembayaran yang dicatat mundur pada 14–15 Sep. Secara akuntansi benar.

**G3 tidak dapat melihatnya**: ia menguji konsistensi antar-**tanggal** di dalam
satu generasi, bukan stabilitas satu **tanggal** antar-generasi. Dua sumbu
berbeda; menutup yang satu tidak menutup yang lain.

### Kenapa ambangnya LETAK, bukan RUPIAH

Rebuild backfill menyentuh **7 tanggal tiap malam**. Ambang rupiah berapa pun
akan menyala hampir setiap hari — alarm yang selalu menyala, kelas yang sama
dengan 425 yang menyamarkan `disk_review_required`, dan kelas yang sama dengan
ambang total yang saya tolak untuk `staging_review`. Yang membedakan wajar dari
gawat bukan besarnya, melainkan **di mana tanggalnya berada**:

| Letak | Vonis | Alasan |
|---|---|---|
| di DALAM jendela backfill (`cut − 7 hari`) | **PERIKSA**, besarannya dilaporkan | rebuild memang menyentuhnya; yang dibutuhkan visibilitas, bukan alarm |
| di LUAR jendela | **GAGAL G5** | tidak ada yang seharusnya membangun ulang tanggal sejauh itu, termasuk baseline akhir bulan. Angka lama yang bergerak diam-diam adalah tepat hal yang vonis ini ada untuk menangkap |

Dibuktikan dua arah di PostgreSQL 16 lokal: pergeseran 500 juta pada 14-09
(cut 15-09) → `LULUS dengan PERIKSA`; pergeseran yang sama pada tanggal di luar
jendela → `GAGAL G5`. Dasar (satu generasi per tanggal) → `LULUS`.

## 8 · Batasnya kini di LAYAR, bukan hanya di catatan

`TIDAK_BEKU` di `piutang-route.ts`, muncul di **dua** tempat:

- **provenance** — selalu terlihat, bahkan ketika banner tidak menyala;
- **badan banner F1** — ketika ada selisih hidup-vs-snapshot.

> "Angka tanggal lampau dapat bergeser: ia menyajikan posisi tanggal itu menurut
> catatan TERBARU, bukan yang terlihat pada hari itu."

Dikunci uji, dan ujinya dibuktikan merah (menghapus kalimat itu menjatuhkannya).

## 9 · ❓ Pertanyaan untuk Dion — apakah angka historis HARUS beku

Ini keputusan pemilik, bukan keputusan kode. Tiga pilihan dengan biayanya:

| Pilihan | Yang didapat | Yang dibayar |
|---|---|---|
| **A · biarkan bergerak** (keadaan sekarang) | angka selalu = pengetahuan terbaik; koreksi mundur yang sah selalu masuk | laporan tanggal yang sama yang dicetak hari ini dan besok bisa BERBEDA. Setiap rekonsiliasi eksternal wajib menyebut kapan snapshot dibangun — kalau tidak, ia mengulang jebakan [[oracle-selaras-waktu]]. Biaya kode: **nol** (sudah begini) |
| **B · beku sesudah keluar jendela** | angka historis stabil; laporan dapat diulang | koreksi mundur yang tiba > 7 hari **tidak akan pernah** masuk — angka jadi permanen berbeda dari EasyMax. Butuh kode: penanda immutability + jalan keluar manual yang diaudit |
| **C · beku + revisi bernomor** | stabil DAN dapat dikoreksi; pembaca melihat "revisi ke-n, tanggal revisi …" | biaya tertinggi: UI revisi, retensi generasi lama, dan keputusan retensi berapa lama |

Saya **tidak** memilih. Sampai keputusan diambil, layar menyebutkan apa adanya
(§8), yang menutup bahaya terbesarnya: pembaca mengira angka historis beku.

## 10 · Kurva kapasitas — premis plateau kini DIDUKUNG, dengan batasnya

20 titik per jam, 15-09 01:08 → 20:08 WIB, tiga unit aktif, pemensiunan per jam
hidup:

```
01:08  6,35 GB   …berosilasi ±250 MB…   20:08  6,31 GB
tren 19 jam: −33 MB = −2 MB/jam
```

Bandingkan **615 MB/jam** ketika pemensiunan absen (14-09, 02:48→13:48). Aliran
yang diperbaiki memang menahan tanda-airnya.

⚠️ **Batas yang wajib ikut**: prediksi yang saya kunci berbicara tentang
`pg_relation_size('app.saldo_pelanggan_source_bppiut')` **≤ ~1 GB dalam ≤ 6 jam**,
diukur lewat `05-kurva.sh`. Yang saya punya di sini adalah **disk keseluruhan**
selama 19 jam — korroborasi kuat, **bukan** prediksi yang saya daftarkan.
Prediksi itu belum dikonfirmasi maupun digugurkan; `05-kurva.sh` tetap alat yang
menjawabnya, dan ia butuh psql.
