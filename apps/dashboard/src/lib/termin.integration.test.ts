import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ScopedUnitId } from "./scope";

/**
 * TERMIN PEMBAYARAN di DB nyata (rencana 2026-11-13 U4; R14–R16, KTD6) — inti
 * tulis yang SAMA dengan aksi `termin-actions.ts` dan kueri baca yang SAMA
 * dengan layar, seluruhnya di dalam transaksi yang SELALU di-ROLLBACK (nol
 * jejak), di unit FIKTIF 8801/8802 (pola `pihak-lawan.integration.test.ts`:
 * policy `unit_scope` hanya membaca GUC, dan `termin_unit` / `termin_pelanggan`
 * / `pelanggan_master` tak ber-FK ke `public.unit`, jadi fixture mustahil
 * menyentuh unit nyata).
 *
 * Yang dibuktikan, dan tak bisa dibuktikan uji tiruan:
 *   · tulisan kedua mem-VOID yang pertama dan keduanya tetap terbaca;
 *   · menghapus pengecualian mengembalikan pelanggan ke termin bawaan unit;
 *   · di luar rentang ditolak — oleh inti tulis DAN oleh CHECK 0064;
 *   · pelanggan yang tak ada di master cermin unit itu ditolak;
 *   · tulisan lintas unit ditolak RLS `unit_scope` (WITH CHECK), dan termin
 *     satu unit tak terbaca dari scope unit lain maupun tanpa scope;
 *   · tepat SATU baris `audit_log` per perubahan berefek, NOL untuk nilai sama;
 *   · kueri baca (`termin-queries.ts`) berjalan terhadap skema sebenarnya.
 *
 * Kueri baca diuji lewat `qScoped` TIRUAN yang meneruskan ke klien transaksi
 * uji — supaya membaca baris yang belum (dan tak akan) di-commit. Scope-nya
 * karena itu milik transaksi uji, bukan argumen `unit`; kontrol negatif RLS di
 * bawah mengganti GUC secara eksplisit.
 *
 * Gated: TERMIN_LIVE_DB=1 dan TERMIN_DB_URL = koneksi role PEMILIK tabel
 * (`ingest`) di tier TESTING `solamax-pg-rlsstg` — atau klaster Postgres 16
 * sekali pakai yang sudah diberi seluruh migrasi. Pemilik dibutuhkan karena
 * fixture menulis `public.pelanggan_master` (cermin; `dashboard_app` hanya
 * SELECT). ⛔ Role itu TIDAK BOLEH superuser / BYPASSRLS: uji lintas unit akan
 * hijau palsu — karena itu ia diperiksa dan uji RLS MERAH bila demikian.
 * ⛔ Jangan arahkan ke DB pilot live. Bila 0064 belum ter-apply → skip eksplisit.
 */
const LIVE = process.env.TERMIN_LIVE_DB === "1" && !!process.env.TERMIN_DB_URL;
const d = LIVE ? describe : describe.skip;

const h = vi.hoisted(() => ({ klien: null as PoolClient | null }));
vi.mock("./db", () => ({
  qScoped: async (_unit: unknown, sql: string, params: unknown[] = []) => {
    if (h.klien === null) throw new Error("qScoped tiruan dipanggil di luar transaksi uji");
    return (await h.klien.query(sql, params)).rows;
  },
}));

const { cabutTerminPelanggan, tulisTerminPelanggan, tulisTerminUnit } = await import("./termin-tulis");
const { getPelangganUntukTermin, getPetaTermin, getTerminPelanggan, getTerminUnit, terminUntuk } = await import(
  "./termin-queries"
);

const UA = { unitId: 8801 as ScopedUnitId, code: "UJI-8801" };
const UB = { unitId: 8802 as ScopedUnitId, code: "UJI-8802" };
const AKTOR = { userId: 1, email: "uji-integrasi@solagroup.co" };
const AKTOR2 = { userId: 2, email: "uji-integrasi-2@solagroup.co" };
/** Kode ilustratif: bergaris miring (Lokal) dan bertitik (Online). */
const P1 = "UJI/01";
const P2 = "UJI.02";

interface Galat {
  code?: string;
  constraint?: string;
}

