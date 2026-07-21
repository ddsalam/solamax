# Panduan Mesin SPBU Batu Layang (BL, `6478201`) — Phase 2c

> **Dijalankan OLEH OWNER di PC server SPBU Batu Layang** (via Chrome Remote Desktop).
> Cloud sudah SIAP: unit `unit_id=5`, tenant `pt-batu-layang-jaya`, secret
> `solamax-batulayang-agent-key` sudah ada & terverifikasi hash-nya lawan DB.
> Ikuti urut. **Ada 2 STOP-CHECK WAJIB (langkah 7 & 8) — kirim hasilnya sebelum lanjut.**
>
> 🟢 Semua langkah ke EasyMax bersifat **READ-ONLY**. Satu-satunya perubahan di mesin =
> pembuatan user MySQL baca-saja (langkah 2) + Task Scheduler (langkah 12).

---

## 1. Kenali mesin & pasang Node.js (5 mnt)

Klik kanan **This PC → Properties**, catat versi Windows + 32/64-bit.

| Windows di mesin                            | Node.js                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Windows 10 / 11 / Server 2016+              | Node 18.20.4 LTS (`node-v18.20.4-x64.msi` / `-x86.msi`)                 |
| Windows 7 / 8 / 8.1 / Server 2008 R2 / 2012 | Node 12.22.12 (`node-v12.22.12-x64.msi` / `-x86.msi`)                   |
| Windows XP / Server 2003                    | ✋ **BERHENTI — lapor dulu.** (Rencana B: agent di PC lain dalam LAN.)   |

Verifikasi di **Command Prompt baru**: `node --version` → harus keluar nomor versi.

## 2. User MySQL baca-saja (5 mnt)

Buka **SQL Manager**, login **admin/root**, jalankan **satu per satu**:

```sql
SET SESSION old_passwords = 0;
CREATE USER 'readonly_sync'@'localhost' IDENTIFIED BY 'SPBU6478201';
GRANT SELECT ON easymax.* TO 'readonly_sync'@'localhost';
FLUSH PRIVILEGES;
```

Konvensi password = `SPBU<kode unit>` → **`SPBU6478201`**. Hanya `SELECT`, tidak lebih.

## 3. Salin bundle ke folder LOKAL (3 mnt)

Bundle sudah di-build dari `main` yang dipromosikan (`eaa3142`):
`apps/agent/solamax-agent-bundle.zip` (11 file, flat, 13:48 21-Jul-2026).

- Transfer ke mesin BL, **extract ke `C:\solamax-agent`**.
- ⚠️ **JANGAN taruh di folder yang di-sync Google Drive / OneDrive** — file lock saat
  sync bikin agent gagal tulis.
- Setelah extract, `C:\solamax-agent\solamax-agent.cjs` harus ada.

## 4. Ambil API key (di Mac owner, BUKAN di mesin SPBU)

Di Terminal Mac:

```bash
gcloud secrets versions access latest --secret solamax-batulayang-agent-key
```

Salin nilainya langsung ke `config.local.json` di langkah 5. **Jangan pernah tempel
key ini ke chat, email, atau file yang ter-commit.**

## 5. Isi `config.local.json` (3 mnt)

Buka `C:\solamax-agent\config.local.json` di Notepad, ubah **4 baris**:

| Baris | Dari | Menjadi |
| --- | --- | --- |
| `unitCode` | `"GANTI_KODE_UNIT"` | `"6478201"` |
| `mysql.password` | `"GANTI_DENGAN_PASSWORD_readonly_sync"` | `"SPBU6478201"` |
| `backend.baseUrl` | `"https://dummy.invalid"` | `"https://solamax-ingest-staging-wn6i64kvza-et.a.run.app"` |
| `backend.apiKey` | `"dummy-belum-dipakai-sampai-fase-2"` | *(key dari langkah 4)* |

`timezone` biarkan `Asia/Pontianak`. Simpan.

