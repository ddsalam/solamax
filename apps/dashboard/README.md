# @solamax/dashboard — Dashboard Pengawasan (Next.js)

Read-only murni: membaca Cloud SQL hasil sync, **tidak ada form input**, tidak pernah
menulis. Fitur hero = **matriks kepatuhan input** (per SPBU × per hari × per modul,
🟢/🟡/🔴) — menyorot YANG KOSONG. Pilot 1 unit; layout multi-unit siap 7 SPBU.

## Halaman

- `/` — ringkasan grup: kartu per SPBU + mini-matriks 14 hari + badge merah kas stale.
- `/unit/<kode>` — detail: matriks 30 hari, input terakhir per modul (flag STALE),
  selisih NVOLSELISIH abnormal (losses), omzet & volume harian (tanggal bisnis
  `DTGLJUAL`), kas per kategori (join `tm_perk`). Baris `SBATAL` dicoret.
- Auto-refresh 60 detik (poll).

## Menjalankan untuk review (lokal, via Cloud SQL proxy)

```bash
# Terminal 1 — proxy ke Cloud SQL staging:
cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432

# Terminal 2 — dari root repo:
cp apps/dashboard/.env.example apps/dashboard/.env.local   # isi DATABASE_URL
#   (boleh samakan dengan apps/backend/.env)
pnpm --filter @solamax/dashboard dev
# → buka http://localhost:3000
```

Logika status: penjualan 🟢=3 shift, 🟡=1–2, 🔴=0; opname 🟢=semua tangki, 🟡=sebagian,
🔴=nol; kas 🟢=ada nota, 🔴=kosong. Ambang stale & selisih abnormal di
[`src/lib/compliance.ts`](src/lib/compliance.ts) (teruji unit test).

## Produksi nanti (catatan)

- Buat user Postgres **read-only** khusus dashboard (jangan pakai user `ingest`):
  ```sql
  CREATE USER dashboard_ro WITH PASSWORD '...';
  GRANT CONNECT ON DATABASE solamax TO dashboard_ro;
  GRANT USAGE ON SCHEMA public TO dashboard_ro;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_ro;
  ```
- Deploy Cloud Run: `output: "standalone"` sudah di-set; perlu Dockerfile dashboard +
  auth akses (dashboard berisi data operasional — jangan publik tanpa login/IAP).
