/**
 * Arus Minyak Harian — uji formula + pengikat ke ORACLE.
 *
 * Oracle sah: blok ARUS MINYAK "LAPORAN RESUME OPERASIONAL" EasyMax, unit Imam
 * Bonjol 1–6 Agustus 2026 (PNG ditranskripsi di
 * session-notes/2026-08-08-arus-minyak-harian.md, disegel SEBELUM query pertama).
 * Angka komponen di bawah adalah keluaran `getDailyGlByProduct` yang diukur dari
 * DB pilot — jadi tes ini menguji jalur formula, bukan formula menguji dirinya.
 */
import { describe, expect, it } from "vitest";
import { buildArusMinyak, lossPct, losses, stockTeori } from "@/lib/arus-minyak";
import type { DailyGlRow } from "@/lib/queries";

type Comp = {
  ckdbbm: string;
  nama: string;
  fisik_prev: number | null;
  pen_do: number;
  sales_gross: number;
  tera: number;
  fisik: number | null;
};

function row(c: Comp): DailyGlRow {
  const gl =
    c.fisik === null || c.fisik_prev === null
      ? null
      : c.fisik - (c.fisik_prev + c.pen_do - (c.sales_gross - c.tera));
  return {
    d: "2026-08-06",
    ckdbbm: c.ckdbbm,
    nama: c.nama,
    fisik: c.fisik,
    fisik_prev: c.fisik_prev,
    pen_do: c.pen_do,
    sales_gross: c.sales_gross,
    tera: c.tera,
    gl,
    excluded_tanks: 0,
    provisional: false,
  };
}

const r2 = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

/** 6 Agustus 2026 — komponen terukur dari DB pilot (unit 1). */
const IB_06AGU: Comp[] = [
  { ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 18685.01, pen_do: 8000, sales_gross: 2859.71, tera: 0, fisik: 23635.74 },
  { ckdbbm: "BB-03", nama: "SOLAR", fisik_prev: 3930.38, pen_do: 16000, sales_gross: 12433.15, tera: 0, fisik: 7550.5 },
  { ckdbbm: "BB-04", nama: "PERTAMAX TURBO", fisik_prev: 5167.93, pen_do: 0, sales_gross: 113.56, tera: 0, fisik: 5060.54 },
  { ckdbbm: "BB-06", nama: "DEXLITE", fisik_prev: 10498.83, pen_do: 8000, sales_gross: 6742.22, tera: 0, fisik: 11738.93 },
  { ckdbbm: "BB-07", nama: "PERTALITE", fisik_prev: 12834.83, pen_do: 24000, sales_gross: 23422.46, tera: 0, fisik: 13219.91 },
  { ckdbbm: "BB-08", nama: "PERTAMINA DEX", fisik_prev: 2766.43, pen_do: 8000, sales_gross: 3003.39, tera: 0, fisik: 13310 },
];

/** Sel oracle 6 Agu: [awal, penerimaan, penjualan, teori, fisik, losses, %]. */
const ORACLE_06AGU: Record<string, number[]> = {
  PERTAMAX: [18685.01, 8000, 2859.71, 23825.3, 23635.74, -189.56, -6.63],
  SOLAR: [3930.38, 16000, 12433.15, 7497.23, 7550.5, 53.27, 0.43],
  "PERTAMAX TURBO": [5167.93, 0, 113.56, 5054.37, 5060.54, 6.17, 5.43],
  DEXLITE: [10498.83, 8000, 6742.22, 11756.61, 11738.93, -17.68, -0.26],
  PERTALITE: [12834.83, 24000, 23422.46, 13412.37, 13219.91, -192.46, -0.82],
  "PERTAMINA DEX": [2766.43, 8000, 3003.39, 7763.04, 13310, 5546.96, 184.69],
  TOTAL: [53883.41, 64000, 48574.49, 69308.92, 74515.62, 5206.7, 10.72],
};

describe("Arus Minyak — reproduksi oracle EasyMax (IB 6 Agu 2026)", () => {
  const a = buildArusMinyak(IB_06AGU.map(row));

  it("ketujuh kolom tiap produk cocok EKSAK ke 2 desimal", () => {
    for (const r of a.rows) {
      const want = ORACLE_06AGU[r.nama];
      expect(want, `produk tak ada di oracle: ${r.nama}`).toBeDefined();
      expect([
        r2(r.awal), r2(r.penerimaan), r2(r.penjualan),
        r2(r.teori), r2(r.fisik), r2(r.losses), r2(r.pct),
      ]).toEqual(want);
    }
  });

  it("baris TOTAL = penjumlahan kolom, dan % TOTAL = ΣLosses/ΣPenjualan", () => {
    const t = a.total;
    expect([
      r2(t.awal), r2(t.penerimaan), r2(t.penjualan),
      r2(t.teori), r2(t.fisik), r2(t.losses), r2(t.pct),
    ]).toEqual(ORACLE_06AGU.TOTAL);

    // Kontrol: rata-rata persen ADALAH jawaban yang berbeda — kalau seseorang
    // mengganti rumus % TOTAL jadi rata-rata, tes di atas harus jatuh, bukan lolos.
    const rerata = a.rows.reduce((s, r) => s + (r.pct ?? 0), 0) / a.rows.length;
    expect(r2(rerata)).not.toEqual(ORACLE_06AGU.TOTAL![6]);
  });

  it("Losses ≡ DailyGlRow.gl — panel Omset & Arus Minyak tak bisa menyimpang", () => {
    const src = IB_06AGU.map(row);
    for (const [i, r] of a.rows.entries()) {
      // a.rows sudah tak urut sama dgn src; cari pasangannya by kode.
      const g = src.find((x) => x.ckdbbm === r.ckdbbm)!;
      expect(r.losses, `baris ${i}`).toBeCloseTo(g.gl!, 6);
    }
  });
});

