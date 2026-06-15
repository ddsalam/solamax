# Rencana Implementasi Design Handoff — Fase A (menunggu OK)

Sumber: `design/easymax-board-dashboard/` (Design Spec + Laporan Operasional Harian +
Rincian Penjualan Harian + App Flow + SolaGroup DS). Dibaca penuh, termasuk script
data-dummy tiap prototipe (logika status, format angka, dan semua state demo).

**Prinsip implementasi (sesuai instruksi):** pixel-perfect terhadap output visual;
token DS dipasang lebih dulu; data layer existing dipertahankan (server components +
`pg`, SELECT murni, `compliance.ts` dipakai ulang); panel Domain 4–7 = empty state
eksplisit ala spec; read-only mutlak — elemen "input" di spec (pemilih unit/tanggal,
toggle, chip periode) hanyalah kontrol navigasi/presentasi, bukan mutasi.

---

## (a) Peta panel/halaman spec → komponen Next.js + route

### Cakupan layar (lihat Ambiguitas №1)

| # | Layar di spec | Route Next.js | Status desain |
|---|---|---|---|
| L1 | BoD — Ringkasan Grup (web, §05) | `/board` | penuh (3 state: normal/loading/empty) |
| L2 | Laporan Operasional Harian | `/unit/[code]/laporan/[date]` | penuh (4 state) |
| L3 | Rincian Penjualan Harian (cetak) | `/unit/[code]/rincian/[date]` | penuh (print CSS) |
| L4 | Shell aplikasi + Hub + Monitoring (App Flow §3–4) | layout + `/` (hub) + `/monitoring/{jaringan,denah/[code],ketaatan,anomali}` | penuh |
| — | Landing & Login (App Flow §1–2) | **usul: TIDAK sekarang** | penuh, tapi butuh auth yang belum ada |
| — | BoD Mobile companion (§06, iOS frame) | **usul: TIDAK sekarang** | konsep app native |
| — | Persona Pengawas/Admin/Ops penuh | — | spec §08: "menyusul" — belum didesain |

### L4 — Shell (semua halaman)

| Panel spec | Komponen | Data |
|---|---|---|
| Topbar: logo, divider, "SolaMax", chip peran, dot pulse "data terakhir masuk", Keluar | `AppShell/Topbar` | `sync_state.max(last_run_at)` nyata; chip peran statis "Direksi" (tanpa auth); "Keluar" disembunyikan dulu |
| Sidebar 232px menu per peran + badge anomali + catatan kaki | `AppShell/Sidebar` | menu: Hub, Monitoring (badge = count anomali merah nyata), Ketaatan |
| Hub: step strip 1-2-3-4, unit+tanggal picker (URL state), banner "belum lengkap", 3 kartu tujuan, CTA monitoring | `app/page.tsx` + `HubCards` | unit nyata dari `unit`; banner dari kelengkapan modul nyata |

### L1 — `/board` (Ringkasan Grup BoD)

| Panel spec | Komponen | Data |
|---|---|---|
| Verdict kalimat + chip masalah | `board/Verdict` | derived nyata: losses abnormal (opname), NPSO vs target (target=config), shift bolong, kas dorman |
| Segmented periode Hari ini/7/30 | `PeriodChips` (client, URL param) | nyata |
| 4 kartu KPI: Omset (+delta vs periode sebelumnya), Volume G/D, Gain/Loss %, Kepatuhan x/y | `board/KpiRow` | nyata (delta dihitung dari periode pembanding; G/L dari `opname.nvolselisih` vs volume) |
| Sparkline tren omset 14 hari (SVG polyline+area) | `board/TrendSpark` | nyata |
| Bauran NPSO/PSO 2 kartu: bar per unit + tick target + delta pt | `board/RatioPanel` | rasio nyata per unit; **target & garis tick = config** (№3) |
| Ranking 7 unit: tabel grid 8 kolom, klik = expand inline (produk bars, spark 14 hari, catatan, link laporan) | `board/RankingTable` (client expand) | nyata; "catatan" derived dari compliance+selisih+koreksi |
| Feed Anomali & exception (5 jenis) | `AnomalyFeed` (dipakai juga di /monitoring/anomali) | nyata: losses abnormal, kas dorman (permanen, umur), shift belum input, koreksi ⟳ (SUBAH/SEDIT), stok kritis (**empty sampai kapasitas/Domain stok masuk** — №5) |
| State loading (skeleton) & empty ("Belum ada data… Lihat kemarin") | `BoardSkeleton`, `BoardEmpty` | sesuai spec |
| Footer sumber + zona waktu | `PageFooter` | statis |

