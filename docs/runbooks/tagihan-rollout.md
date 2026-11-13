# Runbook — rilis Tagihan pelanggan per unit

Rencana: [`docs/plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md`](../plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md)
("Verification Contract", "Rollout and rollback"). Keputusan yang mengikat:
[`apps/dashboard/PIUTANG-PELANGGAN.md`](../../apps/dashboard/PIUTANG-PELANGGAN.md).

> ⛔ **Hasil probe dan hasil gold-check disimpan DI LUAR repositori ini.** Repositori ini
> publik: jangan menulis jumlah faktur, rupiah, nama pelanggan, atau nomor dokumen suatu
> unit ke berkas mana pun di sini, ke pesan commit, maupun ke deskripsi PR. Catat hasilnya
> di vault (wiki `spbu-sola`). Runbook ini hanya memuat urutan dan aturannya.

> ⛔ **Tidak ada langkah di runbook ini yang menulis ke EasyMax**, dan tidak ada SQL tulis
> ke basis data SolaMax. Semua bacaan EasyMax memakai akun `SELECT`-only.

## Siapa mengerjakan apa

| Langkah | Pelaksana |
|---|---|
| Paket probe di mesin SPBU | Dion (agen tak punya akses ke MySQL cabang) |
| Merge ke `main`, gerbang `pilot` | Dion |
| Tukar bundle agent + restart | Dion, di mesin SPBU |
| Gold-check terhadap EasyMax | Dion bersama Finance |
| Mengatur termin | tim Finance (staf Keuangan atau Head of Finance) |

## Urutan sekali untuk semua unit

Dikerjakan **satu kali**, sebelum unit pertama:

1. **Backend dan migrasi tayang** di tier yang dituju: cermin tagihan (0063) dan master
   termin (0064), berikut `/ingest` yang mengenal domain `tagihan`. Migrasinya aditif.
   Pipeline menjalankan migrasi sampai lulus **sebelum** trafik berpindah
   ([`DEPLOY.md`](../../DEPLOY.md)).
2. **Dashboard tayang.** Sebelum ada agent yang ditukar, setiap unit menampilkan "Data
   tagihan belum tersedia untuk SPBU ini" — itu keadaan yang benar, bukan galat
   (`PIUTANG-PELANGGAN.md` §7). Halaman Atur termin sudah bisa dipakai.

Urutan ini tidak boleh dibalik: agent baru yang berbicara dengan backend lama mendapat
jawaban 4xx untuk domain `tagihan`. Akibatnya hanya siklus tagihan yang batal (domain lain
tetap jalan, tak ada yang masuk buffer, agent pulih sendiri begitu backend tayang) — tetapi
itu waktu yang terbuang.

## Urutan per unit

Satu unit pada satu waktu. Unit berikutnya **baru dimulai** sesudah unit sebelumnya lulus
langkah 4.

### 1 · Paket probe

Jalankan [`session-notes/2026-11-13-tagihan-probe-pack.sql`](../../session-notes/2026-11-13-tagihan-probe-pack.sql)
di basis data EasyMax unit itu sebagai akun baca-saja. Seluruh keluarannya hitungan dan
agregat — tanpa nama pelanggan.

Periksa terhadap keputusan di `PIUTANG-PELANGGAN.md`:

- **T3, T4, T8** — nilai faktur, pembayaran terhadap nilai, dan kolom sisa-saldo
  berperilaku seperti aturan status (§2).
- **T5** — tak ada dokumen penjualan di dua faktur hidup; tiap faktur hidup punya tautan.
- **T6, T9a** — penjualan yang belum ditagihkan terkonsentrasi di populasi piutang (§5).
- **T7** — sebaran jarak jatuh tempo terhadap batas kewajaran (§3).
- **T9b** — tak ada dokumen voucher berfaktur yang debetnya hanya ada di buku hutang.

**Berhenti dan tanyakan ke Dion** bila hasil suatu unit bertentangan dengan salah satu
keputusan itu. Jangan menukar bundle unit itu, dan jangan menyesuaikan kueri diam-diam.

Catat jumlah baris T1 dan T5a beserta **jam pengambilannya** — keduanya dipakai lagi di
langkah 3.

### 2 · Tukar bundle agent

Ikuti [`apps/agent/RUNBOOK-SPBU.md`](../../apps/agent/RUNBOOK-SPBU.md) — bagian **"Rilis
domain `tagihan` (tagihan pelanggan kredit) — urutan swap bundle"**, dan langkah tukar
bundle di Bagian I berkas itu. Dua hal yang paling sering terlewat:

- **Restart wajib.** Tanpa restart, proses lama tetap berjalan dan domain `tagihan` tidak
  pernah muncul.
- > ⛔ **Jangan menjalankan sinkron sekali-jalan (`3-sync-once.bat` / `--once`) selagi
  > loop agent unit itu berjalan.** Dua proses bisa mengirim potongan dan manifest
  > berselang-seling (`PIUTANG-PELANGGAN.md` §8). Untuk melihat apa yang akan dikirim,
  > pakai `2-dry-run.bat`.

### 3 · Konfirmasi siklus lengkap pertama

Cermin belum boleh dipakai sampai **ketiga** hal ini benar:

1. Log agent memuat baris `tagihan: siklus lengkap` (bukan sekadar `ingest ok … tagihan`).
   Baris itu hanya ditulis sesudah ketiga kueri berhasil, semua potongan diterima, **dan**
   manifest diterima.
