import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { ScopedUnitId } from "./scope-rule";

/**
 * FULL-APP-UNDER-RLS (functional, SELF-SEEDING). Drives the REAL dashboard query
 * functions — yang berjalan lewat qScoped() (migrasi 0016) — sebagai role
 * NON-SUPERUSER `dashboard_app`, dan membuktikan hasil ter-scope per unit lewat
 * jalur kode aplikasi sungguhan (bukan SQL mentah).
 *
 * HERMETIC sejak 2026-07-17: suite MEMBUAT fixture-nya sendiri di unit FIKTIF
 * 8801/8802 lalu menghapusnya di afterAll. Riwayat: versi lama bergantung pada
 * fixture synthetic-seed.sql (rehearsal RLS 2026-07-05) yang TERKIKIS saat
 * instance rlsstg dipakai ulang untuk rehearsal onboarding Bakau 2026-07-07
 * (baris unit-2/99 + tenant Synthetic-B dibersihkan) — suite env-gated sehingga
 * CI tak menangkap erosi. Unit fiktif dipilih karena policy `unit_scope` hanya
 * membaca GUC `app.unit_ids` (unit TIDAK perlu ada di public.unit), sehingga
 * seed mustahil menyentuh unit nyata (1=IB, 2=Bakau, 3=Adisucipto).
 *
 * Gated: RLS_SURFACES_LIVE_DB=1, DATABASE_URL = koneksi dashboard_app (jalur
 * query yang diuji), dan RLS_SURFACES_SEED_URL = koneksi role penulis tabel
 * mirror (ingest) untuk seed/cleanup. Tanpa salah satu → SKIP bersih.
 * ⚠️ `./queries` di-import LAZY di beforeAll (pola suite integrasi lain):
 * import statis menarik db.ts → makePool() yang throw tanpa DATABASE_URL di CI.
 */
const LIVE =
  process.env.RLS_SURFACES_LIVE_DB === "1" &&
  !!process.env.DATABASE_URL &&
  !!process.env.RLS_SURFACES_SEED_URL;
const d = LIVE ? describe : describe.skip;

const U = (n: number) => n as unknown as ScopedUnitId;
const D = "2026-07-01";
const UA = 8801; // "unit 1"-equiv fiktif (2 baris per permukaan, produk PERTAMAX)
const UB = 8802; // "unit 2"-equiv fiktif (1 baris per permukaan, produk PERTALITE)
const CTX = `${UA},${UB}`;
const SYN_EMAIL = "rls-surfaces@syn.test";

