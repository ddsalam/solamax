# LEDGER — Audit & Fix "Sisa DO" SPBU 63.783.01 Bakau (2026-07-12)

Rekaman lengkap satu arc: investigasi → GATE A → GATE B → eksekusi → akseptasi.
Semua angka liter; tanggal WIB. Sumber sitasi untuk vault owner.

## Gejala & oracle

Laporan DO Harian Bakau menampilkan Sisa DO jauh di atas kenyataan (F12 EasyMax,
popup "Pengisian Tangki Manual" cari-No.SO): Solar 128 vs 48 KL, Pertalite 160 vs 48,
Turbo 24 vs 0, Dexlite 36 vs 4, P.Dex 8 vs 4 (per 2026-07-12 12:49). Overstate di
SEMUA produk mismatch, tak pernah understate; produk tanpa SO pun bersaldo.

## GATE A — akar masalah (compound, per-SO tertutup sampai ke liter)

Dekomposisi per-(CNOSO, produk) 67 baris; **mirror = F12 − 8.000 (1 open sejati
hilang) + 260.000 phantom = net +252.000** untuk 6 produk tampil (+1.176.000 PREMIUM
tak tampil). Bukti di `baseline-bakau-perso-pre-rescan.txt` + `probe-pack.sql`.

1. **Data sumber (dominan, ~232k dari 252k):** ledger EasyMax Bakau sendiri memuat
   SO tak-pernah-tutup sejak 2015 (penerimaan dibukukan ke nomor SO lain/salah;
   contoh nyata: typo 9-digit `406353785`, teks bebas `"LO KREDIT"`, SO gabungan
   `"4024332103/9355"` di penerimaan). Popup F12 MENYEMBUNYIKANNYA — terkonfirmasi
   owner: produk nonaktif (PREMIUM) tak pernah tampil; SO macet produk aktif juga
   tak tampil (mekanisme belum dipastikan). SolaMax menjumlah ledger penuh → beda.
2. **Celah desain sync (unit-generik, 64k+8k):** koreksi/pembatalan sumber pada
   baris ber-tanggal lebih tua dari jendela rescan TIDAK PERNAH sampai ke mirror
   (UPSERT tak menghapus). Kasus hidup: `TB202600136` cnoso `4062051479` dikoreksi
   owner menjadi `4062051864` — mirror tak bisa sembuh sendiri.
3. **Tidak terlibat:** formula per-SO (valid; IB cocok), RLS/scoping, idempotensi
   ingest, kelengkapan backfill (delivery 2015-08→kini 12.615 baris, CNOSO 100%
   terisi, 0 duplikat kunci).

Verdict hipotesis: H1 missing-receipts REFUTED · H2 broken-linkage REFUTED (sebagai
defek skema; human entry error CONFIRMED) · H3 tebus dobel REFUTED (mirror-side) ·
H4 stale-SO CONFIRMED (mekanisme dikoreksi: ledger sumber, bukan floor backfill) ·
H5 scope-bleed REFUTED. IB tak terdampak (riwayat EasyMax IB baru mulai 2022-09,
ledger bersih — itu sebabnya validasi 2026-06-26 tak menangkap kelas ini).

Fakta baru pasca-GATE A: owner membersihkan sumber (worklist §a) SEBELUM eksekusi —
sisa overstatement praktis tinggal kelas staleness-mirror, yang persis disembuhkan
Fix 2.

## GATE B — rencana disetujui (dengan modifikasi owner)

- **Fix 1 (dashboard):** headline Sisa DO TETAP ledger penuh (keputusan owner; tanpa
  aging cutoff); segmen "berjalan ≤30 hr" vs "macet >30 hr" (definisi = panel
  suspect, DO_STALE_DAYS) + footnote penjelas beda vs F12. Produk NONAKTIF = tak
  dipetakan tangki mana pun (aturan data, tanpa hardcode nama) → diringkas terpisah.
