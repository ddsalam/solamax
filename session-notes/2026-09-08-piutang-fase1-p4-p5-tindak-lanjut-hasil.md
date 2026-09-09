# Piutang pelanggan Fase 1 — hasil tindak lanjut P4/P5

Tanggal: 2026-09-08 (WIB). Branch: `codex/piutang-fase1-probe`.

Metode run ini disegel pada commit `aedc03e` sebelum query dijalankan. Seluruh
segel dan hasil sebelumnya tidak disunting.

## 1. P4 — cakupan anti-join tertutup

Predikat persis P4 sebelumnya adalah `COALESCE(sbatal,0)=0`. Tidak ada batas
tanggal atau pengecualian `ckdplg`. Jadi “baris hidup” berarti **hanya baris
tidak batal**; perbedaan terhadap `count(*)` penuh seluruhnya harus masuk kelas
`SBATAL=1` atau `SBATAL` nonnol lainnya.

| Ledger | Unit | Penuh | Terpakai anti-join (`SBATAL=0`) | Dikecualikan: `SBATAL=1` | Dikecualikan: nonnol lain | Selisih identitas |
|---|---:|---:|---:|---:|---:|---:|
| `bphut` | 1 | 299.073 | 44.543 | 254.530 | 0 | 0 |
| `bphut` | 2 | 26.347 | 8.285 | 18.062 | 0 | 0 |
| `bphut` | 3 | 684 | 134 | 550 | 0 | 0 |
| `bphut` | 4 | 95.830 | 37.955 | 57.875 | 0 | 0 |
| `bphut` | 5 | 12.762 | 2.084 | 10.678 | 0 | 0 |
| `bphut` | 6 | 733 | 177 | 556 | 0 | 0 |
| `bphut` | 7 | 106.700 | 22.687 | 84.013 | 0 | 0 |
| `bppiut` | 1 | 405.917 | 60.587 | 345.330 | 0 | 0 |
| `bppiut` | 2 | 272.286 | 80.220 | 192.066 | 0 | 0 |
| `bppiut` | 3 | 3.173 | 587 | 2.586 | 0 | 0 |
| `bppiut` | 4 | 933.778 | 345.216 | 588.562 | 0 | 0 |
| `bppiut` | 5 | 382.035 | 102.385 | 279.650 | 0 | 0 |
| `bppiut` | 6 | 24.397 | 5.995 | 18.402 | 0 | 0 |
| `bppiut` | 7 | 766.506 | 169.115 | 597.391 | 0 | 0 |

Identitas `penuh = terpakai + SBATAL=1 + SBATAL-nonnol-lain` tertutup tepat
pada ke-14 sel. Distribusi mentah `SBATAL` juga hanya mempunyai nilai `0` dan
`1`; tidak ada `NULL` atau nilai lain pada hasil ini.

**Vonis P4:** lulus untuk populasi hidup yang didefinisikan secara eksplisit.
Nol yatim tidak diklaim untuk 2.450.251 baris batal. Angka penuh unit 1 sudah
bergerak dari snapshot 405.819 menjadi 405.917 saat probe ini; identitas tetap
tertutup pada satu snapshot query yang sama.

## 2. P5 — enam pengukuran per varian

Setiap siklus menjalankan pasangan non-immediate lalu warm dalam koneksi yang
sama; urutan V1→V2→V3 diulang tiga kali. “Non-immediate” berarti varian itu baru
didahului varian lain dan koneksi baru—bukan cache server/OS yang dipaksa dingin.
Shared buffers Cloud SQL tidak dihapus.

### Ringkasan waktu

| Varian | n | Enam observasi (ms) | Median (ms) | Min…maks (ms) | p95 nearest-rank (ms) |
|---|---:|---|---:|---:|---:|
| V1 · per pelanggan, unit 4 | 6 | 2.583,457 · 2.783,966 · 2.609,599 · 2.000,341 · 2.050,516 · 1.955,508 | 2.316,987 | 1.955,508…2.783,966 | 2.783,966 |
| V2 · per pelanggan, 7 unit | 6 | 5.098,372 · 4.967,853 · 5.439,128 · 5.016,360 · 5.012,964 · 4.882,390 | **5.014,662** | 4.882,390…5.439,128 | **5.439,128** |
| V3 · mutasi per pelanggan/tanggal | 6 | 78,034 · 55,330 · 74,026 · 36,808 · 82,226 · 70,176 | 72,101 | 36,808…82,226 | 82,226 |

