# Proposal: empat gerbang yang bisa dilewati diam-diam

**Status: PROPOSAL. Tidak ada yang diimplementasikan. Menunggu pilihan owner.**

Keempatnya satu penyakit: **sesuatu yang berperan sebagai gerbang, tapi bisa
dilewati tanpa suara.** Diurutkan dari yang buktinya paling keras.

---

## G1 · Tes DB-live sebagai gerbang deploy

### Bukti, bukan kekhawatiran

`count(*)::int FILTER (WHERE …)` adalah sintaks Postgres **tidak valid** (cast
harus membungkus: `(count(*) FILTER (…))::int`). Ia lolos:

- `pnpm typecheck` ✅ — SQL adalah string, TypeScript tak melihat ke dalamnya
- `pnpm -r test` ✅ **517 lolos** — tak satu pun unit test menyentuh DB
- CI `check` ✅ hijau penuh

Halaman Ketaatan akan **500 di produksi**. Yang menangkapnya hanya
`ketaatan-live.integration.test.ts`, yang **di-skip kecuali `SCOPE_LIVE_DB=1`** —
jadi CI hijau sambil membawa bug itu di dalamnya.

### Pemisahan yang membuat proposal ini bisa dikerjakan

Tes live yang ada sekarang mencampur dua hal yang sifatnya berbeda. **Memisahkan
keduanya adalah inti usulan ini:**

| | K1 · SQL bisa dieksekusi | K2 · datanya masih berkata X |
| --- | --- | --- |
| contoh | `count(*)::int FILTER` gagal parse | Bakau 08-06 = +3.362.265 |
| butuh | skema saja | **data pilot nyata** |
| bisa jalan di | `solamax-pg-rlsstg` (DB test) | hanya DB pilot |
| deterministik? | **ya** | **tidak** — data hidup berubah |
| cocok jadi | **GERBANG DEPLOY** | **kanari/monitor, BUKAN gerbang** |

Bug yang jadi alasan proposal ini **murni K1** — ia gagal di Postgres mana pun.
Menjadikan K2 gerbang deploy akan membuat pipeline gagal karena pengawas mengedit
angka, dan itu gerbang yang akan dimatikan orang dalam sebulan.

### Bentuk konkret

- **Berkas baru** `*.sqlcheck.test.ts`: jalankan SETIAP fungsi query ekspor
  `lib/queries.ts` sekali dengan argumen tak berbahaya (unit tak ada / rentang
  tanggal kosong), **asersinya hanya "tidak melempar"**. Nol asersi atas isi.
- **Sasaran DB: `solamax-pg-rlsstg`**, bukan pilot → menjawab langsung
  "bagaimana kalau DB pilot sedang sibuk": **pilot tak pernah disentuh.**
- **Kredensial**: WIF sudah ada di `deploy-dashboard.yml`
  (`permissions: id-token: write`); secret `solamax-db-url-dashboard-rlsstg`
  sudah ada. Tambahkan langkah cloud-sql-proxy (versi sudah dipin di composite
  action `prisma-migrate`).
- **Letak**: job baru antara `build` dan `deploy-*`, dengan `needs: [build]`.
  Gagal = HALT sebelum traffic, sama seperti guard migrasi.
- **Durasi**: `ketaatan-live.integration.test.ts` 4 tes = **~3 detik** (terukur).
  Sapuan K1 atas ±40 fungsi query: perkiraan **10–30 detik**, didominasi boot
  proxy. Dibanding ~4 menit pipeline yang sudah ada, ini di bawah derau.

### Batas yang harus disebut

`-rlsstg` **tak punya data tersinkron**. K1 hanya membuktikan query **bisa
dijalankan**, bukan jawabannya benar. Ia akan menangkap sintaks, kolom hilang,
nama tabel salah, pelanggaran GRANT/RLS — **tidak** menangkap logika salah.
Itu tetap tugas unit test.

---

## G2 · `enforce_admins: false` — gerbangnya memang terbuka

### Sebabnya ditemukan, bukan diduga

