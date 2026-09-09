# Piutang pelanggan Fase 1 — hasil Gerbang 0C, persiapan 0D, P4, dan P5

Tanggal: 2026-09-08 (WIB). Branch: `codex/piutang-fase1-probe`.

Pra-registrasi untuk run ini disegel dalam commit `4db58c4` sebelum P4/P5
dijalankan. Tiga pra-registrasi dan empat hasil sebelumnya tidak disunting.

## 1. Gerbang 0C — rantai open-item terbukti

Tiga belas screenshot SQL Manager Kotabaru diperiksa satu per satu. Bentuk
sumber yang terlihat adalah:

| Tabel | Grain/kunci yang tampak | Kolom penting |
|---|---|---|
| `tr_htagihan` | 13 kolom; `CKDTAGIH` PK | `DTGL`, `DTGLJT`, `CKDPLG`, `NTOTAL`, `NSTATUS`, `SBATAL`, `NGATOT`, `SJENISTAG` |
| `tr_dtagihan` | 2 kolom; `CKDTAGIH` dan `CKDJUALPLG` sama-sama `MUL`; tanpa PK | junction faktur↔dokumen penjualan |
| `tr_byrtagih` | 11 kolom; `CKDBYR` PK, `CKDTAGIH` `MUL` | tanggal, faktur, bukti, nilai, batal, approval/requester |

Model data yang terbukti dari nilai aktual, bukan dari nama tabel:

```
Penjualan kredit UV/JP
  → bppiut DEBIT (vcref = UV/JP)
  → tr_dtagihan (TG ↔ UV/JP)
  → tr_htagihan (TG, DTGLJT, NSTATUS)
  → tr_byrtagih (BT, CKDTAGIH → TG)
  → bppiut KREDIT (vcref = BT)
```

Bukti sambungan paling jelas adalah `TG202600405` → `UV202608225`,
`UV202608100`, `UV202607889`, `UV202607849`, dan `UV202607831`.
`BT202600043` bertanggal 2026-08-26 menunjuk `TG202600337`; empat contoh lain
termasuk pembayaran pada 2026 untuk faktur 2025. Jadi aging sejati memang ada
di sumber tagihan.

Modul hidup di Kotabaru:

| Fakta | Nilai |
|---|---:|
| faktur | 7.512 |
| junction | 164.937 |
| pembayaran | 5.549 |
| rentang faktur | 2011-10-14…2026-09-07 |
| rentang pembayaran | 2011-10-25…2026-08-26 |

Vonis lama **tetap sah**: `tr_bppiut` adalah balance-forward lengkap. Faktur
dan penautan pembayaran hidup di modul terpisah; vonis ledger tidak ditarik
kembali.

Tiga catatan yang ikut dikunci:

1. `DTGLJT = DTGL` pada kelima contoh. Kolom jatuh tempo ada, tetapi belum
   terbukti dipakai; fitur tempo ditahan sampai Gerbang 0D mengukur keterisian.
2. `tr_dtagihan` tidak mempunyai PK. Jika kelak dipilih untuk sync, strategi
   yang layak adalah REPLACE seluruh anak per `CKDTAGIH`, bukan UPSERT-by-PK.
3. `SHOW CREATE VIEW vw_tagihbyr`/`vw_tagihan` terpotong di layar. Ini tidak
   memblokir karena struktur dan sambungan tabel dasarnya sudah terlihat.

## 2. Adisucipto — sah hari ini, transisional

Adisucipto baru diakuisisi. Nol kode pelanggan bertitik adalah keadaan sah
hari ini, bukan karakter permanen unit. Konsekuensi desainnya:

- unit tanpa kode bertitik tetap tampil dan tidak error;
- seksi Piutang Online digerbangkan pada keberadaan data, bukan config;
- baris bertitik pertama membuat seksi muncul sendiri;
- tidak ada hardcode, daftar pengecualian, atau flag khusus Adisucipto;
- P3 tidak diulang;
- pada gold-check mendatang, laporan EasyMax Adisucipto harus dikonfirmasi juga
  tidak mencetak seksi Online.