## 6. Tes koneksi + dry-run (5 mnt)

Klik dua kali, berurutan:

1. **`1-tes-koneksi.bat`** → harus konek & sebut MySQL versi.
2. **`2-dry-run.bat`** → menarik payload semua domain **TANPA kirim**.

Kirim isi `output-tes-koneksi.txt` + `output-dry-run.txt`. Yang saya cek: view
`vw_jualplg`, `vw_usevouc`, `vw_edc3` ada, dan tiap domain berpayload.

---

## 7. 🛑 STOP-CHECK WAJIB #1 — Census DTGLJAM

> ✅ **Hasil BL 2026-07-21: 14.661 NULL / 165.852 total = 8,84% → kelas IB/Bakau.**
> Diperkuat bukti independen: dry-run `sales` mengembalikan
> `watermark_high: 2019-10-04T14:02:33Z` (watermark inkremental HIDUP; kelas AS =
> NULL permanen). → **Task bulanan TIDAK dipasang** (langkah 12 dilewati).

Di **SQL Manager** (read-only), jalankan:

```sql
SELECT COUNT(*) AS null_dtgljam FROM tr_djualbbm WHERE DTGLJAM IS NULL;
SELECT COUNT(*) AS total_baris   FROM tr_djualbbm;
```

**Kirim kedua angka.** Klasifikasi (saya yang tentukan, jangan ditebak):

- **Persentase kecil** (mis. KB 4,14%, pola NULL shift-3) → **kelas IB/Bakau** →
  watermark inkremental jalan → **task bulanan TIDAK dipasang**.
- **≈semua baris NULL** → **kelas AS** → sales 100% lewat rescan →
  **task bulanan `resync-bulanan.bat` WAJIB** (langkah 13).

## 8. 🛑 STOP-CHECK WAJIB #2 — Probe ATG

```sql
SELECT COUNT(*) AS n_tangki_atg FROM vw_realtm;
```

- **> 0** (mis. KB = 8) → ATG hadir → denah/tank-gauge live.
- **0 atau view tidak ada** → unit tanpa ATG (pola AS) → denah tangki **empty-state
  BY DESIGN**, `real_tank`=0. Bukan defect — dicatat sebagai karakteristik unit.

> ✅ **Hasil BL 2026-07-21: `vw_realtm` = 8 → ATG HADIR**, dikonfirmasi end-to-end oleh
> dry-run (`domain:"realtank", counts:{real_tank:8}`). Denah/tank-gauge BL **live**.

## 8b. Verifikasi identitas unit (RED FLAG bila beda)

```sql
SELECT * FROM tm_konfid;
```

> ⚠️ Tabel identitas SPBU di EasyMax bernama **`tm_konfid`** — **bukan** `tm_spbu`
> (tebakan salah di draf pertama runbook ini; `tm_spbu` tidak ada). EasyMax tidak punya
> tabel identitas yang DIBACA pipeline — `unitCode` murni dari `config.local.json` —
> jadi `tm_konfid` dipakai khusus sebagai cek-silang manual bahwa mesin ini memang
> unit yang di-provision di cloud.

Harus cocok **ketiganya**:
- `CSPBU` = **64.782.01** (= kode POS `6478201`)
- `VCNAMA` = **PT. BATU LAYANG JAYA** (= tenant `pt-batu-layang-jaya`)
- `VCALAMAT` / `CKOTA` = Batu Layang / PONTIANAK

Kalau ada yang beda — **BERHENTI dan lapor**, jangan "diperbaiki" diam-diam
(cloud sudah ter-provision dengan kode + PT ini).

✅ **Hasil BL 2026-07-21: cocok 3/3** (`64.782.01` · `PT. BATU LAYANG JAYA` ·
`Batu Layang, PONTIANAK`). `VCNAMA` sekaligus membuktikan keputusan tenant #4 benar.

> **Tunggu konfirmasi saya setelah langkah 7 + 8 sebelum lanjut ke 9.**

