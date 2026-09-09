# Piutang pelanggan Fase 1 — pra-registrasi keempat Gerbang 0D/P4–P5

Tanggal segel: 2026-09-08 (WIB). Instruksi lanjutan:
`/Users/ddsalam/.codex/attachments/125473e7-a835-48f8-9dbc-63b01ba0ce3c/pasted-text.txt`.

Berkas ini dibuat **sebelum** P4/P5 dijalankan dan sebelum hasil Gerbang 0D
diterima. Berkas ini append-only. Tiga pra-registrasi dan empat berkas hasil
sebelumnya tetap utuh; hasil baru tidak boleh dipakai untuk menyunting prediksi
di bawah.

## 1. Fakta Gerbang 0C yang diterima sebelum segel

Tiga belas tangkapan layar Kotabaru diverifikasi satu per satu. Bukti itu
menunjukkan:

- `tr_htagihan` mempunyai 13 kolom dengan `CKDTAGIH` sebagai PK, termasuk
  `DTGL`, `DTGLJT`, `CKDPLG`, `NTOTAL`, `NSTATUS`, `SBATAL`, `NGATOT`, dan
  `SJENISTAG`;
- `tr_dtagihan` hanya mempunyai `CKDTAGIH` dan `CKDJUALPLG`; keduanya berindeks
  `MUL` dan tabel tidak mempunyai PK;
- `tr_byrtagih` mempunyai 11 kolom dengan `CKDBYR` sebagai PK dan `CKDTAGIH`
  berindeks `MUL`;
- Kotabaru berisi 7.512 faktur, 164.937 baris junction, dan 5.549 pembayaran.
  Rentang faktur 2011-10-14…2026-09-07; rentang pembayaran
  2011-10-25…2026-08-26;
- faktur `TG202600405` menyambung ke lima penjualan `UV202608225`,
  `UV202608100`, `UV202607889`, `UV202607849`, dan `UV202607831`;
- pembayaran `BT202600043` bertanggal 2026-08-26 menunjuk
  `TG202600337`, sementara contoh lain menunjuk faktur tahun 2025;
- hasil `SHOW CREATE VIEW` terpotong, tetapi tabel dasar dan sambungan datanya
  sudah cukup untuk probe ini.

Model yang kini terbukti adalah:

```
Penjualan kredit UV/JP
  → bppiut debit (vcref UV/JP)
  → tr_dtagihan (junction faktur ↔ dokumen penjualan)
  → tr_htagihan (TG, DTGLJT, NSTATUS)
  → tr_byrtagih (BT, CKDTAGIH → faktur)
  → bppiut kredit (vcref BT)
```

Vonis balance-forward tetap berlaku untuk ledger `tr_bppiut`; open-item hidup
di modul tagihan yang terpisah. Kesamaan `DTGLJT = DTGL` pada lima contoh belum
membuktikan kolom tempo dipakai. Karena `tr_dtagihan` tidak mempunyai PK, desain
sync masa depan—jika dipilih—harus REPLACE per `CKDTAGIH`, bukan UPSERT-by-PK.

## 2. Keputusan Adisucipto dan batas arc

Adisucipto baru diakuisisi. Nol kode pelanggan bertitik adalah keadaan sah saat
ini, tetapi transisional. Seksi Piutang Online harus presence-gated: unit tetap
ada dan tidak error ketika belum ada baris bertitik, lalu seksi muncul sendiri
ketika baris bertitik pertama hadir. Tidak ada daftar pengecualian, hardcode,
flag unit, atau pengulangan P3. Gold-check kelak harus mengonfirmasi laporan
EasyMax Adisucipto juga tidak mencetak seksi Online.

Arc ini hanya mengukur. Tidak ada domain sync tagihan, migrasi, perubahan agent,
UI, atau FIFO-imputed. Gerbang 1 tetap tertahan sampai hasil tujuh unit Gerbang
0D diterima.

## 3. Gerbang 0D — prediksi dan kondisi berhenti

