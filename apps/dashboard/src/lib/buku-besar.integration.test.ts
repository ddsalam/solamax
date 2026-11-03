import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * BUKU BESAR di DB nyata (rencana 2026-11-02 K6 U8; KTD3, R6, R13) — yang tak
 * bisa dibuktikan tiruan: trigger seimbang TUNDA, garis beku bulan, pos sah,
 * kunci sumber unik 0058 benar-benar DITEGAKKAN Postgres, dan
 * `bentukUlangHari` berjalan di atas SQL `buku-besar-sumber.ts` yang
 * sesungguhnya. Setiap kasus di dalam transaksi yang SELALU di-ROLLBACK;
 * pemeriksaan tunda dipaksa dengan `SET CONSTRAINTS ALL IMMEDIATE`.
 *
 * Gated: BUKU_BESAR_LIVE_DB=1 dan BUKU_BESAR_DB_URL (pola
 * `penebusan.integration.test.ts`) — Postgres sekali pakai yang sudah
 * dimigrasi sampai 0058, dengan satu unit berakun Kas Besar + rekening bank
 * bersub-pos. ⛔ Jangan arahkan ke DB pilot live. 0058 belum ter-apply ⇒ skip.
 */
const LIVE = process.env.BUKU_BESAR_LIVE_DB === "1" && !!process.env.BUKU_BESAR_DB_URL;
const d = LIVE ? describe : describe.skip;

