# Panduan Mesin SPBU Korek (KR, `6478311`) — Phase 2c

> **Dijalankan OLEH OWNER di PC server SPBU Korek** (via Chrome Remote Desktop).
> Cloud sudah SIAP & terverifikasi: unit `unit_id=6`, tenant
> `pt-mitra-indah-lestari-oil-pratama` (tenant ke-5), secret
> `solamax-korek-agent-key` v1 dengan hash **terbukti cocok** lawan `unit.api_key_hash`.
> Ikuti urut. **Ada 3 STOP-CHECK WAJIB (langkah 7, 8, 8b) — kirim hasilnya sebelum lanjut.**
>
> 🟢 Semua langkah ke EasyMax bersifat **READ-ONLY**. Satu-satunya perubahan di mesin =
> pembuatan user MySQL baca-saja (langkah 2) + Task Scheduler (langkah 11).
>
> ⚠️ **Korek unit LUAR KOTA (Kab. Kubu Raya)** — link bisa lebih lambat/putus-nyambung
> dibanding unit dalam kota. Agent memang **membuffer + retry**; backfill yang lambat
> atau log "backend offline → payload di-buffer" **bukan** kerusakan. Jangan restart
> agent karena itu; lapor saja kalau ragu.

---

## 1. Kenali mesin & pasang Node.js (5 mnt)

Klik kanan **This PC → Properties**, catat versi Windows + 32/64-bit.

| Windows di mesin                            | Node.js                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| Windows 10 / 11 / Server 2016+              | Node 18.20.4 LTS (`node-v18.20.4-x64.msi` / `-x86.msi`)    |
| Windows 7 / 8 / 8.1 / Server 2008 R2 / 2012 | Node 12.22.12 (`node-v12.22.12-x64.msi` / `-x86.msi`)      |
| Windows XP / Server 2003                    | ✋ **BERHENTI — lapor dulu.** (Rencana B: agent di PC lain.) |

Verifikasi di **Command Prompt baru**: `node --version` → harus keluar nomor versi.

## 2. User MySQL baca-saja (5 mnt)

### 2a. 🔴 CEK DULU nama database — JANGAN diasumsikan `easymax`

```sql
SHOW DATABASES;
```

**Nama DB berbeda per situs.** Di KR namanya **`easymax_korek`**, bukan `easymax`.
Catat nama persisnya; dipakai di GRANT (2c) **dan** di `config.local.json` (langkah 5).

> ⚠️ Kenapa ini langkah pertama: **MySQL menerima GRANT atas database yang tidak ada
> tanpa error.** Salah nama → user terbentuk dengan **nol hak efektif**, dan
> kegagalannya baru muncul jauh di hilir sebagai error yang membingungkan (seolah key
> atau provisioning rusak). Cek nama dulu, baru buat user.

### 2b. Cek user yang sudah ada (cegah akun tanpa password)

```sql
SELECT user, host FROM mysql.user WHERE user='readonly_sync';
```

Kalau sudah ada, catat `host`-nya dan **pakai host itu** di GRANT — jangan bikin baris
baru. Di MySQL 5.0, `GRANT` polos ke host yang belum terdaftar bisa **membuat akun
tanpa password**. Kalau belum ada, lanjut 2c.

### 2c. Buat user + GRANT ke DB yang BENAR

```sql
SET SESSION old_passwords = 0;
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'SPBU6478311';
GRANT SELECT ON easymax_korek.* TO 'readonly_sync'@'localhost';
FLUSH PRIVILEGES;
```

Konvensi password = `SPBU<kode unit>` → **`SPBU6478311`**. Hanya `SELECT`, tidak lebih.
Ganti `easymax_korek` bila `SHOW DATABASES` di situs lain menunjukkan nama lain.

## 3. Salin bundle ke folder LOKAL (3 mnt)

Bundle sudah di-build dari `main` yang dipromosikan (**`870f257`**):
`apps/agent/solamax-agent-bundle.zip` — **flat, 11 file**, 23:55 21-Jul-2026.

- Transfer ke mesin KR, **extract ke `C:\solamax-agent`**.
- ⚠️ **JANGAN taruh di folder yang di-sync Google Drive / OneDrive** — file lock saat
  sync bikin agent gagal tulis.
- Setelah extract, `C:\solamax-agent\solamax-agent.cjs` harus ada.

