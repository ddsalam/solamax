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

## 3b · Aturan SALIN-SETORAN — angka hari TETANGGA diketik di tanggal ini

**Keadaan akhir: aturannya DUA ARAH.** Versi pertama hanya melihat `D−1` dan
menangkap **0 dari 1** kejadian nyata — yang tersalin ternyata nilai hari
BERIKUTNYA. Riwayat kegagalan itu dan bukti yang mengoreksinya dilipat di bawah.

> Untuk hari `D` yang **dinilai**: bila `|I(D) − H(D)| >` toleransi **dan**
> `I(D)` sama persis dengan `I(D−1)` **atau** `I(D+1)` → `setoran_tersalin`,
> **MERAH**.

**Hari yang ditandai adalah yang tak cocok dengan H-nya SENDIRI; tetangga hanya
memasok bukti ASAL-USUL angkanya.** Karena itu ia menyala di 08-07 dan **diam**
di 08-08 — tanpa aturan tambahan.

Tiga keputusan owner yang menyertainya:

1. **`D+1` = HARI INI tidak dibandingkan.** Setoran hari ini masih diisi, jadi
   nilai yang kebetulan sama sesaat akan menyalakan alarm lalu padam. Biayanya
   nol: pada kasus yang kita punya `D+1` adalah kemarin. ⚠️ Pengecualian ini
   ditegakkan **di dalam `adminStatus`**, bukan dititipkan ke empat pemanggil —
   aturan yang harus diingat empat kali akan dilupakan sekali.
2. **F & G bukan pemicu terpisah, melainkan BAGIAN DARI PESAN**
   (`AdminVerdict.komponenIkut`). Nilai diagnostiknya dapat, risiko
   positif-palsunya nol, dan tak ada ambang baru yang harus dibela — F/G identik
   antar hari bisa sah (biaya tetap harian), dan basisnya 0 dari 102 pasangan
   memang belum cukup untuk pemicu sendiri.
3. **Tetap MERAH walau buktinya hanya `D+1`**, meski secara kronologi tetangga
   itu diketik belakangan.

**Waktu evaluasi tidak berubah — dan tak perlu berubah.** Tak ada vonis yang
disimpan: `adminStatus` dihitung saat render dari data saat itu juga, jadi `D`
memang **sudah** dinilai ulang setiap kali `D+1` bertambah. Biaya query: papan
Ketaatan & feed anomali **nol** (deretnya sudah rapat), Rincian & Laporan
**+1 kelompok** query kecil masing-masing.

**Terbukti pada data produksi:** penjaga hidup `dua-arah.integration.test.ts`
menjalankan jalur produksi atas 102 pasangan dan mengasersikan **1 kasus nyata**
(Batu Layang 08-07) → `setoran_tersalin`.

⚠️ Sejak kasus itu dikoreksi (2026-08-09 18:31) penjaga tersebut **hijau dengan
NOL kasus**. Ia mencetak jumlah kasus yang benar-benar diasersikan justru untuk
ini: **papan yang sepi bukan bukti aturannya bekerja — ia hanya bukti tak ada
salinan tersisa hari ini.** Yang memikul beban pembuktian tetap fixture bernama
di `compliance.test.ts`. Jangan hapus penjaga itu saat ia 0 kasus, dan jangan
naikkan ia jadi "bukti" saat kebetulan punya kasus.

### ⚠️ Lubang F & G — LATEN, dan syarat yang MEMBANGUNKANNYA

`komponenIkut` hanya bicara ketika aturan `I` menyala. Tapi aturan itu dijaga
`kode !== "selaras"` — dan **syarat yang sama mematikan `komponenIkut` tepat saat
ia paling dibutuhkan.**

Bangunkannya begini: seseorang memperbaiki **hanya `I`** agar cocok dengan `H`
yang **sudah salah**. Setoran selalu dibulatkan ke ribuan, jadi ia mendarat di
dalam toleransi dengan mudah → hari itu **selaras, hijau**, sementara F dan G
masih milik hari lain. Rekonsiliasinya konsisten-dengan-dirinya-sendiri,
komponennya keliru, dan **tak ada yang bersuara**.

