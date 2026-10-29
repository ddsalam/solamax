import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * PENEBUSAN di DB nyata (rencana 2026-10-29 U7; R10, KTD9) — yang tak bisa
 * dibuktikan uji tiruan: CHECK `penebusan_jumlah_komponen` dan FK komposit
 * `(cash_ledger_id, unit_id)` / `(account_id, unit_id)` 0050 benar-benar
 * DITEGAKKAN Postgres. Setiap kasus di dalam transaksi yang SELALU di-ROLLBACK
 * (SAVEPOINT per percobaan yang diharapkan gagal).
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `antar-unit.integration.test.ts`) di tier TESTING `solamax-pg-rlsstg`.
 * ⛔ Jangan arahkan ke DB pilot live. 0050 belum ter-apply ⇒ skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

d("0050 penebusan — CHECK Σ = Gross & FK komposit ditegakkan DB", () => {
  let pool: Pool;
  let applied = false;
  let A = { unitId: 0, akun: "" };
  let B = { unitId: 0, akun: "" };
  const HARI = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.penebusan') IS NOT NULL AS ada`);
    applied = r.rows[0]?.ada === true;
    if (!applied) return;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', (SELECT string_agg(unit_id::text, ',') FROM public.unit), true)");
      const u = await c.query<{ unit_id: number; akun: string }>(
        `SELECT DISTINCT ON (a.unit_id) a.unit_id, a.id::text AS akun
           FROM app.cash_account a WHERE a.active AND a.kind = 'bank'
          ORDER BY a.unit_id, a.nama LIMIT 2`,
      );
      if (u.rows.length === 2) {
        A = { unitId: u.rows[0]!.unit_id, akun: u.rows[0]!.akun };
        B = { unitId: u.rows[1]!.unit_id, akun: u.rows[1]!.akun };
      } else applied = false;
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [`${A.unitId},${B.unitId}`]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  const kas = async (c: PoolClient, unit: number, akun: string): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis,
                                      category_side, category_label, amount, created_by_user_id)
         VALUES ($1,$2::uuid,$3::date,'uji integrasi penebusan','kredit','kredit','Pembelian BBM',-118750000,1)
         RETURNING id::text AS id`,
        [unit, akun, HARI],
      )
    ).rows[0]!.id;

  const tebus = (c: PoolClient, p: { unit: number; akun: string; kas: string; pbbkb: string }) =>
    c.query(
      `INSERT INTO app.penebusan (unit_id, no_so, tanggal_bayar, account_id, net, ppn, pph, pbbkb, nota, gross,
                                  cash_ledger_id, kas_dibuat, created_by_user_id)
       VALUES ($1,'uji-so-0050',$2::date,$3::uuid,100000000,11000000,250000,$4::numeric,0,118750000,$5::uuid,true,1)`,
      [p.unit, HARI, p.akun, p.pbbkb, p.kas],
    );

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

  it("🔴 AE2 di DB: 7.500.000 tersimpan; 7.500.001 ditolak CHECK penebusan_jumlah_komponen", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const k = await kas(c, A.unitId, A.akun);
      expect(await gagal(c, () => tebus(c, { unit: A.unitId, akun: A.akun, kas: k, pbbkb: "7500001" }))).toBe(
        "penebusan_jumlah_komponen",
      );
      expect(await gagal(c, () => tebus(c, { unit: A.unitId, akun: A.akun, kas: k, pbbkb: "7500000" }))).toBe("lolos");
    });
  });

  it("🔴 FK komposit: penebusan unit A tak bisa menunjuk baris kas / rekening unit B", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const kB = await kas(c, B.unitId, B.akun);
      expect(await gagal(c, () => tebus(c, { unit: A.unitId, akun: A.akun, kas: kB, pbbkb: "7500000" }))).toBe(
        "penebusan_cash_ledger_fk",
      );
      const kA = await kas(c, A.unitId, A.akun);
      expect(await gagal(c, () => tebus(c, { unit: A.unitId, akun: B.akun, kas: kA, pbbkb: "7500000" }))).toBe(
        "penebusan_account_fk",
      );
    });
  });
});
