import { describe, expect, it } from "vitest";
import emas from "./__fixtures__/keuangan-t3-emas.json";
import { computeDay, computeProduct, type DayProductInput } from "./keuangan-mesin";

/**
 * UJI REGRESI KASUS EMAS — uji paling bernilai di K1.
 *
 * Fixture dibangkitkan dari `session-notes/2026-08-10-keuangan-k0-t3-prareg.md`,
 * pra-registrasi yang di-commit (`27c9055`) SEBELUM sel jawaban workbook dibuka.
 * Gross Profit-nya terbukti EKSAK 10/10 tanggal terhadap workbook Bakau
 * (`…-t3-hasil.md`).
 *
 * ⛔ Kalau uji ini meleset, itu **REGRESI** — berhenti dan laporkan.
 * JANGAN menyesuaikan ekspektasinya: angka di fixture bukan pendapat, ia satu-
 * satunya bukti bahwa mesin baru setara sheet lama. Kalau fixture perlu berubah,
 * yang harus berubah lebih dulu adalah segelnya — dan segel yang berubah bukan
 * lagi segel.
 *
 * Regenerasi: `node apps/dashboard/scripts/gen-keuangan-emas.mjs`
 */

/**
 * TOLERANSI — diturunkan, bukan dipilih supaya hijau.
 *
 * Segelnya dokumen **2 desimal**: setiap sel dicetak `,.2f`. Dua akibatnya:
 *
 * 1. Nilai tercetak meleset dari nilai sebenarnya paling banyak **setengah sen**.
 * 2. Kalau nilai sebenarnya jatuh **tepat di seri `.xx5`**, arah pembulatan
 *    cetak bisa terbalik oleh noise float sekecil 1e-11 pada masukannya —
 *    sehingga sel tercetak berjarak **satu sen penuh** dari hasil hitung ulang.
 *
 * Contoh nyata di fixture ini (2025-09-30 · BB-06): G/L −69 L × Rp 13.355,125 =
 * −921.503,625 **tepat**. Mesin menghitung itu; segel mencetak −921.503,63
 * karena G/L aslinya di Postgres −69,0000000000036 (noise pengurangan RESUME),
 * yang menggeser nilainya ke sisi lain dari seri. Mesinnya benar; yang berbeda
 * hanya *renderan*-nya.
 *
 * Karena itu batas per sel = **satu sen** (+ sedikit slack float64 pada
 * pembandingnya sendiri), dan batas total = akumulasi n sel.
 *
 * Batas ini tetap TAJAM terhadap regresi sungguhan: rumus yang salah menggeser
 * hasil dalam ribuan sampai jutaan rupiah, bukan dalam sen.
 */
const SEN = 0.0101;
/** Klaim owner yang sebenarnya diuji: Gross Profit eksak **sampai rupiah**. */
const SATU_RUPIAH = 1;

type Row = (typeof emas.dates)[number]["rows"][number];

const toInput = (r: Row): DayProductInput => ({
  productKey: r.productKey,
  volume: r.volume ?? 0,
  sellPrice: r.sellPrice,
  tera: r.tera ?? 0,
  stock: r.stock,
  lossesGain: r.lossesGain,
  buyPrice: r.buyPrice,
  sisaSo: r.sisaSo,
});

describe("fixture emas — utuh dan tidak disunting tangan", () => {
  it("berisi tepat 10 tanggal tersegel", () => {
    expect(emas.dates).toHaveLength(10);
    expect(emas.dates.map((d) => d.date)).toEqual([
      "2025-01-31", "2025-03-29", "2025-03-31", "2025-06-02", "2025-06-30",
      "2025-08-31", "2025-09-30", "2025-12-01", "2025-12-31", "2026-01-12",
    ]);
  });

  it("baris TOTAL tiap tanggal = jumlah baris produknya", () => {
    // Penjaga terhadap fixture yang disunting sebagian: kalau ada yang mengubah
    // satu sel supaya tes lain hijau, baris ini merah.
    for (const d of emas.dates) {
      for (const k of ["revenue", "cogs", "teraValue", "inventoryValue", "soValue", "lossesGainValue"] as const) {
        const jumlah = d.rows.reduce((s, r) => s + (r.expected[k] ?? 0), 0);
        // Jumlah sel yang MASING-MASING sudah dibulatkan vs total yang dicetak
        // dari nilai penuh ⇒ akumulasi pembulatan sampai n × satu sen.
        expect(Math.abs(jumlah - d.totals[k]), `${d.date} · ${k}`).toBeLessThanOrEqual(
          d.rows.length * SEN,
        );
      }
    }
  });

  it("Gross Profit tersegel = Revenue + TeraValue + COGS", () => {
    for (const d of emas.dates) {
      expect(
        Math.abs(d.totals.revenue + d.totals.teraValue + d.totals.cogs - d.grossProfit),
        d.date,
      ).toBeLessThanOrEqual(SEN);
    }
  });
});