Basis data historis: **0 dari 102** pasangan (F&G identik sementara `I` sudah
beda). Laten — **dan tetap laten**.

> **Sebuah lubang yang laten dalam data historis bisa DIBANGUNKAN oleh tindakan
> perbaikan yang kita rencanakan sendiri.** Mengukur laju kejadian pada data masa
> lalu tidak memberi tahu apa pun tentang keadaan yang akan kita CIPTAKAN.

**Keputusan owner 2026-08-09: JANGAN tutup dengan kode.** Instruksi koreksi
menyebut **ketiga** angkanya, dan owner memverifikasi hasilnya di layar dengan
memeriksa **ketiga nilainya, bukan warnanya**. Skenario itu ditutup oleh **orang**,
bukan oleh aturan yang laju positif-palsunya belum terukur.

Uji nyata pertamanya **lulus**: Batu Layang 2026-08-07 dikoreksi lengkap
(F → 0 · G → 40.600.000 · I → 241.297.000; H 241.296.190, selisih Rp 810).
⚠️ **Jangan baca hasil baik itu sebagai bukti lubangnya tertutup.** Ia tidak
terjadi karena **instruksinya menyebut ketiga angkanya** — bukan karena ada
penjaga.

<details><summary>Riwayat: bagaimana aturan satu arah gagal, dan apa yang membuktikannya</summary>

### ⛔ KOREKSI 2026-08-09 — ATURAN INI BUTA TERHADAP ARAH SEBALIKNYA

**Ditemukan owner pada tinjauan kedua, sebelum #240 di-merge.** Yang tertulis di
bawah garis ini menggantikan klaim "SUNYI · 10,19 jam-alarm · 0 dari 14" yang
sempat ada di sini. Klaim itu **tidak salah hitung — ia menjawab pertanyaan yang
lebih sempit dari fenomenanya**, lalu dilaporkan seolah menjawab yang penuh.

Aturannya membandingkan `I(D)` dengan `I(D−1)` saja. Pada kejadian nyata,
**yang tersalin adalah nilai hari BERIKUTNYA** — dan aturannya tak bisa
melihatnya. Pemindaian yang melaporkan nol pun nol karena **alasan yang sama**,
bukan karena bersih.

**Batu Layang, hidup di produksi saat ini ditulis:**

| bd | F | G | I | H | vonis |
| --- | ---: | ---: | ---: | ---: | --- |
| 08-06 | 55.000.000 | 3.665.050 | 335.496.000 | 335.495.143 | selaras ✓ |
| **08-07** | 103.478.000 | 40.608.000 | **483.803.000** | 344.766.190 | **+139.036.810** |
| 08-08 | 103.478.000 | 40.608.000 | **483.803.000** | 483.802.542 | selaras ✓ |

Ketiga nilai manual **identik persis** antara 08-07 dan 08-08. Angkanya milik
08-08 (di sana ia cocok sampai Rp 458); ia juga terisi di form 08-07.

**Pemindaian ULANG, tanpa arah** (`2026-06-01 … 2026-08-08`, 7 unit):

| | |
| --- | ---: |
| pasangan hari berurutan diperiksa (kedua hari ber-setoran) | **102** |
| pasangan dengan `I` identik | **1** |
| **tertangkap aturan yang sekarang tayang** | **0** |
| **TERLEWAT (hanya terlihat dari arah mundur)** | **1** |
| pasangan yang F **dan** G ikut identik | **1** |

**Nol dari satu.** Satu-satunya kejadian di seluruh jendela tidak tertangkap.

### Jejak audit — dan temuan yang lebih buruk dari "terlewat"

`created_at`/`voided_at` menunjukkan urutan sebenarnya. Pada **2026-08-09**:

