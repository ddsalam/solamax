# Bakau — RUNBOOK MESIN (Dion, via Chrome Remote Desktop)

Onboarding agent SolaMax di **PC server SPBU Bakau** (`6378301`). Copy-paste, urut dari atas.
Pendamping: [`RUNBOOK-SPBU.md`](../apps/agent/RUNBOOK-SPBU.md) (versi IB — tabel Node/troubleshooting
tetap berlaku) dan **(a)** [`bakau-live-provisioning-runbook.md`](bakau-live-provisioning-runbook.md)
(sisi cloud — dijalankan lebih dulu oleh admin).

> 🟢 **Aman saat pompa beroperasi.** Semua ke EasyMax **read-only**. Satu-satunya perubahan di PC:
> membuat user MySQL baca-saja `readonly_sync` (Bagian B). Tidak pernah menulis ke data EasyMax.

> ⚠️ **PRASYARAT (dari admin, runbook a):** baris `unit` Bakau + `api_key_hash` **sudah** ada di
> Cloud SQL, dan **API key Bakau** sudah diberikan admin (dari Secret Manager — jangan diketik ulang
> sembarangan). Kalau belum, agent akan ditolak (401/403) saat mengirim.

---

## Bagian A — Node.js
Ikuti [`RUNBOOK-SPBU.md`](../apps/agent/RUNBOOK-SPBU.md) Bagian A+B (kenali Windows 32/64-bit → pasang
Node dari tabel; Win10/11/Server2016+ → Node 18.20.4; Win7/8/Server2008/2012 → Node 12.22.12; XP →
BERHENTI, lapor). Verifikasi `node --version`.

## Bagian B — User MySQL baca-saja `readonly_sync`
Buka **SQL Manager** (login admin/root di EasyMax Bakau), jalankan **satu per satu**
(password Bakau: `SPBU6378301`):
```sql
SET SESSION old_passwords = 0;                                   -- hash format 4.1+
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'SPBU6378301';
GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost';        -- HANYA SELECT
FLUSH PRIVILEGES;
```
Verifikasi (dua-duanya, salin hasilnya):
```sql
SHOW GRANTS FOR 'readonly_sync'@'localhost';                     -- harus: GRANT SELECT ON `easymax`.* ...
SELECT user, host, LENGTH(password) AS panjang_hash FROM mysql.user WHERE user='readonly_sync';  -- HARUS 41
```
> Kalau `panjang_hash`=16 → `SET SESSION old_passwords=0; SET PASSWORD FOR 'readonly_sync'@'localhost'
> = PASSWORD('SPBU6378301'); FLUSH PRIVILEGES;` lalu cek ulang. Kalau `CREATE USER` ditolak (MySQL 5.0):
> `GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost' IDENTIFIED BY 'SPBU6378301';`

## Bagian C — Bundle + config (mode KIRIM sungguhan)
1. Salin `bundle-out/` (dari `pnpm --filter @solamax/agent bundle` — **bundle terbaru/RLS-aware**,
   sama dengan IB) ke **`C:\solamax-agent`**. Isi: `solamax-agent.cjs`, `config.local.json`,
   `1-tes-koneksi.bat`, `2-dry-run.bat`, `jalankan-agent.bat`.
2. Edit `config.local.json` (Notepad) — nilai Bakau:
   ```json
   {
     "unitCode": "6378301",
     "timezone": "Asia/Pontianak",
     "mysql": {
       "host": "127.0.0.1", "port": 3306,
       "user": "readonly_sync", "password": "SPBU6378301",
       "database": "easymax", "driver": "mysql2"
     },
     "backend": {
       "baseUrl": "https://solamax-ingest-staging-wn6i64kvza-et.a.run.app",
       "apiKey": "<API KEY BAKAU dari admin — jangan commit, jangan sebar>"
     }
   }
   ```
   > File ini **tidak pernah masuk git** (gitignored). API key = raw key Bakau dari Secret Manager
   > (Bagian a/STEP 3). Alternatif tanpa menaruh key di file: set env `SOLAMAX_API_KEY` +
   > `SOLAMAX_MYSQL_PASSWORD`. Driver/charset: kalau error auth/charset lihat Troubleshooting
   > RUNBOOK-SPBU (`driver:"mysql"`, `charset:"LATIN1_SWEDISH_CI"`).

## Bagian D — Tes koneksi + dry-run (belum kirim)
Dobel-klik `1-tes-koneksi.bat` → cari `"koneksi MySQL OK","version":"5.0.67..."`, `now` ≈ jam WIB.
Dobel-klik `2-dry-run.bat` → muncul `[dry-run] payload` per domain dengan `counts` > 0
(sales/opname/delivery/edc/tebus/tera/masters; `kas: 0` normal). Kirim `output-*.txt`. **Lanjut hanya
bila dua tes hijau.**