describe("Arus Minyak — Penjualan bersih-tera (cabang yang diputuskan oracle)", () => {
  // 2 Agu 2026 Dexlite: SATU-SATUNYA sel ber-tera ≠ 0 di rentang oracle. Oracle
  // mencetak Penjualan 3.801,75 & Teori 15.874,04 → tera DIKURANGKAN.
  const g = row({
    ckdbbm: "BB-06", nama: "DEXLITE",
    fisik_prev: 11675.79, pen_do: 8000, sales_gross: 3802.39, tera: 0.64, fisik: 15824.79,
  });
  const a = buildArusMinyak([g]);

  it("Penjualan = jual kotor − tera, bukan kotor", () => {
    expect(r2(a.rows[0]!.penjualan)).toBe(3801.75);
    expect(r2(a.rows[0]!.penjualan)).not.toBe(3802.39); // cabang (a) yang gugur
  });

  it("Stock Teori & Losses ikut oracle (sel kedua yang bebas)", () => {
    expect(r2(a.rows[0]!.teori)).toBe(15874.04);
    expect(r2(a.rows[0]!.losses)).toBe(-49.25);
    expect(r2(a.rows[0]!.pct)).toBe(-1.3);
  });
});

describe("Arus Minyak — formula murni & tepi", () => {
  it("Stock Teori = Awal + Penerimaan − Penjualan; null menular dari Awal", () => {
    expect(stockTeori(100, 50, 30)).toBe(120);
    expect(stockTeori(null, 50, 30)).toBeNull();
  });

  it("Losses = Fisik − Teori; null bila salah satu null", () => {
    expect(losses(120, 100)).toBe(20);
    expect(losses(null, 100)).toBeNull();
    expect(losses(120, null)).toBeNull();
  });

  it("Penjualan = 0 dengan Losses = 0 → 0,00 (persis perilaku oracle baris Premium)", () => {
    expect(lossPct(0, 0)).toBe(0);
  });

  it("Penjualan = 0 dengan Losses ≠ 0 → null, BUKAN 0", () => {
    // 0,00 di sini akan terbaca "tidak ada losses" padahal ada; oracle tak pernah
    // memperlihatkan kasus ini sehingga tak ada perilaku yang wajib ditiru.
    expect(lossPct(-12.5, 0)).toBeNull();
    expect(lossPct(12.5, 0)).toBeNull();
  });

  it("Stock Fisik NULL → Teori tetap terhitung, Losses & % kosong, TOTAL tak menghitungnya", () => {
    const a = buildArusMinyak([
      row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 100, pen_do: 0, sales_gross: 40, tera: 0, fisik: null }),
      row({ ckdbbm: "BB-03", nama: "SOLAR", fisik_prev: 200, pen_do: 100, sales_gross: 50, tera: 0, fisik: 245 }),
    ]);
    const px = a.rows.find((r) => r.nama === "PERTAMAX")!;
    expect(px.teori).toBe(60);
    expect(px.fisik).toBeNull();
    expect(px.losses).toBeNull();
    expect(px.pct).toBeNull();
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true); // gl null → jangan mengaku final
    // TOTAL: kolom yang lengkap tetap dijumlah; baris tanpa fisik tak menyumbang.
    expect(a.total.fisik).toBe(245);
    expect(a.total.losses).toBe(-5);
    expect(a.total.teori).toBe(310);
  });

  it("Stock Awal NULL (tak ada anchor) → Teori/Losses/% kosong", () => {
    const a = buildArusMinyak([
      row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: null, pen_do: 8000, sales_gross: 100, tera: 0, fisik: 7900 }),
    ]);
    expect(a.rows[0]!.awal).toBeNull();
    expect(a.rows[0]!.teori).toBeNull();
    expect(a.rows[0]!.losses).toBeNull();
    expect(a.rows[0]!.pct).toBeNull();
    expect(a.incomplete).toBe(true);
  });

  it("tanpa baris → TOTAL nol, bukan NaN", () => {
    const a = buildArusMinyak([]);
    expect(a.rows).toHaveLength(0);
    expect(a.total.penjualan).toBe(0);
    expect(a.total.pct).toBe(0);
    expect(a.incomplete).toBe(false);
  });
});
