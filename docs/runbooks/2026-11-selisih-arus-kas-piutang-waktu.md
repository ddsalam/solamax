# Runbook — selisih Cash flow check karena beda tanggal pembayaran piutang (Bakau, Oktober 2026)

Rencana: `docs/plans/2026-11-11-2210-fix-keuangan-selisih-arus-kas-piutang-waktu-plan.md` (Part B).
Keputusan: `apps/dashboard/KEUANGAN-HARIAN.md` §10.58.

> ⛔ **BELUM DIJALANKAN — menunggu persetujuan Dion.** Runbook ini hanya daftar langkah.
> Tidak ada skrip, tidak ada SQL ke `cash_ledger` atau EasyMax, **tidak ada jurnal memorial**.
> Semua dilakukan di aplikasi (Finance) dan di POS EasyMax (kasir). Rekening bank disebut dengan
> **4 digit terakhir** saja.

## Apa yang terjadi

Cash flow check Bakau 26 Okt 2026 = **−123.196.354**. Angka ini benar, bukan bug hitungan.

- Bank BCA …6811 menerima **Rp 123.196.000** pada **26 Okt** (baris `a8b2f689`, kategori
  "Transfer Pembayaran Piutang Pelanggan", keterangan LLG-BPD KALBAR … SP2D).
- EasyMax mencatat pembayaran yang sama pada **29 Okt**, 3 baris: PLG0607 86.136.000 +
  PLG0609 26.849.200 + PLG0607 10.210.800 = 123.196.000.
- Arus piutang di cek diambil dari EasyMax, kas diambil dari rekening. Karena tanggalnya beda,
  26 Okt minus 123.196.000 dan 29 Okt plus 123.196.000.
- Sisa **−354** = pembulatan setoran (setoran fisik 319.814.000 vs hitungan 319.813.646). Wajar.

Hari lain yang ikut terdampak:

| Hari | Cash flow check | Sebab |
|---|---:|---|
| 26 Okt | −123.196.354 | bank 123.196.000 masuk, EasyMax mencatatnya 29 Okt |
| 29 Okt | +151.261.816 | EasyMax 173.112.484 vs bank 21.849.700 |
| 30 Okt | −17.864.266,5 | bank `d8abe42b` 17.864.200 masuk, EasyMax mencatatnya 29 Okt (17.859.212) |

Di Tutup hari, blok **"Penjelasan selisih arus kas"** sekarang menampilkan uraian ini (sesudah PR
perbaikan live). Pakai blok itu untuk memastikan angka sebelum bertindak.

## Langkah 0 — sebelum memilih tindakan (Finance)

1. **Cek status hari.** Buka Tutup hari Bakau untuk 26, 27, 28, 29 dan 30 Okt. Catat mana yang
   sudah ditutup. Cek juga apakah Oktober Bakau sudah Tutup bulan.
   - Saat ini yang pasti terbuka hanya 26 Okt.
   - Kalau ada hari 26–30 Okt yang **sudah ditutup**: selisih yang disimpan di hari itu tetap
     beku, tetapi tampilan neraca hari itu bisa bergeser. **Bawa ke Dion dulu** sebelum kasir
     mengubah apa pun.
2. **Tanya kasir cara EasyMax memperbaiki tanggal pembayaran piutang** yang sudah diposting:
   - bisa ubah tanggal langsung, **atau**
   - harus **batal** lalu input ulang dengan tanggal bank.
   Keduanya terbaca SolaMax. **Jangan dihapus** — baris yang dihapus tidak terbaca SolaMax.
   Kalau EasyMax sama sekali tidak bisa mundur tanggal, opsi (a) tidak mungkin: **bawa ke Dion**.

## Langkah per baris

### B1 — bank `a8b2f689`, BCA …6811, Rp 123.196.000, 26 Okt

- **Opsi (a) — dianjurkan.** Kasir mengubah tanggal 3 pembayaran EasyMax (PLG0607 86.136.000,
  PLG0609 26.849.200, PLG0607 10.210.800) dari 29 Okt menjadi **26 Okt**. SolaMax mengambilnya
  saat sinkron penuh `bppiut` berikutnya. Baris bank tidak disentuh dan tetap cocok dengan
  rekening koran.
- **Opsi (b) — hanya dengan keputusan Head of Finance.**
  1. Di "Impor rekening koran", cek apakah `a8b2f689` sudah dicocokkan. Kalau ya, Head of Finance
     menekan **"Batalkan cocok"** dulu.
  2. Finance menekan **Batalkan** pada `a8b2f689`.
  3. Finance **Tambah mutasi** 123.196.000 di BCA …6811 bertanggal **29 Okt**, keterangan
     "tgl bank 26 Okt, a8b2f689".
  Akibatnya: saldo buku BCA …6811 beda dengan rekening koran pada 26–28 Okt, dan **baris rekening
  koran 26 Okt tidak bisa dicocokkan lagi** (baris manual hanya cocok di tanggal bank). Baris itu
  menahan Tutup bulan Oktober untuk BCA …6811. Head of Finance harus memutuskan dulu cara
  menyelesaikan baris itu.

