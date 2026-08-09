# Ketaatan Administrasi — keputusan yang mengikat

Indikator kepatuhan pengisian **Rincian Penjualan** oleh pengawas (Pendapatan
Lain · Pengeluaran · Setoran Bank), dengan aturan setoran bank harus **selaras**
dengan uang tunai.

**Berkas ini bukan kronologi.** Ia daftar keputusan yang mengikat ke depan,
alasannya, dan apa yang rusak kalau diubah. Kalau kamu menyentuh indikator ini,
baca ini — bukan tiga puluh tiga PR.

Aturan pengambil keputusan: [`src/lib/compliance.ts`](src/lib/compliance.ts).
Formula H: [`src/lib/rekon.ts`](src/lib/rekon.ts).

---

## 1 · Toleransi setoran — aritmetika, bukan gaya

`|I − H| ≤ SETORAN_TOLERANSI_RP`.
**Nilainya hidup di [`src/lib/compliance.ts`](src/lib/compliance.ts), bukan di sini.**
Saat ditulis: **1.000**. Kalau angka itu tak lagi cocok dengan konstantanya,
**konstantanya yang benar** — dan ketidakcocokan ini sengaja terlihat.

**Kenapa bukan kesamaan eksak:** diukur atas 95 hari ber-setoran di 7 unit —
**95 dari 95** nilai setoran adalah kelipatan **persis** Rp 1.000 (bank menerima
slip bulat), sementara **0 dari 95** sama persis dengan H (H hampir selalu
berpecahan, mis. `…426,50`). Kesamaan eksak karenanya **mustahil secara
aritmetika**; `i === h` akan memerahkan **100%** hari.

**Kenapa 1.000 dan bukan angka lain:** itu **kuantum slip setoran** — diturunkan
dari data, bukan dipilih. 82 dari 95 hari jatuh di dalam ±`SETORAN_TOLERANSI_RP`.

**Kalau diubah:** menaikkannya menyembunyikan kelebihan/kekurangan setor nyata
(8 dan 5 kejadian dalam 95 hari). Menurunkannya mengembalikan derau pembulatan.

**Aturan lama `I ≥ H` JANGAN dikembalikan** — ia menghasilkan **10 peringatan
palsu** per 95 hari (semata pembulatan ke bawah) **dan** menghijaukan **8
kelebihan setor nyata**.

---

## 2 · Lantai adopsi — tanggal BEKU, bukan `min()` hidup

`ADOPSI_RINCIAN` di [`src/lib/config.ts`](src/lib/config.ts): satu tanggal per
kode unit, dibaca sekali dari DB lalu **dibekukan**.

**Kenapa bukan `min(business_date)` hidup:** `min()` hidup membuat **masa lalu
bisa berubah sendiri** — satu entri bertanggal mundur menurunkan lantai dan
mengubah sederet hari netral jadi **merah surut**. Indikator yang riwayatnya
bergerak akan berhenti dipercaya.

**Biayanya diterima:** menambah unit = satu baris kode. Dijaga tes yang
menurunkan cakupan dari `UNIT_DISPLAY` — unit baru tanpa entri lantai = tes
**merah** yang menyebut kodenya.

**Tiga nilai yang BERBEDA, jangan disatukan dengan `??`:**

| nilai | arti | status |
| --- | --- | --- |
| `"YYYY-MM-DD"` | unit mengadopsi panel pada tanggal itu | dinilai sejak tanggal itu |
| `null` | terdaftar, **terkonfirmasi** belum memakai panel | `belum_adopsi` — **KUNING**, tiap hari |
| tak ada key | **belum didaftarkan** | `config_hilang` — **MERAH** |

`?? null` akan meruntuhkan pembedaan ini **tanpa suara**: `undefined` menyamar
jadi `belum_adopsi`, dan unit yang lantainya **tak diketahui** terlihat seperti
unit yang sekadar belum mulai. Karena itu `adopsiRincian()` memakai
`hasOwnProperty`, bukan `??`.

**Hari adopsi itu sendiri SUDAH dinilai** (`businessDate < adopsi`, bukan `<=`).
Ditimbang dua sisi; kalau dibalik, sadari itu memaafkan satu hari per unit
**selamanya**, bukan cuma saat onboarding.

