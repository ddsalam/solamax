# Piutang Fase 2 — Diagnosis yatim read-only

## Praregistrasi sebelum kueri

Tanggal 13 September 2026. Seluruh kueri diagnosis dibatasi pada unit 1, cut immutable `c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff`, ledger aktif (`COALESCE(sbatal,0)=0`) sampai 13-09-2026. Fakta terkunci dalam instruksi lanjutan tidak dihitung ulang. Kontrol positif identitas/unit/cut harus lolos sebelum hasil nol ditafsirkan. Setiap transaksi memakai `REPEATABLE READ READ ONLY`, `SET LOCAL app.unit_ids='1'`, dan diakhiri `ROLLBACK`.

Hipotesis, dikunci sebelum kueri pertama:

1. **Y1 / gerbang §6.1:** nol kode yatim piutang unik hadir dalam 328 kode EasyMax yang disediakan. Kueri pertama hanya mengambil kode yatim untuk persilangan lokal; satu kecocokan saja menghentikan seluruh kueri lanjutan dan dilaporkan ke koordinator.
2. **Y2:** `SUM` kredit `NULL` disebabkan nol baris `sjnsbp=2`, bukan semua nominal kredit `NULL`. Hitung baris kredit dan seluruh `njumlah IS NULL` secara eksplisit.
3. **Y3:** kelas yatim didominasi prefix `01` (taksonomi SALDO AWAL), berjenis master di luar `{1,5}` atau tanpa master. Pecahan prefix dan nasib master harus menyebut count baris, pelanggan unik, debet/kredit dan nilai `sjenis`, termasuk NULL.
4. **Y4:** penamaan 20 baris yatim terbesar pada mirror mendukung kelas SALDO AWAL. `vcref`/`vcket` mirror hanya bukti penamaan karena mirror lebih baru dari cut; bukan bukti angka cut atau keadaan historis yang sama.
5. **Y5:** sisi hutang mungkin memiliki baris tanpa master/setara jenis lain, tetapi formula Hutang Lokal mencakup seluruh ledger hutang aktif. Karena itu kelas tersebut, jika ada, tidak otomatis berarti nilai dijatuhkan. Periksa ringkas prefix, status master, kredit/NULL, dan jumlah pelanggan.
6. **H3-lengkap:** seluruh ledger aktif dalam cut mempunyai `sjnsbp IN (1,2)`; hitung `IS NULL` terpisah dan kode pelanggan NULL agar celah di luar tiga bucket terlihat.
7. **B-kapasitas:** biaya snapshot per tanggal jauh lebih kecil daripada source cut full history. Ukur `pg_total_relation_size` untuk tabel snapshot/source/work, `pg_database_size`, serta count baris ukuran per generasi/cut untuk dasar anggaran kanari 7 hari dan backfill 31 hari. Ukuran relasi adalah alokasi aktual tabel+indeks+TOAST saat diamati; proyeksi tambahan berdasarkan ukuran rata-rata tetap estimasi, bukan ukuran yang sudah terjadi.

Batas kesimpulan wajib: identiknya himpunan nonnol tidak membuktikan kedua sistem benar; ia membuktikan keduanya konsisten. Kalau keduanya salah bersama, uji ini tidak melihatnya. Diagnosis tidak mengubah formula atau data produksi. Tidak ada perubahan grant/peran, secret, scheduler, migrasi, atau main.

## Hasil

Praregistrasi selesai 07:04:43 UTC, sebelum kontrol pertama 07:05:04 UTC. Bukti di `session-notes/evidence/2026-09-13-piutang-fase2-diagnosis-yatim/`. Seluruh pemeriksaan memakai role `dashboard_app`, unit 1 / 6478111 / Imam Bonjol; tidak ada grant yang diubah.

### Gerbang kode dan penjelasan NULL

**Y1 lulus:** 747 kode piutang yatim unik, **nol** di antara 328 kode EasyMax. `00-code-gate.sql/.txt`, `orphan-codes.csv`, dan `01-local-code-gate.txt` menyimpan pemilihan serta persilangannya. Setelah hasil nol dipastikan, diagnosis berikutnya baru dijalankan.

**Y2 lulus:** 14.479 baris yatim semuanya `sjnsbp=1`; jumlah baris `sjnsbp=2` **0**, jumlah `njumlah IS NULL` **0**. Jadi SUM kredit NULL memang berasal dari himpunan kredit kosong. Debet Rp6.411.357.535 seluruhnya mempunyai nominal. Tanggal cut untuk kelas ini berkisar 01-09-2022 sampai 10-06-2026.

