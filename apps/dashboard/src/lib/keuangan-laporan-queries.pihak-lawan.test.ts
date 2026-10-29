import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { MutasiKasRow } from "./keuangan-input-queries";

/**
 * U6 (rencana 2026-10-29; R8, R24, R32; KTD2, KTD8, KTD15) — langkah harian
 * neraca lewat JALUR NYATA `getBahanLaporan` → `langkahHarianRinci`, dengan
 * I/O ditiru. Uji ini sengaja tidak memasok angka neraca dengan tangan:
 * cacat yang ditutupnya (tanda term "Hutang Piutang" terbalik) hidup di
 * PERAKITAN bahan, bukan di rumus panel.
 *
 * Bentuk hari yang ditiru: tanpa penjualan & tanpa saldo pelanggan, sehingga
 * laba = 0 dan langkah = −(Δ asset). Setiap skenario yang dicatat dengan benar
 * wajib berlangkah 0.
 */

const { qScoped, getAkunKas, getMutasiKas, getPihakLawan } = vi.hoisted(() => ({
  qScoped: vi.fn(),
  getAkunKas: vi.fn(),
  getMutasiKas: vi.fn(),
  getPihakLawan: vi.fn(),
}));

vi.mock("./db", () => ({ qScoped }));
vi.mock("./ukur-kueri", () => ({ ukur: (_n: string, read: () => Promise<unknown>) => read() }));
vi.mock("./queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queries")>()),
  getDailyGlByProduct: vi.fn(async () => []),
  getDoHarian: vi.fn(async () => []),
  getSalesByProduct: vi.fn(async () => []),
}));
vi.mock("./keuangan-input-queries", () => ({
  getAkunKas,
  getHargaBeliRows: vi.fn(async () => []),
  getMutasiKas,
}));
vi.mock("./pihak-lawan-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pihak-lawan-queries")>()),
  getPihakLawan,
}));

const { getBahanLaporan } = await import("./keuangan-laporan-queries");
const { langkahHarianDari, langkahHarianRinci } = await import("./keuangan-laporan-model");

const U = 7 as unknown as ScopedUnitId;
const D = "2026-11-03";
const KEMARIN = "2026-11-02";
const BCA = "acc-bca";
const KREDITUR = "pl-kreditur";
const UNIT_LAWAN = "pl-unit-bl";

let seq = 0;
const baris = (o: Partial<MutasiKasRow> & { amount: number; businessDate: string }): MutasiKasRow => {
  const kredit = o.amount < 0;
  return {
    id: `r${++seq}`,
    accountId: BCA,
    keterangan: "x",
    jenis: kredit ? "kredit" : "debet",
    categorySide: kredit ? "kredit" : "debet",
    categoryLabel: "Hutang Piutang",
    saldoAwal: false,
    saldoAwalSementara: false,
    void: false,
    sourceManualEntryId: null,
    dariPencairanEdc: false,
    pihakLawanId: null,
    tanggalAsal: null,
    ...o,
  };
};
const pembuka = (): MutasiKasRow =>
  baris({
    amount: 10_000_000_000,
    businessDate: "2026-10-01",
    jenis: "adjustment",
    categorySide: null,
    categoryLabel: null,
    saldoAwal: true,
  });

/** Pasang buku: `getMutasiKas(unit, to)` memulangkan baris ≤ to (+ saldo pembuka). */
function buku(rows: MutasiKasRow[]) {
  getMutasiKas.mockImplementation(async (_u: unknown, to: string) =>
    rows.filter((r) => r.businessDate <= to || (r.saldoAwal && !r.void)),
  );
}

async function langkah(rows: MutasiKasRow[]) {
  buku(rows);
  const b = await getBahanLaporan(U, D, KEMARIN);
  return { b, rinci: langkahHarianRinci(b), dinilai: langkahHarianDari(b) };
}

beforeEach(() => {
  seq = 0;
  qScoped.mockReset().mockResolvedValue([]);
  getAkunKas.mockReset().mockResolvedValue([{ id: BCA, nama: "Bank BCA - 1", kind: "bank", active: true }]);
  getPihakLawan.mockReset().mockResolvedValue([
    { id: KREDITUR, jenis: "kreditur", nama: "BPR Utari", lawanUnitId: null, aktif: true, saldoAwal: null },
    { id: UNIT_LAWAN, jenis: "unit", nama: "Batu Layang", lawanUnitId: 3, aktif: true, saldoAwal: null },
  ]);
});

