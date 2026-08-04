# CNOSO case-insensitive + kapasitas halaman Laporan (2026-08-04/05)

Ditulis untuk pembaca yang **tidak ikut sesi ini**. Tiga arc yang berurutan
bukan karena direncanakan begitu, melainkan karena arc pertama membuka arc
kedua, dan arc kedua membuka arc ketiga.

| arc | hasil | PR |
|---|---|---|
| 1. CNOSO case-insensitive | ✅ live di pilot, terverifikasi di browser | #175 → #176 |
| 2. Kapasitas halaman Laporan | ✅ live di pilot | #177 → #178, #179 |
| 3. Bloat `bppiut` (E + reclaim) | ⏳ belum dikerjakan | — |

---

## Arc 1 — Sisa DO Solar Bundaran Kotabaru 40.000 L padahal EasyMax 8.000 L

### Masalahnya

EasyMax menautkan penerimaan DO ke penebusan lewat No. SO Pertamina (`CNOSO`)
secara **case-insensitive**. Postgres `=` tidak. Nomor SO adalah teks bebas yang
diketik tangan, jadi satu SO yang pernah diketik dua casing **pecah jadi dua**:
sisi tebus menyisakan outstanding palsu, sisi terima jatuh jadi "yatim" — dua
angka yang saling bertentangan di satu layar.

Di KB (unit 4), produk Solar:

| kunci | ditebus | diterima | `GREATEST(0,·)` |
|---|---:|---:|---:|
| `020712kb` | 32.000 | 24.000 (3 baris) | **8.000** |
| `020712KB` | 0 | 8.000 (1 baris) | 0 → *yatim* |
| `300712kb` | 32.000 | 8.000 (1 baris) | **24.000** |
| `300712KB` | 0 | 24.000 (3 baris) | 0 → *yatim* |

Hantunya **32.000 L**, persis selisih vs laporan resmi EasyMax.

### Perbaikannya

Normalisasi **hanya di query dashboard** — mirror tetap salinan setia sumbernya.
`cnoso` bukan kunci UPSERT di ingest (`table-config.ts` memakai `ckdtrm`/`ckdtbs`),
jadi menormalkan saat ingest tak membeli konsistensi apa pun dan hanya akan
menulis ulang 15 tahun data.

Tiga call-site, semuanya di `queries.ts` — kalau hanya Sisa DO dibetulkan, panel
Alokasi tetap memajang keempat penerimaan itu sebagai yatim:
`getDoHarian`, `getDoAnomalies`, `getDoSuspectSO`.

Kunci `lower(trim(cnoso))`; yang **dirender** tetap `min(trim(cnoso))` — ejaan
sumbernya. `lower()` polos akan me-recase 1.029 nomor SO sehat di KB saja
(mis. `170626 Ditlantas`).

### Hasilnya, terverifikasi di build pilot ter-deploy

| tanggal | metrik (KB, Solar) | sebelum | sesudah |
|---|---|---:|---:|
| 2026-08-04 | Sisa DO | 40.000 | **8.000** |
| 2026-08-04 | sisa_macet | 32.000 | **0** |
| 2026-08-04 | DO Awal | 48.000 | **16.000** |
| 2026-08-04 | orphan (Alokasi) | 152.000 | **120.000** |
| 2012-07-31 | DO Awal / Sisa / alur | 40.000 / 40.000 / 16.000 | **32.000 / 16.000 / 0** |
| 2012-08-01 | DO Awal / Sisa / alur | 40.000 / 72.000 / 16.000 | **16.000 / 40.000 / 8.000** |

PDF diekspor dari build pilot: memuat "120.000", **tidak** memuat "152.000",
"020712kb", "300712kb" — dengan ekstraktor yang dibuktikan bekerja lebih dulu
(5 kontrol positif TRUE).

