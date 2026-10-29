import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * PENEGAKAN LAPIS-DB migrasi 0049 (rencana 2026-10-29 U1) — DB-LIVE, seluruhnya
 * di dalam transaksi yang SELALU di-ROLLBACK (nol jejak), di unit FIKTIF
 * 8801/8802 (pola `rls-surfaces.integration.test.ts`: policy `unit_scope` hanya
 * membaca GUC, dan `cash_account`/`cash_ledger`/`pihak_lawan` tak ber-FK ke
 * `public.unit` pada `unit_id`, jadi fixture mustahil menyentuh unit nyata).
 *
 * Yang dibuktikan di sini TIDAK BISA dibuktikan `keuangan-migrasi.test.ts`
 * (yang hanya membaca teks SQL): bahwa Postgres benar-benar MENOLAK baris kas
 * berkategori pihak lawan tanpa pihak lawan, tetap MENERIMA void atas baris
 * lama yang lahir sebelum CHECK `NOT VALID`, dan menolak tautan lintas unit.
 *
 * Gated: PIHAK_LAWAN_LIVE_DB=1 dan PIHAK_LAWAN_DB_URL = koneksi role PEMILIK
 * tabel (`ingest`) di tier TESTING `solamax-pg-rlsstg`. Pemilik dibutuhkan
 * karena uji baris-lama memasang ulang CHECK di dalam transaksi (DDL, ikut
 * di-rollback) — ⛔ jangan arahkan ke DB pilot live: DDL itu memegang kunci
 * ACCESS EXCLUSIVE atas `cash_ledger` sampai rollback.
 * Bila 0049 belum ter-apply, tiap uji SKIP EKSPLISIT (`ctx.skip()`).
 *
 * 0055 (trigger unit baru) ikut diuji di sini: satu-satunya kasus yang menulis
 * `public.unit` — unit fiktif 8803, tetap di dalam transaksi yang di-ROLLBACK;
 * SKIP bila trigger 0055 belum terpasang.
 */
const LIVE = process.env.PIHAK_LAWAN_LIVE_DB === "1" && !!process.env.PIHAK_LAWAN_DB_URL;
const d = LIVE ? describe : describe.skip;

const UA = 8801;
const UB = 8802;
const D = "2026-10-15";

interface Galat {
  code?: string;
  constraint?: string;
}

