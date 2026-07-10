import { describe, expect, it } from "vitest";
import { buildRincianModel, type RincianRaw } from "./rincian-model";

/**
 * buildRincianModel — kunci formula rekonsiliasi & pemetaan seksi manual:
 * E = A − (B+C+D); H = E + F − G; indikator I-vs-H (I<H → warn + selisih H−I,
 * I≥H → ok, I null → baris disembunyikan). Manual: Pendapatan Lain = seksi 5
 * (summary F), Pengeluaran = seksi 7 (summary G) — guard utk judul panel layar.
 */

const manual = (id: string, keterangan: string, amount: number) => ({
  id, keterangan, amount, urut: 0,
});

// Angka dipilih agar tiap komponen terbaca unik di hasil format id-ID.
// A=10.000.000 · B=100.000 · C=200.000 · D=300.000 → E=9.400.000
const raw = (over: Partial<RincianRaw> = {}): RincianRaw =>
  ({
    prod: [{ nama: "PERTALITE", vol: 1000, omzet: 10_000_000 }],
    terra: [{ nama: "PERTALITE", ckdbbm: "P", liter: 10, rp: 100_000 }],
    pelanggan: [{ nama: "PT MAJU", ckdplg: "PLG1", liter: 20, rp: 200_000 }],
    edc: [{ nama: "EDC BCA", rp: 300_000 }],
    edcBlank: { rp: 0, n: 0 },
    deposit: [],
    pendapatanLain: [],
    pengeluaran: [],
    setoranTunai: [],
    ...over,
  }) as unknown as RincianRaw;

const sum = (m: ReturnType<typeof buildRincianModel>, l: string) =>
  m.summary.find((s) => s.l === l)!;

describe("buildRincianModel — rekonsiliasi & seksi manual", () => {
  it("E = A − (B + C + D), dengan formula tercantum", () => {
    const m = buildRincianModel(raw());
    const e = sum(m, "E");
    expect(e.val).toBe("Rp 9.400.000");
    expect(e.formula).toBe("E = A − (B + C + D)");
  });

  it("seksi manual bernomor 5 (Pendapatan Lain) & 7 (Pengeluaran) — guard judul panel", () => {
    const m = buildRincianModel(raw());
    expect(m.sections[4]).toMatchObject({ num: "5", title: "PENDAPATAN LAIN" });
    expect(m.sections[6]).toMatchObject({ num: "7", title: "PENGELUARAN" });
  });

  it("entri manual → baris seksi (format rp) + total F/G + H = E + F − G", () => {
    const m = buildRincianModel(
      raw({
        pendapatanLain: [manual("p1", "SETORAN BRIGHT", 15_489_700)],
        pengeluaran: [manual("g1", "HENDRI/IBU RINA", 50_000), manual("g2", "JUVEN/IBU RINA", 30_137)],
      }),
    );
    const s5 = m.sections[4]!;
    expect(s5.rows[0]).toMatchObject({ no: "1", ket: "SETORAN BRIGHT", rpv: "Rp 15.489.700" });
    expect(s5.totalRp).toBe("Rp 15.489.700");
    const s7 = m.sections[6]!;
    expect(s7.rows.map((r) => r.rpv)).toEqual(["Rp 50.000", "Rp 30.137"]);
    expect(s7.totalRp).toBe("Rp 80.137");
    expect(sum(m, "F").val).toBe("Rp 15.489.700");
    expect(sum(m, "G").val).toBe("Rp 80.137");
    // H = 9.400.000 + 15.489.700 − 80.137
    expect(sum(m, "H").val).toBe("Rp 24.809.563");
    expect(sum(m, "H").formula).toBe("H = E + F − G");
  });

  it("I ≥ H → indikator ok 'Setoran menutup uang tunai'", () => {
    const m = buildRincianModel(
      raw({
        pendapatanLain: [manual("p1", "X", 15_489_700)],
        pengeluaran: [manual("g1", "Y", 80_137)],
        setoranTunai: [manual("s1", "SETOR BANK", 24_809_563)],
      }),
    );
    const i = sum(m, "I");
    expect(i.val).toBe("Rp 24.809.563");
    expect(i.note).toEqual({ tone: "ok", text: "Setoran menutup uang tunai (I ≥ H)" });
  });

  it("I < H → warn dengan selisih H − I", () => {
    const m = buildRincianModel(
      raw({
        pendapatanLain: [manual("p1", "X", 15_489_700)],
        pengeluaran: [manual("g1", "Y", 80_137)],
        setoranTunai: [manual("s1", "SETOR BANK", 20_000_000)],
      }),
    );
    const i = sum(m, "I");
    expect(i.note?.tone).toBe("warn");
    // selisih = 24.809.563 − 20.000.000
    expect(i.note?.text).toBe("Setoran kurang dari uang tunai (I < H, selisih Rp 4.809.563)");
  });

  it("tanpa setoran → I null & tanpa note (baris/indikator disembunyikan)", () => {
    const m = buildRincianModel(raw());
    const i = sum(m, "I");
    expect(i.val).toBeNull();
    expect(i.note).toBeUndefined();
  });
});