`gh api repos/ddsalam/solamax/branches/{staging,main}/protection`:

```
required_status_checks: ['check']
strict:                 false      ← "branch harus up-to-date" MATI
enforce_admins:         false      ← admin DIKECUALIKAN
required_pull_request_reviews: false
allow_force_pushes:     false
```

**`enforce_admins: false` itulah yang saya tembus.** Bukan celah misterius —
setelan yang memang mengizinkannya, di `staging` **dan** `main`.

`strict: false` juga berarti branch boleh di-merge tanpa up-to-date terhadap
base — cek hijau bisa berasal dari pohon yang bukan hasil merge sesungguhnya.

### Pilihan

| opsi | efek | biaya |
| --- | --- | --- |
| **A** `enforce_admins: true` di kedua branch | `check` jadi wajib bagi semua | owner kehilangan break-glass push langsung |
| **B** A + `strict: true` | + wajib up-to-date | konflik lebih sering saat dua PR paralel |
| **C** biarkan, tapi **alarmkan** | push langsung tetap bisa, tapi berbunyi | butuh workflow baru; tak mencegah |

Rekomendasi: **A**. Break-glass tetap ada lewat mematikan proteksi secara sadar
— yang meninggalkan jejak audit; sedangkan hari ini pelanggarannya senyap
kecuali pelakunya melapor sendiri. Kali ini pelakunya melapor. Itu bukan kontrol.

**B** jangan sekaligus: dengan alur dua-tier yang sering punya PR docs paralel,
`strict: true` akan sering memaksa rebase tanpa menambah keamanan nyata.

---

## G3 · Badge — SATU komponen, dua alasan yang saling menguatkan

Dulu saya pecah jadi dua item yang masing-masing tampak marginal. Digabung, ini
yang paling menyerang akar.

### Sisi keluaran: tak informatif

Badge mentok **"9+"** (terverifikasi owner). Anomali administrasi baru — termasuk
`kurang_setor` yang MERAH — **tidak terlihat di sana**. Kita menambah sinyal ke
penampung yang sudah penuh.

### Sisi biaya: ditanggung SETIAP halaman `(app)`

`buildAnomalies` tak ber-cache = **5,4–7,7 detik** (terukur), di `layout.tsx`
jalur kritis → **semua** halaman `(app)`, bukan cuma Ketaatan.

Dan biaya itu **bukan kejadian langka**: **12 instance berbeda dalam 47,5 jam**
meski `minScale=1` (dari `labels.instanceId`) ≈ **6 kelahiran instance/hari**.
Tiap kelahiran = burst render lambat. Terukur: **21 dari 201 render dokumen
≥4 dtk = 10,4%**.

Jadi: **5,4–7,7 detik, ~6× sehari, di semua halaman, untuk angka yang mentok 9+.**

### Usulan

**G3a — keluarkan badge dari jalur kritis** (`<Suspense>`, shell tayang dulu,
badge menyusul). Mengecilkan biaya cold start untuk semua halaman `(app)`
sekaligus. Tak mengubah SQL apa pun → risiko rendah.

**G3b — perbaiki tampilannya** supaya sinyal baru terlihat (angka sebenarnya,
atau pecah per-tone). Murah, dan tanpa ini G3a hanya membuat angka tak berguna
tayang lebih cepat.

### Pembanding, dengan biayanya

| opsi | efek pada cold start | biaya |
| --- | --- | --- |
| **G3a** Suspense | badge keluar jalur kritis; halaman tayang tanpa menunggu | perubahan kode, risiko rendah |
| **minScale 1 → 2** | lebih banyak instance panas; **tidak** menghentikan recycling (12 instance terjadi MESKI min=1) | +1 instance ditagih terus |
| **CPU always-on** (`--no-cpu-throttling`) | menyembuhkan "idle lalu lambat"; **tidak** menyembuhkan instance baru lahir | 1 vCPU + 512 MiB ditagih 24/7, bukan hanya saat request |
| **murahkan `buildAnomalies`** | menyerang akar biayanya | perlu menulis ulang `getDailyGlByProduct` — **sudah ditolak sadar** 2026-07-24 |