Seluruhnya memiliki master **`sjenis=4`**: 14.479 baris, 747 pelanggan, Rp6.411.357.535 debet. Yang tidak punya master **0**; master `sjenis NULL` **0**; jenis lain selain 4 dalam populasi yatim **0**. Istilah “yatim” pada audit sebelumnya berarti “di luar master lokal `{1,5}`”, bukan kehilangan baris master.

### Prefix dan batas taksonomi

**Prediksi prefix Y3 tidak terbukti:** `left(btrim(ckdbppiut),2)` seluruhnya **`PP`**, 14.479 baris. Masing-masing `01`, `JP`, `UV`, `TP`, dan `TV` mempunyai **0** baris pada kolom primary key itu. Catatan Fase 1 `2026-09-07-piutang-fase1-gerbang-0a-hasil-parsial.md:28–55` jelas menamai taksonominya **VCREF**; jadi prefix primary key tidak dapat menguji langsung taksonomi VCREF yang dibuang source cut. Label mirror 20 baris terbesar diteliti terpisah di bawah, dengan batas penamaan saja.

**Y4 ditolak pada sampel:** 20 baris yatim terbesar menurut nominal cut seluruhnya cocok ke primary key mirror, seluruh `vcref` berprefix **JP**, dan seluruh `vcket` berbunyi **“Penjualan Pelanggan Tunai”** diikuti tanggal/shift. Tidak satu pun contoh itu berlabel SALDO AWAL. Sampel diurutkan deterministik menurut `njumlah DESC NULLS LAST, entry_key`, bukan dipilih untuk mendukung hipotesis. Rincian 20 baris beserta key, kode pelanggan, tanggal/nominal cut dan kedua label mirror tersimpan utuh pada seksi `Y4_TOP20` dalam `02-diagnosis-and-capacity.txt`.

Mirror lebih baru dari cut; label ini bukti **penamaan**, bukan bukti nominal atau keadaan historis cut. Semua 14.479 baris mempunyai master `sjenis=4`, tetapi 20 contoh terbesar saja tidak membuktikan seluruh 14.479 baris merupakan penjualan tunai. Kesimpulan yang cukup untuk tugas ini: kelas yang dikeluarkan adalah master berjenis lain di luar definisi Piutang Lokal, sampel besarnya berlabel penjualan tunai, nol kode kelas itu hadir di laporan EasyMax. **Formula tetap.** Prediksi SALDO AWAL yang meleset bukan salah satu empat gerbang berhenti; hanya irisan kode/oracle yang ditetapkan §6.1.

### Hutang

Kelas setara “kode tanpa titik di luar master `{1,5}`” berisi **44.683 baris, 188 pelanggan**, semuanya prefix primary key **PH**. Ada **39.217** baris debet dan **5.466** kredit, tanpa nominal NULL. Ini bukan kelas yang dijatuhkan formula: seluruh ledger hutang aktif masuk Hutang Lokal.

| Master | Baris | Pelanggan | Debet | Kredit |
|---|---:|---:|---:|---:|
| `sjenis=2` | 1.211 | 22 | 388.254.046 | 24.555.849 |
| `sjenis=3` | 43.472 | 166 | 53.160.808.632,50 | 54.197.517.367,50 |

### H3 seluruh ledger aktif

**Lulus:** dari 61.154 baris bppiut dan 44.683 baris bphut aktif sampai tanggal target pada cut tersebut, masing-masing mempunyai **0** `sjnsbp IS NULL`, **0** `sjnsbp NOT IN (1,2)`, **0** nominal NULL, **0** kode pelanggan NULL, dan **0** kode kosong. Pemeriksaan ini melengkapi audit di luar tiga bucket, bukan alasan menghilangkan penjaga jenis tidak dikenal dari builder v2 untuk data masa depan.

### Kapasitas B: ukuran aktual

Pengamatan prioritas 07:06:40 UTC, bukti `03-capacity-priority.sql/.txt` dan `04-capacity-detail.sql/.txt`:

| Ukuran | Byte |
|---|---:|
| Database aktual | 7.595.179.031 |
| Ruang hingga ambang review 9.000.000.000 | 1.404.820.969 |
| Snapshot row heap (`pg_relation_size`) | 507.904 |
| Snapshot row table, termasuk TOAST/FSM/VM (`pg_table_size`) | 548.864 |
| Snapshot row indeks | 385.024 |
| Snapshot row total | 933.888 |
| Source bppiut total | 3.897.712.640 |
| Source bphut total | 1.655.013.376 |
| Source pelanggan total | 13.426.688 |
| Semua relasi `saldo_pelanggan_source_%` total | 5.566.316.544 |

