/**
 * Harga beli BBM — aturan MURNI (tanpa I/O). Sumber kebenaran keputusannya:
 * [`KEUANGAN-HARIAN.md`](../../KEUANGAN-HARIAN.md) §4.1 (bentuk data + dua
 * penjaga) dan §10 (jawaban owner B1–B8). Berkas ini menegakkan, tidak memutuskan.
 *
 * Tiga hal yang mudah dirusak tanpa sadar:
 *
 * 1. **Harga beli BERLAKU-SEJAK, bukan deret harian.** Harga pada tanggal D =
 *    baris non-void dengan `effectiveFrom` TERBESAR yang ≤ D. Tidak ada
 *    "berlaku-sampai" — ia tersirat dari baris berikutnya, jadi tak ada dua
 *    tanggal yang bisa berselisih.
 * 2. **Tidak ada harga = `null`, BUKAN nol.** Nol adalah harga yang sah secara
 *    tipe tetapi mustahil secara ekonomi, dan ia menular diam-diam: di Bakau
 *    `HargaBeli` Solar kosong sejak 2026-03-04 membuat COGS Solar = 0 dan
 *    Inventory Solar = 0 tanpa satu pun alarm berbunyi. Pemanggil WAJIB
 *    menangani `null` sebagai "belum diisi", bukan meng-`?? 0`-kannya.
 * 3. **P1 adalah PERINGATAN WAJIB-DIAKUI, bukan `reject`.** Yang menghalangi
 *    penyimpanan adalah PENGAKUAN, bukan nilainya. Diuji ke 2.048 hari sejarah
 *    Bakau: 436 sel / 336 hari (16,4 %) akan terpicu, hampir semua Pertamina Dex
 *    & Pertamax Turbo — pola yang secara operasional SAH pada masa transisi
 *    harga. `reject` keras akan memblokir pola itu 336 kali.
 */

/** Satu baris harga beli. `void` = dibatalkan; jangan disaring di pemanggil. */
export interface PurchasePriceRow {
  productKey: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  price: number;
  void: boolean;
}

/** Harga jual (EasyMax) pada satu tanggal. Tidak pernah diketik manusia. */
export interface SellPricePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  price: number;
}

/**
 * Harga beli yang BERLAKU pada `date` untuk `productKey`.
 * `null` = belum pernah diisi sampai tanggal itu — **bukan** nol (lihat §2 di
 * kepala berkas).
 */