## 3. P4 — anti-join kelengkapan mirror

Query read-only dijalankan dengan role `dashboard_ro` dan GUC
`app.unit_ids = '1,2,3,4,5,6,7'`. Join memakai `trim()` pada kedua sisi,
`COALESCE(sbatal,0)=0`, serta tanda tersegel `sjnsbp 1=+` dan `2=−`.

| Ledger | Unit | Kontrol baris hidup | Baris yatim | Netto yatim |
|---|---:|---:|---:|---:|
| `bphut` | 1 | 44.543 | 0 | Rp0 |
| `bphut` | 2 | 8.285 | 0 | Rp0 |
| `bphut` | 3 | 134 | 0 | Rp0 |
| `bphut` | 4 | 37.955 | 0 | Rp0 |
| `bphut` | 5 | 2.084 | 0 | Rp0 |
| `bphut` | 6 | 177 | 0 | Rp0 |
| `bphut` | 7 | 22.687 | 0 | Rp0 |
| `bppiut` | 1 | 60.587 | 0 | Rp0 |
| `bppiut` | 2 | 80.220 | 0 | Rp0 |
| `bppiut` | 3 | 587 | 0 | Rp0 |
| `bppiut` | 4 | 345.216 | 0 | Rp0 |
| `bppiut` | 5 | 102.385 | 0 | Rp0 |
| `bppiut` | 6 | 5.995 | 0 | Rp0 |
| `bppiut` | 7 | 169.115 | 0 | Rp0 |

**Vonis P4: lulus.** Semua 14 kontrol positif menyala; prediksi nol baris dan
Rp0 yatim cocok pada kedua ledger di seluruh unit. Kondisi berhenti tidak
terpenuhi.

## 4. P5 — biaya bentuk per-pelanggan

Ketiga query memakai tanggal/rentang tersegel, formula tiga ember
`getSaldoPelanggan`, `trim(ckdplg)`, dan `EXPLAIN (ANALYZE, BUFFERS)`. Varian
saldo menyatukan kunci master, piutang, dan hutang sehingga pelanggan bersaldo
nol tetap dipertahankan.

| Varian | Baris hasil | Execution time | Buffer tingkat atas | Vonis |
|---|---:|---:|---|---|
| 1. Per pelanggan, unit 4, s.d. 2026-08-31 | 1.205 | 2.189,725 ms | shared hit 835, read 37.426, written 11.260; temp read 1.590, written 1.595 | terukur |
| 2. Per pelanggan, tujuh unit, s.d. 2026-08-31 | 6.393 | **4.837,500 ms** | shared hit 15.476, read 50.379; temp read 3.526, written 3.539 | **≤5.000 ms** |
| 3. Mutasi per pelanggan/tanggal, tujuh unit, 2026-08-01…31 | 3.263 | 75,957 ms | shared hit 742, read 573 | terukur |

Varian 2 berada 162,500 ms di bawah ambang yang telah disegel. Sesuai aturan
keputusan, scan langsung belum memicu kewajiban snapshot/materialisasi; jalur
yang dipilih untuk pembangunan kelak adalah pola `saldo-cache.ts`: tanggal
historis 24 jam, hari berjalan/H−1 120 detik, dan nol-semua selalu diambil ulang
secara segar melalui `shouldBypassEmptySaldo`. Margin terhadap ambang tipis,
tetapi aturan tidak diubah setelah hasil terlihat. Belum ada kode yang dibangun.

## 5. Gerbang 0D — blok siap-tempel untuk tujuh unit

Gunakan koneksi baru pada setiap mesin agar tidak membaca snapshot InnoDB lama.
Jalankan `SHOW DATABASES;` lebih dulu dan pilih DB situs yang benar (Korek memakai
`easymax_korek`). Sesudah itu tempel blok berikut apa adanya.