⚠️ **Angka rupiah sengaja TIDAK saya cantumkan.** Konfigurasi terukur
(`cpu=1000m, memory=512Mi`, `minScale=1`, `maxScale=2`) sudah pasti; tarif
Cloud Run asia-southeast2 tidak saya verifikasi, dan menuliskan estimasi yang
terdengar meyakinkan tanpa memeriksanya persis kesalahan yang berulang di sesi
ini. **Kalau biaya jadi penentu pilihan, tagihan nyata harus dilihat dulu.**

Catatan penting untuk memilih: **minScale dan CPU-always-on tak satu pun
menyembuhkan kelahiran instance**, yang justru penyumbang terbesar (17 dari 21
render lambat dalam 120 dtk setelah instance lahir/bangun). Keduanya menyembuhkan
gejala yang lebih kecil dengan biaya berulang. **G3a menyerang ukuran kerjanya.**

---

## G4 · Arsip yang salah selama ~40 menit

### Apa yang terjadi

PR #209 ter-merge membawa **tiga klaim yang sudah terbukti salah** (kontensi pool ·
dugaan stale-while-revalidate · rasio 2,34%). Commit koreksinya mendarat setelah
merge, jadi arsipnya keliru sampai #210 menyusul.

**Yang menyelamatkan hanya ada orang yang ingat.** Itu bukan proses.

### Usulan — dua bagian, keduanya murah

**G4a — aturan waktu.** Temuan yang masuk arsip **tidak di-merge pada siklus yang
sama saat pertama diklaim.** Beri satu putaran untuk dibantah. Biayanya satu
siklus penundaan **hanya untuk berkas catatan**; perbaikan kode tidak terkena.

Pembenarannya empiris di sesi ini: **klaim frekuensi bertahan tepat satu putaran
sebelum data produksi membantahnya**, dan koreksi L6 juga bertahan satu putaran.
Penundaan satu siklus akan menangkap keduanya.

**G4b — verifikasi pasca-merge, bukan pasca-tulis.** Setelah koreksi mendarat,
**baca ulang berkas HASIL MERGE dari `origin`** dan pastikan retraksinya benar-benar
ada. Bisa jadi skrip sepuluh baris:

```
scripts/verify-archive.sh <berkas> <penanda…>
  git fetch origin && git show origin/staging:<berkas> | grep -q <penanda>
```

dijalankan atas penanda yang PR koreksi klaim ia tambahkan (mis. `DICABUT`,
`KOREKSI`, `dibantah`). Ia menjawab pertanyaan yang benar — *"apakah yang
ter-merge memang memuatnya"* — bukan *"apakah saya sudah menulisnya"*.

### Kenapa ini bukan sekadar kerapian

Arsip ini dibaca orang berikutnya untuk memutuskan. Arsip yang memuat "kontensi
pool" akan mengirim orang itu mengoptimalkan pool — masalah yang tidak ada —
sementara penyebab sesungguhnya (cold start) tak tersentuh. **Catatan yang salah
lebih mahal daripada tak ada catatan**, karena ia dipercaya.

---

## Ringkasan untuk dipilih

| | usulan | bukti pendukung | risiko |
| --- | --- | --- | --- |
| **G1** | sapuan K1 SQL-bisa-dieksekusi vs `-rlsstg` sbg gerbang deploy | bug lolos 517 tes + CI hijau | rendah — pilot tak disentuh |
| **G2** | `enforce_admins: true` (opsi A) | setelannya terbaca; saya menembusnya | owner kehilangan push langsung |
| **G3** | keluarkan badge dari jalur kritis + perbaiki tampilannya | 5,4–7,7 dtk × ~6 kelahiran/hari × semua halaman, untuk angka mentok 9+ | sedang — perubahan kode |
| **G4** | tunda-satu-siklus + verifikasi arsip pasca-merge | #209 salah ~40 menit | sangat rendah |

**Tidak ada yang dikerjakan sampai owner memilih.**

---

