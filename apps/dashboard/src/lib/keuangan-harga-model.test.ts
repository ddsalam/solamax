import { describe, expect, it } from "vitest";
import type { PurchasePriceRow, SellPricePoint } from "./harga-beli";
import {
  barisHargaBeli,
  belumBerharga,
  berlakuSejakPada,
  hargaJualBerlaku,
  ringkasPenjaga,
} from "./keuangan-harga-model";

const PRODUK = [
  { productKey: "PTMX", nama: "Pertamax" },
  { productKey: "SLR", nama: "Solar" },
];

const beli = (o: Partial<PurchasePriceRow> = {}): PurchasePriceRow => ({
  productKey: "PTMX",
  effectiveFrom: "2026-01-01",
  price: 12_080.74,
  void: false,
  ...o,
});

/** Deret harga jual datar sepanjang `dates`. */
const jual = (dates: string[], price: number): SellPricePoint[] =>
  dates.map((date) => ({ date, price }));

const HARI_JAN = ["2026-01-01", "2026-01-05", "2026-01-10", "2026-01-15"];

describe("barisHargaBeli — kolom mengikuti mockup layar 3", () => {
  it("merangkai harga beli berlaku, harga jual, margin, dan tanggal berlaku", () => {
    const sell = new Map([["PTMX", jual(HARI_JAN, 12_650)]]);
    const [r] = barisHargaBeli([PRODUK[0]!], [beli()], sell, "2026-01-15");
    expect(r!.hargaBeli).toBeCloseTo(12_080.74, 2);
    expect(r!.hargaJual).toBe(12_650);
    expect(r!.margin).toBeCloseTo(569.26, 2);
    expect(r!.berlakuSejak).toBe("2026-01-01");
    expect(r!.p1Aktif).toBe(false);
  });

  it("🔴 harga beli belum diisi ⇒ null DAN margin null — bukan nol, bukan 'untung penuh'", () => {
    // Inilah cara COGS Solar Bakau jadi nol sejak 2026-03-04 selama
    // berbulan-bulan tanpa satu pun alarm: harga yang tak ada diperlakukan
    // sebagai nol, dan labanya terlihat besar.
    const sell = new Map([["SLR", jual(HARI_JAN, 6_800)]]);
    const [r] = barisHargaBeli([PRODUK[1]!], [], sell, "2026-01-15");
    expect(r!.hargaBeli).toBeNull();
    expect(r!.margin).toBeNull();
    expect(r!.margin).not.toBe(6_800);
    expect(belumBerharga([r!])).toHaveLength(1);
  });

  it("harga jual tak teramati ⇒ margin null, dan P1 TIDAK terpicu", () => {
    // Menuntut pengakuan atas "beli di atas jual" tanpa tahu harga jualnya
    // adalah cara tercepat mengubah centang jadi refleks.
    const [r] = barisHargaBeli([PRODUK[0]!], [beli({ price: 99_999 })], new Map(), "2026-01-15");
    expect(r!.hargaJual).toBeNull();
    expect(r!.margin).toBeNull();
    expect(r!.p1Aktif).toBe(false);
  });

  it("memakai harga yang BERLAKU pada tanggal itu, bukan yang terbaru mutlak", () => {
    const rows = [beli({ effectiveFrom: "2026-01-01", price: 12_000 }),
                  beli({ effectiveFrom: "2026-01-20", price: 13_000 })];
    const sell = new Map([["PTMX", jual(HARI_JAN, 12_650)]]);
    const [r] = barisHargaBeli([PRODUK[0]!], rows, sell, "2026-01-15");
    expect(r!.hargaBeli).toBe(12_000);
    expect(r!.berlakuSejak).toBe("2026-01-01");
  });

  it("baris void tak pernah dipakai", () => {
    const rows = [beli({ price: 12_000 }), beli({ effectiveFrom: "2026-01-10", price: 13_000, void: true })];
    const sell = new Map([["PTMX", jual(HARI_JAN, 12_650)]]);
    const [r] = barisHargaBeli([PRODUK[0]!], rows, sell, "2026-01-15");
    expect(r!.hargaBeli).toBe(12_000);
    expect(r!.berlakuSejak).toBe("2026-01-01");
  });

  it("P1 aktif saat harga beli di atas harga jual — margin negatif ikut terlihat", () => {
    const sell = new Map([["PTMX", jual(HARI_JAN, 12_650)]]);
    const [r] = barisHargaBeli([PRODUK[0]!], [beli({ price: 12_900 })], sell, "2026-01-15");
    expect(r!.p1Aktif).toBe(true);
    expect(r!.margin).toBeLessThan(0);
  });

  it("P2 menagih saat harga jual berubah dan harga beli tak menyusul", () => {
    const sell = new Map([
      [
        "PTMX",
        [
          { date: "2026-01-01", price: 12_650 },
          { date: "2026-01-02", price: 13_100 }, // berubah
          { date: "2026-01-15", price: 13_100 },
        ],
      ],
    ]);
    const [r] = barisHargaBeli([PRODUK[0]!], [beli()], sell, "2026-01-15");
    expect(r!.p2Due).toBe(true);
    expect(r!.p2StaleDays).toBe(13);
  });

  it("P2 diam bila harga jual tak pernah berubah — kontrol NEGATIF", () => {
    // Tanpa kasus ini, uji P2 di atas juga hijau bila fungsinya selalu true.
    const sell = new Map([["PTMX", jual(HARI_JAN, 12_650)]]);
    const [r] = barisHargaBeli([PRODUK[0]!], [beli()], sell, "2026-01-15");
    expect(r!.p2Due).toBe(false);
  });
});

