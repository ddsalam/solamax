# Piutang pelanggan Fase 1 — hasil Gerbang 0B dan parsial P3

Tanggal eksekusi: 2026-09-07 (WIB). Segel yang mengikat:
[`2026-09-07-piutang-fase1-preregistrasi-3.md`](2026-09-07-piutang-fase1-preregistrasi-3.md).

Status: **BERHENTI pada P3**. Selisih 90 baris ditutup. P4, P5, rancangan,
detektor belum-diinput, gold-check, migrasi, dan UI tidak dijalankan. Gerbang 0C
tetap menunggu hasil Dion dari dua unit.

## 1. Gerbang 0B — kenaikan derajat fakta

Hasil Dion di Imam Bonjol, DB `easymax`:

- `tm_plg` mempunyai tepat sembilan kolom:
  `CKDPLG, DTGLREG, VCNMPLG, VCALAMAT, CTLP, VCPERSON, SJENIS, CPARTV, SAKTIF`.
  Tidak ada limit kredit, plafon, termin, tempo, atau jatuh tempo. Limit dan
  tempo menjadi master data milik SolaMax pada arc berikutnya; bukan arc ini.
- `tr_bppiut` dan `tr_bphut` masing-masing tepat delapan kolom, cocok 8/8 dengan
  daftar agent. Kekhawatiran kolom ledger tersembunyi gugur.

Vonis yang berlaku sekarang:

> **`tr_bppiut` dan `tr_bphut` adalah ledger balance-forward penuh.** Keduanya
> tidak menyimpan penautan pembayaran ke faktur.

Namun vonis ledger bukan vonis seluruh EasyMax, karena modul faktur/pembayaran
terpisah ditemukan.

## 2. Modul tagihan yang belum dicerminkan

`SHOW TABLES LIKE '%tagih%'` menemukan sepuluh objek:

| Objek | Status awal |
|---|---|
| `tr_htagihan` | kandidat header/faktur |
| `tr_dtagihan` | kandidat detail faktur |
| `tr_byrtagih` | kandidat pembayaran faktur |
| `vw_tagihan` | view tagihan |
| `vw_htagihan` | view header tagihan |
| `vw_tagihanv` | view tagihan |
| `vw_tagihantosend` | view pengiriman tagihan |
| `vw_byrtagih` | view pembayaran |
| `vw_byrtagih2nd` | view pembayaran kedua |
| `vw_tagihbyr` | kandidat gabungan tagihan-pembayaran |

Pencarian source di `apps/` dan `packages/` hanya menemukan dua kecocokan yang
tidak mengimplementasikan domain ini: pertanyaan dokumentasi di
`apps/dashboard/KEUANGAN-HARIAN.md:667` dan nama test tidak terkait di
`apps/dashboard/src/lib/harga-beli.test.ts:177`. Tidak ada domain agent, kontrak
shared, konfigurasi ingest, query dashboard, atau rute modul tagihan.

Konsekuensi:

1. Butir tagihan dibuat, dibayar, dan belum dibayar harus diuji terhadap modul
   ini; debit ledger bukan pengganti faktur.
2. Aging sejati mungkin tersedia melalui `tr_byrtagih`; FIFO-imputed tetap
   dilarang sampai Gerbang 0C selesai.
3. Jika modul hidup dan bertaut, kebutuhan domain sync baru melampaui Fase 1
   investigasi dan harus diputuskan Dion sebelum kode.

### Pelajaran negatif-palsu

`SHOW TABLES LIKE '%bayar%'` menghasilkan `Empty set`, sementara `%tagih%`
menemukan tabel pembayaran bernama singkat `tr_byrtagih`. Nol hasil hanya
membuktikan pola pencarian tidak cocok; bukan ketiadaan konsep atau data.

## 3. Selisih 90 baris — DITUTUP

Probe read-only ke mirror Imam Bonjol menghasilkan:

| Ukuran | Nilai |
|---|---:|
| count mirror pertama | 405.729 |
| count MySQL Dion | 405.819 |
| count mirror sekarang | 405.819 |
| pertumbuhan mirror | **+90** |
| baris `dtgl = 2026-09-07` | **90** |
| rentang ledger mirror | 2022-09-01…2026-09-07 |

Pertumbuhan mirror sama persis dengan selisih dan ditopang tepat 90 baris pada
tanggal bisnis baru. Selisih bukan kehilangan sinkronisasi; ia pertumbuhan di
antara dua pembacaan. `ingested_at` tidak dipakai.

## 4. P3 — kode bertitik lintas armada