**Kontrol.** `231112kb` juga punya varian casing tapi seimbang (baris huruf
besarnya header ber-`sbatal=1`) → 0 kontribusi di kedua mode; tripwire hidup:
kalau pelipatan menelan baris batal itu, Sisa BB-01 melonjak 48.000 → 96.000.
Enam unit lain: **byte-identik**. Total baris berubah di 7 unit × 3 fungsi × 3
tanggal = **8**, semuanya KB/Solar. 86 dari 86 baris suspect yang tetap ada
byte-identik ejaannya.

---

## Arc 2 — halaman Laporan tidak bisa dibuka di pilot

Ditemukan saat hendak memverifikasi Arc 1 di browser. **Bukan disebabkan Arc 1**:
error identik tercatat di revisi lama `00076` sejam sebelum deploy CNOSO, dan
Imam Bonjol — yang terbukti byte-identik — gagal identik.

Render Laporan menembakkan **17 query paralel**, tiap fungsi 1 checkout pool.
Durasi serial (KB 2026-08-04):

```
 104.006 ms  getSaldoPelanggan        ← 71% dari total
  13.620 ms  getDailyGlByProduct(MTD)
   ... 12 sisanya < 8 dtk             TOTAL 146.336 ms
```

Pool `max: 5` → dua query panjang mengunci 2 slot, 12 sisanya berebut 3 slot dan
antre ±9,5 dtk, tepat di bibir `connectionTimeoutMillis: 10_000`. Log pilot:
**500 pada 10,09 dtk**.

Obatnya: cache saldo (historis ≤H−2 24 jam · hari berjalan TTL pendek) + pool
5 → 10. Lalu, diukur di build pilot, TTL 120 dtk ternyata **lebih pendek dari
biaya mengisinya** dan `unstable_cache` **memblokir** saat kedaluwarsa → dinaikkan
ke 15 menit, ditandai SEMENTARA.

### Yang TIDAK dilakukan, dan alasannya

- **Menaikkan `connectionTimeoutMillis`** — hanya memperpanjang penantian
  sebelum gagal yang sama.
- **Menambah index `bppiut`** — `bppiut_unit_id_dtgl_idx` sudah ada, dan memaksa
  jalur index justru **112,0 dtk** vs **49,7 dtk** seq scan. Planner sudah benar.
- **Membatasi konkurensi halaman** — menserialkan 146 dtk berisiko menembus
  `statement_timeout` 120 dtk.

---

## Arc 3 — akar sesungguhnya: `bppiut` 70% bangkai (BELUM dikerjakan)

```
bppiut  2.729.100 hidup / 6.646.023 mati = 70,9% · 1897 MB · autovacuum 402×
bphut     531.281 hidup / 1.677.742 mati = 75,9% ·  399 MB · autovacuum 939×
delivery   80.067 hidup /       695 mati =  0,9% ·   25 MB  ← kontras inkremental
```

Autovacuum sudah jalan ratusan kali **dan tetap kalah** — jadi ini pola tulis
yang patologis, bukan setelan vacuum yang salah. Penyebabnya: `piutang`/`hutang`
di-**full-sync** (seluruh ledger di-UPSERT tiap cadence), bukan inkremental.
Terbukti dari data: seluruh 926.992 baris KB ditulis ulang `ingested_at`-nya
dalam satu jam.

Rencana, **urutannya load-bearing**:

1. **E** — UPSERT `WHERE ... IS DISTINCT FROM` supaya baris tak berubah berhenti
   ditulis ulang. Mencegah kambuh; **tidak** menyusutkan berkas yang sudah ada.
2. **Reclaim sekali** — `pg_repack` (tersedia 1.5.2 di instance; `VACUUM FULL`
   ditolak karena ACCESS EXCLUSIVE akan memblokir pembacaan `bppiut`, yaitu
   mematikan halaman Laporan tepat saat diperbaiki). Pemilik tabel: role `ingest`.
3. **Ukur**, lalu putuskan apakah **D** (rollup saldo harian) masih perlu.

Reclaim sebelum E = digembungkan lagi dalam hitungan jam.

