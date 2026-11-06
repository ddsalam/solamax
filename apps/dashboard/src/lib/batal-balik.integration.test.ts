import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PESAN_BATAL } from "./batal-balik-model";
import type { ScopedUnitId } from "./scope";

/**
 * Batalkan baris pintu Finance di DB NYATA (rencana 2026-11-07 U3; AE3). Yang
 * tak bisa dibuktikan tiruan: trigger 0026 hari tertutup, CHECK/FK 0059, kunci
 * advisory, dan UPDATE bersyarat. Setiap kasus di dalam transaksi yang SELALU
 * di-ROLLBACK, atas unit sentinel yang tak ada di data mana pun.
 *
 * Gated: BATAL_BALIK_LIVE_DB=1 dan BATAL_BALIK_DB_URL — Postgres sekali pakai
 * yang sudah dimigrasi sampai 0059. ⛔ Jangan arahkan ke DB pilot live.
 */
const LIVE = process.env.BATAL_BALIK_LIVE_DB === "1" && !!process.env.BATAL_BALIK_DB_URL;
const d = LIVE ? describe : describe.skip;

const UNIT = 30_123 as unknown as ScopedUnitId;
const HARI = "2026-10-02";
const aktor = { userId: 77, email: "keuangan@contoh.test" };
const ok = { reasonCode: "VOID-DUP", alasan: "ganda dengan MDR otomatis settlement BCA" };

