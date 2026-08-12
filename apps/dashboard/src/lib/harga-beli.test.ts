import { describe, expect, it } from "vitest";
import {
  effectiveBuyPrice,
  evaluateP1,
  evaluateP2,
  P2_GRACE_DAYS,
  type PurchasePriceRow,
  type SellPricePoint,
} from "./harga-beli";

/**
 * Baris harga beli Bakau yang NYATA (KEUANGAN-HARIAN §10, bukti T3): harga beli
 * membeku sejak Januari 2026 sementara harga jual terus bergerak sampai Juli.
 * Dipakai sebagai kasus dunia-nyata, bukan angka karangan.
 */
const BAKAU: PurchasePriceRow[] = [
  { productKey: "BB-04", effectiveFrom: "2025-06-01", price: 13_405.39, void: false },
  { productKey: "BB-04", effectiveFrom: "2026-01-19", price: 13_054.6525, void: false },
  { productKey: "BB-03", effectiveFrom: "2024-12-01", price: 6_567.155125, void: false },
];

describe("effectiveBuyPrice — BERLAKU-SEJAK, bukan deret harian", () => {
  it("memakai baris dengan effective_from TERBESAR yang ≤ tanggal", () => {
    expect(effectiveBuyPrice(BAKAU, "BB-04", "2026-01-18")).toBe(13_405.39);
    expect(effectiveBuyPrice(BAKAU, "BB-04", "2026-01-19")).toBe(13_054.6525);
    expect(effectiveBuyPrice(BAKAU, "BB-04", "2026-07-27")).toBe(13_054.6525);
  });

  it("berlaku SEJAK tanggalnya — hari itu sendiri sudah memakai harga baru", () => {
    // Kontrol arah: kalau batasnya keliru jadi `<`, baris ini merah.
    expect(effectiveBuyPrice(BAKAU, "BB-04", "2026-01-19")).not.toBe(13_405.39);
  });

  it("null (BUKAN nol) bila belum pernah diisi sampai tanggal itu", () => {
    expect(effectiveBuyPrice(BAKAU, "BB-04", "2025-05-31")).toBeNull();
    expect(effectiveBuyPrice(BAKAU, "BB-99", "2026-01-19")).toBeNull();
  });

  it("nol dan null TIDAK boleh tertukar — inilah cacat Solar Bakau 2026-03-04", () => {
    const kosong = effectiveBuyPrice(BAKAU, "BB-06", "2026-04-01");
    expect(kosong).toBeNull();
    // Kalau suatu saat ini jadi 0, COGS & Inventory produk itu diam-diam jadi 0.
    expect(kosong).not.toBe(0);
  });

  it("baris void diabaikan, dan harga mundur ke baris aktif sebelumnya", () => {
    const rows: PurchasePriceRow[] = [
      ...BAKAU,
      { productKey: "BB-04", effectiveFrom: "2026-02-01", price: 99_999, void: true },
    ];
    expect(effectiveBuyPrice(rows, "BB-04", "2026-03-01")).toBe(13_054.6525);
  });

  it("urutan masukan tidak memengaruhi hasil", () => {
    const dibalik = [...BAKAU].reverse();
    expect(effectiveBuyPrice(dibalik, "BB-04", "2026-07-01")).toBe(
      effectiveBuyPrice(BAKAU, "BB-04", "2026-07-01"),
    );
  });
});

describe("evaluateP1 — PERINGATAN wajib-diakui, BUKAN reject", () => {
  it("tidak terpicu saat beli ≤ jual", () => {
    expect(evaluateP1({ buyPrice: 6_567.15, sellPrice: 6_800, acknowledged: false, reason: null }))
      .toEqual({ triggered: false });
  });

  it("sama persis TIDAK memicu (batasnya '>' bukan '>=')", () => {
    expect(evaluateP1({ buyPrice: 10_000, sellPrice: 10_000, acknowledged: false, reason: null }))
      .toEqual({ triggered: false });
  });

  it("kasus nyata Bakau 2025-01-31 Pertamax Turbo: beli 14.257,18 > jual 14.000", () => {
    const r = evaluateP1({
      buyPrice: 14_257.182875,
      sellPrice: 14_000,
      acknowledged: false,
      reason: null,
    });
    expect(r.triggered).toBe(true);
    if (!r.triggered) return;
    expect(r.excessRp).toBeCloseTo(257.182875, 6);
  });

  it("terpicu + belum diakui ⇒ TIDAK boleh disimpan, dan menyebut apa yang kurang", () => {
    const r = evaluateP1({ buyPrice: 15_000, sellPrice: 14_000, acknowledged: false, reason: null });
    expect(r.triggered).toBe(true);
    if (!r.triggered) return;
    expect(r.canSave).toBe(false);
    expect([...r.missing].sort()).toEqual(["acknowledgement", "reason"]);
  });

  it("dicentang tapi alasan kosong/spasi ⇒ tetap TIDAK boleh disimpan", () => {
    for (const reason of [null, "", "   ", "\t\n"]) {
      const r = evaluateP1({ buyPrice: 15_000, sellPrice: 14_000, acknowledged: true, reason });
      expect(r.triggered).toBe(true);
      if (!r.triggered) continue;
      expect(r.canSave).toBe(false);
      expect(r.missing).toEqual(["reason"]);
    }
  });

  it("beralasan tapi tak dicentang ⇒ tetap TIDAK boleh disimpan", () => {
    const r = evaluateP1({
      buyPrice: 15_000,
      sellPrice: 14_000,
      acknowledged: false,
      reason: "transisi harga Pertamina Dex",
    });
    expect(r.triggered).toBe(true);
    if (!r.triggered) return;
    expect(r.canSave).toBe(false);
    expect(r.missing).toEqual(["acknowledgement"]);
  });

  it("PENGAKUAN LENGKAP ⇒ BOLEH disimpan meski nilainya tetap 'beli > jual'", () => {
    // Inti keputusan owner: yang menghalangi adalah pengakuan, bukan nilainya.
    // Kalau baris ini pernah merah, P1 telah diam-diam berubah jadi `reject`.
    const r = evaluateP1({
      buyPrice: 15_000,
      sellPrice: 14_000,
      acknowledged: true,
      reason: "harga tebus naik lebih dulu, jual menyusul pekan depan",
    });
    expect(r.triggered).toBe(true);
    if (!r.triggered) return;
    expect(r.canSave).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.excessRp).toBe(1_000);
  });

  it("harga jual tak diketahui ⇒ tidak terpicu (jangan menuntut pengakuan tanpa dasar)", () => {
    expect(evaluateP1({ buyPrice: 99_999, sellPrice: null, acknowledged: false, reason: null }))
      .toEqual({ triggered: false });
  });
});

