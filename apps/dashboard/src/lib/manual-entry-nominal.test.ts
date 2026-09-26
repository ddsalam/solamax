import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { panelIncome } from "./keuangan-laporan-model";
import { kumpulkanBeban, pilahManualEntry } from "./keuangan-beban";
import type { DayTotals } from "./keuangan-mesin";
import { NOMINAL_MANUAL_ENTRY_SQL, nominalManualEntry } from "./manual-entry-nominal";

/**
 * Cacat "biaya pengawas MENAMBAH laba bersih" (26 Sep 2026).
 *
 * ⛔ Pelajaran yang membuat berkas ini ada: setiap uji sebelumnya memakai baris
 * dari SATU pintu. Cacatnya hanya hidup saat pintu pengawas (positif) dan
 * pintu Finance (dulu negatif) bertemu di satu laporan — jadi setiap uji di
 * bawah memakai baris dari KEDUA pintu, dan satu uji memakai angka produksi.
 */

const baris = (
  sourceDoor: "pengawas" | "finance",
  amount: number,
  keterangan = "x",
  section = "pengeluaran",
) => ({
  section,
  operationalCategory: null,
  businessDate: "2026-09-24",
  accountingAccount: null,
  amountRp: nominalManualEntry({ sourceDoor, amount }),
  keterangan,
  void: false,
});

const totals = (o: Partial<DayTotals> = {}): DayTotals => ({
  revenue: 673_641_697,
  teraValue: 0,
  cogs: -613_249_184,
  grossProfit: 60_392_512,
  lossesGainValue: -173_925_195,
  inventoryValue: 0,
  soValue: 0,
  incomplete: [],
  perusakGp: [],
  ...o,
});

/** Rantai yang SAMA dengan laporan: pilah → kumpulkan beban → panel laba rugi. */
const labaBersih = (manual: ReturnType<typeof baris>[]) => {
  const { manualBeban, pendapatanLain } = pilahManualEntry(manual);
  return panelIncome({
    totals: totals(),
    beban: kumpulkanBeban({ manual_entry: manualBeban, noncash_expense: [] }, "2026-09-24", "2026-09-24"),
    pendapatanLain,
    incomeAdjustment: null,
  }).baris.find((b) => b.label === "Net profit")!.nilai;
};

describe("konvensi nominal manual_entry — satu tanda untuk dua pintu", () => {
  it("pengawas dibaca apa adanya; Finance lama yang negatif dinormalkan; Finance baru positif tetap", () => {
    expect(nominalManualEntry({ sourceDoor: "pengawas", amount: 659_800 })).toBe(659_800);
    expect(nominalManualEntry({ sourceDoor: "finance", amount: -500_000 })).toBe(500_000);
    expect(nominalManualEntry({ sourceDoor: "finance", amount: 250_000 })).toBe(250_000);
  });

  it("padanan SQL berbunyi sama dengan fungsi murninya", () => {
    expect(NOMINAL_MANUAL_ENTRY_SQL).toMatch(/source_door = 'finance' THEN abs\(amount\) ELSE amount/);
  });
});

describe("🔴 laba bersih — biaya MENGURANGI laba, dari pintu mana pun", () => {
  it("angka produksi Imam Bonjol 24-09-2026: −119.737.483 (bukan −94.843.083 cacat, bukan −107.252.683 pra-§10.27)", () => {
    // Delapan baris pengeluaran pengawas hari itu (total 6.204.800) dan satu
    // "pendapatan lain" 12.484.800 yang ternyata SETORAN BRIGHT IB — titipan
    // outlet Bright (§10.27, keputusan owner 26-09), bukan pendapatan SPBU.
    // Riwayat: cacat tanda −94.843.083 → perbaikan #397 −107.252.683 → §10.27.
    const pengeluaran = [100_000, 50_000, 50_000, 100_000, 100_000, 5_000_000, 659_800, 145_000].map((n) =>
      baris("pengawas", n),
    );
    const pendapatan = baris("pengawas", 12_484_800, "SETORAN BRIGHT IB", "pendapatan_lain");
    expect(labaBersih([...pengeluaran, pendapatan])).toBe(-119_737_483);
  });

  it("baris pengawas DAN Finance pada hari yang sama menjumlah sebagai beban", () => {
    const tanpaBiaya = labaBersih([])!;
    const campur = labaBersih([
      baris("pengawas", 1_000_000),
      baris("finance", -500_000, "lama"),
      baris("finance", 250_000, "baru"),
    ])!;
    expect(tanpaBiaya - campur).toBe(1_750_000);
  });
});

describe("penjaga — cacatnya tidak bisa kembali lewat pintu samping", () => {
  const baca = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

  it("laporan keuangan membaca nominal lewat ekspresi bersama, TANPA membalik tanda", () => {
    const q = baca("keuangan-laporan-queries.ts");
    expect(q).toMatch(/\$\{NOMINAL_MANUAL_ENTRY_SQL\}::float8 AS "amountRp"/);
    expect(q).not.toMatch(/amountRp:\s*-\s*r\.amountRp/);
    expect(q).toMatch(/pilahManualEntry\(manual\)/);
  });

  it("panel biaya Finance membaca nominal lewat ekspresi yang SAMA", () => {
    expect(baca("keuangan-input-queries.ts")).toMatch(/\$\{NOMINAL_MANUAL_ENTRY_SQL\}::float8 AS amount/);
  });

  it("pintu Finance menyimpan nominal POSITIF", () => {
    const a = baca("biaya-actions.ts");
    expect(a).toMatch(/const amount = input\.amountRp;/);
    expect(a).not.toMatch(/-input\.amountRp/);
  });

  it("rekonsiliasi pengawas (Rincian & Ketaatan) hanya membaca pintu pengawas — SEMUA kuerinya", () => {
    // Penjaga menemukan himpunannya sendiri: setiap `FROM app.manual_entry` di
    // queries.ts adalah jalur Rincian/Ketaatan, dan setiap satu wajib bersaring.
    const q = baca("queries.ts");
    const blok = q.split("FROM app.manual_entry").slice(1).map((s) => s.slice(0, 400));
    expect(blok.length, "tak ada subjek — penjaga tanpa himpunan").toBeGreaterThanOrEqual(3);
    for (const b of blok) expect(b).toMatch(/source_door = 'pengawas'/);
  });

  it("pengawas tidak bisa membatalkan baris pintu Finance", () => {
    expect(baca("manual-entry-actions.ts")).toMatch(/AND source_door = 'pengawas'/);
  });

  it("database menolak nominal ≤ 0 untuk baris baru (0042)", () => {
    const m = readFileSync(
      resolve(__dirname, "../../../backend/prisma/migrations/0042_manual_entry_nominal_positif/migration.sql"),
      "utf8",
    );
    expect(m).toMatch(/CHECK \("void" OR "amount" > 0\) NOT VALID/);
  });
});
