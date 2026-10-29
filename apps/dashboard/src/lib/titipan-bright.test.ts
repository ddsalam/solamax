import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pilahManualEntry } from "./keuangan-beban";
import { panelBalance, type BalanceInput } from "./keuangan-laporan-model";
import { periksaPihakLawanMutasi } from "./pihak-lawan-model";
import {
  isTitipan,
  KATEGORI_PENYERAHAN_TITIPAN,
  KATEGORI_PENYERAHAN_TITIPAN_BRIGHT,
  KATEGORI_TITIPAN,
  KATEGORI_TITIPAN_BRIGHT,
  pemilikAwal,
  saldoTitipanPerPemilik,
  totalSaldoTitipan,
} from "./titipan-bright";

const b = (keterangan: string, operationalCategory: string | null = null, section = "pendapatan_lain") => ({
  section,
  operationalCategory,
  keterangan,
});

describe("isTitipan — satu pengenal (§10.27, U5)", () => {
  it.each([
    "SETORAN BRIGHT IB TGL 24 SEPTEMBER 2026",
    "setoran kas bright kb 24/09/2026",
    "SETORAN BRIGHT PEMDA 24 SEPTEMBER 2026",
    "TITIPAN SETORAN PT SPH/ KAS",
  ])("baris lama '%s' dikenali sebagai titipan", (k) => expect(isTitipan(b(k))).toBe(true));

  it.each(["LEBIH SETOR SHIFT 3", "SETORAN KEBAB", "BRIGHTNESS LAMPU", "PAK DION"])(
    "'%s' BUKAN titipan (kata utuh, bukan potongan)",
    (k) => expect(isTitipan(b(k))).toBe(false),
  );

  it("pilihan pengawas MENANG atas keterangan, ke dua arah", () => {
    expect(isTitipan(b("SETORAN BRIGHT", "Lain-Lain"))).toBe(false);
    expect(isTitipan(b("uang outlet", KATEGORI_TITIPAN_BRIGHT))).toBe(true);
    expect(isTitipan(b("uang outlet", KATEGORI_TITIPAN))).toBe(true);
  });

  it("🔴 pemilik baru TANPA pengenal kata: 'kebab' tanpa kategori titipan bukan titipan", () => {
    expect(isTitipan(b("SETORAN KEBAB 24/10"))).toBe(false);
    expect(isTitipan(b("kebab", "Lain-Lain"))).toBe(false);
    // Dengan pilihan eksplisit pengawas, Kebab adalah titipan.
    expect(isTitipan(b("SETORAN KEBAB 24/10", KATEGORI_TITIPAN))).toBe(true);
  });

  it("hanya Pendapatan Lain — pengeluaran berketerangan bright bukan titipan", () => {
    expect(isTitipan(b("beli tabung bright", null, "pengeluaran"))).toBe(false);
  });
});

describe("laporan — titipan keluar dari laba, masuk liabilitas", () => {
  it("pilahManualEntry memisahkan titipan dari pendapatan lain", () => {
    const r = pilahManualEntry(
      [
        { ...b("SETORAN BRIGHT IB"), amountRp: 12_484_800, businessDate: "2026-09-24", accountingAccount: null, void: false },
        { ...b("SEWA KANTIN"), amountRp: 500_000, businessDate: "2026-09-24", accountingAccount: null, void: false },
      ],
    );
    expect(r.pendapatanLain).toBe(500_000);
    expect(r.titipanBright).toBe(12_484_800);
  });

  it("🔴 INVARIAN: memindah X dari pendapatan ke titipan TIDAK mengubah langkah harian", () => {
    // Kas naik X hari ini di kedua skenario. Dulu X = laba; kini X = utang.
    const X = 12_484_800;
    const dasar: BalanceInput = {
      sebabKas: null,
      cashOnHand: 1_000_000_000 + X,
      inventoryValue: 500_000_000,
      soValue: 0,
      piutangEasymax: 0,
      hutangPiutangNonEasymax: 0,
      penampung: 0,
      temporaryInvestment: 0,
      openedRetainedEarnings: null,
      netIncome: 0,
      incomeAdjustment: null,
      totalAssetKemarin: 1_500_000_000,
      deltaKontribusi: null,
      saldoTitipanBright: 0,
    };
    const sebagaiPendapatan = panelBalance({ ...dasar, netIncome: X });
    const sebagaiTitipan = panelBalance({ ...dasar, netIncome: 0, saldoTitipanBright: X });
    expect(sebagaiPendapatan.langkahHarian).toBe(0);
    expect(sebagaiTitipan.langkahHarian).toBe(0);
    const baris = sebagaiTitipan.baris.find((x) => x.label === "Titipan outlet Bright (liabilitas)")!;
    expect(baris.nilai).toBe(-X);
  });
});