2. Angka `header` dan `bayar` di baris itu sama dengan jumlah baris T1 dan T5a yang
   diambil **pada jam yang sama**. Bila jamnya berbeda, ambil ulang T1/T5a; jangan
   membandingkan dua waktu.
3. Di SolaMax, S1 unit itu berhenti menampilkan "Data tagihan belum tersedia" dan baris
   kesegarannya menyebut waktu siklus tersebut.

Bila ada `ingest ok` tanpa `siklus lengkap`: siklusnya belum lengkap dan **tidak ada yang
dipangkas**. Baca pesan di atasnya, laporkan pesan lengkapnya, dan tunggu siklus
berikutnya. Jangan memaksa dengan sinkron sekali-jalan.

### 4 · Gold-check terhadap dua menu EasyMax

Tujuannya membuktikan cermin sama dengan yang Finance lihat di EasyMax, **sampai rupiah**.

**Tetapkan satu waktu** dan tuliskan (tanggal dan jam, WIB). Seluruh perbandingan di bawah
diambil pada waktu itu — sesudah satu siklus lengkap, dan tanpa transaksi faktur atau
pembayaran yang dicatat di antaranya. Perbandingan lintas waktu bukan gold-check.

| Yang dibandingkan | Sisi SolaMax | Sisi EasyMax |
|---|---|---|
| Jumlah dan total faktur belum lunas | S1 unit itu | menu faktur belum lunas |
| Jumlah dan total pembayaran satu periode yang dipilih | pembayaran faktur periode itu | menu "Pembayaran Tagihan Pelanggan" |
| Jumlah baris cermin | kepala faktur dan pembayaran | probe T1 dan T5a |
| Populasi belum ditagihkan | S3 | probe T9 — tak ada kelas atau buku yang terlewat |

Lulus = keempatnya sama persis. Selisih berapa pun **bukan** "hampir cocok": cari sebabnya
sebelum unit itu diserahkan ke Finance.

> 🔴 **Gold-check harus terbukti BISA GAGAL.** Pemeriksaan yang lulus pada keadaan benar
> *dan* pada keadaan salah tidak membuktikan apa-apa. Sebelum mempercayai hasil "lulus":
>
> 1. Di **basis data uji** (bukan pilot, bukan EasyMax), ubah satu pembayaran pada data
>    sintetis — nominalnya atau status batalnya.
> 2. Jalankan perbandingan yang sama persis.
> 3. Perbandingannya **harus merah**, dan menunjuk faktur yang diubah.
> 4. Kembalikan datanya, pastikan perbandingan hijau lagi.
>
> Bila perubahan itu tidak memerahkan perbandingan, alat ukurnya yang salah — perbaiki
> alat ukurnya dulu. Hasil gold-check sebelum itu tidak dihitung.

Catat hasilnya (waktu, empat pasang angka, dan bukti uji-bisa-gagal) **di luar repositori
ini**.

### 5 · Finance mengatur termin

Sesudah langkah 4 lulus, Finance membuka **Keuangan → Tagihan pelanggan → Atur termin**
(`/keuangan/unit/<kode>/tagihan/termin`):

1. Isi **termin bawaan unit**. Faktur yang jatuh temponya tidak diisi di EasyMax berpindah
   dari "Termin belum diatur" ke "Belum jatuh tempo" atau "Lewat jatuh tempo".
2. Tambahkan **pengecualian** untuk pelanggan yang terminnya berbeda.
3. Periksa di S1 bahwa ubin "Termin belum diatur" turun menjadi nol, atau sisanya memang
   disengaja.

Perubahan termin berlaku seketika untuk faktur lama yang masih terbuka, tercatat siapa dan
kapan, dan bisa diubah lagi. Tidak ada langkah persetujuan.

Selama termin bawaan belum diisi, faktur tanpa jatuh tempo EasyMax **tidak dihitung lewat
jatuh tempo** — jangan membaca ubin "Lewat jatuh tempo" unit itu sebagai lengkap.

### 6 · Unit berikutnya

Ulangi langkah 1–5. Paket probe dijalankan **untuk tiap unit**, tidak diwariskan dari unit
lain.

## Rollback

Semuanya bisa dimundurkan tanpa menyentuh data yang sudah ada, dan tanpa urutan khusus:

| Yang dimundurkan | Cara | Akibat |
|---|---|---|
| Agent satu unit | kembalikan bundle sebelumnya lalu restart (`RUNBOOK-SPBU.md`) | cermin unit itu berhenti diperbarui, **tidak rusak**; backend tetap menerima domainnya |
| Layar | lepas dua butir menu tagihan dari sidebar dan rilis dashboard | rute tetap ada dan tetap bergerbang; hanya tidak tertaut |
| Cermin satu unit yang diragukan | biarkan satu siklus lengkap berikutnya menggantinya | potret penuh + pangkas menyamakan cermin dengan sumber |
| Migrasi | **tidak dimundurkan** — aditif | tabel yang tak terpakai tidak mengubah perilaku lain |

- Mengosongkan tabel cermin secara manual adalah tulis-produksi di luar aplikasi: **hanya
  atas keputusan Dion**, dan sesudahnya satu siklus lengkap mengisinya kembali.
- Master termin tidak ikut dimundurkan: ia milik SolaMax, bukan cermin, dan riwayatnya
  tersimpan.
- Bila sebuah unit gagal gold-check, **jangan** menyerahkannya ke Finance. Unit lain yang
  sudah lulus tidak terpengaruh.