**D ditunda, nol baris kode.** Desain invalidasinya (sidik jari per unit ditulis
di akhir tiap full-sync, rollup menyimpan `built_from_fingerprint`, jalur baca
fallback ke hitung-live) disimpan sebagai dokumen, bukan implementasi.

---

## Tujuh pelajaran yang berlaku di luar CNOSO

### 1. Kunci join yang berubah semantik antar mesin

MySQL menyamakan string ber-collation case-insensitive; Postgres `=` tidak.
Setiap kunci yang dipindahkan dari EasyMax ke mirror mewarisi asumsi
pembandingan yang tak ikut pindah.

Yang menentukan siapa kena: **apakah nilainya diketik manusia**. Nomor SO
Pertamina resmi (`4062677939`) murni angka → kebal. Nomor "SO" teks bebas yang
diketik pengawas (`020712kb`, `170626 Ditlantas`) → rentan. Probe lintas kunci
membuktikan pembagian itu: `ckdbbm`, `ckdtangki`, `ckdtbs`, `cnodo` **nol** grup
ber-varian casing; `ckdplg` satu (tapi tak pernah menyentuh join); `cnoso` tiga.

Aturan turunannya: kunci join yang berasal dari input bebas manusia harus
dinormalisasi di sisi pembacaan, dan **nilai tampilannya dipisahkan dari
kuncinya** — kalau tidak, memperbaiki penautan akan merusak tampilan.

### 2. Detektor regresi yang memindai berkas test-nya sendiri

Penjaga `cnoso-keys.test.ts` memindai `src/` untuk pola pelanggaran. Versi
pertamanya ikut memindai **dirinya sendiri**, sehingga string kontrol di dalam
test (`lower(trim(th.cnoso))`, `min(...) AS cnoso_disp`) terhitung sebagai
call-site sah — hitungan "kunci ternormalisasi" jadi 3 padahal produksi 0.

Gejalanya menipu: angkanya *hampir* benar. Pemindai sumber apa pun harus
mengecualikan berkas test, dan **hitungan yang diharapkan** harus ditulis
eksplisit supaya ketidakcocokan berbunyi.

### 3. Shim `grep` ber-`-I` yang menelan berkas tanpa pesan

`apps/agent/src/domains.ts` memuat satu byte NUL literal di dalam template
string (pemisah kunci Map). Akibatnya `grep` mengklasifikasikan **seluruh berkas
1082 baris** sebagai biner dan melewatkannya — mengembalikan **nol keluaran,
bukan error**. Bentuk yang tak bisa dibedakan dari "tidak ada kecocokan".

Sapuan enumerasi "buktikan daftarnya lengkap" karena itu hijau-palsu terhadap
berkas itu. Ketahuan hanya karena `sed -n '/pat/='` menemukan apa yang grep tak
temukan.

Turunannya: pemindai yang jadi **bukti** harus membaca berkas lewat jalur yang
tak bisa diam-diam melewatkannya (`readFileSync`, bukan grep), dan enumerasi
"lengkap" butuh kontrol positif yang membuktikan alatnya memang berbunyi.
Byte NUL-nya sendiri sudah diganti escape `\0` di PR #174.

### 4. Prediksi yang MELESET di absolut tapi TEPAT di delta

Dua prediksi ter-registrasi meleset: `do_awal` 2026-08-04 ditulis 40.000 ternyata
48.000; `alur_selisih` 2012-08-01 ditulis 8.000 ternyata 16.000. Keduanya meleset
pada **nilai sebelum**, karena rekonstruksi manual melewatkan kontributor lain.
Delta yang diklaim kuat (−32.000 dan −8.000) keduanya tepat.

Itu tetap bukti sah, dan alasannya penting: yang diuji adalah **efek perubahan**,
bukan pengetahuan lengkap tentang keadaan awal. Delta bisa diprediksi dari
mekanismenya; absolut menuntut memodelkan seluruh sistem. Mensyaratkan absolut
tepat akan mendorong orang menulis prediksi setelah mengukur.

