import { Pool } from "pg";
import { catatKueri, catatPernyataan } from "./ukur-kueri";

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
    // BUDGET KONEKSI — dihitung ulang 2026-08-05 saat tier sudah db-g1-small.
    // Angka lama di sini (f1-micro, max_connections=25 → 22 usable) sudah GUGUR
    // premisnya sejak instance di-bump; `max: 5` dipasang untuk tier itu dan tak
    // pernah ditinjau lagi. Diukur langsung di DB pilot:
    //   max_connections=50, superuser_reserved_connections=3 → 47 terpakai.
    //   dashboard  maxScale 2 × max 10          = 20
    //   backend    maxScale 2 × conn_limit 3    =  6
    //   Cloud SQL admin/agent (terukur)         =  4
    //                                      total 30 ≤ 47  (sisa 17)
    // Alasan naik dari 5: render Laporan menembakkan 17 query paralel; dengan 5
    // slot, dua query panjang mengunci 2 di antaranya dan sisanya antre ±9,5 dtk
    // — tepat di bibir connectionTimeoutMillis di bawah → "timeout exceeded when
    // trying to connect" dan halaman jatuh ke error boundary. Dengan 10 slot
    // antreannya turun ke ±2 dtk. Dijaga `db-budget.test.ts`; JANGAN naikkan
    // tanpa hitung ulang di sana.
    max: 10,
    // Lepas koneksi idle balik ke cap (jangan tahan slot saat sepi).
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
  // Penghitung ongkos (ukur-kueri.ts). No-op di luar skop `ukur()`; tak menyentuh
  // `text`/`params` sama sekali — yang dicatat cuma jumlah.
  catatKueri();
  catatPernyataan();
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/**
 * Executor untuk query data PER-UNIT di bawah Row-Level Security (migration 0016).
 * Menetapkan GUC `app.unit_ids` TRANSACTION-LOCAL (`set_config(...,true)`) lalu
 * menjalankan query dalam transaksi yang sama, dan MELEPAS koneksi. Karena pool
 * `pg` berbagi koneksi antar-request, konteks WAJIB transaction-local — `SET`
 * level-sesi akan bocor ke request lain di koneksi yang sama.
 *
 * `unit` = ScopedUnitId | ScopedUnitId[] dari getDataScope() (choke-point). RLS
 * memfilter `unit_id = ANY(app.unit_ids)`; konteks kosong/tak-diset = 0 baris
 * (fail-closed) — query yang lupa lewat sini GAGAL AMAN, tak membocorkan unit lain.
 *
 * ⚠️ URUTAN DEPLOY: image yang memakai qScoped() harus rilis SEBELUM migration
 *    0016 meng-ENABLE RLS (kalau tidak: current_setting NULL → semua 0 baris).
 */
export async function qScoped<T extends object>(
  unit: number | readonly number[],
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const ids = (Array.isArray(unit) ? unit : [unit]).map((u) => Number(u));
  const idCsv = ids.join(","); // "" bila kosong → NULLIF→NULL→ANY(NULL)→0 baris
  // Satu kueri LOGIS, tetapi empat round-trip di bawah — dihitung terpisah.
  catatKueri();
  const client = await pool.connect();
  try {
    catatPernyataan();
    await client.query("BEGIN");
    // is_local=true → berlaku hanya sampai COMMIT/ROLLBACK transaksi ini.
    catatPernyataan();
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [idCsv]);
    catatPernyataan();
    const res = await client.query(text, params);
    catatPernyataan();
    await client.query("COMMIT");
    return res.rows as T[];
  } catch (err) {
    try {
      catatPernyataan();
      await client.query("ROLLBACK");
    } catch {
      /* abaikan: koneksi mungkin sudah rusak */
    }
    throw err;
  } finally {
    client.release();
  }
}
