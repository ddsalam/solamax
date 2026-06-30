import { Pool } from "pg";

/**
 * Koneksi Cloud SQL sebagai role `dashboard_app`: SELECT-only ke data mirror
 * (schema public, query selalu schema-qualified) + read/write schema `app`
 * (auth/RBAC, dipakai @auth/pg-adapter). `search_path=app,public` di-set ANDAL
 * lewat connection string (DATABASE_URL `?options=-c search_path=app,public`),
 * bukan per-sesi. Pool di-cache global agar hot-reload Next dev tak bocor koneksi.
 */
declare global {
  // eslint-disable-next-line no-var
  var __solamaxPool: Pool | undefined;
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL belum di-set. Salin apps/dashboard/.env.example → .env.local (lihat README).",
    );
  }
  return new Pool({
    connectionString: url,
    // Cloud SQL f1-micro: max_connections=25, superuser_reserved=3 → 22 usable.
    // 2 instance dashboard × 5 = 10, + backend ingest (connection_limit=3 × 2 = 6)
    // + cadangan admin/migrasi ⇒ tetap < 22. JANGAN naikkan tanpa hitung ulang.
    max: 5,
    // Lepas koneksi idle balik ke cap 25 (jangan tahan slot saat sepi).
    idleTimeoutMillis: 30_000,
    // GAGAL CEPAT saat pool jenuh: tunggu maks 10 dtk dapat koneksi, lalu error —
    // bukan antre tak-hingga (default 0). Inilah pemutus rantai "latency menanjak
    // → 504 di semua route + login menggantung". Query cepat (<10 dtk) tak terdampak.
    connectionTimeoutMillis: 10_000,
    // Bunuh query liar < timeout Cloud Run (300 dtk) → 500 bersih, bukan 504 yg
    // menumpuk. Laporan/Board terberat terukur ~70–83 dtk (G/L 1 bulan di f1-micro);
    // 120 dtk = ~1.4× worst-case isolasi 83 dtk. TRADE-OFF DITERIMA: laporan sah yg
    // melar krn kontensi bisa sesekali >120 dtk lalu dibunuh — lebih baik 500 cepat
    // ketimbang tahan koneksi ber-menit. Fix tuntas = optimasi G/L (follow-up terpisah).
    statement_timeout: 120_000,
  });
}

// Singleton lintas-environment (TERMASUK production): bila modul ini ter-evaluasi
// >1× (HMR dev / bundling Next), pakai pool yang sama — cegah pool ganda menggerus
// cap 25. Sebelumnya guard hanya jalan di non-production (lubang: prod tanpa backstop).
export const pool: Pool = globalThis.__solamaxPool ?? makePool();
globalThis.__solamaxPool = pool;

export async function q<T extends object>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
