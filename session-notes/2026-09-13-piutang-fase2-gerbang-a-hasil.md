# Piutang Fase 2 — Gerbang A

Status akhir: **BERHENTI — Gerbang A belum lulus; pemicu wajib berhenti berupa piutang yatim nonnol ditemukan.**
Bagian hipotesis di bawah ditulis saat praregistrasi, sebelum kueri pertama.
Waktu penguncian: 2026-09-13 06:39:16 UTC (13:39:16 Asia/Pontianak).
Worker: Codex, eksekusi langsung dalam sesi yang diminta.
Branch: `codex/piutang-fase2`, basis `origin/staging` = `d48f3c77d0b4511e5e1719ff5282b5169d053282`.
`git fetch origin` lalu `git diff --stat origin/staging origin/main` menghasilkan keluaran kosong.
`apps/agent/solamax-agent-bundle/` adalah untracked milik sesi lain dan dikecualikan dari pekerjaan.

## Hipotesis dikunci sebelum kueri

- **H1:** keenam komponen pembentuk tiga `awal_*_total` snapshot 13-09, dengan `dtgl < 2026-09-13`, akan menghasilkan saldo yang cocok eksak dengan laporan EasyMax per 12-09-2026. Laporan 12-09 belum tersedia; H1 tidak boleh dinyatakan lulus berdasarkan laporan 13-09.
- **H2:** jumlah `snapshot_row` jauh lebih besar dari 328 karena union master dan kedua ledger (master IB menurut brief: 2.973). Perbedaan jumlah baris saja bukan cacat. Total yang berbeda terhadap oracle yang setara perlu diagnosis.
- **H3:** jumlah baris aktif dalam source cut sampai 13-09 dengan `sjnsbp` di luar `{1,2}` adalah nol. Hitung `NULL` secara eksplisit juga; `NOT IN (1,2)` sendirian tidak menangkap `NULL`. Jika nonnol, Tugas C terblokir sampai maknanya diputuskan.

Tambahan verifikasi yang dikunci sebelum kueri:

- Kontrol identitas koneksi dan unit 1 harus positif setelah `SET app.unit_ids = '1'`; nol baris tidak boleh ditafsirkan sebagai data kosong sebelum kontrol lolos.
- Periksa hak SELECT aktual untuk manifest, pointer, row, work, dan source cut. Migrasi 0037:681–684 mencabut SELECT source cut dari `dashboard_app`; jangan mengubah grant untuk menjalankan audit.
- Periksa yatim piutang tanpa titik di luar master `sjenis IN (1,5)`. Ekspektasi yang diperlukan untuk melanjutkan: tidak ada kontribusi nonnol; jika muncul, berhenti dan lapor tanpa perbaikan formula.
- Hitung pelanggan dengan piutang dan hutang nonnol bersamaan, untuk AWAL dan AKHIR terpisah. Belum diasumsikan nol.
- Selisih AKHIR terhadap EasyMax 13-09 didefinisikan `EasyMax − snapshot`, bukan bukti kelulusan formula. Rinci per pelanggan dan debet/kredit jika akses source cut tersedia; atribusi ke transaksi pagi memerlukan bukti waktu pencatatan, bukan hanya `dtgl`.
- Verifikasi enam total baris terhadap manifest dan saldo hasil debet dikurangi kredit source cut. Ini konsistensi internal, bukan pengganti oracle EasyMax 12-09.

## Batas pelaksanaan

Hanya SELECT dan pengaturan sesi/transaksi read-only. Tidak ada kode aplikasi, migrasi, push, PR, job, deploy, atau tulis data produksi. Berhenti pada Gerbang A sesuai §1 lampiran pengguna. Rancangan B/C/D dan usulan E menunggu laporan Gerbang A kepada Dion.

Skrip sumber: `/private/tmp/claude-501/-Users-ddsalam-Repo-Obsidian-Vault/6c378f7d-9ec2-4cf5-99eb-cbe2682d522a/scratchpad/verif/verify-piutang-ib.sh`.
Sebelum eksekusi, salinan audit akan mengualifikasi kolom `source_cycle_id` yang ambigu pada CTE `lk`, memberlakukan read-only, serta memisahkan kueri menurut hak baca agar satu denial tidak menghilangkan hasil kueri lain.

## Hasil dan alasan berhenti