d("0058 buku besar — ditegakkan DB", () => {
  let pool: Pool;
  let applied = false;
  let U = { unitId: 0, kas: "", bank: "", posBank: "" };
  const HARI = "2026-10-14";

  beforeAll(async () => {
    // db.ts membuat Pool saat diimpor (tanpa menyambung).
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
  /** Percobaan yang diharapkan gagal, terisolasi SAVEPOINT. */
  const gagal = async (c: PoolClient, sql: string, p: unknown[] = []): Promise<string> => {
    await c.query("SAVEPOINT s");
    try {
      await c.query(sql, p);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      // Kembali tunda: SET CONSTRAINTS bertahan sampai akhir transaksi.
      await c.query("SET CONSTRAINTS ALL DEFERRED");
      await c.query("RELEASE SAVEPOINT s");
      return "";
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT s");
      return e instanceof Error ? e.message : String(e);
    }
  };
  const jurnal = async (c: PoolClient, tanggal: string, jenis = "memorial", aturan = "P21"): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.jurnal (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, keterangan)
         VALUES ($1, $2::date, $2::date, $3, $4, 'uji', gen_random_uuid()::text, 'uji') RETURNING id::text AS id`,
        [U.unitId, tanggal, jenis, aturan],
      )
    ).rows[0]!.id;
  const baris = (c: PoolClient, j: string, pos: string, d: number, k: number) =>
    c.query(`INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen) VALUES ($1::uuid, $2, $3, $4, $5)`, [j, U.unitId, pos, d, k]);

  it("prasyarat: 0058 ter-apply dan unit uji ada", () => {
    expect(applied).toBe(true);
  });

  it("jurnal tidak seimbang ditolak saat pemeriksaan tunda; seimbang lolos", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      await baris(c, j, "1101", 100, 0);
      await baris(c, j, "5700", 0, 90);
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toMatch(/tidak seimbang/);
    });
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      await baris(c, j, "5700", 100, 0);
      await baris(c, j, "1101", 0, 100);
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toBe("");
    });
  });

  it("jurnal satu baris / tanpa baris ditolak", async () => {
    if (!applied) return;
    await tx(async (c) => {
      await jurnal(c, HARI);
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toMatch(/tidak seimbang: 0 baris/);
    });
  });

  it("pos induk, 3900, dan sub-pos milik unit lain ditolak; sub-pos bank unit sendiri lolos", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      const ins = `INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen) VALUES ($1::uuid, $2, $3, 1, 0)`;
      expect(await gagal(c, ins, [j, U.unitId, "1110"])).toMatch(/pos induk/);
      expect(await gagal(c, ins, [j, U.unitId, "3900"])).toMatch(/tidak bisa dijurnal/);
      expect(await gagal(c, ins, [j, U.unitId, "1119"])).toMatch(/tidak dikenal/);
      await c.query("SAVEPOINT ok");
      await c.query(ins, [j, U.unitId, U.posBank]);
      await c.query("ROLLBACK TO SAVEPOINT ok");
    });
  });

  it("satu baris hanya satu sisi, sen tak boleh negatif", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      const ins = `INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen) VALUES ($1::uuid, $2, '1101', $3, $4)`;
      expect(await gagal(c, ins, [j, U.unitId, 5, 5])).toMatch(/jurnal_baris_satu_sisi/);
      expect(await gagal(c, ins, [j, U.unitId, -5, 0])).toMatch(/jurnal_baris_satu_sisi/);
    });
  });

  it("saldo sebelum hari D tidak menghitung jurnal sumber yang dibukukan PADA D (terdorong maju, efektif < D)", async () => {
    if (!applied) return;
    const { SQL_SALDO_SEBELUM } = await import("./buku-besar-sumber");
    await tx(async (c) => {
      // P7 penebusan yang terdorong maju: dibukukan HARI, efektif sehari sebelumnya.
      const j = (
        await c.query<{ id: string }>(
          `INSERT INTO app.jurnal (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, keterangan)
           VALUES ($1, $2::date, ($2::date - 1), 'sumber', 'P7', 'cash_ledger', 'maju-1', 'uji') RETURNING id::text AS id`,
          [U.unitId, HARI],
        )
      ).rows[0]!.id;
      await baris(c, j, "1132", 100_000, 0);
      await baris(c, j, U.posBank, 0, 100_000);
      const r = await c.query<{ kode: string; gerak: string }>(SQL_SALDO_SEBELUM, [U.unitId, HARI]);
      const g = (k: string) => Number(r.rows.find((x) => x.kode === k)?.gerak ?? "NaN");
      // Dibentuk ulang dari sumber pada hari ini — tidak boleh ikut saldo pembuka hari itu.
      expect(g("1132")).toBe(0);
      // Hari sesudahnya ia memang bagian dari saldo sebelum.
      const besok = await c.query<{ kode: string; gerak: string }>(SQL_SALDO_SEBELUM, [U.unitId, "2026-10-15"]);
      expect(Number(besok.rows.find((x) => x.kode === "1132")?.gerak)).toBe(100_000);
    });
  });

  it("kunci sumber unik untuk jurnal sumber", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const ins = `INSERT INTO app.jurnal (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, keterangan)
                   VALUES ($1, $2::date, $2::date, 'sumber', 'P2', 'cash_ledger', 'x-1', 'uji')`;
      await c.query(ins, [U.unitId, HARI]);
      expect(await gagal(c, ins, [U.unitId, HARI])).toMatch(/jurnal_sumber_uq/);
    });
  });

  it("bulan ditutup dengan buku besar: jurnal & barisnya beku; bulan K5 tidak", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      await baris(c, j, "5700", 100, 0);
      await baris(c, j, "1101", 0, 100);
      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, true)`, [U.unitId]);
      expect(await gagal(c, `UPDATE app.jurnal SET keterangan = 'ubah' WHERE id = $1::uuid`, [j])).toMatch(/beku/);
      expect(await gagal(c, `INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen) VALUES ($1::uuid, $2, '1101', 1, 0)`, [j, U.unitId])).toMatch(/beku/);
      expect(
        await gagal(c, `INSERT INTO app.jurnal (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, keterangan) VALUES ($1, '2026-10-20', '2026-10-20', 'memorial', 'P21', 'uji')`, [U.unitId]),
      ).toMatch(/beku/);
    });
    await tx(async (c) => {
      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id) VALUES ($1, '2026-10-01', 1)`, [U.unitId]);
      const j = await jurnal(c, HARI, "sumber", "P2");
      await baris(c, j, "1101", 100, 0);
      await baris(c, j, "1103", 0, 100);
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toBe("");
    });
  });

  it("memorial tidak boleh dihapus; pengusul tidak boleh menyetujui sendiri", async () => {
    if (!applied) return;
    await tx(async (c) => {
      const j = await jurnal(c, HARI);
      expect(await gagal(c, `DELETE FROM app.jurnal WHERE id = $1::uuid`, [j])).toMatch(/pembalikan/);
      expect(
        await gagal(c, `UPDATE app.jurnal SET diusulkan_oleh_user_id = 5, disetujui_oleh_user_id = 5, disetujui_at = now() WHERE id = $1::uuid`, [j]),
      ).toMatch(/jurnal_empat_mata/);
    });
  });

  it("bentukUlangHari di SQL nyata: P2, P9, P26 tersimpan, seimbang, idempoten; bulan tertutup → satu koreksi maju", async () => {
    if (!applied) return;
    const { bentukUlangHari } = await import("./buku-besar-tulis");
    const aktor = { userId: 1, email: "uji@contoh.test" };
    const easymax = async () => ({
      produk: [
        { produk: "UJI-BBM", volumeL: 4_000, teraL: 0, hargaJual: 10_000, hargaBeli: 9_000, stokL: 0, lossesGainL: 0, penerimaanL: 0, sisaSoAktifL: 0 },
      ],
      pelanggan: null,
    });
    await tx(async (c) => {
      const unit = U.unitId as never;
      await c.query(
        `INSERT INTO app.saldo_awal_pos (unit_id, pos_kode, saldo_sen, sumber, entered_by_user_id)
         VALUES ($1, '1131', 3600000000, 'akuntan', 1), ($1, '1132', 0, 'akuntan', 1)`,
        [U.unitId],
      );
      const setor = (
        await c.query<{ id: string }>(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
           VALUES ($1, $2::uuid, $3::date, 'Setoran shift 1', 'debet', 'debet', 'Setoran Hasil Penjualan', 20000000, 1) RETURNING id::text AS id`,
          [U.unitId, U.kas, HARI],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
         VALUES ($1, $2::uuid, $3::date, 'Biaya tanpa tautan', 'kredit', 'kredit', 'Biaya Operasional', -900000, 1)`,
        [U.unitId, U.bank, HARI],
      );

      const r1 = await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect(r1.mode).toBe("langsung");
      const per = async () =>
        (
          await c.query<{ aturan: string; pos: string; net: string }>(
            `SELECT j.aturan, b.pos_kode AS pos, sum(b.debet_sen - b.kredit_sen)::text AS net
               FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
              WHERE j.unit_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
            [U.unitId],
          )
        ).rows.map((x) => `${x.aturan}:${x.pos}:${x.net}`);
      const sesudah1 = await per();
      expect(sesudah1).toEqual(
        expect.arrayContaining([
          "P2:1101:2000000000",
          "P2:1103:-2000000000",
          "P9:5100:3600000000",
          "P9:1131:-3600000000",
          `P26:${U.posBank}:-90000000`,
          "P26:1198:90000000",
          "P1:4100:-4000000000",
        ]),
      );
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toBe("");

      const r2 = await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect(r2.ditulis).toBe(0);
      expect(await per()).toEqual(sesudah1);

      // Bulan Oktober ditutup dengan buku besar; setoran dikoreksi sesudahnya.
      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, true)`, [U.unitId]);
      await c.query(`UPDATE app.cash_ledger SET amount = 19500000 WHERE id = $1::uuid`, [setor]);
      const r3 = await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect(r3.mode).toBe("koreksi_maju");
      const kor = await c.query<{ tb: string; te: string; pos: string; net: string }>(
        `SELECT to_char(j.tanggal_buku,'YYYY-MM-DD') AS tb, to_char(j.tanggal_efektif,'YYYY-MM-DD') AS te,
                b.pos_kode AS pos, (b.debet_sen - b.kredit_sen)::text AS net
           FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
          WHERE j.unit_id = $1 AND j.jenis = 'koreksi' ORDER BY b.pos_kode`,
        [U.unitId],
      );
      expect(kor.rows).toEqual([
        { tb: "2026-11-01", te: HARI, pos: "1101", net: "-50000000" },
        { tb: "2026-11-01", te: HARI, pos: "1103", net: "50000000" },
      ]);
      const r4 = await bentukUlangHari(c, unit, HARI, { aktor, easymax });
      expect(r4.koreksi).toBeNull();
      expect(await gagal(c, "SET CONSTRAINTS ALL IMMEDIATE")).toBe("");
      const audit = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'buku_besar.bentuk_ulang' AND target = $1`, [`${U.unitId}/${HARI}`]);
      expect(audit.rows[0]!.n).toBe(4);
    });
  });
});
