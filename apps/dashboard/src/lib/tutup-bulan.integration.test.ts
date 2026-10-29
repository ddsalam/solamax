import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ScopedUnitId } from "./scope";
import { periksaTutupBulan } from "./tutup-bulan-model";

// Dimuat DINAMIS: `./tutup-bulan-queries` menarik `./db`, yang melempar saat
// impor bila DATABASE_URL tak di-set — suite yang di-skip tak boleh jatuh.
const kueri = () => import("./tutup-bulan-queries");

/**
 * TUTUP BULAN di DB nyata (rencana 2026-10-29 U12; KTD14, KTD15) — yang tak
 * bisa dibuktikan uji tiruan: PRIMARY KEY (unit, bulan), CHECK hari pertama,
 * REVOKE UPDATE/DELETE bagi `dashboard_app`, kolom `koreksi_susulan_rp`, dan
 * SQL bahan vonis yang benar-benar berjalan. Setiap kasus di dalam transaksi
 * yang SELALU di-ROLLBACK (SAVEPOINT per percobaan). Data SINTETIS (tahun 2099).
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `cocok-bank.integration.test.ts`) di tier TESTING `solamax-pg-rlsstg`.
 * ⛔ Jangan arahkan ke DB pilot live. 0054 belum ter-apply ⇒ skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

d("0054 tutup bulan — kunci, hari pertama, beku, bahan vonis", () => {
  let pool: Pool;
  let applied = false;
  let unitId = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.tutup_bulan') IS NOT NULL AS ada`);
    applied = r.rows[0]?.ada === true;
    if (!applied) return;
    const u = await pool.query<{ unit_id: number }>(`SELECT unit_id FROM public.unit ORDER BY unit_id LIMIT 1`);
    unitId = u.rows[0]?.unit_id ?? 0;
    if (unitId === 0) applied = false;
  });
  afterAll(async () => {
    await pool?.end();
  });

  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(unitId)]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };
  const gagal = async (c: PoolClient, f: () => Promise<unknown>): Promise<string> => {
    await c.query("SAVEPOINT s");
    try {
      await f();
      return "lolos";
    } catch (e) {
      return (e as { constraint?: string; code?: string }).constraint ?? (e as { code?: string }).code ?? "galat";
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT s");
    }
  };
  const tulis = (c: PoolClient, bulan: string) =>
    c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id) VALUES ($1, $2::date, 1)`, [unitId, bulan]);

  it("🔴 hari pertama bulan saja; satu baris per (unit, bulan)", async () => {
    if (!applied) return;
    await tx(async (c) => {
      expect(await gagal(c, () => tulis(c, "2099-01-15"))).toBe("tutup_bulan_hari_pertama");
      await tulis(c, "2099-01-01");
      expect(await gagal(c, () => tulis(c, "2099-01-01"))).toBe("tutup_bulan_pkey");
      const { bulanTertutupTerkunci } = await kueri();
      expect(await bulanTertutupTerkunci(c, unitId as ScopedUnitId, ["2099-02", "2099-01"])).toEqual(["2099-01"]);
    });
  });

  it("🔴 dashboard_app: UPDATE & DELETE ditolak (bulan tertutup beku)", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const ada = await c.query<{ ada: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dashboard_app') AS ada`);
      if (!ada.rows[0]?.ada) return;
      await tulis(c, "2099-01-01");
      await c.query("SET LOCAL ROLE dashboard_app");
      expect(await gagal(c, () => c.query(`UPDATE app.tutup_bulan SET ditutup_by_user_id = 2 WHERE unit_id = $1`, [unitId]))).toBe("42501");
      expect(await gagal(c, () => c.query(`DELETE FROM app.tutup_bulan WHERE unit_id = $1`, [unitId]))).toBe("42501");
    });
  });

  it("day_close.koreksi_susulan_rp ada dan NULLABLE", async () => {
    if (!applied) return;
    const r = await pool.query<{ nullable: string }>(
      `SELECT is_nullable AS nullable FROM information_schema.columns
        WHERE table_schema='app' AND table_name='day_close' AND column_name='koreksi_susulan_rp'`,
    );
    expect(r.rows[0]?.nullable).toBe("YES");
  });

  it("SQL bahan vonis berjalan; bulan 2099 tanpa hari tertutup ⇒ ditolak dengan alasan hari", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const { bacaBahanTutupBulan } = await kueri();
      const bahan = await bacaBahanTutupBulan(c, unitId as ScopedUnitId, "2099-03");
      const v = periksaTutupBulan(bahan);
      expect(v.boleh).toBe(false);
      expect(v.syarat.hari.jumlah).toBe(31);
    });
  });
});
