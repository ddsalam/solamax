# @solamax/dashboard — SolaMax Web (Next.js)

Implementasi pixel-faithful dari **SolaMax Design Spec** (bundle handoff di
[`design/easymax-board-dashboard/`](design/easymax-board-dashboard/)) di atas
SolaGroup Design System. **Read-only mutlak**: server components membaca Cloud SQL via
`pg` (SELECT murni) — nol form, nol mutasi. Logika status dari
[`src/lib/compliance.ts`](src/lib/compliance.ts) (tidak ada aturan baru di UI).

## Halaman (semua data nyata kecuali ditandai)

| Route | Layar spec |
|---|---|
| `/` | Hub Laporan & Analisa (shell + sidebar peran "Direksi") |
| `/board` | Ringkasan Grup BoD — verdict, 4 KPI, sparkline 14 hari, bauran NPSO/PSO vs target workbook, ranking unit (expand inline), feed anomali; state loading/empty |
| `/unit/[code]/laporan/[date]` | Laporan Operasional Harian — alarm 11 cek, omset/G-L per produk, kas, G/L kumulatif, target bulanan, DO, ketahanan stok, harga, pengeluaran, rekonsiliasi A–I; mode Ringkas/Lengkap |
| `/unit/[code]/rincian/[date]` | Rincian Penjualan — ledger arsip siap cetak (`@media print`), kop + tanda tangan |
| `/monitoring` · `/denah/[code]` · `/ketaatan` · `/anomali` | Jaringan live, denah tangki+nozzle, heatmap ketaatan 14 hari + strip kas dorman, feed anomali |

Token DS: [`src/styles/ds/`](src/styles/ds/) (salinan verbatim). Adherence lint:
`pnpm --filter @solamax/dashboard lint:ds` (oxlint, config DS) — **0 warning**.

## Panel → status data

✅ **Nyata (Cloud SQL)**: omset/volume/mix per produk & harian; sparkline & delta periode;
gain/loss harian+kumulatif & losses abnormal; bauran NPSO/PSO aktual; kepatuhan shift /
heatmap / banner kelengkapan / jam tutup shift; sinkron per unit; penerimaan BBM;
**sisa stok & ketahanan** (opname terakhir − penjualan + penerimaan sejak itu ÷ rata-rata
7 hari); koreksi ⟳ (SUBAH/SEDIT); pengeluaran kas (dorman → empty state bermakna + umur).

⚙️ **Config** ([`src/lib/config.ts`](src/lib/config.ts) — siap 7 unit): target bauran
per-unit×bulan & target volume L/hari per-produk×bulan (angka workbook 2026, pilot IB);
mapping kode unit → "64.781.11 — Imam Bonjol"; PT & alamat kop; kapasitas tangki
(kosong = denah tanpa fill%, ketahanan tetap tampil); klasifikasi PSO/NPSO.

🔲 **Empty state eksplisit** (menunggu Domain 4–7, gaya "belum tersedia" netral):
EDC; pelanggan/piutang & deposit; DO awal/sisa/penebusan/alokasi; Tera/nozzle-test;
harga beli & margin; setoran bank; pendapatan lain; rekonsiliasi B–I (verdict H=I netral);
6 dari 11 cek alarm (skor = "n/aktif · k menunggu data").

## Deviasi dari spec (disengaja, sesuai keputusan)

1. Landing + Login **ditunda** (butuh auth) — shell langsung terbuka, peran "Direksi".
2. BoD Mobile companion **ditunda** (konsep app native); web responsive seadanya.
3. Topbar "Tren" non-aktif ("menyusul") — halaman 4.1 belum didesain; "Anomali" → feed.
4. Data dummy spec (7 unit, EDC, dst) **tidak direplikasi** — panel memakai data nyata
   atau empty state; baris ranking/jaringan bertambah otomatis saat unit baru tersambung.
5. Heatmap ketaatan: 14 hari (spec) dengan agregat penjualan+opname; kas = strip dorman.

## Menjalankan untuk review

```bash
# Terminal 1: cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432
# (.env.local sudah berisi DATABASE_URL via proxy; gitignored)
pnpm --filter @solamax/dashboard dev   # → http://localhost:3000
```

Verifikasi cepat: `pnpm --filter @solamax/dashboard test` (22 unit test: compliance,
bauran/target workbook, stok/ketahanan, alarm, format unit) · `typecheck` · `lint:ds`.

## Produksi nanti

User Postgres read-only khusus dashboard + auth di depan (IAP/login) — dashboard berisi
data operasional, jangan publik. `output: "standalone"` siap container Cloud Run.
