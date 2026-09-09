# Piutang pelanggan Fase 1 — pra-registrasi keenam probe `SBATAL`

Tanggal segel: 2026-09-08 (WIB). Instruksi lanjutan:
`/Users/ddsalam/.codex/attachments/70d0797a-9853-4fea-9632-f85880780472/pasted-text.txt`.

Berkas ini dibuat **sebelum** query S1–S4 dijalankan dan bersifat
append-only. Lima segel dan seluruh hasil sebelumnya tetap utuh. Hasil baru
tidak boleh dipakai untuk mengubah prediksi, ambang, atau metode di bawah.

## 1. Fakta yang diterima sebelum segel

- Formula saldo tidak dibuka kembali. Predikat `COALESCE(sbatal,0)=0` sudah
  mendarat eksak ke oracle pada 24 sel agregat dan 1.640 titik pelanggan.
- Populasi penuh mirror terakhir memuat 2.450.251 baris `SBATAL=1`: 72,6%
  `bppiut` dan 78,6% `bphut`.
- Sebagai pembanding dari POS, `tr_htagihan` Imam Bonjol hanya mempunyai 165
  dari 2.518 baris `SBATAL=1` (6,6%). Kontras ini membuka pertanyaan tentang
  **makna riwayat** baris ledger, bukan tentang formula saldo aktif.
- Gerbang 0D baru lengkap untuk 6 dari 7 unit. Kotabaru belum mempunyai D1–D4.

## 2. S1 — sebaran waktu

Kedua ledger digabung dengan label sumber, kemudian dihitung per
`(ledger, unit_id, extract(year from dtgl))`: baris penuh, `SBATAL=0`,
`SBATAL=1`, nilai lain, dan porsi batal. Tahun dengan sedikitnya 100 baris
disebut *tahun berpopulasi* untuk pembacaan kestabilan; tahun kecil tetap
ditampilkan tetapi tidak boleh menggerakkan klasifikasi sendiri.

Prediksi: `SBATAL=1` tersebar lintas banyak tahun dan unit, bukan menumpuk pada
satu periode pendek. Mayoritas tahun berpopulasi akan tetap mempunyai porsi
batal di atas 50%, konsisten dengan mekanisme sistemik. Pembacaan alternatif:

- **stabil di sekitar level armada** bila sedikitnya 80% tahun berpopulasi
  berada pada pita 58%…88% (73% ±15 poin persentase) dan tidak ada tahun
  berpopulasi di bawah 40%;
- **peristiwa terkonsentrasi** bila satu tahun memuat sedikitnya 80% seluruh
  baris batal ledger/unit dan tahun berpopulasi di luar periode itu berada
  pada atau di bawah 20%;
- selain itu dilaporkan sebagai **sistemik tetapi bervariasi** atau
  **campuran/ambigu**, sesuai sebaran apa adanya.

## 3. S2 — tanda tangan pasangan dan kontrol acak

Unit analisis adalah setiap baris `SBATAL=1`. Pasangan nyata harus berupa baris
`SBATAL=0` pada ledger yang sama dengan:

```text
(unit_id, trim(ckdplg), sjnsbp, njumlah)
```

yang sama. Jarak tanggal minimum ke pasangan hidup dilaporkan kumulatif pada
hari yang sama, ±1 hari, ±7 hari, dan ±30 hari. `NULL` diperlakukan sebagai
nilai tersendiri dengan `IS NOT DISTINCT FROM`; kode pelanggan kosong tidak
diam-diam dibuang dan dilaporkan terpisah.

Kontrol acak mempertahankan ledger, unit, `sjnsbp`, `njumlah`, dan `dtgl`, tetapi
memindahkan `ckdplg` setiap baris batal ke pelanggan lain dalam unit yang sama.
Pemetaan bersifat deterministik dan pasti berbeda: daftar pelanggan unik
diurutkan menurut `md5(trim(ckdplg))`, lalu setiap pelanggan dipetakan siklis ke
baris berikutnya. Baris hidup tidak dipindahkan. Metode pasangan dan jendela
tanggal setelah pemetaan identik dengan uji nyata.

