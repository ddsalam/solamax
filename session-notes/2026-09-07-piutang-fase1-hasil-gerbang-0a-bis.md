# Piutang pelanggan Fase 1 — hasil Gerbang 0A-bis

Tanggal eksekusi: 2026-09-07 (WIB). Segel:
[`2026-09-07-piutang-fase1-preregistrasi-2.md`](2026-09-07-piutang-fase1-preregistrasi-2.md).
Segel dan hasil pertama tetap utuh sebagai riwayat.

Status: **Gerbang 0A-bis selesai; BERHENTI di Gerbang 0B menunggu Dion.** P3,
P4, P5, rancangan, detektor belum-diinput, gold-check, migrasi, dan UI belum
dijalankan.

Seluruh probe memakai Cloud SQL pilot LIVE `solamax-pg`, role
`dashboard_ro`, GUC polos `1,2,3,4,5,6,7`, dan hanya statement read-only.

## 1. Koreksi lingkup vonis P2

Vonis lama harus dibaca ulang sebagai:

> **Balance-forward sejauh delapan kolom yang dicerminkan.** Mirror tidak
> memperlihatkan penautan pembayaran ke faktur di `CKDBPPIUT/CKDBPHUT`, `DTGL`,
> `CKDPLG`, `VCREF`, `VCKET`, `NJUMLAH`, `SJNSBP`, atau `SBATAL`. Ini **bukan**
> bukti bahwa EasyMax tidak memiliki kolom atau tabel alokasi lain.

Batas ini struktural. Agent memilih delapan kolom secara eksplisit di
`apps/agent/src/domains.ts:470-472` dan `apps/agent/src/domains.ts:501-503`;
backend menerima daftar yang sama di
`apps/backend/src/ingest/table-config.ts:259,267`. Agent tidak memakai
`SELECT *`, sehingga kolom EasyMax yang tidak disebut tidak mungkin hadir di
mirror.

## 2. P2a — kardinalitas `vcref`

`rows` adalah seluruh baris hidup dalam `(ledger, unit, prefix2)`;
`distinct` menghitung `trim(vcref)`; `modus/frekuensi` adalah nilai paling sering.