## 4. Ambil API key (di Mac owner, BUKAN di mesin SPBU)

Di Terminal Mac:

```bash
gcloud secrets versions access latest --secret solamax-korek-agent-key
```

Salin nilainya langsung ke `config.local.json` di langkah 5. **Jangan pernah tempel
key ini ke chat, email, atau file yang ter-commit.**

## 5. Isi `config.local.json` (3 mnt)

Buka `C:\solamax-agent\config.local.json` di Notepad, ubah **4 baris**:

| Baris | Dari | Menjadi |
| --- | --- | --- |
| `unitCode` | `"GANTI_KODE_UNIT"` | `"6478311"` |
| `mysql.database` | `"easymax"` | **`"easymax_korek"`** (dari langkah 2a) |
| `mysql.password` | `"GANTI_DENGAN_PASSWORD_readonly_sync"` | `"SPBU6478311"` |
| `backend.baseUrl` | `"https://dummy.invalid"` | `"https://solamax-ingest-staging-wn6i64kvza-et.a.run.app"` |
| `backend.apiKey` | `"dummy-belum-dipakai-sampai-fase-2"` | *(key dari langkah 4)* |

`timezone` biarkan `Asia/Pontianak`. Simpan.

## 6. Tes koneksi + dry-run (5 mnt)

Klik dua kali, berurutan:

1. **`1-tes-koneksi.bat`** → harus konek & sebut MySQL versi.
2. **`2-dry-run.bat`** → menarik payload semua domain **TANPA kirim**.

Kirim isi `output-tes-koneksi.txt` + `output-dry-run.txt`. Yang saya cek: view
`vw_jualplg`, `vw_usevouc`, `vw_edc3` ada, tiap domain berpayload, dan
**`sales.watermark_high`** (bukti silang untuk langkah 7).

---

## 7. 🛑 STOP-CHECK WAJIB #1 — Census DTGLJAM

Di **SQL Manager** (read-only):

```sql
SELECT COUNT(*) AS null_dtgljam FROM tr_djualbbm WHERE DTGLJAM IS NULL;
SELECT COUNT(*) AS total_baris   FROM tr_djualbbm;
```

**Kirim kedua angka.** Klasifikasi **saya** yang tentukan — jangan ditebak, sebab ini
yang memutuskan dipasang/tidaknya task bulanan:

- **Persentase kecil** (KB 4,14% · BL 8,84%) → **kelas IB/Bakau** → watermark
  inkremental jalan → **task bulanan TIDAK dipasang**.
- **≈semua baris NULL** → **kelas AS** → sales 100% lewat rescan 7-hari →
  **task bulanan `resync-bulanan.bat` WAJIB** (langkah 12).

Bukti silang independen dari langkah 6: kalau `sales.watermark_high` di dry-run berisi
timestamp nyata → watermark hidup → kelas IB/Bakau. Kelas AS **didefinisikan** oleh
watermark yang NULL permanen. Dua sinyal harus sepakat.

> ✅ **Hasil KR 2026-07-21 — DUA SINYAL SEPAKAT, klasifikasi DIKUNCI:**
> - Sinyal 1: **7.159 NULL / 103.794 total = 6,90%** (minoritas jelas; bandingkan
>   KB 4,14% · BL 8,84%).
> - Sinyal 2: `sales.watermark_high` = **2021-04-06T23:24:52Z** — watermark
>   inkremental NYATA & maju (kelas AS = NULL permanen).
>
> → **kelas IB/Bakau** → **task bulanan TIDAK dipasang** (langkah 12 dilewati).
> Riwayat KR mundur sampai setidaknya **2021** → backfill pertama panjang & senyap.

## 8. 🛑 STOP-CHECK WAJIB #2 — Probe ATG

```sql
SELECT COUNT(*) AS n_tangki_atg FROM vw_realtm;
```

- **> 0** (KB = 8, BL = 8) → ATG hadir → denah/tank-gauge live.
- **0 atau view tidak ada** → unit tanpa ATG (pola AS) → denah tangki **empty-state
  BY DESIGN**, `real_tank`=0, domain realtank tak pernah dispatch. **Bukan defect** —
  dicatat sebagai karakteristik unit.