Prediksi: tingkat pasangan nyata pada ±7 hari jauh di atas kontrol. Batas
praterdaftar untuk “jauh” adalah sedikitnya **10× kontrol dan unggul 20 poin
persentase**. Jika denominator kontrol nol, syarat rasio diganti oleh kontrol
0% serta pasangan nyata sedikitnya 20%. Hasil ini mendukung pola
koreksi/penulisan ulang, bukan membuktikan sebab operasionalnya.

## 4. S3 — bentuk `vcref` dan `vcket`

Sebaran dihitung per `(ledger, status_sbatal, prefix2)` dengan `prefix2` berupa
dua karakter pertama `trim(vcref)`; kosong dan `NULL` diberi kelas eksplisit.
Untuk contoh teks, dipilih tepat lima baris per `(ledger, status_sbatal)`—total
20—dengan urutan deterministik
`md5(unit_id || '|' || primary_key)`, lalu primary key sebagai *tie-breaker*.
Contoh membawa unit, tanggal, primary key, `vcref`, dan `vcket`.

Prediksi: prefiks `SBATAL=1` dan `SBATAL=0` bertumpang tindih kuat, dan contoh
`vcket` batal lebih banyak berbunyi seperti transaksi biasa daripada alasan
pembatalan eksplisit. Ukuran tumpang-tindih yang dilaporkan adalah bagian
prefiks batal yang juga hadir pada populasi hidup serta distribusi baris per
prefiks; teks contoh tidak boleh dipaksakan ke kelas bila ambigu.

## 5. S4 — kardinalitas batal terhadap hidup per pelanggan

Hitung `n_batal` dan `n_hidup` per `(ledger, unit_id, trim(ckdplg))`. Laporkan:

- pelanggan dan baris dengan kedua status;
- pelanggan/baris batal tanpa satu pun baris hidup;
- rasio agregat `sum(n_batal) / sum(n_hidup)` pada pelanggan yang mempunyai
  kedua status;
- distribusi rasio per pelanggan: minimum, p25, median, p75, p95, maksimum;
- bagian pelanggan dengan rasio 0,8…1,25, ≥2, dan ≥5.

Prediksi: rasio tidak berkumpul di sekitar 1:1; median dan ekor atas akan tinggi
atau bervariasi, konsisten dengan penyuntingan berulang. Rasio 0,8…1,25 pada
sedikitnya 80% pelanggan dengan kedua status akan menolak prediksi ini dan lebih
mendukung penulisan ulang sekali.

## 6. Aturan vonis dan kondisi berhenti

Empat sinyal dibaca bersama:

- S1 sistemik + S2 jauh di atas kontrol + S3 tumpang-tindih/teks biasa + S4
  tinggi atau bervariasi ⇒ **jejak koreksi/penulisan ulang berulang**;
- S1 terkonsentrasi + S2 dekat kontrol + S3 alasan pembatalan eksplisit + S4
  sekitar 1:1 ⇒ **pembatalan peristiwa/transaksi**;
- kombinasi silang yang tidak koheren ⇒ **BERHENTI: belum dapat dipastikan dari
  mirror; perlu pembacaan POS**.

Vonis tidak boleh mengubah definisi saldo. Ia hanya menentukan apakah
`SBATAL=1` layak dibaca sebagai histori yang harus dijelaskan pada produk masa
depan atau sebagai pembatalan biasa yang cukup dikecualikan.

## 7. Disiplin akses dan batas arc

- Cloud SQL pilot LIVE `solamax-pg`, role `dashboard_ro`, GUC polos tujuh unit.
- Hanya `SELECT`, `SET` GUC scope, dan pembacaan katalog; tidak ada tulis data,
  perubahan POS, perubahan setting performa, migrasi, agent, sync, snapshot,
  FIFO, UI, push, PR, atau deploy.
- `NSTATUS` vs `sum(tr_byrtagih.ntotal)` dan hipotesis pembayaran sebagian tidak
  dapat diuji dari mirror saat ini; keduanya tetap prasyarat keputusan sync
  domain tagihan.
- Gerbang 1 tetap ditahan sampai D1–D4 Kotabaru dan vonis S1–S4 selesai.

**SolaMax tidak bisa memblokir pelanggan di pompa.**