### L2 — `/unit/[code]/laporan/[date]` (Laporan Operasional Harian)

| Panel spec | Komponen | Data |
|---|---|---|
| Toolbar: unit select, date, Ringkas/Lengkap, link Rincian, Export PDF (`window.print`) | `laporan/Toolbar` (client, URL state) | nyata |
| Header: kode/nama unit, tanggal bisnis + jam tutup shift, skor alarm, omset | `laporan/Header` | nyata (jam tutup = max dtgljam hari itu) |
| Banner "belum lengkap x/9 modul" | `PartialBanner` | nyata (modul terisi vs daftar) |
| **Alarm Indikator 11 cek** ✓/✗ + nilai | `laporan/AlarmPanel` | campuran: ① losses harian ② losses bulanan = nyata; ③ setoran ④ target/alokasi ⑤ DO ⑥ pengesahan ⑦ harga beli ⑧ piutang ⑨ DO besok ⑩ permintaan ⑪ EDC = **netral "belum tersedia"** (№6) |
| Tabel Omset/G-L/Tera per produk + TOTAL + catatan bauran | `laporan/SalesTable` | sales & G/L nyata; **Tera = "—"** (tak ada di pipeline) |
| Ringkasan Kas 5 kartu | `laporan/KasCards` | Pengeluaran = kas (dorman → empty); 4 lainnya Domain 4–7 → empty card |
| Saldo Hutang/Piutang | `EmptyPanel` bergaya spec | Domain Deposit — empty |
| G/L Kumulatif bulan (per produk + status aman) | `laporan/GlKumulatif` | **nyata** (agregat opname bulan berjalan) |
| Realisasi & Target Bulanan | `laporan/TargetTable` | kumulatif/rata-rata/penerimaan nyata; alokasi+selisih = config/empty (№3) |
| Laporan DO Harian | `laporan/DoTable` | penerimaan (delivery) nyata; DO awal/penebusan/sisa = empty kolom |
| Alokasi Penerimaan Tidak Sesuai | `EmptyPanel` | butuh alokasi — empty |
| Sisa & Ketahanan Stock & DO + banner usulan | `laporan/StockTable` | **sisa stok & ketahanan nyata-estimasi** (opname terakhir − penjualan sejak itu; ketahanan = ÷ rata-rata 7 hari); kolom DO/plan/usulan = "—" |
| Harga Beli/Jual & Margin | `laporan/HargaTable` | jual nyata; beli/margin = "—" |
| Pelanggan piutang hari ini | `EmptyPanel` | empty |
| Pengeluaran Harian | `laporan/PengeluaranTable` | kas nyata (dorman → empty state + umur) |
| Pendapatan Lain-Lain | `EmptyPanel` | empty |
| EDC | `EmptyPanel` | empty |
| **Summary Rekonsiliasi A–I** + panel verdict H=I | `laporan/Rekonsiliasi` | A nyata; B,C,D,F,G,I = "belum tersedia" → verdict netral "menunggu Domain 4–7" (№6) |

### L3 — `/unit/[code]/rincian/[date]` (dokumen cetak)

| Panel | Komponen | Data |
|---|---|---|
| Toolbar no-print (unit/tanggal/sembunyikan kosong/cetak) | `rincian/Toolbar` | nyata |
| Kop (nama, alamat, PT, logo) + judul + tanggal | `rincian/Kop` | alamat/PT = **config per unit** (№8) |
| Section 1 OMSET (nyata) · 2 PELANGGAN · 3 EDC · 4 PENDAPATAN LAIN · 5 NON TUNAI · 6 PENGELUARAN (kas) — ledger grid 4 kolom, "Tidak ada transaksi…" utk kosong | `rincian/LedgerSection` | 1 nyata; 2–5 empty; 6 kas dorman/empty |
| SUMMARY A–I + status cocok | reuse `Rekonsiliasi` varian ledger | seperti L2 |
| Blok tanda tangan + footer "dicetak …" | `rincian/Signatures` | statis |
| `@media print` (sembunyikan toolbar, lepas card) | CSS | sesuai spec |

