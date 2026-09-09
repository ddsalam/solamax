# Piutang pelanggan Fase 1 — hasil parsial Gerbang 0A

Tanggal eksekusi: 2026-09-07 (WIB). Pra-registrasi yang menjadi segel:
[`2026-09-07-piutang-fase1-preregistrasi.md`](2026-09-07-piutang-fase1-preregistrasi.md).

Status: **BERHENTI pada P2**. P3, P4, P5, Gerbang 0B, rancangan, detektor
belum-diinput, gold-check, migrasi, dan UI belum dijalankan.

## 1. Lingkungan dan kontrol RLS

Query dijalankan ke Cloud SQL pilot LIVE
`solamax:asia-southeast2:solamax-pg` melalui `cloud-sql-proxy`, memakai role
`dashboard_ro`. Seluruh statement terhadap database adalah `SELECT`, `SET`, atau
pembacaan katalog; tidak ada statement tulis.

| Bukti | Hasil | Ekspektasi | Putusan |
|---|---:|---:|---|
| `current_user` | `dashboard_ro` | `dashboard_ro` | cocok |
| `current_database()` | `solamax` | `solamax` | cocok |
| `system_identifier` | `7650126488674766864` | `7650126488674766864` | cocok |
| tanpa GUC, `count(bppiut)` | 0 | 0 | cocok |
| GUC `'{7}'`, `count(bppiut)` | 0 | 0 | cocok |
| GUC `'99'`, `count(bppiut)` | 0 | 0 | cocok |
| GUC `'1'`, `count(bppiut)` | 405.729 | >0 | cocok |

Nol pada tiga kontrol negatif sah karena kontrol positif Imam Bonjol menyala.

## 2. P1 — taksonomi `VCREF`

Probe mengelompokkan kedua ledger per unit, `sjnsbp`, prefiks dua dan tiga
karakter, hanya `sbatal=0`. Query contoh juga benar-benar mengambil hingga 20
`vcket` pertama secara deterministik untuk seluruh **53 kombinasi** yang ada.

### Ringkasan seluruh armada

| Ledger | Arah | Prefiks teramati | Makna dari contoh `vcket` |
|---|---|---|---|
| `bppiut` | debit `1` | `JP`, `UV`, `01`, `TP`, `TV` | penjualan pelanggan, voucher kredit, saldo awal, transaksi manual/penyesuaian, penukaran voucher |
| `bppiut` | kredit `2` | `BT`, `01`, `TP` | pembayaran tagihan, saldo awal, transaksi manual/penyesuaian |
| `bphut` | debit `1` | `JP`, `UV`, `01`, `TP` | penjualan pelanggan, pembelanjaan voucher, saldo awal, transaksi manual/penyesuaian |
| `bphut` | kredit `2` | `DP`, `TP`, `01` | deposit pelanggan, transaksi manual/penyesuaian, saldo awal |

Prefiks **sebagian besar terpisah rapi**, tetapi tidak sempurna:

- `bppiut`: `TP` tumpang tindih pada unit 2 (1 debit, 1 kredit) dan unit 4
  (158 debit, 651 kredit); `01` tumpang tindih pada unit 4 (38 debit, 1
  kredit).
- `bphut`: `01` tumpang tindih pada unit 1 (16 debit, 160 kredit); `TP`
  tumpang tindih pada unit 2 (1 debit, 167 kredit) dan unit 4 (103 debit,
  752 kredit).
- Prefiks yang dominan tetap satu arah: `JP`/`UV` berada pada debit,
  `BT` berada pada kredit `bppiut`, dan `DP` berada pada kredit `bphut`.

Contoh `vcket` menegaskan bahwa tumpang tindih bukan artefak pemotongan prefiks:
`01-…` berisi `SALDO AWAL`, sedangkan `TP…` berisi transaksi bebas seperti
penyesuaian, bayar tagihan, bayar dimuka, atau pengambilan uang. Karena itu
prefiks bukan foreign key yang aman untuk penautan faktur-pembayaran.

## 3. P2 — hasil dua arah

