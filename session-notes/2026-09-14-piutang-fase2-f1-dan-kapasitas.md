# Piutang Fase 2 — F1 kesegaran, kapasitas staging, kanari backfill

Tanggal: 2026-09-14 · Worker: Claude Opus 5 · Branch `codex/piutang-0039-p3009`
(dari `origin/staging` @ `55f9324`).

⚠️ **Baca §0 lebih dulu: satu rahasia tercetak ke transkrip sesi ini.**

---

## 0 · KREDENSIAL TEREKSPOS — tindakan Dion

`gcloud scheduler jobs describe solamax-snapshot-unit-1 --format='yaml(... httpTarget.headers)'`
memulangkan header `x-snapshot-secret` **beserta nilainya**, sehingga nilai
`SNAPSHOT_TRIGGER_SECRET` (secret `solamax-warm-board-secret`, di-bind lewat
`deploy-backend.yml:136`) kini ada di transkrip sesi ini. Saya tidak memakainya
dan tidak mencetaknya ulang, tetapi aturan berhenti §6.4 berlaku:

> **Rotasi `solamax-warm-board-secret`, lalu perbarui header kedua Scheduler job
> yang memakainya** (`solamax-snapshot-unit-1`, dan `solamax-warm-board` bila ia
> memakai secret yang sama).

Pelajaran yang dapat dipakai ulang: `--format` yang menyebut `httpTarget.headers`
mencetak nilai header. Untuk memeriksa keberadaannya tanpa nilainya, pakai
`--format='value(httpTarget.headers.keys().list())'`.

---

## 1 · F1 — lubang kesegaran

### 1.1 · Dua premis serah-terima yang GUGUR (dan kodenya sudah menuliskannya)

**Premis A — "watermark polos akan menyala hampir sepanjang hari karena
sinkronisasi mirror berjalan berkala."** Tidak untuk `bppiut`/`bphut`. Keduanya
`skipUnchanged: true` (`table-config.ts:257-273`), dan `table-config.ts:57-60`
sudah menyimpulkannya sendiri:

> "`ingested_at` … berhenti di-refresh untuk baris yang tak berubah, dan itu
> memang diinginkan: `ingested_at` jadi **'kapan baris ini terakhir BERUBAH'**."

Cadence full-sync yang tidak mengubah apa pun tidak menggeser satu baris pun.
Ini **menguatkan** opsi 2, bukan melemahkannya.

**Premis B — implisit, bahwa probenya akan heuristik.** Ternyata bisa **eksak**.
Tidak ada jalur `DELETE` untuk kedua tabel — `sql.ts` hanya menghapus
`business_date`, `terra_resmi`, `delivery`, `tebus_*`. Baris tidak pernah hilang
dari mirror, jadi "keluar dari bucket tanggal D" hanya mungkin lewat `sbatal`
atau perpindahan `dtgl`, dan keduanya UPDATE ⇒ keduanya menggeser `ingested_at`.
⇒ **`ingested_at > T′` menangkap SELURUH perubahan sesudah cut.**

### 1.2 · Materialitas: satu rumus, empat bentuk

```
contrib(baris, D) = (sbatal = 0 AND dtgl <= D) ? njumlah · tanda(sjnsbp) : 0
Δ(baris)          = contrib(keadaan SEKARANG) − contrib(keadaan DI CUT)
```

Keadaan "di cut" diambil dari `app.saldo_pelanggan_source_bppiut/bphut` — potret
beku pada T′ yang memang sudah disimpan snapshot. Karena itu perpindahan tanggal
tertangkap dari **kedua** arah: sisi mana pun yang `dtgl <= D` menyumbang, sisi
lain jatuh ke 0.

| Bentuk | Hasil |
|---|---|
| insert | tak ada di cut ⇒ Δ = contrib sekarang |
| update nilai | selisih `njumlah`/`sjnsbp` |
| pembatalan (`sbatal` 0→1) | contrib sekarang 0 ⇒ Δ negatif |
| pindah tanggal melintasi D | salah satu contrib jatuh ke 0 ⇒ Δ ≠ 0, dua arah |
| **perubahan bertanggal masa depan** | contrib 0 di kedua sisi ⇒ **Δ = 0, banner DIAM** |

Berkas: [`scripts/piutang-f1/probe-freshness.sql`](../scripts/piutang-f1/probe-freshness.sql).

### 1.3 · Diuji DUA ARAH, dengan kejadian 13 September sebagai fixture

