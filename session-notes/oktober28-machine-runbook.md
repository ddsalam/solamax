# Panduan Mesin SPBU 28 Oktober (`63781002`) — Phase 2c

> **Dijalankan OLEH OWNER di PC server SPBU 28 Oktober** (via Chrome Remote Desktop).
> Cloud sudah SIAP & terverifikasi: unit `unit_id=7`, tenant
> **`pt-sola-petra-energi`** (tenant ke-6), secret `solamax-28oktober-agent-key` v1
> dengan hash **terbukti cocok** lawan `unit.api_key_hash`.
> Ikuti urut. **Ada 3 STOP-CHECK WAJIB (langkah 7, 8, 8b) — kirim hasilnya sebelum lanjut.**
>
> 🟢 Semua langkah ke EasyMax bersifat **READ-ONLY**. Satu-satunya perubahan di mesin =
> pembuatan user MySQL baca-saja (langkah 2) + Task Scheduler (langkah 11).
>
> 🏁 **Ini unit KETUJUH dan TERAKHIR.** Setelah 28 Oktober live, armada SolaMax
> **lengkap 7/7**.

---

## ⚠️ Dua hal khas unit ini — baca dulu

1. **Kode POS `63781002` ada DELAPAN digit**, bukan tujuh seperti enam unit lain
   (Pertamina `63.781.002`). Kalimat "kode 7 digit" di runbook/percakapan lama
   **tidak berlaku di sini**. Sudah diverifikasi tak ada bagian pipeline yang
   mengasumsikan panjang kode — tapi saat mengetik `unitCode` di langkah 5,
   **hitung ulang digitnya**: `6 3 7 8 1 0 0 2` = 8.
2. **Nama PT nyaris sama dengan PT lain.** Pemilik 28 Oktober = **PT Sola Petra
   ENERGI**, sedangkan IB & Bakau milik **PT Sola Petra ABADI** — beda satu kata,
   badan hukum terpisah. Cloud sudah dipasang di tenant yang benar dan diuji
   (termasuk uji sengaja-salah untuk memastikan penjaganya bekerja). Di sisi mesin
   ini tidak berdampak apa pun; disebut supaya kalau nanti muncul nama "Sola Petra"
   di layar POS, tidak dikira salah unit.

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

