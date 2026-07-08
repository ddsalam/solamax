# Bakau (unit #2, 6378301) — LIVE onboarding record (2026-07-07/08)

Bakau resmi onboarding sebagai unit ke-2 di bawah PT Sola Petra Abadi — SPBU pertama yang
membuktikan platform multi-tenant RLS. Runbook: [`bakau-live-provisioning-runbook.md`](bakau-live-provisioning-runbook.md)
(cloud), [`bakau-machine-side-runbook.md`](bakau-machine-side-runbook.md) (agent/Dion).

## Ringkasan go-live
- **Cloud:** unit row `unit_id=2` (tenant = IB's PT), tenant rename SolaGroup→PT Sola Petra Abadi,
  API key (Secret Manager `solamax-bakau-agent-key`), config BK (bauran+volume 12 bulan), alamat.
- **Auth:** pengawas `spbu6378301sbbl@solagroup.co` (Dedek Akramul) → membership pengawas + user_unit={2}.
- **Agent:** bundle terkini di PC Bakau (readonly_sync MySQL 5.0.67), Task Scheduler loop
  "run whether logged on or not". Backfill: incremental full-history + `--resync-sales 2022-06-01`
  (D2 fix, tangkap NULL-DTGLJAM). Steady-state hijau.
- **Acceptance:** gold-check EKSAK ke rupiah (OMSET/PELANGGAN/EDC non-blank+blank/DEPOSIT,
  2026-06-14..18; DEPOSIT dorman=0 konsisten). Dashboard render penuh; **D1** fold nama-kembar
  (BB-01/BB-07→PERTALITE) benar, **D2** NULL-DTGLJAM masuk, **isolasi RLS** terbukti (konteks
  unit 2 tak lihat baris IB).

## Insiden edc → fix (sudah live + di main)
Onboarding menyingkap bug: **`buildReplace` (jalur edc/pelanggan_sale/voucher_sale) tak dedup
baris ber-natural-key kembar intra-batch**, beda dari `buildUpsert`. Data edc Bakau punya kembar
intra-batch (IB tidak) → `INSERT … ON CONFLICT` kena Postgres **21000** ("cannot affect row a
second time") tiap push → agent macet (buffer teracuni). Fix: `collapseByConflict` (dedup keep-last
= EXCLUDED) di kedua builder. Di-deploy ke `solamax-ingest-staging` rev **00025-dc7**; test +1 kasus.
Commit sempat lokal-only (drift) → dikejar via PR #68→staging, #70→main. **main kini berisi
`collapseByConflict` (drift tertutup)** — redeploy-from-main aman.

## 🔒 D3 — RESOLVED: TIDAK ADA PERUBAHAN (aturan RECAP terkunci sudah benar)

**Keputusan: D3 ditutup tanpa mengubah aturan.** Investigasi menemukan flag D3-hutang awal
**KELIRU** dan aturan hidup sudah memenuhi maksud owner.

### ⚠️ Catatan model-data (PENTING, untuk selamanya)
**RECAP Saldo HUTANG TIDAK memfilter SJENIS** — [`queries.ts` `getSaldoPelanggan`](../apps/dashboard/src/lib/queries.ts):
`hutangLokal = -Σ(bphut.njumlah × CASE sjnsbp 2→+1,1→−1) WHERE unit_id AND dtgl<tanggal` —
**tanpa join `pelanggan_master`, tanpa filter SJENIS → SEMUA hutang ikut (termasuk SJENIS 2).**
Yang memfilter SJENIS **hanya PIUTANG**: Lokal `{1,5}`, Online `{3}`, **SJENIS 4 dikecualikan (dorman)**.

### Koreksi flag awal
Flag "SJENIS 2 hutang diabaikan" salah — saya mem-bucket `bphut` memakai aturan-SJENIS *piutang*.
Nyatanya hutang tak berfilter SJENIS.

### Bukti (as-of 2026-07-08): split per-SJENIS == total hidup (jadi SJENIS 2 sudah termasuk)
| Unit | Saldo Hutang RECAP (hidup) | SJENIS 2 | non-SJENIS-2 | cek |
|---|---|---|---|---|
| Bakau (2) | −9.882.668 | −10.744.500 | +861.832 | jumlah = −9.882.668 ✅ |
| IB (1) | −656.650.255 | +362.978.197 | −1.019.628.452 | jumlah = −656.650.255 ✅ |

- **Hutang SJENIS 2 sudah ikut** untuk KEDUA unit → tak perlu ubah apa pun (maksud owner terpenuhi).
- **Piutang SJENIS 4 Bakau = dorman** (0 aktivitas 2026, txn terakhir 2025-10-22) → **benar dikecualikan**.
- Aturan RECAP TERKUNCI vs oracle (probe 11–13, EKSAK 27-Jun) tetap utuh; Saldo Hutang IB tak disentuh.

## Status akhir
Units 1 (IB) & 2 (Bakau) **live di bawah RLS**; agent Bakau sehat di Task Scheduler; gold-check
eksak; pengawas ter-scope ke unit-nya. **Bakau onboarding 100% COMPLETE.**