describe("evaluateP2 — tagih bila jual berubah & beli tak diperbarui", () => {
  const jual = (pairs: [string, number][]): SellPricePoint[] =>
    pairs.map(([date, price]) => ({ date, price }));

  const HIST = jual([
    ["2026-01-01", 13_700],
    ["2026-01-19", 13_700],
    ["2026-06-10", 20_350], // harga jual berubah di sini
    ["2026-07-01", 21_200], // dan berubah lagi
  ]);

  it("belum lewat masa tenggang ⇒ belum ditagih", () => {
    const r = evaluateP2(BAKAU, "BB-04", HIST, "2026-07-07"); // 6 hari
    expect(r.staleDays).toBe(6);
    expect(r.due).toBe(false);
  });

  it("tepat di hari ke-7 ⇒ SUDAH ditagih (batas inklusif)", () => {
    const r = evaluateP2(BAKAU, "BB-04", HIST, "2026-07-08");
    expect(r.staleDays).toBe(P2_GRACE_DAYS);
    expect(r.due).toBe(true);
    expect(r.lastSellChange).toBe("2026-07-01");
    expect(r.lastBuyUpdate).toBe("2026-01-19");
  });

  it("kasus nyata Bakau: beli beku sejak Jan, jual bergerak sampai Jul ⇒ ditagih", () => {
    expect(evaluateP2(BAKAU, "BB-04", HIST, "2026-07-27").due).toBe(true);
  });

  it("harga beli diperbarui SETELAH perubahan jual ⇒ tidak ditagih lagi", () => {
    const rows: PurchasePriceRow[] = [
      ...BAKAU,
      { productKey: "BB-04", effectiveFrom: "2026-07-02", price: 15_000, void: false },
    ];
    const r = evaluateP2(rows, "BB-04", HIST, "2026-07-27");
    expect(r.lastBuyUpdate).toBe("2026-07-02");
    expect(r.due).toBe(false);
  });

  it("pembaruan beli yang di-VOID tidak menghentikan tagihan", () => {
    const rows: PurchasePriceRow[] = [
      ...BAKAU,
      { productKey: "BB-04", effectiveFrom: "2026-07-02", price: 15_000, void: true },
    ];
    expect(evaluateP2(rows, "BB-04", HIST, "2026-07-27").due).toBe(true);
  });

  it("harga jual tak pernah berubah ⇒ tidak ada yang ditagih", () => {
    const datar = jual([
      ["2026-01-01", 10_000],
      ["2026-05-01", 10_000],
      ["2026-07-01", 10_000],
    ]);
    const r = evaluateP2(BAKAU, "BB-04", datar, "2026-07-27");
    expect(r.due).toBe(false);
    expect(r.lastSellChange).toBeNull();
  });

  it("BELUM PERNAH ada harga beli sama sekali ⇒ ditagih (cacat Solar Bakau)", () => {
    const r = evaluateP2([], "BB-06", HIST, "2026-07-27");
    expect(r.lastBuyUpdate).toBeNull();
    expect(r.due).toBe(true);
  });

  it("hanya melihat ke belakang dari asOf — perubahan di masa depan diabaikan", () => {
    const r = evaluateP2(BAKAU, "BB-04", HIST, "2026-06-01");
    expect(r.lastSellChange).toBeNull(); // 2026-06-10 belum terjadi
    expect(r.due).toBe(false);
  });

  it("riwayat tak berurut memberi hasil sama", () => {
    const acak = [...HIST].reverse();
    expect(evaluateP2(BAKAU, "BB-04", acak, "2026-07-27")).toEqual(
      evaluateP2(BAKAU, "BB-04", HIST, "2026-07-27"),
    );
  });

  it("harga kembali ke nilai lama tetap dihitung sebagai perubahan", () => {
    const bolak = jual([
      ["2026-06-01", 10_000],
      ["2026-06-02", 11_000],
      ["2026-06-03", 10_000],
    ]);
    const r = evaluateP2(BAKAU, "BB-04", bolak, "2026-06-20");
    expect(r.lastSellChange).toBe("2026-06-03");
    expect(r.due).toBe(true);
  });
});
