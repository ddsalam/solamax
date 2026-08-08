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

## 1 · Toleransi Rp 1.000 — aritmetika, bukan gaya

`|I − H| ≤ SETORAN_TOLERANSI_RP` (= 1.000).

**Kenapa bukan kesamaan eksak:** diukur atas 95 hari ber-setoran di 7 unit —
**95 dari 95** nilai setoran adalah kelipatan **persis** Rp 1.000 (bank menerima
slip bulat), sementara **0 dari 95** sama persis dengan H (H hampir selalu
berpecahan, mis. `…426,50`). Kesamaan eksak karenanya **mustahil secara
aritmetika**; `i === h` akan memerahkan **100%** hari.

**Kenapa 1.000 dan bukan angka lain:** itu **kuantum slip setoran** — diturunkan
dari data, bukan dipilih. 82 dari 95 hari jatuh di dalam ±1.000.

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
| **`shifts < SHIFT_TARGET`** | **hari LAMPAU yang shift-nya TAK PERNAH masuk** (agent mati / sync gagal) — H dirakit dari data yang tak akan pernah lengkap | pengawas dituduh atas kegagalan **pipeline** |
| **`hari_berjalan`** (tanggal = hari ini) | **H masih dirakit sepanjang hari** | selisih semu belasan–ratusan juta tampil sebagai temuan |

**Bukti untuk gerbang hari-berjalan** (dua pengamat, jendela berbeda, angka
identik): Korek 2026-08-07, **3 dari 3 shift**, `A` tidak bergerak sama sekali,
tapi **H turun 23.516.922 dalam 18 menit** (355.569.872 → 332.052.950) —
seluruhnya dari pertumbuhan C+D. `pelanggan_sale`/`voucher_sale`/`edc` punya
**watermark sendiri** dan tidak menunggu shift tutup.

⚠️ **`shifts >= 3` TIDAK berarti H sudah berhenti bergerak.** Itu dua pertanyaan
berbeda, dan gerbang shift hanya menjawab yang pertama.

**Hari kemarin dan sebelumnya tetap dinilai SEKETIKA** — itu kasus bergunanya,
dan biayanya nyaris nol karena jatuh tempo memang akhir H+1.

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

**Atestasi per-hari — blind spot 4,1%.** Hari dengan ≥1 baris di seksi mana pun
dianggap "pengawas sudah mengisi", jadi seksi kosong di hari itu dibaca **NIHIL**,
bukan terlewat. `app.manual_entry` memang tak bisa membedakan (dua-duanya nol
baris). Terukur: 5 dari 97 hari parsial (5,2%), satu di antaranya kehilangan
**setoran** sehingga tetap tertangkap merah → blind spot sejati **4 hari = 4,1%**.
Menutupnya butuh tombol "Nyatakan NIHIL" + migrasi.

**Gerbang `sqlcheck` TIDAK menjaga `main`.** Ia berjalan pada **push** ke
`staging`/`main`, bukan pada PR. Artinya SQL rusak tertangkap **sesudah merge,
sebelum deploy**: `main` **bisa** memuat commit ber-SQL rusak dengan deploy
terblokir. Pulih = **revert PR**. Cakupannya `apps/dashboard/**` +
`packages/shared/**` — **`apps/backend/**` tidak memicunya**, dan
`deploy-backend.yml` tak punya padanan, jadi SQL ingest tak dijaga gerbang
eksekusi-SQL mana pun.

**Ekor C/D belum terukur tuntas.** Diketahui: C+D masih tumbuh **setelah** ketiga
shift tutup (23,5 juta dalam 18 menit). **Belum diketahui:** apakah ia berhenti
sebelum akhir H+1 — kalau tidak, **gerbang jatuh tempo juga menilai terlalu
dini**. Sedang diukur oleh `.measure/` (launchd, tiap 15 menit).
⚠️ `ingested_at` **tidak bisa** dipakai mengukur ini: sapuan tier-2 agent menulis
ulang baris secara batch (7 tanggal bisnis berbagi stempel pada **detik** yang
sama). Ukur **NILAI**, bukan stempel tulis.

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
  (47 → 8 merah), gerbang hari-berjalan (0 berubah). Prediksi tanpa pengukuran
  sudah dua kali salah di sini, termasuk yang tandanya terbalik.
