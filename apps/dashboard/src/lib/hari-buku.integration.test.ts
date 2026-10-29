import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { hariBukuTerkunci, kunciHariEksklusif } from "./hari-buku-queries";
import type { ScopedUnitId } from "./scope";

/**
 * PENJAGA HARI TERTUTUP di DB nyata (rencana 2026-10-29 U2; KTD5, R28) —
 * skenario KONKURENSI yang tak bisa dibuktikan uji murni `hari-buku.test.ts`:
 *
 * - penutupan dan pembukuan BERSAMAAN: yang membukukan menunggu kunci lalu
 *   berakhir di D+1, tidak pernah menulis ke D yang baru ditutup;
 * - jalur tulis yang lebih dulu memegang hari D membuat penutupan MENUNGGU
 *   (barisnya ikut terhitung saat `tutupHari` menghitung ulang);
 * - hari tanpa baris `day_close` tetap terkunci — dan TIDAK diberi baris
 *   bernilai nol (penyimpangan yang disengaja dari KTD5, lihat
 *   `hari-buku-queries.ts`).
 *
 * Unit FIKTIF 8803 (pola `pihak-lawan.integration.test.ts`): `day_close` dan
 * `cash_ledger` tak ber-FK ke `public.unit` pada `unit_id`. Uji konkurensi
 * butuh baris yang di-COMMIT (transaksi lain harus melihatnya), jadi fixture
 * `day_close` 8803 DIHAPUS di before/afterAll — karena itu koneksinya role
 * PEMILIK (`ingest`; `dashboard_app` di-REVOKE DELETE, 0026).
 *
 * Gated: HARI_BUKU_LIVE_DB=1 dan HARI_BUKU_DB_URL = role pemilik di tier
 * TESTING `solamax-pg-rlsstg`. ⛔ Jangan arahkan ke DB pilot live.
 */
const LIVE = process.env.HARI_BUKU_LIVE_DB === "1" && !!process.env.HARI_BUKU_DB_URL;
const d = LIVE ? describe : describe.skip;

const U = 8803 as unknown as ScopedUnitId;
const D = "2026-11-03";
const D1 = "2026-11-04";

/** Janji yang belum selesai sesudah `ms` = sedang menunggu kunci. */
const masihMenunggu = async (p: Promise<unknown>, ms = 400): Promise<boolean> => {
  const t = Symbol("tunggu");
  const r = await Promise.race([p.then(() => null, () => null), new Promise((ok) => setTimeout(() => ok(t), ms))]);
  return r === t;
};

