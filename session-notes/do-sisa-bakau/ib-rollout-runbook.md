# Runbook — Rollout agent replace_window ke IB (64.781.11 Imam Bonjol)

Jadwal: ~2026-07-15/16, **SYARAT Bakau bersih ±3 hari** (sapuan nightly mendarat,
tanpa mismatch baru). Backend & dashboard sudah kompatibel — hanya agent IB yang
tertinggal. Estimasi di mesin: 10–15 menit.

## Pra-syarat (Claude verifikasi sebelum hari-H)

- [ ] Bakau sehat 3 hari: `sync_state` tebus/delivery maju tiap hari; baris jendela
      tier1 ber-`ingested_at` di jam off-peak (02–05 WIB); Sisa DO Bakau == F12.
- [ ] **Freeze baseline IB hari-H** (SEBELUM swap): dekomposisi per-SO unit 1 +
      `count(*)`/`sum(nvolume|nvoldo)` per tahun untuk tebus_header/tebus_detail/
      delivery (query di `probe-pack.sql`). Tanpa ini, no-op tak bisa dibuktikan.

## Langkah di mesin IB (operator/owner)

1. **Bundle segar**: di repo, `pnpm -r build && pnpm --filter @solamax/agent bundle`
   → salin isi `apps/agent/bundle-out/` menimpa `C:\solamax-agent\`
   (JANGAN timpa `config.local.json` & folder `data\`). RUNBOOK-SPBU.md Bagian I.
2. **Restart WAJIB**: Task Scheduler → task SolaMax agent → **End** → **Run**
   (bundle baru tak aktif tanpa restart — gotcha bundle-basi).
3. **Rescan penuh riwayat IB** (riwayat mulai 2022-09 → 1500 hari cukup):
   ```
   node solamax-agent.cjs --deep-sweep tebus 1500 92 --config config.local.json
   node solamax-agent.cjs --deep-sweep delivery 1500 92 --config config.local.json
   ```
   Harus selesai tanpa error; kirim output bila ada keluhan.
4. **Piggyback probe SAKTIF** (read-only, sekali): jalankan isi
   `tm-bbm-saktif-probe.sql` dengan tool SQL read-only yang dipakai saat
   VERIFICATION-QUERIES.sql dulu; kirim hasil lengkapnya.

## Verifikasi pasca (Claude)

- [ ] **Rescan = content NO-OP**: dekomposisi per-SO unit 1 identik baseline hari-H
      modulo lalu-lintas live (diitemisasi per baris penerimaan/tebus baru, seperti
      pola 2026-07-12); count/sum per tahun tak berubah.
- [ ] Laporan IB (3 tanggal terakhir) angka TIDAK bergeser; tanpa sub-baris macet
      baru yang tak terjelaskan.
- [ ] `sync_state` IB tebus/delivery maju; tanpa error 4xx/5xx di Cloud Run.
- **Stop-and-report** bila ada yang tak cocok — atribusi per-SO dulu, jangan lanjut.

## Catatan

- IB TIDAK butuh koreksi tampilan apa pun: tanpa SO macet, segmen tak dirender.
- Setelah IB live, cadence otomatis: tier1 delivery nightly (14 hr) / tebus weekly
  (30 hr) + tier2-full bulanan (floor rolling 1095 hr) — semuanya kini delete-capable.