[`scripts/ci/check-piutang-freshness-probe.sh`](../scripts/ci/check-piutang-freshness-probe.sh),
berjalan di CI atas `postgres:16`:

- **Skenario A** mereproduksi koreksi mundur nyata: enam baris piutang masuk
  01:34 UTC (08:34 WIB) dan satu baris hutang 01:38 UTC (08:38 WIB), sesudah cut
  02:05 WIB. Probe memulangkan **piutang Rp 35.979.362** dan **hutang
  Rp 1.405.000**, dengan `perubahan_terakhir = 2026-09-13 01:38:05+00`.
- **Kontrol negatif** menuntut DIAM untuk: baris bertanggal 20-09 senilai
  **Rp 500.000.000**, pelanggan kelas `sjenis = 4`, dan seluruh baris yang tak
  berubah sejak cut.
- **Kontrol positif** menuntut 12 baris `bppiut` benar-benar terlihat sebelum
  "nol baris" boleh dibaca sebagai "tidak ada perubahan". Gerbang ini sudah
  membuktikan dirinya: percobaan pertama memulangkan kosong **karena scope RLS
  belum dipasang**, bukan karena tidak ada perubahan — [[nol-rls-bukan-fakta]]
  dalam satu percobaan.

### 1.4 · Batas yang WAJIB ikut ke layar

`pelanggan_master` tidak punya `ingested_at` (`table-config.ts:276-281`). Probe
ini **tidak** melihat perubahan **klasifikasi master**: pelanggan yang `sjenis`-nya
berubah (mis. 1 → 4) berpindah bucket tanpa satu baris `bppiut`/`bphut` ikut
berubah, dan probe akan diam. Klasifikasi memakai potret master **di cut**, sama
seperti yang dipakai snapshot.

### 1.5 · Yang SENGAJA belum dikerjakan: memasangnya ke jalur baca

Perintahnya berbunyi "**ukur dulu, baru bangun**", dan akses DB produksi
diblokir classifier untuk sesi ini (`cloud-sql-proxy` ditolak). Maka:

- probe + gerbang semantiknya **sudah** ada dan hijau;
- pemasangan ke `pendingBanner()` **belum** dilakukan;
- blok pengukuran siap jalan ada di
  [`scripts/piutang-f1/measure-cost.sql`](../scripts/piutang-f1/measure-cost.sql).

**Yang diputuskan pengukuran itu**: `bppiut` dan `bphut` **tidak punya indeks
atas `ingested_at`** (schema.prisma:424-426, 444-446 — hanya `(unit_id, dtgl)`
dan `(unit_id, ckdplg)`). Tanpa indeks, probenya seq-scan 2.134 MB. §3 blok itu
membaca `pg_stats.correlation` untuk memutuskan bentuk indeksnya:

- **BRIN** atas `ingested_at` — puluhan KB, nyaris nol beban tulis. Masuk akal di
  sini justru KARENA 74% bangkai: baris yang di-UPDATE mendarat di ujung heap
  membawa `ingested_at` terbaru, jadi korelasi fisiknya bisa tinggi.
- **btree `(unit_id, ingested_at)`** — perkiraan ~90 MB (bppiut) + ~17 MB
  (bphut), ikut ke setiap UPDATE **dan ikut ke gerbang 9 GB di §2**.

Angka ~90/~17 MB itu **perkiraan aritmetika, bukan pengukuran**.

---

## 2 · Akumulasi `staging` — laju, ruang, dan usul

### 2.1 · Mekanismenya, terbukti di kode

- Retirement + prune hanya dipanggil dari `SnapshotWorkerService.runOnce`
  (`snapshot-worker.service.ts:240-247`), lewat
  `collectRetiredSources` (`source-capture.service.ts:233-252`).
- `runOnce` hanya dipicu Cloud Scheduler `solamax-snapshot-unit-1`,
  **`5 2 * * *`** — sekali sehari.
- Alokasi cut-nya jauh lebih sering: piutang/hutang mengikuti **cadence master**
  (`sync.ts:1550-1552`), dan `masterIntervalMs` default **3.600.000 ms = 1 jam**
  (`config.example.json`). ⇒ **~24 cut/hari, dipensiunkan 1×/hari.**

Ini konsisten dengan pengamatan serah-terima (sequence 43–66 = 24 cut) dan dengan
insiden yang **sudah ditulis di kodenya sendiri** (`source-capture.service.ts:225-227`):

> "Observed 2026-09-12 on production: **7.2 GB of 9.66 GB** were staging rows
> from cuts that could never win, and no cut had ever been pruned."

