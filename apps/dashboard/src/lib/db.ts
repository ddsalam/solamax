import { Pool } from "pg";

/**
 * Koneksi read-only ke Cloud SQL (dashboard TIDAK pernah menulis — semua query
 * di lib/queries.ts adalah SELECT). Pool di-cache global agar hot-reload Next
 * dev tidak membocorkan koneksi.
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
  return new Pool({ connectionString: url, max: 5 });
}

const pool: Pool = globalThis.__solamaxPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalThis.__solamaxPool = pool;

export async function q<T extends object>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