| Ledger | Unit | Prefiks | rows | distinct | distinct % | Modus | Frek. | Modus % | Kelas |
|---|---:|---|---:|---:|---:|---|---:|---:|---|
| bphut | 1 | 01 | 176 | 1 | 0,5682 | `01-SA` | 176 | 100,0000 | shared-label-like |
| bphut | 1 | DP | 5.289 | 5.289 | 100,0000 | `DP202200988` | 1 | 0,0189 | row-key-like |
| bphut | 1 | JP | 37.877 | 37.877 | 100,0000 | `JP2022000051682` | 1 | 0,0026 | row-key-like |
| bphut | 1 | UV | 1.194 | 1.194 | 100,0000 | `UV202202729` | 1 | 0,0838 | row-key-like |
| bphut | 2 | DP | 151 | 148 | 98,0132 | `DP201600001` | 4 | 2,6490 | row-key-like |
| bphut | 2 | JP | 3.394 | 3.394 | 100,0000 | `JP2017000000001` | 1 | 0,0295 | row-key-like |
| bphut | 2 | TP | 168 | 168 | 100,0000 | `TP201700001` | 1 | 0,5952 | row-key-like |
| bphut | 2 | UV | 4.572 | 4.572 | 100,0000 | `UV201700001` | 1 | 0,0219 | row-key-like |
| bphut | 3 | TP | 12 | 12 | 100,0000 | `TP202600001` | 1 | 8,3333 | row-key-like |
| bphut | 3 | UV | 120 | 120 | 100,0000 | `UV202600085` | 1 | 0,8333 | row-key-like |
| bphut | 4 | 01 | 5 | 1 | 20,0000 | `01-SA` | 5 | 100,0000 | tidak cukup data |
| bphut | 4 | DP | 1.850 | 1.842 | 99,5676 | `DP201300052` | 2 | 0,1081 | row-key-like |
| bphut | 4 | JP | 16.686 | 16.684 | 99,9880 | `JP2017000000897` | 2 | 0,0120 | row-key-like |
| bphut | 4 | TP | 855 | 854 | 99,8830 | `TP201300219` | 2 | 0,2339 | row-key-like |
| bphut | 4 | UV | 18.556 | 18.556 | 100,0000 | `UV201100144` | 1 | 0,0054 | row-key-like |
| bphut | 5 | DP | 274 | 274 | 100,0000 | `DP201900002` | 1 | 0,3650 | row-key-like |
| bphut | 5 | JP | 1.805 | 1.805 | 100,0000 | `JP2025000000166` | 1 | 0,0554 | row-key-like |
| bphut | 6 | DP | 48 | 48 | 100,0000 | `DP202600001` | 1 | 2,0833 | row-key-like |
| bphut | 6 | JP | 127 | 127 | 100,0000 | `JP2026000000308` | 1 | 0,7874 | row-key-like |
| bphut | 7 | DP | 3.871 | 3.871 | 100,0000 | `DP201800001` | 1 | 0,0258 | row-key-like |
| bphut | 7 | JP | 18.811 | 18.811 | 100,0000 | `JP2018000000001` | 1 | 0,0053 | row-key-like |
| bphut | 7 | UV | 3 | 3 | 100,0000 | `UV202200340` | 1 | 33,3333 | row-key-like |
| bppiut | 1 | BT | 1.887 | 1.887 | 100,0000 | `BT202200001` | 1 | 0,0530 | row-key-like |
| bppiut | 1 | JP | 40.633 | 40.633 | 100,0000 | `JP2022000051672` | 1 | 0,0025 | row-key-like |
| bppiut | 1 | UV | 18.025 | 18.025 | 100,0000 | `UV202202717` | 1 | 0,0055 | row-key-like |
| bppiut | 2 | BT | 744 | 743 | 99,8656 | `BT202400015` | 2 | 0,2688 | row-key-like |
| bppiut | 2 | JP | 71.785 | 71.785 | 100,0000 | `JP2016000000001` | 1 | 0,0014 | row-key-like |
| bppiut | 2 | TP | 2 | 2 | 100,0000 | `TP201600001` | 1 | 50,0000 | row-key-like |
| bppiut | 2 | UV | 7.687 | 7.687 | 100,0000 | `UV201500001` | 1 | 0,0130 | row-key-like |
| bppiut | 3 | BT | 92 | 92 | 100,0000 | `BT202600001` | 1 | 1,0870 | row-key-like |
| bppiut | 3 | UV | 493 | 493 | 100,0000 | `UV202600001` | 1 | 0,2028 | row-key-like |
| bppiut | 4 | 01 | 39 | 1 | 2,5641 | `01-SA` | 39 | 100,0000 | tidak cukup data |
| bppiut | 4 | BT | 5.492 | 5.489 | 99,9454 | `BT201700070` | 2 | 0,0364 | row-key-like |
| bppiut | 4 | JP | 195.203 | 195.198 | 99,9974 | `JP2017000000895` | 2 | 0,0010 | row-key-like |
| bppiut | 4 | TP | 809 | 809 | 100,0000 | `TP201100001` | 1 | 0,1236 | row-key-like |
| bppiut | 4 | TV | 527 | 527 | 100,0000 | `TV201100001` | 1 | 0,1898 | row-key-like |
| bppiut | 4 | UV | 143.127 | 143.127 | 100,0000 | `UV201100001` | 1 | 0,0007 | row-key-like |
| bppiut | 5 | BT | 549 | 548 | 99,8179 | `BT202300021` | 2 | 0,3643 | row-key-like |
| bppiut | 5 | JP | 100.282 | 100.282 | 100,0000 | `JP2019000000004` | 1 | 0,0010 | row-key-like |
| bppiut | 5 | TV | 1 | 1 | 100,0000 | `TV202100002` | 1 | 100,0000 | row-key-like |
| bppiut | 5 | UV | 1.552 | 1.552 | 100,0000 | `UV202000001` | 1 | 0,0644 | row-key-like |
| bppiut | 6 | BT | 97 | 97 | 100,0000 | `BT202500001` | 1 | 1,0309 | row-key-like |
| bppiut | 6 | JP | 4.036 | 4.036 | 100,0000 | `JP2021000000001` | 1 | 0,0248 | row-key-like |
| bppiut | 6 | UV | 1.861 | 1.861 | 100,0000 | `UV202100001` | 1 | 0,0537 | row-key-like |
| bppiut | 7 | BT | 2.312 | 2.312 | 100,0000 | `BT201800001` | 1 | 0,0433 | row-key-like |
| bppiut | 7 | JP | 163.467 | 163.395 | 99,9560 | `JP2022000043061` | 2 | 0,0012 | row-key-like |
| bppiut | 7 | UV | 3.329 | 3.329 | 100,0000 | `UV201800001` | 1 | 0,0300 | row-key-like |

### Putusan P2a

- `JP`, `UV`, `BT`, dan `DP` terbukti berbentuk nomor dokumen: hampir seluruh
  kelompok berada pada 98–100% distinct dan 100% mengikuti pola prefiks+angka.
- `01` terbukti label bersama `01-SA`: satu nilai dipakai pada 220 baris yang
  teramati, dengan modus 100% di setiap kelompoknya.
- `TP` secara **kode** ternyata juga hampir selalu unik, tetapi P1 membuktikan
  `vcket`-nya transaksi bebas dan prefiksnya muncul di kedua arah. Sesuai
  keputusan pra-probe, `TP` tetap dikeluarkan dari P2c karena semantik, bukan
  karena kardinalitas.