d("Batalkan baris pintu Finance — DB nyata", () => {
  let pool: Pool;
  // ⚠️ Import MALAS: `./db` melempar saat DATABASE_URL tak ada — import top-level
  // membuat berkas ini gagal saat COLLECT di `pnpm check` (pola K1).
  let batalkanBarisFinance: typeof import("./batal-balik-tulis").batalkanBarisFinance;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= process.env.BATAL_BALIK_DB_URL;
    pool = new Pool({ connectionString: process.env.BATAL_BALIK_DB_URL, max: 2 });
    ({ batalkanBarisFinance } = await import("./batal-balik-tulis"));
  });
  afterAll(async () => {
    await pool?.end();
  });

  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  const baris = async (
    c: PoolClient,
    o: { door?: "finance" | "pengawas"; section?: string; amount?: number; kasId?: string | null; hari?: string } = {},
  ): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.manual_entry
           (unit_id, business_date, section, urut, keterangan, amount, accounting_account,
            status, source_door, created_by_user_id, submitted_at, cash_ledger_id)
         VALUES ($1, $2::date, $3::app.manual_entry_section, 1, 'Biaya MDR EDC', $4, '7-1200',
                 'submitted', $5, 1, now(), $6::uuid)
         RETURNING id::text`,
        [UNIT, o.hari ?? HARI, o.section ?? "pengeluaran", o.amount ?? 7_560, o.door ?? "finance", o.kasId ?? null],
      )
    ).rows[0]!.id;

  const tutupHari = (c: PoolClient, hari = HARI) =>
    c.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier, closed_by_user_id, closed_at)
       VALUES ($1, $2::date, 'closed', 0, 'within_tolerance', 1, now())`,
      [UNIT, hari],
    );

  const isi = async (c: PoolClient, id: string) =>
    (
      await c.query<{
        void: boolean;
        voided_by_user_id: number | null;
        void_reason_code: string | null;
        void_alasan: string | null;
      }>(`SELECT void, voided_by_user_id, void_reason_code, void_alasan FROM app.manual_entry WHERE id = $1::uuid`, [id])
    ).rows[0]!;

  it("baris Finance di hari terbuka → void beralasan, pelaku & jejak audit tercatat", () =>
    tx(async (c) => {
      const id = await baris(c);
      const r = await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok });
      expect(r).toEqual({ ok: true, businessDate: HARI });
      expect(await isi(c, id)).toEqual({
        void: true,
        voided_by_user_id: 77,
        void_reason_code: "VOID-DUP",
        void_alasan: ok.alasan,
      });
      const a = await c.query(`SELECT 1 FROM app.audit_log WHERE action = 'manual_entry.batal_finance' AND target = $1`, [id]);
      expect(a.rowCount).toBe(1);
    }));

  it("🔴 baris PENGAWAS → server menolak, baris utuh (§2.1)", () =>
    tx(async (c) => {
      const id = await baris(c, { door: "pengawas" });
      expect(await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).toEqual({
        ok: false,
        error: PESAN_BATAL.pengawas,
      });
      expect((await isi(c, id)).void).toBe(false);
    }));

  it("🔴 hari TERTUTUP → server menolak sebelum trigger; UPDATE langsung pun ditolak trigger 0026", () =>
    tx(async (c) => {
      const id = await baris(c);
      await tutupHari(c);
      expect(await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).toEqual({
        ok: false,
        error: PESAN_BATAL.hariTutup,
      });
      await c.query("SAVEPOINT langsung");
      await expect(
        c.query(`UPDATE app.manual_entry SET void = true, voided_at = now(), voided_by_user_id = 1 WHERE id = $1::uuid`, [id]),
      ).rejects.toThrow(/hari sudah ditutup/);
      await c.query("ROLLBACK TO SAVEPOINT langsung");
      expect((await isi(c, id)).void).toBe(false);
    }));

  it("🔴 BERTAUT mutasi kas → ditolak; jalurnya pembatalan mutasi kas asal", () =>
    tx(async (c) => {
      const akun = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_account (unit_id, nama, kind) VALUES ($1, 'BCA uji', 'bank') RETURNING id::text`,
          [UNIT],
        )
      ).rows[0]!.id;
      const kas = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
           VALUES ($1, $2::uuid, $3::date, 'admin bank', 'kredit', 'kredit', 'Biaya Operasional', -30000, 1)
           RETURNING id::text`,
          [UNIT, akun, HARI],
        )
      ).rows[0]!.id;
      const id = await baris(c, { kasId: kas, amount: 30_000 });
      expect(await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).toEqual({
        ok: false,
        error: PESAN_BATAL.bertautKas,
      });
      expect((await isi(c, id)).void).toBe(false);
    }));

  it("🔴 bulan tertutup K5 (buku_besar=false) → ditolak", () =>
    tx(async (c) => {
      const id = await baris(c);
      await c.query(
        `INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, false)`,
        [UNIT],
      );
      expect(await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).toEqual({
        ok: false,
        error: PESAN_BATAL.bulanTutup,
      });
    }));

  it("sudah void → ditolak kedua kalinya; kode di luar grup void → ditolak", () =>
    tx(async (c) => {
      const id = await baris(c);
      expect(
        await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, reasonCode: "ADJ-DUP", alasan: ok.alasan }),
      ).toEqual({ ok: false, error: PESAN_BATAL.kode });
      expect((await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).ok).toBe(true);
      expect(await batalkanBarisFinance(c, UNIT, aktor, { entryId: id, ...ok })).toEqual({
        ok: false,
        error: PESAN_BATAL.sudahBatal,
      });
    }));

  it("DB menolak kode grup lain / alasan kosong meski aplikasi dilewati (CHECK 0059)", () =>
    tx(async (c) => {
      const id = await baris(c);
      await c.query("SAVEPOINT s1");
      await expect(
        c.query(
          `UPDATE app.manual_entry SET void = true, voided_at = now(), voided_by_user_id = 1,
                  void_reason_code = 'ADJ-DUP', void_reason_applies_to = 'adjustment', void_alasan = 'x'
            WHERE id = $1::uuid`,
          [id],
        ),
      ).rejects.toThrow(/manual_entry_void_reason_grup/);
      await c.query("ROLLBACK TO SAVEPOINT s1");
      await expect(
        c.query(
          `UPDATE app.manual_entry SET void = true, voided_at = now(), voided_by_user_id = 1,
                  void_reason_code = 'VOID-DUP', void_reason_applies_to = 'void', void_alasan = '   '
            WHERE id = $1::uuid`,
          [id],
        ),
      ).rejects.toThrow(/manual_entry_void_reason_isi/);
      await c.query("ROLLBACK TO SAVEPOINT s1");
    }));

  it("baris di unit lain tak terlihat (RLS/unit_id) → 'tak ditemukan', tak ada yang tertulis", () =>
    tx(async (c) => {
      const id = await baris(c);
      const lain = 30_124 as unknown as ScopedUnitId;
      const r = await batalkanBarisFinance(c, lain, aktor, { entryId: id, ...ok });
      expect(r.ok).toBe(false);
      expect((await isi(c, id)).void).toBe(false);
    }));
});