---

## 3 · Tiga gerbang — masing-masing menjaga hal yang BERBEDA

Urutannya di `adminStatus()` bermakna. **Jangan hapus satu pun karena mengira ia
menduplikasi yang lain.**

| gerbang | menjaga | kalau dihapus |
| --- | --- | --- |
| **lantai adopsi** | hari **sebelum unit memakai panel** — bukan kelalaian pengawas | 39 dari 47 sel merah kembali muncul sebagai tuduhan palsu |
| **`shifts < SHIFT_TARGET`** (=3 saat ditulis) | **hari LAMPAU yang shift-nya TAK PERNAH masuk** (agent mati / sync gagal) — H dirakit dari data yang tak akan pernah lengkap | pengawas dituduh atas kegagalan **pipeline** |
| **`hari_berjalan`** (tanggal = hari ini) | **H masih dirakit sepanjang hari** | selisih semu belasan–ratusan juta tampil sebagai temuan |

**Bukti untuk gerbang hari-berjalan** (dua pengamat, jendela berbeda, angka
identik): Korek 2026-08-07, shift penuh (`SHIFT_TARGET`), `A` tidak bergerak sama sekali,
tapi **H turun 23.516.922 dalam 18 menit** (355.569.872 → 332.052.950) —
seluruhnya dari pertumbuhan C+D. `pelanggan_sale`/`voucher_sale`/`edc` punya
**watermark sendiri** dan tidak menunggu shift tutup.

⚠️ **`shifts >= SHIFT_TARGET` TIDAK berarti H sudah berhenti bergerak.** Itu dua pertanyaan
berbeda, dan gerbang shift hanya menjawab yang pertama.

**Hari kemarin dan sebelumnya tetap dinilai SEKETIKA** — itu kasus bergunanya,
dan biayanya nyaris nol karena jatuh tempo memang akhir H+1.

---

## 3b · Aturan SALIN-SETORAN — angka kemarin diketik ulang

Ditambahkan 2026-08-09. Berasal dari temuan **owner**, bukan dari papan: setoran
Korek 2026-08-07 **sama persis** dengan 2026-08-06 — Rp 359.447.000 dua kali —
dan yang 08-07 meleset **Rp 3.877.128,50** dari uang tunai. Papan waktu itu
hanya bilang "lebih setor", **kuning**; sebab sesungguhnya (angka kemarin
terketik ulang) tak tersuarakan sama sekali.

**Menyala hanya bila TIGA hal benar bersamaan:**

| | syarat | ditegakkan di mana |
| --- | --- | --- |
| (a) | `I(D)` **sama persis** dengan `I(D−1)` | kondisi di `adminStatus` |
| (b) | `D` **bukan hari ini** | **URUTAN** — gerbang `hari_berjalan` pulang lebih dulu |
| (c) | `\|I − H\|` **>** toleransi (`SETORAN_TOLERANSI_RP`) | `kode !== "selaras"` |

⚠️ **(b) dipikul oleh URUTAN, bukan oleh kondisi tertulis.** Memindahkan blok
ini ke atas gerbang `hari_berjalan` akan menyalakannya pada hari yang H-nya
masih dirakit — artefak yang justru jadi alasan gerbang itu ada. Kalau blok itu
pindah, syarat (b) **harus ditulis eksplisit**. Dijaga tes.

**Kenapa (c) wajib:** dua hari yang setorannya kebetulan sama tapi dua-duanya
**selaras** dengan H masing-masing bukan kesalahan. Menandainya akan melatih
orang mengabaikan aturannya — kegagalan yang sama dengan alarm kas dorman.

**MERAH, bukan kuning — bahkan saat arahnya "lebih setor"** (yang sendirian
hanya kuning). Kelebihan setor bisa punya sebab sah; angka **identik dengan
kemarin DAN tak cocok dengan H** adalah kekeliruan ENTRI. Yang ditandai di sini
**sebabnya**, bukan arah selisihnya.

### Volume alarm — TERUKUR, bukan ditaksir