describe("hargaJualBerlaku / berlakuSejakPada", () => {
  it("mengambil titik TERAKHIR yang ≤ tanggal, bukan yang terakhir dalam larik", () => {
    const points: SellPricePoint[] = [
      { date: "2026-01-20", price: 13_100 }, // sesudah asOf — harus diabaikan
      { date: "2026-01-05", price: 12_650 },
      { date: "2026-01-10", price: 12_800 },
    ];
    expect(hargaJualBerlaku(points, "2026-01-15")).toBe(12_800);
  });

  it("tak ada titik ≤ tanggal ⇒ null", () => {
    expect(hargaJualBerlaku([{ date: "2026-02-01", price: 1 }], "2026-01-15")).toBeNull();
    expect(hargaJualBerlaku(undefined, "2026-01-15")).toBeNull();
  });

  it("berlakuSejakPada mengabaikan baris void dan baris masa depan", () => {
    const rows = [
      beli({ effectiveFrom: "2026-01-01" }),
      beli({ effectiveFrom: "2026-01-12", void: true }),
      beli({ effectiveFrom: "2026-02-01" }),
    ];
    expect(berlakuSejakPada(rows, "PTMX", "2026-01-15")).toBe("2026-01-01");
  });
});

describe("ringkasPenjaga — bahan banner", () => {
  it("memisahkan P1, P2, dan yang belum berharga; membawa ambang P2 apa adanya", () => {
    const sell = new Map([
      ["PTMX", jual(HARI_JAN, 12_650)],
      [
        "SLR",
        [
          { date: "2026-01-01", price: 6_800 },
          { date: "2026-01-02", price: 7_000 },
          { date: "2026-01-15", price: 7_000 },
        ],
      ],
    ]);
    const rows = [beli({ price: 12_900 }), beli({ productKey: "SLR", price: 6_567.16 })];
    const r = ringkasPenjaga(barisHargaBeli(PRODUK, rows, sell, "2026-01-15"));
    expect(r.p1.map((b) => b.productKey)).toEqual(["PTMX"]);
    expect(r.p2.map((b) => b.productKey)).toEqual(["SLR"]);
    expect(r.kosong).toEqual([]);
    // Ambangnya dibawa dari harga-beli.ts, tidak diketik ulang di UI.
    expect(r.graceDays).toBe(7);
  });

  it("produk tanpa harga masuk `kosong`, dan TIDAK ikut dihitung sebagai P1/P2", () => {
    const r = ringkasPenjaga(barisHargaBeli(PRODUK, [beli()], new Map(), "2026-01-15"));
    expect(r.kosong.map((b) => b.productKey)).toEqual(["SLR"]);
    expect(r.p1).toEqual([]);
  });
});