d("hariBukuTerkunci — penjaga hari tertutup di bawah konkurensi", () => {
  let pool: Pool;

  const buka = async (): Promise<PoolClient> => {
    const c = await pool.connect();
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '10s'");
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(U)]);
    return c;
  };
  const selesai = async (c: PoolClient, aksi: "COMMIT" | "ROLLBACK"): Promise<void> => {
    try {
      await c.query(aksi);
    } finally {
      c.release();
    }
  };
  const bersihkan = async (): Promise<void> => {
    const c = await buka();
    await c.query("DELETE FROM app.day_close WHERE unit_id = $1", [U]);
    await selesai(c, "COMMIT");
  };
  /** Meniru `tutupHari`: kunci eksklusif lalu tulis baris berstatus closed. */
  const tutup = async (c: PoolClient, hari: string): Promise<void> => {
    await c.query(
      `INSERT INTO app.day_close
         (unit_id, business_date, status, difference_rp, tier, closed_by_user_id, closed_at)
       VALUES ($1, $2::date, 'closed', 0, 'within_tolerance', 1, now())
       ON CONFLICT (unit_id, business_date) DO UPDATE
          SET status='closed', closed_by_user_id=1, closed_at=now()`,
      [U, hari],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.HARI_BUKU_DB_URL, max: 4 });
    await bersihkan();
  });
  afterAll(async () => {
    await bersihkan().catch(() => {});
    await pool?.end();
  });

  it("hari tanpa baris day_close ⇒ terbuka, dan TIDAK diberi baris (nol bukan 'belum terhitung')", async () => {
    const c = await buka();
    try {
      const h = await hariBukuTerkunci(c, U, D);
      expect(h).toEqual({ status: "dibukukan", hariBuku: D, terdorongMaju: false, perluKodeAlasan: false });
      const n = await c.query("SELECT 1 FROM app.day_close WHERE unit_id = $1 AND business_date = $2::date", [U, D]);
      expect(n.rowCount).toBe(0);
    } finally {
      await selesai(c, "ROLLBACK");
    }
  });

  it("🔴 penutup lebih dulu ⇒ pembuku MENUNGGU, lalu maju ke D+1 — tidak pernah ke D tertutup", async () => {
    await bersihkan();
    const penutup = await buka();
    const pembuku = await buka();
    try {
      await kunciHariEksklusif(penutup, U, D);
      await tutup(penutup, D);

      const janji = hariBukuTerkunci(pembuku, U, D);
      expect(await masihMenunggu(janji)).toBe(true);

      await selesai(penutup, "COMMIT");
      expect(await janji).toEqual({
        status: "dibukukan",
        hariBuku: D1,
        terdorongMaju: true,
        perluKodeAlasan: true,
      });
    } finally {
      await selesai(pembuku, "ROLLBACK");
      await bersihkan();
    }
  });

  it("🔴 pembuku lebih dulu (hari TANPA baris) ⇒ penutup MENUNGGU sampai barisnya COMMIT", async () => {
    await bersihkan();
    const pembuku = await buka();
    const penutup = await buka();
    try {
      const h = await hariBukuTerkunci(pembuku, U, D);
      expect(h).toMatchObject({ status: "dibukukan", hariBuku: D });

      const janji = kunciHariEksklusif(penutup, U, D);
      expect(await masihMenunggu(janji)).toBe(true);

      await selesai(pembuku, "COMMIT");
      await janji; // kunci didapat SESUDAH pembuku COMMIT — hitung ulang melihat barisnya
    } finally {
      await selesai(penutup, "ROLLBACK");
      await bersihkan();
    }
  });

  it("baris day_close open yang ada dikunci FOR SHARE ⇒ FOR UPDATE penutup ikut menunggu", async () => {
    await bersihkan();
    const siap = await buka();
    await siap.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier)
       VALUES ($1, $2::date, 'open', 0, 'within_tolerance')`,
      [U, D],
    );
    await selesai(siap, "COMMIT");

    const pembuku = await buka();
    const penutup = await buka();
    try {
      await hariBukuTerkunci(pembuku, U, D);
      const janji = penutup.query(
        "SELECT 1 FROM app.day_close WHERE unit_id = $1 AND business_date = $2::date FOR UPDATE",
        [U, D],
      );
      expect(await masihMenunggu(janji)).toBe(true);
      await selesai(pembuku, "COMMIT");
      await janji;
    } finally {
      await selesai(penutup, "ROLLBACK");
      await bersihkan();
    }
  });

  it("R22 — tanggal sebelum saldo pembuka ⇒ pra-cut-over (rekening & unit)", async () => {
    const c = await buka();
    try {
      const akun = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_account (unit_id, nama, kind)
           VALUES ($1, 'Bank BCA - 0000000000', 'bank') RETURNING id::text AS id`,
          [U],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis, amount, saldo_awal, created_by_user_id)
         VALUES ($1, $2::uuid, '2026-10-01', 'Saldo Awal', 'adjustment', 1000, true, 1)`,
        [U, akun],
      );
      expect(await hariBukuTerkunci(c, U, "2026-09-30", { accountId: akun })).toEqual({
        status: "pra-cut-over",
        cutOver: "2026-10-01",
      });
      // Tanpa rekening: cut-over terawal unit (§10.26).
      expect(await hariBukuTerkunci(c, U, "2026-09-30")).toEqual({ status: "pra-cut-over", cutOver: "2026-10-01" });
    } finally {
      await selesai(c, "ROLLBACK");
    }
  });

  it("🔴 tanpa app.unit_ids berisi unitnya ⇒ MENOLAK (RLS akan menyembunyikan hari tertutup)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await expect(hariBukuTerkunci(c, U, D)).rejects.toThrow(/app\.unit_ids/);
    } finally {
      await selesai(c, "ROLLBACK");
    }
  });

  it("🔴 REPEATABLE READ ⇒ MENOLAK (snapshot beku sebelum kunci)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(U)]);
      await expect(hariBukuTerkunci(c, U, D)).rejects.toThrow(/READ COMMITTED/);
    } finally {
      await selesai(c, "ROLLBACK");
    }
  });
});