## Bagian E — Task Scheduler (kirim berkala, loop)
Buat task menjalankan `C:\solamax-agent\jalankan-agent.bat` (→ `node solamax-agent.cjs`, TANPA `--once`):
- **"Run whether user is logged on or not"** (centang), **"Run with highest privileges"**.
- Trigger: **At startup** (+ opsi "Repeat" tak perlu — agent loop sendiri tiap ~2 menit).
- Jalankan task → cek `C:\solamax-agent\logs\agent-<tgl>.log` ada `ingest ok ... "domain":"realtank"`
  dan **tak ada `422`**.

## Bagian F — ⭐ BACKFILL SATU-KALI (business-date DEEP-SWEEP ke ~2022-08)
> Jalankan **setelah** Bagian E berjalan normal (agen sudah kirim siklus biasa), **dari** `C:\solamax-agent`
> (cmd → `cd C:\solamax-agent`). Perintah ini **MENGIRIM** ke backend. Cukup **sekali**. Floor
> `2022-06-01` = margin sebelum 2022-08 (untuk seed saldo-buka DO/tera). `1500` hari ≈ 2022-06-01 → hari ini.

**1) SALES — WAJIB pakai resync per DTGLJUAL (ini FIX D2: menangkap NULL-DTGLJAM di semua 3 shift):**
```bat
node solamax-agent.cjs --resync-sales 2022-06-01 <TANGGAL-HARI-INI>
```
> ⚠️ **JANGAN** pakai sinkron incremental untuk sales historis — `DTGLJAM > watermark` akan
> **melewati** ~9.600 baris NULL-DTGLJAM Bakau secara permanen. `--resync-sales` menyapu per tanggal
> bisnis (idempoten, UPSERT).

**2) Domain windowed lain — deep-sweep 1500 hari, satu per satu:**
```bat
node solamax-agent.cjs --deep-sweep opname 1500
node solamax-agent.cjs --deep-sweep delivery 1500
node solamax-agent.cjs --deep-sweep tera 1500
node solamax-agent.cjs --deep-sweep edc 1500
node solamax-agent.cjs --deep-sweep tebus 1500
node solamax-agent.cjs --deep-sweep pelanggan 1500
```
> `cash` dorman (0 baris sejak ~2021) — boleh dilewati. Domain valid deep-sweep: pelanggan, edc,
> opname, delivery, tera, cash, tebus.

**3) piutang / hutang / deposit / masters — TIDAK perlu perintah:** full-sync otomatis tiap siklus
biasa (tanpa watermark) → RECAP saldo dapat seluruh riwayat. (Windowing hanya untuk domain di atas.)

## Bagian G — ⚠️ Ganti bundle = WAJIB restart (jebakan .cjs)
Node memuat `solamax-agent.cjs` ke memori **sekali**. Menimpa file **tidak** me-reload proses.
Tiap ganti bundle: backup → timpa `solamax-agent.cjs` saja (jangan sentuh `config.local.json`) →
**Task Scheduler End** → Task Manager **akhiri `node.exe`** → **Run** → cek log `ingest ok`
(detail: [`RUNBOOK-SPBU.md`](../apps/agent/RUNBOOK-SPBU.md) Bagian I).

## Bagian H — ACCEPTANCE (baru dinyatakan live setelah ini hijau)
1. **probe10 gold-check** (rekonsiliasi ke rupiah vs "Laporan Penjualan Harian" PDF EasyMax Bakau):
   ```bat
   node solamax-agent.cjs --probe10
   ```
   OMSET / PELANGGAN / EDC / DEPOSIT per tanggal terpilih harus **cocok ke rupiah**.
2. **Verifikasi ROW COUNT di Cloud SQL (bukan log batch)** — admin jalankan per domain untuk `unit_id=2`
   (`SELECT count(*) … WHERE unit_id=2`, konteks `set_config('app.unit_ids','2',true)`). **Jangan** pakai
   angka di log batch agent sebagai patokan — pernah ada **false-alarm "tera:2"** (log under-report);
   sumber kebenaran = COUNT di DB.
3. **3 delta (dari GATE 2):**
   - **D1** — Rincian per-produk terlipat per NAMA kanonik, **tanpa dobel** (BB-01+BB-07→PERTALITE
     dijumlah; BB-03+BB-05→SOLAR dijumlah). Rehearsal `-rlsstg`: PERTALITE=330, SOLAR=580 (satu baris).
   - **D2** — pastikan baris NULL-DTGLJAM ikut masuk: jumlah baris sales + omzet harian Bakau
     rekonsiliasi ke EasyMax **termasuk hari yang shift-3-nya baru di-keying** (bukti `--resync-sales` jalan).
   - **D3** — **INVESTIGASI**: cek apakah pelanggan `tm_plg` SJENIS **2 & 4** (dominan di Bakau) membawa
     saldo `tr_bppiut`/`tr_bphut`. Aturan RECAP live = Lokal{1,5}/Online{3} → **SJENIS 2/4 terabaikan**.
     **Bila mereka bersaldo: STOP & lapor owner** — jangan ubah aturan RECAP yang TERKUNCI diam-diam.

Selesai bila: probe10 cocok ke rupiah + row-count DB masuk akal + D1/D2/D3 clear (atau D3 di-flag ke
owner). Sampai itu, unit boleh dibiarkan `active=false` (soft) bila diminta.
