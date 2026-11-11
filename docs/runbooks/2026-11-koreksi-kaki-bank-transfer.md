# Runbook — koreksi kaki bank transfer Kas Besar (November 2026)

Rencana: [`docs/plans/2026-11-11-1638-feat-keuangan-transfer-kas-bank-dua-kaki-plan.md`](../plans/2026-11-11-1638-feat-keuangan-transfer-kas-bank-dua-kaki-plan.md)
("Data correction plan"). Keputusan: `apps/dashboard/KEUANGAN-HARIAN.md` §10.57.

> ⛔ **Tidak ada skrip, tidak ada SQL ke `cash_ledger`.** Semua koreksi lewat aplikasi, atas nama
> orang yang menekan tombol, dengan `audit_log`. Rekening bank disebut dengan **4 digit terakhir**
> saja.

## Apa yang salah

Setoran dari Kas Besar ke bank punya dua kaki: Kas Besar **kredit "Setoran ke Bank"** dan bank
**debet "Pindah Buku"** (keduanya P6, lewat 1190). Di tab bank, 36 baris Oktober–November dicatat
sebagai **"Setoran Hasil Penjualan"** (P2), yang mengurangi 1103 (Penjualan Belum Disetor) untuk
kedua kalinya. Akibatnya 1103 Bakau minus ±13,4 miliar per 10 November, 1190 naik sebesar yang
sama, dan tutup bulan Oktober ditolak.

| Kelompok | Baris | Nominal (Rp) |
|---|---:|---:|
| Bisa dikoreksi, hari terbuka | 32 | 11.080.496.000 |
| Hari tertutup (Bakau 22 Okt, `28e717f3`) | 1 | 399.979.000 |
| Periksa manual | 3 | 1.009.256.000 |
| **Total** | **36** | **12.489.731.000** |

## Prasyarat

1. PR perbaikan tanda setoran P28 sudah live di pilot (terpisah; urutan bebas terhadap PR ini).
2. PR transfer dua kaki (migrasi 0062) sudah live di pilot — Dion menyetujui gerbang `pilot`.
3. Keputusan Dion 11 Nov 2026 17:54 WIB: **D3 = "Jadikan transfer" saja, tanpa jurnal memorial**;
   **"Jadikan transfer" wajib dikonfirmasi eksplisit di setiap hari** (terbuka maupun tertutup).
   Keputusan lain (D1, D2, D4–D9) mengikuti rekomendasi rencana.

## Langkah konfirmasi (setiap baris, setiap hari)

Tombol **"Jadikan transfer…"** di baris hanya membuka langkah konfirmasi. Periksa yang ditampilkan:

- unit, tanggal, nominal;
- **Kaki 1 — Kas Besar kredit** "Setoran ke Bank" (atau "Pindah Buku" untuk baris lama), id8 barisnya
  — tetap, hanya ditautkan;
- **Kaki 2 — bank debet "Pindah Buku"**, rekening 4 digit terakhir (mis. …6811), menggantikan baris
  bank lama (id8) yang dibatalkan.

Lalu centang **"Saya yakin ini transfer Kas Besar → bank dan kedua kaki di atas benar."** dan tekan
**"Konfirmasi: jadikan transfer"**. Tanpa centang tombolnya mati, dan server menolak permintaan tanpa
konfirmasi. Bila tanggal, nominal, atau 4 digit rekening yang dikonfirmasi sudah tidak sama dengan baris saat ini, server
menolak dan meminta muat ulang. Konfirmasi dan kedua kaki yang ditampilkan tercatat di `audit_log`
(`kas.transfer.koreksi`).

## Langkah

1. **Finance (peran `keuangan`)** membuka `/keuangan/unit/6378301/koreksi-transfer` (Bakau).
   Daftar "Siap dikoreksi" urut terlama dulu. Untuk tiap baris **hari terbuka**: periksa tanggal,
   rekening (BCA …6811 dst.), nominal, dan kaki Kas Besar-nya, lalu tekan **"Jadikan transfer…"** dan
   selesaikan langkah konfirmasi di atas.
   Hasil per baris: baris bank lama dibatalkan (tetap terlihat sebagai riwayat), baris baru
   "Pindah Buku" bertanggal & bernominal sama, tertaut ke kaki Kas Besar; jurnal hari itu dibentuk
   ulang. Saldo kas & bank **tidak berubah**.
   - Kaki Kas Besar berlabel "Pindah Buku" (7 baris awal Oktober) tetap sah; daftar memberi
     catatan bahwa pencocok rekening koran memakai aturan 6 untuk baris itu.