**Nama DB berbeda per situs.** Lima unit pertama memang `easymax`, tapi **Korek
ternyata `easymax_korek`**. Catat nama persisnya di 28 Oktober; dipakai di GRANT (2c)
**dan** di `config.local.json` (langkah 5).

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
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'SPBU63781002';
GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost';
FLUSH PRIVILEGES;
```

Konvensi password = `SPBU<kode unit>` → **`SPBU63781002`** (ikut 8 digit).
Hanya `SELECT`, tidak lebih.
**Ganti `easymax`** dengan nama sebenarnya dari langkah 2a bila berbeda.

### 2d. 🔴 VERIFIKASI akun benar-benar terbentuk — WAJIB sebelum lanjut

```sql
SELECT user, host, LENGTH(password) FROM mysql.user WHERE user='readonly_sync';
```

| Hasil | Artinya |
| --- | --- |
| **nol baris** | akun **TIDAK terbentuk** → ulangi 2c, jangan lanjut |
| `LENGTH(password)` = **16** | hash format lama 41-bit → **`mysql2` tak bisa login** meski akun benar. Set `old_passwords = 0` lalu `SET PASSWORD` ulang |
| `LENGTH(password)` = **41** | ✅ format benar |
| `host` ≠ yang dipakai agent | pakai host yang terdaftar |

> ⚠️ **Kenapa ini wajib:** di unit ini, GRANT tampak sukses tetapi akun `readonly_sync`
> **tidak pernah ada**, sehingga MySQL menolak login mentah-mentah. Bersama dua kasus KR
> (nama DB per-situs; GRANT atas DB tak-ada diterima tanpa error), polanya satu:
> **langkah grant bisa terlihat sukses tanpa meninggalkan akun yang bisa dipakai**, dan
> semua gejalanya di hilir **menyerupai API key rusak**. Satu query ini menutup ketiganya.

## 3. Salin bundle ke folder LOKAL (3 mnt)

Bundle sudah di-build dari `main` yang dipromosikan (**`89a9eb9`**):
`apps/agent/solamax-agent-bundle.zip` — **flat, 11 file**.

- Transfer ke mesin 28 Oktober, **extract ke `C:\solamax-agent`**.
- ⚠️ **JANGAN taruh di folder yang di-sync Google Drive / OneDrive** — file lock saat
  sync bikin agent gagal tulis.
- Setelah extract, `C:\solamax-agent\solamax-agent.cjs` harus ada.

## 4. Ambil API key (di Mac owner, BUKAN di mesin SPBU)

Di Terminal Mac:

```bash
gcloud secrets versions access latest --secret solamax-28oktober-agent-key
```

Salin nilainya langsung ke `config.local.json` di langkah 5. **Jangan pernah tempel
key ini ke chat, email, atau file yang ter-commit.**

## 5. Isi `config.local.json` (3 mnt)

Buka `C:\solamax-agent\config.local.json` di Notepad, ubah **5 baris**:

| Baris | Dari | Menjadi |
| --- | --- | --- |
| `unitCode` | `"GANTI_KODE_UNIT"` | **`"63781002"`** ← 8 digit, hitung ulang |
| `mysql.database` | `"easymax"` | nama dari langkah 2a |
| `mysql.password` | `"GANTI_DENGAN_PASSWORD_readonly_sync"` | `"SPBU63781002"` |
| `backend.baseUrl` | `"https://dummy.invalid"` | `"https://solamax-ingest-staging-wn6i64kvza-et.a.run.app"` |
| `backend.apiKey` | `"dummy-belum-dipakai-sampai-fase-2"` | *(key dari langkah 4)* |

`timezone` biarkan `Asia/Pontianak`. Simpan.

> Nama service `solamax-ingest-**staging**` memang membingungkan — itu **pilot LIVE**,
> bukan lingkungan uji. Yang bernama `-rlsstg` barulah lingkungan uji. Jangan ditukar.

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

- **Persentase kecil** (KB 4,14% · BL 8,84% · KR 6,90%) → **kelas IB/Bakau** →
  watermark inkremental jalan → **task bulanan TIDAK dipasang**.
- **≈semua baris NULL** → **kelas AS** → sales 100% lewat rescan 7-hari →
  **task bulanan `resync-bulanan.bat` WAJIB** (langkah 12).

Bukti silang independen dari langkah 6: kalau `sales.watermark_high` di dry-run berisi
timestamp nyata → watermark hidup → kelas IB/Bakau. Kelas AS **didefinisikan** oleh
watermark yang NULL permanen. **Dua sinyal harus sepakat** — kalau bertentangan,
berhenti dan lapor; jangan pilih salah satu.

## 8. 🛑 STOP-CHECK WAJIB #2 — Probe ATG

```sql
SELECT COUNT(*) AS n_tangki_atg FROM vw_realtm;
```

- **> 0** → ATG hadir → denah/tank-gauge live. **Jumlah tangki BERVARIASI per unit**
  (BL = 8 · KB = 8 · KR = 7) — **jangan salin angka antar unit**, kirim angka apa
  adanya dari mesin ini.
- **0 atau view tidak ada** → unit tanpa ATG (pola AS) → denah tangki **empty-state
  BY DESIGN**, `real_tank`=0, domain realtank tak pernah dispatch. **Bukan defect** —
  dicatat sebagai karakteristik unit.

## 8b. 🛑 STOP-CHECK WAJIB #3 — Identitas unit (RED FLAG bila beda)

```sql
SELECT * FROM tm_konfid;
```

> ⚠️ Tabel identitas SPBU di EasyMax bernama **`tm_konfid`** — **bukan** `tm_spbu`
> (`tm_spbu` TIDAK ADA). Pipeline **tidak pernah** membaca identitas unit dari EasyMax
> — `unitCode` murni dari `config.local.json` — jadi ini **cek-silang manual** bahwa
> mesin ini benar unit yang saya provision di cloud.

Yang dicocokkan — **dengan bobot bukti yang BERBEDA**:

- `CSPBU` = **63.781.002** — **DECISIVE.** Beda = STOP, tanpa kecuali.
  (Perhatikan: tiga digit di blok terakhir, konsisten dengan kode 8 digit.)
- `VCNAMA` — *idealnya* nama PT (`PT. SOLA PETRA ENERGI`), yang akan mengonfirmasi
  keputusan tenant dari sisi POS. **Kalau isinya "PT. SOLA PETRA ABADI" — BERHENTI
  dan lapor**, itu satu-satunya isi yang benar-benar mengkhawatirkan di unit ini.
  Kalau isinya nama stasiun (mis. "SPBU 28 OKTOBER"), itu **tidak konklusif**,
  bukan kontradiksi.
- `VCALAMAT` / `CKOTA` — sering kosong/kasar. **Corroborating saja**, tak pernah decisive.

> ⚠️ **Cek ini bisa TIDAK KONKLUSIF — dan itu bukan kegagalan.** `tm_konfid` diisi oleh
> admin POS situs; banyak situs tidak memeliharanya (di KR: `VCNAMA` = "SPBU KOREK",
> `VCALAMAT` kosong). Yang **decisive** hanya `CSPBU`. Kalau `VCNAMA` bukan nama PT,
> saya catat tingkat buktinya apa adanya — tenant bersandar pernyataan owner, seperti
> KR/KB/AS — **bukan** dimuluskan seolah terkonfirmasi POS.
>
> **JANGAN menulis ke EasyMax** untuk "memperbaiki" `tm_konfid` — read-only bersifat
> mutlak; itu pekerjaan admin POS situs, di luar pipeline ini.
>
> Alamat di `config.ts` tetap memakai **alamat vault** (Jl. 28 Oktober, Siantan Hulu,
> Kec. Pontianak Utara, 78242).

> **Tunggu konfirmasi saya setelah langkah 7 + 8 + 8b sebelum lanjut ke 9.**

---

## 9. Backfill penuh (~1–1,5 jam)

Klik **`3-sync-once.bat`**, biarkan jalan sampai selesai.

- ⚠️ **Tidak mencetak apa pun sampai node exit** — jangan dikira hang.
  Progres saya pantau dari DB live, bukan dari console.
- `logs\agent-<tgl>.log` **hanya** ditulis `jalankan-agent.bat`, bukan sync-once.
- Kalau muncul "backend offline → payload di-buffer": itu **buffer + retry bawaan**,
  bukan kerusakan. Jangan restart agent karena itu.

## 10. Sweep satu-kali (setelah backfill selesai)

Buka **Command Prompt**, `cd C:\solamax-agent`, jalankan berurutan
(ganti `<hari-ini>` dengan tanggal hari itu, format `YYYY-MM-DD`):

```bat
node solamax-agent.cjs --resync-sales 2025-01-01 <hari-ini> --config config.local.json
node solamax-agent.cjs --deep-sweep tebus 730 92 --config config.local.json
node solamax-agent.cjs --deep-sweep delivery 730 92 --config config.local.json
```

> ⚠️ **Jalankan langsung seperti di atas** — `jalankan-agent.bat` **tidak meneruskan
> argumen**, dan entry point-nya `solamax-agent.cjs` (bukan `dist/index.js`).

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
berakhir `.5` dan `.0`, dengan prediksi saya ter-registrasi **sebelum** Anda
menjalankannya), lalu jalankan di **Command Prompt**:

```bat
cd C:\solamax-agent
node solamax-agent.cjs --probe10 <tgl1> <tgl2> ... --config config.local.json
```

> ⚠️ **Tanggal WAJIB ditulis eksplisit** — default-nya beku di Juni 2026.
> Jangan pakai `4-probe10.bat` bila ada; argumen tidak diteruskan.

Kirim seluruh output apa adanya. Saya rekonsiliasi per seksi (OMSET, volume,
pelanggan, EDC, deposit) lawan mirror cloud.

> Catatan yang sudah diketahui, **bukan** bug: selisih **±1 Rp** pada OMSET adalah
> artefak pembulatan setengah-rupiah (dashboard `Math.round` ke atas vs MySQL
> `ROUND(SUM,0)` ke bawah). Justru itu sebabnya saya campur tanggal `.5` dan `.0` —
> supaya terbukti sebagai artefak, bukan gejala data hilang.

---

## Ringkasan cloud (sudah selesai, tidak perlu tindakan di mesin)

| Item | Nilai |
| --- | --- |
| `unit_id` | **7** |
| `code` | **`63781002`** (8 digit) |
| `name` | 28 Oktober |
| tenant | **`pt-sola-petra-energi`** — PT Sola Petra Energi (tenant ke-6) |
| timezone | `Asia/Pontianak` |
| secret | `solamax-28oktober-agent-key` v1 (readback ↔ DB **match**) |
| revisi dashboard live | `solamax-dashboard-staging-00061-6zt` (`89a9eb9` = main HEAD) |
| isolasi | 8 suite scope live **67 passed / 0 skipped** |

**Pengawas:** Rossi Machus — `solapetraenergi@gmail.com`. Akun Gmail biasa memang
disengaja (akses dikunci lewat undangan/membership, bukan lewat domain email).
Grant `/admin` dilakukan **setelah** login pertama (butuh baris `app.users` dulu),
dan perlu penambahan test user di OAuth consent screen.
