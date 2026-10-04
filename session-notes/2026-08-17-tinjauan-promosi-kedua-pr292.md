# Tinjauan pra-promosi #2 — PR #292 `staging` → `main`

**17 Agustus 2026 · read-only · tidak ada yang saya ubah selama memeriksa.**
Saya **tidak** me-merge dan **tidak** menyetujui gerbang `pilot`.

## Ringkasan: DUA TEMUAN MENGHALANGI, keduanya soal siapa melihat apa

Bentuk promosinya memang jauh lebih ringan — **nol migrasi** (34 = 34, diff nol
baris), 15 commit, dan **hanya `apps/dashboard/src`** yang berubah. Tetapi "tak
ada risiko" memang bukan kesimpulan yang sah dari "tak ada migrasi", dan dua
butir yang Anda minta dibuktikan **membantah harapannya**.

| # | butir | hasil |
|---|---|---|
| 1 | apa yang berubah bagi pengawas | ⛔ **sidebar mereka TUMBUH 5 entri** |
| 2 | kelima rute tertutup bagi yang tak berhak | ⛔ **4 dari 5** — Layar 3 terbuka |
| 3 | `pastikanBarisDayClose` terhadap `solamax-pg` | ✅ aman; satu pelemahan tipe |
| 4 | ada yang berubah bagi `/ingest`? | ✅ **nol berkas** |

---

## ⛔ Temuan 1 — Layar 3 adalah SATU-SATUNYA rute tanpa gerbang baca

Diukur per-rute, bukan per-berkas (persis yang Anda minta):

```
keuangan/page.tsx                       gerbang-baca = 1
keuangan/sumber-data/page.tsx           gerbang-baca = 1
keuangan/unit/[code]/[date]/page.tsx    gerbang-baca = 1
keuangan/unit/[code]/[date]/input/…     gerbang-baca = 0   ← ⛔
keuangan/unit/[code]/tutup-hari/[date]  gerbang-baca = 1
```

**Akibatnya bukan teoretis.** `canInputKeuangan` di rute itu hanya mengisi
`bolehTulis`, dan `bolehTulis` hanya menyembunyikan **formulir** — panel-panelnya
merender tabelnya tanpa peduli. Jadi seorang **pengawas** yang membuka rute itu
melihat:

- harga beli per produk (dan marginnya terhadap harga jual),
- **buku kas besar & lima buku bank berikut SALDO-nya**,
- batch settlement EDC dengan bruto/neto/MDR,
- klasifikasi akuntansi tiap baris biaya.

### 🔴 KOREKSI PENTING — lubang ini SUDAH HIDUP DI PRODUKSI, bukan akan

Ditemukan relay saat memeriksa jangkauannya, dan saya salah menyebutnya
"temuan pra-promosi":

```
rute keuangan di origin/main : input/page.tsx  (satu-satunya)
gerbang baca di rute itu     : 0
sidebar di main              : "Input keuangan" — SUDAH ADA, terlihat semua peran
```

Jadi ini **bukan** soal URL yang bisa ditebak. **Lima belas pengawas punya
tautan yang berfungsi ke rute itu di sidebar mereka sejak promosi pertama.**
Ini **temuan produksi yang kebetulan ditemukan tinjauan pra-promosi** — dan
promosi kedua justru yang **MENUTUPNYA**, bukan yang membawanya.

#### Yang TERPAPAR hari ini jauh lebih sedikit daripada yang TERBUKA

Harus disebut dengan jujur, dan diperlakukan sama seriusnya: `purchase_price`,
`cash_ledger`, dan `edc_settlement` di produksi praktis **masih kosong** — belum
ada pemegang peran `keuangan` yang mengetik apa pun, dan `cash_account` hanya
punya baris untuk unit 2. Yang benar-benar dilihat pengawas hari ini kebanyakan
**tabel kosong** plus entri Rincian miliknya sendiri.

⛔ **Itu bukan alasan menurunkan derajat temuannya — itu alasan menutupnya
SEKARANG.** Begitu pekerjaan nomor 1 & 2 di paket serah-terima dimulai (harga
beli enam unit), halaman yang sama mulai menampilkan **margin per produk**
kepada orang yang tidak boleh melihatnya. Yang berubah **bukan kodenya,
melainkan isi tabelnya**. Lubang yang sama, hari yang berbeda, akibat yang
berbeda.

Pelajaran untuk saya: "belum ada datanya" adalah pernyataan tentang **hari ini**,
bukan tentang **lubangnya**. Menilai paparan dari isi tabel saat ini adalah
bentuk lain dari menilai penjaga dari fakta bahwa ia belum pernah berbunyi.

### Kenapa ini lolos — dan itu bagian yang lebih penting

