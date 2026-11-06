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

d("Balik baris pintu Finance hari tertutup — DB nyata (rencana 2026-11-07 U5; AE4, AE5)", () => {
  let pool: Pool;
  let T: typeof import("./batal-balik-tulis");
  let SQL_ME_TAK_BERLAKU: typeof import("./keuangan-berlaku").SQL_ME_TAK_BERLAKU;
  let bentukJurnalSesudahTulis: typeof import("./buku-besar-tulis").bentukJurnalSesudahTulis;
  const pengaju = { userId: 77, email: "keuangan@contoh.test" };
  const hof = { userId: 88, email: "hof@contoh.test" };
  const adj = { reasonCode: "ADJ-DUP", alasan: "ganda dengan MDR otomatis settlement BCA" };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= process.env.BATAL_BALIK_DB_URL;
    pool = new Pool({ connectionString: process.env.BATAL_BALIK_DB_URL, max: 3 });
    T = await import("./batal-balik-tulis");
    ({ SQL_ME_TAK_BERLAKU } = await import("./keuangan-berlaku"));
    ({ bentukJurnalSesudahTulis } = await import("./buku-besar-tulis"));
  });
  afterAll(async () => {
    await pool?.end();
  });

  const tx = async (fn: (c: PoolClient) => Promise<void>, unit = UNIT): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit)]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };
  /** Baris Finance tanpa tautan kas di hari yang lalu DITUTUP. */
  const barisHariTutup = async (c: PoolClient, unit = UNIT): Promise<string> => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO app.manual_entry
           (unit_id, business_date, section, urut, keterangan, amount, accounting_account,
            status, source_door, created_by_user_id, submitted_at)
         VALUES ($1, $2::date, 'pengeluaran', 1, 'Biaya MDR EDC', 7560, '7-1200', 'submitted', 'finance', 1, now())
         RETURNING id::text`,
        [unit, HARI],
      )
    ).rows[0]!.id;
    // Ditutup di luar toleransi seperti Bakau 2 Okt: tier exception_hof, beralasan, disetujui.
    await c.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier, reason_code,
                                  reason_requires_target, closed_by_user_id, closed_at, approved_by_user_id, approved_at)
       VALUES ($1, $2::date, 'closed', 11676.5, 'exception_hof', 'CLS-CASH', false, 1, now(), 2, now())`,
      [unit, HARI],
    );
    return id;
  };
  const berlaku = async (c: PoolClient, id: string): Promise<boolean> =>
    (
      await c.query<{ b: boolean }>(
        `SELECT NOT ${SQL_ME_TAK_BERLAKU("m")} AS b FROM app.manual_entry m WHERE m.id = $1::uuid`,
        [id],
      )
    ).rows[0]!.b;

  it("🔴 hari masih terbuka → Balik ditolak (pakai Batalkan)", () =>
    tx(async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO app.manual_entry (unit_id, business_date, section, urut, keterangan, amount, status, source_door, created_by_user_id)
           VALUES ($1, $2::date, 'pengeluaran', 1, 'x', 100, 'submitted', 'finance', 1) RETURNING id::text`,
          [UNIT, HARI],
        )
      ).rows[0]!.id;
      expect(await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj })).toEqual({
        ok: false,
        error: "Hari ini belum ditutup — pakai Batalkan, bukan Balik.",
      });
    }));

  it("🔴 AE5: ajukan → setujui (orang lain) → SATU correction_entry tujuh field; baris asli tak di-UPDATE; tak berlaku; day_close beku; jurnal dipicu", () =>
    tx(async (c) => {
      const id = await barisHariTutup(c);
      const xminSebelum = (await c.query<{ x: string }>(`SELECT xmin::text AS x FROM app.manual_entry WHERE id = $1::uuid`, [id])).rows[0]!.x;
      const dcSebelum = (await c.query(`SELECT * FROM app.day_close WHERE unit_id = $1 AND business_date = $2::date`, [UNIT, HARI])).rows[0];

      const a = await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj });
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      expect(await berlaku(c, id)).toBe(true); // menunggu ≠ dibalik

      const s = await T.setujuiBalik(c, UNIT, hof, { requestId: a.requestId });
      expect(s).toEqual({ ok: true, businessDate: HARI, requestId: a.requestId });

      const ce = await c.query(
        `SELECT original_txn_id::text AS o, reason_code, value_before::float8 AS vb, value_after::float8 AS va,
                submitted_by_user_id AS sb, approved_by_user_id AS ab, approved_at IS NOT NULL AS at, evidence_ref, kind
           FROM app.correction_entry WHERE original_txn_id = $1::uuid`,
        [id],
      );
      expect(ce.rows).toEqual([
        { o: id, reason_code: "ADJ-DUP", vb: 7560, va: 0, sb: 77, ab: 88, at: true, evidence_ref: `correction_request:${a.requestId}`, kind: "reversal" },
      ]);
      expect((await c.query<{ x: string }>(`SELECT xmin::text AS x FROM app.manual_entry WHERE id = $1::uuid`, [id])).rows[0]!.x).toBe(xminSebelum);
      expect(await berlaku(c, id)).toBe(false);
      expect((await c.query(`SELECT * FROM app.day_close WHERE unit_id = $1 AND business_date = $2::date`, [UNIT, HARI])).rows[0]).toEqual(dcSebelum);
    }));

  it("🔴 KTD6: persetujuan SAJA (baris & pengajuan sudah di-COMMIT sebelumnya) memicu pembentukan ulang jurnal hari tertutup itu", async () => {
    const U3 = 30_126 as unknown as ScopedUnitId;
    let requestId = "";
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SELECT set_config('app.unit_ids', $1, true)", [String(U3)]);
      const id = await barisHariTutup(setup, U3);
      const a = await T.ajukanBalik(setup, U3, pengaju, { entryId: id, ...adj });
      if (!a.ok) throw new Error(a.error);
      requestId = a.requestId;
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }
    try {
      await tx(async (c) => {
        const tanpa = await bentukJurnalSesudahTulis(c, U3, hof);
        expect([...tanpa.dibentuk, ...tanpa.dilewati, ...tanpa.gagal.map((g) => g.tanggal)]).toEqual([]);
        expect((await T.setujuiBalik(c, U3, hof, { requestId })).ok).toBe(true);
        const j = await bentukJurnalSesudahTulis(c, U3, hof);
        expect([...j.dibentuk, ...j.gagal.map((g) => g.tanggal)]).toContain(HARI);
      }, U3);
    } finally {
      const b = await pool.connect();
      try {
        await b.query("BEGIN");
        // SET LOCAL — HANYA transaksi bersih-bersih ini; koneksi kembali ke pool dengan trigger hidup.
        await b.query("SET LOCAL session_replication_role = replica");
        await b.query(`DELETE FROM app.correction_request WHERE unit_id = $1`, [U3]);
        await b.query(`DELETE FROM app.audit_log WHERE detail->>'unitId' = $1`, [String(U3)]);
        await b.query(`DELETE FROM app.manual_entry WHERE unit_id = $1`, [U3]);
        await b.query(`DELETE FROM app.day_close WHERE unit_id = $1`, [U3]);
        await b.query("COMMIT");
      } finally {
        b.release();
      }
    }
  });

  it("🔴 AE4: pengaju menyetujui/menolak sendiri → server menolak; INSERT/UPDATE DB langsung → CHECK menolak", () =>
    tx(async (c) => {
      const id = await barisHariTutup(c);
      const a = await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj });
      if (!a.ok) throw new Error(a.error);
      expect(await T.setujuiBalik(c, UNIT, pengaju, { requestId: a.requestId })).toEqual({
        ok: false,
        error: "Pengajuan balik tidak bisa disetujui atau ditolak oleh pengajunya sendiri — perlu orang kedua.",
      });
      expect((await T.tolakBalik(c, UNIT, pengaju, { requestId: a.requestId, catatan: "tidak perlu" })).ok).toBe(false);
      await c.query("SAVEPOINT s");
      await expect(
        c.query(
          `INSERT INTO app.correction_entry (unit_id, source_kind, original_txn_id, reason_code, value_before, value_after,
                                             submitted_by_user_id, approved_by_user_id, approved_at, kind)
           VALUES ($1, 'manual_entry', $2::uuid, 'ADJ-DUP', 7560, 0, 77, 77, now(), 'reversal')`,
          [UNIT, id],
        ),
      ).rejects.toThrow(/correction_entry_segregation/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        c.query(`UPDATE app.correction_request SET status = 'ditolak', decided_by_user_id = 77, decided_at = now(), catatan_keputusan = 'xxxxx' WHERE id = $1::uuid`, [a.requestId]),
      ).rejects.toThrow(/correction_request_segregation/);
      await c.query("ROLLBACK TO SAVEPOINT s");
    }));

  it("tolak wajib bercatatan; pengajuan kedua saat menunggu ditolak; yang sudah diputus BEKU (trigger)", () =>
    tx(async (c) => {
      const id = await barisHariTutup(c);
      const a = await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj });
      if (!a.ok) throw new Error(a.error);
      expect(await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj })).toEqual({
        ok: false,
        error: "Sudah ada pengajuan balik yang menunggu persetujuan untuk baris ini.",
      });
      expect((await T.tolakBalik(c, UNIT, hof, { requestId: a.requestId, catatan: "  " })).ok).toBe(false);
      expect((await T.tolakBalik(c, UNIT, hof, { requestId: a.requestId, catatan: "bukan ganda, MDR terpisah" })).ok).toBe(true);
      await c.query("SAVEPOINT s");
      await expect(
        c.query(`UPDATE app.correction_request SET catatan_keputusan = 'ubah' WHERE id = $1::uuid`, [a.requestId]),
      ).rejects.toThrow(/sudah diputus/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      // Sesudah ditolak, boleh diajukan lagi; baris tetap berlaku.
      expect(await berlaku(c, id)).toBe(true);
      expect((await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj })).ok).toBe(true);
    }));

  it("🔴 bulan tertutup K5 → ajukan DAN setujui ditolak; reversal kedua ditolak indeks unik", () =>
    tx(async (c) => {
      const id = await barisHariTutup(c);
      const a = await T.ajukanBalik(c, UNIT, pengaju, { entryId: id, ...adj });
      if (!a.ok) throw new Error(a.error);
      await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar) VALUES ($1, '2026-10-01', 1, false)`, [UNIT]);
      expect(await T.setujuiBalik(c, UNIT, hof, { requestId: a.requestId })).toEqual({
        ok: false,
        error: "Bulan baris ini sudah ditutup — baris tidak bisa dibatalkan atau dibalik lagi.",
      });
      await c.query("SAVEPOINT s");
      await c.query(
        `INSERT INTO app.correction_entry (unit_id, source_kind, original_txn_id, reason_code, value_before, value_after,
                                           submitted_by_user_id, approved_by_user_id, approved_at, kind)
         VALUES ($1, 'manual_entry', $2::uuid, 'ADJ-DUP', 7560, 0, 77, 88, now(), 'reversal')`,
        [UNIT, id],
      );
      await expect(
        c.query(
          `INSERT INTO app.correction_entry (unit_id, source_kind, original_txn_id, reason_code, value_before, value_after,
                                             submitted_by_user_id, approved_by_user_id, approved_at, kind)
           VALUES ($1, 'manual_entry', $2::uuid, 'ADJ-DUP', 7560, 0, 77, 89, now(), 'reversal')`,
          [UNIT, id],
        ),
      ).rejects.toThrow(/correction_entry_reversal_uq/);
      await c.query("ROLLBACK TO SAVEPOINT s");
    }));

  it("🔴 Tarik dan Setujui BERSAMAAN → tepat satu menang; bila Tarik menang tak ada reversal", async () => {
    const U2 = 30_125 as unknown as ScopedUnitId;
    const setup = await pool.connect();
    let requestId = "";
    let entryId = "";
    try {
      await setup.query("BEGIN");
      await setup.query("SELECT set_config('app.unit_ids', $1, true)", [String(U2)]);
      entryId = await barisHariTutup(setup, U2);
      const a = await T.ajukanBalik(setup, U2, pengaju, { entryId, ...adj });
      if (!a.ok) throw new Error(a.error);
      requestId = a.requestId;
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(U2)]);
      }
      const tarik = await T.tarikBalik(c1, U2, pengaju, { requestId }); // memegang kunci baris pengajuan
      const setujuiP = T.setujuiBalik(c2, U2, hof, { requestId }); // menunggu kunci
      await c1.query("COMMIT");
      const setujui = await setujuiP;
      await c2.query("COMMIT");
      expect(tarik.ok).toBe(true);
      expect(setujui).toEqual({ ok: false, error: "Pengajuan ini sudah diputus atau ditarik — muat ulang halaman." });
      const n = await pool.query(`SELECT count(*)::int AS n FROM app.correction_entry WHERE original_txn_id = $1::uuid`, [entryId]);
      expect(n.rows[0].n).toBe(0);
    } finally {
      c1.release();
      c2.release();
      // Bersih-bersih data uji yang di-COMMIT (DB sekali pakai; trigger 0026/0060 dimatikan sesi ini saja).
      const b = await pool.connect();
      try {
        await b.query("BEGIN");
        // SET LOCAL — HANYA transaksi bersih-bersih ini; koneksi kembali ke pool dengan trigger hidup.
        await b.query("SET LOCAL session_replication_role = replica");
        await b.query(`DELETE FROM app.correction_request WHERE unit_id = $1`, [U2]);
        await b.query(`DELETE FROM app.audit_log WHERE detail->>'unitId' = $1`, [String(U2)]);
        await b.query(`DELETE FROM app.manual_entry WHERE unit_id = $1`, [U2]);
        await b.query(`DELETE FROM app.day_close WHERE unit_id = $1`, [U2]);
        await b.query("COMMIT");
      } finally {
        b.release();
      }
    }
  });
});