- `TV` bukan prefiks pembayaran; ia tidak masuk uji penautan.

## 3. P2b — dua belas kecocokan B apa adanya

Semua baris berikut berada di `bphut` unit 1, tanggal 2022-08-31. `vcref` kedua
sisi adalah `01-SA`, prefiks `01`, `vcket` kedua sisi `SALDO AWAL`, dan cocok
melalui `vcref`—bukan primary key.

| PK pembayaran | Pelanggan asli | Pelanggan acak/debit | Nilai pembayaran | PK debit | Nilai debit |
|---|---|---|---:|---|---:|
| `PH2022083100015` | `PLG1190` | `PLG0028` | 4.067.185 | `PH2022083100004` | 400.000 |
| `PH2022083100031` | `PLG1351` | `PLG2064` | 576.916 | `PH2022083100063` | 327.184 |
| `PH2022083100045` | `PLG1783` | `PLG2280` | 351.578 | `PH2022083100137` | 2.392.044 |
| `PH2022083100048` | `PLG1911` | `PLG2237` | 331.664 | `PH2022083100105` | 530.000 |
| `PH2022083100056` | `PLG1971` | `PLG2251` | 2.271.966 | `PH2022083100111` | 2.820.479 |
| `PH2022083100090` | `PLG2109` | `PLG2288` | 9.154.999 | `PH2022083100145` | 226.412 |
| `PH2022083100096` | `PLG2165` | `PLG2641` | 1.378.100 | `PH2022083100149` | 3.063.990 |
| `PH2022083100119` | `PLG2260` | `PLG2776` | 59.874.922 | `PH2022083100159` | 1.591.959 |
| `PH2022083100135` | `PLG2277` | `PLG2262` | 3.747.253 | `PH2022083100121` | 1.137.779 |
| `PH2022083100165` | `PLG2786` | `PLG2079` | 1.659.947 | `PH2022083100078` | 40.334 |
| `PH2022083100173` | `PLG2828` | `PLG2101` | 2.945.050 | `PH2022083100089` | 297.548 |
| `PH2022083100176` | `PLG2917` | `PLG2249` | 18.673.289 | `PH2022083100110` | 4.100.949,5 |

### Putusan P2b

Hipotesis **diterima 12/12**. Pelanggan asli dan acak berbeda pada seluruh
baris. A = 0 karena tiap pelanggan saldo-awal hanya mempunyai satu arah;
B menyala saat pengacakan mempertemukan kredit `01-SA` pelanggan X dengan debit
`01-SA` pelanggan Y. Jadi A < B lama bukan bug data atau penautan faktur; ia
konsekuensi menguji kesamaan pada label bersama.

## 4. P2c — uji ulang prefiks dokumen

Keputusan pengecualian eksplisit: `01` dikeluarkan karena label bersama; `TP`
dikeluarkan karena transaksi bebas/tumpang tindih; `TV` bukan pembayaran.
Debit yang diuji hanya `JP`/`UV`; pembayaran hanya `BT` (`bppiut`) atau `DP`
(`bphut`). Kecocokan tetap menerima `debit.vcref` atau primary key debit.

### Kontrol positif sisi A

| Kontrol | Denominator | A | B | Putusan |
|---|---:|---:|---:|---|
| Pasangan sintetis, pembayaran menunjuk primary key debit pada unit/pelanggan sama | 1 | 1 | 0 | predikat A hidup |

Data sintetis hanya hidup di CTE dan tidak digabungkan ke data produksi.

### Produksi — `bppiut`

| Unit | Pembayaran `BT` | A | A % | B | B % |
|---:|---:|---:|---:|---:|---:|
| 1 | 1.887 | 0 | 0,0000 | 0 | 0,0000 |
| 2 | 744 | 0 | 0,0000 | 0 | 0,0000 |
| 3 | 92 | 0 | 0,0000 | 0 | 0,0000 |
| 4 | 5.492 | 0 | 0,0000 | 0 | 0,0000 |
| 5 | 549 | 0 | 0,0000 | 0 | 0,0000 |
| 6 | 97 | 0 | 0,0000 | 0 | 0,0000 |
| 7 | 2.312 | 0 | 0,0000 | 0 | 0,0000 |
| **Total** | **11.173** | **0** | **0,0000** | **0** | **0,0000** |

### Produksi — `bphut`

| Unit | Pembayaran `DP` | A | A % | B | B % |
|---:|---:|---:|---:|---:|---:|
| 1 | 5.289 | 0 | 0,0000 | 0 | 0,0000 |
| 2 | 151 | 0 | 0,0000 | 0 | 0,0000 |
| 4 | 1.850 | 0 | 0,0000 | 0 | 0,0000 |
| 5 | 274 | 0 | 0,0000 | 0 | 0,0000 |
| 6 | 48 | 0 | 0,0000 | 0 | 0,0000 |
| 7 | 3.871 | 0 | 0,0000 | 0 | 0,0000 |
| **Total** | **11.483** | **0** | **0,0000** | **0** | **0,0000** |

