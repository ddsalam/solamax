# Runbook Onboarding Unit SPBU (unit #4 dst.) — distilasi arc IB → Bakau → Adisucipto

> Sumber: onboarding Bakau (2026-07-07, unit #2, same-tenant) + **Adisucipto/AS
> (2026-07-17, unit #3, TENANT BARU — arc lengkap 5 fase)**. Baca bersama
> [`bakau-live-provisioning-runbook.md`](bakau-live-provisioning-runbook.md) (template
> cloud-side per langkah) dan [`adisucipto-onboarding-record.md`](adisucipto-onboarding-record.md)
> (ledger AS). Onboarding = **config-only**: nol migrasi, nol perubahan kode produksi
> (kecuali entri `config.ts`).

## 0. Keputusan gate di depan (owner) — JANGAN dilewati

1. **Tenant: PT sama atau PT baru?** Ini keputusan #1 dan berdampak permanen.
   Aturan tunggal [`scope-rule.ts:35`](../apps/dashboard/src/lib/scope-rule.ts):
   `unit.tenant_id !== ctx.tenantId → tak terlihat`. Konsekuensi:
   - **PT sama** (pola Bakau): SEMUA direksi/admin_perusahaan tenant itu langsung
     melihat unit baru, tanpa grant.
   - **PT beda** (pola AS): INSERT `app.tenant` baru dulu, unit menunjuk tenant baru —
     isolasi total otomatis dua arah. **JANGAN salin baris "inherit IB tenant_id" dari
     template Bakau** — itu benar hanya untuk same-tenant.
2. Kode unit = ID Pertamina tanpa titik (64.781.01 → `6478101`); `unit_id` smallint manual
   (berikutnya yang kosong); pengawas + akun Google-nya; 12 bulan target workbook (baris
   unit di "Target SPBU SolaGroup 2026"); alamat kop.

## 1. Cloud-side (urutan teruji AS; ~30 menit di luar CI)

0. **🔴 SEBELUM MENULIS APA PUN — pastikan Anda di instance yang benar** (pelajaran BL):
   - **JANGAN mewarisi nomor port dari runbook.** Di sesi BL, port `5433` yang disebut
     runbook KB untuk `-rlsstg` ternyata **sudah dipakai proxy lain**. Cek dulu
     (`lsof -nP -iTCP:5433 -sTCP:LISTEN`), lalu jalankan proxy sendiri di port bebas
     (BL pakai `5434` = rlsstg, `5435` = live) dan **jangan pernah mematikan proxy yang
     bukan Anda yang start**.
   - **Assert identitas cluster sebelum WRITE apa pun** — satu query, tak bisa ditipu
     hostname/port: `SELECT system_identifier FROM pg_control_system();`
     (live `solamax-pg` = `7650126488674766864`, test `solamax-pg-rlsstg` =
     `7659054651798528016`). Tanda sekunder: unit 1 di rlsstg bernama `IB-equiv (synthetic)`.
   - Tulis guard sebagai blok `DO $$ … RAISE EXCEPTION $$` **di dalam transaksi**, bukan
     SELECT yang dibaca mata — prasyarat salah = transaksi abort, bukan bergantung operator
     menyadari.
1. **Preflight read-only**: `unit_id`/`code` bebas di live; slug tenant belum ada (bila PT
   baru); `timezone` ikuti baris unit live yang ada (konvensi: `Asia/Pontianak`).
2. **API key**: `node apps/backend/scripts/gen-api-key.mjs` → raw HANYA ke scratch
   gitignored; hash 64-hex ke DB. Raw → Secret Manager `solamax-<nama-unit>-agent-key`
   (`gcloud secrets create … && versions add`). Raw TIDAK pernah di chat/log/git/checklist.
3. **DB provisioning (psql as `ingest`; `public.unit` + `app.tenant` RLS-excluded, tanpa
   maintenance window)**: bila PT baru → INSERT tenant dulu; lalu INSERT unit menunjuk
   tenant yang benar. Verifikasi WAJIB dipaste sebagai evidence: daftar unit ⋈ tenant +
   `count(DISTINCT tenant_id)`. Rollback aman selama belum ada data: DELETE unit (+ tenant).
4. **Kode**: entri `config.ts` (UNIT_DISPLAY dgn `pt`+alamat kop, TARGET_BAURAN 4dp,
   TARGET_VOLUME_PER_DAY 12 bulan — cross-check angka parse vs angka owner, beda = STOP) +
   perluas tes scope pola fixture-free auto-skip
   ([`scope.adisucipto.integration.test.ts`](../apps/dashboard/src/lib/scope.adisucipto.integration.test.ts)
   = template cross-tenant; `scope.bakau…` = template same-tenant). **Guard absen WAJIB
   `return ctx.skip()`, JANGAN `return;` senyap** — vitest melaporkan return senyap sebagai
   ✓ PASS dgn nol assertion, sehingga "unit belum ada" tak terbedakan dari "isolasi
   terverifikasi" (ditemukan di BL: `scope.kotabaru` hijau 8/8 di `-rlsstg` padahal KB tak
   ada di sana). PR → `staging` →
   rehearsal `-rlsstg` → PR `staging`→`main` gated `pilot`. **Tanpa deploy manual.**
5. **Rehearsal `-rlsstg`** (bukti sebelum live): provision serupa di DB test + RLS proofs
   (write-in-scope OK / cross-unit WITH CHECK reject / read isolation / no-context=0) +
   suite scope `SCOPE_LIVE_DB=1` + smoke ingest E2E `200/403/401` dgn REHEARSAL key
   (bukan key live!) + `rls-surfaces` self-seeding 5/5 (`RLS_SURFACES_SEED_URL`).
   **Kontrak ingest (koreksi BL — jangan ulangi):** header auth =
   **`Authorization: Bearer <key>`**, BUKAN `x-api-key`
   ([`api-key.guard.ts`](../apps/backend/src/auth/api-key.guard.ts)) — header salah
   memberi `401 "API key tidak ada"` di SEMUA kasus, termasuk yang harusnya 200/403,
   sehingga terlihat seperti key/provisioning yang rusak. **`watermark_high` WAJIB ada**
   (`.nullable()`, bukan `.optional()` —
   [`ingest.ts:17`](../packages/shared/src/ingest.ts)) → kirim `null`; kalau tidak, 422
   muncul sebelum logika auth/scope sempat teruji. Payload DELETE-only yang sah:
   `{"unit_code":"…","domain":"delivery","watermark_high":null,
   "replace_window":{"from":"…","to":"…"},"tables":{}}`. Kolom mirror `sales_detail` =
   `nurut` + `dtgljam` (timestamptz NOT NULL); **tidak ada `dtgljual`** di mirror — nama
   itu hanya milik sumber EasyMax.
6. **OAuth test user** (Console, manual) + **grant pengawas via `/admin` SETELAH login
   pertama** (butuh baris `app.users`); direksi/admin PT baru: grant via `/admin` pilih
   tenant baru. Audit_log otomatis.

## 2. Machine-side (owner via CRD) — dgn pelajaran AS

1. Node 18 (mesin lama: lihat tabel RUNBOOK-SPBU) · MySQL user `readonly_sync` SELECT-only,
   password konvensi `SPBU<kode>`.
2. Bundle dari `main` yang sudah dipromosikan: `pnpm --filter @solamax/agent bundle`.
   Zip kini **FLAT** (fix defect AS) dan **berisi `jalankan-agent.bat` + `resync-bulanan.bat`
   ter-generate** — tidak ada lagi file buatan-tangan. `config.local.json`: `unitCode` WAJIB
   diganti (template sengaja `GANTI_KODE_UNIT`); apiKey dari
   `gcloud secrets versions access latest --secret solamax-<unit>-agent-key` di laptop owner.
3. **Cek dini WAJIB sebelum go-live** (STOP-and-report bila gagal — jangan improvisasi):
   - `1-tes-koneksi` + `2-dry-run` bersih; view `vw_jualplg`/`vw_usevouc`/`vw_edc3` ada.
   - **Identitas unit = `tm_konfid`** (koreksi BL — **`tm_spbu` TIDAK ADA** di EasyMax;
     itu tebakan yang salah): `SELECT * FROM tm_konfid;` → `CSPBU` (mis. `64.782.01`),
     `VCNAMA` (nama PT), `VCALAMAT`/`CKOTA`. Cocokkan **ketiganya** dgn kode + PT + alamat
     yang di-provision; beda = STOP. Catatan: pipeline **tidak pernah** membaca identitas
     unit dari EasyMax (`unitCode` murni dari `config.local.json`), jadi ini cek-silang
     manual — tapi `VCNAMA` sekaligus **membuktikan keputusan tenant** (di BL ia
     mengonfirmasi "PT. BATU LAYANG JAYA" = PT keempat, jadi tenant baru bukan asumsi).
   - **Census NULL-DTGLJAM (WAJIB — pelajaran AS):**
     `SELECT COUNT(*) FROM tr_djualbbm WHERE DTGLJAM IS NULL;`
     `0`/kecil = kelas IB/Bakau · **≈semua baris = kelas AS (NULL-by-default)** → task
     bulanan `resync-bulanan.bat` WAJIB (lihat RUNBOOK-SPBU seksi task bulanan).
   - **ATG**: `vw_realtm` berisi baris? Kosong = unit tanpa ATG (pola AS) → denah tangki
     empty-state BY DESIGN, `real_tank`=0 dan domain realtank tak pernah dispatch — bukan
     defect. Catat sebagai karakteristik unit.
4. Task Scheduler: `jalankan-agent.bat`, "Run whether user is logged on or not" + highest
   privileges, At startup; **setiap swap bundle → End task + kill node.exe + Run**.
5. Backfill lalu one-time sweeps (urutan AS): `--resync-sales <tgl-mulai-operasi> <hari-ini>`
   (WAJIB), `--deep-sweep tebus <hari> 92`, `--deep-sweep delivery <hari> 92`, lalu
   opname/tera/edc/pelanggan `<hari>` (= umur unit + margin; AS pakai 220).
6. Unit kelas AS: pasang task bulanan `SolaMax Resync Bulanan` → `resync-bulanan.bat`
   (Monthly hari-1 03:30 WIB; aman bersamaan loop — read-only + UPSERT idempoten).

## 3. Post-checks (Step-9 style) + evaluasi

- Suite scope live hijau (suite unit baru AKTIF, bukan skip); grant pengawas riil = unit
  yang benar; audit_log ada barisnya.
- Census per-domain `count(*)` + rentang tanggal ≈ umur unit; log ingest 0 4xx/5xx tak
  terjelaskan; revisi live = SHA main (image tag).
- **Cek mode sync sales (pelajaran AS): `sync_state.sales.last_watermark`** — maju = normal;
  **NULL permanen = kelas AS** (sales 100% via rescan 7-hari; segar ≤ ~32 mnt; back-dating
  >7 hari BUTUH resync bulanan). Jangan panik lihat watermark NULL — itu by-design untuk
  kelas ini.
- Gold-check `--probe10` **dengan tanggal eksplisit** (default beku Juni 2026!) ≥5 hari
  terakhir — cocok ke rupiah per seksi; domain dorman dijelaskan dgn bukti sumber, bukan
  di-skip. Karakterisasi: `CKDNOZZLE` collision (kode tabrakan = fold senyap), varian nama
  produk per kode, `SJENIS` vs aturan RECAP terkunci (Lokal{1,5}/Online{3} piutang; hutang
  TANPA filter — flag-only, `queries.ts:1175/1181` bukan milik onboarding), produk master
  dorman yang tak terklasifikasi (pola "PLK" AS).
- Visual pass owner: viewer tenant lama byte-identical; viewer unit baru = PT benar, nol
  kebocoran nama PT lain.

## 4. Backlog / peringatan tetap

- **[GATED, rilis agent berikutnya] sales masuk sapuan Track 2 tier2-full** — menutup lubang
  back-dating >7 hari di SEMUA unit (IB/BK juga terekspos; watermark inkremental mereka
  mengurangi tapi tidak meniadakan). Setelah itu `resync-bulanan` jadi cadangan. Rollout =
  bundle swap terkoordinasi + restart task semua mesin.
- Caveat `getLiveTankReconciliation` utk baris dtgljam sintetis (domains.ts:228-231): moot
  di unit tanpa ATG; hidup lagi bila ATG dipasang di unit kelas AS.
- Master dorman tak terklasifikasi (mis. "PLK"): bila mulai dijual, bauran/G-L
  mengecualikannya senyap — perlu penanganan nama/klasifikasi dulu.
