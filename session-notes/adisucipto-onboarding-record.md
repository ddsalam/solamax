# Adisucipto (AS, 64.781.01 / `6478101`, unit_id 3) — Onboarding Record (LEDGER)

**Status: onboarding SELESAI 2026-07-17** — satu hari penuh, 5 fase ber-gate. Unit #3,
**tenant BARU `pt-sola-adis-raya` (PT Sola Adis Raya)** — onboarding lintas-PT pertama
(Option A). Pengawas: Sabandi (`sola.adis.raya@solagroup.co` — deviasi sengaja dari pola
`spbu<kode>…@`). Operasi mulai 2025-12-29 (~201 hari histori saat onboarding).

## Yang di-ship

- **PR #100** (→staging): config.ts entri AS (target NYATA workbook baris AS; TURBO 0
  Jan–Jun = target nyata) + label PT multi-tenant `ptLabelForUnits()` (hapus 4 hardcode
  "PT Sola Petra Abadi"; campuran lintas-PT → payung "SolaGroup") + tes cross-tenant
  fixture-free auto-skip + regresi byte-identik board-doc.
- **PR #101**: `rls-surfaces.integration.test.ts` jadi SELF-SEEDING (unit fiktif 8801/8802,
  `RLS_SURFACES_SEED_URL`; akar: fixture rehearsal RLS terkikis saat instance rlsstg
  di-repurpose utk rehearsal Bakau 2026-07-07).
- **PR #102** (staging→main, gate `pilot`): dashboard-staging **00055-2w8** = main `a6a3974`.
- **PR closer**: fix defect bundle (zip flat, `jalankan-agent.bat` + `resync-bulanan.bat`
  ter-generate, template `GANTI_KODE_UNIT`) + runbook unit-#4 (dokumen ini + 
  [`unit-onboarding-runbook.md`](unit-onboarding-runbook.md)).
- Cloud: tenant `pt-sola-adis-raya` + unit 3 live (tenant_id `f04922dc…` ≠ `80885713…`);
  secret `solamax-adisucipto-agent-key` v1. **Nol migrasi DB.**

## Bukti kunci

- **Isolasi lintas-tenant dua lapis**: RLS 4/4 (write-in-scope, cross-unit WITH CHECK
  reject, read isolation, fail-closed 0) + suite scope live 20/20 (AS AKTIF) + ingest E2E
  200/403/401. Grant riil Sabandi = pengawas/[3]/tenant baru + audit_log 09:21 WIB.
- **Gold-check EKSAK ke rupiah** 5 tgl (2026-07-12..16) × 5 seksi (OMSET n=36/hari;
  PELANGGAN; EDC non-blank 51/92/93/57/52 txn; EDC blank 1 txn 15-Jul Rp 1.612.000;
  DEPOSIT 0=0). Hari onboarding: 25.155 POST ingest, 100% HTTP 200.
- Backfill + 7 sweep tuntas dalam sesi mesin; visual pass T5 lulus dua sisi.

## Karakteristik per-unit AS (penting utk operasional)

1. **KELAS VARIAN #3 — NULL-by-default DTGLJAM**: SEMUA `tr_djualbbm.DTGLJAM` NULL di
   sumber (census 7.226). Watermark sales PERMANEN NULL (incremental `DTGLJAM IS NOT NULL
   AND > ?` = 0 baris selamanya, domains.ts:162); sales 100% dibawa rescan 7-hari/30-menit
   (SALES_RESYNC by DTGLJUAL; dtgljam disintesis tengah-malam WIB, domains.ts:257-262 —
   stored 7.214/7.214 midnight). Segar ≤ ~32 menit (bukti empiris hari-H). **Guard:** task
   bulanan `resync-bulanan.bat` (Monthly hari-1 03:30 WIB) menutup back-dating >7 hari;
   backlog gated = sales masuk Track 2 (rilis agent berikutnya, semua unit).
2. **Tanpa ATG**: `vw_realtm` kosong (owner-confirmed) → `real_tank` 0, domain realtank tak
   pernah dispatch, denah tangki empty-state BY DESIGN. Caveat `getLiveTankReconciliation`
   (dtgljam sintetis) moot sampai ATG dipasang.
3. **Domain dorman by-source**: cash, deposit, pelanggan_sale (penjualan pelanggan 100%
   voucher — voucher_sale 1.972), terra_resmi. EDC baru aktif 2026-02-25.
4. **SJENIS**: 4 pelanggan — piutang semua `sjenis=5` (∈ Lokal{1,5} ✓), hutang semua
   `sjenis=2` (terhitung KARENA hutang tanpa filter ✓). **Aturan RECAP terkunci HOLD** —
   nol perubahan. Saldo saat onboarding: Lokal 193.733.123 / Online 0 / hutang −17.462.700.
5. **Watch-item**: master dorman `BB-01 "PLK"` TAK terklasifikasi bila mulai dijual
   (CLASS_RULES tak match) — bauran/G-L akan mengecualikannya senyap. `BB-05 BIO SOLAR`
   dorman, aman (match SOLAR).
6. **Nozzle/nama bersih**: 12 nozzle tanpa collision; 0 varian nama produk per kode.

## Catatan operasional (keputusan owner, tercatat)

- **Accepted risk**: `config.local.json` (berisi API key live AS) sempat tersalin ke folder
  Google Drive shared saat sesi mesin. Owner memutuskan TIDAK rotasi; file **sudah dihapus
  dari share** (mitigated-by-removal). Rotasi bila ada tanda misuse (200 asing di log
  ingest di luar irama siklus mesin).
- `jalankan-agent.bat` di mesin AS = varian minimal TANPA log redirection → tidak ada
  `logs\` lokal; observability = log Cloud Run saja. Varian logging ter-generate ikut
  bundle berikutnya — swap saat bundle update berikutnya (End→Run restart wajib), tanpa
  sesi khusus.
- Defect bundle yang menggigit di T3 (zip nested `bundle-out/`, `jalankan-agent.bat` tak
  pernah ada di bundle, template unitCode = kode IB) — semua FIXED di PR closer.