Kueri source cut menghasilkan **14.479 baris ledger piutang yatim**, dengan jumlah debet **Rp6.411.357.535** dan jumlah kredit **NULL**. Ini jumlah baris transaksi, **bukan** jumlah pelanggan. Predikatnya: transaksi aktif sampai 13-09, kode tanpa titik, tidak termasuk master lokal `sjenis IN (1,5)`. Bukti: `session-notes/evidence/2026-09-13-piutang-fase2-gerbang-a/01-audit.txt:71`; predikat kueri: `01-audit.sql:125–130` di direktori bukti yang sama.

`NULL` pada SUM kredit dipertahankan sebagaimana hasil database: ia tidak membuktikan tidak ada baris kredit (SUM juga NULL bila seluruh nominal yang memenuhi filter NULL). Karena itu laporan ini tidak mengarang jumlah kredit ataupun jumlah pelanggan yatim. Debet nonnol sudah cukup memicu aturan berhenti §1. Tidak ada kueri lanjutan setelah hasil tersebut diterima; transaksi audit berakhir `ROLLBACK` (`01-audit.txt:74`), lalu proxy dihentikan 13:40:58 Asia/Pontianak.

Formula memang mensyaratkan master lokal untuk Piutang Lokal dan titik untuk Piutang Online (`apps/backend/src/saldo-pelanggan/snapshot-sql.ts:130–176`). Dengan dua predikat itu, kelas yatim tersebut tidak masuk kedua bucket. **Belum dibuktikan bagaimana EasyMax memperlakukannya**, apakah master memiliki jenis lain, dan apakah barisnya merupakan posting/pembalik atau jenis transaksi lain. Jangan menambahkan Rp6,411 miliar ke saldo ataupun menyebutnya selisih EasyMax yang sudah terbukti. Selisih laporan yang teramati jauh berbeda dan tidak membuktikan penyebab yang sama.

| Hipotesis | Putusan | Bukti dan batas |
|---|---|---|
| H1 — AWAL 13-09 = laporan 12-09 | **Belum diuji** | Oracle EasyMax 12-09 belum disediakan. Kecocokan internal keenam saldo tidak menggantikannya. |
| H2 — baris snapshot jauh lebih banyak dari 328 | **Lulus untuk prediksi jumlah** | Aktual dan manifest sama-sama 2.973; 2.645 lebih banyak dari laporan, sekitar 9,06×. Union master/ledger ada pada `snapshot-sql.ts:154–157`; hasil pada `01-audit.txt:54–59`. Ini tidak meluluskan kebenaran total. |
| H3 — `sjnsbp` lain nol | **Lulus terbatas pada tiga bucket; belum lengkap untuk seluruh ledger aktif** | Masing-masing tiga bucket menghasilkan 0, termasuk pemeriksaan NULL (`01-audit.sql:106,114,122`; hasil `01-audit.txt:68–70`). Pada baris yatim, kolom terakhir adalah `count(*)`, bukan jumlah `sjnsbp` lain (`01-audit.sql:129`). Jadi 14.479 tidak boleh disebut 14.479 jenis transaksi tak dikenal. Pemeriksaan H3 atas kelompok yatim/kode NULL belum dilakukan karena gerbang berhenti. |

Tugas C belum memperoleh izin untuk dilanjutkan. Tidak ada perubahan kode aplikasi, migrasi, build, tes integrasi, commit, push, PR, deployment, scheduler, ataupun hak akses DB dalam sesi ini. Cabang baru dan berkas hasil audit lokal saja yang dibuat.

## Identitas, akses, dan keadaan snapshot

Bukti mentah berada di `session-notes/evidence/2026-09-13-piutang-fase2-gerbang-a/`; nama pendek berkas bukti pada bagian berikut merujuk direktori itu.

