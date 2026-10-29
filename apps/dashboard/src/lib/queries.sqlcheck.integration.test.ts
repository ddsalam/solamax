import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COCOK_BANK_SCHEMA_READY_SQL,
  IMPOR_BANK_SCHEMA_READY_SQL,
  PENEBUSAN_SCHEMA_READY_SQL,
  PIHAK_LAWAN_SCHEMA_READY_SQL,
  SNAPSHOT_V2_SCHEMA_READY_SQL,
  waitForSnapshotV2Schema,
} from "./wait-snapshot-schema";
import type { ManualSection } from "./queries";
import type { SaldoSnapshotPointer } from "./saldo-snapshot";
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
const SNAPSHOT_POINTER: SaldoSnapshotPointer = {
  generationId: "00000000-0000-0000-0000-000000000001",
  rowCount: 0,
  formulaVersion: "saldo-pelanggan-v2",
  computedAt: "2026-07-01T00:01:00Z",
  sourceCycleId: "00000000-0000-0000-0000-000000000002",
  sourceCompletedAt: "2026-07-01T00:00:00Z",
  pendingReplacement: false,
  staleInvalidFrom: null,
  awalPiutangLokalDebet: 0,
  awalPiutangLokalKredit: 0,
  akhirPiutangLokalDebet: 0,
  akhirPiutangLokalKredit: 0,
  awalPiutangOnlineDebet: 0,
  awalPiutangOnlineKredit: 0,
  akhirPiutangOnlineDebet: 0,
  akhirPiutangOnlineKredit: 0,
  awalHutangLokalDebet: 0,
  awalHutangLokalKredit: 0,
  akhirHutangLokalDebet: 0,
  akhirHutangLokalKredit: 0,
  awalPiutangLokal: 0,
  akhirPiutangLokal: 0,
  awalPiutangOnline: 0,
  akhirPiutangOnline: 0,
  awalHutangLokal: 0,
  akhirHutangLokal: 0,
};

// Both deployment workflows start on the same push. Wait before any K1 query
// can reference v2 columns; migrations remain exclusively in the backend CI path.
beforeAll(async () => {
  if (!LIVE) return;
  const { qScoped } = await import("./db");
  await waitForSnapshotV2Schema(async () => {
    const result = await qScoped<{ ready: boolean }>(U, SNAPSHOT_V2_SCHEMA_READY_SQL, []);
    return result[0]?.ready === true;
  });
  // U6 — kueri keuangan di bawah membaca kolom/tabel 0049.
  await waitForSnapshotV2Schema(
    async () => {
      const result = await qScoped<{ ready: boolean }>(U, PIHAK_LAWAN_SCHEMA_READY_SQL, []);
      return result[0]?.ready === true;
    },
    { notReady: "pihak_lawan_schema_not_ready: backend migration 0049" },
  );
  // U7 — kueri penebusan membaca tabel 0050.
  await waitForSnapshotV2Schema(
    async () => {
      const result = await qScoped<{ ready: boolean }>(U, PENEBUSAN_SCHEMA_READY_SQL, []);
      return result[0]?.ready === true;
    },
    { notReady: "penebusan_schema_not_ready: backend migration 0050" },
  );
  // U9 — kueri impor rekening koran membaca tabel 0051.
  await waitForSnapshotV2Schema(
    async () => {
      const result = await qScoped<{ ready: boolean }>(U, IMPOR_BANK_SCHEMA_READY_SQL, []);
      return result[0]?.ready === true;
    },
    { notReady: "impor_bank_schema_not_ready: backend migration 0051" },
  );
  // U10 — kueri cocok (dan hitungan "terbuka" matriks impor) membaca 0052.
  await waitForSnapshotV2Schema(
    async () => {
      const result = await qScoped<{ ready: boolean }>(U, COCOK_BANK_SCHEMA_READY_SQL, []);
      return result[0]?.ready === true;
    },
    { notReady: "cocok_bank_schema_not_ready: backend migration 0052" },
  );
}, 21 * 60 * 1000);