| waktu WIB | yang terjadi |
| --- | --- |
| 12:08–12:11 | **08-07 DISUNTING**: F 0 → 103.478.000 · G 40.600.000 → 40.608.000 · setoran 241.297.000 **di-void**, diganti 483.803.000 |
| 12:12–12:14 | **08-08 DIBUAT** dengan ketiga nilai yang sama persis |

Rekonstruksi dari jejak itu (E = A − (B+C+D) murni EasyMax, tak tersentuh
suntingan, = 281.896.190):

```
H 08-07 SEBELUM disunting = 281.896.190 + 0 − 40.600.000 = 241.296.190
I 08-07 SEBELUM disunting =                                241.297.000
selisih                   =                                        810  → SELARAS
```

> **08-07 tadinya BENAR. Suntingan itu yang merusaknya.** Ini bukan hari yang
> salah lalu diperbaiki; ini hari yang benar lalu ditimpa angka hari lain.

**Paparannya bukan "terlambat berhari-hari":** saat 08-07 dirusak (12:11), 08-08
belum punya baris sama sekali — jadi tak ada arah mana pun yang bisa berbunyi.
Deteksi mundur akan menyala **12:14**, tiga menit kemudian, begitu 08-08 masuk.

### Dan `I` saja tidak cukup — F & G ikut tersalin

Kalau nanti hanya `I` yang diperbaiki agar cocok dengan H yang **sudah salah**,
hari itu akan terbaca **selaras** padahal F dan G masih milik hari lain.
Rekonsiliasinya konsisten-dengan-dirinya-sendiri, komponennya keliru. Pada data
sekarang kasus itu **belum terjadi** (0 dari 102 pasangan yang F&G identik
sementara I sudah beda) — ia **laten**, dan menjadi nyata pada perbaikan
berikutnya.

</details>

### Pemasangan tetangga ada di SATU tempat

`pasangkanTetangga()` di `compliance.ts` — mengembalikan **kedua** sisi (D−1 &
D+1), dipakai papan Ketaatan, feed anomali, Rincian, dan Laporan; bukan disalin
ke masing-masing. Prasyaratnya: deret **rapat &
menaik** per unit (kedua query pemasoknya memakai `generate_series`). Halaman
Ketaatan mengambil **`DAYS + 1`** hari dan membuang yang tertua dari tampilan:
tanpa benih itu, sel terkiri tak pernah bisa diperiksa — lubang yang bergeser
satu hari tiap hari, jadi tak akan pernah ada yang menyadarinya.

---

## 3c · Hilir vonis — cek alarm Laporan Operasional (U1)

Disambungkan 2026-08-09. `setoranCheck()` di `laporan-model.ts` **menerjemahkan**
vonis jadi `AlarmCheck`; ia **tidak memutuskan apa pun**. Pembuat vonis tetap
satu: `adminStatus`.

**Semua vonis bernada `pending` → `na`, SENGAJA bukan `provisional`.**
`provisional` membuat nada skor jadi `warning`, dan hari yang memang belum bisa
dinilai tak boleh terlihat seperti kabar buruk — kesalahan kanal yang sama dengan
`note.tone` dua-nilai di Rincian. `config_hilang` juga `na`, bukan `fail`: di
papan Ketaatan ia merah karena di sana ia satu-satunya suara untuk "indikator
unit ini tak bisa dipercaya"; di sini menjadikannya `fail` akan menuduh pengawas
atas config yang belum diisi.

⚠️ **Halaman Laporan kini WAJIB mengambil TERRA (komponen B).** Sebelum ini ia
tak pernah mengambilnya. Tanpa B, `H = A − (B+C+D) + F − G` ter-hitung terlalu
**besar** dan setiap hari akan terlihat "kurang setor". Itu bukan kelengkapan
tampilan — itu syarat kebenaran angkanya.