Definisi cocok A mengikuti segel: `payment.vcref` harus sama persis dengan
`debit.vcref` atau primary key debit pada unit dan pelanggan yang sama. Kontrol B
memindahkan setiap pelanggan ke pelanggan lain secara deterministik dalam unit
yang sama, lalu menjalankan syarat referensi yang identik. Semua pembayaran
memiliki `vcref` nonkosong.

### `bppiut`

| Unit | Pembayaran | Cocok A | A | Cocok B | B |
|---:|---:|---:|---:|---:|---:|
| 1 | 1.887 | 0 | 0,0000% | 0 | 0,0000% |
| 2 | 745 | 0 | 0,0000% | 0 | 0,0000% |
| 3 | 92 | 0 | 0,0000% | 0 | 0,0000% |
| 4 | 6.144 | 0 | 0,0000% | 0 | 0,0000% |
| 5 | 549 | 0 | 0,0000% | 0 | 0,0000% |
| 6 | 97 | 0 | 0,0000% | 0 | 0,0000% |
| 7 | 2.312 | 0 | 0,0000% | 0 | 0,0000% |
| **Total** | **11.826** | **0** | **0,0000%** | **0** | **0,0000%** |

### `bphut`

| Unit | Pembayaran | Cocok A | A | Cocok B | B |
|---:|---:|---:|---:|---:|---:|
| 1 | 5.449 | 0 | 0,0000% | 12 | 0,2202% |
| 2 | 318 | 0 | 0,0000% | 0 | 0,0000% |
| 3 | 12 | 0 | 0,0000% | 0 | 0,0000% |
| 4 | 2.607 | 0 | 0,0000% | 0 | 0,0000% |
| 5 | 273 | 0 | 0,0000% | 0 | 0,0000% |
| 6 | 48 | 0 | 0,0000% | 0 | 0,0000% |
| 7 | 3.871 | 0 | 0,0000% | 0 | 0,0000% |
| **Total** | **12.578** | **0** | **0,0000%** | **12** | **0,0954%** |

### Vonis substantif P2

**Balance-forward.** A nol pada **24.404 pembayaran** gabungan, sedangkan B juga
mendekati nol dan hanya mendapat 12 kecocokan kebetulan. Tidak ada bukti bahwa
baris pembayaran menunjuk tagihan tertentu. Aging per faktur bukan fakta sumber;
bila arc dilanjutkan, bentuk yang diizinkan prompt adalah **FIFO-imputed** dengan
label keterbatasan yang diwajibkan.

### Kondisi stop metodologis

Pra-registrasi memprediksi A tidak lebih rendah dari B. Pada `bphut`, A = 0
sedangkan B = 12 (selisih −0,0954 poin persentase). Nilai ini tidak membatalkan
vonis balance-forward—justru memperlihatkan kecocokan acak—tetapi tetap
**melanggar ekspektasi yang disegel**. Kontrak otonomi mewajibkan berhenti dan
melapor; ekspektasi tidak boleh diedit setelah oracle dilihat.

## 4. Yang belum diketahui karena stop

- P3: pola kode bertitik lintas tujuh unit.
- P4: anti-join kelengkapan kedua ledger lintas tujuh unit.
- P5: biaya tiga varian query dan keputusan cache vs materialisasi.
- Apakah `tm_plg` EasyMax mempunyai kolom limit kredit/tempo dan keterisiannya.
- Detektor jalur `pelanggan_sale`, triase temuan voucher terkini, gold-check
  baru, rancangan layar, implementasi, render, dan PDF.

## 5. Insiden kerahasiaan selama setup

Saat parser URL lokal gagal membaca tanda kutip, pesan error alat sempat
menggemakan URL beserta kredensial dari `.env.local` ke transkrip. Nilainya tidak
disalin ke dokumen ini dan tidak dipakai pada query data; probe kemudian memakai
secret `dashboard_ro`. Sesuai aturan repo, kredensial yang terpapar perlu
dirotasi oleh pemilik melalui prosedur yang berlaku—bukan oleh run ini.

## 6. Batas penegakan

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only
(aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS.
Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk
pengawas. **Penegakannya tetap manusia.**
