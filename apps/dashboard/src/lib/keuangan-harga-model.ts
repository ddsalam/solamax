import {
  effectiveBuyPrice,
  evaluateP2,
  P2_GRACE_DAYS,
  type PurchasePriceRow,
  type SellPricePoint,
} from "./harga-beli";

/**
 * Model tampilan blok 1 Layar 3 — "Harga beli per produk".
 *
 * MURNI (tanpa I/O) supaya bisa diuji langsung. Aturannya sendiri tidak tinggal
 * di sini: `harga-beli.ts` yang memutuskan apa itu harga berlaku dan kapan P2
 * menagih. Berkas ini hanya MERANGKAI hasilnya jadi baris tabel.
 *
 * Kolom mengikuti mockup layar 3 apa adanya:
 *   Produk · Harga beli · Harga jual · Margin / liter · Berlaku sejak
 */

export interface BarisHargaBeli {
  productKey: string;
  nama: string;
  /** `null` = BELUM DIISI. Bukan nol — lihat harga-beli.ts §2. */
  hargaBeli: number | null;
  /** Harga jual EasyMax terakhir ≤ tanggal. `null` = tak ada penjualan teramati. */
  hargaJual: number | null;
  /** `hargaJual − hargaBeli`; `null` bila salah satunya tak ada. */
  margin: number | null;
  /** `effectiveFrom` baris harga beli yang sedang berlaku; `null` bila belum ada. */
  berlakuSejak: string | null;
  /** P1 sedang berlaku: harga beli yang aktif ADA DI ATAS harga jual. */
  p1Aktif: boolean;
  /** P2 menagih: harga jual berubah, harga beli tak ikut diperbarui. */
  p2Due: boolean;
  /** Umur hari sejak harga jual terakhir berubah; `null` bila tak ada perubahan. */
  p2StaleDays: number | null;
}

/** Harga jual terakhir yang teramati pada/ sebelum `asOf`. */
export function hargaJualBerlaku(
  points: readonly SellPricePoint[] | undefined,
  asOf: string,
): number | null {
  let best: SellPricePoint | null = null;
  for (const p of points ?? []) {
    if (p.date > asOf) continue;
    if (best === null || p.date > best.date) best = p;
  }
  return best?.price ?? null;
}

/** `effectiveFrom` harga beli yang BERLAKU pada `asOf` (bukan yang terbaru mutlak). */
export function berlakuSejakPada(
  rows: readonly PurchasePriceRow[],
  productKey: string,
  asOf: string,
): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (r.void || r.productKey !== productKey || r.effectiveFrom > asOf) continue;
    if (best === null || r.effectiveFrom > best) best = r.effectiveFrom;
  }
  return best;
}

export function barisHargaBeli(
  produk: readonly { productKey: string; nama: string }[],
  buyRows: readonly PurchasePriceRow[],
  sellHistory: ReadonlyMap<string, SellPricePoint[]>,
  asOf: string,
): BarisHargaBeli[] {
  return produk.map((p) => {
    const hargaBeli = effectiveBuyPrice(buyRows, p.productKey, asOf);
    const hargaJual = hargaJualBerlaku(sellHistory.get(p.productKey), asOf);
    const p2 = evaluateP2(buyRows, p.productKey, sellHistory.get(p.productKey) ?? [], asOf);
    return {
      productKey: p.productKey,
      nama: p.nama,
      hargaBeli,
      hargaJual,
      // Margin hanya ada bila KEDUANYA ada. `?? 0` di salah satu sisi akan
      // memunculkan margin yang terlihat masuk akal dari harga yang tak pernah
      // diisi — persis cara COGS Solar Bakau jadi nol tanpa alarm.
      margin: hargaBeli === null || hargaJual === null ? null : hargaJual - hargaBeli,
      berlakuSejak: berlakuSejakPada(buyRows, p.productKey, asOf),
      p1Aktif: hargaBeli !== null && hargaJual !== null && hargaBeli > hargaJual,
      p2Due: p2.due,
      p2StaleDays: p2.staleDays,
    };
  });
}

/** Produk yang belum punya harga beli sama sekali pada tanggal itu. */
export function belumBerharga(baris: readonly BarisHargaBeli[]): BarisHargaBeli[] {
  return baris.filter((b) => b.hargaBeli === null);
}

/** Ringkasan untuk banner penjaga — dipisah supaya bisa diuji tanpa merender. */
export interface RingkasPenjaga {
  p1: BarisHargaBeli[];
  p2: BarisHargaBeli[];
  kosong: BarisHargaBeli[];
  graceDays: number;
}

export function ringkasPenjaga(baris: readonly BarisHargaBeli[]): RingkasPenjaga {
  return {
    p1: baris.filter((b) => b.p1Aktif),
    p2: baris.filter((b) => b.p2Due),
    kosong: belumBerharga(baris),
    graceDays: P2_GRACE_DAYS,
  };
}
