import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope";
import type { PurchasePriceRow, SellPricePoint } from "./harga-beli";

/**
 * Kueri BACA untuk Layar 3 — Input Keuangan (mockup layar 3, blok 1).
 *
 * Semuanya lewat `qScoped()` dengan `ScopedUnitId` ber-brand: lupa men-scope =
 * error type-check, dan RLS 0016 memfilter ulang di DB (fail-closed).
 *
 * ⛔ HARGA JUAL TIDAK PERNAH DIKETIK. Ia datang dari EasyMax (`sales_detail`),
 * dan di layar ia hanya DITAMPILKAN berdampingan dengan harga beli. Satu-satunya
 * angka yang diketik manusia di blok ini adalah harga beli — itulah sebabnya ia
 * dijaga dua penjaga (§4.1), sebab ia satu-satunya angka besar tanpa sumber
 * pembanding.
 */

/** Produk BBM unit ini, dari master EasyMax. */
export interface ProdukUnit {
  productKey: string;
  nama: string;
}

export async function getProdukUnit(unit: ScopedUnitId): Promise<ProdukUnit[]> {
  return qScoped<ProdukUnit>(
    unit,
    `SELECT trim(p.ckdbbm) AS "productKey",
            COALESCE(p.vcnmbbm, trim(p.ckdbbm)) AS nama
       FROM product p
      WHERE p.unit_id = $1
      ORDER BY 2`,
    [unit],
  );
}

/**
 * SELURUH baris harga beli unit ini (termasuk yang `void`).
 *
 * Yang void ikut ditarik dengan sengaja: `effectiveBuyPrice` dan `evaluateP2`
 * menyaringnya sendiri, dan menyaringnya di SQL akan membuat kedua fungsi murni
 * itu tak pernah teruji terhadap keadaan yang sebenarnya bisa terjadi. Volumenya
 * kecil — satu baris per produk per perubahan harga.
 */
export async function getHargaBeliRows(unit: ScopedUnitId): Promise<PurchasePriceRow[]> {
  return qScoped<PurchasePriceRow>(
    unit,
    `SELECT product_key                        AS "productKey",
            to_char(effective_from,'YYYY-MM-DD') AS "effectiveFrom",
            price::float8                      AS price,
            void
       FROM app.purchase_price
      WHERE unit_id = $1
      ORDER BY product_key, effective_from`,
    [unit],
  );
}

/** Baris harga beli + jejak pengakuan P1-nya — untuk kolom "Berlaku sejak" & riwayat. */
export interface HargaBeliDetail extends PurchasePriceRow {
  id: string;
  p1Triggered: boolean;
  p1Reason: string | null;
  sourceNote: string | null;
}

export async function getHargaBeliDetail(unit: ScopedUnitId): Promise<HargaBeliDetail[]> {
  return qScoped<HargaBeliDetail>(
    unit,
    `SELECT id::text                            AS id,
            product_key                         AS "productKey",
            to_char(effective_from,'YYYY-MM-DD') AS "effectiveFrom",
            price::float8                       AS price,
            void,
            p1_triggered                        AS "p1Triggered",
            p1_reason                           AS "p1Reason",
            source_note                         AS "sourceNote"
       FROM app.purchase_price
      WHERE unit_id = $1 AND NOT void
      ORDER BY product_key, effective_from DESC`,
    [unit],
  );
}

/**
 * Jendela riwayat harga jual yang ditarik untuk mengevaluasi P2, dalam hari.
 *
 * ⚠️ BATAS YANG DISENGAJA, sebut apa adanya: perubahan harga jual yang terjadi
 * LEBIH LAMA dari jendela ini tidak terlihat, sehingga P2 **tidak menagih**
 * untuk kasus itu. Arah kesalahannya dipilih sadar — jendela pendek membuat
 * penjaga DIAM, bukan berbunyi palsu. Penjaga yang berbunyi palsu akan diabaikan
 * dalam sebulan, dan setelah itu ia tak menjaga apa pun.
 *
 * 180 hari ≈ dua kali jarak antar-perubahan harga Pertamina yang teramati di
 * data Bakau. Kalau kelak harga membeku lebih lama dari ini, yang perlu diubah
 * adalah angkanya di sini — bukan aturannya di `harga-beli.ts`.
 */
export const JENDELA_HARGA_JUAL_HARI = 180;

/**
 * Riwayat harga jual per produk per tanggal bisnis, dari EasyMax.
 *
 * Satu titik per (produk, tanggal) = harga jual TERAKHIR yang teramati hari itu
 * — konvensi yang sama dengan `getSalesByProduct`. Hari tanpa penjualan tidak
 * menghasilkan titik, dan `evaluateP2` memang menangani deret berlubang.
 */
export async function getHargaJualHistory(
  unit: ScopedUnitId,
  asOf: string,
  windowDays: number = JENDELA_HARGA_JUAL_HARI,
): Promise<Map<string, SellPricePoint[]>> {
  const rows = await qScoped<{ productKey: string; date: string; price: number }>(
    unit,
    `SELECT DISTINCT ON (trim(sd.ckdbbm), h.dtgljual)
            trim(sd.ckdbbm)                     AS "productKey",
            to_char(h.dtgljual,'YYYY-MM-DD')    AS date,
            sd.nhargajual::float8               AS price
       FROM sales_detail sd
       JOIN sales_header h
         ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
      WHERE sd.unit_id = $1
        AND h.dtgljual > $2::date - $3::int
        AND h.dtgljual <= $2::date
      ORDER BY trim(sd.ckdbbm), h.dtgljual, sd.dtgljam DESC`,
    [unit, asOf, windowDays],
  );
  const out = new Map<string, SellPricePoint[]>();
  for (const r of rows) {
    const arr = out.get(r.productKey) ?? [];
    arr.push({ date: r.date, price: r.price });
    out.set(r.productKey, arr);
  }
  return out;
}