- Preflight 13:39:48 Asia/Pontianak: `dashboard_app`, database `solamax`, `transaction_read_only=on`, `app.unit_ids=1`; identitas unit **1 / 6478111 / Imam Bonjol / Asia/Pontianak**, dan mirror `bppiut` berisi **407.858** baris untuk unit 1 (`00-preflight.txt:5–15`). Kontrol ini juga diulang dalam transaksi audit (`01-audit.txt:3–21`). `system_identifier` dari skrip asli kosong; ia tidak dipakai sebagai bukti identitas. Proxy diarahkan ke instance `solamax:asia-southeast2:solamax-pg`.
- Hak SELECT aktual **true** untuk kedelapan relasi yang diperiksa, termasuk source cut dan work (`00-preflight.txt:18–27`). Ini berbeda dari REVOKE dalam migrasi 0037:681–684; penyebab perbedaan belum ditelusuri dan tidak ada grant yang diubah.
- Di rentang **1–13 Sep**, pointer hanya ada pada **13-09**, generasi `c45a4da2-5d16-4e8f-bf67-37343e02eb47`, `pending_replacement=false`, formula `saldo-pelanggan-v1`, sequence **42** (`01-audit.txt:24–27`). Label echo skrip warisan masih menulis 10–13; WHERE yang dijalankan mencakup 1–13 (`01-audit.sql:19`).
- Status manifest **complete**; `done` dalam brief adalah status pemicu/work, bukan nilai status manifest. Waktu terbit **02:05:26,055 WIB 13 Sep** (`01-audit.txt:27`).
- Source cut `c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff` selesai **02:05:15,271 WIB**, dengan manifest mencatat master **2.973**, `bppiut` **407.790**, `bphut` **300.257** (`01-audit.txt:54`). Perbedaan jumlah mirror kini dan cut tidak otomatis merupakan jumlah transaksi pagi yang menjelaskan laporan.
- Seluruh manifest unit 1 memuat **31-08 complete** dan **13-09 complete**, tanpa `failed` atau `building` pada hasil ini (`01-audit.txt:30–35`). Manifest 31-08 tidak sama dengan bukti pointer historis September. Work hanya **13-09 done**, percobaan **1** (`01-audit.txt:37–40`).
- Ada **2.784** pelanggan nol di keenam kolom; **189** sisanya memiliki setidaknya satu saldo nonnol. Irisan piutang–hutang nonnol **0 pada AWAL** dan **0 pada AKHIR** (`01-audit.txt:57–59`). Ini tidak menghapus kemungkinan irisan pada unit/tanggal lain.

## Enam pasangan debet/kredit source cut

Semua angka berikut dalam rupiah. Di generasi ini, AWAL dan AKHIR kebetulan sama pada setiap bucket; keduanya tetap ditampilkan agar keenam pasangan dapat diperiksa. Bukti: `01-audit.txt:54–70`.

| Periode | Bucket | Debet | Kredit | Debet − Kredit = saldo baris = total manifest |
|---|---|---:|---:|---:|
| Awal | Piutang Lokal | 122.345.938.294 | 109.293.254.106,50 | 13.052.684.187,50 |
| Akhir | Piutang Lokal | 122.345.938.294 | 109.293.254.106,50 | 13.052.684.187,50 |
| Awal | Piutang Online | 10.505.841 | 9.605.841 | 900.000 |
| Akhir | Piutang Online | 10.505.841 | 9.605.841 | 900.000 |
| Awal | Hutang Lokal | 53.549.062.678,50 | 54.222.073.216,50 | −673.010.538 |
| Akhir | Hutang Lokal | 53.549.062.678,50 | 54.222.073.216,50 | −673.010.538 |

Pemeriksaan lokal dengan aritmetika `Decimal` memastikan keenam kesamaan total, 2.973 kode unik, dan penjumlahan semua selisih per pelanggan (`02-local-checks.txt:1–13`). Ini pemeriksaan hasil kueri, **bukan** pengujian float64 Tugas C atau pembuktian oracle eksternal.

## Rekonsiliasi AKHIR terhadap laporan EasyMax 13-09

Oracle 13-09 diterima dari CSV yang sudah diparse sesuai brief; workbook tidak dicetak atau dicetak ulang. Delta di bawah selalu **EasyMax − snapshot**. Sumber angka EasyMax: brief §0 dan `easymax-ib-2026-09-13.csv`; source cut: `01-audit.txt:68–70`; saldo manifest: `01-audit.txt:46–48`.

| Bucket | EasyMax saldo siang | Snapshot AKHIR | Delta saldo | Delta debet | Delta kredit |
|---|---:|---:|---:|---:|---:|
| Piutang Lokal | 13.088.663.549,50 | 13.052.684.187,50 | **35.979.362** | 35.979.362 | 0 |
| Piutang Online | 900.000 | 900.000 | **0** | 0 | 0 |
| Hutang Lokal | −671.605.538 | −673.010.538 | **1.405.000** | 1.405.000 | 0 |

Total delta saldo seluruhnya terlokalisasi ke **tujuh pelanggan**, tanpa residu aritmetika pada tiap bucket. Bukti: `selisih-per-pelanggan.csv:2–8`, dihitung dari ekspor `per-pelanggan.csv` dengan pencocokan kode dan bucket; nilai nol dipakai untuk kode yang tidak hadir di sisi pembanding. Ketujuh baris selisih di bawah hadir di kedua sumber.