Memeriksa **keberadaan** `canViewLaporanKeuangan` "di satu berkas" lulus.
Pertanyaan yang benar adalah **apakah SETIAP rute punya**. Penjaga yang
menghitung satu contoh tidak menjaga himpunan.

§10.13 sendiri sudah menutup pintunya di tingkat keputusan — ia menyebut
"saldo tujuh rekening **tidak terlihat oleh pengawas unit**" — dan **saldo yang
sama ada di Layar 3.** Jadi yang hilang **penerapannya**, bukan keputusannya.

**Diperbaiki** di PR terpisah, dengan penjaga baru yang **menemukan sendiri**
daftar rute dari sistem berkas: rute keuangan baru otomatis ikut dijaga tanpa
ada yang perlu ingat menambahkannya ke daftar.

---

## ⛔ Temuan 2 — sidebar pengawas TUMBUH lima entri

`Sidebar.tsx` menyatakan di docblock-nya: *"Menu IDENTIK untuk semua peran —
akses ditegakkan di SERVER."* Itu pilihan lama yang sah **selama setiap butir
menu bisa dibuka semua orang**. Sejak modul keuangan, tidak lagi:

```
Papan keuangan · Laporan harian · Sumber data · Tutup hari · Input keuangan
```

Lima entri baru, terlihat oleh **15 dari 21 pengguna produksi** yang berperan
pengawas. Sesudah Temuan 1 ditutup, kelimanya menjadi **tautan yang selalu 404**
bagi mereka.

### ⚠️ Ini butuh keputusan Anda, dan saya TIDAK mengambilnya

Menyembunyikan grup menu **membalik pilihan yang terdokumentasi**
("menu identik untuk semua peran"), jadi bukan milik saya untuk diputuskan.
Tiga bentuk yang mungkin:

1. **Sembunyikan grup Keuangan** bagi yang tak lolos `canViewLaporanKeuangan`.
   Paling bersih bagi pengawas; ongkosnya menu tak lagi identik, dan pilihan
   lama itu punya alasannya sendiri (satu bentuk untuk semua = lebih sedikit
   yang bisa salah).
2. **Biarkan terlihat**, terima 5 tautan 404. Jujur secara arsitektur, buruk
   secara pengalaman — dan tautan mati mengajari orang mengabaikan menu.
3. **Tampilkan tapi nonaktif** dengan keterangan singkat. Pola `href: null`
   sudah ada di sidebar untuk butir yang butuh unit; ini pemakaian keduanya.

Saya condong ke **(1)**, tetapi menunggu.

---

## ✅ Temuan 3 — `pastikanBarisDayClose` aman, dengan satu pelemahan tipe

Diperiksa dari `origin/staging`:

- `set_config('app.unit_ids', $1, true)` **mendahului** `INSERT` ✅
- `unitId` yang dipatoknya berasal dari `scope.requireUnit(code).unit_id` ✅
- `ON CONFLICT … WHERE app.day_close.status = 'open'` — baris tertutup tak
  tersentuh ✅
- `langkahHarian === null` ⇒ tidak menulis apa pun ✅
- `catch` tanpa `throw` — kegagalannya tidak menjatuhkan halaman ✅

⚠️ **Satu pelemahan:** tanda tangannya `unitId: number`, bukan `ScopedUnitId`.
Pemanggil hari ini benar, tetapi pemanggil **berikutnya** tak akan dihalangi
type-check — dan seluruh lapis tipe repo ini berdiri di atas janji "lupa
men-scope = error type-check". **Dikembalikan ke `ScopedUnitId`** di PR yang sama.

Catatan: melonggarkan tanda tangan **selalu** lolos type-check (tak ada pemanggil
yang pecah), jadi tak ada uji perilaku yang bisa menangkapnya. Yang menjaganya
hanya asersi teks — dan itu disebut apa adanya di tesnya.

---

## ✅ Temuan 4 — `/ingest` tidak tersentuh sama sekali

```
git diff --stat origin/main...origin/staging -- apps/backend apps/agent packages
→ (kosong)
```

Seluruh 15 commit hanya menyentuh `apps/dashboard`. Dan pemindaian nama tabel
yang diperluas ke `apps/backend/src` (PR #293) **hijau**: tak ada nama tabel
hantu di jalur ingest.

---

## Yang tetap belum terbukti

1. **Belum ada yang membuka layar-layar ini di peramban.** Kelima rute belum
   pernah dirender terhadap DB berpenghuni.
2. **`pastikanBarisDayClose` akan menulis ke `solamax-pg` pertama kali** begitu
   seseorang membuka Layar 4 di produksi. Bentuknya sudah diperiksa; hasilnya
   belum pernah terjadi.
3. Pemegang peran `keuangan` ada di produksi tetapi **belum pernah memakai**
   layar mana pun.