Pasangannya: tulis **syarat kekalahan** sebelum mengukur. Untuk reclaim:
"kalau durasi tidak membaik atau justru memburuk, itu membantah tesis bloat dan
saya berhenti melaporkan, bukan mengulang."

### 5. Koordinasi multi-sesi di satu checkout

Dua kali brief dari orchestrator basi terhadap kenyataan:

- "sesi lain sudah dihentikan" — padahal `lsof -a -d cwd -c claude` menunjukkan
  dua sesi masih hidup, salah satunya justru worker yang disebut sudah mati.
  Itu keputusan yang belum dieksekusi, disajikan sebagai fakta.
- "`piutang` disinkronkan watermark `DTGL`, rolling floor 1095 hari" — padahal
  kode berkata full-sync tanpa watermark, dan `piutang`/`hutang` tidak ada di
  tier sapuan sama sekali.

Pemulihannya selalu sama: **ukur, jangan percaya narasi**. Dan mengukur berarti
memakai sumber yang tak berkepentingan — `lsof`, bukan ingatan; `sync.ts:1494`
dan sebaran `ingested_at`, bukan komentar.

### 6. Gerbang yang mustahil dipenuhi

Kriteria Langkah 0 versi awal: "nol proses ber-cwd di `~/Repo/solamax` selain
milikmu". Tak akan pernah hijau — VS Code menahan dua `Code Helper (Plugin)`
ber-cwd di repo selama foldernya terbuka.

Ini kembaran dari pemeriksaan yang tak bisa berbunyi merah. Gerbang yang mustahil
hijau melatih orang mengabaikannya; gerbang yang mustahil merah melatih orang
mempercayainya. Kriteria yang benar menyebut **kelas** yang dimaksud: nol proses
`claude`/`disclaimer` atau turunannya.

### 7. Tier dinaikkan, parameter tier lama tak pernah ditinjau

`max: 5` dan `connectionTimeoutMillis: 10_000` dipasang saat insiden saturasi
koneksi 30 Juni 2026, ketika instance masih **db-f1-micro** (max_connections 25
→ 22 terpakai). Instance kemudian di-bump ke **db-g1-small** (50 → 47) dan pool
tak pernah ikut ditinjau. Komentarnya masih berbunyi "f1-micro … 22 usable"
sampai 2026-08-05 — lengkap dengan kalimat "JANGAN naikkan tanpa hitung ulang"
yang tak pernah ada yang jalankan.

Perbaikan insiden membeku jadi konfigurasi permanen, premisnya gugur diam-diam,
dan tak ada yang berbunyi. Obatnya: **penjaga yang menghitung ulang budgetnya
dari sumber**, bukan komentar. `db-budget.test.ts` melakukannya, dan sengaja
dua arah — pool terlalu besar merah (melebihi kapasitas), pool terlalu kecil
juga merah (fan-out Laporan). Penjaga satu arah akan meloloskan kemunduran ke 5.

Kelas yang sama patut dicurigai di mana pun ada angka yang lahir dari insiden:
`statement_timeout`, `connection_limit` Prisma, `containerConcurrency`,
`fullSweepFloorDays`.

---

## Catatan operasional

- **Verifikasi angka harus lewat jalur yang punya data.** Tier testing `-rlsstg`
  **nol data tersinkron** — deploy hijau di sana membuktikan build-nya jalan,
  bukan angkanya. Reproduksi lewat cloud-sql-proxy read-only + fungsi produksi
  lokal, lalu konfirmasi di build pilot pasca-promosi.
- **Hostname berlabel, bukan `*.run.app`.** Cookie PKCE host-only: alur OAuth
  yang dimulai di satu host dan mendarat di host lain menghasilkan
  `InvalidCheck: pkceCodeVerifier could not be parsed`, yang tampil seperti
  cacat promosi.
- **Integration test ber-gate `SCOPE_LIVE_DB=1` tidak jalan di CI.** Penjaga
  sisi-CI untuk Arc 1 adalah pemindai sumber, bukan test angkanya.