```sql
-- D1 · Apakah DTGLJT benar-benar dipakai? (satu baris)
SELECT COUNT(*) AS n_faktur,
       MIN(DTGL) AS tgl_awal, MAX(DTGL) AS tgl_akhir,
       SUM(CASE WHEN DTGLJT =  DTGL THEN 1 ELSE 0 END) AS jt_sama,
       SUM(CASE WHEN DTGLJT >  DTGL THEN 1 ELSE 0 END) AS jt_lebih_lambat,
       SUM(CASE WHEN DTGLJT <  DTGL THEN 1 ELSE 0 END) AS jt_lebih_awal,
       MIN(DATEDIFF(DTGLJT, DTGL)) AS tempo_min,
       MAX(DATEDIFF(DTGLJT, DTGL)) AS tempo_maks
FROM tr_htagihan WHERE COALESCE(SBATAL,0) = 0;

-- D2 · Arti NSTATUS & SJENISTAG (beberapa baris)
SELECT NSTATUS,   COUNT(*) AS n FROM tr_htagihan GROUP BY NSTATUS;
SELECT SJENISTAG, COUNT(*) AS n FROM tr_htagihan GROUP BY SJENISTAG;

-- D3 · Apakah NSTATUS menandai LUNAS? Uji lawan pembayaran, jangan dari nama.
SELECT h.NSTATUS, COUNT(*) AS n,
       SUM(CASE WHEN b.CKDTAGIH IS NULL THEN 1 ELSE 0 END) AS tanpa_pembayaran
FROM tr_htagihan h
LEFT JOIN (SELECT DISTINCT CKDTAGIH FROM tr_byrtagih
            WHERE COALESCE(SBATAL,0) = 0) b ON b.CKDTAGIH = h.CKDTAGIH
WHERE COALESCE(h.SBATAL,0) = 0
GROUP BY h.NSTATUS;

-- D4 · Integritas FK pembayaran → faktur (satu baris)
SELECT COUNT(*) AS n_bayar,
       SUM(CASE WHEN h.CKDTAGIH IS NULL THEN 1 ELSE 0 END) AS yatim
FROM tr_byrtagih b
LEFT JOIN tr_htagihan h ON h.CKDTAGIH = b.CKDTAGIH
WHERE COALESCE(b.SBATAL,0) = 0;

-- D5 · Masih dipakai 12 bulan terakhir? (dua angka)
SELECT COUNT(*) AS faktur_12bln   FROM tr_htagihan WHERE DTGL >= '2025-09-01';
SELECT COUNT(*) AS bayar_12bln    FROM tr_byrtagih WHERE DTGL >= '2025-09-01';
```

Aturan baca hasil sudah disegel di pra-registrasi keempat. Khusus D4, setiap
`yatim > 0` adalah kondisi **BERHENTI dan lapor**. Tabel yang tidak ditemukan
justru dicatat sebagai variasi armada dan bukan kondisi berhenti.

## 6. Yang masih belum diketahui

- Hasil D1–D5 dari masing-masing tujuh unit; bukti Kotabaru belum boleh
  digeneralisasi ke armada.
- Apakah `DTGLJT` benar-benar berbeda dari `DTGL` pada mayoritas unit dan dapat
  menjadi sumber tempo.
- Arti empiris setiap nilai `NSTATUS` dan `SJENISTAG`.
- Apakah seluruh pembayaran hidup di setiap unit mempunyai faktur induk.
- Unit mana yang aktif, dorman, atau sama sekali tidak mempunyai tabel modul
  tagihan dalam 12 bulan terakhir.
- Apakah pembayaran parsial/jamak harus dinilai dengan total pembayaran versus
  `NGATOT`; D3 hanya mengukur keberadaan setidaknya satu pembayaran.
- Apakah tiga tabel tagihan akan masuk domain sync SolaMax. Keputusan itu baru
  boleh diambil setelah Gerbang 0D lengkap.
- Definisi penuh kedua view tetap tidak diketahui, tetapi tidak diperlukan untuk
  probe tabel dasar ini.

## 7. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only (aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS. Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk pengawas. **Penegakannya tetap manusia.**
