import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { tulisSaldoAwalPihakLawan } from "./pihak-lawan-tulis";
import type { ScopedUnitId } from "./scope";

/**
 * SALDO PEMBUKA PASANGAN UNIT di DB nyata (rencana 2026-10-29 U3; R7,
 * "Gerbang dua unit") — inti tulis yang SAMA dengan `tetapkanSaldoAwalPihakLawan`,
 * di dalam transaksi yang SELALU di-ROLLBACK (nol jejak).
 *
 * Yang dibuktikan, dan tak bisa dibuktikan uji tiruan:
 *   · satu pengisian menulis DUA baris di dua unit, tanda berlawanan, di bawah
 *     RLS `unit_scope` 0049 dengan `app.unit_ids` = kedua unit;
 *   · dengan `app.unit_ids` hanya unit A, sisi B TAK TERLIHAT (RLS) dan
 *     pasangannya DITOLAK UTUH — tak ada baris yang tertulis di A sekalipun;
 *   · mengganti = void + insert, satu baris aktif per sisi.
 *
 * Unit NYATA (dua `unit_id` pertama `public.unit`): pihak lawan berjenis `unit`
 * ber-FK `lawan_unit_id → public.unit`, jadi unit fiktif 8801/8802 tak bisa
 * dipakai. Aman karena semuanya di-ROLLBACK.
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `pihak-lawan.integration.test.ts`) di tier TESTING `solamax-pg-rlsstg`.
 * ⛔ Jangan arahkan ke DB pilot live. Bila 0049 belum ter-apply → skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

const D = "2026-10-01";
const AKTOR = { userId: 1, email: "uji-integrasi@solagroup.co" };

d("saldo pembuka pasangan unit — dua sisi, satu transaksi", () => {
  let pool: Pool;
  let applied = false;
  let A: { unitId: ScopedUnitId; code: string };
  let B: { unitId: ScopedUnitId; code: string };

  const tx = async (scope: string, fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [scope]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  const pihakUnit = async (c: PoolClient, unit: number, lawan: number): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `SELECT id::text AS id FROM app.pihak_lawan WHERE unit_id = $1 AND jenis = 'unit' AND lawan_unit_id = $2`,
        [unit, lawan],
      )
    ).rows[0]!.id;

  const aktif = async (c: PoolClient, unit: number, pl: string) =>
    (
      await c.query<{ amount: string; sementara: boolean }>(
        `SELECT amount::text AS amount, sementara FROM app.pihak_lawan_saldo_awal
          WHERE unit_id = $1 AND pihak_lawan_id = $2::uuid AND NOT void`,
        [unit, pl],
      )
    ).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.pihak_lawan_saldo_awal') IS NOT NULL AS ada`);
    applied = r.rows[0]?.ada === true;
    const u = await pool.query<{ unit_id: number; code: string }>(
      `SELECT unit_id, code FROM public.unit ORDER BY unit_id LIMIT 2`,
    );
    if (u.rows.length === 2) {
      A = { unitId: u.rows[0]!.unit_id as ScopedUnitId, code: u.rows[0]!.code };
      B = { unitId: u.rows[1]!.unit_id as ScopedUnitId, code: u.rows[1]!.code };
    } else {
      applied = false;
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("🔴 kedua unit di scope: A +X, B −X; ganti = void + insert", async (ctx) => {
    if (!applied) ctx.skip();
    await tx(`${A.unitId},${B.unitId}`, async (c) => {
      const plA = await pihakUnit(c, A.unitId, B.unitId);
      const plB = await pihakUnit(c, B.unitId, A.unitId);
      const r = await tulisSaldoAwalPihakLawan(c, {
        unit: A,
        lawan: B,
        pihakLawanId: plA,
        tanggal: D,
        amount: 500_000_000,
        sementara: false,
        alasan: "uji integrasi",
        aktor: AKTOR,
      });
      expect(r).toEqual({ ok: true, sisi: 2 });
      expect(await aktif(c, A.unitId, plA)).toEqual([{ amount: "500000000.00", sementara: false }]);
      expect(await aktif(c, B.unitId, plB)).toEqual([{ amount: "-500000000.00", sementara: false }]);

      const g = await tulisSaldoAwalPihakLawan(c, {
        unit: A,
        lawan: B,
        pihakLawanId: plA,
        tanggal: D,
        amount: 0,
        sementara: true,
        alasan: "ganti — uji integrasi",
        aktor: AKTOR,
      });
      expect(g.ok).toBe(true);
      expect(await aktif(c, A.unitId, plA)).toEqual([{ amount: "0.00", sementara: true }]);
      expect(await aktif(c, B.unitId, plB)).toEqual([{ amount: "0.00", sementara: true }]);
      const void2 = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.pihak_lawan_saldo_awal
          WHERE void AND pihak_lawan_id = ANY($1::uuid[])`,
        [[plA, plB]],
      );
      expect(void2.rows[0]!.n).toBe("2");
    });
  });

  it("🔴 scope hanya unit A: ditolak UTUH — tak ada baris di A maupun B", async (ctx) => {
    if (!applied) ctx.skip();
    let plA = "";
    await tx(`${A.unitId}`, async (c) => {
      plA = await pihakUnit(c, A.unitId, B.unitId);
      const sebelum = await aktif(c, A.unitId, plA);
      const r = await tulisSaldoAwalPihakLawan(c, {
        unit: A,
        lawan: B, // gerbang aksi sudah lolos, tetapi transaksi tak memuat B ⇒ RLS menyembunyikannya
        pihakLawanId: plA,
        tanggal: D,
        amount: 500_000_000,
        sementara: false,
        alasan: "uji integrasi",
        aktor: AKTOR,
      });
      expect(r.ok).toBe(false);
      // Dibandingkan dengan keadaan SEBELUM — tier uji bisa sudah punya baris aktif.
      expect(await aktif(c, A.unitId, plA)).toEqual(sebelum);
    });
  });

  it("tanpa unit lawan yang lolos gerbang: pasangan ditolak, A tak tertulis", async (ctx) => {
    if (!applied) ctx.skip();
    await tx(`${A.unitId},${B.unitId}`, async (c) => {
      const plA = await pihakUnit(c, A.unitId, B.unitId);
      const sebelum = await aktif(c, A.unitId, plA);
      const r = await tulisSaldoAwalPihakLawan(c, {
        unit: A,
        lawan: null,
        pihakLawanId: plA,
        tanggal: D,
        amount: 1,
        sementara: false,
        alasan: "uji integrasi",
        aktor: AKTOR,
      });
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/ditolak utuh/) });
      expect(await aktif(c, A.unitId, plA)).toEqual(sebelum);
    });
  });
});
