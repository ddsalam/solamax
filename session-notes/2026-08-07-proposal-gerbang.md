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