### 2.2 · Ruang per cut

Satu cut menyimpan **salinan penuh** ledger unit itu: pelanggan 2.973 + bppiut
407.790 + bphut 300.257 = **711.020 baris**. Dari insiden 7,2 GB dibagi ~23 cut
mati ⇒ **≈ 310 MB per cut**, ≈ **7,4 GB per hari** yang menumpuk sampai sapuan
02:05 berikutnya — terhadap gerbang **9 GB** pada disk 9,66 GB.

⚠️ **310 MB/cut adalah angka turunan, bukan terukur.** Ia disimpulkan dari
kalimat 7,2 GB di komentar kode dibagi jumlah cut, bukan dari `pg_total_relation_size`.
Kueri yang menyelesaikannya ada di `measure-cost.sql §1`.

### 2.3 · Usul (TIDAK dijalankan — §6.3 milik Dion)

**Retirement harus berjalan sesering alokasi.** Yang paling murah dan paling
sedikit berubah: **pemicu kedua untuk `/snapshot-worker`, per jam**, bukan
mengubah kode.

Alasannya sudah ada di kodenya: retirement berjalan **SEBELUM**
`PUBLICATION_OPERATIONAL_GATE_SQL` (`snapshot-worker.service.ts:240-252`), dan
build-nya sendiri dibatasi jendela jam WIB. Jadi invokasi tambahan di luar
jendela **hanya memensiunkan, tidak membangun**. Puncak turun dari ~23 cut mati
menjadi 1–2 ⇒ dari ~7,4 GB menjadi ~0,3–0,6 GB.

⛔ **Yang tidak boleh jadi obat**: menaikkan `databaseReviewBytes`. Gerbang 9 GB
pernah membuntu melingkar dengan pembersihnya sendiri, dan kodenya sudah
membayar perbaikan itu sekali (`snapshot-worker.service.ts:241-244`). Menaikkan
pagarnya mengembalikan kelasnya, bukan menutupnya.

### 2.4 · Urutan yang mengikat untuk enam unit berikutnya

Saat ini **hanya agent unit 1** yang mengirim source cut — keputusan kanari
rollout, `2026-09-11-piutang-fase1-penutupan-arc.md` butir 2. Begitu agent enam
unit lain menyusul, akumulasi staging menjadi **7×** terhadap gerbang 9 GB yang
sama. ⇒ **§2.3 harus beres SEBELUM agent unit kedua dinyalakan**, bukan sesudah.

---

## 3 · Kanari backfill 7 hari (§2D) — diverifikasi, dan hasilnya: JANGAN dijalankan

Runbook [`2026-09-13-piutang-fase2-backfill-runbook.md:90-105`](2026-09-13-piutang-fase2-backfill-runbook.md)
menyiapkan `gcloud scheduler jobs update http solamax-snapshot-unit-1` dengan
body `{"unit_id":1,"backfill_days":7,"max_items":8}`. Diverifikasi terhadap
keadaan nyata:

1. **Body job sekarang** adalah `{"unit_id":1}` (base64 `eyJ1bml0X2lkIjoxfQ==`).
2. **Nilai yang diusulkan sama dengan default-nya**: `SNAPSHOT_BACKFILL_LIMITS`
   di `staging` adalah `defaultDays: 7`, `defaultItems: 8`
   (`snapshot-config.ts:29-35`), dan `snapshot-trigger.controller.ts:40-41`
   memakai default itu persis ketika field-nya tidak ada.
3. **Pada pilot hari ini field-nya bahkan tidak dikenal**: `origin/main` tidak
   punya `SNAPSHOT_BACKFILL_LIMITS` sama sekali, dan `parseUnitId`-nya
   (`main`) hanya membaca `unit_id` dan mengabaikan sisanya — jadi mengirimnya
   sekarang **inert**, tidak merusak, tetapi juga tidak berefek.

⇒ **Kanari 7 hari unit 1 tidak memerlukan perubahan Scheduler sama sekali.**
Yang menggerbangi kanari adalah **promosi #358 ke `main`**; begitu itu terjadi,
body `{"unit_id":1}` yang sudah terpasang langsung berarti 7 hari / 8 item.
Menjalankan perintah itu tetap aman, tetapi ia mutasi tanpa efek — dan ia
menaruh taruhan pada pertanyaan "apakah `jobs update http` mempertahankan header
yang ada" tanpa imbalan apa pun.

