# RUNBOOK — Backfill Domain `tebus` (Penebusan DO) ke Staging

Mengaktifkan domain **`tebus`** (Penebusan DO; `tr_htebus ⋈ tr_dtebus`) end-to-end di
**staging**: dari mesin SPBU → `/ingest` → Cloud SQL. Basis kolom **Penebusan DO** +
running-balance **DO Awal/Sisa** di Laporan DO Harian.

> 🟢 **READ-ONLY ke EasyMax.** Agent hanya `SELECT` dari `easymax`. Tak ada tulisan ke
> sumber. Penulisan hanya ke Cloud SQL (lewat `/ingest`), tabel baru `tebus_*`.

## Urutan WAJIB (jangan dibalik)

```
① migrate 0009  →  ② redeploy backend ingest  →  ③ backfill dari SPBU  →  ④ verifikasi live  →  ⑤ (GATE 4) deploy dashboard
```

Alasan urutan:
- **② sebelum ③**: image `solamax-ingest-staging` yang ter-deploy SEKARANG belum kenal
  domain `tebus` → `/ingest` akan **422-menolak** payload tebus (`IngestPayload.safeParse`).
  Backend HARUS di-redeploy lebih dulu. **Aman**: tak ada yang membaca `tebus` (dashboard
  masih `DOMAIN.do=false`).
- **⑤ paling akhir**: image dashboard `DOMAIN.do=true` TAK boleh tayang sebelum `tebus`
  terisi & terverifikasi — kalau tidak, kolom DO staging tampil salah.

---

## ① Migrate 0009 (worker, out-of-band) — PRASYARAT
`prisma migrate deploy` migrasi `0009_tebus_do` ke Cloud SQL staging (additive: CREATE
TABLE `tebus_header`/`tebus_detail`). CD TIDAK menjalankan migrate. Konfirmasi kedua tabel
ada sebelum lanjut.

## ② Redeploy backend `solamax-ingest-staging` (worker) — PRASYARAT
Image ingest baru harus memuat kode `tebus` (shared `DOMAINS+"tebus"` + table-config).
Build **`--platform linux/amd64`** (Apple Silicon → arm64; Cloud Run butuh amd64), lalu
`gcloud run deploy solamax-ingest-staging` (lihat [`DEPLOY-GCP.md`](../backend/DEPLOY-GCP.md)).
Verifikasi `/healthz`-equivalent hidup. **Belum ada perubahan yang terlihat user** — ini
murni mengaktifkan penerimaan domain baru.

## ③ Backfill `tebus` dari mesin SPBU (owner, on-site)

**3a. Build bundle agent baru (di Mac):**
```bash
pnpm -r build                       # shared dulu (berisi domain tebus)
pnpm --filter @solamax/agent bundle # → apps/agent/bundle-out/solamax-agent.cjs
```

**3b. Swap bundle di mesin SPBU — ⚠️ RESTART WAJIB.**
Ikuti **Bagian I** [`RUNBOOK-SPBU.md`](RUNBOOK-SPBU.md): cadangkan `.cjs` lama → timpa HANYA
`solamax-agent.cjs` (JANGAN sentuh `config.local.json`) → **End** task + akhiri `node.exe` →
**Run**. Tanpa restart, domain `tebus` **tak tersinkron diam-diam** (gotcha 16 Jun 2026).

**3c. Full backfill otomatis.** `watermark.json` di mesin SPBU **belum punya key `tebus`** →
`syncTebus` mulai dari `EPOCH_DATE` → menarik **seluruh** `tr_htebus` sejak tebusan pertama
(origin sejati untuk running-balance). Tak perlu mengutak-atik watermark. Cukup biarkan satu
siklus penuh jalan.

**3d. Konfirmasi terisi.** Di log agent SPBU: cari `ingest ok … "domain":"tebus"` dan
**TAK ADA `422`** (422 = backend belum di-redeploy → ulangi ②). Lalu cek baris di Cloud SQL
(read-only, worker via proxy):
```sql
SELECT count(*) FROM public.tebus_header WHERE unit_id=1;  -- perkiraan ~1.391
SELECT count(*) FROM public.tebus_detail WHERE unit_id=1;  -- perkiraan ~2.450
SELECT min(dtgltbs), max(dtgltbs) FROM public.tebus_header WHERE unit_id=1;
```

## ④ Verifikasi 4-kolom penuh vs 7 PNG (worker) — GATE 4
Jalankan `getDoHarian` **live** untuk Imam Bonjol 18–24 Juni 2026; tabel kode-vs-PNG per hari
(6 produk × 4 kolom + TOTAL). Buktikan:
1. **Penebusan DO** (`Σ tr_dtebus.NVOLUME`, SBATAL=0) **== kolom Penebusan PNG** per produk/hari.
2. **Origin=0**: cumulative-dari-awal ⇒ DO Awal 18 Jun = PNG. Jika selisih KONSTAN per-produk →
   ukur **δ**, isi `DO_SEED[produk]` di `config.ts`, render ulang, tunjukkan match (δ diukur
   dari PNG, bukan ditebak).
