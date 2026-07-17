# RUNBOOK — Smoke Test SolaMax Agent di Mesin SPBU (Windows)

Panduan langkah-demi-langkah untuk **menjalankan tes pertama** SolaMax Agent di komputer
server SPBU Imam Bonjol, lewat **Chrome Remote Desktop**. Ditulis untuk non-developer —
ikuti urut dari atas. Perkiraan waktu: 20–30 menit.

> 🟢 **Aman dijalankan saat pompa beroperasi.** Semua langkah hanya **MEMBACA** database
> (read-only). Agent tidak mengirim data ke mana pun pada tes ini (`dry-run`), dan tidak
> pernah menulis ke database EasyMax. Satu-satunya perintah yang "mengubah" sesuatu adalah
> pembuatan user MySQL baru di Bagian C — itu hanya menambah satu akun baca-saja, tidak
> menyentuh data EasyMax.

---

## Bagian A — Kenali mesinnya (2 menit)

1. Di mesin SPBU, klik kanan **My Computer / This PC** → **Properties**.
2. Catat dua hal:
   - **Versi Windows** (mis. Windows 7, Windows 10, Windows Server 2008…)
   - **System type**: **32-bit** atau **64-bit**.

Pilih versi Node.js dari tabel ini:

| Windows di mesin SPBU                       | Node.js yang dipasang                                                                                     | File installer                                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10 / 11 / Server 2016+              | **Node 18.20.4 (LTS)**                                                                                    | 64-bit: [`node-v18.20.4-x64.msi`](https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi) · 32-bit: [`node-v18.20.4-x86.msi`](https://nodejs.org/dist/v18.20.4/node-v18.20.4-x86.msi)       |
| Windows 7 / 8 / 8.1 / Server 2008 R2 / 2012 | **Node 12.22.12**                                                                                         | 64-bit: [`node-v12.22.12-x64.msi`](https://nodejs.org/dist/v12.22.12/node-v12.22.12-x64.msi) · 32-bit: [`node-v12.22.12-x86.msi`](https://nodejs.org/dist/v12.22.12/node-v12.22.12-x86.msi) |
| Windows XP / Server 2003                    | ✋ **BERHENTI — jangan install.** Laporkan dulu. (Rencana B: agent jalan di PC lain dalam LAN yang sama.) |

> Bundle agent sengaja di-build agar jalan di Node 12 ke atas. Untuk tes ini
> (test-connection + dry-run) Node 12 sudah cukup; kebutuhan versi untuk mode kirim
> sungguhan ditentukan di Fase 2.

## Bagian B — Install Node.js (5 menit)

1. Buka link installer dari tabel di atas **di browser mesin SPBU**, unduh, jalankan.
2. Klik **Next → Next → … → Finish** (semua pilihan default; tak perlu centang apa pun).
3. Verifikasi: buka **Command Prompt** (Start → ketik `cmd` → Enter), ketik:
   ```
   node --version
   ```
   Harus muncul nomor versi (mis. `v18.20.4`). Kalau muncul `'node' is not recognized…`,
   tutup cmd, buka lagi (PATH baru aktif setelah jendela baru). Masih gagal → restart mesin.

## Bagian C — Buat user MySQL baca-saja (5 menit)

Buka **SQL Manager** (tool yang sama dengan yang dipakai menjalankan query verifikasi),
login sebagai **admin/root**, lalu jalankan blok ini **satu per satu**
(ganti `PASSWORD_KUAT_DISINI` — catat passwordnya, dipakai di Bagian D - Untuk SPBU 6478111 passwordnya adalah `SPBU6478111`):

```sql
-- 1. Pastikan hash password format BARU (4.1+) supaya driver modern bisa login.
SET SESSION old_passwords = 0;

-- 2. Buat user khusus agent.
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'PASSWORD_KUAT_DISINI';

-- 3. Beri HANYA hak baca (SELECT) pada database easymax.
GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost';
FLUSH PRIVILEGES;
```

Lalu **verifikasi** (dua-duanya wajib, hasilnya difoto/disalin):

```sql
-- A. Harus muncul persis: GRANT SELECT ON `easymax`.* TO 'readonly_sync'@'localhost'
SHOW GRANTS FOR 'readonly_sync'@'localhost';

-- B. panjang_hash HARUS 41. Kalau 16 → lihat kotak di bawah.
SELECT user, host, LENGTH(password) AS panjang_hash
FROM mysql.user WHERE user = 'readonly_sync';
```

> ⚠️ **Kalau `panjang_hash` = 16** (server menyimpan hash format lama): jalankan ini
> sebagai admin, lalu cek ulang sampai 41:
>
> ```sql
> SET SESSION old_passwords = 0;
> SET PASSWORD FOR 'readonly_sync'@'localhost' = PASSWORD('PASSWORD_KUAT_DISINI');
> FLUSH PRIVILEGES;
> ```
>
> Ini mencegah error auth paling umum di MySQL 5.0 **sebelum** terjadi.

> Catatan MySQL 5.0.67: jika `CREATE USER` ditolak, pakai bentuk lama:
> `GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost' IDENTIFIED BY 'PASSWORD_KUAT_DISINI';`

## Bagian D — Salin bundle & isi config (5 menit)

1. Salin folder **`bundle-out`** (atau ekstrak `solamax-agent-bundle.zip`) ke mesin SPBU,
   misalnya ke **`C:\solamax-agent`**. Cara transfer: unggah zip ke Google Drive dari Mac,
   lalu unduh dari browser mesin SPBU (atau fitur transfer file Chrome Remote Desktop).
   Isi folder (zip FLAT — hasil ekstrak langsung file-file ini, TANPA subfolder;
   bila kamu melihat subfolder `bundle-out\`, itu zip lama — pindahkan isinya naik):
   ```
   solamax-agent.cjs      ← program agent (1 file, tak perlu install apa pun lagi)
   config.local.json      ← file pengaturan — DIEDIT di langkah berikut
                             (unitCode WAJIB diganti kode unit SPBU ini!)
   1-tes-koneksi.bat      ← dobel-klik untuk tes koneksi
   2-dry-run.bat          ← dobel-klik untuk dry-run
   3-sync-once.bat        ← sync sekali (uji kirim ke backend)
   jalankan-agent.bat     ← target Task Scheduler (loop; log → logs\agent-<tgl>.log)
   resync-bulanan.bat     ← task BULANAN --resync-sales 40 hari (lihat Bagian E)
   4/5/6-probe*.bat       ← probe saldo (diagnostik, opsional)
   RUNBOOK-SPBU.md        ← dokumen ini
   ```
2. Klik kanan **`config.local.json`** → **Open with** → **Notepad**. Sesuaikan:

   | Field            | Isi                                                             |
   | ---------------- | --------------------------------------------------------------- |
   | `unitCode`       | **kode unit SPBU ini** (mis. `6478111`/`6378301`/`6478101`) — template sengaja `GANTI_KODE_UNIT`; salah/lupa = backend menolak 403 |
   | `mysql.host`     | `127.0.0.1` (MySQL di mesin yang sama — biarkan)                |
   | `mysql.port`     | `3306` (kalau koneksi ditolak, lihat Troubleshooting №4)        |
   | `mysql.user`     | `readonly_sync` (biarkan)                                       |
   | `mysql.password` | **password dari Bagian C** (ganti tulisan `GANTI_DENGAN_...`)   |
   | `mysql.database` | `easymax` (biarkan)                                             |
   | `mysql.driver`   | `mysql2` (biarkan; hanya diubah kalau Troubleshooting menyuruh) |
   | `backend.*`      | **biarkan dummy** — belum dipakai di tes ini                    |

3. **Save** (Ctrl+S), tutup Notepad.

> File ini hanya ada di mesin SPBU dan **tidak pernah masuk git** (di-gitignore).

## Bagian E — Tes 1: koneksi (1 menit)

Dobel-klik **`1-tes-koneksi.bat`**. Jendela hitam muncul, lalu berhenti dengan `Press any key…`.

✅ **Berhasil** bila ada baris seperti:

```
{"...","level":"info","msg":"koneksi MySQL OK","version":"5.0.67-community-nt","timeZone":"SYSTEM","now":"2026-06-12 09:15:00"}
```

- Cek `now` ≈ jam dinding SPBU (WIB).
- Hasil otomatis tersimpan di **`output-tes-koneksi.txt`** — **kirim isi file ini** apa pun hasilnya.

❌ Gagal → cari pesan errornya di tabel **Troubleshooting** di bawah, jalankan perbaikannya,
coba lagi. Tetap gagal → kirim `output-tes-koneksi.txt` + hasil verifikasi Bagian C.

## Bagian F — Tes 2: dry-run (2 menit)

> Hanya lanjut bila Tes 1 sukses. Dry-run **membaca** data penjualan/opname/terima/kas dan
> **mencetak ringkasan jumlah baris — tidak mengirim apa pun ke internet**.

Dobel-klik **`2-dry-run.bat`**.

✅ **Berhasil** bila ada baris-baris seperti:

```
{"...","msg":"[dry-run] payload","domain":"sales","watermark_high":"...","counts":{"sales_header":…,"sales_detail":…}}
{"...","msg":"[dry-run] payload","domain":"opname",…}
{"...","msg":"[dry-run] payload","domain":"delivery",…}
{"...","msg":"kas: 0 baris (dorman sejak 2019 — normal)",…}   ← 0 untuk kas itu NORMAL
{"...","msg":"[dry-run] payload","domain":"masters",…}
```

Hasil tersimpan di **`output-dry-run.txt`** — **kirim isi file ini**.

> Catatan: dry-run pertama membaca seluruh riwayat live (~180 ribu baris penjualan) untuk
> satu page pertama (1000 baris) per domain — tetap ringan dan hanya SELECT ber-LIMIT.

## Bagian G — Troubleshooting (cocokkan potongan pesan error)

| №   | Potongan pesan di output                                                                                | Artinya                                                  | Tindakan                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Client does not support authentication protocol requested by server` atau `ER_NOT_SUPPORTED_AUTH_MODE` | Hash password user masih format lama (pra-4.1)           | Jalankan SQL "kalau panjang_hash = 16" di Bagian C, coba lagi. Masih gagal → tindakan №2                                                          |
| 2   | `MySQL server is requesting the old (insecure) authentication` — atau №1 belum teratasi                 | Server memaksa protokol auth lama                        | Edit `config.local.json`: ubah `"driver": "mysql2"` → `"driver": "mysql"` → Save → ulangi tes. (Driver cadangan sudah terpasang di dalam bundle.) |
| 3   | `Access denied for user 'readonly_sync'@'localhost'`                                                    | Password salah / user belum dibuat di host itu           | Cocokkan password di config dengan Bagian C; jalankan ulang `SHOW GRANTS`                                                                         |
| 4   | `ECONNREFUSED 127.0.0.1:3306`                                                                           | MySQL tidak di port 3306                                 | Cari port: buka cmd → `netstat -ano \| findstr LISTENING \| findstr 33` — atau lihat `my.ini` EasyMax. Ubah `mysql.port` di config                |
| 5   | `Unknown character set`                                                                                 | Server 5.0 menolak charset handshake                     | Edit config: `"charset": "LATIN1_SWEDISH_CI"` → ulangi tes                                                                                        |
| 6   | `'node' is not recognized`                                                                              | Node belum terpasang / PATH belum aktif                  | Bagian B; tutup-buka cmd; restart mesin                                                                                                           |
| 7   | `Gagal baca config`                                                                                     | `config.local.json` tidak ada di folder yang sama        | Pastikan file ada di samping `solamax-agent.cjs`, namanya persis (bukan `.json.txt` — matikan "Hide extensions" di Folder Options bila perlu)     |
| 8   | `ETIMEDOUT` / hang lama                                                                                 | MySQL hanya menerima koneksi dari tempat lain / firewall | Pastikan dijalankan **di mesin server SPBU** (bukan PC lain); laporkan                                                                            |
| 9   | Error lain                                                                                              | —                                                        | Kirim `output-*.txt` apa adanya — pesan error persisnya yang dibutuhkan                                                                           |

## Bagian H — Yang dilaporkan balik

Kirim 4 hal (copy-paste teks atau kirim filenya):

1. **`output-tes-koneksi.txt`** (berisi versi Node + hasil tes koneksi)
2. **`output-dry-run.txt`**
3. Versi Windows + 32/64-bit (dari Bagian A)
4. Hasil `SHOW GRANTS` + `panjang_hash` (dari Bagian C)

Selesai — agent **tidak perlu dibiarkan jalan**; kedua tes berhenti sendiri. Setelah hasil
ini masuk dan disetujui, baru lanjut Fase 2 (backend penerima data).

---

## Bagian I — Memperbarui agent (swap bundle baru) — ⚠️ WAJIB RESTART

Agent berjalan **terus-menerus (loop)** lewat Windows Task Scheduler →
`C:\solamax-agent\jalankan-agent.bat` → `node solamax-agent.cjs` (tanpa `--once`).

> 🛑 **Node memuat `solamax-agent.cjs` ke memori SEKALI saat start.** Menimpa file
> `.cjs` di disk **TIDAK** memuat ulang proses yang sedang jalan — ia tetap
> menjalankan versi LAMA sampai di-restart. **Inilah penyebab gejala "data tangki
> basi / domain baru tak muncul" yang pernah terjadi (16 Jun 2026):** bundle baru
> sudah disalin, tapi loop lama belum di-restart.

**Langkah baku tiap kali ganti `solamax-agent.cjs`:**

1. **Cadangkan** biner lama (untuk rollback):
   ```bat
   copy /Y C:\solamax-agent\solamax-agent.cjs C:\solamax-agent\solamax-agent.PREV.cjs
   ```
2. **Timpa HANYA** `solamax-agent.cjs` dengan file baru. **Jangan** sentuh
   `config.local.json` (berisi password readonly_sync + API key asli) atau
   `jalankan-agent.bat`.
3. **RESTART loop:**
   - **Task Scheduler** → task SolaMax agent → klik kanan → **End**.
   - **Task Manager → Details** → akhiri sisa **`node.exe`** yang menjalankan `solamax-agent.cjs`.
   - Task Scheduler → task → **Run**.
4. **Verifikasi:** buka `C:\solamax-agent\logs\agent-<tgl>.log`, cari baris
   `ingest ok … "domain":"realtank"` (dan **tak ada** `422`).

**Rollback:** kembalikan `solamax-agent.PREV.cjs` → `solamax-agent.cjs`, lalu ulangi langkah 3.

### Task bulanan `resync-bulanan.bat` — STANDAR unit kelas NULL-by-default DTGLJAM

Temuan onboarding AS/Adisucipto 2026-07-17: ada EasyMax yang menulis `tr_djualbbm.DTGLJAM`
**NULL untuk (hampir) semua baris** (kelas varian ke-3; IB = NULL shift-3 saja, Bakau = D2).
Pada unit begini watermark sales tak pernah maju — sales 100% dibawa rescan jendela 7 hari,
dan koreksi/back-dating **lebih tua dari 7 hari tidak pernah terheal otomatis** (sales tidak
ikut sapuan Track 2). Penutupnya: task Scheduler **BULANAN** menjalankan `resync-bulanan.bat`
(`--resync-sales` hari-ini−40 s/d hari-ini; UPSERT idempoten, MySQL tetap read-only, aman
berjalan bersamaan loop agent).

Cara cek kelas unit (SEKALI, saat onboarding — WAJIB sebelum go-live):
```sql
SELECT COUNT(*) FROM tr_djualbbm WHERE DTGLJAM IS NULL;  -- via user readonly_sync
```
`0` atau kecil → kelas IB/Bakau (task bulanan opsional tapi tidak merugikan);
≈ jumlah seluruh baris → kelas AS (task bulanan **WAJIB**). Parameter task: nama
`SolaMax Resync Bulanan`, trigger Monthly hari-1 03:30 WIB, "Run whether user is
logged on or not" + highest privileges, Start-in `C:\solamax-agent`. Log:
`logs\resync-bulanan.log`. (Roadmap: sales masuk sapuan Track 2 di rilis agent
berikutnya — sesudah itu task ini menjadi cadangan.)