| | |
| --- | ---: |
| jendela | 40 hari × 7 unit = **960 jam kalender** |
| **jam-alarm (a ∧ b), dari jejak audit** | **10,19 jam** — batas ATAS |
| backtest keadaan-akhir | **0** — batas BAWAH |
| kejadian | **1** |
| porsi waktu ber-alarm | **1,06%** |

Aturannya **sunyi**. Ia tak akan dimatikan orang karena ramai.

### ⛔ Aturan ini TIDAK BISA diverifikasi di produksi

Keadaan akhir sudah **bersih** — pengawas mengoreksi kasusnya sendiri
(08-08 pukul 10:11 → Rp 332.053.000). Jadi **"hijau di produksi" tidak akan
pernah membuktikan aturan ini bekerja**, dan papan yang tenang bukan bukti apa
pun. **Fixture di `compliance.test.ts` memikul SELURUH bebannya**, memakai angka
historis yang nyata, dengan kontrol hari yang `I`-nya identik **tapi** H-nya
cocok (tak boleh menyala).

Pemeriksaan keadaan-akhir atas arsip perekam (14 pasang hari berurutan, 7 unit,
2026-08-06…08): **0 menyala**. **Kontrolnya tidak vakum** — nilai Rp 359.447.000
masih ada di arsip pada 08-06 (21 snapshot), sedangkan 08-07 sudah terbaca
Rp 332.053.000. Jadi pasangan identik memang akan terlihat kalau ada; ia sudah
diperbaiki. Ini konsisten dengan §7 "backtest keadaan AKHIR — dan syaratnya":
angka 0 itu **batas bawah**, bukan volume alarm.

### Pemasangan D−1 ada di SATU tempat

`pasangkanSetoranKemarin()` di `compliance.ts`, dipakai halaman Ketaatan **dan**
feed anomali — bukan disalin ke masing-masing. Prasyaratnya: deret **rapat &
menaik** per unit (kedua query pemasoknya memakai `generate_series`). Halaman
Ketaatan mengambil **`DAYS + 1`** hari dan membuang yang tertua dari tampilan:
tanpa benih itu, sel terkiri tak pernah bisa diperiksa — lubang yang bergeser
satu hari tiap hari, jadi tak akan pernah ada yang menyadarinya.

---

## 4 · SATU pembuat vonis

`adminStatus()` adalah **satu-satunya** yang memutuskan I-vs-H.

| | berkas | peran |
| --- | --- | --- |
| **pembuat vonis** | `app/(app)/monitoring/ketaatan/page.tsx` | memanggil `adminStatus` |
| **pembuat vonis** | `lib/anomalies.ts` | memanggil `adminStatus` |
| **pembuat vonis** | `lib/rincian-model.ts` | memanggil `adminStatus` |
| hilir | `lib/export/rincian-doc.ts` | merender `RincianModel.summary[].note` |
| hilir | `components/rincian/RincianExport.tsx` | idem |
| hilir | `components/rincian/ManualEntryForm.tsx` | merender `ManualRecon` |
| tidak membandingkan | `lib/laporan-model.ts` | alarm masih `na()` |

**Pelajaran yang dibayar mahal:** kami pernah menyatukan **rumus H** ke
`rekon.ts` dan menyatakan "sumber tunggal tercapai". Yang berduplikat ternyata
**vonisnya** — `rincian-model` menghitung verdict sendiri dan tak menerima
`shifts`. Akibatnya halaman Ketaatan sembuh sementara **lembar cetak yang
ditandatangani pengawas** masih menuduh.

> **Menyatukan INPUT tidak menyatukan KEPUTUSAN.**

`RincianRaw.konteks` karenanya **WAJIB**: membangun model tanpa fakta yang
dibutuhkan untuk menilainya = **error type-check**, bukan lubang senyap.

**Nada catatan punya TIGA nilai** (`ok | warn | info`). `info` = netral. Kanal
dua-nilai sebelumnya membuat keadaan "belum bisa dinilai" tampil dengan **warna
danger + titik merah + glyph ⚠** di layar **dan** di PDF bertanda tangan —
empat penanda yang semuanya berkata "masalah" untuk kalimat yang berkata
sebaliknya.

---

## 5 · Batas yang DIKETAHUI