3. **Resolusi by-name**: Penebusan memetakan `CKDBBM`→produk lewat **nama master** (master live
   `Pertamina Dex=BB-08, Pertalite=BB-07`; mapping by-code akan SALAH). Kode `getDoHarian` join
   `product.vcnmbbm` → aman; konfirmasi di hasil.
4. **TOTAL** = true-sum 6 produk; bila beda dari TOTAL PNG, itu bug penjumlahan PNG
   (PNG mengecualikan Pertamina Dex) — **tandai**; per-produk tetap 100% cocok.

## ⑤ Deploy dashboard (hanya setelah GATE 4 hijau)
PR ke `staging` → merge → CD build+deploy image dashboard (`DOMAIN.do=true`). **Jangan merge
sebelum ④ hijau.**

---

# ADDENDUM — Migrasi 0010 `CNOSO` + re-backfill (model per-SO)

Mengaktifkan **per-SO open-balance** (logika F12): kolom `CNOSO` (No. SO Pertamina) di
`delivery` **dan** `tebus_header` jadi kunci join penerimaan↔penebusan. Menghapus
kebutuhan δ-seed.

Urutan (pola sama):
```
①0010 migrate  →  ② redeploy backend ingest  →  ③ re-backfill delivery+tebus  →  ④ verifikasi per-SO  →  ⑤ deploy dashboard
```

## ①0010 — migrate (worker, out-of-band)
`prisma migrate deploy` migrasi `0010_cnoso` (additive `ALTER TABLE … ADD COLUMN cnoso CHAR(20)`
×2). Aman live (instan, tanpa rewrite). Konfirmasi kolom ada:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('delivery','tebus_header') AND column_name='cnoso';
-- harus 2 baris
```

## ②0010 — redeploy backend ingest (worker)
Build+deploy `solamax-ingest-staging` (`--platform linux/amd64`) dari branch ini → ingest
menerima kolom `cnoso`. **Wajib sebelum ③** (gotcha 0009: backend lama abaikan kolom baru).

## ③0010 — re-backfill `delivery` + `tebus` (owner, mesin SPBU) — ⚠️ RESET 2 WATERMARK
Baris lama ber-`cnoso=NULL` sampai ditarik ulang. Re-pull penuh, UPSERT by PK mengisi `cnoso`.

1. **Swap bundle baru** `apps/agent/bundle-out/solamax-agent.cjs` (sudah ber-CNOSO) — Bagian I
   (cadangkan, timpa, **JANGAN** sentuh `config.local.json`).
2. **Reset 2 watermark** sebelum start: buka `C:\solamax-agent\data\watermark.json` di Notepad,
   **hapus baris `"delivery": …` dan `"tebus": …`** (sisakan domain lain), Save.
   *(Fallback bila ragu edit JSON: rename `watermark.json` → `watermark.bak` — semua domain
   re-backfill, idempoten, hanya lebih berat sekali.)*
3. **RESTART loop** (Task Scheduler End → akhiri `node.exe` → Run).
4. Siklus pertama re-pull penuh delivery (~8k) + tebus (~1.4k), isi `cnoso`.

**Konfirmasi terisi** (read-only via proxy; ADC: `gcloud auth application-default login` dulu):
```sql
SELECT count(*) FILTER (WHERE cnoso IS NOT NULL)::int terisi, count(*)::int total FROM delivery WHERE unit_id=1;
SELECT count(*) FILTER (WHERE cnoso IS NOT NULL)::int terisi, count(*)::int total FROM tebus_header WHERE unit_id=1;
-- terisi harus ≈ total (P2 dulu: 0 receipt ber-CNOSO kosong)
```

## ④0010 — verifikasi per-SO (worker) — GATE 3 (TANPA δ-seed)
`getDoHarian` v2 live, IB 18–24 Jun, 6 produk × 4 kolom + TOTAL **tanpa** δ-seed → cocok PNG
angka-per-angka (residu Dexlite 18–19 Jun diterima). Panel "Alokasi Penerimaan Tidak Sesuai"
tampilkan orphan (~30) + over-receipt. `recon ≠ 0` → baris ⚠.

## ⑤0010 — deploy dashboard (hanya setelah GATE 3 hijau + GO owner) — PR ke `staging`.

---

### Rollback
- Backend/dashboard: redeploy image sebelumnya.
- Agent: kembalikan `solamax-agent.PREV.cjs` + restart (Bagian I RUNBOOK-SPBU).
- Tabel `tebus_*` / kolom `cnoso`: additive — boleh ditinggal NULL tanpa efek (tak ada reader
  DO saat `DOMAIN.do` belum tayang; query v2 perlakukan cnoso NULL sbg orphan → clamp aman).
