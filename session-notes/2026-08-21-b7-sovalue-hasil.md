# B7 · `SOValue` — HASIL (21 Agustus 2026)

Segel: [`2026-08-21-b7-sovalue-segel.md`](2026-08-21-b7-sovalue-segel.md), commit
`6e03bea`, ditulis sebelum satu angka pun dibuka. Harness:
`apps/dashboard/src/lib/b7-sovalue.integration.test.ts` (`B7_LIVE_DB=1`).

## Kontrol yang membuat sisanya bisa dipercaya

`sisa` MENTAH hari ini **identik dengan tabel pra-registrasi T3 pada 10/10
tanggal, produk demi produk**. Datanya tidak bergeser sejak 10 Agustus; satu-
satunya yang berubah adalah B6. Tanpa kontrol ini, setiap "sembuh" di bawah bisa
berarti datanya yang berubah, bukan definisinya.

## Kelima prediksi — semuanya LOLOS

| | prediksi | hasil |
|---|---|---|
| **P1** | Solar sembuh 10/10; 2025-12-31 jadi 40.000 L | ✅ `sisa_macet` Solar = **16.000 L tepat di 10/10 tanggal**; aktif 2025-12-31 = **40.000** |
| **P2** | tepat EMPAT tanggal meleset, keempatnya dinamai | ✅ **2025-06-02 · 2025-06-30 · 2025-08-31 · 2025-12-31** — tak lebih, tak kurang |
| **P3** | enam kontrol negatif tetap eksak | ✅ 2025-01-31 · 03-29 · 03-31 · 09-30 · 12-01 · 2026-01-12 |
| **P4** | sumbu tanggal menjelaskan 1 dari 4 | ✅ tiga sisanya Dex, arah berlawanan |
| **P5** | D3 asset-neutral ⇒ bukan cacat gerbang | ✅ dibaca di `keuangan-laporan-model.ts:212-219` |

Bonus yang tak diprediksi: **BB-01 PREMIUM juga sembuh** — 1.120.000/1.152.000 L
seluruhnya `sisa_macet` ⇒ aktif 0, sama dengan sheet yang mengosongkannya.

## P5 terbukti di kodenya, bukan disimpulkan

```ts
const asset = (i.cashOnHand ?? 0) + i.inventoryValue + i.soValue
            + (i.piutangEasymax ?? 0) + (i.hutangPiutangNonEasymax ?? 0);
```

`inventoryValue` dan `soValue` berada di **jumlah yang sama**. D3 memindahkan Rp
77.436.414 dari satu ke yang lain ⇒ `asset` tak berubah ⇒ `assetKemarin` hari
berikutnya tak berubah ⇒ **`langkahHarian` tak tersentuh, dan tier gerbang tutup
hari tidak bisa salah karenanya.**

⛔ **Maka premis yang membuka tugas ini tidak berlaku.** B7 bukan cacat gerbang.
Yang benar-benar menggerakkan `asset` adalah D2 (Rp 105.074.482 pada **setiap**
tanggal) — dan D2 sudah diperbaiki B6.

## Ketiga tanggal Dex: buktinya menunjuk WORKBOOK, bukan SolaMax

Seluruh SO BB-08 pada jendela 2025-04 … 2025-10 **tertutup penuh**
(`ditebus = diterima`, sisa 0), dan `dtgltrm = dtgljam` pada **semuanya**
(`sumbu_beda` false 7/7). Pada 2025-06-02 dan 06-30 EasyMax tak punya satu liter
Dex pun yang menggantung; sheet mencatat 4.000.

**Dugaan** (belum terbukti, dan tak bisa dibuktikan tanpa workbook-nya): sheet
membawa SO `4034028304` (tebus 2025-05-02, diterima **2025-05-03**) lebih lama
dari semestinya — cerminan dari masalah SO-mati SolaMax sendiri, di sisi
seberang. Konsisten dengan ketiga tanggal, dan dengan 2025-12-01/2026-01-12 yang
**cocok** (bawaan itu sudah dibersihkan). **Konfirmasinya pekerjaan tim keuangan,
bukan pekerjaan kode.**

## Sumbu tanggal: apa yang benar-benar ada di data

`dtgltrm` vs `dtgljam` memang berbeda, tetapi **jarang dan selalu satu hari**:
6 dari 42 kiriman BB-07 pada 2025-12-20 … 2026-01-10. Pada 2025-12-31 tepat satu
kiriman 8.000 L punya `dtgltrm` 12-30 vs sistem 12-31 — **besaran dan tanggalnya
cocok, arahnya TIDAK**: memakai `dtgljam` tetap menempatkannya di dalam 12-31,
jadi hipotesis "`dtgltrm` vs `dtgljam`" **tidak menjelaskan D3**.

