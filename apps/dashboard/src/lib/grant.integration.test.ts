import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

/**
 * Negative-access (isolasi DB) — penegasan A lapis-DB untuk tabel Rincian (F1b).
 * Membuktikan role aplikasi `dashboard_app` HANYA bisa SELECT pada mirror EasyMax
 * `public.*` (tak boleh INSERT/UPDATE/DELETE), dan RW-tanpa-DELETE pada
 * `app.manual_entry` (pembatalan = `void` via UPDATE, bukan hard-delete).
 *
 * Jalan hanya bila GRANT_LIVE_DB=1 & DASHBOARD_APP_DATABASE_URL (koneksi sebagai
 * role `dashboard_app`, BUKAN superuser). Selain itu: skip (pnpm check tetap hijau
 * tanpa DB). Bila GRANT salah (mis. dashboard_app diberi INSERT ke public) →
 * test ini MERAH.
 */
const LIVE =
  process.env.GRANT_LIVE_DB === "1" && !!process.env.DASHBOARD_APP_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const PUBLIC_TABLES = ["deposit", "edc", "pelanggan_sale", "voucher_sale", "card"] as const;

d("negative-access F1b: dashboard_app SELECT-only public, RW-no-delete app.manual_entry", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DASHBOARD_APP_DATABASE_URL,
      max: 2,
    });
  });
  afterAll(async () => {
    await pool?.end();
  });

  for (const t of PUBLIC_TABLES) {
    it(`public.${t}: SELECT boleh; INSERT/UPDATE/DELETE DITOLAK`, async () => {
      await expect(pool.query(`SELECT 1 FROM public."${t}" LIMIT 1`)).resolves.toBeDefined();
      await expect(pool.query(`INSERT INTO public."${t}" DEFAULT VALUES`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query(`UPDATE public."${t}" SET unit_id = unit_id`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query(`DELETE FROM public."${t}"`)).rejects.toThrow(/permission denied/i);
    });
  }

  it("app.manual_entry: SELECT/INSERT/UPDATE boleh; DELETE DITOLAK", async () => {
    await expect(pool.query(`SELECT 1 FROM app.manual_entry LIMIT 1`)).resolves.toBeDefined();
    // INSERT + UPDATE dalam transaksi yang di-ROLLBACK (cek privilege, tak menyisakan data).
    await pool.query("BEGIN");
    try {
      await expect(
        pool.query(
          `INSERT INTO app.manual_entry (unit_id, business_date, section, keterangan, amount, created_by_user_id)
           VALUES (1, '2026-06-14', 'pengeluaran', 'negative-access probe', 1000, 1)`,
        ),
      ).resolves.toBeDefined();
      await expect(
        pool.query(
          `UPDATE app.manual_entry SET void = true WHERE keterangan = 'negative-access probe'`,
        ),
      ).resolves.toBeDefined();
    } finally {
      await pool.query("ROLLBACK");
    }
    await expect(pool.query(`DELETE FROM app.manual_entry`)).rejects.toThrow(/permission denied/i);
  });
});