Ditulis supaya tak ada yang mengira indikator ini menjaga lebih dari yang ia jaga.

> **Angka di bawah TIDAK hidup di kode** — ia hasil pengukuran bertanggal. Tiap
> angka disertai cara menjalankannya ulang. **Jalankan ulang, jangan percaya:**
> data pilot bergerak, dan angka telanjang dalam prosa pada akhirnya berbeda dari
> isinya. Semua query read-only; `app.unit_ids` di-set lewat `set_config` dalam
> transaksi (RLS fail-closed tanpa itu).

**Atestasi per-hari — blind spot 4,1%** *(diukur 2026-08-07 12:49 WIB)*. Hari dengan ≥1 baris di seksi mana pun
dianggap "pengawas sudah mengisi", jadi seksi kosong di hari itu dibaca **NIHIL**,
bukan terlewat. `app.manual_entry` memang tak bisa membedakan (dua-duanya nol
baris). Terukur: 5 dari 97 hari parsial (5,2%), satu di antaranya kehilangan
**setoran** sehingga tetap tertangkap merah → blind spot sejati **4 hari = 4,1%**.
Menutupnya butuh tombol "Nyatakan NIHIL" + migrasi.

<details><summary>query yang menghasilkan 5,2% / 4,1%</summary>

```sql
-- hari ber-atestasi yang TIDAK lengkap ketiga seksinya (hari berjalan dibuang)
WITH pv AS (
  SELECT unit_id, business_date,
    count(*) FILTER (WHERE section='pendapatan_lain') > 0 AS f,
    count(*) FILTER (WHERE section='pengeluaran')     > 0 AS g,
    count(*) FILTER (WHERE section='setoran_tunai')   > 0 AS i
  FROM app.manual_entry WHERE NOT void
    AND business_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
  GROUP BY 1,2)
SELECT count(*) AS ber_atestasi,
       count(*) FILTER (WHERE NOT (f AND g AND i)) AS parsial
FROM pv;
```
Dari hasil itu, kurangi hari yang kehilangan SETORAN (tertangkap merah oleh
aturan wajib-setoran) → sisanya blind spot sejati.
</details>

**Gerbang `sqlcheck` TIDAK menjaga `main`.** Ia berjalan pada **push** ke
`staging`/`main`, bukan pada PR. Artinya SQL rusak tertangkap **sesudah merge,
sebelum deploy**: `main` **bisa** memuat commit ber-SQL rusak dengan deploy
terblokir. Pulih = **revert PR**. Cakupannya `apps/dashboard/**` +
`packages/shared/**` — **`apps/backend/**` tidak memicunya**, dan
`deploy-backend.yml` tak punya padanan, jadi SQL ingest tak dijaga gerbang
eksekusi-SQL mana pun.

### Ekor C/D — PERTANYAAN DITUTUP (2026-08-09)

Dua kesimpulan **terpisah**. Bukti mentahnya diarsipkan ber-versi:
[`session-notes/data/ekor-cd-2026-08-08.jsonl`](../../session-notes/data/ekor-cd-2026-08-08.jsonl)
— 21 snapshot × 7 unit × 3 tanggal bisnis, 2026-08-08 10:16 → 2026-08-09 01:47.

**(a) ✅ Jatuh tempo akhir H+1 CUKUP LAMBAT — margin ~13,7 jam.**
Korek bd=2026-08-07 masih bergerak pukul **10:13** pada H+1 (H −23,5 jt, `A`
diam), lalu **beku** sejak snapshot **10:16** dan seterusnya. Perakitan selesai
~10:16 pada H+1; jatuh tempo 23:59 pada H+1. **Asumsi H+1 bertahan.**
*(n = 1 hari × 1 unit — bukan hukum alam.)*

**(b) ✅ Gerbang keempat TIDAK DIBANGUN — paparan ≤ ~20 menit.**
Kekhawatiran "jendela ~10 jam tiap pagi" **terhapus**, bukan membesar. Sebabnya
fakta operasional yang baru diketahui: **shift terakhir tersinkron PAGI hari
berikutnya, bukan semalam** — bd=2026-08-08 masih `2 dari 3 shift` di **ketujuh**
unit pada 01:32, dan `A/C/D` terakhir berubah 23:28:43.

