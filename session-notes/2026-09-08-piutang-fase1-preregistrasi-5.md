# Piutang pelanggan Fase 1 — pra-registrasi kelima tindak lanjut P4/P5

Tanggal segel: 2026-09-08 (WIB). Instruksi lanjutan:
`/Users/ddsalam/.codex/attachments/a52b5114-4575-44d9-982f-d8858c2158a3/pasted-text.txt`.

Berkas ini dibuat **sebelum** query tindak lanjut P4/P5 dijalankan dan bersifat
append-only. Empat segel dan lima hasil sebelumnya tetap utuh. Hasil baru tidak
boleh dipakai untuk mengubah metode di bawah.

## 1. P4 — definisi populasi dan identitas cakupan

Predikat yang dipakai P4 sebelumnya adalah persis:

```sql
COALESCE(ledger.sbatal, 0) = 0
```

Tidak ada batas tanggal, filter `ckdplg`, atau filter lain. Istilah **baris
hidup** berarti baris yang tidak dibatalkan menurut predikat tersebut.

Untuk setiap `(ledger, unit_id)`, ukur:

- `penuh = count(*)` tanpa filter;
- `terpakai_anti_join = count(*) FILTER (WHERE COALESCE(sbatal,0)=0)`;
- `dikecualikan_sbatal_1 = count(*) FILTER (WHERE sbatal=1)`;
- `dikecualikan_sbatal_lain = count(*) FILTER (WHERE COALESCE(sbatal,0)<>0 AND sbatal<>1)`;
- `selisih_identitas = penuh - terpakai_anti_join - dikecualikan_sbatal_1 - dikecualikan_sbatal_lain`.

Prediksi: `selisih_identitas = 0` pada ke-14 sel. Nilai nonnol menghentikan run.
Jika identitas tertutup, vonis yatim P4 tetap terbatas pada populasi hidup dan
tidak diklaim untuk baris batal.

## 2. P5 — pengulangan, statistik, dan urutan

Tiga SQL P5 harus identik dengan run sebelumnya. Masing-masing dijalankan enam
kali (`n=6`) sebagai tiga pasangan:

1. **non-immediate:** eksekusi pertama setelah varian lain dan melalui koneksi
   `psql` baru;
2. **warm:** eksekusi identik yang langsung menyusul dalam koneksi yang sama.

Urutan pasangan adalah V1 non-immediate/warm → V2 non-immediate/warm → V3
non-immediate/warm, diulang tiga siklus. Tidak ada cache server/OS yang
dikosongkan: Cloud SQL shared buffers tidak dapat dibuat dingin secara sah tanpa
operasi administratif/stateful. Karena itu label pertama adalah
**non-immediate**, bukan klaim cache dingin murni. Tingkat dingin/hangat dinilai
dari `shared hit/read` aktual setiap run; keterbatasan ini wajib ikut laporan.

Statistik dikunci:

- median `n=6` = rata-rata observasi terurut ke-3 dan ke-4;
- p95 nearest-rank = observasi pada peringkat `ceil(0,95 × 6)` = maksimum;
- sebaran dilaporkan sebagai minimum…maksimum serta keenam observasi;
- ambang keputusan tetap: p95 varian 2 `> 5.000 ms` menghentikan jalur scan
  langsung dan mewajibkan rancangan snapshot/materialisasi sebelum pembangunan;
  p95 `<= 5.000 ms` mempertahankan pola cache yang sudah disegel.

Eksekusi hanya `EXPLAIN (ANALYZE, BUFFERS)` atas `SELECT`, tanggal akhir
2026-08-31, dan mutasi 2026-08-01…2026-08-31. Formula bucket, tanda, master-zero,
dan `trim(ckdplg)` tidak berubah.

## 3. Bloat dan tumpahan temp

Sebelum/di sela pengukuran, baca tanpa perubahan:

- `pg_stat_user_tables.n_live_tup`, `n_dead_tup`, `last_autovacuum`, dan
  `last_autoanalyze` untuk `public.bppiut`/`public.bphut`;
- `current_setting('work_mem')`;
- `Sort Method`, `Disk`, serta temp read/written dari setiap plan varian 2.

Rasio bloat deskriptif = `n_dead_tup / NULLIF(n_live_tup + n_dead_tup,0)`.
Tidak ada ambang bloat baru yang ditentukan setelah hasil terlihat.

Karena instruksi melarang perubahan setting, kebutuhan bebas-tumpah tidak diuji
dengan `SET work_mem`. Yang boleh dilaporkan adalah:

- batas bawah empiris = tumpahan `Disk` terbesar per proses sort;
- estimasi konservatif = pangkat dua MiB pertama yang sekurangnya 1,25 kali
  batas bawah tersebut;
- estimasi harus diberi label **belum terbukti**; hanya rerun terkontrol dengan
  `work_mem` session-local yang dapat membuktikan titik tanpa tumpahan.

## 4. Premis jalur render — fakta kode sebelum pengukuran

- `/unit/[code]/laporan/[date]` me-resolve tepat satu unit dan memanggil
  `getSaldoPelangganCached(unit.unit_id, date, today)`.
- Cache yang ada berkunci `(unit,tanggal)`.
- Papan keuangan grup memang merender banyak unit, tetapi mengiterasi unit dan
  memanggil `getBahanLaporan` per unit; ia bukan satu query `GROUP BY` tujuh unit.
- Pre-warm juga berjalan sekuensial per unit dan tanggal.
- Belum ditemukan pemanggil produksi untuk query per-pelanggan baru karena fitur
  itu belum dibangun.

Pembacaan akhir hanya boleh menyatakan apakah bukti kode mendukung jalur per-unit
atau tujuh-unit. Pemilihan produk/final UI tetap ditahan oleh Gerbang 1 dan tidak
diputuskan pada arc ini.

## 5. Disiplin akses dan batas arc

- Cloud SQL pilot LIVE, role `dashboard_ro`, GUC polos tujuh unit.
- Hanya `SELECT`, `SET` GUC scope, pembacaan statistik, dan `EXPLAIN` atas
  `SELECT`; tidak ada perubahan setting atau data.
- Secret read-only diteruskan melalui variabel proses dan tidak dicetak.
- Tidak ada kode produk, migrasi, agent, UI, FIFO-imputed, push, PR, atau deploy.
- Gerbang 1 dan keputusan sync tagihan tetap menunggu D1–D5 tujuh unit.