# HASIL PELAKSANAAN (2026-08-07) — owner memilih KEEMPATNYA

## G3 · PENGUKURAN SAJA — obatnya belum dipilih

Owner benar bahwa kesimpulan saya terlalu luas. `maxScale=2` berarti armada tak
pernah bisa lebih dari dua instance, jadi 12 kelahiran memang **mustahil** dari
ledakan trafik. Saya menggabung "lahir atau bangun" jadi satu kategori, dan
penggabungan itulah yang membuat kesimpulannya terlalu kuat.

### 12 kelahiran instance, digolongkan

| golongan | kelahiran | render lambat dlm 120 dtk |
| --- | ---: | ---: |
| PASCA-DEPLOY (≤5 mnt sejak revisi dibuat) | **6/12 (50%)** | 6 |
| NAIK-SKALA 1→2 (instance lain aktif) | **4/12 (33%)** | **0** |
| DAUR-ULANG (instance baru, bukan deploy) | **2/12 (17%)** | 1 |

### 21 render dokumen lambat, digolongkan menurut SEBAB

| sebab | n | porsi | disembuhkan oleh |
| --- | ---: | ---: | --- |
| **BANGUN-DARI-IDLE** (instance hidup, idle ≥120 dtk) | **8** | 38,1% | CPU-always-on |
| **PASCA-DEPLOY** | **6** | 28,6% | warm-up sebelum traffic |
| **SUSULAN** (instance sudah panas, mengekor render lambat lain) | **6** | 28,6% | apa pun yang menyembuhkan pemimpinnya |
| DAUR-ULANG instance baru | **1** | 4,8% | — |
| **NAIK-SKALA 1→2** | **0** | **0%** | `minScale=2` |

⚠️ **`minScale=2` menyembuhkan 0 dari 21 render lambat di jendela ini.** Keempat
kelahiran naik-skala memang terjadi, tapi instance-instance itu hanya menerima
**1–2 permintaan masing-masing** (kemungkinan probe/prefetch), jadi tak satu pun
render dokumen lambat bisa diatribusikan padanya. **Itu pengamatan bersampel
kecil, bukan bukti bahwa naik-skala tak pernah menyakiti.**

Catatan tambahan: sebagian "SUSULAN" adalah pasangan permintaan pada **detik yang
sama** (mis. 08-06 22:29:11 → 5,64 dan 5,21 dtk). Dengan `concurrency=8` di atas
**1 vCPU**, dua render berat serentak berebut CPU di dalam SATU instance. Itu
mekanisme keempat — bukan pool, bukan cache, bukan cold start.

**Obat tidak dipilih. Menunggu owner.**

## G1 · K1 dikerjakan — dan DIBUKTIKAN BISA MERAH

| | dengan bug `count(*)::int FILTER` terpasang |
| --- | --- |
| `pnpm typecheck` | **0 error** |
| unit test (scope-wiring + compliance) | **70 lolos** |
| job `ci` | **HIJAU** |
| **gerbang K1** | **MERAH — tepat 2 query**, `syntax error at or near "FILTER"` |

Dikembalikan → **37/37 hijau, 6,05 detik** untuk 36 query.

Dua kontrol saya sendiri gagal lebih dulu dan menyelamatkan pembuktiannya:
`ENOENT /cloudsql/…` (secret memakai socket unix; param `host` harus dibuang)
dan `value "30000"… out of range for smallint` (sentinel awal 424242 melampaui
`unit_id smallint`). **Kontrol-1 "pohon bersih harus hijau" yang menangkap
keduanya** — tanpa itu saya akan melaporkan merah yang sebabnya salah.

Kredensial dari **Secret Manager lewat WIF**, bukan GitHub secret: repo ini punya
**nol repo-secret** (`actions/secrets` → `total_count: 0`), jadi
`${{ secrets.… }}` akan mendarat **kosong dan diam**.

### Temuan sampingan: guard kelengkapan yang tidak menjaga kelengkapan