Jadi selama malam dan pagi buta, **`shifts < SHIFT_TARGET` sudah menahan** dan
papan tidak menilai apa pun. Jendela paparan sesungguhnya hanya
**[shift-3 mendarat → C/D berhenti]** — untuk Korek: ≤09:55 → ~10:13,
yaitu **≤ ~20 menit**, lebih kecil dari satu siklus refresh halaman.

> **Gerbang keempat tidak sebanding** dengan paparan 20 menit — ia harus
> dijelaskan selamanya, dan ketiga gerbang yang ada sudah cukup.

**⚠️ APA YANG MEMBATALKAN KEPUTUSAN INI** — tinjau ulang bila:
- **shift ke-3 mulai mendarat tengah malam** (bukan pagi). Jendelanya melebar
  dari ~20 menit menjadi berjam-jam, dan gerbang keempat kembali layak dibahas.
- pola sinkron agent berubah (mis. jadwal sapuan digeser).

**Sinyal kelengkapan H — TIDAK ADA yang bisa diamati** *(diperiksa 2026-08-09)*.
`sync_state`: `pelanggan` **0 dari 7 unit** punya `last_watermark`, `edc`
**0 dari 7** — tepat komponen C dan D yang bergerak. `sales` hanya 6 dari 7.
Yang ada hanya `last_run_at`, dan itu berkata *"agent baru jalan"*, bukan
*"tanggal D lengkap"*. Gerbang berbasis **kelengkapan** karenanya tak bisa
dibangun tanpa mengubah `apps/agent`; gerbang berbasis **waktu** akan jadi
pilihan sadar, bukan tebakan.

**Pengukuran DIHENTIKAN sebagai KEPUTUSAN, bukan karena gagal.** Perekamnya
memang gagal tiga kali (hilang · berjalan-tanpa-menulis · gap tidur), tapi yang
menghentikannya adalah **angkanya**: paparan ≤20 menit tak mengubah keputusan
apa pun, dan presisi lebih lanjut hanya akan mengundang kegagalan keempat.
*Jangan baca ini sebagai menyerah dan mengulanginya.*

<details><summary>catatan lama (dipertahankan)</summary>

**Ekor C/D belum terukur tuntas** *(diamati 2026-08-08, 09:55 → 10:13 WIB, unit
Korek, tanggal bisnis 2026-08-07)*. Diketahui: C+D masih tumbuh **setelah** shift
penuh — 23.516.922 dalam 18 menit, dengan `A` tidak bergerak sama sekali. **Belum diketahui:** apakah ia berhenti
sebelum akhir H+1 — kalau tidak, **gerbang jatuh tempo juga menilai terlalu
dini**. Sedang diukur oleh `.measure/` (launchd, tiap 15 menit).
⚠️ `ingested_at` **tidak bisa** dipakai mengukur ini: sapuan tier-2 agent menulis
ulang baris secara batch (7 tanggal bisnis berbagi stempel pada **detik** yang
sama). Ukur **NILAI**, bukan stempel tulis.
</details>

<details><summary>cara mengukurnya ulang</summary>

Perekam `.measure/rekam.sh` (dijadwalkan `launchd`, tiap 15 menit) merekam
`sum(C)`, `sum(D)`, `A`, `shifts`, `I` per unit-hari ke JSONL bertimestamp.
**Kontrol wajib:** ikutkan satu tanggal yang sudah lama settle — ia HARUS diam.
Kalau kontrolnya ikut bergerak, yang bergerak bukan "ekor" dan seluruh pembacaan
batal.
</details>

**Badge sidebar mentok "9+"** — anomali administrasi baru tidak terlihat di sana.

---

## 6 · Cara memastikan kamu tidak merusaknya

- `pnpm check` dari root. Unit test `compliance.test.ts` memakai **angka
  unit-hari NYATA** dari DB pilot, bukan karangan.
- **Tiap tes di sini pernah dibuktikan bisa MERAH** lewat mutasi sengaja. Kalau
  kamu menambah aturan, lakukan hal yang sama — tes yang belum pernah dilihat
  gagal belum tentu menguji apa pun.
