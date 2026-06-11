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

Isi `config.local.json` (host/port/user/baseUrl/interval). **Secret via env**, bukan di file:

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

## ✅ Checklist smoke-test di mesin SPBU (lewat remote desktop)

Agent ini ditulis & diuji dengan **mock** (worker tak punya akses DB sungguhan). Langkah
berikut untuk **Anda** jalankan langsung di komputer server SPBU Imam Bonjol:

- [ ] **0. Prasyarat.** Pasang Node.js ≥18 di mesin SPBU (atau jalankan dari laptop di LAN
      yang sama). Salin folder repo / hasil `build`.
- [ ] **1. Buat user `readonly_sync`** dengan SQL di atas; jalankan `SHOW GRANTS` →
      pastikan **hanya `SELECT`**.
- [ ] **2. Isi `config.local.json`** + export `SOLAMAX_MYSQL_PASSWORD`. (API key/baseUrl
      boleh dummy dulu — belum dipakai di tes koneksi & dry-run.)
- [ ] **3. Tes koneksi**: `pnpm --filter @solamax/agent test-connection`.
      ✅ Harus mencetak `koneksi MySQL OK` dengan `version: 5.0.67`, `timeZone`, `now`.
      ⚠️ **Bila handshake/auth gagal** (risiko MySQL 5.0 lawas) — catat error persis &
      laporkan; mungkin perlu opsi auth lawas / driver alternatif. **Ini gerbang Fase 1.**
- [ ] **4. Cek timezone**: konfirmasi `timeZone` & `now` = WIB (cocok jam dinding SPBU).
      Bila bukan, sesuaikan `timezone` di config.
- [ ] **5. Dry-run**: `pnpm --filter @solamax/agent dry-run`.
      ✅ Harus mencetak ringkasan jumlah baris per tabel (sales_header/detail, opname,
      delivery; kas kemungkinan 0 = normal/dorman). **Tidak ada data terkirim.**
- [ ] **6. Validasi angka** (opsional): bandingkan jumlah & beberapa nilai dengan tampilan
      EasyMax untuk shift terakhir → pastikan mapping benar.
- [ ] **7. Laporkan**: output langkah 3 & 5 (tempel apa adanya). Itu sinyal untuk lanjut ke
      Fase 2 (backend `/ingest`) — agar `--once` end-to-end bisa diuji ke backend nyata.

> **Catatan MySQL 5.0:** driver `mysql2` dikonfigurasi `insecureAuth: true` + `dateStrings: true`.
> Bila langkah 3 menolak auth, kemungkinan server pakai `old_passwords=1` (hash pra-4.1) —
> laporkan agar kita pilih jalur kompatibilitas yang tepat sebelum menulis lebih jauh.