export function effectiveBuyPrice(
  rows: readonly PurchasePriceRow[],
  productKey: string,
  date: string,
): number | null {
  let best: PurchasePriceRow | null = null;
  for (const r of rows) {
    if (r.void || r.productKey !== productKey) continue;
    if (r.effectiveFrom > date) continue;
    // ISO `YYYY-MM-DD` berurut secara leksikografis — perbandingan string aman
    // dan menghindari zona waktu sama sekali (tanggal bisnis, bukan instan).
    if (best === null || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best === null ? null : best.price;
}

// ---------------------------------------------------------------------------
// P1 — harga beli > harga jual  ⇒  PERINGATAN WAJIB-DIAKUI
// ---------------------------------------------------------------------------

export interface P1Input {
  buyPrice: number;
  /** Harga jual EasyMax pada tanggal berlaku. `null` = tak diketahui. */
  sellPrice: number | null;
  /** Kotak "saya sadar harga beli di atas harga jual" tercentang. */
  acknowledged: boolean;
  /** Alasan tertulis. Spasi saja dihitung kosong. */
  reason: string | null;
}

export type P1Result =
  | { triggered: false }
  | {
      triggered: true;
      /** Boleh disimpan? true hanya bila pengakuan DAN alasan lengkap. */
      canSave: boolean;
      /** Apa yang kurang — untuk pesan yang menyebut perbaikannya. */
      missing: ReadonlyArray<"acknowledgement" | "reason">;
      /** `buyPrice − sellPrice`, selalu > 0 saat terpicu. */
      excessRp: number;
    };

/**
 * Evaluasi P1. **Tidak pernah menolak karena nilainya** — hanya karena
 * pengakuannya belum lengkap.
 *
 * `sellPrice === null` ⇒ TIDAK terpicu: kita tak bisa mengklaim "beli di atas
 * jual" tanpa tahu harga jualnya. Memicu di sini akan menuntut pengakuan atas
 * sesuatu yang belum tentu benar, dan pengakuan yang dituntut tanpa dasar
 * adalah cara tercepat mengubah centang jadi refleks.
 */
export function evaluateP1(input: P1Input): P1Result {
  const { buyPrice, sellPrice, acknowledged, reason } = input;
  if (sellPrice === null || !(buyPrice > sellPrice)) return { triggered: false };

  const missing: ("acknowledgement" | "reason")[] = [];
  if (!acknowledged) missing.push("acknowledgement");
  if ((reason ?? "").trim() === "") missing.push("reason");

  return {
    triggered: true,
    canSave: missing.length === 0,
    missing,
    excessRp: buyPrice - sellPrice,
  };
}

// ---------------------------------------------------------------------------
// P2 — harga jual berubah, harga beli tidak diperbarui dalam 7 hari  ⇒  TAGIH
// ---------------------------------------------------------------------------

/**
 * Ambang P2 dalam hari. Bukan angka gaya: ia jeda yang owner tetapkan di §4.1.
 * Kalau diubah, ubah §4.1 lebih dulu — bukan sebaliknya.
 */
export const P2_GRACE_DAYS = 7;

export interface P2Result {
  /** Perlu ditagih ke Finance? */
  due: boolean;
  /** Tanggal harga jual terakhir BERUBAH (≤ asOf); null bila tak ada. */
  lastSellChange: string | null;
  /** `effectiveFrom` harga beli terakhir (≤ asOf); null bila belum pernah diisi. */
  lastBuyUpdate: string | null;
  /** Umur hari sejak harga jual berubah; null bila tak ada perubahan. */
  staleDays: number | null;
}

/**
 * Evaluasi P2 untuk satu produk pada tanggal `asOf`.
 *
 * `sellHistory` boleh tidak berurut dan boleh berlubang; yang dipakai hanyalah
 * titik-titik ≤ `asOf`. "Berubah" = nilainya berbeda dari titik berdata
 * SEBELUMNYA — jadi hari tanpa data tidak dianggap perubahan, dan kembalinya
 * harga ke nilai lama tetap dihitung sebagai perubahan (memang begitu: harga
 * beli pun mestinya ikut kembali).
 *
 * Terpicu bila: ada perubahan harga jual, harga beli belum diperbarui SEJAK
 * perubahan itu, dan perubahan itu sudah berumur ≥ `P2_GRACE_DAYS`.
 *
 * Catatan yang menyelamatkan: **belum pernah ada harga beli sama sekali juga
 * memicu** (`lastBuyUpdate === null`). Bakau kehilangan seluruh harga pokok
 * Solar selama berbulan-bulan justru pada keadaan itu.
 */
export function evaluateP2(
  buyRows: readonly PurchasePriceRow[],
  productKey: string,
  sellHistory: readonly SellPricePoint[],
  asOf: string,
): P2Result {
  const points = sellHistory
    .filter((p) => p.date <= asOf)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let lastSellChange: string | null = null;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.price !== points[i - 1]!.price) lastSellChange = points[i]!.date;
  }

  let lastBuyUpdate: string | null = null;
  for (const r of buyRows) {
    if (r.void || r.productKey !== productKey || r.effectiveFrom > asOf) continue;
    if (lastBuyUpdate === null || r.effectiveFrom > lastBuyUpdate) lastBuyUpdate = r.effectiveFrom;
  }

  if (lastSellChange === null) {
    return { due: false, lastSellChange: null, lastBuyUpdate, staleDays: null };
  }

  const staleDays = daysBetween(lastSellChange, asOf);
  const buyIsStale = lastBuyUpdate === null || lastBuyUpdate < lastSellChange;
  return {
    due: buyIsStale && staleDays >= P2_GRACE_DAYS,
    lastSellChange,
    lastBuyUpdate,
    staleDays,
  };
}

/** Selisih hari antara dua tanggal bisnis `YYYY-MM-DD` (UTC, bebas zona waktu). */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
