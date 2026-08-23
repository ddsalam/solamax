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
 * `SOValue` = `SisaSO_AKTIF × HargaBeli`, dengan **AKTIF = `sisa − sisa_macet`**
 * (B6, §10.6). Yang masuk ke sini SUDAH neto: pengurangan `sisa_macet` terjadi
 * di hulu (kueri), sebab "macet" adalah penandaan MANUAL Finance — bukan aturan
 * yang boleh dihitung ulang di sini. Lihat {@link sisaSoAktif}.
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
  /**
   * Sisa SO **aktif** (Liter) — sudah dikurangi `sisa_macet`. `null` = tak
   * terhitung. Lihat {@link sisaSoAktif}: jangan mengurangi macet di sini.
   */
  sisaSo: number | null;
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
  soValue: number | null;
  /** Alasan sebuah nilai `null` — supaya layar/laporan bisa menyebutnya. */
  missing: ReadonlyArray<"sellPrice" | "buyPrice" | "stock" | "lossesGain" | "sisaSo">;
}

/** Total satu hari. `incomplete` = ada produk yang tak bisa dihitung. */
export interface DayTotals {
  revenue: number;
  teraValue: number;
  cogs: number;
  /** `null` = ada produk tanpa harga beli hari itu (§10.23). JANGAN dinolkan. */
  grossProfit: number | null;
  lossesGainValue: number;
  inventoryValue: number;
  soValue: number;
  /** Produk yang menyumbang `null` ke salah satu pos di atas. */
  incomplete: ReadonlyArray<string>;
  /**
   * Produk yang MERUSAK laba kotor: menyumbang omzet tetapi beban pokoknya tak
   * terhitung (§10.23). Sub-himpunan `incomplete`, dan **ini yang dinamai** saat
   * GP `null` — pembaca perlu tahu produk mana yang harus diisi harganya.
   */
  perusakGp: ReadonlyArray<string>;
}

/** Hitung satu produk pada satu hari. */
export function computeProduct(input: DayProductInput): DayProductValue {
  const { productKey, volume, sellPrice, tera, stock, lossesGain, buyPrice, sisaSo } = input;
  const missing: DayProductValue["missing"][number][] = [];
  if (sellPrice === null) missing.push("sellPrice");
  if (buyPrice === null) missing.push("buyPrice");
  if (stock === null) missing.push("stock");
  if (lossesGain === null) missing.push("lossesGain");
  if (sisaSo === null) missing.push("sisaSo");

  const revenue = sellPrice === null ? null : volume * sellPrice;
  const teraValue = sellPrice === null ? null : -tera * sellPrice;
  const cogs = buyPrice === null ? null : -(volume - tera) * buyPrice;
  const grossProfit =
    revenue === null || teraValue === null || cogs === null ? null : revenue + teraValue + cogs;
  const lossesGainValue = buyPrice === null || lossesGain === null ? null : lossesGain * buyPrice;
  const inventoryValue = buyPrice === null || stock === null ? null : stock * buyPrice;
  const soValue = buyPrice === null || sisaSo === null ? null : sisaSo * buyPrice;

  return {
    productKey, revenue, teraValue, cogs, grossProfit,
    lossesGainValue, inventoryValue, soValue, missing,
  };
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
    soValue: 0,
    incomplete: [],
    perusakGp: [],
  };

  // Produk yang MERUSAK laba kotor — himpunan yang lebih SEMPIT dari
  // `incomplete`, dan perbedaannya penting (lihat catatan di bawah).
  const perusakGp = new Set<string>();
  for (const r of rows) {
    for (const k of ["revenue", "teraValue", "cogs", "lossesGainValue", "inventoryValue", "soValue"] as const) {
      const v = r[k];
      if (v === null) incomplete.add(r.productKey);
      else totals[k] += v;
    }
    // ⛔ Yang membuat GP lebih saji BUKAN "ada yang kosong", melainkan
    //    **omzetnya ikut sementara beban pokoknya tidak**. Produk yang tak
    //    menyumbang omzet tak bisa merusak GP betapapun kosongnya.
    if ((r.cogs === null || r.teraValue === null) && (r.revenue ?? 0) !== 0) {
      perusakGp.add(r.productKey);
    }
  }
  // GP total diturunkan dari total komponennya, BUKAN dijumlah dari GP per
  // produk: produk yang GP-nya null tetap boleh menyumbang Revenue-nya ke total,
  // dan menjumlah GP per-produk akan diam-diam membuang sumbangan itu.
  //
  // ⛔ BATAS KEPUTUSAN DI ATAS (22 Agu 2026, §10.23) — kalimatnya sengaja
  //    DIPERTAHANKAN, bukan dihapus: alasannya masih benar untuk OMZET, dan
  //    keputusan yang dihapus tanpa jejak akan diambil ulang orang berikutnya.
  //
  //    Yang TIDAK benar adalah lanjutannya. Bila sebuah produk tak punya harga
  //    beli, omzetnya ikut sementara COGS-nya tidak — dan `revenue + tera +
  //    cogs` karenanya LEBIH SAJI. Terukur: Bakau 2026-07-15 menunjukkan GP
  //    Rp 174.101.616, persis sama dengan omzetnya, sebab keenam produknya tak
  //    berharga. Angka yang lebih saji tetapi tampak normal lebih berbahaya
  //    daripada angka yang hilang.
  //
  //    Maka: omzet TETAP dijumlahkan untuk semua produk (kalimat lama berlaku),
  //    tetapi GROSS PROFIT menolak dihitung selama himpunannya belum lengkap.
  //    ⚠️ Syaratnya `perusakGp`, BUKAN `incomplete`. Versi pertama memakai
  //    `incomplete` dan **menghancurkan bukti tanggal emas**: kesepuluh tanggal
  //    punya BB-01 Pertalite Khusus tanpa harga beli — tetapi omzetnya NOL,
  //    jadi ia tak pernah merusak GP, dan GP-nya memang terbukti eksak 10/10.
  //    Harness tanggal emas yang menangkapnya; aturan yang terlalu luas
  //    membuang bukti yang sah bersama angka yang salah.
  totals.grossProfit =
    perusakGp.size > 0 ? null : totals.revenue + totals.teraValue + totals.cogs;
  totals.perusakGp = [...perusakGp].sort();
  totals.incomplete = [...incomplete].sort();
  return { rows, totals };
}

/**
 * Sisa SO **aktif** = `sisa − sisa_macet`, tidak pernah negatif.
 *
 * ⛔ "Macet" adalah **penandaan MANUAL Finance** (B6, §10.6). Ambang hari hanya
 * MENGUSULKAN kandidat, tidak memutuskan — karena itu fungsi ini menerima jumlah
 * macet yang **sudah ditandai**, dan tidak punya parameter ambang apa pun.
 *
 * Kalau ia punya ambang, ambang itu akan menghapus SO yang masih ditagih dan
 * menghidupkan kembali SO mati begitu angkanya digeser — tanpa pemilik, tanpa
 * tanggal, tanpa cara membatalkannya.
 */
export function sisaSoAktif(sisa: number, macet: number): number {
  return Math.max(0, sisa - macet);
}