### L4 — Monitoring

| Panel | Komponen | Data |
|---|---|---|
| Tabs segmented Jaringan/Denah/Ketaatan/Anomali | layout `/monitoring` | — |
| Jaringan: tabel 7 unit (sinkron · omset hari ini · stok · input) | `mon/NetworkTable` | sinkron = `sync_state` **nyata**; omset & input nyata; stok = estimasi/empty (№5) |
| Denah tangki: kartu silinder fill% + ketahanan + chip nozzle + alert kritis | `mon/TankMap` | tangki+nozzle mapping nyata; volume estimasi nyata; **fill% hanya bila kapasitas di config** (№5) |
| Heatmap ketaatan 7×14 + strip "KAS DORMAN 7,2 TAHUN" + panel klik per modul | `mon/Heatmap` | **nyata penuh** (compliance.ts) — pengganti matriks lama |
| Feed anomali | reuse `AnomalyFeed` | nyata |

Halaman lama (`/` overview lama & `/unit/[code]` lama) **diganti total**; query layer
(`lib/queries.ts`) diperluas, tidak dibuang.

---

## (b) Wiring token design system

1. Salin verbatim `_ds/solagroup-design-system-*/tokens/*.css` + `base.css` + `styles.css`
   → `apps/dashboard/src/styles/ds/` (sumber kebenaran token; tidak diedit).
2. Import di `app/layout.tsx` SEBELUM stylesheet lain; `globals.css` lama (tema gelap)
   **dibuang**, diganti CSS komponen yang hanya memakai `var(--…)` + kelas tipografi DS
   (`.text-h3`, `.text-caption`, dst dari `styles.css`).
3. Tanpa Tailwind — prototipe memakai inline style + token; saya tulis CSS file per
   komponen (`*.module.css`/global section CSS) dengan token yang sama, nilai px halus
   (grid kolom, tinggi sparkline) disalin persis dari spec.
4. Aset: `assets/solagroup-logo.png` → `public/solagroup-logo.png`.
5. **Adherence lint**: salin `_adherence.oxlintrc.json` → `apps/dashboard/.oxlintrc.ds.json`,
   script `lint:ds` = `oxlint -c .oxlintrc.ds.json src/`. Aturannya menyapu literal JSX
   (hex mentah / px mentah / font non-SF-Pro) — strategi: semua styling di file CSS,
   JSX bebas literal warna/px → lulus warn-free. Target: **0 warning**.
6. Font: DS memakai system stack (`-apple-system, … "SF Pro Text"`) — tidak ada file font
   untuk di-bundle (manifest: `no-file`); cukup token `--font-sans`.

## (c) Tabel panel → sumber data → status

Domain di Cloud SQL sekarang: **penjualan, opname, terima(delivery), kas (dorman),
masters (product/nozzle/tangki/account), sync_state.**
Belum di pipeline (= empty state): **EDC · Deposit/Piutang pelanggan · DO/alokasi/
penebusan · Tera/nozzle-test · harga beli · setoran bank · target bulanan ·
kapasitas tangki (tb_realtank/tm_tangki detail).**