/** [nama, pemanggilan]. Argumen dipilih tak berbahaya; semuanya SELECT. */
const makeCases = (Q: QMod): Array<[string, () => Promise<unknown>]> => [
  ["getSyncByUnit", () => Q.getSyncByUnit([U])],
  ["getGlSourceRevision", () => Q.getGlSourceRevision(U)],
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
  ["getHargaDeviasi", () => Q.getHargaDeviasi([U], D, D)],
  ["getTankCount", () => Q.getTankCount(U)],
  ["getLastInputs", () => Q.getLastInputs(U)],
  ["getCashForDate", () => Q.getCashForDate(U, D)],
  ["getPelangganForDate", () => Q.getPelangganForDate(U, D)],
  ["getTerraResmiForDate", () => Q.getTerraResmiForDate(U, D)],
  ["getEdcForDate", () => Q.getEdcForDate(U, D)],
  ["getEdcBlankCard", () => Q.getEdcBlankCard(U, D)],
  ["getDepositForDate", () => Q.getDepositForDate(U, D)],
  ["getSaldoSnapshot", () => Q.getSaldoSnapshot(U, D)],
  ["getSaldoPelanggan", () => Q.getSaldoPelanggan(U, D)],
  ["getManualEntries", () => Q.getManualEntries(U, D, SEC)],
  ["getUsulanSo", () => Q.getUsulanSo(U, D)],
  ["getUsulanSoList", () => Q.getUsulanSoList(U, 10)],
];

/**
 * U6 (rencana 2026-10-29) — kueri keuangan yang lahir/berubah untuk buku pihak
 * lawan: baris kas bertanggal asal, titipan per pemilik per tanggal, bahan
 * kesamaan saldo antar unit, sinyal Pemantauan, dan perakitan laporan utuh.
 * Bukan modul `./queries`, jadi didaftar tangan — daftarnya kecil dan tiap
 * butir menunjuk satu SQL baru. Asersinya tetap HANYA "tidak melempar".
 */