Dalam lingkup RLS unit 1 terlihat 5.946 snapshot rows pada 2 generasi. Payload baris aktual (`SUM(pg_column_size(row))`) adalah 221.570 byte pada 31-08 dan 221.582 byte pada 13-09. Source cycles terlihat: **1 complete, 41 failed, 18 staging**. Alokasi relasi mencakup seluruh relasi fisik, termasuk ruang kosong/tuple mati dan unit lain bila ada; ini bukan ukuran payload cut tunggal. Jumlah staging bukan izin menghapusnya: diagnosis tidak menilai umur atau lease masing-masing.

Proyeksi **kasar v1**, berdasarkan 933.888 / 2 = **466.944 byte per generasi** alokasi rata-rata: 7 generasi tambahan sekitar **3.268.608 byte**, 31 generasi sekitar **14.475.264 byte**. Ini bukan ukuran aktual v2: 12 kolom numeric baru, generasi rebuild/baseline tambahan, fragmentasi, dan perubahan data memerlukan cadangan terpisah. Backfill harus memakai ulang cut; mengalikan alokasi source 5,566 GB dengan jumlah tanggal bukan model biaya yang benar. Ruang cleanup tidak boleh dihitung bebas sebelum benar-benar dibersihkan; pembersih harus tetap dapat berjalan ketika gate 9 GB menutup build. Hitungan lokal tersimpan di `05-capacity-projection.txt`.

### Koreksi peran baseline 31-08

Kueri langsung lintas Agustus–September membuktikan manifest 31-08 generasi `31f2f0cf-d5c3-4920-9496-1db61215d03c` **complete dan mempunyai pointer** pada waktu audit ini. Manifest 13-09 secara eksplisit menunjuk generasi itu melalui `base_month_end=2026-08-31` dan `base_generation_id`. SQL Gerbang A hanya meminta pointer tanggal 01–13 September; hasil itu **tidak pernah membuktikan tidak adanya pointer 31-08**.

Kode builder menghitung `previousMonthEnd`, memvalidasi baseline lengkap dengan pointer serta formula/cut yang sama, lalu memakai baseline untuk materialisasi delta target. Baseline 31-08 merupakan penutup bulan bagi tanggal September; ketika backfill melintasi Agustus, baseline yang dibutuhkan adalah 31-07. `complete` saja tidak boleh diperlakukan setara baseline valid lintas formula/cut, dan tanggal baseline dapat juga menjadi tanggal target ketika pengguna/backfill memintanya.

## Pelaksanaan dan batas akhir

Empat berkas SQL selesai `exit=0`, semuanya berakhir `ROLLBACK`; koneksi proxy `127.0.0.1:55439` menuju `solamax:asia-southeast2:solamax-pg` dihentikan 07:08:42 UTC (14:08:42 Asia/Pontianak). Kueri diagnosis gabungan membutuhkan sekitar 165 detik total, dengan batas 120 detik **per statement**; tidak ada timeout/galat. Kueri kapasitas dipisahkan agar bukti untuk B tersedia saat diagnosis masih berjalan; pengulangan kapasitas di akhir audit utama disimpan apa adanya sebagai pengamatan waktu berbeda.

`run-readonly.py` hanya membaca URL proxy lokal yang sudah ada ke environment subprocess; tidak mencetak kredensial, tidak menulis secret baru, dan memberlakukan default transaksi read-only. SQL retained menggunakan path ekspor relatif terhadap root repo. `01-local-code-gate.py` mereproduksi persilangan; `SHA256SUMS` mengunci berkas bukti. Bukti angka dipertahankan persis sebagaimana PostgreSQL menghasilkan; SUM kosong tidak diubah menjadi nominal rekayasa.

H1 tetap menunggu laporan EasyMax 12-09 yang belum tersedia di tugas ini. Fakta terkunci (rekonsiliasi tujuh pelanggan, enam saldo manifest, himpunan nonnol identik, AWAL=AKHIR) dipakai dari instruksi pengguna, bukan dihitung ulang. Kontrol count master hanya untuk membuktikan unit/cut terlihat melalui RLS. Pekerjaan ini tidak menyentuh kode aplikasi, migrasi, scheduler, grant/peran, atau main; integrasi dan commit diserahkan ke koordinator.