d("0049 — pihak lawan ditegakkan DB", () => {
  let pool: Pool;
  let applied = false;

  /** Jalankan fn dalam transaksi yang SELALU di-ROLLBACK, scope = kedua unit fiktif. */
  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [`${UA},${UB}`]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  /** Jalankan satu pernyataan yang DIHARAPKAN gagal, tanpa membatalkan transaksi luar. */
  const gagal = async (c: PoolClient, sql: string, params: unknown[]): Promise<Galat> => {
    await c.query("SAVEPOINT s");
    try {
      await c.query(sql, params);
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT s");
      return e as Galat;
    }
    await c.query("RELEASE SAVEPOINT s");
    return {};
  };

  const mkAkun = async (c: PoolClient, unit: number): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.cash_account (unit_id, nama, kind)
         VALUES ($1, 'Bank BCA - 1234567890', 'bank') RETURNING id::text AS id`,
        [unit],
      )
    ).rows[0]!.id;

  const mkPihak = async (c: PoolClient, unit: number, nama = "BPR Uji"): Promise<string> =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO app.pihak_lawan (unit_id, jenis, nama, created_by_user_id)
         VALUES ($1, 'kreditur', $2, 1) RETURNING id::text AS id`,
        [unit, nama],
      )
    ).rows[0]!.id;

  const INSERT_KAS = `INSERT INTO app.cash_ledger
      (unit_id, account_id, business_date, keterangan, jenis,
       category_side, category_label, amount, created_by_user_id, pihak_lawan_id)
    VALUES ($1, $2::uuid, '${D}', 'uji 0049', 'kredit', 'kredit', $3, -1000, 1, $4::uuid)
    RETURNING id::text AS id`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.PIHAK_LAWAN_DB_URL, max: 2 });
    applied =
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='app' AND table_name='cash_ledger' AND column_name='pihak_lawan_id'`,
        )
      ).rowCount === 1;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("seed: tiap unit punya pihak lawan berjenis unit untuk SETIAP unit lain + Outlet Bright", async (ctx) => {
    if (!applied) return ctx.skip();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.unit_ids',
           (SELECT string_agg(unit_id::text, ',') FROM public.unit), true)`,
      );
      const hilang = await c.query(
        `SELECT u.unit_id, v.unit_id AS lawan
           FROM public.unit u JOIN public.unit v ON v.unit_id <> u.unit_id
          WHERE NOT EXISTS (SELECT 1 FROM app.pihak_lawan p
                             WHERE p.unit_id = u.unit_id AND p.jenis = 'unit'
                               AND p.lawan_unit_id = v.unit_id)`,
      );
      expect(hilang.rows).toEqual([]);
      const tanpaBright = await c.query(
        `SELECT u.unit_id FROM public.unit u
          WHERE NOT EXISTS (SELECT 1 FROM app.pihak_lawan p
                             WHERE p.unit_id = u.unit_id AND p.jenis = 'titipan'
                               AND p.nama = 'Outlet Bright')`,
      );
      expect(tanpaBright.rows).toEqual([]);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("0055: unit BARU otomatis berpasangan dua arah + Outlet Bright; scope pemanggil utuh; DELETE melepasnya", async (ctx) => {
    if (!applied) return ctx.skip();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      const ada = await c.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = 'unit_pihak_lawan_otomatis' AND NOT tgisinternal`,
      );
      const tenant = await c.query<{ tenant_id: string }>(
        `SELECT tenant_id::text AS tenant_id FROM public.unit ORDER BY unit_id LIMIT 1`,
      );
      if (ada.rowCount !== 1 || tenant.rowCount !== 1) return ctx.skip();

      // Unit FIKTIF 8803, di dalam transaksi yang di-ROLLBACK. Scope pemanggil
      // sengaja SEMPIT (hanya 8801) untuk membuktikan trigger memasang scopenya
      // sendiri dan memulihkannya.
      const UN = 8803;
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UA)]);
      await c.query(
        `INSERT INTO public.unit (unit_id, code, name, api_key_hash, timezone, active, tenant_id)
         VALUES ($1, 'UJI-0055-8803', 'Unit Uji 0055', 'uji-0055-8803-bukan-kunci', 'Asia/Pontianak', true, $2::uuid)`,
        [UN, tenant.rows[0]!.tenant_id],
      );
      const scope = await c.query<{ s: string }>(`SELECT current_setting('app.unit_ids', true) AS s`);
      expect(scope.rows[0]!.s).toBe(String(UA));

      await c.query(
        `SELECT set_config('app.unit_ids',
           (SELECT string_agg(unit_id::text, ',') FROM public.unit), true)`,
      );
      const keUnitBaru = await c.query(
        `SELECT u.unit_id FROM public.unit u
          WHERE u.unit_id <> $1
            AND NOT EXISTS (SELECT 1 FROM app.pihak_lawan p
                             WHERE p.unit_id = u.unit_id AND p.jenis = 'unit'
                               AND p.lawan_unit_id = $1 AND p.nama = 'Unit Uji 0055')`,
        [UN],
      );
      expect(keUnitBaru.rows).toEqual([]);
      const dariUnitBaru = await c.query(
        `SELECT v.unit_id FROM public.unit v
          WHERE v.unit_id <> $1
            AND NOT EXISTS (SELECT 1 FROM app.pihak_lawan p
                             WHERE p.unit_id = $1 AND p.jenis = 'unit'
                               AND p.lawan_unit_id = v.unit_id AND p.nama = v.name)`,
        [UN],
      );
      expect(dariUnitBaru.rows).toEqual([]);
      const bright = await c.query(
        `SELECT 1 FROM app.pihak_lawan
          WHERE unit_id = $1 AND jenis = 'titipan' AND nama = 'Outlet Bright' AND created_by_user_id IS NULL`,
        [UN],
      );
      expect(bright.rowCount).toBe(1);

      await c.query(`DELETE FROM public.unit WHERE unit_id = $1`, [UN]);
      const sisa = await c.query(
        `SELECT 1 FROM app.pihak_lawan WHERE unit_id = $1 OR lawan_unit_id = $1`,
        [UN],
      );
      expect(sisa.rowCount).toBe(0);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("backfill: rekening bank berpola nama sudah bernomor_rekening = angka di belakang ' - '", async (ctx) => {
    if (!applied) return ctx.skip();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.unit_ids',
           (SELECT string_agg(unit_id::text, ',') FROM public.unit), true)`,
      );
      const salah = await c.query(
        `SELECT id, nama, nomor_rekening FROM app.cash_account
          WHERE kind = 'bank' AND nama ~ '^Bank\\s+.+\\s-\\s*\\d+$'
            AND nomor_rekening IS DISTINCT FROM substring(nama from '\\s-\\s*(\\d+)$')`,
      );
      expect(salah.rows).toEqual([]);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("🔴 baris kas BARU 'Hutang Piutang' tanpa pihak lawan DITOLAK", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const akun = await mkAkun(c, UA);
      const e = await gagal(c, INSERT_KAS, [UA, akun, "Hutang Piutang", null]);
      expect(e.code).toBe("23514");
      expect(e.constraint).toBe("cash_ledger_pihak_lawan_wajib");
    });
  });

  it("🔴 baris kas BARU 'Penyerahan titipan' tanpa pihak lawan DITOLAK", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const akun = await mkAkun(c, UA);
      const e = await gagal(c, INSERT_KAS, [UA, akun, "Penyerahan titipan", null]);
      expect(e.code).toBe("23514");
      expect(e.constraint).toBe("cash_ledger_pihak_lawan_wajib");
    });
  });

  it("kontrol positif: dengan pihak lawan unit yang sama → diterima; kategori lain tanpa pihak lawan → diterima", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const akun = await mkAkun(c, UA);
      const pl = await mkPihak(c, UA);
      expect((await c.query(INSERT_KAS, [UA, akun, "Hutang Piutang", pl])).rowCount).toBe(1);
      expect((await c.query(INSERT_KAS, [UA, akun, "Biaya Operasional", null])).rowCount).toBe(1);
    });
  });

  it("baris LAMA tanpa pihak lawan (lahir sebelum CHECK) tetap terbaca dan BISA di-void — sunting lain ditolak", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const akun = await mkAkun(c, UA);
      // Rekonstruksi keadaan produksi: baris Oktober lahir SEBELUM 0049, lalu
      // CHECK dipasang NOT VALID persis seperti di migrasinya.
      const def = (
        await c.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'cash_ledger_pihak_lawan_wajib'`,
        )
      ).rows[0]!.def;
      expect(def).toMatch(/NOT VALID/);
      await c.query(`ALTER TABLE app.cash_ledger DROP CONSTRAINT cash_ledger_pihak_lawan_wajib`);
      const lama = (await c.query<{ id: string }>(INSERT_KAS, [UA, akun, "Hutang Piutang", null]))
        .rows[0]!.id;
      await c.query(`ALTER TABLE app.cash_ledger ADD CONSTRAINT cash_ledger_pihak_lawan_wajib ${def}`);

      const baca = await c.query(`SELECT 1 FROM app.cash_ledger WHERE id = $1::uuid`, [lama]);
      expect(baca.rowCount).toBe(1);

      const sunting = await gagal(
        c,
        `UPDATE app.cash_ledger SET keterangan = 'diubah' WHERE id = $1::uuid`,
        [lama],
      );
      expect(sunting.code).toBe("23514");

      const v = await c.query(
        `UPDATE app.cash_ledger SET void = true, voided_by_user_id = 1, voided_at = now()
          WHERE id = $1::uuid`,
        [lama],
      );
      expect(v.rowCount).toBe(1);
    });
  });

  it("🔴 FK komposit: baris kas unit A menunjuk pihak lawan unit B → DITOLAK", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const akunA = await mkAkun(c, UA);
      const plB = await mkPihak(c, UB);
      const e = await gagal(c, INSERT_KAS, [UA, akunA, "Hutang Piutang", plB]);
      expect(e.code).toBe("23503");
      expect(e.constraint).toBe("cash_ledger_pihak_lawan_fk");
    });
  });

  it("🔴 FK komposit: setoran titipan & saldo pembuka unit A ke pihak lawan unit B → DITOLAK", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const plB = await mkPihak(c, UB);
      const me = await gagal(
        c,
        `INSERT INTO app.manual_entry
           (unit_id, business_date, section, keterangan, amount, created_by_user_id, pihak_lawan_id)
         VALUES ($1, '${D}', 'setoran_tunai', 'titipan uji', 1000, 1, $2::uuid)`,
        [UA, plB],
      );
      expect(me.code).toBe("23503");
      expect(me.constraint).toBe("manual_entry_pihak_lawan_fk");

      const sa = await gagal(
        c,
        `INSERT INTO app.pihak_lawan_saldo_awal
           (unit_id, pihak_lawan_id, tanggal, amount, created_by_user_id)
         VALUES ($1, $2::uuid, '2026-10-01', 5000, 1)`,
        [UA, plB],
      );
      expect(sa.code).toBe("23503");
    });
  });

  it("saldo pembuka Rp 0 hanya sah bila sementara; satu aktif per pihak lawan", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const pl = await mkPihak(c, UA);
      const ins = `INSERT INTO app.pihak_lawan_saldo_awal
          (unit_id, pihak_lawan_id, tanggal, amount, sementara, created_by_user_id)
        VALUES ($1, $2::uuid, '2026-10-01', $3, $4, 1)`;
      expect((await gagal(c, ins, [UA, pl, 0, false])).code).toBe("23514");
      await c.query(ins, [UA, pl, 0, true]);
      expect((await gagal(c, ins, [UA, pl, -250000, false])).code).toBe("23505");
    });
  });

  it("RLS: pihak lawan unit A tak terlihat dengan app.unit_ids = B", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const pl = await mkPihak(c, UA, "Afiliasi rahasia");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UB)]);
      const r = await c.query(`SELECT 1 FROM app.pihak_lawan WHERE id = $1::uuid`, [pl]);
      expect(r.rowCount).toBe(0);
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UA)]);
      const r2 = await c.query(`SELECT 1 FROM app.pihak_lawan WHERE id = $1::uuid`, [pl]);
      expect(r2.rowCount).toBe(1);
    });
  });
});