describe("penjaga — satu aturan, di semua tempat", () => {
  const baca = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("laporan & pemantauan memakai padanan SQL yang SAMA", () => {
    expect(baca("keuangan-laporan-queries.ts")).toMatch(/sqlTitipan\("m"\)/);
    expect(baca("keuangan-pantau-queries.ts")).toMatch(/AND NOT \$\{sqlTitipan\("m"\)\}/);
  });
  it("konsumen memakai pengenal yang SAMA (TS & SQL)", () => {
    expect(baca("keuangan-input-queries.ts")).toMatch(/\$\{sqlTitipan\("m"\)\} AS "titipanBright"/);
    expect(baca("keuangan-beban.ts")).toMatch(/isTitipan\(r\)/);
    expect(baca("reklas-actions.ts")).toMatch(/titipanBright: isTitipan\(\{/);
  });
  it("padanan SQL mengenali KEDUA kategori titipan", () => {
    expect(baca("titipan-bright.ts")).toMatch(
      /operational_category IN \('\$\{KATEGORI_TITIPAN\}', '\$\{KATEGORI_TITIPAN_BRIGHT\}'\)/,
    );
  });
  it("padanan SQL berbunyi sama dengan pola TS", () => {
    const ts = baca("titipan-bright.ts");
    expect(ts).toMatch(/\/\(\^\|\[\^a-z\]\)\(bright\|titipan\)\(\[\^a-z\]\|\$\)\/i/);
    expect(ts).toMatch(/~\* '\(\^\|\[\^a-z\]\)\(bright\|titipan\)\(\[\^a-z\]\|\$\)'/);
  });
  it("pilihan 'bukan titipan' dicatat eksplisit agar tak ditimpa pengenal", () => {
    expect(baca("manual-entry-actions.ts")).toMatch(/POLA_KETERANGAN_TITIPAN\.test\(ket\)\s*\n\s*\? "Lain-Lain"/);
  });
});

// ---------------------------------------------------------------------------
// U5 — titipan per pemilik (R6, KTD11)
// ---------------------------------------------------------------------------

const BRIGHT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEBAB = "kkkkkkkk-kkkk-4kkk-8kkk-kkkkkkkkkkkk";
/** Baris pemilik dari kueri laporan: setiap pemilik titipan unit, Σ diterimanya (0 bila belum ada). */
const pemilik = (bright: number, kebab = 0, tanpaPemilik?: number) => [
  { pihakLawanId: BRIGHT, nama: "Outlet Bright", rp: bright },
  { pihakLawanId: KEBAB, nama: "Kebab Baba Rafi", rp: kebab },
  ...(tanpaPemilik === undefined ? [] : [{ pihakLawanId: null, nama: null, rp: tanpaPemilik }]),
];
const kas = (categoryLabel: string, amount: number, pihakLawanId: string | null, businessDate = "2026-10-05") => ({
  businessDate,
  categoryLabel,
  pihakLawanId,
  amount,
  void: false,
});

describe("saldo titipan per pemilik (U5)", () => {
  it("🔴 AE7: setoran Bright 25.000.000 + penyerahan 25.000.000 ⇒ saldo Bright 0, laba tak berubah", () => {
    const per = saldoTitipanPerPemilik(
      pemilik(25_000_000),
      [kas(KATEGORI_PENYERAHAN_TITIPAN, -25_000_000, BRIGHT)],
      "2026-10-05",
    );
    expect(per).toEqual([{ pihakLawanId: BRIGHT, nama: "Outlet Bright", saldo: 0 }]);
    expect(totalSaldoTitipan(per)).toBe(0);
    // Laba: setoran titipan Bright (pemilik eksplisit) tak masuk pendapatan lain.
    const r = pilahManualEntry([
      { ...b("SETORAN BRIGHT 05/10", KATEGORI_TITIPAN), amountRp: 25_000_000, businessDate: "2026-10-05", accountingAccount: null, void: false },
    ]);
    expect(r.pendapatanLain).toBe(0);
    expect(r.titipanBright).toBe(25_000_000);
  });

  it("titipan Kebab berpemilik Kebab ⇒ saldo Kebab naik, BUKAN pendapatan lain", () => {
    const per = saldoTitipanPerPemilik(pemilik(0, 4_500_000), [], "2026-10-05");
    expect(per).toEqual([{ pihakLawanId: KEBAB, nama: "Kebab Baba Rafi", saldo: 4_500_000 }]);
    const r = pilahManualEntry([
      { ...b("SETORAN KEBAB", KATEGORI_TITIPAN), amountRp: 4_500_000, businessDate: "2026-10-05", accountingAccount: null, void: false },
    ]);
    expect(r.pendapatanLain).toBe(0);
  });

  it("baris LAMA tanpa pemilik ('SETORAN BRIGHT') ⇒ terhitung ke Outlet Bright", () => {
    const per = saldoTitipanPerPemilik(pemilik(1_000_000, 0, 12_484_800), [], "2026-09-24");
    expect(per).toEqual([{ pihakLawanId: BRIGHT, nama: "Outlet Bright", saldo: 13_484_800 }]);
  });

  it("penyerahan LAMA 'Penyerahan titipan Bright' (0045) mengurangi saldo Outlet Bright", () => {
    const per = saldoTitipanPerPemilik(
      pemilik(0, 0, 12_484_800),
      [kas(KATEGORI_PENYERAHAN_TITIPAN_BRIGHT, -12_484_800, null, "2026-09-30")],
      "2026-09-30",
    );
    expect(per).toEqual([{ pihakLawanId: BRIGHT, nama: "Outlet Bright", saldo: 0 }]);
  });

  it("dua pemilik terpisah; gabungannya = baris liabilitas yang sudah ada", () => {
    const per = saldoTitipanPerPemilik(
      pemilik(10_000_000, 3_000_000),
      [kas(KATEGORI_PENYERAHAN_TITIPAN, -1_000_000, KEBAB), kas(KATEGORI_PENYERAHAN_TITIPAN, -2_000_000, BRIGHT)],
      "2026-10-05",
    );
    expect(per.map((p) => [p.nama, p.saldo])).toEqual([
      ["Kebab Baba Rafi", 2_000_000],
      ["Outlet Bright", 8_000_000],
    ]);
    expect(totalSaldoTitipan(per)).toBe(10_000_000);
  });

  it("penyerahan void / sesudah tanggal laporan tak dihitung", () => {
    const per = saldoTitipanPerPemilik(
      pemilik(5_000_000),
      [
        { ...kas(KATEGORI_PENYERAHAN_TITIPAN, -5_000_000, BRIGHT), void: true },
        kas(KATEGORI_PENYERAHAN_TITIPAN, -5_000_000, BRIGHT, "2026-10-06"),
      ],
      "2026-10-05",
    );
    expect(per).toEqual([{ pihakLawanId: BRIGHT, nama: "Outlet Bright", saldo: 5_000_000 }]);
  });

  it("unit tanpa baris 'Outlet Bright' (lahir sesudah 0049): baris lama tetap tampil sebagai Outlet Bright", () => {
    const per = saldoTitipanPerPemilik([{ pihakLawanId: null, nama: null, rp: 700_000 }], [], "2026-10-05");
    expect(per).toEqual([{ pihakLawanId: null, nama: "Outlet Bright", saldo: 700_000 }]);
  });

  it("🔴 penyerahan titipan TANPA pihak lawan ditolak (gerbang aksi simpanMutasiKas)", () => {
    expect(
      periksaPihakLawanMutasi({ categoryLabel: KATEGORI_PENYERAHAN_TITIPAN, pihakLawanId: null, pihak: null }),
    ).toMatch(/wajib menyebut pihak lawan/);
  });
});

describe("pilihan awal pemilik di formulir (U5)", () => {
  const daftar = [
    { id: KEBAB, nama: "Kebab Baba Rafi" },
    { id: BRIGHT, nama: "Outlet Bright" },
  ];
  it("Outlet Bright terpilih lebih dulu HANYA bila keterangan dikenali aturan §10.27", () => {
    expect(pemilikAwal("SETORAN BRIGHT IB", daftar)).toBe(BRIGHT);
    expect(pemilikAwal("SETORAN KEBAB", daftar)).toBe("");
    expect(pemilikAwal("uang outlet", daftar)).toBe("");
  });
  it("Outlet Bright tak ada di daftar (nonaktif) ⇒ kosong, bukan id lain", () => {
    expect(pemilikAwal("SETORAN BRIGHT IB", [daftar[0]!])).toBe("");
  });
});