| Bucket | Kode / nama dari EasyMax | Snapshot AKHIR | EasyMax | Delta |
|---|---|---:|---:|---:|
| Piutang Lokal | PLG0032 — SETDA PROV-KB | 195.810.530 | 195.835.530 | 25.000 |
| Piutang Lokal | PLG0036 — JNE - KB | 858.393.390 | 859.634.190 | 1.240.800 |
| Piutang Lokal | PLG2234 — DCK TRK KKR-DEX | 1.230.287.914 | 1.231.497.914 | 1.210.000 |
| Piutang Lokal | PLG2707 — SETDA KOTA | 425.153.816 | 425.219.016 | 65.200 |
| Piutang Lokal | PLG2952 — PT INDOMARCO P. | −564.129.111 | −530.742.549 | 33.386.562 |
| Piutang Lokal | PLG2960 — INDOMARCO P. | 134.054.499 | 134.106.299 | 51.800 |
| Hutang Lokal | PLG2641 — PT GLOBAL JET EX | −63.115.351 | −61.710.351 | 1.405.000 |

**Atribusi sebab rupiah-per-rupiah belum selesai.** Keenam delta Piutang Lokal berjumlah tepat Rp35.979.362, dan delta Hutang Lokal tepat Rp1.405.000, tetapi tidak satu pun telah ditautkan ke ID transaksi dan waktu pencatatan 02:05–12:45. Seluruh kedua jumlah tersebut masih belum terjelaskan secara temporal. Tidak ada alasan untuk mengklaim mereka pasti transaksi pagi atau cacat formula. Kecocokan Piutang Online juga tidak meluluskan H1. Investigasi tambahan berhenti saat yatim nonnol terdeteksi, sebagaimana diminta.

## Bukti yang disimpan dan batas reproduksi

- `00-preflight.sql` / `00-preflight.txt`: kontrol koneksi, RLS, dan hak SELECT.
- `01-audit.sql` / `01-audit.txt`: SQL persis yang dijalankan dan hasil utuh. Memakai satu transaksi `REPEATABLE READ READ ONLY`, `SET LOCAL app.unit_ids='1'`, timeout per statement 120 detik, `psql -X -v ON_ERROR_STOP=1`, serta `PGOPTIONS` yang mengaktifkan default read-only. Kredensial tidak disalin.
- `per-pelanggan.csv`: 2.973 baris snapshot beserta header.
- `easymax-ib-2026-09-13.csv`: salinan pembanding yang diberikan, 328 baris beserta header.
- `selisih-per-pelanggan.csv` dan `02-local-checks.txt`: rincian delta dan hasil pemeriksaan aritmetika lokal.
- `SHA256SUMS`: hash berkas bukti untuk pemeriksaan integritas.

SQL salinan mempertahankan path ekspor `/tmp/solamax-piutang-fase2-gerbang-a/per-pelanggan.csv` yang digunakan saat eksekusi. Jangan menjalankannya lagi tanpa memperhatikan gerbang; hasil kini dapat berubah karena pointer/cut/data baru. Dua audit selesai tanpa galat SQL. Tidak ada Docker atau CI yang dijalankan karena kode aplikasi belum disentuh.

## Yang memerlukan Dion sebelum lanjut

1. **Tanggapan atas piutang yatim:** mohon arahkan investigasi baca-saja berikutnya untuk menentukan kode pelanggan, jenis master, jenis transaksi, nominal kredit/NULL, dan perlakuan EasyMax terhadap 14.479 baris tersebut. Belum ada usulan koreksi formula; tidak ada izin koreksi yang diasumsikan.
2. **Oracle H1:** mohon cetak **Laporan Hutang Piutang IB per 12-09-2026** dan berikan hasilnya. Sesuai catatan pengguna, minta cetak untuk tanggal ini; **jangan cetak ulang laporan lama**, karena EasyMax dapat memicu posting dan pembalik. Risiko itu juga harus dicatat saat menafsirkan waktu pengambilan oracle.
3. Setelah Dion menanggapi Gerbang A, lanjutkan penyelesaian H3 seluruh ledger dan atribusi transaksi tujuh pelanggan tadi. Rancangan B/C/D, keputusan tampilan pelanggan nol, usulan Fase 3, dan PR **belum dikerjakan** karena gerbang ini mendahului semuanya. Persetujuan Gerbang A kelak tidak otomatis menggantikan persetujuan rancangan/migrasi berikutnya.