---

## 9. Backfill penuh (~1–1,5 jam)

Klik **`3-sync-once.bat`**, biarkan jalan sampai selesai.

- ⚠️ **Tidak mencetak apa pun sampai node exit** — jangan dikira hang.
  Progres saya pantau dari DB live, bukan dari console.
- `logs\agent-<tgl>.log` **hanya** ditulis `jalankan-agent.bat`, bukan sync-once.

## 10. Sweep satu-kali (setelah backfill selesai)

Buka **Command Prompt**, `cd C:\solamax-agent`, jalankan berurutan
(ganti `<hari-ini>` dengan tanggal hari itu, format `YYYY-MM-DD`):

```bat
node solamax-agent.cjs --resync-sales 2025-01-01 <hari-ini> --config config.local.json
node solamax-agent.cjs --deep-sweep tebus 600 92 --config config.local.json
node solamax-agent.cjs --deep-sweep delivery 600 92 --config config.local.json
```

(`600` = umur unit dalam hari + margin; saya sesuaikan setelah lihat rentang tanggal data.)

## 11. Task Scheduler (loop kontinu)

- Action: `C:\solamax-agent\jalankan-agent.bat`, **Start in**: `C:\solamax-agent`
- **Run whether user is logged on or not** + **Run with highest privileges**
- Trigger: **At startup**
- ⚠️ Kalau akun Windows **password-nya blank**, Windows **menolak** opsi
  "whether logged on or not". Fallback: **"Run only when user is logged on"** +
  trigger **"At log on"** + launcher VBS hidden (minta saya kalau kena ini).
- Setiap kali bundle di-swap: **End task → kill `node.exe` → Run**.

## 12. Task bulanan — ❌ TIDAK DIPASANG untuk BL

Census langkah 7 = **kelas IB/Bakau** → **lewati seksi ini.** (Instruksi di bawah
disimpan untuk unit berikutnya.)

### (referensi) HANYA bila census = kelas AS

Kalau (dan hanya kalau) census menunjukkan ≈semua NULL:

- Task **`SolaMax Resync Bulanan`** → `C:\solamax-agent\resync-bulanan.bat`
- Monthly, hari **1**, jam **03:30 WIB**. Aman berbarengan dengan loop (read-only + UPSERT idempoten).

## 13. Gold-check — oracle EasyMax

Setelah sync berjalan ≥1 hari penuh, di **Command Prompt** (BUKAN lewat .bat —
`jalankan-agent.bat` **tidak meneruskan argumen**, dan akan bentrok dengan task
yang sedang jalan):

```bat
cd C:\solamax-agent
node solamax-agent.cjs --probe10 <tgl1> <tgl2> <tgl3> <tgl4> <tgl5> --config config.local.json
```

- **Tanggal WAJIB ditulis eksplisit** — tanpa argumen, probe memakai tanggal
  **beku Juni 2026** dan hasilnya tak berarti.
- Saya kirim 5 tanggal spesifik (hari lengkap terakhir) saat waktunya.
- Kirim seluruh output; saya rekonsiliasi ke rupiah lawan sisi SolaMax.

---

## Yang saya butuhkan dari Anda (checklist balasan)

1. Versi Windows + 32/64-bit + `node --version`
2. Isi `output-tes-koneksi.txt` & `output-dry-run.txt`
3. **Census DTGLJAM: 2 angka** (langkah 7)
4. **ATG: 1 angka** (langkah 8)
5. Kode unit dari `tm_spbu` (langkah 8b)
6. Konfirmasi backfill selesai + Task Scheduler aktif
7. Output `--probe10` (langkah 13)

## Kredensial yang mungkin belum saya punya — minta ke Anda bila kepentok

- Password **admin/root MySQL** mesin BL (untuk langkah 2)
- Password akun **Windows** mesin BL (untuk Task Scheduler, langkah 11)
- Akses **Chrome Remote Desktop** ke mesin BL
