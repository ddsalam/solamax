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
        "public.opname",
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
      // Kejadian OPNAME-NOL untuk getZeroClosingEvents: op=0 diapit prev>1.000
      // dan next>1.000, TANPA delivery keesokan harinya. Nilai prev DIBEDAKAN
      // per unit (UA 5.000 / UB 7.000) supaya kebocoran terbaca dari angkanya,
      // bukan cuma dari unit_id.
      await c.query(
        `INSERT INTO public.opname
           (unit_id, ckdopnbbm, ckdtangki, ckdbbm, dtaglopn, nstockbk, nstockop, dtgljam, sbatal) VALUES
           ($1,'OP-A1','T-01','BB-02','2026-06-30', 5000, 5000, '2026-06-30 22:00+07', 0),
           ($1,'OP-A2','T-01','BB-02','${D}',       4800,    0, '${D} 22:00+07',       0),
           ($1,'OP-A3','T-01','BB-02','2026-07-02', 4600, 4600, '2026-07-02 22:00+07', 0),
           ($2,'OP-B1','T-01','BB-07','2026-06-30', 7000, 7000, '2026-06-30 22:00+07', 0),
           ($2,'OP-B2','T-01','BB-07','${D}',       6800,    0, '${D} 22:00+07',       0),
           ($2,'OP-B3','T-01','BB-07','2026-07-02', 6600, 6600, '2026-07-02 22:00+07', 0)`,
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

  // ===========================================================================
  // ISOLASI QUERY MULTI-UNIT (2026-08-07) — LUBANG YANG BARU DITEMUKAN.
  //
  // `getAdminDays` (ditambahkan sesi ini, HIDUP DI PRODUKSI) dan
  // `getZeroClosingEvents` keduanya qScoped/multi-unit tapi TIDAK PERNAH diuji
  // isolasi tenant. Keduanya lolos karena guard kelengkapan di
  // queries.scope-wiring.test.ts membandingkan `CASES.length` dengan angka
  // hardcoded — menangkap penghapusan, BUTA terhadap kelalaian.
  //
  // Pada platform enam tenant tempat RLS adalah gerbang keras satu-satunya,
  // "ia memanggil qScoped" BUKAN bukti. Yang dituntut di bawah: ia terbukti
  // TIDAK BOCOR, termasuk saat `unitIds` sengaja diisi unit di luar scope.
  // ===========================================================================

  it("getAdminDays: scope satu unit → NOL baris berdata milik unit lain", async () => {
    const a = await Q.getAdminDays([U(UA)], D, D);
    const b = await Q.getAdminDays([U(UB)], D, D);

    // KONTROL ANTI-HAMPA: kalau kedua sisi kosong, asersi "tak bocor" jadi
    // benar secara vakum. Fixture menaruh omzet di KEDUA unit, jadi ini WAJIB
    // menyalak sebelum asersi kebocoran berarti apa-apa.
    const dataA = a.filter((r) => r.compA > 0);
    const dataB = b.filter((r) => r.compA > 0);
    expect(dataA.length, "fixture unit A tak terbaca — asersi kebocoran jadi hampa").toBeGreaterThan(0);
    expect(dataB.length, "fixture unit B tak terbaca — asersi kebocoran jadi hampa").toBeGreaterThan(0);

    // Isolasi: tak satu pun baris BERDATA milik unit lain.
    expect(dataA.every((r) => r.unit_id === UA)).toBe(true);
    expect(dataB.every((r) => r.unit_id === UB)).toBe(true);
    // Diskriminasi nilai: omzet UA (1.500.000) ≠ UB (2.000.000) → kalau bocor,
    // angkanya sendiri yang membongkar.
    expect(dataA[0]!.compA).toBe(1_500_000);
    expect(dataB[0]!.compA).toBe(2_000_000);
    expect(dataA.some((r) => r.compA === 2_000_000)).toBe(false);
  });

  it("unitIds DILEBARKAN: GUC mengikuti argumen → yang menjaga adalah TIPE, bukan RLS", async () => {
    // ⚠️ KOREKSI PREMIS SAYA SENDIRI (2026-08-07). Versi pertama tes ini
    // menuntut data UB NOL saat `getAdminDays([UA, UB])` dipanggil, dan ia
    // GAGAL — benar-benar gagal, bukan flaky. Sebabnya premis saya salah:
    // `getAdminDays` menyerahkan array yang SAMA ke GUC `app.unit_ids` DAN ke
    // parameter SQL. Array yang dilebarkan karenanya melebarkan RLS juga.
    //
    // Jadi skenario "pemanggil ber-scope UA menyodorkan [UA, UB]" TIDAK BISA
    // dicegah oleh RLS lewat fungsi ini — yang mencegahnya adalah `ScopedUnitId`
    // ber-brand, yang HANYA bisa dicetak `getDataScope()`. Menuliskan tes yang
    // menuntut RLS melakukan pekerjaan tipe akan memberi rasa aman yang palsu.
    //
    // Yang diuji di sini: fungsinya memang mengembalikan PERSIS unit yang
    // diminta — tak lebih. Backstop RLS-nya diuji terpisah di bawah, dengan
    // GUC yang SENGAJA lebih sempit dari parameter.
    const luas = await Q.getAdminDays([U(UA), U(UB)], D, D);
    expect([...new Set(luas.map((r) => r.unit_id))].sort()).toEqual([UA, UB]);
    expect(luas.some((r) => r.unit_id === UA && r.compA === 1_500_000)).toBe(true);
    expect(luas.some((r) => r.unit_id === UB && r.compA === 2_000_000)).toBe(true);
  });

  it("BACKSTOP RLS: GUC lebih SEMPIT dari parameter → data unit luar TETAP nol", async () => {
    // Inilah gerbang keras yang sesungguhnya. Probe SQL langsung (bukan fungsi
    // produksi) supaya GUC dan parameter bisa DIBUAT BERBEDA — sesuatu yang
    // `getAdminDays` sengaja tak izinkan. Tabel yang diprobe = tabel yang
    // dibaca getAdminDays.
    const { qScoped } = await import("./db");
    type Row = { unit_id: number; total: string };
    const rows = await qScoped<Row>(
      [UA], // GUC: HANYA unit A
      `SELECT sd.unit_id, COALESCE(sum(sd.nsubtotal),0)::text AS total
         FROM public.sales_detail sd
        WHERE sd.unit_id = ANY($1::int[])
        GROUP BY sd.unit_id ORDER BY sd.unit_id`,
      [[UA, UB]], // parameter: MEMINTA A dan B
    );
    // KONTROL ANTI-HAMPA: unit A harus terbaca, kalau tidak asersi di bawah hampa.
    expect(rows.some((r) => r.unit_id === UA), "kontrol: UA harus terbaca").toBe(true);
    // Gerbangnya: B diminta parameter, DITOLAK RLS.
    expect(rows.some((r) => r.unit_id === UB), "unit B bocor menembus GUC yang sempit").toBe(false);
  });

  it("getZeroClosingEvents: kejadian NYATA, ter-scope, tanpa kebocoran", async () => {
    // ⚠️ Versi pertama tes ini HAMPA: fixture tak punya kejadian opname-nol,
    // jadi `every()` atas array kosong bernilai true dan hijaunya berarti
    // "tak ada yang diperiksa" — kelas cacat yang SAMA dengan guard
    // `.toBe(34)`. Menyebutnya di badan PR tidak menetralkan efeknya; yang
    // tersisa di repo tetap hijau yang menyesatkan. Fixture kini berisi.
    const W = ["2026-06-30", "2026-07-02"] as const;
    const a = await Q.getZeroClosingEvents([U(UA)], W[0], W[1]);
    const b = await Q.getZeroClosingEvents([U(UB)], W[0], W[1]);

    // KONTROL ANTI-HAMPA: kejadiannya harus benar-benar terdeteksi.
    expect(a.length, "fixture opname-nol UA tak terdeteksi — asersi jadi hampa").toBe(1);
    expect(b.length, "fixture opname-nol UB tak terdeteksi — asersi jadi hampa").toBe(1);

    // Isolasi + diskriminasi NILAI: prev UA 5.000 vs UB 7.000.
    expect(a[0]!.unit_id).toBe(UA);
    expect(a[0]!.prev).toBe(5000);
    expect(b[0]!.unit_id).toBe(UB);
    expect(b[0]!.prev).toBe(7000);
    expect(a.some((r) => r.prev === 7000), "nilai UB bocor ke hasil UA").toBe(false);
    expect(b.some((r) => r.prev === 5000), "nilai UA bocor ke hasil UB").toBe(false);

    // Multi-unit sah: direksi ber-scope keduanya melihat dua-duanya, tak lebih.
    const luas = await Q.getZeroClosingEvents([U(UA), U(UB)], W[0], W[1]);
    expect(luas.map((r) => r.unit_id).sort()).toEqual([UA, UB]);
  });

});