V2 melewati 5.000 ms pada 4 dari 6 run. p95 V2 = 5.439,128 ms, sehingga kondisi
berhenti tersegel **terpenuhi**: scan tujuh-unit langsung tidak boleh menjadi
jalur render.

### Buffer dan tumpahan V2

| Siklus | Keadaan | Waktu (ms) | Shared hit/read | Hit share | Temp read/written (blok) | External sort | Disk terbesar |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | non-immediate | 5.098,372 | 16.431 / 49.424 | 24,95% | 3.527 / 3.540 | 3 | 10.072 kB |
| 1 | warm | 4.967,853 | 16.440 / 49.415 | 24,96% | 3.526 / 3.540 | 3 | 9.800 kB |
| 2 | non-immediate | 5.439,128 | 16.179 / 49.676 | 24,57% | 3.526 / 3.540 | 3 | 10.032 kB |
| 2 | warm | 5.016,360 | 16.424 / 49.431 | 24,94% | 3.528 / 3.541 | 3 | 9.480 kB |
| 3 | non-immediate | 5.012,964 | 16.790 / 49.065 | 25,50% | 3.737 / 3.751 | 4 | 9.840 kB |
| 3 | warm | 4.882,390 | 16.985 / 48.870 | 25,79% | 3.527 / 3.540 | 3 | 10.616 kB |

Hit share hanya bergerak 24,57%…25,79%; pasangan warm tidak membuat V2 menjadi
query yang dominan cache-hit. Semua run tumpah ke temp, sekitar 27,5…29,3 MiB
blok temp tingkat atas. Karena itu pengulangan menguatkan, bukan membatalkan,
peringatan dari run tunggal sebelumnya.

## 3. Bloat dan `work_mem`

`pg_stat_user_tables` saat pengukuran:

| Tabel | `n_live_tup` | `n_dead_tup` | Dead share | `last_autovacuum` | `last_autoanalyze` |
|---|---:|---:|---:|---|---|
| `bphut` | 542.129 | 668 | 0,12% | 2026-08-05 08:51:10+00 | 2026-08-05 08:51:13+00 |
| `bppiut` | 2.787.977 | 2.765 | 0,10% | 2026-08-05 08:50:54+00 | 2026-08-05 08:50:58+00 |

Angka `pg_stat_user_tables` adalah estimasi statistik, tetapi cukup jelas bahwa
bloat 70,9% Agustus tidak sedang berulang: dead share kini sekitar 0,1%.
`shared written` yang sesekali tampak pada V1 tidak boleh sendiri ditafsirkan
sebagai bukti bloat; statistik tabel langsung tidak mendukung tafsir itu.

`work_mem` saat ini **4 MB**. V2 selalu menjalankan sedikitnya tiga external
sort, dengan tumpahan terbesar 10.616 kB (10,37 MiB) per proses sort. Sesuai
rumus yang disegel:

- batas bawah empiris: >10,37 MiB per sort;
- `1,25 × 10,37 MiB = 12,96 MiB`;
- pangkat dua MiB pertama di atasnya: **estimasi konservatif 16 MB per sort**.

Estimasi 16 MB **belum terbukti** sebagai titik bebas-tumpah. Tidak ada setting
yang diubah; pembuktian memerlukan eksperimen session-local terpisah yang tidak
diizinkan pada run ini. Parallel workers dan beberapa node sort juga membuat
anggaran total lebih besar daripada satu nilai `work_mem`.

## 4. Pembacaan jalur render

Bukti kode yang ada tidak mendukung anggapan bahwa V2 adalah jalur render umum:

- `/unit/[code]/laporan/[date]` me-resolve satu unit dan memanggil
  `getSaldoPelangganCached(unit.unit_id,date,today)`;
