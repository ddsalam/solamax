import { afterAll, describe, expect, it } from "vitest";
import type { ManualSection } from "./queries";
import type { ScopedUnitId } from "./scope-rule";

/**
 * GERBANG K1 — "SQL ini bisa DIEKSEKUSI" (proposal gerbang G1, 2026-08-07).
 *
 * KENAPA ADA: `count(*)::int FILTER (WHERE …)` adalah sintaks Postgres TIDAK
 * VALID (cast harus membungkus). Ia lolos `pnpm typecheck` (SQL cuma string),
 * lolos 517 unit test (tak satu pun menyentuh DB), dan lolos CI hijau penuh —
 * lalu akan 500 di produksi. Tak ada gerbang yang bisa menangkapnya kecuali
 * yang benar-benar menjalankan SQL-nya terhadap Postgres sungguhan.
 *
 * YANG DIUJI: setiap query bisa di-PARSE & DIEKSEKUSI oleh Postgres dengan
 * skema nyata. Kelas bug yang tertangkap: sintaks, kolom/tabel salah nama,
 * cast tak sah, pelanggaran GRANT/RLS.
 *
 * ⛔ YANG TIDAK DIUJI: apakah JAWABANNYA benar. Asersinya HANYA "tidak melempar";
 *    nol asersi atas isi. Logika salah tetap tugas unit test.
 *
 * ⛔ BUKAN K2. Tes yang menuntut data tertentu ("Bakau 08-06 = +3.362.265")
 *    SENGAJA tidak ada di sini: ia bergantung data hidup yang diedit pengawas,
 *    jadi sebagai gerbang deploy ia akan gagal karena sebab yang benar dan
 *    dimatikan orang dalam sebulan. K2 hidup di `*-live.integration.test.ts`
 *    sebagai KANARI, tidak menggerbangi apa pun.
 *
 * SASARAN: `solamax-pg-rlsstg` (DB tier testing) — BUKAN DB pilot. Karena itu
 * "bagaimana kalau DB pilot sedang sibuk" tak pernah jadi pertanyaan: pilot
 * tidak disentuh. Unit sentinel di bawah tak ada → RLS mengembalikan 0 baris,
 * dan itu memang cukup: yang diuji eksekusinya, bukan isinya.
 */
const LIVE = process.env.SQLCHECK_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

/**
 * ⚠️ Import SENGAJA MALAS (di dalam tes), bukan top-level. `./queries` menarik
 * `./db`, yang MELEMPAR saat `DATABASE_URL` tak ada — dan di CI biasa memang tak
 * ada. Import top-level membuat berkas ini gagal saat COLLECT, sehingga
 * `describe.skip` tak sempat menolong: `pnpm check` jadi MERAH untuk semua
 * orang. Tertangkap `pnpm check` sendiri sebelum di-commit.
 */
type QMod = typeof import("./queries");
const U = 30000 as unknown as ScopedUnitId; // sentinel: TIDAK ADA, && muat di SMALLINT (unit_id smallint)
const D = "2026-07-01";
const SEC: ManualSection = "pengeluaran";

