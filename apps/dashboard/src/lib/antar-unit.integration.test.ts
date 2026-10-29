import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { tulisBalikPasangan, tulisPasanganAntarUnit, type UnitTergerbang } from "./antar-unit-tulis";
import type { ScopedUnitId } from "./scope";

/**
 * PASANGAN ANTAR UNIT di DB nyata (rencana 2026-10-29 U4; R3, R30, R31;
 * "Gerbang dua unit") — inti tulis yang SAMA dengan `catatAntarUnit` /
 * `balikPasanganAntarUnit`, di dalam transaksi yang SELALU di-ROLLBACK.
 *
 * Yang dibuktikan, dan tak bisa dibuktikan uji tiruan:
 *   · dengan `app.unit_ids` = kedua unit, dua baris `cash_ledger` lahir di dua
 *     unit di bawah RLS `unit_scope` + FK komposit (rekening & pihak lawan per
 *     unit), satu `pasangan_uuid`, tanda berlawanan, CHECK 0049 terpenuhi;
 *   · dengan `app.unit_ids` hanya unit A, rekening B TAK TERLIHAT ⇒ pasangan
 *     DITOLAK UTUH — tak ada baris tertulis di A sekalipun (R30, AE12 di
 *     lapisan DB);
 *   · balik: kedua kaki di-void (hari terbuka) atau dibalik maju (tertutup),
 *     dan saldo pasangannya kembali nol di kedua buku.
 *
 * Unit NYATA (dua unit pertama yang sama-sama punya rekening aktif): pihak
 * lawan berjenis `unit` ber-FK ke `public.unit`. Aman karena di-ROLLBACK.
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `pihak-lawan-saldo-awal.integration.test.ts`) di tier TESTING
 * `solamax-pg-rlsstg`. ⛔ Jangan arahkan ke DB pilot live. 0049 belum
 * ter-apply ⇒ skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

const AKTOR = { userId: 1, email: "uji-integrasi@solagroup.co" };
const HARI_INI = new Date().toISOString().slice(0, 10);

d("pasangan antar unit — dua kaki, satu transaksi, RLS dua unit", () => {
  let pool: Pool;
  let applied = false;
  let A: UnitTergerbang;
  let B: UnitTergerbang;
  let akunA = "";
  let akunB = "";

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

  const saldoKeLawan = async (c: PoolClient, unit: number, lawan: number): Promise<string> =>
    (
      await c.query<{ s: string }>(
        `SELECT COALESCE(-sum(l.amount), 0)::text AS s
           FROM app.cash_ledger l
           JOIN app.pihak_lawan p ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
          WHERE l.unit_id = $1 AND p.lawan_unit_id = $2 AND NOT l.void`,
        [unit, lawan],
      )
    ).rows[0]!.s;

  const nBaris = async (c: PoolClient, unit: number, lawan: number): Promise<string> =>
    (
      await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM app.cash_ledger l
           JOIN app.pihak_lawan p ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
          WHERE l.unit_id = $1 AND p.lawan_unit_id = $2`,
        [unit, lawan],
      )
    ).rows[0]!.n;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(
      `SELECT to_regclass('app.pihak_lawan') IS NOT NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'app' AND table_name = 'cash_ledger' AND column_name = 'pasangan_uuid') AS ada`,
    );
    applied = r.rows[0]?.ada === true;
    if (!applied) return;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('app.unit_ids', (SELECT string_agg(unit_id::text, ',') FROM public.unit), true)",
      );
      const u = await c.query<{ unit_id: number; code: string; name: string; akun: string }>(
        `SELECT DISTINCT ON (u.unit_id) u.unit_id, u.code, u.name, a.id::text AS akun
           FROM public.unit u
           JOIN app.cash_account a ON a.unit_id = u.unit_id AND a.active
          ORDER BY u.unit_id, a.nama
          LIMIT 2`,
      );
      if (u.rows.length === 2) {
        A = { unitId: u.rows[0]!.unit_id as ScopedUnitId, code: u.rows[0]!.code, name: u.rows[0]!.name };
        B = { unitId: u.rows[1]!.unit_id as ScopedUnitId, code: u.rows[1]!.code, name: u.rows[1]!.name };
        akunA = u.rows[0]!.akun;
        akunB = u.rows[1]!.akun;
      } else {
        applied = false;
      }
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  const catat = (c: PoolClient) =>
    tulisPasanganAntarUnit(c, {
      pemberi: A,
      penerima: B,
      pemberiAccountId: akunA,
      penerimaAccountId: akunB,
      nominalSen: 500_000_000_00,
      tanggal: HARI_INI,
      jenis: "pinjaman",
      catatan: "uji integrasi",
      aktor: AKTOR,
    });

  it("🔴 kedua unit di scope: dua kaki, satu pasangan, piutang A = hutang B", async (ctx) => {
    if (!applied) ctx.skip();
    await tx(`${A.unitId},${B.unitId}`, async (c) => {
      const sebelumA = Number(await saldoKeLawan(c, A.unitId, B.unitId));
      const sebelumB = Number(await saldoKeLawan(c, B.unitId, A.unitId));
      const r = await catat(c);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (!r.ok) return;
      const kaki = await c.query<{ unit_id: number; amount: string; pasangan_uuid: string }>(
        `SELECT unit_id, amount::text AS amount, pasangan_uuid::text AS pasangan_uuid
           FROM app.cash_ledger WHERE pasangan_uuid = $1::uuid ORDER BY amount`,
        [r.pasanganUuid],
      );
      expect(kaki.rows).toEqual([
        { unit_id: A.unitId, amount: "-500000000.00", pasangan_uuid: r.pasanganUuid },
        { unit_id: B.unitId, amount: "500000000.00", pasangan_uuid: r.pasanganUuid },
      ]);
      const dA = Number(await saldoKeLawan(c, A.unitId, B.unitId)) - sebelumA;
      const dB = Number(await saldoKeLawan(c, B.unitId, A.unitId)) - sebelumB;
      expect(dA).toBe(500_000_000);
      expect(dB).toBe(-500_000_000);

      // Balik oleh inti yang sama (gerbang HoF milik aksi): saldo pasangan kembali.
      const b = await tulisBalikPasangan(c, {
        unit: A,
        lawan: B,
        pasanganUuid: r.pasanganUuid,
        reasonCode: "ADJ-AMOUNT",
        catatan: "uji integrasi",
        aktor: AKTOR,
      });
      expect(b.ok, b.ok ? "" : b.error).toBe(true);
      expect(Number(await saldoKeLawan(c, A.unitId, B.unitId))).toBe(sebelumA);
      expect(Number(await saldoKeLawan(c, B.unitId, A.unitId))).toBe(sebelumB);
    });
  });

  it("🔴 scope hanya unit A: ditolak UTUH — nol baris baru di A (dan B tak tersentuh)", async (ctx) => {
    if (!applied) ctx.skip();
    await tx(`${A.unitId}`, async (c) => {
      const sebelum = await nBaris(c, A.unitId, B.unitId);
      const r = await catat(c).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
      expect(r.ok).toBe(false);
      expect(await nBaris(c, A.unitId, B.unitId)).toBe(sebelum);
    });
  });
});