describe("🔴 MUTAN eksekusi U6 — term Hutang Piutang non-EasyMax bertanda benar (KTD2)", () => {
  it("debet Hutang Piutang 1 jt (pinjaman DITERIMA dari kreditur) ⇒ langkah harian 0", async () => {
    // Kode lama: kas +1 jt DAN term "Hutang Piutang" +Σ amount = +1 jt ⇒
    // asset +2 jt ⇒ langkah −2 jt. Hutang yang lahir harus MENGURANGI asset.
    const { b, dinilai } = await langkah([
      pembuka(),
      baris({ amount: 1_000_000, businessDate: D, pihakLawanId: KREDITUR }),
    ]);
    expect(b.kasAkhir).toBe(10_001_000_000);
    expect(b.hutangPiutangNonEasymax).toBe(-1_000_000); // hutang
    expect(dinilai).toBe(0);
  });

  it("pinjaman DIBERIKAN ke unit lain 500 jt (kredit) ⇒ kas −500 jt, piutang +500 jt, langkah 0", async () => {
    const { b, dinilai } = await langkah([
      pembuka(),
      baris({ amount: -500_000_000, businessDate: D, pihakLawanId: UNIT_LAWAN }),
    ]);
    expect(b.kasAkhir).toBe(9_500_000_000);
    expect(b.hutangPiutangNonEasymax).toBe(500_000_000);
    expect(dinilai).toBe(0);
  });
});

describe("baris lama tanpa pihak lawan — 'pihak lawan belum ditetapkan' (R8, KTD3)", () => {
  it("Hutang Piutang 1 jt tanpa pihak lawan di hari terbuka ⇒ masuk belum ditetapkan, langkah 0", async () => {
    const { b, dinilai } = await langkah([pembuka(), baris({ amount: 1_000_000, businessDate: D })]);
    expect(b.pihakLawanBelumDitetapkan).toBe(-1_000_000);
    expect(b.hutangPiutangNonEasymax).toBe(-1_000_000);
    expect(dinilai).toBe(0);
  });

  it("sesudah 'Tetapkan pihak lawan' ⇒ pindah ke saldo pihak itu, langkah TETAP 0", async () => {
    const { b, dinilai } = await langkah([
      pembuka(),
      baris({ amount: 1_000_000, businessDate: D, pihakLawanId: KREDITUR }),
    ]);
    expect(b.pihakLawanBelumDitetapkan).toBe(0);
    expect(b.hutangPiutangNonEasymax).toBe(-1_000_000);
    expect(dinilai).toBe(0);
  });

  it("saldo pembuka pihak lawan SEMENTARA ⇒ term ditandai sementara (§10.26)", async () => {
    getPihakLawan.mockResolvedValue([
      {
        id: KREDITUR, jenis: "kreditur", nama: "BPR Utari", lawanUnitId: null, aktif: true,
        saldoAwal: { tanggal: "2026-10-01", amountSen: 0, sementara: true },
      },
    ]);
    const { b } = await langkah([pembuka()]);
    expect(b.pihakLawanSementara).toBe(true);
  });
});

