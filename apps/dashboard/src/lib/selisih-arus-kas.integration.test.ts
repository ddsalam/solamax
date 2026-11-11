import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { ScopedUnitId } from "./scope-rule";

import { KATEGORI_PIUTANG_PELANGGAN } from "./selisih-arus-kas-model";

type Q = typeof import("./selisih-arus-kas-queries");

/**
 * PENJELASAN SELISIH ARUS KAS di Postgres NYATA (rencana 2026-11-11-2210 U2;
 * R2, R7) — `getPembayaranPiutangSekitar` lewat `qScoped` sebagai
 * `dashboard_app` (non-superuser, di bawah RLS `unit_scope`).
 *
 * Yang dibuktikan: bucket pelanggan (batal & SJENIS-4 tanpa titik keluar,
 * bertitik masuk), baris kas void keluar, jendela ±7 hari, dan RLS fail-closed
 * (tanpa `app.unit_ids` = nol baris).
 *
 * ⛔ HANYA Postgres LOKAL SEKALI PAKAI yang sudah dimigrasi sampai 0062 —
 * JANGAN arahkan ke DB tier mana pun. Fixture unit FIKTIF 9931/9932 di-COMMIT
 * ke DB lokal itu lalu dihapus di afterAll.
 *
 *   SELISIH_ARUS_LOCAL_DB=1 \
 *   DATABASE_URL=postgresql://dashboard_app:…@127.0.0.1:<port>/<db_lokal> \
 *   SELISIH_ARUS_SEED_URL=postgresql://ingest:…@127.0.0.1:<port>/<db_lokal> \
 *     pnpm --filter @solamax/dashboard exec vitest run src/lib/selisih-arus-kas.integration.test.ts
 */
const LIVE =
  process.env.SELISIH_ARUS_LOCAL_DB === "1" && !!process.env.DATABASE_URL && !!process.env.SELISIH_ARUS_SEED_URL;
const d = LIVE ? describe : describe.skip;

const A = 9931;
const B = 9932;
const CTX = `${A},${B}`;
const D = "2026-10-26";
/** `created_by_user_id` tanpa FK — id pembuat fiktif. */
const PEMBUAT = 1;

