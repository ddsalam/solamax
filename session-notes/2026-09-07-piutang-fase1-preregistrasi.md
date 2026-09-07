# Piutang pelanggan Fase 1 — pra-registrasi Gerbang 0A

Tanggal segel: 2026-09-07 (WIB).  Sumber instruksi:
`/Users/ddsalam/Downloads/PROMPTCODEXpiutangfase1.md`.

Dokumen ini disegel **sebelum** query data Gerbang 0A dijalankan. Isinya tidak
boleh disunting setelah oracle dibuka. Hasil dan setiap koreksi metodologi harus
ditulis ke berkas hasil terpisah; bukan dengan mengubah prediksi di bawah.

## Lingkungan yang dikunci

- Sasaran: Cloud SQL pilot LIVE `solamax:asia-southeast2:solamax-pg`, database
  `solamax`, melalui `cloud-sql-proxy` lokal.
- Role query: `dashboard_ro`; seluruh pernyataan ke database harus `SELECT` atau
  `EXPLAIN (ANALYZE, BUFFERS)` atas `SELECT`.
- Identitas DB yang diharapkan dari bukti terdahulu:
  `system_identifier = 7650126488674766864`.
- Cakupan armada selalu memakai GUC polos
  `SET app.unit_ids = '1,2,3,4,5,6,7'`; literal array Postgres dilarang.
- Tanggal batas saldo untuk P5: akhir hari `2026-08-31` (`dtgl <=`). Rentang
  mutasi P5: `2026-08-01` s.d. `2026-08-31`, inklusif.

## Prediksi dan kondisi berhenti

### Kontrol RLS

| Kontrol | Prediksi tersegel |
|---|---:|
| tanpa GUC | 0 baris |
| GUC `'{7}'` | 0 baris |
| GUC `'99'` | 0 baris |
| GUC `'1'` | lebih dari 0 baris |

Setiap ketidakcocokan menghentikan run sebelum hasil bisnis ditafsirkan.

### P1 — taksonomi `VCREF`

- Distribusi dihitung terpisah untuk `bppiut` dan `bphut`, per unit,
  `sjnsbp`, prefiks dua karakter, dan prefiks tiga karakter; `sbatal=0`.
- Dua puluh contoh `vcket` dipilih deterministik per kombinasi dengan urutan
  `(dtgl, primary-key)`, supaya hasil bisa diulang.
- Prediksi minimum: kedua arah sah `sjnsbp=1` (debit/tagihan) dan `sjnsbp=2`
  (kredit/pembayaran) ada pada kedua ledger. Prefiks persis dan tingkat
  tumpang-tindih sengaja **tidak ditebak**; itulah objek probe.

### P2 — open-item atau balance-forward

- Denominator adalah seluruh baris pembayaran hidup (`sjnsbp=2`, `sbatal=0`,
  `vcref` tidak kosong), dilaporkan juga terhadap seluruh pembayaran agar
  referensi kosong tidak hilang dari pembacaan.
- Arah A cocok bila `trim(payment.vcref)` sama persis dengan
  `trim(debit.vcref)` **atau** primary key debit (`ckdbppiut`/`ckdbphut`) pada
  `(unit_id, ckdplg)` yang sama.
- Arah B memakai pelanggan kontrol yang diacak deterministik per unit dan pasti
  berbeda, tetapi syarat referensinya identik. Prediksi minimum: A tidak lebih
  rendah dari B; A < B adalah hasil tak sesuai harapan dan menghentikan run.
- Vonis dikunci sebelum angka dilihat: `A > 80%` dan jauh di atas B =
  **open-item**; A rendah atau A kira-kira sama dengan B =
  **balance-forward**; hasil campuran/ambigu = **BERHENTI** tanpa memilih.
- "Jauh" akan dilaporkan sebagai selisih poin persentase dan rasio A/B; tidak
  akan ditentukan ulang untuk memaksa salah satu vonis.

### P3 — diskriminator kode bertitik

- Semua master dikelompokkan per unit, ada/tidaknya titik pada `trim(ckdplg)`,
  dan `sjenis`; saldo hidup piutang per kombinasi ikut dihitung sebagai kontrol.
- Pola armada yang diharapkan: seluruh unit memiliki kode bertitik dan tanpa
  titik; kombinasi `sjenis` untuk kode bertitik merupakan subset `{1,3,4,5}`.
- `sjenis` kode bertitik di luar himpunan itu, unit tanpa salah satu bentuk
  kode, atau pola unit yang tidak dapat dijelaskan dengan aturan format kode
  adalah penyimpangan dan menghentikan run.

### P4 — anti-join kelengkapan

- Setelah `trim()` di kedua sisi, prediksi tersegel untuk **setiap** unit dan
  **kedua** ledger adalah `0` baris yatim dan `Rp 0` nilai netto yatim.
- Nilai netto: `sjnsbp=1` positif, `sjnsbp=2` negatif, hanya `sbatal=0`.
- Setiap baris atau rupiah nonnol menghentikan run; tidak akan dinormalisasi
  sebagai toleransi.

### P5 — biaya

- Ketiga query memakai formula saldo yang sudah terkunci; probe biaya tidak
  boleh mengubah filter bucket, tanda, atau batas tanggal.
- Ambang keputusan sudah tetap: waktu aktual varian tujuh unit `> 5.000 ms`
  melarang scan langsung pada jalur render dan mewajibkan laporan rancangan
  snapshot/materialisasi **sebelum** pembangunan. Nilai `<= 5.000 ms` memilih
  pola `saldo-cache.ts`, termasuk `shouldBypassEmptySaldo`.
- Tidak ada prediksi angka runtime karena runtime adalah variabel yang sedang
  diukur. Yang dipraregistrasi adalah tanggal, rentang, bentuk query, ambang,
  dan konsekuensinya.

## Hal yang sengaja belum dijalankan

- Gerbang 0B MySQL `tm_plg` tetap milik Dion dan menghentikan arc setelah blok
  siap-tempel disiapkan.
- Gerbang 1 (rancangan UI), Gerbang 2 (detektor belum-diinput), dan Gerbang 3
  (gold-check baru) belum boleh dimulai sebelum hasil Gerbang 0B kembali.
- Tidak ada query tulis, perbaikan POS, migrasi, UI, alarm, limit kredit, atau
  blokir pelanggan dalam run Gerbang 0A ini.