- cache yang sudah ada berkunci `(unit,tanggal)`;
- pre-warm berjalan berurutan per unit/tanggal;
- papan keuangan grup memang memuat banyak unit, tetapi melakukan
  `getBahanLaporan` **per unit**, bukan satu query `GROUP BY` tujuh unit;
- belum ada pemanggil produksi untuk query saldo **per-pelanggan** V1/V2/V3,
  karena fitur Piutang Fase 1 belum dibangun.

Jadi dua strategi harus dipisahkan dalam rancangan mendatang:

1. **Layar interaktif per-unit:** V1 adalah bentuk yang relevan. p95 2.783,966
   ms masih harus dilindungi cache `(unit,tanggal)`, pre-warm, TTL historis/live,
   dan `shouldBypassEmptySaldo`.
2. **Rekap tujuh-unit:** belum terbukti sebagai kebutuhan render umum. Jika
   Gerbang 1 kelak memang menuntutnya, V2 dilarang scan langsung dan harus
   membaca snapshot. Ia tidak boleh membuat jalur per-unit ikut membayar biaya
   lintas armada.
3. **Mutasi periode:** V3 p95 82,226 ms; secara biaya ukur ini layak sebagai
   query rentang langsung, tetapi keputusan produk tetap menunggu Gerbang 1.

## 5. Rancangan snapshot untuk V2 — dilaporkan, belum dibangun

Rancangan minimum yang memenuhi kondisi berhenti:

- grain snapshot: `(as_of_date, unit_id, trim(ckdplg))`;
- nilai: tiga ember terpisah `piutang_lokal`, `piutang_online`, dan
  `hutang_lokal`; jangan dinetokan;
- provenance: `computed_at`, versi formula, watermark/sync-run sumber, jumlah
  baris ledger yang dibaca, dan status `building|complete|failed`;
- zero-master: kunci berasal dari gabungan master/piutang/hutang seperti P5,
  sehingga pelanggan tanpa mutasi tetap dapat dipertahankan;
- isolasi: `unit_id` tetap menjadi kunci dan subjek RLS; kode pelanggan tidak
  pernah digabung lintas unit;
- refresh: proses latar sesudah full-sync berhasil, per unit, bukan di request
  pengguna. Hasil dibangun pada versi baru lalu dipublikasikan secara atomik;
- koreksi back-dated atau perubahan `SBATAL` membatalkan snapshot mulai tanggal
  perubahan paling awal untuk unit tersebut dan menjadwalkan hitung ulang;
- render hanya membaca versi berstatus `complete`. Snapshot kosong tanpa
  manifest lengkap dianggap “belum siap”, bukan saldo nol;
- H/H−1 memakai refresh pendek atau snapshot penutup sebelumnya ditambah delta
  hari berjalan; tanggal historis memakai snapshot harian yang sudah lengkap;
- fallback saat snapshot belum siap adalah status data-belum-siap atau jalur
  per-unit yang dibatasi, bukan V2 scan tujuh-unit di request.

Yang belum diputuskan—dan harus menunggu Gerbang 1—adalah apakah implementasinya
berupa tabel aplikasi yang diganti atomik, materialized view, atau kombinasi
snapshot harian + delta. Tidak ada salah satunya yang dibangun pada arc ini.

## 6. Yang masih belum diketahui

- Hasil Gerbang 0D D1–D5 dari ketujuh unit.
- Apakah produk akhirnya memerlukan rekap per-pelanggan tujuh-unit, atau hanya
  navigasi per-unit dan ekspor sesekali.
- SLA kesegaran snapshot, retensi tanggal historis, dan perilaku UI saat refresh
  belum lengkap.
- Mekanisme paling andal untuk membawa tanggal perubahan paling awal dari
  full-sync ke invalidator snapshot.
- Titik `work_mem` bebas-tumpah yang benar; 16 MB hanya estimasi terdaftar,
  bukan hasil eksperimen.
- Latensi dan dampak kontensi di jalur Cloud Run nyata; angka ini diukur melalui
  proxy dari workstation dan bukan log request produksi.
- Stabilitas biaya saat populasi ledger bertambah setelah tanggal pengukuran.

## 7. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only (aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS. Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk pengawas. **Penegakannya tetap manusia.**
