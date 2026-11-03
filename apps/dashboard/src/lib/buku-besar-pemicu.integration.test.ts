import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * KTD3 pemicu 1 dan koreksi maju bulan tertutup di DB NYATA (rencana
 * 2026-11-02 K6; R6, R13). Yang tak bisa dibuktikan tiruan: `xmin` versi baris
 * yang ditulis transaksi berjalan, SAVEPOINT yang mengisolasi kegagalan, dan
 * trigger seimbang 0058 atas jurnal yang dibentuk. Setiap kasus di dalam
 * transaksi yang SELALU di-ROLLBACK.
 *
 * Gated seperti `buku-besar.integration.test.ts`: BUKU_BESAR_LIVE_DB=1 dan
 * BUKU_BESAR_DB_URL — Postgres sekali pakai yang sudah dimigrasi sampai 0058,
 * dengan satu unit berakun Kas Besar + rekening bank bersub-pos.
 * ⛔ Jangan arahkan ke DB pilot live.
 */
const LIVE = process.env.BUKU_BESAR_LIVE_DB === "1" && !!process.env.BUKU_BESAR_DB_URL;
const d = LIVE ? describe : describe.skip;

d("KTD3 pemicu 1 & koreksi maju — DB nyata", () => {
  let pool: Pool;
  let applied = false;
  let U = { unitId: 0, kas: "", bank: "", posBank: "" };
  const HARI = "2026-10-14";
  const aktor = { userId: 1, email: "uji@contoh.test" };
  const easymax = async () => ({ produk: [], pelanggan: null });

  beforeAll(async () => {
    process.env.DATABASE_URL ??= process.env.BUKU_BESAR_DB_URL;
    pool = new Pool({ connectionString: process.env.BUKU_BESAR_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(`SELECT to_regclass('app.jurnal') IS NOT NULL AS ada`);
    applied = r.rows[0]?.ada === true;
    if (!applied) return;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', (SELECT string_agg(DISTINCT unit_id::text, ',') FROM app.cash_account), true)");
      const u = await c.query<{ unit_id: number; kas: string; bank: string; pos: string }>(
        `SELECT k.unit_id, k.id::text AS kas, b.id::text AS bank, pu.kode AS pos
           FROM app.cash_account k
           JOIN app.cash_account b ON b.unit_id = k.unit_id AND b.kind = 'bank'
           JOIN app.pos_unit pu ON pu.cash_account_id = b.id
          WHERE k.kind = 'kas' AND k.nama = 'Kas Besar'
          ORDER BY k.unit_id, pu.kode LIMIT 1`,
      );
      if (u.rows[0]) U = { unitId: u.rows[0].unit_id, kas: u.rows[0].kas, bank: u.rows[0].bank, posBank: u.rows[0].pos };
      else applied = false;
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
      await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(U.unitId)]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };
  const biaya = async (c: PoolClient, tanggal: string, sen = -900000): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
         VALUES ($1, $2::uuid, $3::date, 'Biaya uji pemicu', 'kredit', 'kredit', 'Biaya Operasional', $4, 1) RETURNING id::text AS id`,
        [U.unitId, U.bank, tanggal, sen / 100],
      )
    ).rows[0]!.id;
  const jurnalKunci = async (c: PoolClient, id: string) =>
    (
      await c.query<{ aturan: string; pos: string; net: string }>(
        `SELECT j.aturan, b.pos_kode AS pos, (b.debet_sen - b.kredit_sen)::text AS net
           FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
          WHERE j.unit_id = $1 AND j.sumber_tabel = 'cash_ledger' AND j.sumber_id = $2 ORDER BY b.pos_kode`,
        [U.unitId, id],
      )
    ).rows.map((x) => `${x.aturan}:${x.pos}:${x.net}`);
  const seimbang = async (c: PoolClient): Promise<string> => {
    await c.query("SAVEPOINT cek");
    try {
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      await c.query("SET CONSTRAINTS ALL DEFERRED");
      await c.query("RELEASE SAVEPOINT cek");
      return "";
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT cek");
      return e instanceof Error ? e.message : String(e);
    }
  };

  it("prasyarat: 0058 ter-apply dan unit uji ada", () => {
    expect(applied).toBe(true);
  });

  it("menemukan HANYA baris yang ditulis transaksi ini (xmin), membentuk jurnalnya seimbang; batal ⇒ jurnal hilang", async () => {
    if (!applied) return;
    const { bentukJurnalSesudahTulis } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const unit = U.unitId as never;
      const id = await biaya(c, HARI);
      const r = await bentukJurnalSesudahTulis(c, unit, aktor);
      expect(r).toEqual({ dibentuk: [HARI], dilewati: [], gagal: [] });
      expect(await jurnalKunci(c, id)).toEqual([`P26:${U.posBank}:-900000`, "P26:1198:900000"]);
      expect(await seimbang(c)).toBe("");
      const audit = await c.query<{ detail: { sumber: string[] } }>(
        `SELECT detail FROM app.audit_log WHERE action = 'buku_besar.bentuk_sumber' AND target = $1 ORDER BY id DESC LIMIT 1`,
        [`${U.unitId}/${HARI}`],
      );
      expect(audit.rows[0]!.detail.sumber).toEqual([`cash_ledger|${id}`]);

      // Dipanggil lagi tanpa tulisan baru: idempoten.
      expect((await bentukJurnalSesudahTulis(c, unit, aktor)).dibentuk).toEqual([HARI]);
      expect(await jurnalKunci(c, id)).toEqual([`P26:${U.posBank}:-900000`, "P26:1198:900000"]);

      await c.query(`UPDATE app.cash_ledger SET void = true, voided_by_user_id = 1, voided_at = now() WHERE id = $1::uuid`, [id]);
      await bentukJurnalSesudahTulis(c, unit, aktor);
      expect(await jurnalKunci(c, id)).toEqual([]);
    });
  });

  it("baris di transaksi lain (sudah COMMIT sebelumnya) tidak ikut dibentuk", async () => {
    if (!applied) return;
    const { bentukJurnalSesudahTulis } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const r = await bentukJurnalSesudahTulis(c, U.unitId as never, aktor);
      expect(r).toEqual({ dibentuk: [], dilewati: [], gagal: [] });
    });
  });

  it("bulan tertutup dilewati; kegagalan pembentukan tidak membatalkan tulisan (SAVEPOINT) dan tercatat di audit", async () => {
    if (!applied) return;
    const { bentukJurnalSesudahTulis } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const unit = U.unitId as never;
      const id = await biaya(c, HARI);
      const r = await bentukJurnalSesudahTulis(c, unit, aktor, {
        baca: async () => {
          throw new Error("pembaca rusak (uji)");
        },
      });
      expect(r.dibentuk).toEqual([]);
      expect(r.gagal).toEqual([{ tanggal: HARI, error: "pembaca rusak (uji)" }]);
      // Transaksi tetap hidup dan tulisan tetap ada.
      const ada = await c.query(`SELECT 1 FROM app.cash_ledger WHERE id = $1::uuid AND NOT void`, [id]);
      expect(ada.rows).toHaveLength(1);
      const g = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'buku_besar.bentuk_sumber_gagal' AND target = $1`, [`${U.unitId}/${HARI}`]);
      expect(g.rows[0]!.n).toBe(1);

      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, true)`, [U.unitId]);
      expect(await bentukJurnalSesudahTulis(c, unit, aktor)).toEqual({ dibentuk: [], dilewati: [HARI], gagal: [] });
      expect(await jurnalKunci(c, id)).toEqual([]);
    });
  });

  it("tabel yang DIBACA aturan ikut: penebusan baru atas baris kas transaksi lain mengubah P26 → P7", async () => {
    if (!applied) return;
    const { bentukJurnalSesudahTulis, bentukUlangHari } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const unit = U.unitId as never;
      // Baris kas di subtransaksi = xmin lain (meniru baris yang COMMIT lebih dulu).
      await c.query("SAVEPOINT lama");
      const kas = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
           VALUES ($1, $2::uuid, $3::date, 'Tebus SO uji', 'kredit', 'kredit', 'Pembelian BBM', -1000000, 1) RETURNING id::text AS id`,
          [U.unitId, U.bank, HARI],
        )
      ).rows[0]!.id;
      await c.query("RELEASE SAVEPOINT lama");
      await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect((await jurnalKunci(c, kas)).every((x) => x.startsWith("P26:"))).toBe(true);

      await c.query(
        `INSERT INTO app.penebusan (unit_id, no_so, tanggal_bayar, account_id, net, ppn, pph, pbbkb, nota, gross, cash_ledger_id, kas_dibuat, created_by_user_id)
         VALUES ($1, 'so-uji-1', $2::date, $3::uuid, 1000000, 0, 0, 0, 0, 1000000, $4::uuid, false, 1)`,
        [U.unitId, HARI, U.bank, kas],
      );
      expect((await bentukJurnalSesudahTulis(c, unit, aktor)).dibentuk).toEqual([HARI]);
      const sesudah = await jurnalKunci(c, kas);
      expect(sesudah.length).toBeGreaterThan(0);
      expect(sesudah.every((x) => x.startsWith("P7:"))).toBe(true);
      expect(await seimbang(c)).toBe("");
    });
  });

  it("hari TERTUTUP di bulan terbuka tetap dibentuk (reklasifikasi boleh di sana; tutup hari tak berjalan dua kali)", async () => {
    if (!applied) return;
    const { bentukJurnalSesudahTulis } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const id = await biaya(c, HARI);
      await c.query(
        `INSERT INTO app.day_close (unit_id, business_date, difference_rp, tier, status, closed_by_user_id, closed_at) VALUES ($1, $2::date, 0, 'within_tolerance', 'closed', 1, now())`,
        [U.unitId, HARI],
      );
      expect(await bentukJurnalSesudahTulis(c, U.unitId as never, aktor)).toEqual({ dibentuk: [HARI], dilewati: [], gagal: [] });
      expect(await jurnalKunci(c, id)).toEqual([`P26:${U.posBank}:-900000`, "P26:1198:900000"]);
    });
  });

  /** Satu klien di dalam transaksi luar: BEGIN/COMMIT/ROLLBACK → SAVEPOINT, supaya semuanya tetap di-ROLLBACK. */
  const bukaDalam = (c: PoolClient) => async (): Promise<PoolClient> => {
    let n = 0;
    const query = (sql: unknown, p?: unknown) => {
      if (sql === "BEGIN") return c.query(`SAVEPOINT k${++n}`);
      if (sql === "COMMIT") return c.query(`RELEASE SAVEPOINT k${n}`);
      if (sql === "ROLLBACK") return c.query(`ROLLBACK TO SAVEPOINT k${n}`);
      return (c.query as (s: unknown, v?: unknown) => Promise<unknown>)(sql, p);
    };
    return { query, release: () => {} } as unknown as PoolClient;
  };

  it("koreksiMajuBulan: sumber bulan beku berubah ⇒ satu koreksi maju di hari buka berikutnya; diulang ⇒ tidak menggandakan", async () => {
    if (!applied) return;
    const { bentukUlangHari, koreksiMajuBulan } = await import("./buku-besar-tulis");
    await tx(async (c) => {
      const unit = U.unitId as never;
      const id = await biaya(c, HARI);
      await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect(await jurnalKunci(c, id)).toEqual([`P26:${U.posBank}:-900000`, "P26:1198:900000"]);

      // Belum ditutup / ditutup tanpa buku besar ⇒ ditolak tanpa menulis.
      expect(await koreksiMajuBulan(bukaDalam(c), unit, "2026-10", { aktor, easymax })).toMatchObject({ ok: false, error: expect.stringMatching(/belum ditutup/) });
      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, false)`, [U.unitId]);
      expect(await koreksiMajuBulan(bukaDalam(c), unit, "2026-10", { aktor, easymax })).toMatchObject({ ok: false, error: expect.stringMatching(/tanpa buku besar/) });
      await c.query(`UPDATE app.tutup_bulan SET buku_besar = true WHERE unit_id = $1 AND bulan = '2026-10-01'`, [U.unitId]);

      // Sumber berubah sesudah bulan beku.
      await c.query(`UPDATE app.cash_ledger SET amount = -6000 WHERE id = $1::uuid`, [id]);
      const r1 = await koreksiMajuBulan(bukaDalam(c), unit, "2026-10", { aktor, easymax });
      expect(r1.ok).toBe(true);
      const hariIni = r1.hari.find((h) => h.tanggal === HARI)!;
      expect(hariIni.mode).toBe("koreksi_maju");
      expect(hariIni.koreksi?.tanggalBuku).toBe("2026-11-01");
      expect(await jurnalKunci(c, id)).toEqual([`P26:${U.posBank}:-900000`, "P26:1198:900000"]); // jurnal beku utuh
      const kor = await c.query<{ pos: string; net: string }>(
        `SELECT b.pos_kode AS pos, sum(b.debet_sen - b.kredit_sen)::text AS net
           FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
          WHERE j.unit_id = $1 AND j.jenis = 'koreksi' AND j.sumber_id = $2 GROUP BY 1 ORDER BY 1`,
        [U.unitId, HARI],
      );
      expect(kor.rows).toEqual([
        { pos: U.posBank, net: "300000" },
        { pos: "1198", net: "-300000" },
      ]);
      expect(await seimbang(c)).toBe("");

      const r2 = await koreksiMajuBulan(bukaDalam(c), unit, "2026-10", { aktor, easymax });
      expect(r2.ok && r2.hari.find((h) => h.tanggal === HARI)!.koreksi).toBeNull();
    });
  });
});