d("0064 — termin pembayaran: void + insert, RLS, audit", () => {
  let pool: Pool;
  let applied = false;
  let melewatiRls = true;

  /** Jalankan fn dalam transaksi yang SELALU di-ROLLBACK; fixture pelanggan master di kedua unit. */
  const tx = async (ids: string, fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    h.klien = c;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [`${UA.unitId},${UB.unitId}`]);
      // CHAR(12): tersimpan berpengisi spasi, persis seperti cermin EasyMax.
      await c.query(
        `INSERT INTO public.pelanggan_master (unit_id, ckdplg, vcnmplg, sjenis, saktif) VALUES
           ($1, $3, 'PT Contoh Ilustrasi', 1, 1),
           ($1, $4, 'Pelanggan Online Contoh', 3, 1),
           ($2, $3, 'PT Contoh Ilustrasi (unit B)', 1, 1)`,
        [UA.unitId, UB.unitId, P1, P2],
      );
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [ids]);
      await fn(c);
    } finally {
      h.klien = null;
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };
  const scope = (c: PoolClient, ids: string) => c.query("SELECT set_config('app.unit_ids', $1, true)", [ids]);
  const KEDUA = `${UA.unitId},${UB.unitId}`;

  /** Jalankan fn yang DIHARAPKAN gagal, tanpa membatalkan transaksi luar. */
  const gagal = async (c: PoolClient, fn: () => Promise<unknown>): Promise<Galat> => {
    await c.query("SAVEPOINT s");
    try {
      await fn();
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT s");
      return e as Galat;
    }
    await c.query("RELEASE SAVEPOINT s");
    return {};
  };

  const barisUnit = async (c: PoolClient, unit: number) =>
    (
      await c.query<{ terminHari: number; void: boolean; oleh: number; voidOleh: number | null }>(
        `SELECT termin_hari AS "terminHari", void, created_by_user_id AS oleh, voided_by_user_id AS "voidOleh"
           FROM app.termin_unit WHERE unit_id = $1 ORDER BY created_at, void DESC`,
        [unit],
      )
    ).rows;
  const barisPelanggan = async (c: PoolClient, unit: number, kode: string) =>
    (
      await c.query<{ terminHari: number; void: boolean }>(
        `SELECT termin_hari AS "terminHari", void
           FROM app.termin_pelanggan WHERE unit_id = $1 AND kode_pelanggan = $2 ORDER BY void DESC, termin_hari`,
        [unit, kode],
      )
    ).rows;
  /**
   * Baris audit termin milik unit fiktif ini — target berawalan kode fiktifnya.
   * Urut (action, target), BUKAN urut waktu: `audit_log.id` UUID acak dan
   * `created_at` sama untuk semua baris dalam satu transaksi.
   */
  const audit = async (c: PoolClient, unitCode: string) =>
    (
      await c.query<{ action: string; target: string; detail: Record<string, unknown> }>(
        `SELECT action, target, detail FROM app.audit_log
          WHERE action LIKE 'termin.%' AND (target = $1 OR target LIKE $1 || '/%')
          ORDER BY action COLLATE "C", target COLLATE "C"`,
        [unitCode],
      )
    ).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TERMIN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(
      `SELECT to_regclass('app.termin_unit') IS NOT NULL AND to_regclass('app.termin_pelanggan') IS NOT NULL AS ada`,
    );
    applied = r.rows[0]?.ada === true;
    const p = await pool.query<{ lewat: boolean }>(
      `SELECT rolsuper OR rolbypassrls AS lewat FROM pg_roles WHERE rolname = current_user`,
    );
    melewatiRls = p.rows[0]?.lewat !== false;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("🔴 termin unit: tulisan kedua mem-VOID yang pertama; keduanya tetap terbaca; satu audit per perubahan", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      expect(await getTerminUnit(UA.unitId)).toBeNull();

      const r1 = await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR });
      expect(r1).toEqual({ ok: true, berubah: true, sebelumnya: null, terminHari: 30 });
      const r2 = await tulisTerminUnit(c, { unit: UA, terminHari: 14, aktor: AKTOR2 });
      expect(r2).toEqual({ ok: true, berubah: true, sebelumnya: 30, terminHari: 14 });

      const baris = await barisUnit(c, UA.unitId);
      expect(baris).toHaveLength(2);
      expect(baris.find((b) => b.void)).toEqual({ terminHari: 30, void: true, oleh: 1, voidOleh: 2 });
      expect(baris.find((b) => !b.void)).toEqual({ terminHari: 14, void: false, oleh: 2, voidOleh: null });

      const aktif = await getTerminUnit(UA.unitId);
      expect(aktif?.terminHari).toBe(14);
      expect(aktif?.diaturAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

      expect((await audit(c, UA.code)).map((a) => [a.action, a.target, a.detail])).toEqual([
        ["termin.unit.ganti", UA.code, { unit: UA.code, terminHari: 14, sebelumnya: { terminHari: 30 } }],
        ["termin.unit.tetapkan", UA.code, { unit: UA.code, terminHari: 30, sebelumnya: null }],
      ]);
    });
  });

  it("🔴 nilai SAMA = no-op: tak ada baris baru, tak ada void, tak ada audit", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR });
      await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 7, aktor: AKTOR });
      const auditSebelum = await audit(c, UA.code);
      expect(auditSebelum).toHaveLength(2);

      expect(await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR2 })).toEqual({
        ok: true,
        berubah: false,
        sebelumnya: 30,
        terminHari: 30,
      });
      expect(await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 7, aktor: AKTOR2 })).toEqual({
        ok: true,
        berubah: false,
        sebelumnya: 7,
        terminHari: 7,
      });

      expect(await barisUnit(c, UA.unitId)).toEqual([{ terminHari: 30, void: false, oleh: 1, voidOleh: null }]);
      expect(await barisPelanggan(c, UA.unitId, P1)).toEqual([{ terminHari: 7, void: false }]);
      expect(await audit(c, UA.code)).toEqual(auditSebelum);
    });
  });

  it("🔴 pengecualian pelanggan: kode master terpangkas, ganti = void + insert, hapus mengembalikan ke bawaan unit", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR });

      // Masukan berpengisi spasi (bentuk CHAR(12)) → tersimpan terpangkas.
      const r1 = await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: `${P1}      `, terminHari: 14, aktor: AKTOR });
      expect(r1).toEqual({ ok: true, berubah: true, sebelumnya: null, terminHari: 14 });
      const r2 = await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P2, terminHari: 0, aktor: AKTOR });
      expect(r2.ok).toBe(true);
      const r3 = await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 45, aktor: AKTOR2 });
      expect(r3).toEqual({ ok: true, berubah: true, sebelumnya: 14, terminHari: 45 });

      expect(await barisPelanggan(c, UA.unitId, P1)).toEqual([
        { terminHari: 14, void: true },
        { terminHari: 45, void: false },
      ]);

      // Sisi baca: pengecualian aktif + nama master; peta cari; daftar S4.
      // Urutan baris bergantung kolasi DB ('.' vs '/'), jadi diurutkan di sini.
      expect(
        (await getTerminPelanggan(UA.unitId)).map((p) => [p.kodePelanggan, p.namaPelanggan, p.terminHari]).sort(),
      ).toEqual([
        [P2, "Pelanggan Online Contoh", 0],
        [P1, "PT Contoh Ilustrasi", 45],
      ]);
      await scope(c, String(UA.unitId));
      const peta = await getPetaTermin(UA.unitId);
      expect(peta.terminUnit).toBe(30);
      expect([...peta.terminPelanggan].sort()).toEqual([
        [P2, 0],
        [P1, 45],
      ]);
      expect(terminUntuk(peta, `${P1}      `)).toEqual({ terminPelanggan: 45, terminUnit: 30 });
      expect(terminUntuk(peta, P2)).toEqual({ terminPelanggan: 0, terminUnit: 30 });
      expect(
        (await getPelangganUntukTermin(UA.unitId)).map((p) => [p.kodePelanggan, p.diMaster, p.terminHari]).sort(),
      ).toEqual([
        [P2, true, 0],
        [P1, true, 45],
      ]);

      // Hapus pengecualian P1 → kembali ke bawaan unit.
      const hapus = await cabutTerminPelanggan(c, { unit: UA, kodePelanggan: P1, aktor: AKTOR });
      expect(hapus).toEqual({ ok: true, berubah: true, sebelumnya: 45, terminHari: null });
      expect((await barisPelanggan(c, UA.unitId, P1)).every((b) => b.void)).toBe(true);
      const sesudah = await getPetaTermin(UA.unitId);
      expect(terminUntuk(sesudah, P1)).toEqual({ terminPelanggan: null, terminUnit: 30 });
      expect((await getPelangganUntukTermin(UA.unitId)).find((p) => p.kodePelanggan === P1)?.terminHari).toBeNull();

      // Hapus kedua kali: tak ada pengecualian aktif → ditolak, tanpa audit baru.
      expect((await cabutTerminPelanggan(c, { unit: UA, kodePelanggan: P1, aktor: AKTOR })).ok).toBe(false);

      expect((await audit(c, UA.code)).map((a) => [a.action, a.target])).toEqual([
        ["termin.pelanggan.ganti", `${UA.code}/${P1}`],
        ["termin.pelanggan.hapus", `${UA.code}/${P1}`],
        ["termin.pelanggan.tetapkan", `${UA.code}/${P2}`],
        ["termin.pelanggan.tetapkan", `${UA.code}/${P1}`],
        ["termin.unit.tetapkan", UA.code],
      ]);
      const hapusAudit = (await audit(c, UA.code)).find((a) => a.action === "termin.pelanggan.hapus")!;
      expect(hapusAudit.detail).toEqual({
        unit: UA.code,
        kodePelanggan: P1,
        terminHari: null,
        sebelumnya: { terminHari: 45 },
      });
    });
  });

  it("🔴 di luar rentang ditolak — oleh inti tulis (tanpa jejak) DAN oleh CHECK 0064", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      for (const n of [-1, 366, 14.5]) {
        expect((await tulisTerminUnit(c, { unit: UA, terminHari: n, aktor: AKTOR })).ok, String(n)).toBe(false);
        expect((await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: n, aktor: AKTOR })).ok).toBe(false);
      }
      expect(await barisUnit(c, UA.unitId)).toEqual([]);
      expect(await audit(c, UA.code)).toEqual([]);

      // Batas sah: 0 dan 365.
      expect((await tulisTerminUnit(c, { unit: UA, terminHari: 0, aktor: AKTOR })).ok).toBe(true);
      expect((await tulisTerminUnit(c, { unit: UA, terminHari: 365, aktor: AKTOR })).ok).toBe(true);

      // Lapis DB — bila inti tulis terlewati.
      const g1 = await gagal(c, () =>
        c.query(`INSERT INTO app.termin_unit (unit_id, termin_hari, created_by_user_id) VALUES ($1, 366, 1)`, [UB.unitId]),
      );
      expect(g1).toMatchObject({ code: "23514", constraint: "termin_unit_rentang" });
      const g2 = await gagal(c, () =>
        c.query(
          `INSERT INTO app.termin_pelanggan (unit_id, kode_pelanggan, termin_hari, created_by_user_id)
           VALUES ($1, $2, -1, 1)`,
          [UB.unitId, P1],
        ),
      );
      expect(g2).toMatchObject({ code: "23514", constraint: "termin_pelanggan_rentang" });
    });
  });

  it("🔴 pelanggan tak dikenal master unit itu ditolak — termasuk kode yang hanya ada di unit LAIN", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      const r = await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: "TAKADA", terminHari: 14, aktor: AKTOR });
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/tak ada di master/) });
      // P2 hanya ada di master unit A — bukan pelanggan unit B.
      const lintas = await tulisTerminPelanggan(c, { unit: UB, kodePelanggan: P2, terminHari: 14, aktor: AKTOR });
      expect(lintas).toEqual({ ok: false, error: expect.stringMatching(/tak ada di master/) });
      expect(await barisPelanggan(c, UA.unitId, "TAKADA")).toEqual([]);
      expect(await barisPelanggan(c, UB.unitId, P2)).toEqual([]);
      expect([...(await audit(c, UA.code)), ...(await audit(c, UB.code))]).toEqual([]);
    });
  });

  it("🔴 lapis DB: satu baris aktif (indeks unik parsial), kode terpangkas (CHECK), jejak void (CHECK)", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR });
      await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 14, aktor: AKTOR });
      const g1 = await gagal(c, () =>
        c.query(`INSERT INTO app.termin_unit (unit_id, termin_hari, created_by_user_id) VALUES ($1, 7, 1)`, [UA.unitId]),
      );
      expect(g1).toMatchObject({ code: "23505", constraint: "termin_unit_aktif_uq" });
      const g2 = await gagal(c, () =>
        c.query(
          `INSERT INTO app.termin_pelanggan (unit_id, kode_pelanggan, termin_hari, created_by_user_id)
           VALUES ($1, $2, 7, 1)`,
          [UA.unitId, P1],
        ),
      );
      expect(g2).toMatchObject({ code: "23505", constraint: "termin_pelanggan_aktif_uq" });
      const g3 = await gagal(c, () =>
        c.query(
          `INSERT INTO app.termin_pelanggan (unit_id, kode_pelanggan, termin_hari, created_by_user_id)
           VALUES ($1, 'UJI/09  ', 7, 1)`,
          [UA.unitId],
        ),
      );
      expect(g3).toMatchObject({ code: "23514", constraint: "termin_pelanggan_kode_terpangkas" });
      const g4 = await gagal(c, () =>
        c.query(`UPDATE app.termin_unit SET void = true WHERE unit_id = $1 AND NOT void`, [UA.unitId]),
      );
      expect(g4).toMatchObject({ code: "23514", constraint: "termin_unit_void_audit" });
    });
  });

  it("🔴 RLS: tulisan lintas unit DITOLAK; termin unit A tak terbaca dari scope unit B maupun tanpa scope", async (ctx) => {
    if (!applied) return ctx.skip();
    // Role yang melewati RLS membuat seluruh uji ini hijau palsu — merahkan, jangan lewati.
    expect(melewatiRls, "TERMIN_DB_URL memakai role superuser/BYPASSRLS — pakai role pemilik biasa").toBe(false);

    await tx(String(UA.unitId), async (c) => {
      expect((await tulisTerminUnit(c, { unit: UA, terminHari: 30, aktor: AKTOR })).ok).toBe(true);
      expect((await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 14, aktor: AKTOR })).ok).toBe(true);

      // Scope transaksi = unit A saja; menulis termin unit B ditolak WITH CHECK.
      const g1 = await gagal(c, () => tulisTerminUnit(c, { unit: UB, terminHari: 30, aktor: AKTOR }));
      expect(g1.code).toBe("42501");
      // Master unit B tak terlihat dari scope A → pelanggannya "tak ada", tak ada yang ditulis.
      const r = await tulisTerminPelanggan(c, { unit: UB, kodePelanggan: P1, terminHari: 14, aktor: AKTOR });
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/tak ada di master/) });
      const g2 = await gagal(c, () =>
        c.query(
          `INSERT INTO app.termin_pelanggan (unit_id, kode_pelanggan, termin_hari, created_by_user_id)
           VALUES ($1, $2, 14, 1)`,
          [UB.unitId, P1],
        ),
      );
      expect(g2.code).toBe("42501");

      // Kontrol positif lalu negatif atas baris yang SAMA.
      expect((await getTerminUnit(UA.unitId))?.terminHari).toBe(30);
      expect(await getTerminPelanggan(UA.unitId)).toHaveLength(1);

      await scope(c, String(UB.unitId));
      expect(await getTerminUnit(UA.unitId)).toBeNull();
      expect(await getTerminPelanggan(UA.unitId)).toEqual([]);
      expect(await getPetaTermin(UA.unitId)).toEqual({ terminUnit: null, terminPelanggan: new Map() });
      // UPDATE dari scope B tak mengenai baris A (USING) — void lintas unit mustahil.
      const upd = await c.query(
        `UPDATE app.termin_unit SET void = true, voided_by_user_id = 1, voided_at = now() WHERE unit_id = $1`,
        [UA.unitId],
      );
      expect(upd.rowCount).toBe(0);

      await scope(c, "");
      expect(await getTerminUnit(UA.unitId)).toBeNull();
      expect(await getPelangganUntukTermin(UA.unitId)).toEqual([]);

      await scope(c, KEDUA);
      expect(await barisUnit(c, UB.unitId)).toEqual([]);
      expect(await barisPelanggan(c, UB.unitId, P1)).toEqual([]);
      expect((await getTerminUnit(UA.unitId))?.terminHari).toBe(30);
      expect(await audit(c, UB.code)).toEqual([]);
    });
  });

  it("pengecualian yatim (pelanggan lenyap dari master) tetap terbaca dan tetap bisa dihapus", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(KEDUA, async (c) => {
      await tulisTerminPelanggan(c, { unit: UA, kodePelanggan: P1, terminHari: 14, aktor: AKTOR });
      await c.query(`DELETE FROM public.pelanggan_master WHERE unit_id = $1 AND btrim(ckdplg) = $2`, [UA.unitId, P1]);
      await scope(c, String(UA.unitId));
      expect(await getTerminPelanggan(UA.unitId)).toMatchObject([{ kodePelanggan: P1, namaPelanggan: null, terminHari: 14 }]);
      expect((await getPelangganUntukTermin(UA.unitId)).find((p) => p.kodePelanggan === P1)).toMatchObject({
        diMaster: false,
        terminHari: 14,
      });
      expect((await cabutTerminPelanggan(c, { unit: UA, kodePelanggan: P1, aktor: AKTOR })).ok).toBe(true);
      expect(await getTerminPelanggan(UA.unitId)).toEqual([]);
    });
  });
});