- Tes DB-live: `ketaatan-live.integration.test.ts` (kanari, `SCOPE_LIVE_DB=1`) ·
  `queries.sqlcheck.integration.test.ts` (gerbang deploy) ·
  `rls-surfaces.integration.test.ts` (isolasi tenant).
- **Sebelum mengubah aturan, UKUR dampaknya pada sel yang sudah settle.** Setiap
  perubahan aturan di sini diukur dulu terhadap 91 sel historis — lantai adopsi
  (47 → 8 merah, diukur 2026-08-07), gerbang hari-berjalan (0 dari 91 berubah,
  diukur 2026-08-08). Jendela pembanding yang dipakai: **91 sel settle
  `2026-07-25 … 2026-08-06` × 7 unit** — sebut jendelanya saat melaporkan, karena
  jumlah selnya bergerak seiring waktu. Prediksi tanpa pengukuran
  sudah dua kali salah di sini, termasuk yang tandanya terbalik.

---

## 7 · Aturan kerja yang berlaku di luar berkas ini

Lahir dari kegagalan nyata di proyek ini. Ditulis sebagai **instruksi**, bukan
cerita — supaya bisa dipakai orang lain pada masalah lain.

### Log harus mencetak PERUBAHAN, bukan KEADAAN

> **Log yang mencetak KEADAAN, bukan PERUBAHAN, membuat kegagalan terlihat
> seperti keberhasilan.**

Sebuah perekam mencetak `baris=126` tiap jalan. Saat query-nya mulai gagal, ia
tetap mencetak `baris=126` — bentuk barisnya **identik** dengan jalan sukses, dan
satu-satunya bedanya adalah angka yang **tidak berubah**. Ia gagal senyap 12 jam.

**Cara memakainya:** cetak **delta**; kalau deltanya nol pada operasi yang
seharusnya menghasilkan sesuatu, cetak kata **GAGAL**. Jangan pernah kirim stderr
ke `/dev/null` pada langkah yang hasilnya kamu percayai. Ini keluarga yang sama
dengan penanda-yang-tak-cocok-isinya di §4.

### Instrumen tidak boleh lebih rapuh dari fenomenanya

Perekam ekor C/D gagal **tiga kali dengan tiga bentuk berbeda**: hilang
(penyimpanan session-scoped) · berjalan tanpa menulis (error tertelan) · gap
tidur laptop. Fenomena yang diukurnya — pergerakan C/D — jauh lebih stabil.

> **Instrumen yang lebih rapuh dari fenomenanya tidak sedang mengukur apa pun.**

**Kalau pengukuran periodik seperti ini dibutuhkan LAGI, jangan taruh di laptop
yang tidur.** Polanya sudah ada di repo: **Cloud Scheduler → endpoint
ber-shared-secret**, persis [`/api/warm-board`](src/app/api/warm-board/route.ts)
(constant-time secret, 401 tanpa kredensial, 204 tanpa body). Itu berjalan di
infrastruktur yang memang dirancang tidak tidur. *(Catatan, bukan pekerjaan —
belum diminta dan belum diusulkan resmi.)*

### Menyeberang sekali ≠ terus hidup

> **Menyeberangi batas SEKALI membuktikan ia BISA; ia tidak membuktikan ia akan
> TERUS.** Untuk sesuatu yang harus hidup berjam-jam, periksa juga bahwa jalan
> ke-N menghasilkan **data**, bukan cuma bahwa jalan ke-1 berhasil.

### Kode penanganan-error yang tak pernah dijalankan adalah beban

Ia memberi rasa aman yang tak ditopang apa pun — tema yang sama dengan gerbang
yang tak pernah berjalan dan guard yang menegaskan angkanya sendiri.
**Buktikan ia menyala, atau hapus.** Jangan tinggalkan menggantung.

### Backtest keadaan AKHIR — dan syaratnya

Lihat §5. Ringkas: ia tak bisa mengukur alarm yang menyala pada keadaan
**antara**, **bila** objek ukurnya bisa **dikoreksi**. Kalau objeknya tak bisa
dikoreksi, keadaan akhir memang jawabannya dan backtest biasa sah.