/** [nama, pemanggilan]. Argumen dipilih tak berbahaya; semuanya SELECT. */
const makeCases = (Q: QMod): Array<[string, () => Promise<unknown>]> => [
  ["getSyncByUnit", () => Q.getSyncByUnit([U])],
  ["getSalesByProduct", () => Q.getSalesByProduct(U, D, D)],
  ["getDailySalesByProduct", () => Q.getDailySalesByProduct([U], D, D)],
  ["getUnitCoverage", () => Q.getUnitCoverage([U])],
  ["getDailyOmzet", () => Q.getDailyOmzet(U, D, D)],
  ["getSalesTotals", () => Q.getSalesTotals(U, D, D)],
  ["getShiftInfo", () => Q.getShiftInfo(U, D)],
  ["getCorrections", () => Q.getCorrections(U, D)],
  ["getCorrectedNozzles", () => Q.getCorrectedNozzles(U, D)],
  ["getClosingOpname", () => Q.getClosingOpname(U, D, D)],
  ["getZeroClosingEvents", () => Q.getZeroClosingEvents([U], D, D)],
  ["getDailyGlByProduct", () => Q.getDailyGlByProduct(U, D, D)],
  ["getDeliveryShortfalls", () => Q.getDeliveryShortfalls(U, D, D, 10)],
  ["getDeliveryByProduct", () => Q.getDeliveryByProduct(U, D, D)],
  ["getDoHarian", () => Q.getDoHarian(U, D)],
  ["getDoAnomalies", () => Q.getDoAnomalies(U, D)],
  ["getDoSuspectSO", () => Q.getDoSuspectSO(U, D)],
  ["getTankStocks", () => Q.getTankStocks(U)],
  ["getRealTank", () => Q.getRealTank(U)],
  ["getLastFills", () => Q.getLastFills(U)],
  ["getNozzles", () => Q.getNozzles(U)],
  ["getAvgDailySales", () => Q.getAvgDailySales(U, D, D)],
  ["getComplianceMatrix", () => Q.getComplianceMatrix(U, 7)],
  ["getAdminDays", () => Q.getAdminDays([U], D, D)],
  ["getTankCount", () => Q.getTankCount(U)],
  ["getLastInputs", () => Q.getLastInputs(U)],
  ["getCashForDate", () => Q.getCashForDate(U, D)],
  ["getPelangganForDate", () => Q.getPelangganForDate(U, D)],
  ["getTerraResmiForDate", () => Q.getTerraResmiForDate(U, D)],
  ["getEdcForDate", () => Q.getEdcForDate(U, D)],
  ["getEdcBlankCard", () => Q.getEdcBlankCard(U, D)],
  ["getDepositForDate", () => Q.getDepositForDate(U, D)],
  ["getSaldoPelanggan", () => Q.getSaldoPelanggan(U, D)],
  ["getManualEntries", () => Q.getManualEntries(U, D, SEC)],
  ["getUsulanSo", () => Q.getUsulanSo(U, D)],
  ["getUsulanSoList", () => Q.getUsulanSoList(U, 10)],
];

/** Nama saja — dipakai membangun daftar `it` tanpa menyentuh `./db`. */
const NAMES = makeCases({} as QMod).map(([n]) => n);

d("K1 · setiap query bisa dieksekusi Postgres (gerbang deploy)", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  /**
   * Cakupan DITURUNKAN dari ekspor modul, bukan dibandingkan dengan angka
   * hardcoded. `queries.scope-wiring.test.ts` memakai `expect(CASES.length)
   * .toBe(34)` — itu membandingkan daftar DENGAN DIRINYA SENDIRI: ia menangkap
   * penghapusan tapi BUTA terhadap kelalaian. Terbukti: `getAdminDays` dan
   * `getZeroClosingEvents` (keduanya qScoped/RLS) tak pernah tercakup di sana
   * dan tak ada tes yang menyalak. Guard yang benar membandingkan dengan
   * SUMBER KEBENARAN di luar dirinya.
   */
  it("mencakup SETIAP fungsi query yang diekspor (diturunkan, bukan hardcoded)", async () => {
    const Q = await import("./queries");
    const exported = Object.keys(Q)
      .filter((k) => k.startsWith("get") && typeof (Q as Record<string, unknown>)[k] === "function")
      .sort();
    const covered = [...NAMES].sort();
    expect(exported.filter((n) => !covered.includes(n)), "query tak tercakup K1").toEqual([]);
  });

  for (const name of NAMES) {
    it(`${name} dieksekusi tanpa error Postgres`, async () => {
      const Q = await import("./queries");
      const call = makeCases(Q).find(([n]) => n === name)![1];
      await expect(call(), `${name}: SQL ditolak Postgres`).resolves.toBeDefined();
    }, 30_000);
  }
});
