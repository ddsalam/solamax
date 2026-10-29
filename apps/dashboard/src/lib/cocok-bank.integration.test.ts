import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * KELOMPOK COCOK di DB nyata (rencana 2026-10-29 U10; KTD6) — yang tak bisa
 * dibuktikan uji tiruan: partial unique "satu kelompok AKTIF per baris impor /
 * per baris kas", CHECK tepat-satu-jenis, FK komposit ke unit yang sama, dan
 * CERMIN `aktif` lewat FK ON UPDATE CASCADE (0052). Setiap kasus di dalam
 * transaksi yang SELALU di-ROLLBACK (SAVEPOINT per percobaan).
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL (pola
 * `impor-bank.integration.test.ts`) di tier TESTING `solamax-pg-rlsstg`.
 * ⛔ Jangan arahkan ke DB pilot live. 0052 belum ter-apply ⇒ skip eksplisit.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

d("0052 kelompok cocok — unik aktif, satu jenis, FK komposit, cermin aktif", () => {
  let pool: Pool;
  let applied = false;
  let A = { unitId: 0, akun: "" };
  let B = { unitId: 0, akun: "" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.cocok_bank_baris') IS NOT NULL AS ada`);
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

  /** Satu baris impor + satu baris kas di unit itu. */
  const bahan = async (c: PoolClient, u: { unitId: number; akun: string }) => {
    const rk = await c.query<{ id: string }>(
      `INSERT INTO app.rekening_koran (unit_id, account_id, periode, saldo_awal, saldo_akhir, total_cr, n_cr,
                                       total_db, n_db, file_sha256, uploaded_by_user_id)
       VALUES ($1,$2::uuid,'2099-01-01',1000,1500,500,1,0,0,$3,1) RETURNING id::text AS id`,
      [u.unitId, u.akun, "c".repeat(64)],
    );
    const m = await c.query<{ id: string }>(
      `INSERT INTO app.mutasi_bank (unit_id, rekening_koran_id, account_id, tanggal_bank, urutan, keterangan, amount, pra_cutover)
       VALUES ($1,$2::uuid,$3::uuid,'2099-01-05',1,'uji integrasi 0052',500,false) RETURNING id::text AS id`,
      [u.unitId, rk.rows[0]!.id, u.akun],
    );
    const k = await c.query<{ id: string }>(
      `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label,
                                    amount, created_by_user_id)
       VALUES ($1,$2::uuid,'2099-01-05','uji integrasi 0052','debet','debet','Pendapatan Lain-Lain',500,1)
       RETURNING id::text AS id`,
      [u.unitId, u.akun],
    );
    return { mutasi: m.rows[0]!.id, kas: k.rows[0]!.id };
  };
  const kelompok = async (c: PoolClient, unitId: number) =>
    (await c.query<{ id: string }>(`INSERT INTO app.cocok_bank (unit_id, cara, dibuat_by_user_id) VALUES ($1,'manual',1) RETURNING id::text AS id`, [unitId]))
      .rows[0]!.id;
  const anggota = (c: PoolClient, p: { unit: number; g: string; mutasi?: string | null; kas?: string | null }) =>
    c.query(
      `INSERT INTO app.cocok_bank_baris (unit_id, cocok_id, mutasi_bank_id, cash_ledger_id) VALUES ($1,$2::uuid,$3::uuid,$4::uuid)`,
      [p.unit, p.g, p.mutasi ?? null, p.kas ?? null],
    );
  const batalkan = (c: PoolClient, g: string) =>
    c.query(
      `UPDATE app.cocok_bank SET aktif=false, dibatalkan_at=now(), dibatalkan_by_user_id=1,
              dibatalkan_alasan='ADJ-DUP', dibatalkan_alasan_applies_to='adjustment', dibatalkan_catatan='uji'
        WHERE id=$1::uuid`,
      [g],
    );

  it("🔴 satu kelompok AKTIF per baris; sesudah dibatalkan (cermin ikut), baris boleh masuk kelompok baru", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const x = await bahan(c, A);
      const g1 = await kelompok(c, A.unitId);
      await anggota(c, { unit: A.unitId, g: g1, mutasi: x.mutasi });
      await anggota(c, { unit: A.unitId, g: g1, kas: x.kas });
      const g2 = await kelompok(c, A.unitId);
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g: g2, mutasi: x.mutasi }))).toBe("cocok_bank_baris_mutasi_aktif_uq");
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g: g2, kas: x.kas }))).toBe("cocok_bank_baris_kas_aktif_uq");

      await batalkan(c, g1);
      const cermin = await c.query<{ a: boolean }>(`SELECT aktif AS a FROM app.cocok_bank_baris WHERE cocok_id=$1::uuid`, [g1]);
      expect(cermin.rows.map((r) => r.a)).toEqual([false, false]);
      // Anggota tak bisa disisipkan ke kelompok yang sudah dibatalkan (FK cermin).
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g: g1, mutasi: x.mutasi }))).toBe("cocok_bank_baris_cocok_fk");
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g: g2, mutasi: x.mutasi }))).toBe("lolos");
    });
  });

  it("tepat satu jenis anggota; pembatalan tanpa alasan/catatan ditolak", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const x = await bahan(c, A);
      const g = await kelompok(c, A.unitId);
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g, mutasi: x.mutasi, kas: x.kas }))).toBe("cocok_bank_baris_satu_jenis");
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g }))).toBe("cocok_bank_baris_satu_jenis");
      expect(await gagal(c, () => c.query(`UPDATE app.cocok_bank SET aktif=false WHERE id=$1::uuid`, [g]))).toBe("cocok_bank_batal_audit");
    });
  });

  it("🔴 FK komposit: kelompok unit A tak bisa memuat baris impor / baris kas unit B", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const y = await bahan(c, B);
      const g = await kelompok(c, A.unitId);
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g, mutasi: y.mutasi }))).toBe("cocok_bank_baris_mutasi_fk");
      expect(await gagal(c, () => anggota(c, { unit: A.unitId, g, kas: y.kas }))).toBe("cocok_bank_baris_kas_fk");
      expect(await gagal(c, () => anggota(c, { unit: B.unitId, g, kas: y.kas }))).toBe("cocok_bank_baris_cocok_fk");
      expect(
        await gagal(c, () => c.query(`UPDATE app.cash_ledger SET lahir_dari_cocok_id=$1::uuid WHERE id=$2::uuid`, [g, y.kas])),
      ).toBe("cash_ledger_lahir_dari_cocok_fk");
    });
  });
});