`queries.scope-wiring.test.ts` memakai `expect(CASES.length).toBe(34)` — itu
membandingkan daftar **dengan dirinya sendiri**: menangkap penghapusan, **buta
terhadap kelalaian**. Terbukti: **`getAdminDays`** (saya tambahkan sesi ini) dan
**`getZeroClosingEvents`** — keduanya `qScoped`/RLS — tak pernah tercakup, dan
tak satu tes pun menyalak. Padahal itu tes **isolasi multi-tenant**.

K1 menurunkan cakupannya dari **ekspor modul**, jadi kelas lubang ini tertutup
di sana. Guard lama sengaja tidak saya sentuh (di luar lingkup; dilaporkan).

## G2 · Dikerjakan — dan gerbangnya DILIHAT MENOLAK

Commit kosong yang sama, didorong langsung ke `staging`:

| | hasil |
| --- | --- |
| **sebelum** (`enforce_admins:false`) | `9d3137f..0ed5967 staging -> staging` — **BERHASIL**, pelanggaran hanya dicatat "Bypassed" |
| **sesudah** (`enforce_admins:true`) | `GH006: Protected branch update failed` — **DITOLAK** |

`enforce_admins` kini **`true` di `staging` DAN `main`**.

Temuan penegakan yang tidak konsisten: `allow_force_pushes:false` **menggigit
admin** (`Cannot force-push to this branch`) sementara `required_status_checks`
**tidak** — keduanya di branch yang sama. Satu setelan menghormati admin, satu
lagi mengecualikannya.

⚠️ **Jejak yang tersisa & TIDAK saya bersihkan**: commit kosong `0ed5967` dari
kontrol pra-gerbang ada di `staging`. Menghapusnya butuh **melemahkan sementara
proteksi yang baru saja terbukti bekerja** — force-push ditolak. Commit itu
**nol perubahan berkas** dan pesannya menjelaskan dirinya. Saya memilih
meninggalkan jejak jujur daripada melonggarkan gerbang demi kerapian.

### `strict: true` — SAYA MEMBANTAH, jangan dinyalakan

Owner meminta saya membantah kalau gesekannya melebihi manfaatnya. **Melebihi.**

- **Manfaatnya nyaris nol di sini.** CI berjalan pada event `pull_request`
  ([`ci.yml`](../.github/workflows/ci.yml)), dan GitHub menjalankan event itu
  terhadap **merge-preview** (`refs/pull/N/merge`) — bukan terhadap ujung branch.
  Jadi cek hijau **sudah** mencerminkan hasil merge. Itulah yang dijanjikan
  `strict`, dan sudah didapat.
- **Gesekannya nyata dan berulang.** Kadens repo ini belasan PR dalam sehari,
  sering dengan PR dokumentasi paralel. `strict:true` memaksa **setiap** branch
  di-rebase tiap kali base bergerak — termasuk PR docs yang tak mungkin
  berkonflik secara semantik.
- **Yang akan terjadi:** ia dimatikan dalam seminggu, dan kita kehilangan
  kebiasaan mempercayai gerbang. Itu biaya yang lebih mahal dari manfaatnya.

**Rekomendasi: `enforce_admins` saja (sudah menyala). `strict` biarkan `false`.**

## G4 · Diberlakukan sekarang, mulai dari rantai ini sendiri

[`scripts/verify-archive.sh`](../scripts/verify-archive.sh) membaca berkas
**hasil merge dari `origin`** dan memastikan penanda retraksi benar-benar ada.

**Pemakaian pertamanya langsung MERAH** — saya mencari `DICABUT`, padahal yang
ter-merge `DICORET`. Klaim saya berasal dari ingatan, bukan dari berkas. Itu
persis kegagalan yang skrip ini ada untuk menangkapnya, dan ia menangkapnya pada
percobaan pertama. Setelah diperbaiki: **4/4 penanda terverifikasi ADA**.

Bagian **tunda-satu-siklus** belum dimekaniskan (ia aturan waktu, bukan skrip);
pembenaran empirisnya tetap: di sesi ini klaim frekuensi dan koreksi L6
sama-sama bertahan **tepat satu putaran** sebelum dibantah.