> ✅ **Hasil KR 2026-07-21: ATG HADIR, 7 tangki.** `vw_realtm` = 7, dikonfirmasi
> end-to-end oleh payload dry-run `realtank` = 7. Denah/tank-gauge KR **live**.
> Catatan: KR punya **7** tangki, bukan 8 seperti BL/KB — jangan salin angka antar unit.

## 8b. 🛑 STOP-CHECK WAJIB #3 — Identitas unit (RED FLAG bila beda)

```sql
SELECT * FROM tm_konfid;
```

> ⚠️ Tabel identitas SPBU di EasyMax bernama **`tm_konfid`** — **bukan** `tm_spbu`
> (`tm_spbu` TIDAK ADA; itu tebakan salah yang sempat masuk runbook BL). Pipeline
> **tidak pernah** membaca identitas unit dari EasyMax — `unitCode` murni dari
> `config.local.json` — jadi ini **cek-silang manual** bahwa mesin ini benar unit yang
> saya provision di cloud.

Yang dicocokkan — **dengan bobot bukti yang BERBEDA**:

- `CSPBU` = **64.783.11** — **DECISIVE.** Beda = STOP, tanpa kecuali.
- `VCNAMA` — *idealnya* nama PT (`PT. MITRA INDAH LESTARI OIL PRATAMA`), yang akan
  mengonfirmasi keputusan tenant dari sisi POS. Tapi banyak situs mengisinya dengan
  **nama stasiun**; itu **tidak konklusif**, bukan kontradiksi.
- `VCALAMAT` / `CKOTA` — sering kosong/kasar. **Corroborating saja**, tak pernah decisive.

Kalau ada yang beda — **BERHENTI dan lapor**, jangan "diperbaiki" diam-diam
(cloud sudah ter-provision dengan kode + PT ini).

> ⚠️ **Cek ini bisa TIDAK KONKLUSIF — dan itu bukan kegagalan.** `tm_konfid` diisi oleh
> admin POS situs; banyak situs tidak memeliharanya. Yang **decisive** hanya `CSPBU`.
>
> ✅ **Hasil KR 2026-07-21 (adjudikasi owner):**
> - `CSPBU` = **64.783.11 — COCOK PERSIS** (decisive → mesin ini benar unit KR).
> - `VCNAMA` = **"SPBU KOREK"** — nama stasiun, **bukan** nama PT. Tidak membantah
>   apa pun; hanya tak memberi konfirmasi.
> - `VCALAMAT` kosong; `CKOTA` = "PONTIANAK" (field legacy kasar).
>
> **Konsekuensi yang dicatat jujur:** tenant KR (`pt-mitra-indah-lestari-oil-pratama`)
> bersandar pada **pernyataan owner saja** — sama seperti KB & AS, dan **berbeda dari
> BL** yang tenant-nya terkonfirmasi POS lewat `VCNAMA = PT. BATU LAYANG JAYA`.
> Ini **bukan** red flag; ini tingkat bukti yang lebih rendah, dan direkam apa adanya.
>
> **JANGAN menulis ke EasyMax** untuk "memperbaiki" `tm_konfid` — read-only bersifat
> mutlak; itu pekerjaan admin POS situs, di luar pipeline ini.
>
> Alamat di `config.ts` tetap memakai **alamat vault** (Jl. Trans Kalimantan, Desa Korek,
> Kec. Sungai Ambawang, Kab. Kubu Raya, 78393). `CKOTA` "PONTIANAK" dicatat sebagai
> karakteristik field legacy, **bukan** konflik data.

> **Tunggu konfirmasi saya setelah langkah 7 + 8 + 8b sebelum lanjut ke 9.**

---

## 9. Backfill penuh (~1–1,5 jam, bisa lebih lama di link luar kota)

Klik **`3-sync-once.bat`**, biarkan jalan sampai selesai.

- ⚠️ **Tidak mencetak apa pun sampai node exit** — jangan dikira hang.
  Progres saya pantau dari DB live, bukan dari console.
- `logs\agent-<tgl>.log` **hanya** ditulis `jalankan-agent.bat`, bukan sync-once.
- Link KR lebih lambat → wajar kalau lebih lama dari BL. Buffer + retry sudah built-in.

## 10. Sweep satu-kali (setelah backfill selesai)