const KASUS_U6: Array<[string, () => Promise<unknown>]> = [
  ["getMutasiKas", async () => (await import("./keuangan-input-queries")).getMutasiKas(U, D)],
  ["getPihakLawan", async () => (await import("./pihak-lawan-queries")).getPihakLawan(U)],
  ["getTitipanDiterima", async () => (await import("./keuangan-laporan-queries")).getTitipanDiterima(U, D, D)],
  ["getBahanBukuPembantu", async () => (await import("./keuangan-laporan-queries")).getBahanBukuPembantu(U, D)],
  ["getBahanLaporan", async () => (await import("./keuangan-laporan-queries")).getBahanLaporan(U, D, "2026-06-30")],
  ["getBahanParitas", async () => (await import("./antar-unit-queries")).getBahanParitas([U])],
  ["getBahanPantau", async () => (await import("./keuangan-pantau-queries")).getBahanPantau([U], D)],
  // U7 — penebusan per SO (0050) + tautan cermin EasyMax.
  ["getPenebusanBulan", async () => (await import("./penebusan-queries")).getPenebusanBulan([U], "2026-07")],
  ["getSoBelumTertaut", async () => (await import("./penebusan-queries")).getSoBelumTertaut(U)],
  ["getRekeningBank", async () => (await import("./penebusan-queries")).getRekeningBank(U)],
  // U9 — impor rekening koran (0051) + saldo buku menurut tanggal asal (R18).
  ["getRekeningBca", async () => (await import("./impor-bank-queries")).getRekeningBca(U)],
  ["getRekeningKoranUnit", async () => (await import("./impor-bank-queries")).getRekeningKoranUnit(U)],
  [
    "getSaldoBukuAwal",
    async () =>
      (await import("./impor-bank-queries")).getSaldoBukuAwal(U, "00000000-0000-4000-8000-000000000000", "2026-07-01"),
  ],
  // U10 — kelompok cocok (0052): usulan per baris (seluruh SQL mesin cocok) + "Lunas di bank".
  [
    "getUsulanRekeningKoran",
    async () => (await import("./cocok-bank-queries")).getUsulanRekeningKoran(U, "00000000-0000-4000-8000-000000000000"),
  ],
  [
    // Potret buku dengan SATU baris impor rekaan — menjalankan SQL kandidat kas,
    // penebusan ber-SO, dan kas penebusan (yang dilewati bila baris impor kosong).
    "bacaKonteksCocok",
    async () => {
      const m = await import("./cocok-bank-queries");
      return m.bacaKonteksCocok(m.kueriScoped(U), U, [
        {
          id: "00000000-0000-4000-8000-000000000000",
          accountId: "00000000-0000-4000-8000-000000000000",
          tanggalBank: D,
          keterangan: "uji K1",
          amountSen: -100,
          so: "SO-K1",
          dokRef: null,
          praCutover: false,
          rkStatus: "aktif",
          rekeningKoranId: "00000000-0000-4000-8000-000000000000",
          dicocokkan: false,
        },
      ]);
    },
  ],
  [
    "bacaKasId (FOR UPDATE)",
    async () => {
      const m = await import("./cocok-bank-queries");
      return m.bacaKasId(m.kueriScoped(U), U, ["00000000-0000-4000-8000-000000000000"], true);
    },
  ],
  [
    "ANGGOTA_COCOK_AKTIF_SQL",
    async () => (await import("./db")).qScoped(U, (await import("./keuangan-integritas")).ANGGOTA_COCOK_AKTIF_SQL, []),
  ],
  [
    "getKasDicocokkan",
    async () => (await import("./cocok-bank-queries")).getKasDicocokkan(U, ["00000000-0000-4000-8000-000000000000"]),
  ],
  // U11 — layar klasifikasi (0051/0052): rekening × bulan, baris impor + parkir, buku tanpa pasangan.
  ["getRekeningBulan", async () => (await import("./klasifikasi-queries")).getRekeningBulan(U, "2026-07")],
  [
    "getBarisImporBulan",
    async () =>
      (await import("./klasifikasi-queries")).getBarisImporBulan(U, [
        { accountId: "00000000-0000-4000-8000-000000000000", nama: "uji K1", rekeningKoranId: "00000000-0000-4000-8000-000000000000" },
      ]),
  ],
  [
    "getBukuTanpaPasangan",
    async () => (await import("./klasifikasi-queries")).getBukuTanpaPasangan(U, ["00000000-0000-4000-8000-000000000000"], "2026-07"),
  ],
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

  it("getSaldoSnapshotGeneration mengeksekusi SQL baris generation", async () => {
    // Pointer sentinel membuat reader publik berhenti lebih awal; panggil tahap
    // generation secara langsung agar PostgreSQL benar-benar memparse query CTE ini.
    const { getSaldoSnapshotGeneration } = await import("./saldo-snapshot");
    await expect(
      getSaldoSnapshotGeneration(U, D, SNAPSHOT_POINTER),
      "getSaldoSnapshotGeneration: SQL baris snapshot ditolak Postgres",
    ).resolves.toMatchObject({ status: "not_ready" });
  }, 30_000);

  for (const name of NAMES) {
    it(`${name} dieksekusi tanpa error Postgres`, async () => {
      const Q = await import("./queries");
      const call = makeCases(Q).find(([n]) => n === name)![1];
      await expect(call(), `${name}: SQL ditolak Postgres`).resolves.toBeDefined();
    }, 30_000);
  }

  // U6 — kueri keuangan buku pihak lawan (lihat KASUS_U6).
  for (const [name, call] of KASUS_U6) {
    it(`${name} dieksekusi tanpa error Postgres`, async () => {
      await expect(call(), `${name}: SQL ditolak Postgres`).resolves.toBeDefined();
    }, 30_000);
  }
});
