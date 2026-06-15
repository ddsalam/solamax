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
  return new Pool({ connectionString: url, max: 5 });
}

export const pool: Pool = globalThis.__solamaxPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalThis.__solamaxPool = pool;

export async function q<T extends object>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
