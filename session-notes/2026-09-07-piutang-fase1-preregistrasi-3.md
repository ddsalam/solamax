# Piutang pelanggan Fase 1 — pra-registrasi ketiga Gerbang 0C/P3–P5

Tanggal segel: 2026-09-07 (WIB). Instruksi lanjutan:
`/Users/ddsalam/.codex/attachments/73d65dae-ddf6-48c0-9192-f60348e51088/pasted-text.txt`.

Berkas ini dibuat sebelum query lanjutan ke mirror dijalankan dan bersifat
**append-only**. Dua segel dan dua hasil sebelumnya tetap utuh. Hasil baru tidak
boleh dipakai untuk menyunting prediksi di bawah.

## 1. Fakta Gerbang 0B yang diterima sebelum segel

- Imam Bonjol memakai DB `easymax`.
- `tm_plg` mempunyai tepat sembilan kolom dan tidak mempunyai kolom limit kredit,
  plafon, termin, tempo, atau jatuh tempo. Limit/tempo menjadi master milik
  SolaMax pada arc berikutnya, bukan arc ini.
- `tr_bppiut` dan `tr_bphut` masing-masing mempunyai tepat delapan kolom, sama
  dengan mirror. Vonis P2 naik menjadi **balance-forward penuh untuk kedua
  ledger**.
- EasyMax mempunyai sepuluh objek bernama `tagih`, termasuk tabel dasar
  `tr_htagihan`, `tr_dtagihan`, dan `tr_byrtagih`; belum ada domain sync-nya di
  SolaMax.
- Pencarian `%bayar%` kosong, tetapi `%tagih%` menemukan `byr`: hasil kosong dari
  satu pola nama bukan bukti ketiadaan.

## 2. Gerbang 0C — keputusan sebelum hasil Dion berikutnya

Aging dan rancangan layar tetap ditahan. FIFO-imputed tidak boleh dibangun selama
modul tagihan terpisah belum diputuskan.

Hasil probe dua unit nanti dibaca dengan aturan yang dikunci berikut:

1. `COUNT=0` atau tanggal maksimum bertahun-tahun lalu berarti modul dorman pada
   **unit itu saja**. Unit lain tidak boleh diwarisi status yang sama.
2. Modul hidup tanpa kunci `tr_byrtagih → tr_htagihan` berarti sumber faktur ada,
   tetapi open-item belum terbukti; berhenti dan laporkan bentuk sebenarnya.
3. Modul hidup dengan kunci pembayaran→faktur berarti open-item nyata;
   **BERHENTI dan lapor** sebelum desain atau kode.
4. Kesamaan uang tagihan dan ledger harus dibuktikan pada satu pelanggan dan
   periode; nama tabel tidak cukup.
5. Modul hidup dan bertaut mengharuskan usul domain sync baru untuk tiga tabel.
   Migrasi, perubahan agent, dan rollout tujuh mesin tidak boleh dimulai di arc
   ini.

## 3. Selisih 90 baris Imam Bonjol

Baseline mirror pertama `C0 = 405.729`; hasil MySQL Dion `CM = 405.819`.
Pembacaan mirror baru menghasilkan `C1`.

Prediksi: `C1 ≥ 405.819`, sehingga `C1 − C0 ≥ 90`, dan sedikitnya 90 baris
memiliki `dtgl = 2026-09-07` (kedua pembacaan terjadi pada tanggal bisnis yang
sama). Selisih ditutup hanya bila pertumbuhan mirror minimal 90 dan populasi
tanggal itu cukup menjelaskannya. `ingested_at` tidak dipakai karena full-sync
ledger menulis ulang waktu ingest.

**Kondisi berhenti:** `C1 < 405.819`, pertumbuhan mirror <90, atau jumlah baris
bertanggal 2026-09-07 <90.

## 4. P3 — kode bertitik lintas armada

Prediksi dan kondisi berhenti segel pertama tetap berlaku:

- setiap unit memiliki kode bertitik dan tanpa titik;
- `sjenis` pelanggan bertitik merupakan subset `{1,3,4,5}`;
- kombinasi di luar himpunan, salah satu bentuk kode absen, atau unit yang tidak
  dapat dijelaskan oleh diskriminator format kode menghentikan run.

Probe menghitung per `(unit, dotted, sjenis)`: pelanggan master, pelanggan aktif,
pelanggan dengan baris piutang hidup, jumlah baris, dan saldo akhir
2026-08-31. `ckdplg` selalu di-`trim`; Online tidak diberi filter `sjenis`.

## 5. P4 — anti-join kelengkapan

Prediksi segel pertama tetap: pada tiap unit dan kedua ledger, setelah `trim()`
dua sisi, baris hidup tanpa `pelanggan_master` = 0 dan nilai netto = Rp0.
Kontrol positif per ledger/unit wajib menunjukkan query dasar memang mempunyai
baris. Satu orphan atau rupiah nonnol menghentikan run.

## 6. P5 — biaya tiga varian

Tanggal dan rentang dari segel pertama tetap: akhir hari 2026-08-31; mutasi
2026-08-01 s.d. 2026-08-31 inklusif.

1. **Per pelanggan, satu unit:** unit 4 (riwayat terberat), tiga ember per
   `(unit, trim(ckdplg))`, termasuk kunci master agar pelanggan nol dapat
   dipertahankan.
2. **Per pelanggan, tujuh unit:** bentuk sama, dikelompokkan per `(unit, kode)`;
   kode tidak pernah digabung lintas unit.
3. **Mutasi rentang tanggal:** tujuh unit, per `(unit, kode, tanggal)`, tiga
   ember, hanya mutasi dalam rentang.

Ketiganya dijalankan dengan `EXPLAIN (ANALYZE, BUFFERS)` atas `SELECT`; formula
bucket dan tanda sama dengan `getSaldoPelanggan`.

Ambang tetap: execution time varian 2 >5.000 ms melarang scan langsung di jalur
render dan mengharuskan rancangan snapshot/materialisasi dilaporkan sebelum
pembangunan. Nilai ≤5.000 ms memakai pola `saldo-cache.ts`: historis 24 jam,
hari berjalan/H−1 120 detik, dan nol-semua selalu bypass cache.

Tidak ada prediksi runtime selain ambang keputusan; runtime adalah objek ukur.

## 7. Disiplin akses dan berhenti

- Cloud SQL pilot LIVE `solamax-pg`, role `dashboard_ro`, GUC polos tujuh unit.
- Hanya `SELECT`, `SET`, pembacaan katalog, dan `EXPLAIN` atas `SELECT`.
- `.env.local` tidak dibaca atau dicetak. Secret read-only diteruskan langsung
  melalui variabel proses.
- Tidak ada tulis DB, POS, migrasi, UI, push, PR, atau deploy.
- Setelah P3–P5 dan penutupan selisih 90 dicatat, siapkan blok Gerbang 0C dan
  **berhenti menunggu Dion**. Gerbang 1 tetap tertahan.
