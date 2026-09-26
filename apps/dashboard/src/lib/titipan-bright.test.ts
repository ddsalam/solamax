import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pilahManualEntry } from "./keuangan-beban";
import { panelBalance, type BalanceInput } from "./keuangan-laporan-model";
import { isTitipanBright, KATEGORI_TITIPAN_BRIGHT } from "./titipan-bright";

const b = (keterangan: string, operationalCategory: string | null = null, section = "pendapatan_lain") => ({
  section,
  operationalCategory,
  keterangan,
});

describe("isTitipanBright — satu pengenal (§10.27)", () => {
  it.each([
    "SETORAN BRIGHT IB TGL 24 SEPTEMBER 2026",
    "setoran kas bright kb 24/09/2026",
    "SETORAN BRIGHT PEMDA 24 SEPTEMBER 2026",
    "TITIPAN SETORAN PT SPH/ KAS",
  ])("baris lama '%s' dikenali sebagai titipan", (k) => expect(isTitipanBright(b(k))).toBe(true));

  it.each(["LEBIH SETOR SHIFT 3", "SETORAN KEBAB", "BRIGHTNESS LAMPU", "PAK DION"])(
    "'%s' BUKAN titipan (kata utuh, bukan potongan)",
    (k) => expect(isTitipanBright(b(k))).toBe(false),
  );

  it("pilihan pengawas MENANG atas keterangan, ke dua arah", () => {
    expect(isTitipanBright(b("SETORAN BRIGHT", "Lain-Lain"))).toBe(false);
    expect(isTitipanBright(b("uang outlet", KATEGORI_TITIPAN_BRIGHT))).toBe(true);
  });

  it("hanya Pendapatan Lain — pengeluaran berketerangan bright bukan titipan", () => {
    expect(isTitipanBright(b("beli tabung bright", null, "pengeluaran"))).toBe(false);
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
    expect(baca("keuangan-laporan-queries.ts")).toMatch(/sqlTitipanBright\("m"\)/);
    expect(baca("keuangan-pantau-queries.ts")).toMatch(/AND NOT \$\{sqlTitipanBright\("m"\)\}/);
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