Buka **Command Prompt**, `cd C:\solamax-agent`, jalankan berurutan
(ganti `<hari-ini>` dengan tanggal hari itu, format `YYYY-MM-DD`):

```bat
node solamax-agent.cjs --resync-sales 2025-01-01 <hari-ini> --config config.local.json
node solamax-agent.cjs --deep-sweep tebus 730 92 --config config.local.json
node solamax-agent.cjs --deep-sweep delivery 730 92 --config config.local.json
```

(`730` = konvensi BL, cukup untuk riwayat KR yang mundur sampai 2021.)

## 11. Task Scheduler (loop kontinu)

- Action: `C:\solamax-agent\jalankan-agent.bat`, **Start in**: `C:\solamax-agent`
- **Run whether user is logged on or not** + **Run with highest privileges**
- Trigger: **At startup**
- ⚠️ Kalau akun Windows **password-nya blank**, Windows **menolak** opsi
  "whether logged on or not". Fallback: **"Run only when user is logged on"** +
  trigger **"At log on"** + launcher VBS hidden (minta saya kalau kena ini).
- Setiap kali bundle di-swap: **End task → kill `node.exe` → Run**.

## 12. Task bulanan — HANYA bila census langkah 7 = kelas AS

Kalau (dan hanya kalau) census menunjukkan ≈semua NULL:

- Task **`SolaMax Resync Bulanan`** → `C:\solamax-agent\resync-bulanan.bat`
- Monthly, hari **1**, jam **03:30 WIB**. Aman berbarengan dengan loop
  (read-only + UPSERT idempoten).

Kalau census = kelas IB/Bakau → **lewati seksi ini**, saya konfirmasi dulu.

## 13. Gold-check — oracle EasyMax (Phase 3)

Setelah sync berjalan ≥1 hari penuh. **Saya kirim daftar tanggal eksplisit dulu**
(dirancang sebagai eksperimen terkontrol: campuran tanggal yang total hariannya
berakhir `.5` dan `.0`), lalu jalankan di **Command Prompt**:

```bat
cd C:\solamax-agent
node solamax-agent.cjs --probe10 <tgl1> <tgl2> <tgl3> <tgl4> <tgl5> <tgl6> <tgl7> --config config.local.json
```

- ⚠️ **Tanggal WAJIB ditulis eksplisit** — tanpa argumen, probe memakai tanggal
  **beku Juni 2026** dan hasilnya tak berarti.
- ⚠️ **JANGAN lewat `.bat`** — `jalankan-agent.bat` **tidak meneruskan argumen**, dan
  akan bentrok dengan task yang sedang jalan. Entry bundle = `solamax-agent.cjs`
  (bukan `dist/index.js`).
- `--probe10` memakai `ROUND(...,1)` — desimal `.5` yang muncul memang sengaja dipakai
  untuk membuktikan artefak pembulatan ±1 Rp (lihat catatan di bawah).

---

## Catatan yang sudah diketahui — jangan dikejar sebagai bug

- **±1 Rp pada OMSET itu wajar & benign** bila total harian jatuh tepat di setengah
  rupiah: formatter dashboard (`Math.round`) membulatkan `.5` **ke atas**, MySQL
  `ROUND(SUM,0)` memutus seri ke bawah. Bukan selisih data. **Jangan "diperbaiki".**
- **Baca `sync_state` DUA KALI** sebelum menyimpulkan macet — task yang baru start
  di tengah siklus pertama terlihat seperti basi.
- **Nol di tengah siklus ≠ celah data**: `pelanggan` (900 dtk) dan `realtank` (siklus
  masters) dispatch lebih jarang dari `sales`, jadi bisa terbaca 0 saat sales sudah
  mengalir. Cek ulang setelah satu siklus penuh.
- **`kas` KR TIDAK dorman** — dry-run mengembalikan **3 header / 3 detail**. Ini
  **berbeda dari BL** yang nol baris by design. Jangan bawa asumsi "modul kas tak
  dipakai" antar unit; karakterisasi dari bukti per unit. (Baris log
  `kas: 0 baris (dorman sejak 2019 — normal)` teksnya **hardcoded** di
  `apps/agent/src/sync.ts:249` — bukan pernyataan spesifik unit.)
- **Nama DB per situs** — KR = `easymax_korek`, bukan `easymax`. Selalu
  `SHOW DATABASES;` dulu (langkah 2a).