describe("penampung 'Mutasi Belum Teridentifikasi' (R24, KTD8)", () => {
  it("parkir 500 jt (debet tak dikenal) ⇒ langkah 0", async () => {
    const { b, dinilai } = await langkah([
      pembuka(),
      baris({ amount: 500_000_000, businessDate: D, categoryLabel: "Mutasi Belum Teridentifikasi" }),
    ]);
    expect(b.penampung).toBe(-500_000_000);
    expect(dinilai).toBe(0);
  });

  it("parkir kredit kemarin, dipindah ke beban hari ini ⇒ laba turun 500 jt di hari pemindahan, langkah 0", async () => {
    // Kemarin: kredit 500 jt diparkir. Hari ini: pembalik di penampung (debet)
    // + baris tujuan (kredit Biaya Operasional) di rekening yang SAMA; bebannya
    // dicatat lewat pintu Finance (manual_entry, §2.4) — itu yang menurunkan laba.
    qScoped.mockImplementation(async (_u: unknown, sql: string, p: unknown[]) =>
      sql.includes("FROM app.manual_entry m") && sql.includes("section IN ('pengeluaran','pendapatan_lain')") &&
      (p as string[])[1] === D
        ? [{
            businessDate: D, accountingAccount: "6-9100", amountRp: 500_000_000, keterangan: "biaya dipindah dari penampung",
            void: false, section: "pengeluaran", operationalCategory: "Lain-Lain",
          }]
        : [],
    );
    const { b, dinilai } = await langkah([
      pembuka(),
      baris({ amount: -500_000_000, businessDate: KEMARIN, categoryLabel: "Mutasi Belum Teridentifikasi" }),
      baris({ amount: 500_000_000, businessDate: D, categoryLabel: "Mutasi Belum Teridentifikasi" }),
      baris({ amount: -500_000_000, businessDate: D, categoryLabel: "Biaya Operasional" }),
    ]);
    expect(b.penampung).toBe(0);
    expect(b.beban.reduce((s, x) => s + x.amountRp, 0)).toBe(500_000_000);
    expect(dinilai).toBe(0);
  });
});

