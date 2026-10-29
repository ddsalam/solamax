import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * IMPOR REKENING KORAN di DB nyata (rencana 2026-10-29 U9; R17, R19, R31) —
 * yang tak bisa dibuktikan uji tiruan: CHECK kaki menutup, partial unique
 * (rekening, bulan) & (rekening, tanggal, urutan) di antara yang AKTIF, FK
 * komposit, dan CERMIN status lewat FK ON UPDATE CASCADE (0051). Setiap kasus
 * di dalam transaksi yang SELALU di-ROLLBACK (SAVEPOINT per percobaan).
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `penebusan.integration.test.ts`) di tier TESTING `solamax-pg-rlsstg`.
 * ⛔ Jangan arahkan ke DB pilot live. 0051 belum ter-apply ⇒ skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

d("0051 impor bank — CHECK kaki, unik aktif, FK komposit, cermin status", () => {
  let pool: Pool;
  let applied = false;
  let A = { unitId: 0, akun: "" };
  let B = { unitId: 0, akun: "" };
  const SHA = "a".repeat(64);
  const SHA2 = "b".repeat(64);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.mutasi_bank') IS NOT NULL AS ada`);
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

  const rk = (c: PoolClient, p: { unit: number; akun: string; akhir?: string; sha?: string; periode?: string }) =>
    c.query<{ id: string }>(
      `INSERT INTO app.rekening_koran (unit_id, account_id, periode, saldo_awal, saldo_akhir, total_cr, n_cr,
                                       total_db, n_db, file_sha256, uploaded_by_user_id)
       VALUES ($1,$2::uuid,$3::date,1000,$4::numeric,500,1,200,1,$5,1) RETURNING id::text AS id`,
      [p.unit, p.akun, p.periode ?? "2099-01-01", p.akhir ?? "1300", p.sha ?? SHA],
    );
  const baris = (c: PoolClient, p: { unit: number; rk: string; akun: string; urutan?: number }) =>
    c.query(
      `INSERT INTO app.mutasi_bank (unit_id, rekening_koran_id, account_id, tanggal_bank, urutan, keterangan,
                                    amount, pra_cutover)
       VALUES ($1,$2::uuid,$3::uuid,'2099-01-05',$4,'uji integrasi 0051',500,false)`,
      [p.unit, p.rk, p.akun, p.urutan ?? 1],
    );

  it("🔴 R17: kaki yang tak menutup ditolak CHECK; periode bukan awal bulan ditolak", async () => {
    if (!applied) return;
    await tx(async (c) => {
      expect(await gagal(c, () => rk(c, { unit: A.unitId, akun: A.akun, akhir: "1300.01" }))).toBe(
        "rekening_koran_kaki_menutup",
      );
      expect(await gagal(c, () => rk(c, { unit: A.unitId, akun: A.akun, periode: "2099-01-02" }))).toBe(
        "rekening_koran_periode_awal_bulan",
      );
      expect(await gagal(c, () => rk(c, { unit: A.unitId, akun: A.akun }))).toBe("lolos");
    });
  });

  it("🔴 satu aktif per (rekening, bulan); sesudah ditarik, pengganti & barisnya boleh — cermin status ikut", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const lama = (await rk(c, { unit: A.unitId, akun: A.akun })).rows[0]!.id;
      await baris(c, { unit: A.unitId, rk: lama, akun: A.akun });
      expect(await gagal(c, () => rk(c, { unit: A.unitId, akun: A.akun, sha: SHA2 }))).toBe("rekening_koran_aktif_uq");
      expect(await gagal(c, () => baris(c, { unit: A.unitId, rk: lama, akun: A.akun }))).toBe("mutasi_bank_alami_uq");

      await c.query(
        `UPDATE app.rekening_koran SET status='ditarik', ditarik_at=now(), ditarik_by_user_id=1,
                ditarik_alasan='ADJ-DUP', ditarik_alasan_applies_to='adjustment', ditarik_catatan='uji'
          WHERE id=$1::uuid`,
        [lama],
      );
      const cermin = await c.query<{ s: string }>(`SELECT rk_status AS s FROM app.mutasi_bank WHERE rekening_koran_id=$1::uuid`, [lama]);
      expect(cermin.rows.map((r) => r.s)).toEqual(["ditarik"]);
      // Baris tak bisa disisipkan ke rekening koran yang sudah ditarik.
      expect(await gagal(c, () => baris(c, { unit: A.unitId, rk: lama, akun: A.akun, urutan: 2 }))).toBe(
        "mutasi_bank_rekening_koran_fk",
      );

      const baru = (await rk(c, { unit: A.unitId, akun: A.akun, sha: SHA2 })).rows[0]!.id;
      expect(await gagal(c, () => baris(c, { unit: A.unitId, rk: baru, akun: A.akun }))).toBe("lolos");
    });
  });

  it("ditarik tanpa alasan/catatan ditolak; alasan non-adjustment ditolak", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const id = (await rk(c, { unit: A.unitId, akun: A.akun })).rows[0]!.id;
      expect(
        await gagal(c, () => c.query(`UPDATE app.rekening_koran SET status='ditarik' WHERE id=$1::uuid`, [id])),
      ).toBe("rekening_koran_tarik_audit");
      expect(
        await gagal(c, () =>
          c.query(
            `UPDATE app.rekening_koran SET status='ditarik', ditarik_at=now(), ditarik_by_user_id=1,
                    ditarik_alasan='CLS-ROUND', ditarik_alasan_applies_to='closing', ditarik_catatan='uji'
              WHERE id=$1::uuid`,
            [id],
          ),
        ),
      ).toBe("rekening_koran_alasan_adjustment");
    });
  });

  it("🔴 FK komposit: rekening koran unit A tak bisa menunjuk rekening unit B; baris tak bisa beda rekening", async () => {
    if (!applied) return;
    await tx(async (c) => {
      expect(await gagal(c, () => rk(c, { unit: A.unitId, akun: B.akun }))).toBe("rekening_koran_account_fk");
      const id = (await rk(c, { unit: A.unitId, akun: A.akun })).rows[0]!.id;
      expect(await gagal(c, () => baris(c, { unit: B.unitId, rk: id, akun: A.akun }))).toBe(
        "mutasi_bank_rekening_koran_fk",
      );
      expect(await gagal(c, () => baris(c, { unit: A.unitId, rk: id, akun: B.akun }))).toBe(
        "mutasi_bank_rekening_koran_fk",
      );
    });
  });
});