| Panel | Sumber | Status |
|---|---|---|
| Verdict, KPI omset/volume, sparkline, ranking, drilldown produk/spark | sales_header+detail, product | ✅ nyata |
| Gain/Loss harian/kumulatif, losses abnormal | opname (nvolselisih, nstockbk) | ✅ nyata |
| Kepatuhan shift/heatmap/banner kelengkapan/jam tutup shift | sales (nshift, dtgljam), opname, cash + compliance.ts | ✅ nyata |
| Sinkron per unit (topbar, jaringan) | sync_state | ✅ nyata |
| Penerimaan BBM (DO harian kolom penerimaan, target kolom penerimaan) | delivery | ✅ nyata |
| Sisa stok & ketahanan | opname terakhir − penjualan sejak itu ÷ rata-rata 7 hari | ✅ nyata (estimasi, diberi label "dihitung dari opname …" sesuai spec) |
| Pengeluaran harian, ringkasan kas-pengeluaran, pendapatan-lain dari kas | cash_header/detail + account | ✅ struktur nyata — dorman → empty + umur (fitur) |
| Koreksi ⟳ (revisi totalisator) | sales_detail subah/sedit | ✅ nyata |
| Bauran NPSO/PSO rasio | sales by product + mapping produk | ✅ nyata; **target = config** |
| Klasifikasi PSO/NPSO, gasoline/gasoil | mapping nama produk (config) | ⚙️ config (№4) |
| Target/alokasi bulanan, tick target rasio | — | ⚙️ config kosong → tampil "—" sampai diisi |
| Alarm: setoran, DO, harga beli, piutang, EDC, pengesahan (6 dari 11) | Domain 4–7 | 🔲 netral "belum tersedia" |
| EDC, Pelanggan/piutang, Deposit, Pendapatan lain, Setoran bank, Rekonsiliasi B–I, DO awal/sisa/penebusan/alokasi, Tera, harga beli/margin, fill% tangki & stok kritis | Domain 4–7 / kapasitas | 🔲 empty state gaya spec ("Tidak ada transaksi…" / kartu "Belum tersedia di pipeline — Domain x") + catatan README |

## (d) Ambiguitas — mohon jawaban sebelum Fase B

1. **Cakupan**: usul implement L1–L4 (4 layar web yang didesain penuh); **Landing+Login
   ditunda** (butuh auth — belum ada di scope read-only) dan **BoD Mobile ditunda**
   (companion app native; web tetap usable di mobile seadanya). Setuju?
2. **Routing tanpa auth**: `/` = Hub, `/board` = Ringkasan Direksi, sidebar selalu tampil
   (peran efektif "Direksi" — melihat semua). Halaman lama diganti total. Setuju?
3. **Target NPSO/PSO & alokasi bulanan** tidak ada di DB → file config
   `src/lib/targets.ts` (default: gasoline 30%, gasoil 15%, alokasi kosong) yang Anda
   edit manual sampai ada sumber resmi. Setuju?
4. **Mapping produk**: PERTALITE→PSO-gasoline; SOLAR/BIO SOLAR→PSO-gasoil;
   PERTAMAX & TURBO→NPSO-gasoline; DEXLITE & PERTAMINA DEX→NPSO-gasoil. Benar?
5. **Kapasitas tangki** tidak di DB → fill% silinder & "stok kritis <1,5 hari" butuh
   kapasitas: sediakan slot config per tangki (kosong = kartu tanpa fill%, ketahanan
   tetap tampil). Setuju, atau tunda seluruh denah jadi empty state?
6. **Cek alarm & komponen rekonsiliasi tanpa data**: tampil netral abu-abu
   "— belum tersedia (menunggu Domain x)" alih-alih ✓/✗ palsu; skor alarm jadi "n/5
   dari cek yang aktif". Setuju?
7. **Kode unit**: spec memakai format titik ("64.781.11") — DB menyimpan `6478111`.
   Usul: tampilkan apa adanya dari DB (tanpa titik). Setuju?
8. **Alamat & PT per unit** (kop Rincian) tidak ada di DB → config per unit (pilot: isi
   Imam Bonjol; lainnya placeholder). Mohon konfirmasi teks PT/alamat IB, atau saya
   pakai milik prototipe dulu.
9. **Nav "Tren" di topbar Board** (halaman 4.1 belum didesain): tampil non-aktif
   ("menyusul") dan "Anomali" menaut ke `/monitoring/anomali`. Setuju?

## Definisi selesai (sesuai instruksi Anda)

Semua panel L1–L4 hadir (nyata atau empty eksplisit) · token terpasang & `lint:ds`
0 warning · typecheck + seluruh test hijau · `/`, `/board`, laporan, rincian,
monitoring ter-render terhadap Cloud SQL staging · ringkasan deviasi + tabel status
data di README. Commit ke `claude/initial-setup`; tanpa push/deploy/rotasi.
