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

## Gain/Loss (G/L) — perhitungan & guard data

Perbaikan 2026-06-13 (akar masalah losses "ngawur" 1.744%):

- **Signed, bukan absolut.** `NVOLSELISIH` di EasyMax tersimpan ABSOLUT (0 dari
  28.994 baris negatif) → G/L dihitung ulang `NSTOCKOP − NSTOCKBK` (− = losses).
- **Opname PENUTUP, bukan semua sesi.** Opname terjadi ~3×/hari; G/L harian = baris
  terakhir per (tanggal-bisnis × tangki) — sesi pagi D+1 yang ditandai EasyMax
  `DTAGLOPN=D`. Sesi siang/malam intra-hari (terdistorsi timing pengisian) diabaikan.
  `getClosingOpname` ([queries.ts](src/lib/queries.ts)) + `aggregateClosingGl`
  ([derive.ts](src/lib/derive.ts)).
- **Garbage guard** (data quality, BUKAN losses) — dikecualikan dari KPI/alarm,
  dimunculkan sebagai anomali "kualitas data":
  - stok buku/fisik `> 100.000 L`, atau `< 0`;
  - `|selisih| > 50.000 L`;
  - volume DO `> 100.000 L` (mis. entri 452.729 L).
  Ambang ini **fisik** (tangki SPBU 20–40 KL), bukan ambang losses operasional —
  losses besar-tapi-mungkin (mis. −6.109 L) TIDAK disembunyikan, justru menyala merah.
- **Provisional** (edge-case hari berjalan): bila opname penutup D+1 belum terekam,
  G/L dihitung dari sesi terakhir tersedia + ditandai "provisional · opname penutup
  belum ada" — tidak menyesatkan diam-diam.
- **Konteks DO hari-sama** (informatif): anomali losses opname menampilkan volume DO
  yang diterima tangki itu di hari sama (mis. "terima DO 7.814 L hari ini") sebagai
  bantuan penyelidik menilai timing-vs-nyata. Tool TIDAK mengklasifikasi/mengecualikan
  berdasarkan ini — keputusan tetap di manusia.

> **Enhancement masa depan: rekonsiliasi delivery-vs-opname.** Selisih opname pada
> hari pengiriman bisa berupa selisih kiriman (DO declared vs real) atau losses nyata;
> korelasi delivery TIDAK konsisten (terbukti: T-02 terima 16k DO tetap +26; T-04
> −6.109 terima 7,8k) sehingga auto-klasifikasi sengaja TIDAK dibuat (berisiko mengubur
> shortfall/theft). Bila Domain DO/MyPertamina masuk pipeline, rekonsiliasi eksplisit
> (DO vs penerimaan vs opname) bisa memisahkan keduanya tanpa menebak.

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