d("full-app under RLS (dashboard_app, self-seeded fictitious 2-unit)", () => {
  let Q: typeof import("./queries");
  let seed: Pool;

  /** Hapus semua jejak fixture (idempoten — juga membersihkan sisa run gagal). */
  async function cleanup(): Promise<void> {
    const c = await seed.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [CTX]);
      for (const t of [
        "app.manual_entry",
        "app.usulan_so",
        "public.sales_detail",
        "public.sales_header",
        "public.product",
        "public.real_tank",
        "public.nozzle",
        "public.sync_state",
      ]) {
        await c.query(`DELETE FROM ${t} WHERE unit_id IN ($1, $2)`, [UA, UB]);
      }
      await c.query(`DELETE FROM app.users WHERE email = $1`, [SYN_EMAIL]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    Q = await import("./queries"); // deferred → tanpa makePool() saat module load
    seed = new Pool({ connectionString: process.env.RLS_SURFACES_SEED_URL, max: 2 });
    await cleanup(); // sisa run sebelumnya (bila ada) tak boleh menggeser count

    const c = await seed.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [CTX]);
      // app.users tanpa unique index ter-infer di email → select-then-insert.
      const existing = await c.query<{ id: number }>(
        `SELECT id FROM app.users WHERE email = $1`,
        [SYN_EMAIL],
      );
      const uid =
        existing.rows[0]?.id ??
        (
          await c.query<{ id: number }>(
            `INSERT INTO app.users (name, email) VALUES ('RLS Surfaces (synthetic)', $1) RETURNING id`,
            [SYN_EMAIL],
          )
        ).rows[0]!.id;

      await c.query(
        `INSERT INTO public.product (unit_id, ckdbbm, vcnmbbm) VALUES
           ($1, 'BB-02', 'PERTAMAX'), ($2, 'BB-07', 'PERTALITE')`,
        [UA, UB],
      );
      await c.query(
        `INSERT INTO public.sales_header (unit_id, ckdjualbbm, dtgljual, nshift) VALUES
           ($1, 'JB-UA', '${D}', 1), ($2, 'JB-UB', '${D}', 1)`,
        [UA, UB],
      );
      await c.query(
        `INSERT INTO public.sales_detail
           (unit_id, ckdjualbbm, ckdnozzle, nurut, nvolume, nsubtotal, ckdbbm, dtgljam) VALUES
           ($1, 'JB-UA', 'N01', 1, 100, 1000000, 'BB-02', '${D} 08:00+07'),
           ($1, 'JB-UA', 'N01', 2,  50,  500000, 'BB-02', '${D} 09:00+07'),
           ($2, 'JB-UB', 'N01', 1, 200, 2000000, 'BB-07', '${D} 08:00+07')`,
        [UA, UB],
      );
      await c.query(
        `INSERT INTO public.sync_state (unit_id, domain, last_watermark, last_run_at, last_row_count)
         VALUES ($1, 'sales', now(), now(), 2), ($2, 'sales', now(), now(), 1)`,
        [UA, UB],
      );
      await c.query(
        `INSERT INTO public.real_tank (unit_id, ckdtangki, dtanggaljam) VALUES
           ($1, 'T-01', '${D} 06:00+07'), ($1, 'T-02', '${D} 06:00+07'),
           ($2, 'T-01', '${D} 06:00+07')`,
        [UA, UB],
      );
      await c.query(
        `INSERT INTO public.nozzle (unit_id, ckdnozzle) VALUES
           ($1, 'N01'), ($1, 'N02'), ($2, 'N01')`,
        [UA, UB],
      );
      // UA: DUA tanggal bisnis (getUsulanSoList agregat per tanggal → 2 item); UB: satu.
      await c.query(
        `INSERT INTO app.usulan_so
           (unit_id, business_date, product_key, penerimaan_hari, permintaan_besok,
            usulan_penebusan, status, created_by_user_id) VALUES
           ($1, '${D}', 'pertamax', 10, 20, 10, 'draft', $3),
           ($1, '${D}', 'solar',    10, 20, 10, 'draft', $3),
           ($1, '2026-06-30', 'pertamax', 10, 20, 10, 'draft', $3),
           ($2, '${D}', 'pertamax', 10, 20, 10, 'draft', $3)`,
        [UA, UB, uid],
      );
      await c.query(
        `INSERT INTO app.manual_entry
           (unit_id, business_date, section, keterangan, amount, created_by_user_id) VALUES
           ($1, '${D}', 'pengeluaran', 'syn a', 1000, $3),
           ($1, '${D}', 'pengeluaran', 'syn b', 2000, $3),
           ($2, '${D}', 'pengeluaran', 'syn c', 3000, $3)`,
        [UA, UB, uid],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    try {
      if (seed) await cleanup();
    } finally {
      await seed?.end();
    }
  });

  it("getSalesByProduct scopes by unit (name discrimination, no cross-unit leak)", async () => {
    const ua = await Q.getSalesByProduct(U(UA), D, D);
    const ub = await Q.getSalesByProduct(U(UB), D, D);
    const na = ua.map((r) => r.nama);
    const nb = ub.map((r) => r.nama);
    expect(na).toContain("PERTAMAX"); // produk unit A
    expect(na).not.toContain("PERTALITE"); // produk unit B TIDAK boleh bocor
    expect(nb).toContain("PERTALITE");
    expect(nb).not.toContain("PERTAMAX");
  });

  it("getSyncByUnit: direksi spans [UA,UB]; pengawas sees only its unit", async () => {
    const direksi = await Q.getSyncByUnit([U(UA), U(UB)]);
    expect(direksi.map((r) => r.unit_id).sort()).toEqual([UA, UB]);
    const pengawasA = await Q.getSyncByUnit([U(UA)]);
    expect(pengawasA.map((r) => r.unit_id)).toEqual([UA]);
    const pengawasB = await Q.getSyncByUnit([U(UB)]);
    expect(pengawasB.map((r) => r.unit_id)).toEqual([UB]);
  });

  it("monitoring/denah: getRealTank + getNozzles scoped per unit", async () => {
    expect((await Q.getRealTank(U(UA))).length).toBe(2);
    expect((await Q.getRealTank(U(UB))).length).toBe(1);
    expect((await Q.getNozzles(U(UA))).length).toBe(2);
    expect((await Q.getNozzles(U(UB))).length).toBe(1);
  });

  it("rincian: getManualEntries scoped per unit", async () => {
    expect((await Q.getManualEntries(U(UA), D, "pengeluaran")).length).toBe(2);
    expect((await Q.getManualEntries(U(UB), D, "pengeluaran")).length).toBe(1);
  });

  it("usulan: getUsulanSoList scoped per unit", async () => {
    expect((await Q.getUsulanSoList(U(UA), 100)).length).toBe(2);
    expect((await Q.getUsulanSoList(U(UB), 100)).length).toBe(1);
  });
});