- **Fix 2 (sync):** `replace_window {from,to}` di payload /ingest (domain
  tebus/delivery saja; payload kosong = DELETE-only). Backend: advisory lock per
  (domain,unit) → DELETE jendela → UPSERT, satu transaksi. Sapuan Track-2 + CLI
  `--deep-sweep <domain> <days> [chunkDays]` memakainya → mirror = snapshot sumber
  per jendela. Idempoten; aman vs kelas race REPLACE-bersamaan (pola edc 2026-06-22).
- **Urutan deploy owner (rescan-first):** merge → TAHAN CD dashboard → backend
  manual → agent Bakau SAJA (IB ditunda) → rescan penuh → akseptasi data-layer →
  baru CD dashboard → visual.
- **Bar akseptasi:** Sisa DO == F12 segar per produk, 6/6 EXACT; residual apa pun
  diatribusi per-SO, tak dirasionalisasi. PREMIUM = satu-satunya sisa yang ditoleransi
  (disembunyikan aturan nonaktif).

## Eksekusi

- PR **#79** → `staging` (3 commit: shared+backend `9078fb0`, agent `011feda`,
  dashboard `057c6d8`), merge `a0b51f3`. PR **#80** (follow-up: tag `· nonaktif` di
  PDF anomali) menyusul.
- Backend manual: revisi **solamax-ingest-staging-00026-68b** (migrasi no-op; tanpa
  drift vs origin/staging; traffic agen lama 200 pasca-deploy = kompat mundur
  terbukti live).
- Agent Bakau: bundle swap + Task Scheduler End→Run; rescan penuh
  `--deep-sweep tebus 4200 92` + `--deep-sweep delivery 4200 92` (≈17:45–17:52 WIB).
- Dashboard CD (approval owner): revisi **solamax-dashboard-staging-00043-p9q**.

## Akseptasi Phase 4 (2026-07-12 malam)

**Bukti sapuan mendarat (Cloud SQL, bukan log):** sync_state tebus+delivery terbaru;
baris jendela Feb-2025 ber-`ingested_at` 17:48–17:49 WIB; header tebus 2.846→2.853,
delivery 12.615→12.616; baris open (SO,produk) 67→50.

**Mirror vs F12 segar (17:53 WIB):** Pertamax 0 ✓ · Pertalite 48.000 ✓ (3 SO exact) ·
Turbo 0 ✓ · Dexlite 4.000 ✓ · P.Dex 4.000 ✓ · **Solar 64.000 = 48.000 (2 SO exact ✓)
+ residual `4032788844` 16.000** (lihat bawah). Sub-cek bernama LULUS: `TB202600136`
SBATAL=1 tertangkap sapuan → phantom `4062051479` hilang (−64.000); header koreksi
`TB202600149`/`4062051864` hadir → open Solar sejati 8.000 muncul.

**Residual `4032788844` (bukan defek software):** tebus TB202500016 2025-02-03 Solar
48.000 sbatal=0 — DI-RE-PULL sapuan (ingested_at bukti mirror=sumber-kini); terima
32.000 Solar + 16.000 terbukukan ke Pertalite (PB202500124/135, salah produk saat
entry Feb-2025) → 16.000 Solar masih open di ledger sumber. Worklist §a #6, terlewat
saat pembersihan. Aksi owner di POS; sembuh otomatis ≤24 jam via sapuan nightly.

**PREMIUM residual:** 41 baris / 1.280.000 L — MEMBESAR karena koreksi diparkir ke
BB-01 (`4062010741` 40k, `4062051864`-BB01 32k, `4036449241` re-key 32k). Seluruhnya
tersembunyi dari total user-facing (aturan nonaktif); tampil hanya sbg ringkasan +
baris anomali bertag nonaktif.

**Regresi IB:** per-SO identik baseline modulo TEPAT 3 penerimaan live malam itu
(PB202601289/90/91, @18:25/19:19/19:20, masing2 8.000) — nol perubahan tak terjelaskan.
Laporan IB 07-09/10/11 render tanpa perubahan; rantai DO Awal(D)≡Sisa(D−1) utuh.