### Vonis P2 yang berlaku

Kontrol positif A menyala, sementara produksi A = B = 0 pada **22.656**
pembayaran berprefiks dokumen. Hasil berada tepat di pita rendah≈kontrol.

**Vonis: balance-forward sejauh delapan kolom mirror.** Aging belum boleh
diimplementasikan. Keputusan antara penautan nyata dan FIFO-imputed ditunda
sampai Gerbang 0B memeriksa skema EasyMax lengkap.

## 5. Gerbang 0B — blok siap-tempel untuk Dion

Jalankan di **dua unit** bila memungkinkan: Imam Bonjol dan satu pembanding
(disarankan Bakau). Gunakan sesi/koneksi baru untuk setiap unit.

```sql
SHOW DATABASES;            -- WAJIB dulu: nama DB per-situs (Korek = easymax_korek)

-- Pertanyaan 1: apakah master pelanggan menyimpan limit kredit dan/atau tempo?
DESCRIBE tm_plg;
SELECT * FROM tm_plg LIMIT 3;

-- Pertanyaan 2: apakah ledger punya kolom penaut faktur yang tidak dicerminkan?
DESCRIBE tr_bppiut;
DESCRIBE tr_bphut;

-- Kontrol positif: query ini HARUS memulangkan satu angka > 0.
SELECT COUNT(*) FROM tr_bppiut;

-- Peta modul pembayaran/penagihan.
SHOW TABLES LIKE 'pj%';
SHOW TABLES LIKE '%tagih%';
SHOW TABLES LIKE '%faktur%';
SHOW TABLES LIKE '%bayar%';
```

Mohon kirim hasil mentah seluruh blok, termasuk nama unit dan database yang
dipilih. Jangan hanya mengirim hasil `DESCRIBE tm_plg`.

Cara membacanya pada run berikutnya:

1. Bandingkan `DESCRIBE tr_bppiut`/`tr_bphut` dengan delapan kolom mirror.
   Setiap kolom tambahan didaftarkan satu per satu sebagai **kandidat**, belum
   otomatis dianggap penaut.
2. Kandidat harus diprobe lagi keterisiannya: persentase non-NULL/non-kosong dan
   contoh pasangan. Kolom yang ada tetapi kosong tidak berguna.
3. Tabel `pj…` dapat menyimpan alokasi di luar ledger. Kalau ada kandidat, skema
   dan keterisiannya harus diperiksa sebelum memilih aging.
4. `SELECT COUNT(*) FROM tr_bppiut` adalah kontrol positif. `Empty set` dari
   pencarian tabel tidak sah bila kontrol positif atau pemilihan database gagal.
5. SQL Manager memakai snapshot InnoDB `REPEATABLE READ`. Jika hasil terasa
   janggal, tutup koneksi dan buka ulang sebelum mengulangi query.

## 6. Yang masih belum diketahui

- Apakah `tm_plg` menyimpan limit kredit atau tempo, tipe kolomnya, dan tingkat
  keterisiannya.
- Apakah `tr_bppiut`/`tr_bphut` memiliki kolom alokasi tambahan.
- Apakah modul `pj…` atau tabel tagihan/faktur/bayar menyimpan penautan di luar
  ledger.
- P3: pola kode bertitik lintas tujuh unit.
- P4: anti-join kelengkapan lintas tujuh unit.
- P5: biaya tiga bentuk query dan keputusan cache vs materialisasi.
- Bentuk aging: penautan nyata atau FIFO-imputed.
- Triase voucher, perluasan `pelanggan_sale`, gold-check baru, rancangan layar,
  render, PDF, dan implementasi akhir.

## 7. Insiden kredensial

Paparan sesi sebelumnya adalah **paparan ketiga** atas kredensial lokal yang
sama. Alasan lama untuk menunda rotasi—transkrip tidak meninggalkan mesin—tidak
lagi berlaku karena sesi berjalan melalui CLI pihak ketiga. Rotasi oleh pemilik
sekarang **direkomendasikan** untuk `DATABASE_URL`/sandi `dashboard_app`,
`AUTH_SECRET`, dan `AUTH_GOOGLE_SECRET`; `AUTH_GOOGLE_ID` ikut diperiksa sebagai
konfigurasi terkait. Run ini tidak memutar secret dan tidak menyentuh Secret
Manager selain membaca URL role `dashboard_ro` langsung ke memori untuk probe.

## 8. Batas penegakan

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only
(aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS.
Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk
pengawas. **Penegakannya tetap manusia.**