2. Ulangi untuk **Adisucipto** (1 baris hari terbuka, Rp 160.417.000, 1 Okt, BCA …3811).
   Total langkah 1–2: 32 baris, Rp 11.080.496.000.
3. **HoF — Bakau 22 Okt `28e717f3`** (hari tertutup, BCA …6811, Rp 399.979.000): di halaman yang
   sama tekan **"Jadikan transfer…"**, periksa kedua kaki, isi **Alasan**:
   *"Kaki bank transfer Kas Besar → BCA …6811 salah kategori (Setoran Hasil Penjualan → Pindah
   Buku); 1103 terkredit dua kali. Ref REPORT6/7B."*, centang **"Saya yakin"**, lalu
   **"Konfirmasi: jadikan transfer"**. Staf Keuangan akan ditolak di baris ini — itu disengaja.
   - **Hanya "Jadikan transfer". Tanpa jurnal memorial** (keputusan Dion D3, 11 Nov 2026 17:54 WIB).
   - Hasil yang diharapkan: kedua kaki tetap bertanggal 22 Okt (tidak dibukukan maju), kaki bank
     tidak lagi mengkredit 1103, 1190 kedua kaki = 0, tutup hari 22 Okt tetap `closed` dengan
     selisih −470.
4. **Periksa manual** (tanpa tombol) — Finance memeriksa slip setoran & rekening koran dulu (D6):
   - Imam Bonjol 1 Okt `60cd0454` dan Adisucipto 2 Okt `95a4f8a7`: lahir dari setoran pengawas
     yang disetujui langsung ke bank — setoran langsung, P2 benar. **Tidak ada tindakan.**
   - Bakau 1 Okt `977285c9` (Rp 170.341.000): tak ada kaki Kas Besar di hari itu.
     - Bila uangnya memang lewat Kas Besar: batalkan baris bank itu ("Batalkan"), lalu catat ulang
       dengan **"Setor ke bank…"** di tab Kas Besar bertanggal 1 Okt (menulis kedua kaki).
     - Bila uangnya tak pernah lewat Kas Besar: periksa bersama HoF debet Kas Besar 30 Sep
       `cf15e72d` (di luar periode buku besar, tetapi memengaruhi saldo Kas Besar).
5. **HoF — "Bentuk ulang"** buku besar 2026-10 lalu 2026-11 di `/keuangan/unit/<kode>/buku-besar/<bulan>`
   untuk Bakau, Adisucipto, dan Imam Bonjol (dibutuhkan untuk P28; koreksi transfer sudah
   membentuk ulang hari-harinya sendiri).
6. **Pemeriksaan** (baca saja — Dion, atau agen lewat jalur baca `ingest` terdokumentasi):
   - Bakau 22 Okt: sisa 1103 = −470, P24 terposting ke 5130, temuan `sisa_1103_belum_disetujui` hilang;
   - tiap unit: 1190 = 0 di akhir tiap hari kecuali butir yang sungguh dalam perjalanan;
   - 1103 per hari ≈ 0 selain selisih yang ditoleransi;
   - 0 baris bank "Setoran Hasil Penjualan" tersisa dengan kaki keluar Kas Besar di hari yang sama
     (halaman koreksi kosong di "Siap dikoreksi").
7. Baru kemudian **tutup bulan Oktober** dicoba.

## Membatalkan sebuah koreksi

- Hari terbuka: "Batalkan transfer" di tab Kas Besar atau bank (kedua kaki batal), lalu Finance
  mengetik ulang baris lama bila memang perlu. `audit_log` menyimpan keduanya.
- Hari tertutup: tidak ada pembalikan di aplikasi. Karena itu koreksi hari tertutup butuh HoF,
  alasan tertulis, dan konfirmasi eksplisit. Perubahan berikutnya atas hari itu = keputusan baru Dion.

## Ke depan

Setoran Kas Besar → bank **selalu** dicatat lewat **"Setor ke bank…"** di tab Kas Besar — satu
isian, dua kaki. Tab bank memperingatkan (dan menolak tanpa centang "setoran langsung") bila
seseorang mengetik ulang uang yang sama sebagai "Setoran Hasil Penjualan".