**Dampak terukur sebelum disambungkan** (jendela **2026-07-27 … 2026-08-08**,
13 hari × 7 unit = **91 unit-hari**; kontrol: papan hari itu 10+7+43+31 = 91):

| sel | yang berubah |
| ---: | --- |
| 31 | tak ada apa-apa (tetap `na`) |
| 43 | penyebut +1 dan pembilang +1 — skor berubah, **nada tidak** |
| **17** | cek gagal baru → **nada skor memburuk ≥1 langkah** |

`setoran_tersalin` di jendela itu: **0**. Rinciannya di
[`session-notes/2026-08-09-u1-pengukuran-dan-usul-penjaga-yatim.md`](../../session-notes/2026-08-09-u1-pengukuran-dan-usul-penjaga-yatim.md).

### "Pengeluaran Sudah Disahkan" tetap N/A — dan itu keputusan

Yang tersimpan di `app.manual_entry` hanyalah bahwa baris pengeluaran **ada** dan
berapa nilainya. **Disahkan** pertanyaan lain: siapa yang menyetujui, kapan, atas
dasar apa. **Tidak ada satu pun kolom** yang menyimpan itu.

Menyambungkannya ke "ada barisnya" akan membuat cek ini **hijau** untuk
pengeluaran yang tak pernah disahkan siapa pun — hijau palsu yang lebih buruk
daripada `na` jujur, karena ia **menutup** pertanyaannya. Membukanya butuh kolom
persetujuan + panel pengesahan; belum ada gerbang ownernya. Dijaga tes.

---

## 3d · Isyarat di JALUR MASUK — mencegah, bukan mendeteksi

Ditambahkan 2026-08-09, setelah dua pengawas **di dua unit** mengetik angka hari
lain ke tanggal yang salah (Korek 08-07/08-06 · Batu Layang 08-07/08-08). Dua
kejadian dari dua orang bukan kecerobohan individu — **itu pola yang dihasilkan
antarmukanya.** Aturan deteksi menangkapnya SESUDAH; ini yang menyerang sebabnya.

Penyelidikan jalur masuk menemukan **tiga lapis**:

| lapis | keadaan | tindakan |
| --- | --- | --- |
| tanggal saat mengetik | hanya di kop lembar, ~110 baris di atas panel; `ManualEntryForm` tak menyebut tanggal sama sekali | ✅ **"Tanggal bisnis: …" tepat di atas kolom input** |
| hari sudah terisi | tak ada isyarat — menimpa hari yang benar terasa sama dengan mengisi hari kosong | ✅ **peringatan menyebut seksi & jumlah barisnya** |
| **default tanggal** | cookie "terakhir dibuka", write-through, umur 30 hari | ⛔ **SENGAJA TIDAK DISENTUH** |

### ⛔ Kenapa default-nya TIDAK diubah

Perilaku cookie itu **sengaja dibangun** pada arc topbar picker Juli: cookie
diturunkan jadi *last-used write-through* untuk memperbaiki dropdown yang
desinkron pada navigasi lunak. **Untuk navigasi, keputusan itu benar dan masih
benar.** Membatalkannya lewat pintu belakang akan memunculkan kembali bug itu.

> **Keputusan default yang benar untuk MEMBACA bisa jadi salah begitu
> permukaannya mulai MENULIS — yang berubah bukan keputusannya, melainkan
> konsekuensi kesalahannya.**

Jangan tulis ini sebagai "cookie-nya salah". Pelajarannya berlaku di luar proyek
ini: saat permukaan baca-saja mendapat kemampuan menulis, semua default yang
dipilih demi kenyamanan baca **wajib ditinjau ulang** — bukan dibatalkan.

### ⚠️ Nada KUNING, bukan merah — JANGAN "diperbaiki" nanti

Membuka hari yang sudah terisi adalah tindakan **SAH**: untuk membaca, atau untuk
mengoreksi. Merah di situ akan **berteriak serigala tiap hari dan mati dalam
sepekan** — kegagalan yang sama dengan alarm kas dorman.