> ✅ **Pertanyaan itu TERJAWAB 14-09-2026, dan jawabannya mahal.**
> `--update-headers` **MENGGANTI seluruh set header, bukan menambah**. Terbukti
> dua arah di job produksi: memasang `x-snapshot-secret` saja mengembalikan
> `Content-Type` ke default `application/octet-stream` (⇒ body tidak di-parse
> ⇒ 404 di pintu ⇒ **build 02:05 WIB hilang**); lalu memperbaiki `Content-Type`
> saja **menghapus** `x-snapshot-secret`. Naluri menolak mutasi tanpa imbalan
> itu ternyata benar — tetapi alasan yang saya tulis waktu itu ("taruhan")
> terlalu lemah; yang benar adalah **selalu sebut seluruh header sekaligus,
> lalu verifikasi**.

**Enam job unit lain**: tetap jangan dibuat. Agent keenam unit itu belum
mengirim source cut (§2.4), jadi pemicu worker tidak akan menemukan apa pun
untuk dibangun — dan §2.3 belum beres.

---

## 4 · Titik uji kedua 31-08-2026 (§2E)

Laporan EasyMax "DAFTAR SALDO HUTANG PIUTANG" per **31-08-2026** belum tiba.
Nonblocking; tidak ada yang dikerjakan atas namanya di sesi ini. Ketika tiba:
bandingkan per-pelanggan terhadap manifest 31-08 (generasi
`31f2f0cf-d5c3-4920-9496-1db61215d03c`, cut sequence 42), dan bila meleset
**periksa koreksi mundur lebih dulu** — probe §1 sekarang bisa mengukur suku itu
secara langsung, yang pada 13 September harus dikerjakan tangan.

---

## 5 · Keputusan yang saya ambil sendiri

| Keputusan | Alasan |
|---|---|
| Gerbang deploy dibangun atas `postgres:16`, bukan `:14` seperti diminta | Kedua instance Cloud SQL menjawab `POSTGRES_16`; `:14` menguji mesin yang tidak berjalan di tier mana pun. Job `snapshot-postgres-14` yang lama **tidak** saya ubah — itu keputusan Dion. |
| Probe F1 **tidak** dipasang ke jalur baca | "Ukur dulu, baru bangun", dan pengukurannya butuh DB produksi yang diblokir untuk sesi ini. |
| Preflight ditambahkan ke `.github/actions/prisma-migrate` | Menolak SEBELUM `migrate deploy` berarti tidak ada P3009 yang tertinggal — pada tier pilot biayanya jatuh di DB live. §0.3.3 menyebut berkas ini sebagai tempat perbaikan yang sah. |
| Migrasi `0039` **tidak** disunting | Ia tidak cacat (ralat Dion §2), dan `BEGIN;`/`COMMIT;`-nya menjaga atomisitas di bawah eksekutor apa pun. Penutup masalah keterbacaan galat adalah preflight, bukan membongkar transaksinya. |
| Perintah kanari §3 diverifikasi lalu **direkomendasikan tidak dijalankan** | Ia no-op; lihat §3. |

---

## 6 · Yang butuh jawaban Dion — dikumpulkan supaya bisa dijawab sekali jalan

1. **Rotasi `solamax-warm-board-secret`** (§0). Wajib, bukan opsional.
2. **Jalankan `scripts/piutang-f1/measure-cost.sql`** terhadap produksi
   (read-only, `ROLLBACK` di akhir) dan kirim keluarannya. Itu yang membuka F1
   ke jalur baca: ia memutuskan BRIN vs btree vs tanpa indeks.
3. **Jalankan `measure-cost.sql §1`** juga menjawab §2.2 (ruang nyata per cut).
   Sesudah itu: setuju/tidak dengan usul pemicu retirement per jam (§2.3)?
4. **Job `snapshot-postgres-14`**: pindah ke 16, jadikan matriks 14+16, atau
   biarkan? Produksi memakai 16; saya tidak mengubahnya sendiri.
5. **Kanari §3**: konfirmasi bahwa tidak menjalankan perintah Scheduler itu
   sesuai maksud Anda, dan bahwa gerbang kanari = promosi #358.
6. **Gerbang CI `G4 arsip`** akan **MERAH** pada PR ini: ia menambah berkas di
   `session-notes/`. Label `arsip-siklus-kedua` adalah tindakan pemilik
   ([[gerbang-pemilik-bukan-gerbang-pelaksana]]) — saya tidak memasangnya dan
   tidak mengakalinya. Lapor, tunggu.
