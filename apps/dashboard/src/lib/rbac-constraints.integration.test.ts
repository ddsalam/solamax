import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { UNIT_DISPLAY } from "./config";
import { ACTIVE_MEMBERSHIPS_SQL, toAssignments, type MembershipRow } from "./membership-query";
import { unitVisible } from "./scope-rule";

/**
 * PENEGAKAN LAPIS-DB migrasi 0019 — DB-LIVE, atas tabel NYATA, semuanya di dalam
 * transaksi yang di-ROLLBACK (nol jejak).
 *
 * Yang dibuktikan di sini TIDAK BISA dibuktikan tes murni: bahwa penugasan
 * lintas-tenant MUSTAHIL TERSIMPAN, bukan sekadar tak terbaca. `tenant_id` di
 * app.user_unit hanya satu kolom, jadi hanya ada tiga isi yang mungkin dan
 * ketiganya tertutup oleh FK komposit ke dua sisi (T-DB1/T-DB2 + kontrol positif).
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL. Bila 0019 BELUM ter-apply di
 * instance itu, tiap test melapor SKIP EKSPLISIT (`ctx.skip()`) — BUKAN `return`
 * senyap, yang oleh vitest dilaporkan sebagai ✓ PASS nol-asersi dan membuat
 * "migrasi belum ada" tak terbedakan dari "constraint terverifikasi".
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

interface UnitRow {
  unit_id: number;
  code: string;
  name: string;
  tenant_id: string;
}

d("0019 — keselarasan unit↔tenant & invarian role ditegakkan DB", () => {
  let pool: Pool;
  let applied = false;
  let units: UnitRow[] = [];
  /** dua tenant BERBEDA yang sama-sama punya unit (syarat uji lintas-tenant) */
  let ptA: string | undefined;
  let ptB: string | undefined;
  let unitA: UnitRow | undefined;
  let unitB: UnitRow | undefined;

  /** Jalankan fn dalam transaksi yang SELALU di-ROLLBACK. */
  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  /** Buat pengguna baru di dalam transaksi (di-rollback) → bebas tabrakan unique. */
  const mkUser = async (c: PoolClient, email: string): Promise<number> =>
    (await c.query(`INSERT INTO app.users (email, name) VALUES ($1, $1) RETURNING id`, [email]))
      .rows[0].id;

  const mkMembership = async (
    c: PoolClient,
    userId: number,
    tenantId: string | null,
    role: string,
    allUnits = false,
  ): Promise<string> => {
    await c.query(
      `INSERT INTO app.user_role (user_id, role) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, role],
    );
    return (
      await c.query(
        `INSERT INTO app.membership (user_id, tenant_id, role, status, all_units)
         VALUES ($1,$2,$3,'active',$4) RETURNING id`,
        [userId, tenantId, role, allUnits],
      )
    ).rows[0].id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    applied =
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='app' AND table_name='membership' AND column_name='all_units'`,
        )
      ).rowCount === 1;
    units = (
      await pool.query(
        `SELECT unit_id, code, name, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
      )
    ).rows;
    const byTenant = new Map<string, UnitRow>();
    for (const u of units) if (u.tenant_id && !byTenant.has(u.tenant_id)) byTenant.set(u.tenant_id, u);
    const pairs = [...byTenant.entries()];
    [ptA, unitA] = pairs[0] ?? [undefined, undefined];
    [ptB, unitB] = pairs[1] ?? [undefined, undefined];
  });

  afterAll(async () => {
    await pool?.end();
  });

  const ready = () => applied && !!ptA && !!ptB && !!unitA && !!unitB;

  it("prasyarat: 0019 ter-apply & ada DUA tenant ber-unit", (ctx) => {
    if (!applied) return ctx.skip(); // migrasi belum ada → SKIP eksplisit
    if (!ptB) return ctx.skip(); // instance satu-tenant → SKIP eksplisit
    expect(ptA).not.toBe(ptB);
    expect(unitA!.tenant_id).toBe(ptA);
    expect(unitB!.tenant_id).toBe(ptB);
  });

  it("T-DB1: user_unit lintas-tenant dgn tenant UNIT (jujur) → DITOLAK FK membership", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db1@rehearsal.invalid");
      const m = await mkMembership(c, u, ptA!, "pengawas");
      await expect(
        c.query(`INSERT INTO app.user_unit (membership_id, unit_id, tenant_id) VALUES ($1,$2,$3)`, [
          m,
          unitB!.unit_id,
          ptB, // tenant milik UNIT
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it("T-DB2: user_unit lintas-tenant dgn tenant MEMBERSHIP (dipalsukan) → DITOLAK FK unit", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db2@rehearsal.invalid");
      const m = await mkMembership(c, u, ptA!, "pengawas");
      await expect(
        c.query(`INSERT INTO app.user_unit (membership_id, unit_id, tenant_id) VALUES ($1,$2,$3)`, [
          m,
          unitB!.unit_id,
          ptA, // tenant milik MEMBERSHIP
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it("kontrol POSITIF: unit SE-TENANT diterima (tes di atas bukan sekadar selalu-gagal)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-pos@rehearsal.invalid");
      const m = await mkMembership(c, u, ptA!, "pengawas");
      await c.query(`INSERT INTO app.user_unit (membership_id, unit_id, tenant_id) VALUES ($1,$2,$3)`, [
        m,
        unitA!.unit_id,
        ptA,
      ]);
      const n = await c.query(`SELECT count(*)::int AS n FROM app.user_unit WHERE membership_id=$1`, [m]);
      expect(n.rows[0].n).toBe(1);
    });
  });

  it("trigger: tenant_id DIABAIKAN penulis → diisi dari membership (mekanisme default)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-trig@rehearsal.invalid");
      const m = await mkMembership(c, u, ptA!, "pengawas");
      await c.query(`INSERT INTO app.user_unit (membership_id, unit_id) VALUES ($1,$2)`, [
        m,
        unitA!.unit_id,
      ]);
      const r = await c.query(`SELECT tenant_id FROM app.user_unit WHERE membership_id=$1`, [m]);
      expect(r.rows[0].tenant_id).toBe(ptA);
    });
  });

  it("trigger TIDAK menyelamatkan penugasan lintas-tenant (FK tetap penegaknya)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-trig2@rehearsal.invalid");
      const m = await mkMembership(c, u, ptA!, "pengawas");
      await expect(
        c.query(`INSERT INTO app.user_unit (membership_id, unit_id) VALUES ($1,$2)`, [
          m,
          unitB!.unit_id,
        ]),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it("T-DB3: membership kedua ber-role BEDA → DITOLAK (invarian satu role per orang)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db3@rehearsal.invalid");
      await mkMembership(c, u, ptA!, "direksi", true);
      await expect(
        c.query(
          `INSERT INTO app.membership (user_id, tenant_id, role, status) VALUES ($1,$2,'pengawas','active')`,
          [u, ptB],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it("T-DB4: membership kedua ber-role SAMA di tenant lain → DITERIMA (multi-tenant)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db4@rehearsal.invalid");
      await mkMembership(c, u, ptA!, "direksi", true);
      await mkMembership(c, u, ptB!, "direksi", true);
      const n = await c.query(`SELECT count(*)::int AS n FROM app.membership WHERE user_id=$1`, [u]);
      expect(n.rows[0].n).toBe(2);
    });
  });

  it("T-DB5: membership global (tenant NULL) ganda → DITOLAK (NULLS NOT DISTINCT)", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db5@rehearsal.invalid");
      await mkMembership(c, u, null, "super_admin");
      await expect(
        c.query(
          `INSERT INTO app.membership (user_id, tenant_id, role, status) VALUES ($1,NULL,'super_admin','active')`,
          [u],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("T-DB6: user_unit pada membership global (tenant NULL) → DITOLAK", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-db6@rehearsal.invalid");
      const m = await mkMembership(c, u, null, "super_admin");
      await expect(
        c.query(`INSERT INTO app.user_unit (membership_id, unit_id, tenant_id) VALUES ($1,$2,$3)`, [
          m,
          unitA!.unit_id,
          ptA,
        ]),
      ).rejects.toThrow(/foreign key|violates|null/i);
    });
  });

  it("ubah role = SATU update di user_role, merambat ke semua membership", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-cascade@rehearsal.invalid");
      await mkMembership(c, u, ptA!, "pengawas");
      await mkMembership(c, u, ptB!, "pengawas");
      await c.query(`UPDATE app.user_role SET role='direksi' WHERE user_id=$1`, [u]);
      const r = await c.query(
        `SELECT count(*)::int AS n FROM app.membership WHERE user_id=$1 AND role='direksi'`,
        [u],
      );
      expect(r.rows[0].n).toBe(2);
    });
  });

  it("public.unit: tenant WAJIB, dan unit yatim tak bisa dibuat", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      await expect(
        c.query(
          `INSERT INTO public.unit (unit_id, code, name, api_key_hash, tenant_id)
           VALUES (99,'9999999','uji',repeat('0',64),NULL)`,
        ),
      ).rejects.toThrow(/null value|not-null/i);
    });
  });

  it("T-REV: cabut penugasan → hilang pada PEMBACAAN BERIKUTNYA, tanpa logout", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-rev@rehearsal.invalid");
      const mA = await mkMembership(c, u, ptA!, "direksi", true);
      await mkMembership(c, u, ptB!, "direksi", true);

      const read = async () =>
        toAssignments((await c.query(ACTIVE_MEMBERSHIPS_SQL, [u])).rows as MembershipRow[]);

      const sebelum = await read();
      expect(sebelum.map((a) => a.tenantId).sort()).toEqual([ptA!, ptB!].sort());
      expect(unitVisible({ role: "direksi", assignments: sebelum }, unitA!)).toBe(true);

      // Pencabutan: baca ULANG dgn query PRODUKSI yang sama — tanpa menyentuh sesi.
      await c.query(`DELETE FROM app.membership WHERE id=$1`, [mA]);
      const sesudah = await read();
      expect(sesudah.map((a) => a.tenantId)).toEqual([ptB!]);
      expect(unitVisible({ role: "direksi", assignments: sesudah }, unitA!)).toBe(false);
      expect(unitVisible({ role: "direksi", assignments: sesudah }, unitB!)).toBe(true);
    });
  });

  it("T-REV(suspend): status disabled → penugasan hilang dari pembacaan berikutnya", async (ctx) => {
    if (!ready()) return ctx.skip();
    await tx(async (c) => {
      const u = await mkUser(c, "t-rev2@rehearsal.invalid");
      const mA = await mkMembership(c, u, ptA!, "direksi", true);
      await c.query(`UPDATE app.membership SET status='disabled' WHERE id=$1`, [mA]);
      const rows = (await c.query(ACTIVE_MEMBERSHIPS_SQL, [u])).rows as MembershipRow[];
      expect(toAssignments(rows)).toEqual([]);
    });
  });
});

d("T-CFG — unit.tenant_id (otorisasi) SEPAKAT dengan UNIT_DISPLAY[].pt (kop laporan)", () => {
  let pool: Pool;
  let rows: { code: string; pt_db: string }[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    rows = (
      await pool.query(
        `SELECT u.code, t.name AS pt_db
           FROM public.unit u JOIN app.tenant t ON t.id = u.tenant_id
          WHERE u.active ORDER BY u.unit_id`,
      )
    ).rows;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("setiap unit di DB punya entri config", (ctx) => {
    if (rows.length === 0) return ctx.skip();
    for (const r of rows) expect(Object.keys(UNIT_DISPLAY)).toContain(r.code);
  });

  it("nama PT di DB == UNIT_DISPLAY[code].pt untuk SETIAP unit", (ctx) => {
    if (rows.length === 0) return ctx.skip();
    // Dua sumber kebenaran unit→PT (otorisasi vs kop ekspor) yang sebelumnya tak
    // pernah dituntut sepakat. Slug yang nyaris sama (…-petra-abadi vs …-petra-energi)
    // membuat drift di sini berbentuk kop laporan ber-PT SALAH — tanpa error apa pun.
    const beda = rows
      .filter((r) => UNIT_DISPLAY[r.code]?.pt !== r.pt_db)
      .map((r) => `${r.code}: DB="${r.pt_db}" config="${UNIT_DISPLAY[r.code]?.pt}"`);
    expect(beda).toEqual([]);
  });
});