Menyebut **nama hari** ("Sabtu, 8 Agustus 2026") juga bukan hiasan: itu isyarat
**kedua yang independen** dari angka tanggalnya, dan orang menangkap "kok Sabtu?"
lebih cepat daripada "kok 8?".

**Keadaan diamnya harus benar-benar diam** — `rincianTerisi: null` dan **nol
elemen peringatan** saat hari kosong. Diuji tersendiri, dan mutasi "peringatan
SELALU muncul" memerahkannya. `PanelIsyarat` wajib di `ManualPanel`: panel tanpa
tanggal adalah error type-check.

Diverifikasi owner **di layar, dua arah** (2026-08-09): Batu Layang 08-08 terisi
→ tanggal tebal + kotak kuning menyebut ketiga seksi; Adisucipto 07-28 kosong →
tanggal tampil, **nol** peringatan.

⚠️ **Mitigasi tidak menghapus mekanismenya.** Kalau kesalahan serupa muncul lagi
meski peringatan sudah ada, itu sinyal **mitigasinya tak cukup** — bukan bahwa
peringatannya gagal dipasang.

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

### Pengecualian gerbang tak boleh bersandar pada aturan di tempat lain

Gerbang arsip **G4** (`scripts/ci/check-arsip-g4.sh`) mengecualikan PR
**promosi** — siklus keduanya sudah dinilai pada PR ke `staging`, dan menuntut
label yang sama setiap kali akan menjadikannya **stempel refleks dalam sepekan**.

Pengecualiannya **sempit dengan sengaja**: `base = main` **saja tidak cukup —
`head` harus `staging`**. Tanpa syarat kedua, gerbang bisa dilewati hanya dengan
membuka PR langsung ke `main` dari branch fitur. Itu memang sudah dilarang aturan
repo — dan justru itu masalahnya:

> **Sebuah pengecualian tidak boleh bersandar pada aturan yang ditegakkan di
> tempat lain.** Aturan itu bisa berubah tanpa ada yang ingat gerbang ini
> bergantung padanya.

Dan pengecualiannya **diuji pada keadaan LOLOS**, bukan hanya keadaan tolak —
*pengecualian yang tak pernah dilihat bekerja adalah artefak yang sama dengan
label yang tak pernah dibuat.* (Terbukti mengubah hasil pada promosi #248: satu
berkas arsip, tanpa label, lolos.)

### Gerbang yang menuntut ARTEFAK harus memastikan artefak itu ada

Versi pertama G4 menuntut label `arsip-siklus-kedua` yang **belum pernah dibuat**.
Ia dibuktikan bisa MERAH lalu dinyatakan "terpasang" — padahal jalur HIJAU-nya
mustahil.

> **Membuktikan MERAH tanpa membuktikan HIJAU adalah setengah bukti, dan setengah
> yang hilang justru yang menentukan gerbangnya dipakai atau ditinggalkan.**

Instruksinya: gerbang yang menuntut artefak apa pun (label, secret, berkas, izin)
harus **memeriksa artefak itu ada**, memberi pesan gagal **terpisah** yang
menyebut cara membuatnya — menyamakan cacat gerbang dengan cacat PR membuat orang
mencari jalan pintas — dan keputusannya **keluar dari YAML** ke skrip yang CI dan
self-test sama-sama panggil, supaya "sudah terbukti hijau" jadi asersi atas kode
yang benar-benar berjalan.

### Snapshot sesi bisa BASI terhadap repo

Sumber yang ada **di depan mata** terasa otoritatif justru karena ia ada di depan
mata. Keluarga yang sama dengan `ingested_at` dan data yang bergerak di bawah
kaki: yang berbahaya bukan sumber yang jelas usang, melainkan yang **tampak
segar**. Sebelum menyatakan sesuatu tentang keadaan repo — terutama setelah merge
oleh orang lain — **baca dari `git`**, bukan dari yang terpampang di konteks.
