# @solamax/agent — Sync Agent EasyMax → Cloud

Agent ringan yang berjalan di LAN tiap SPBU: connect MySQL `easymax` **read-only**,
poll per domain via watermark, dan push batch ke backend `POST /ingest` (HTTPS + API key).
Buffer lokal + retry bila backend offline. Identik per unit — beda config + API key saja.

Lihat [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) untuk skema & kontrak.

## 🔒 Keselamatan read-only (berlapis)

1. **User MySQL `SELECT`-only** (lapisan utama — lihat cara buat di bawah).
2. **Guard kode** ([`src/db/readonly-guard.ts`](src/db/readonly-guard.ts)): setiap query yang
   dikirim agent diverifikasi hanya `SELECT/SHOW/DESCRIBE`, tanpa multi-statement. Satu-satunya
   pintu ke driver MySQL ([`src/db/mysql.ts`](src/db/mysql.ts)) memanggil guard ini. Agent
   **tak akan pernah** mengeksekusi `INSERT/UPDATE/DELETE/DDL` ke `easymax`.
3. **Driver**: `multipleStatements: false`.

## Membuat user MySQL `SELECT`-only (jalankan SEBAGAI ADMIN di server SPBU)

> MySQL 5.0.67. Jalankan di SQL Manager / mysql client dengan akun admin.

```sql
-- 1. Buat user khusus agent (ganti password kuat; JANGAN taruh di git).
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';

-- 2. Beri HANYA privilege SELECT pada database easymax (tak ada yang lain).
GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost';

-- 3. Terapkan.
FLUSH PRIVILEGES;

-- 4. Verifikasi: hasil HARUS hanya 'GRANT SELECT ON `easymax`.* ...'
SHOW GRANTS FOR 'readonly_sync'@'localhost';
```

Jika agent berjalan di mesin lain dalam LAN (bukan `localhost`), ganti host `@'localhost'`
menjadi IP/subnet yang sesuai dan pastikan `bind-address` MySQL mengizinkan — tapi **jangan
pernah ekspos MySQL ke internet** (agent push keluar, MySQL tetap di LAN).

## Setup

```bash
pnpm install                      # dari root repo
cp apps/agent/config.example.json apps/agent/config.local.json   # lalu isi (DI-GITIGNORE)
```

Isi `config.local.json` (host/port/user/baseUrl/interval/driver). Password & API key boleh
ditulis langsung di `config.local.json` (file machine-local, **di-gitignore**) — praktis
untuk mesin SPBU; atau via env yang **meng-override** isi file:

```bash
export SOLAMAX_MYSQL_PASSWORD='...'   # password user readonly_sync
export SOLAMAX_API_KEY='...'          # API key unit (dari backend, Fase 2)
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm --filter @solamax/agent test-connection` | **Langkah 1 wajib**: tes koneksi read-only + cetak versi MySQL & timezone. Tak menarik/mengirim data. |
| `pnpm --filter @solamax/agent dry-run` | Tarik 1 page per domain & **cetak ringkasan payload tanpa mengirim**. Aman untuk inspeksi. |
| `pnpm --filter @solamax/agent dev -- --once` | Satu siklus penuh (kirim ke backend), lalu keluar. |
| `pnpm --filter @solamax/agent dev` | Loop berkala (default 2 menit). Berhenti dengan Ctrl-C. |
| `pnpm --filter @solamax/agent build` | Compile ke `dist/`. Produksi: `node dist/index.js`. |

## 📦 Deploy ke mesin SPBU (Windows lama) — bundle + runbook

Mesin SPBU **tidak** menjalankan pnpm/build. Build di Mac, hasilnya satu folder yang
tinggal disalin & dijalankan:

```bash
pnpm --filter @solamax/agent bundle
# → apps/agent/bundle-out/  (+ apps/agent/solamax-agent-bundle.zip)
```

Isi `bundle-out/`: `solamax-agent.cjs` (agent + semua dependency dalam SATU file CJS,
target **Node 12+** — Windows 7-era OK), template `config.local.json`, dua launcher
dobel-klik (`1-tes-koneksi.bat`, `2-dry-run.bat`, output otomatis tersimpan ke
`output-*.txt`), dan salinan runbook.

**Panduan lengkap untuk yang menjalankan di mesin SPBU (non-developer, via Chrome Remote
Desktop): [`RUNBOOK-SPBU.md`](RUNBOOK-SPBU.md).** Termasuk pilihan versi Node per versi
Windows, pembuatan user `readonly_sync`, antisipasi kegagalan auth MySQL 5.0.67
(cek `panjang_hash` 41 vs 16, fix `old_passwords`, driver fallback `"driver": "mysql"`),
dan tabel troubleshooting per pesan error.

### Smoke-test = gerbang Fase 1 → 2

Agent ini ditulis & diuji dengan **mock** (worker tak punya akses DB sungguhan).
Yang dilaporkan balik dari mesin SPBU (detail di runbook Bagian H):
`output-tes-koneksi.txt` (versi Node + `koneksi MySQL OK` dgn version/timeZone/now),
`output-dry-run.txt` (jumlah baris per domain, **tanpa kirim**), versi Windows + bitness,
hasil `SHOW GRANTS` + `panjang_hash`.
