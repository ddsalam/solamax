# Piutang pelanggan Fase 1 — pra-registrasi kedua Gerbang 0A-bis

Tanggal segel: 2026-09-07 (WIB). Instruksi lanjutan:
`/Users/ddsalam/.codex/attachments/5162df48-05db-4187-ba57-f212c525d0d2/pasted-text.txt`.

Dokumen ini dibuat sebelum query P2a–P2c dijalankan dan bersifat
**append-only**. Segel pertama
[`2026-09-07-piutang-fase1-preregistrasi.md`](2026-09-07-piutang-fase1-preregistrasi.md)
tetap utuh sebagai catatan sejarah. Hasil ditulis ke berkas baru; tidak ada
prediksi lama atau baru yang disunting agar cocok dengan oracle.

## 1. Batas bukti yang dikunci sebelum probe

Kode agent hanya memilih delapan kolom `tr_bppiut` dan `tr_bphut`:
primary key, `DTGL`, `CKDPLG`, `VCREF`, `VCKET`, `NJUMLAH`, `SJNSBP`, dan
`SBATAL`. Backend juga hanya menerima delapan kolom itu. Karena itu hasil P2
hanya dapat memvonis **balance-forward sejauh delapan kolom yang dicerminkan**;
ia tidak dapat membuktikan bahwa EasyMax tidak mempunyai kolom atau tabel
alokasi lain.

P2 lama juga mencampurkan prefiks dokumen dengan `01` (saldo awal) dan `TP`
(transaksi bebas). P2a–P2c memisahkan kedua kelas itu sebelum menafsirkan hasil.

## 2. P2a — kardinalitas `vcref`

Untuk tiap `(ledger, unit, prefix2)`, hanya baris hidup (`sbatal=0`) yang
dihitung:

- jumlah baris;
- jumlah `distinct trim(vcref)`;
- rasio distinct/baris;
- nilai modus `vcref` dan frekuensinya;
- rasio frekuensi modus/baris;
- jumlah nilai yang cocok pola prefiks diikuti angka.

Klasifikasi operasional dipraregistrasikan sebagai berikut:

- **row-key-like**: rasio distinct ≥80%;
- **document-group-like**: sedikitnya 10 nilai distinct, modus ≤5% dari baris,
  dan nilai dominan mengikuti bentuk prefiks+angka. Satu dokumen boleh dipakai
  beberapa baris sehingga rasionya tidak harus mendekati 100%;
- **shared-label-like**: rasio distinct <0,5% atau modus >5% pada kelompok
  sedikitnya 100 baris;
- kelompok kecil yang tidak memenuhi salah satu batas dilaporkan
  **tidak cukup data**, bukan dipaksa ke sebuah kelas.

Prediksi:

1. `01` akan shared-label-like, dengan nilai yang berulang lintas pelanggan.
2. `TP` akan shared-label-like atau tidak seragam karena transaksi bebas.
3. `JP`, `UV`, `BT`, dan `DP` akan mempunyai keragaman dan bentuk yang lebih
   menyerupai nomor dokumen daripada `01`/`TP`; hanya yang benar-benar memenuhi
   kriteria di atas boleh masuk P2c.

P2a sendiri bersifat karakterisasi. Hasil yang tidak sesuai prediksi dicatat
apa adanya dan mengubah himpunan P2c; tidak mengubah batas klasifikasinya.

## 3. P2b — hipotesis dua belas kecocokan B

Hipotesis tersegel:

- seluruh 12 kecocokan kontrol acak berasal dari `bphut` unit 1, prefiks `01`;
- `vcref` yang cocok merupakan nilai bersama/berulang, bukan nomor dokumen unik;
- baris kredit asli dan baris debit milik pelanggan acak memiliki pelanggan
  berbeda, tetapi berbagi label saldo awal;
- setelah `01` dikeluarkan, dua belas kecocokan itu hilang.

Probe wajib menampilkan untuk seluruh 12: `vcref`, prefiks, `vcket`, `dtgl`,
pelanggan asli, pelanggan acak, nominal pembayaran, primary key pembayaran,
serta primary key dan nominal debit yang membuat B menyala.

**Kondisi berhenti:** satu saja dari 12 kecocokan berasal dari `TP` atau prefiks
berbentuk dokumen; pelanggan asli dan acak ternyata sama; atau kecocokannya tidak
dapat dijelaskan oleh label saldo awal bersama. Itu menolak hipotesis dan harus
dilaporkan sebelum P2c.

## 4. P2c — uji ulang hanya pada prefiks berbentuk dokumen

- `01` dan `TP` selalu dikecualikan dan pengecualiannya harus dilaporkan.
- Himpunan produksi diturunkan dari P2a. Kandidat awal debit adalah `JP`/`UV`;
  kandidat awal pembayaran adalah `BT` pada `bppiut` dan `DP` pada `bphut`.
  Kandidat yang gagal kriteria P2a tidak boleh dipakai sebagai bukti penautan.
- A tetap mensyaratkan unit dan pelanggan sama, lalu `payment.vcref` sama persis
  dengan `debit.vcref` atau primary key debit.
- B memakai pemetaan pelanggan berbeda yang sama dengan run pertama.

Kontrol positif sisi A adalah pasangan sintetis di dalam CTE: satu debit dan
satu pembayaran pada unit/pelanggan sama, dengan `payment.vcref` menunjuk primary
key debit. Prediksi kontrol: denominator 1, A = 1, B = 0. Data sintetis tidak
digabungkan ke hasil produksi.

Ambang vonis:

- kontrol positif A tetap nol: **BERHENTI**;
- A >80% dan unggul >20 poin persentase dari B: **open-item**, lalu
  **BERHENTI dan lapor**;
- A ≤5% dan selisih absolut A–B ≤1 poin persentase, dengan kontrol positif
  menyala: **balance-forward sejauh mirror**, lalu lanjut ke P3;
- hasil di luar pita tersebut: campuran/ambigu, **BERHENTI dan lapor**.

A < B tidak lagi menjadi kondisi berhenti bila P2b sudah membuktikan bahwa
selisih lama berasal dari label yang dikeluarkan.

## 5. Disiplin akses

- Database tetap Cloud SQL pilot LIVE `solamax-pg`, role `dashboard_ro`, GUC
  polos `1,2,3,4,5,6,7`.
- Hanya `SELECT`, pembacaan katalog, `SET`, dan `EXPLAIN` atas `SELECT`.
- Kontrol RLS dan identitas database tidak diulang; keduanya sudah diterima
  sebagai hasil sah.
- `.env.local` tidak dibaca. Kredensial role read-only diperoleh dari Secret
  Manager langsung ke variabel proses dan tidak dicetak.
- Tidak ada tulis DB, perubahan POS, migrasi, UI, push, PR, atau deploy dalam
  Gerbang 0A-bis.