- **D1:** bila `jt_sama` mendekati 100% pada mayoritas unit, `DTGLJT` dinilai
  tidak dipakai. Peringatan tempo tidak dapat bersumber dari EasyMax; termin
  harus menjadi master SolaMax bersama limit kredit. Itu hasil sah.
- **D3:** `NSTATUS=1` tidak diasumsikan berarti lunas. Bila sebaran status tidak
  sejalan dengan ada/tidaknya pembayaran, status lunas harus dihitung dari
  `SUM(tr_byrtagih.NTOTAL)` terhadap `tr_htagihan.NGATOT`.
- **D4:** prediksi `yatim = 0`. Nilai lebih dari nol menghentikan run karena
  relasi pembayaran→faktur tidak utuh dan rancangan open-item harus ditinjau
  ulang.
- **D5:** `faktur_12bln = 0` berarti modul dorman pada unit itu saja. Tabel yang
  tidak ada dicatat sebagai variasi armada dan tidak menghentikan run.

Probe dijalankan melalui koneksi baru, satu unit sekali, sesudah
`SHOW DATABASES;`, dan harus kompatibel dengan MySQL 5.0.67. Tidak ada query
tambahan di luar blok yang disetujui.

## 4. P4 — anti-join kelengkapan

Prediksi segel pertama tetap: untuk setiap unit 1–7 dan kedua ledger, sesudah
`trim()` kedua sisi, baris hidup yang tidak mempunyai pasangan
`pelanggan_master` = 0 dan nilai netto yatim = Rp0. Nilai netto memakai
`sjnsbp=1` positif dan `sjnsbp=2` negatif dengan `COALESCE(sbatal,0)=0`.

Kontrol positif per ledger/unit harus menunjukkan query dasar mempunyai baris.
Satu baris yatim atau rupiah yatim nonnol menghentikan run sebelum P5.

## 5. P5 — biaya tiga varian

Tanggal akhir tetap 2026-08-31 dan rentang mutasi tetap 2026-08-01 s.d.
2026-08-31 inklusif. Formula bucket dan tanda harus sama dengan
`getSaldoPelanggan`:

- Piutang Lokal: `bppiut`, master `sjenis IN (1,5)`, kode tanpa titik;
- Piutang Online: `bppiut`, kode bertitik, tanpa filter `sjenis`;
- Hutang Lokal: seluruh `bphut`, dinegatifkan;
- seluruh sumber memakai `COALESCE(sbatal,0)=0`, kode di-`trim`, dan kode tidak
  pernah digabung lintas unit.

Tiga bentuk yang diukur dengan `EXPLAIN (ANALYZE, BUFFERS)`:

1. saldo per pelanggan unit 4, mempertahankan kunci master agar pelanggan nol
   tetap ada;
2. saldo per pelanggan ketujuh unit, per `(unit_id, kode)`, juga mempertahankan
   kunci master;
3. mutasi ketujuh unit per `(unit_id, kode, tanggal)` selama rentang terkunci.

Tidak ada prediksi runtime. Ambang keputusan telah dikunci: execution time
varian 2 `> 5.000 ms` melarang scan langsung sebagai jalur render dan
mengharuskan rancangan snapshot/materialisasi dilaporkan sebelum pembangunan.
Nilai `<= 5.000 ms` memilih pola `saldo-cache.ts`: historis 24 jam, hari
berjalan/H−1 120 detik, dan hasil nol-semua selalu melewati cache melalui
`shouldBypassEmptySaldo`.

## 6. Disiplin akses

- Sasaran P4/P5: Cloud SQL pilot LIVE `solamax:asia-southeast2:solamax-pg`, role
  `dashboard_ro`, GUC polos `SET app.unit_ids = '1,2,3,4,5,6,7'`.
- Hanya `SELECT`, `SET`, dan `EXPLAIN (ANALYZE, BUFFERS)` atas `SELECT`.
- Secret read-only hanya diteruskan melalui variabel proses dan tidak dicetak.
- Tidak ada tulis DB/POS, perubahan produk, push, PR, atau deploy.
