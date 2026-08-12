/**
 * Mesin hitung Keuangan Harian — rantai nilai per hari per produk. MURNI
 * (tanpa I/O), supaya bisa diuji terhadap kasus emas tanpa DB.
 *
 * Definisi diambil dari [`KEUANGAN-HARIAN.md`](../../KEUANGAN-HARIAN.md) §1.1,
 * yang sendiri diturunkan dari rumus workbook Bakau dan **sudah terbukti**:
 * Gross Profit reproduksi EKSAK 10/10 tanggal (T3). Jangan mengubah rumus di
 * sini tanpa mengubah §1.1 lebih dulu — dan kalau §1.1 berubah, 10 kasus emas
 * harus dihitung ulang, bukan ekspektasinya yang disesuaikan.
 *
 *   Revenue          =  Volume × HargaJual
 *   TeraValue        = −Tera   × HargaJual
 *   COGS             = −(Volume − Tera) × HargaBeli
 *   GrossProfit      =  Revenue + TeraValue + COGS
 *   LossesGainValue  =  LossesGain × HargaBeli
 *   InventoryValue   =  StockAkhirHari × HargaBeli
 *
 * Dua hal yang mudah salah:
 *
 * 1. **`Tera` dipisah, tidak dinetokan ke volume** (§1.1). Workbook Bakau
 *    mengurangi tera dari volume dan mengosongkan sheet `Tera`; Gross Profit-nya
 *    kebetulan tetap sama (Revenue turun `tera×jual`, TeraValue naik dari
 *    `−tera×jual` ke 0) tetapi **omzet kotornya salah**. Ikuti SolaMax.
 * 2. **`HargaBeli` tidak ada ⇒ turunannya `null`, BUKAN 0.** COGS nol berarti
 *    "barang ini tidak berharga pokok" — pernyataan yang salah dan mahal
 *    (Solar Bakau sejak 2026-03-04). Yang benar: "belum bisa dihitung".
 *
 * ⛔ `SOValue` sengaja TIDAK ada di sini. Ia menunggu penandaan `so_macet` yang
 * dipelihara Finance (B6, §10.6) — memasukkannya sekarang berarti menebak.
 */

/** Masukan satu produk pada satu hari. `null` = tidak diketahui, bukan nol. */
export interface DayProductInput {
  productKey: string;
  /** Liter terjual (kotor, BELUM dikurangi tera). */
  volume: number;
  /** Rp/L dari EasyMax. `null` = tak diketahui. */
  sellPrice: number | null;
  /** Liter tera (ledger `terra_resmi`). */
  tera: number;
  /** Stok fisik penutup (Liter). `null` = belum ada opname penutup. */
  stock: number | null;
  /** Gain/Losses Liter (metode RESUME). `null` = tak terhitung. */
  lossesGain: number | null;
  /** Rp/L, input manual berlaku-sejak. `null` = BELUM DIISI. */
  buyPrice: number | null;
}

/** Hasil satu produk. Setiap `null` berarti "tak bisa dihitung", bukan nol. */
export interface DayProductValue {
  productKey: string;
  revenue: number | null;
  teraValue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  lossesGainValue: number | null;
  inventoryValue: number | null;
  /** Alasan sebuah nilai `null` — supaya layar/laporan bisa menyebutnya. */
  missing: ReadonlyArray<"sellPrice" | "buyPrice" | "stock" | "lossesGain">;
}

/** Total satu hari. `incomplete` = ada produk yang tak bisa dihitung. */
export interface DayTotals {
  revenue: number;
  teraValue: number;
  cogs: number;
  grossProfit: number;
  lossesGainValue: number;
  inventoryValue: number;
  /** Produk yang menyumbang `null` ke salah satu pos di atas. */
  incomplete: ReadonlyArray<string>;
}

/** Hitung satu produk pada satu hari. */
export function computeProduct(input: DayProductInput): DayProductValue {
  const { productKey, volume, sellPrice, tera, stock, lossesGain, buyPrice } = input;
  const missing: DayProductValue["missing"][number][] = [];
  if (sellPrice === null) missing.push("sellPrice");
  if (buyPrice === null) missing.push("buyPrice");
  if (stock === null) missing.push("stock");
  if (lossesGain === null) missing.push("lossesGain");

  const revenue = sellPrice === null ? null : volume * sellPrice;
  const teraValue = sellPrice === null ? null : -tera * sellPrice;
  const cogs = buyPrice === null ? null : -(volume - tera) * buyPrice;
  const grossProfit =
    revenue === null || teraValue === null || cogs === null ? null : revenue + teraValue + cogs;
  const lossesGainValue = buyPrice === null || lossesGain === null ? null : lossesGain * buyPrice;
  const inventoryValue = buyPrice === null || stock === null ? null : stock * buyPrice;

  return { productKey, revenue, teraValue, cogs, grossProfit, lossesGainValue, inventoryValue, missing };
}

/**
 * Total satu hari. Nilai `null` **dilewati dalam penjumlahan** tetapi produknya
 * dicatat di `incomplete` — jumlah yang diam-diam memperlakukan `null` sebagai
 * nol adalah cara neraca Bakau bisa terlihat sehat sambil salah.
 */
export function computeDay(inputs: readonly DayProductInput[]): {
  rows: DayProductValue[];
  totals: DayTotals;
} {
  const rows = inputs.map(computeProduct);
  const incomplete = new Set<string>();
  const totals: DayTotals = {
    revenue: 0,
    teraValue: 0,
    cogs: 0,
    grossProfit: 0,
    lossesGainValue: 0,
    inventoryValue: 0,
    incomplete: [],
  };

  for (const r of rows) {
    for (const k of ["revenue", "teraValue", "cogs", "lossesGainValue", "inventoryValue"] as const) {
      const v = r[k];
      if (v === null) incomplete.add(r.productKey);
      else totals[k] += v;
    }
  }
  // GP total diturunkan dari total komponennya, BUKAN dijumlah dari GP per
  // produk: produk yang GP-nya null tetap boleh menyumbang Revenue-nya ke total,
  // dan menjumlah GP per-produk akan diam-diam membuang sumbangan itu.
  totals.grossProfit = totals.revenue + totals.teraValue + totals.cogs;
  totals.incomplete = [...incomplete].sort();
  return { rows, totals };
}