**Visual (pasca CD):** Bakau 07-12 — Solar `64.000` + sub-baris
`48.000 berjalan · ⚠ 16.000 macet >30 hr`; segmen berjalan ≡ F12 di 6/6 produk;
footnote baru; panel suspect: 1 baris aktif + ringkasan `39 SO · 1.208.000 L`
nonaktif; PDF identik layar (bukti visual; screenshot Chrome kosong — jendela
occluded malam hari, keterbatasan diketahui).

## Worklist §a — status akhir (arsip)

| # | SO | Produk | Open | Status akhir |
|---|---|---|---|---|
| 1 | 4062051479 | Pertalite+Solar | 64.000 | ✅ self-heal via rescan (dibatalkan sumber; koreksi = TB202600149/4062051864) |
| 2 | 406353785 (typo 9-digit) | Pertalite+Solar | 48.000 | ✅ DIHAPUS di sumber |
| 3 | 4061353785 | Pertalite+Solar | 16.000 | ✅ diterima penuh di sumber |
| 4 | 4060546316 | Turbo | 16.000 | ✅ DIHAPUS (salah produk; seharusnya Pertamax) |
| 6 | 4032788844 | Solar | 16.000 | ⏳ **MASIH OPEN di sumber** — aksi owner; gerbang penutup 6/6 |
| 5,7–19 | (lain-lain) | — | 116.000 | ✅ diselesaikan di sumber ("dst." owner) — terverifikasi hilang dari mirror pasca-rescan |

§b PREMIUM: informasional; lihat residual di atas. Catatan khusus `4060297050`
(PREMIUM, tebus Feb-2026, 56.000) tetap untuk admin.

## Gerbang penutup (6/6) — prosedur

1. Owner koreksi `4032788844` di EasyMax Bakau (16.000 penerimaan Feb-2025 salah produk).
2. Segera (tanpa tunggu nightly), di mesin Bakau:
   `node solamax-agent.cjs --deep-sweep tebus 540 92 --config config.local.json`
   `node solamax-agent.cjs --deep-sweep delivery 540 92 --config config.local.json`
   (540 hari menutup Feb-2025; BUKAN 4200 — tak perlu ulang 11,5 tahun.)
3. Verifikasi: dekomposisi per-SO == F12 segar 6/6; sub-baris macet Solar hilang;
   panel suspect Bakau 0 baris aktif; + cek kesehatan sapuan nightly (ingested_at
   jendela tier1 di jam off-peak 02–05 WIB).

## Follow-ups terbuka

1. **Rollout IB** (~2026-07-15/16, syarat Bakau bersih ±3 hari) — runbook:
   `ib-rollout-runbook.md` di direktori ini.
2. **tm_bbm.SAKTIF** — probe read-only `tm-bbm-saktif-probe.sql` (piggyback rollout
   IB); bila ada → rencana sync flag; bila tidak → aturan tangki permanen.
3. Floor sapuan tier2 ROLLING 1095 hari — koreksi sumber >3 th butuh sapuan manual
   (limitasi diterima GATE 6, kini juga menyangkut delete-capture).
4. CD backend ber-approval (saran lama DEPLOY-GCP.md).
5. Opsional: `replace_window` untuk domain rawan-koreksi lain (opname/cash).

## Berkas di direktori ini

- `probe-pack.sql` — semua probe read-only (dekomposisi, H1–H5, matcher kandidat, akseptasi).
- `baseline-ib-perso-pre-fix.txt` · `baseline-bakau-perso-pre-rescan.txt` ·
  `after-bakau-perso-post-rescan.txt` — snapshot beku.
- `ib-rollout-runbook.md` — instruksi operator IB + verifikasi.
- `tm-bbm-saktif-probe.sql` — probe flag produk.