d("getPembayaranPiutangSekitar — DB lokal nyata, dashboard_app di bawah RLS", () => {
  let Qm: Q;
  let seed: Pool;
  let dash: Pool;

  async function bersihkan(): Promise<void> {
    const c = await seed.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [CTX]);
      for (const t of [
        "app.cash_ledger",
        "app.pos_unit", // lahir otomatis bersama rekening
        "app.cash_account",
        "app.pihak_lawan", // lahir otomatis dari pelanggan_master
        "public.bppiut",
        "public.pelanggan_master",
      ]) {
        await c.query(`DELETE FROM ${t} WHERE unit_id IN ($1, $2)`, [A, B]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    Qm = await import("./selisih-arus-kas-queries");
    seed = new Pool({ connectionString: process.env.SELISIH_ARUS_SEED_URL, max: 2 });
    dash = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await bersihkan();
    const c = await seed.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [CTX]);
      const t = await c.query<{ id: string }>(
        `INSERT INTO app.tenant (name, slug) VALUES ('Uji selisih arus', 'uji-selisih-arus')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
      );
      for (const [u, kode] of [[A, "UJI-SA-A"], [B, "UJI-SA-B"]] as const) {
        await c.query(
          `INSERT INTO public.unit (unit_id, code, name, api_key_hash, tenant_id)
           VALUES ($1, $2, $2, 'tanpa-kunci-' || $2, $3::uuid) ON CONFLICT (unit_id) DO NOTHING`,
          [u, kode, t.rows[0]!.id],
        );
      }
      // Pelanggan: P-LOK = Lokal (SJENIS 1, tanpa titik); P-S4 = SJENIS 4 tanpa titik (di luar bucket);
      // P.ONL = Online (bertitik, SJENIS 4 — bucket Online tanpa filter SJENIS).
      for (const [u, kode, jenis] of [[A, "P-LOK", 1], [A, "P-S4", 4], [A, "P.ONL", 4], [B, "P-LOK", 1]] as const) {
        await c.query(`INSERT INTO public.pelanggan_master (unit_id, ckdplg, sjenis) VALUES ($1, $2, $3)`, [u, kode, jenis]);
      }
      const bp = async (u: number, kode: string, tgl: string, plg: string, jml: number, jenis = 2, batal = 0) =>
        c.query(
          `INSERT INTO public.bppiut (unit_id, ckdbppiut, dtgl, ckdplg, vcket, njumlah, sjnsbp, sbatal)
           VALUES ($1, $2, $3::date, $4, 'uji', $5, $6, $7)`,
          [u, kode, tgl, plg, jml, jenis, batal],
        );
      await bp(A, "BP01", "2026-10-29", "P-LOK", 1000); // masuk
      await bp(A, "BP02", "2026-10-29", "P.ONL", 200); // masuk (bertitik)
      await bp(A, "BP03", "2026-10-29", "P-S4", 30); // keluar (SJENIS 4 tanpa titik)
      await bp(A, "BP04", "2026-10-29", "P-LOK", 4, 2, 1); // keluar (batal)
      await bp(A, "BP05", "2026-10-29", "P-LOK", 5, 1); // keluar (penjualan, sjnsbp 1)
      await bp(A, "BP06", "2026-11-03", "P-LOK", 6000); // keluar (D+8)
      await bp(A, "BP07", "2026-11-02", "P-LOK", 7000); // masuk (D+7)
      await bp(B, "BP08", "2026-10-29", "P-LOK", 8000); // unit lain

      const akun = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_account (unit_id, nama, kind) VALUES ($1, 'Bank Contoh - 1234500000', 'bank') RETURNING id::text AS id`,
          [A],
        )
      ).rows[0]!.id;
      const kas = async (tgl: string, jml: number, kategori: string, batal = false) =>
        c.query(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount,
                                       void, voided_at, voided_by_user_id, created_by_user_id)
           VALUES ($1, $2::uuid, $3::date, 'uji', 'debet', 'debet', $4, $5,
                   $6, CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $7::int END, $7)`,
          [A, akun, tgl, kategori, jml, batal, PEMBUAT],
        );
      await kas(D, 1200, "Transfer Pembayaran Piutang Pelanggan"); // masuk
      await kas(D, 99, "Transfer Pembayaran Piutang Pelanggan", true); // keluar (void)
      await kas(D, 77, "Setoran Hasil Penjualan"); // keluar (kategori lain)
      await kas("2026-10-18", 55, "Transfer Pembayaran Piutang Pelanggan"); // keluar (D−8)
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (seed) await bersihkan().catch(() => {});
    await seed?.end();
    await dash?.end();
    const { pool } = await import("./db");
    await pool.end();
  });

  it("hanya baris yang sah, per hari, nomor rekening disamarkan", async () => {
    const hari = await Qm.getPembayaranPiutangSekitar(A as ScopedUnitId, D);
    expect(
      hari.map((h) => ({
        tanggal: h.tanggal,
        easymax: h.easymax.map((e) => [e.kode, e.pelanggan, e.rp]),
        bank: h.bank.map((b) => [b.rekening, b.rp]),
      })),
    ).toEqual([
      { tanggal: "2026-10-26", easymax: [], bank: [["Bank Contoh …0000", 1200]] },
      { tanggal: "2026-10-29", easymax: [["BP01", "P-LOK", 1000], ["BP02", "P.ONL", 200]], bank: [] },
      { tanggal: "2026-11-02", easymax: [["BP07", "P-LOK", 7000]], bank: [] },
    ]);
  });

  it("RLS fail-closed: tanpa app.unit_ids, dashboard_app tak melihat satu baris pun", async () => {
    const r = await dash.query(Qm.SQL_PEMBAYARAN_PIUTANG_SEKITAR, [A, D, KATEGORI_PIUTANG_PELANGGAN]);
    expect(r.rowCount).toBe(0);
    // Kontrol positif: SQL yang sama dengan konteks unit B (unit lain) juga nol,
    // dengan konteks unit A tidak — jadi nol di atas memang dari RLS.
    const c = await dash.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(B)]);
      expect((await c.query(Qm.SQL_PEMBAYARAN_PIUTANG_SEKITAR, [A, D, KATEGORI_PIUTANG_PELANGGAN])).rowCount).toBe(0);
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(A)]);
      expect((await c.query(Qm.SQL_PEMBAYARAN_PIUTANG_SEKITAR, [A, D, KATEGORI_PIUTANG_PELANGGAN])).rowCount).toBe(4);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
});