Yang tersisa sebagai kandidat: SolaMax menetto penerimaan **parsial** per SO
(`GREATEST(0, ditebus − diterima)`), sedangkan sheet tampaknya melepas SO hanya
ketika SO itu **tertutup seluruhnya** — persis dua sumbu §10.7. Itu **hipotesis**,
dan ia tidak dipaksakan sampai cocok: membuktikannya menuntut nilai sheet per SO
yang tidak ada di repo ini.

## ⛔ BERHENTI DI SINI, dan alasannya

Instruksi: *"kalau ternyata bukan sumbu tanggal, katakan itu dan berhenti."*
Tiga dari empat tanggal **bukan** sumbu tanggal, dan yang satu-satunya sumbu
tanggal **tidak mengubah `asset`**. Mengubah `getDoHarian` sekarang berarti
mengejar Rp 77 juta yang berpindah kantong di dalam jumlah yang sama, dengan
risiko merusak enam kontrol yang sudah eksak.

## Temuan sampingan yang mengubah artinya di PRODUKSI

`app.purchase_price` produksi **kosong (0 baris)**. Seluruh `harga_beli` pada
kesepuluh tanggal terbaca `null` ⇒ `SOValue` produksi hari ini **bukan angka yang
salah, melainkan tidak ada**. Perbandingan di atas seluruhnya pada **volume**;
sisi uangnya baru punya arti setelah harga beli diisi lewat Layar 3.

## Yang perlu keputusan owner

1. **Tutup B7 sebagai "bukan cacat gerbang"** dan turunkan prioritasnya, atau
2. tetap samakan sumbu SOValue ke "SO tertutup seluruhnya" demi kecocokan angka
   dengan workbook — **dengan menerima** bahwa itu tak mengubah gerbang, dan
   menempatkan keenam kontrol sebagai syarat lulus.
3. Ketiga tanggal Dex: minta tim keuangan memeriksa apakah workbook masih membawa
   SO `4034028304` sesudah 2025-05-03.

---

## ⛔ KEPUTUSAN OWNER 21 Agustus 2026 — B7 DITUTUP sebagai *bukan cacat gerbang*

Prioritasnya turun. Tiga alasan, ketiganya mengikat:

1. **Gerbangnya terbukti tak tersentuh.** D3 asset-neutral (`inventoryValue` dan
   `soValue` di jumlah `asset` yang sama), dan yang benar-benar menggerakkan
   `asset` — D2, Rp 105.074.482 pada **setiap** tanggal — sudah diperbaiki B6.
2. **Sisi uangnya belum ada di produksi.** `app.purchase_price` kosong ⇒
   `SOValue` produksi hari ini **bukan angka yang salah, melainkan tidak ada**.
   Menyamakan sesuatu yang belum dihitung adalah pekerjaan tanpa subjek.
3. **Pada tiga tanggal Dex, yang tampak salah justru workbook.** EasyMax nol liter
   Dex menggantung; sheet mencatat 4.000. Menyamakan SolaMax ke workbook yang
   keliru berarti **membuat angka yang benar jadi salah**, dan sesudahnya tak ada
   lagi yang bisa dipakai membandingkan.

### ⚠️ SYARAT YANG MEMBANGUNKANNYA — tanpa ini, "nanti" tak pernah tiba

B7 **wajib ditinjau ulang** ketika **harga beli sudah terisi** untuk unit yang
diuji (paket serah-terima, pekerjaan #2) — sebab baru saat itu `SOValue` punya
sisi uang dan perbandingan terhadap workbook berarti. Pemicunya konkret:

> `SELECT count(*) FROM app.purchase_price WHERE unit_id = <unit>` **> 0**
> untuk unit yang punya workbook pembanding.

Saat itu terjadi: jalankan ulang `b7-sovalue.integration.test.ts` (harness sudah
ada, `B7_LIVE_DB=1`), dan pakai **keenam kontrol negatif** — 2025-01-31 · 03-29 ·
03-31 · 09-30 · 12-01 · 2026-01-12 — sebagai syarat lulus, bukan sebagai harapan.

### Diserahkan ke tim keuangan (pekerjaan DATA, bukan kode)

**Periksa apakah workbook masih membawa SO `4034028304` sesudah 2025-05-03.**
SO Pertamina Dex 4.000 L, tebus 2025-05-02, **diterima penuh 2025-05-03** menurut
EasyMax. Bila workbook masih membawanya, itu menjelaskan ketiga tanggal Dex
sekaligus — dan ia adalah **cermin masalah SO-mati SolaMax di sisi seberang**.
Hanya orang yang memegang workbook bisa menjawabnya.