| Unit | Nama | Bertitik | Tanpa titik | SJENIS bertitik | Di luar `{1,3,4,5}` | Putusan |
|---:|---|---:|---:|---|---:|---|
| 1 | Imam Bonjol | 14 | 2.959 | `{1,3,4,5}` | 0 | sesuai |
| 2 | Bakau | 13 | 617 | `{1,3,4,5}` | 0 | sesuai |
| 3 | Adisucipto | **0** | 5 | — | 0 | **MENYIMPANG** |
| 4 | Bundaran Kotabaru | 14 | 1.191 | `{1,3,4,5}` | 0 | sesuai |
| 5 | Batu Layang | 6 | 531 | `{1,3,4}` | 0 | sesuai |
| 6 | Korek | 1 | 190 | `{3}` | 0 | sesuai |
| 7 | 28 Oktober | 13 | 839 | `{1,3,4,5}` | 0 | sesuai |

Adisucipto mempunyai lima master saja: dua tanpa titik ber-`SJENIS 2`, tiga
tanpa titik ber-`SJENIS 5`; ketiga pelanggan `SJENIS 5` mempunyai 585 baris
piutang hidup dengan saldo akhir 2026-08-31 sebesar Rp72.614.288. Tidak ada
pelanggan Online berkode bertitik.

### Kondisi berhenti

Segel memprediksi setiap unit mempunyai kode bertitik dan tanpa titik, serta
menetapkan absennya salah satu bentuk sebagai kondisi berhenti. Adisucipto
melanggar prediksi itu (`0` kode bertitik), sehingga P4 dan P5 tidak dijalankan.
Ketiadaan kode Online dapat merupakan konfigurasi bisnis yang sah, tetapi status
itu tidak boleh ditetapkan setelah melihat hasil tanpa keputusan Dion.

## 5. Gerbang 0C — blok kedua siap-tempel untuk Dion

Jalankan di **Imam Bonjol dan satu unit pembanding**. Untuk query rentang waktu,
ganti `DTGL` hanya bila hasil `DESCRIBE` membuktikan nama kolom tanggal berbeda.

```sql
-- Bentuk ketiga tabel dasar
DESCRIBE tr_htagihan;
DESCRIBE tr_dtagihan;
DESCRIBE tr_byrtagih;

-- Apakah modulnya hidup atau dorman?
SELECT COUNT(*) FROM tr_htagihan;
SELECT COUNT(*) FROM tr_dtagihan;
SELECT COUNT(*) FROM tr_byrtagih;

-- Sesuaikan nama kolom tanggal HANYA dari hasil DESCRIBE
SELECT MIN(DTGL), MAX(DTGL) FROM tr_htagihan;
SELECT MIN(DTGL), MAX(DTGL) FROM tr_byrtagih;

-- Bentuk penautannya
SELECT * FROM tr_htagihan ORDER BY 1 DESC LIMIT 5;
SELECT * FROM tr_dtagihan ORDER BY 1 DESC LIMIT 5;
SELECT * FROM tr_byrtagih ORDER BY 1 DESC LIMIT 5;

-- View kandidat gabungan
SHOW CREATE VIEW vw_tagihbyr;
SHOW CREATE VIEW vw_tagihan;
```

Mohon kirim hasil mentah seluruh blok, nama unit, nama database aktif, serta
setiap error nama kolom—jangan menebak penggantinya. Gunakan koneksi baru; SQL
Manager dapat mempertahankan snapshot InnoDB `REPEATABLE READ` yang basi.

Aturan pembacaan hasil sudah disegel di
`2026-09-07-piutang-fase1-preregistrasi-3.md`: keaktifan diputus per unit;
penautan harus terlihat pada kunci dan angka; modul hidup+bertaut memicu stop
dan usul ruang lingkup baru, bukan implementasi langsung.

## 6. Yang masih belum diketahui

- Apakah modul tagihan hidup atau dorman di Imam Bonjol dan unit pembanding.
- Primary key/foreign key ketiga tabel, tanggal, grain, dan keterisiannya.
- Apakah `tr_byrtagih` benar-benar menaut ke `tr_htagihan`.
- Apakah angka tagihan merekonsiliasi debit `bppiut` untuk pelanggan/periode yang
  sama.
- Apakah Adisucipto tanpa pelanggan Online adalah konfigurasi sah atau master
  yang belum lengkap.
- P4: anti-join kelengkapan lintas armada.
- P5: biaya tiga varian dan pilihan cache vs materialisasi.
- Bentuk aging, rancangan layar, detektor, gold-check, render, dan PDF.

## 7. Status kredensial

Pemilik mengetahui paparan kredensial dan memutuskan menunda rotasi untuk saat
ini. Run ini tidak membaca `.env.local`, memutar secret, atau menulis Secret
Manager.

## 8. Batas penegakan

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only
(aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS.
Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk
pengawas. **Penegakannya tetap manusia.**