describe("REGRESI: mesin mereproduksi 10 tanggal emas", () => {
  for (const d of emas.dates) {
    describe(d.date, () => {
      const { rows, totals } = computeDay(d.rows.map(toInput));

      it("setiap pos per produk cocok dengan segel", () => {
        for (const [i, exp] of d.rows.entries()) {
          const got = rows[i]!;
          expect(got.productKey).toBe(exp.productKey);
          for (const k of ["revenue", "cogs", "teraValue", "inventoryValue", "soValue", "lossesGainValue"] as const) {
            const want = exp.expected[k];
            if (want === null) continue; // HargaBeli/HargaJual kosong → tak dihitung
            expect(
              Math.abs((got[k] as number) - want),
              `${d.date} · ${exp.productKey} · ${k}`,
            ).toBeLessThanOrEqual(SEN);
          }
        }
      });

      it("total harian cocok dengan segel", () => {
        const tol = d.rows.length * SEN;
        for (const k of ["revenue", "cogs", "teraValue", "inventoryValue", "soValue", "lossesGainValue"] as const) {
          expect(Math.abs(totals[k] - d.totals[k]), `${d.date} · ${k}`).toBeLessThanOrEqual(tol);
        }
      });

      it("GROSS PROFIT eksak SAMPAI RUPIAH — pos yang terbukti 10/10 vs workbook", () => {
        // Klaim yang diuji persis klaim owner. Batas turunannya (3 pos × n sel ×
        // satu sen) jauh di bawah satu rupiah, jadi keduanya diuji sekaligus.
        const dlt = Math.abs(totals.grossProfit - d.grossProfit);
        expect(dlt, `${d.date} · turunan`).toBeLessThanOrEqual(3 * d.rows.length * SEN);
        expect(dlt, `${d.date} · klaim owner`).toBeLessThan(SATU_RUPIAH);
      });
    });
  }

  it("kesepuluh Gross Profit dibulatkan ke RUPIAH cocok persis", () => {
    // Pembulatan ke rupiah membuang seluruh derau pembulatan sen, sehingga ini
    // perbandingan KESAMAAN, bukan kedekatan — dan itu pernyataan terkuat yang
    // bisa dibuat terhadap segel 2 desimal.
    const bulat = (x: number) => Math.round(x);
    expect(
      emas.dates.map((d) => [d.date, bulat(computeDay(d.rows.map(toInput)).totals.grossProfit)]),
    ).toEqual(emas.dates.map((d) => [d.date, bulat(d.grossProfit)]));
  });
});

describe("computeProduct — aturan yang tidak boleh longgar", () => {
  const dasar: DayProductInput = {
    productKey: "BB-03",
    volume: 1_000,
    sellPrice: 6_800,
    tera: 0,
    stock: 5_000,
    lossesGain: 10,
    buyPrice: 6_567.155125,
    sisaSo: 0,
  };

  it("tera dipisah: mengurangi COGS dan memunculkan TeraValue negatif", () => {
    const r = computeProduct({ ...dasar, tera: 100 });
    expect(r.revenue).toBeCloseTo(6_800_000, 2); // volume KOTOR
    expect(r.teraValue).toBeCloseTo(-680_000, 2);
    expect(r.cogs).toBeCloseTo(-(1_000 - 100) * 6_567.155125, 6);
  });

  it("menetokan tera ke volume memberi GP SAMA — sebab itu ia mudah lolos", () => {
    // Bukti mengapa §1.1 harus ditegakkan lewat aturan, bukan lewat hasil: GP
    // tidak bisa membedakan keduanya. Yang membedakan hanya omzet kotor.
    const dipisah = computeProduct({ ...dasar, tera: 100 });
    const dinetokan = computeProduct({ ...dasar, volume: 900, tera: 0 });
    expect(dipisah.grossProfit).toBeCloseTo(dinetokan.grossProfit!, 6);
    expect(dipisah.revenue).not.toBeCloseTo(dinetokan.revenue!, 2);
  });

  it("HargaBeli null ⇒ COGS/Inventory/LossesGain null, BUKAN nol", () => {
    const r = computeProduct({ ...dasar, buyPrice: null });
    expect(r.cogs).toBeNull();
    expect(r.inventoryValue).toBeNull();
    expect(r.lossesGainValue).toBeNull();
    expect(r.grossProfit).toBeNull();
    expect(r.revenue).toBeCloseTo(6_800_000, 2); // sisi jual tetap terhitung
    expect(r.missing).toContain("buyPrice");
  });

  it("HargaJual null ⇒ Revenue/TeraValue/GP null, COGS tetap terhitung", () => {
    const r = computeProduct({ ...dasar, sellPrice: null });
    expect(r.revenue).toBeNull();
    expect(r.teraValue).toBeNull();
    expect(r.grossProfit).toBeNull();
    expect(r.cogs).not.toBeNull();
  });

  it("stok null ⇒ hanya InventoryValue yang null", () => {
    const r = computeProduct({ ...dasar, stock: null });
    expect(r.inventoryValue).toBeNull();
    expect(r.cogs).not.toBeNull();
    expect(r.missing).toEqual(["stock"]);
  });
});

describe("computeDay — total tidak boleh menelan yang tak terhitung", () => {
  const a: DayProductInput = {
    productKey: "BB-03", volume: 100, sellPrice: 6_800, tera: 0,
    stock: 1_000, lossesGain: 0, buyPrice: 6_500, sisaSo: 0,
  };
  const b: DayProductInput = { ...a, productKey: "BB-06", buyPrice: null };

  it("produk tanpa harga beli tercatat di `incomplete`", () => {
    const { totals } = computeDay([a, b]);
    expect(totals.incomplete).toEqual(["BB-06"]);
  });

  it("Revenue-nya tetap ikut, COGS-nya tidak — dan itu memang tak seimbang", () => {
    // Kasus Solar Bakau: sisi jual jalan, sisi pokok hilang. Total TIDAK boleh
    // menyembunyikannya dengan memperlakukan COGS null sebagai 0 tanpa jejak.
    const { totals } = computeDay([a, b]);
    expect(totals.revenue).toBeCloseTo(2 * 100 * 6_800, 2);
    expect(totals.cogs).toBeCloseTo(-100 * 6_500, 2);
    expect(totals.incomplete).not.toHaveLength(0);
  });

  it("semua lengkap ⇒ incomplete kosong", () => {
    expect(computeDay([a]).totals.incomplete).toEqual([]);
  });
});