describe("koreksi susulan (KTD15, R32)", () => {
  it("Covers AE13 — transfer pelanggan 160 jt bertanggal asal 2 Okt dibukukan 3 Nov ⇒ penuh & koreksi −160 jt, dinilai 0", async () => {
    // ⚠️ TANDA: di rumus repo ini langkah = laba − Δasset. Kas +160 jt tanpa
    // pasangan EasyMax hari itu (EasyMax sudah menurunkan piutangnya 2 Okt)
    // berarti Δasset +160 jt ⇒ langkah −160 jt. Rencana menulis "+160 jt"
    // sebagai BESARAN; tandanya mengikuti rumus §1.2 (lihat uji lama
    // "baris kas yang masuk SESUDAH layar dibuka").
    const { rinci } = await langkah([
      pembuka(),
      baris({
        amount: 160_000_000,
        businessDate: D,
        tanggalAsal: "2026-10-02",
        categoryLabel: "Transfer Pembayaran Piutang Pelanggan",
      }),
    ]);
    expect(rinci.penuh).toBe(-160_000_000);
    expect(rinci.koreksiSusulan).toBe(-160_000_000);
    expect(rinci.dinilai).toBe(0);
  });

  it("pinjaman susulan BERPIHAK LAWAN bertanggal asal lampau ⇒ koreksi susulan 0", async () => {
    const { rinci } = await langkah([
      pembuka(),
      baris({ amount: 25_000_000, businessDate: D, tanggalAsal: "2026-10-15", pihakLawanId: KREDITUR }),
    ]);
    expect(rinci.penuh).toBe(0);
    expect(rinci.koreksiSusulan).toBe(0);
    expect(rinci.dinilai).toBe(0);
  });

  /** `manual_entry` hari D yang dipulangkan kueri beban/pendapatan laporan. */
  const manualHariIni = (rows: Record<string, unknown>[]) =>
    qScoped.mockImplementation(async (_u: unknown, sql: string, p: unknown[]) =>
      sql.includes("FROM app.manual_entry m") && sql.includes("section IN ('pengeluaran','pendapatan_lain')") &&
      (p as string[])[1] === D
        ? rows.map((r) => ({ businessDate: D, keterangan: "x", void: false, operationalCategory: "Lain-Lain", ...r }))
        : [],
    );

  it("🔴 Biaya Operasional susulan + beban pintu Finance yang bertaut ⇒ dinilai = penuh, koreksi 0 (§10.34: sudah seimbang di SolaMax)", async () => {
    // Klasifikasi debit bank 2 Okt ke Biaya Operasional, dibukukan maju 3 Nov:
    // DUA baris — kas −7,5 jt (tanggal asal 2 Okt) + manual_entry Finance 7,5 jt
    // bertaut `cash_ledger_id` (0053). Pasangan ini nol di `penuh`; mencabut
    // hanya kakinya yang kas dari `dinilai` melahirkan selisih +7,5 jt palsu.
    const kas = baris({ amount: -7_500_000, businessDate: D, tanggalAsal: "2026-10-02", categoryLabel: "Biaya Operasional" });
    manualHariIni([{ accountingAccount: "6-9100", amountRp: 7_500_000, section: "pengeluaran", cashLedgerId: kas.id }]);
    const { b, rinci } = await langkah([pembuka(), kas]);
    expect(b.beban.reduce((s, x) => s + x.amountRp, 0)).toBe(7_500_000); // laba layar tetap memuatnya
    expect(rinci.penuh).toBe(0);
    expect(rinci.dinilai).toBe(rinci.penuh);
    expect(rinci.koreksiSusulan).toBe(0);
  });

  it("🔴 Pendapatan Lain-Lain susulan (kredit bank) + pendapatan pintu Finance bertaut ⇒ dinilai = penuh, koreksi 0", async () => {
    const kas = baris({ amount: 2_250_000, businessDate: D, tanggalAsal: "2026-10-20", categoryLabel: "Pendapatan Lain-Lain" });
    manualHariIni([{ accountingAccount: null, amountRp: 2_250_000, section: "pendapatan_lain", cashLedgerId: kas.id }]);
    const { b, rinci } = await langkah([pembuka(), kas]);
    expect(b.pendapatanLain).toBe(2_250_000);
    expect(rinci.penuh).toBe(0);
    expect(rinci.dinilai).toBe(rinci.penuh);
    expect(rinci.koreksiSusulan).toBe(0);
  });

  it("beban yang TIDAK bertaut baris susulan tetap di kedua hitungan — koreksi = transfer pelanggan saja (AE13)", async () => {
    // Beban pengawas 1 jt (tanpa baris kas) + beban Finance bertaut baris kas
    // BIASA hari ini (bukan susulan) + transfer pelanggan susulan 160 jt.
    const biasa = baris({ amount: -3_000_000, businessDate: D, categoryLabel: "Biaya Operasional" });
    manualHariIni([
      { accountingAccount: "6-9100", amountRp: 1_000_000, section: "pengeluaran", cashLedgerId: null },
      { accountingAccount: "6-9100", amountRp: 3_000_000, section: "pengeluaran", cashLedgerId: biasa.id },
    ]);
    const { rinci } = await langkah([
      pembuka(),
      biasa,
      baris({ amount: 160_000_000, businessDate: D, tanggalAsal: "2026-10-02", categoryLabel: "Transfer Pembayaran Piutang Pelanggan" }),
    ]);
    // Beban pengawas 1 jt tanpa kas ⇒ langkah −1 jt di KEDUA hitungan.
    expect(rinci.dinilai).toBe(-1_000_000);
    expect(rinci.penuh).toBe(-1_000_000 - 160_000_000);
    expect(rinci.koreksiSusulan).toBe(-160_000_000);
  });

  it("baris susulan yang dibukukan KEMARIN tidak menjadi koreksi hari ini", async () => {
    const { rinci } = await langkah([
      pembuka(),
      baris({
        amount: 9_000_000,
        businessDate: KEMARIN,
        tanggalAsal: "2026-10-02",
        categoryLabel: "Transfer Pembayaran Piutang Pelanggan",
      }),
    ]);
    expect(rinci.penuh).toBe(0);
    expect(rinci.koreksiSusulan).toBe(0);
  });
});

describe("penebusan SO dari buku kas (R16)", () => {
  it("kredit Pembelian BBM hari itu ⇒ penebusanSo terisi (bertanda arus kas: keluar = negatif)", async () => {
    const { b } = await langkah([
      pembuka(),
      baris({ amount: -320_000_000, businessDate: D, categoryLabel: "Pembelian BBM" }),
      baris({ amount: -1_000, businessDate: KEMARIN, categoryLabel: "Pembelian BBM" }),
    ]);
    expect(b.penebusanSo).toBe(-320_000_000);
  });

  it("tanpa akun kas ⇒ penebusanSo null (tak bersumber), bukan 0", async () => {
    getAkunKas.mockResolvedValue([]);
    const { b } = await langkah([]);
    expect(b.penebusanSo).toBeNull();
  });
});