### B2 — bank `d8abe42b`, BPD Kalbar, Rp 17.864.200, 30 Okt

- **Opsi (a) — dianjurkan.** Kasir mengubah tanggal pembayaran EasyMax (Rp 17.859.212, kini
  29 Okt) menjadi **30 Okt**. Kasir dan Finance juga memastikan kenapa bank lebih besar
  **Rp 4.988** (biaya, pembulatan, atau pembayaran tercatat kurang).
- **Opsi (b).** Finance membukukan ulang `d8abe42b` pada **29 Okt** seperti B1(b), dengan biaya
  yang sama (baris rekening koran 30 Okt tak bisa dicocokkan).
- Selisih Rp 4.988 tetap ada: di 30 Okt pada opsi (a), di 29 Okt pada opsi (b).

### B3 — PLG0607 Rp 10.210.800 tercatat dua kali di EasyMax (29 Okt, baris BT…228 dan BT…229)

Hanya ada satu penerimaan bank. Bisa salah input ganda di EasyMax, atau ada penerimaan bank yang
belum dicatat.

**Kasir baru boleh membatalkan baris ganda itu setelah KETIGA cek ini sepakat:**
1. Rekening koran **semua** rekening Bakau dari 26 Okt sampai tanggal impor terakhir (termasuk
   November) tidak memuat penerimaan 10.210.800 yang kedua.
2. Faktur/SO PLG0607 hanya menunjukkan **satu** kewajiban 10.210.800, bukan dua.
3. Pelanggan/bendahara mengonfirmasi hanya **satu** SP2D.

Kalau ketiganya sepakat: kasir **membatalkan** (batal, bukan hapus) baris ganda di EasyMax.
Membatalkan pembayaran yang ternyata asli akan menagih pelanggan dua kali.

Kalau ternyata ada penerimaan bank kedua: Finance mencatatnya pada **tanggal bank**-nya
(Tambah mutasi atau impor rekening koran).

### B4 — 4 baris manual 26 Okt menunggu tinjauan ("Kelengkapan input 1 belum")

Finance meninjau di Input keuangan:
- pengeluaran 894.000 MESIN AIR BOOR;
- pengeluaran 170.000 PASIR AIR;
- pengeluaran 200.000 MT KB8076SG,KB8762AV — **perlu kategori operasional**;
- pendapatan lain 3.682.900 SETORAN BRIGHT — tetap sebagai **titipan**.

Baris ini **sudah termasuk** dalam cek. Menyetujuinya tidak mengubah −123.196.354. Menolak atau
mengubah nominal menggeser cek sebesar nominal itu.

### B5 — saldo awal aset per 30 Sep ("Balance sheet check belum bisa dihitung")

Head of Finance mengisi saldo pembuka yang belum ada lewat jalur saldo pembuka (HoF saja). Tidak
berhubungan dengan Cash flow check.

## Perkiraan Cash flow check sebelum dan sesudah

| Skenario | 26 Okt | 29 Okt | 30 Okt |
|---|---:|---:|---:|
| Sekarang | −123.196.354 | +151.261.816 | −17.864.266,5 |
| B1(a) + B2(a) | −354 | +10.206.604 | −5.054,5 |
| B1(a) + B2(a) + batal ganda B3 | −354 | −4.196 | −5.054,5 |
| B1(b) + B2(b) | −354 | +10.201.616 | −66,5 |
| B1(b) + B2(b) + batal ganda B3 | −354 | −9.184 | −66,5 |

- Hanya skenario yang menyelesaikan B3 yang membawa ketiga hari ke dalam toleransi (Rp 10.000).
  Tanpa B3, 29 Okt tetap sekitar +10,2 juta.
- Angka 29 Okt memakai sisa yang **diturunkan dari pengurangan** (EasyMax 21.846.472 vs bank
  21.849.700, −3.228) dan anggapan bahwa B3 memang ganda. **Pastikan keduanya** dari daftar baris
  di blok "Penjelasan selisih arus kas" pada 29 Okt sebelum bertindak di B3.

## Sesudahnya

- Opsi (a) menggeser saldo piutang EasyMax antar hari; opsi (b) menggeser saldo bank. Balance
  sheet langkah harian 26–30 Okt ikut berubah. Itu memang koreksinya, bukan kesalahan baru.
- Buka lagi Tutup hari untuk setiap hari terbuka yang terdampak dan periksa cek-nya sesuai tabel.
- Opsi (b) butuh 29 Okt masih terbuka. Kalau sudah ditutup, Tambah mutasi ditolak di sana dan
  hanya opsi (a) yang tersisa.
