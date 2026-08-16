import { describe, expect, it } from "vitest";
import emas from "./__fixtures__/keuangan-t3-emas.json";
import { computeDay, sisaSoAktif, type DayProductInput } from "./keuangan-mesin";

/**
 * `SOValue` = `SisaSO_AKTIF × HargaBeli`, dengan AKTIF = `sisa − sisa_macet`
 * (B6, §10.6). Penandaan macet MANUAL Finance; ambang hari hanya mengusulkan.
 *
 * Kasus uji NYATA (bukti T3, Bakau):
 *  · dua SO Solar mati sejak 2023 — `CNOSO 4023445216` & `4027089474`, masing-
 *    masing sisa 8.000 L ⇒ **16.000 L**, konstan di 10/10 tanggal;
 *  · SO PREMIUM (BB-01) 1,12 juta liter yang sudah dihapus Finance.
 *
 * ⚠️ Uji ini TIDAK memaksa `SOValue` cocok dengan workbook. Ia menguji **efek
 * penandaan macet**, lalu **mencatat sisa selisih apa adanya** beserta
 * klasifikasinya. Angka yang dibuat cocok tidak membuktikan apa pun.
 */

type Row = (typeof emas.dates)[number]["rows"][number];

const toInput = (r: Row, macet: Readonly<Record<string, number>> = {}): DayProductInput => ({
  productKey: r.productKey,
  volume: r.volume ?? 0,
  sellPrice: r.sellPrice,
  tera: r.tera ?? 0,
  stock: r.stock,
  lossesGain: r.lossesGain,
  buyPrice: r.buyPrice,
  sisaSo: r.sisaSo === null ? null : sisaSoAktif(r.sisaSo, macet[r.productKey] ?? 0),
});

/** Dua SO Solar mati 2023 = 8.000 + 8.000 L. */
const MACET_SOLAR = { "BB-03": 16_000 } as const;
/** Rp 6.567,155125 × 16.000 — konstan, sebab harga beli Solar beku sejak 2024-12-01. */
const NILAI_SOLAR_MACET = 105_074_482;

describe("sisaSoAktif — pengurangan macet, tanpa ambang", () => {
  it("mengurangi sisa dengan jumlah yang DITANDAI", () => {
    expect(sisaSoAktif(64_000, 16_000)).toBe(48_000);
  });

  it("tanpa penandaan = tanpa perubahan", () => {
    expect(sisaSoAktif(64_000, 0)).toBe(64_000);
  });

  it("tidak pernah negatif", () => {
    expect(sisaSoAktif(4_000, 16_000)).toBe(0);
  });

  it("tidak punya parameter ambang — 'macet' adalah PENANDAAN, bukan hitungan", () => {
    // Kalau suatu saat fungsi ini menerima ambang hari, ia telah berubah dari
    // "yang ditandai Finance" jadi "yang dihitung mesin" — dan SO yang masih
    // ditagih akan terhapus, lalu hidup lagi begitu ambangnya digeser.
    expect(sisaSoAktif).toHaveLength(2);
  });
});

describe("efek penandaan macet pada SOValue — 10 tanggal emas", () => {
  it("dua SO Solar mati mengurangi SOValue tepat Rp 105.074.482 di SETIAP tanggal", () => {
    for (const d of emas.dates) {
      const tanpa = computeDay(d.rows.map((r) => toInput(r))).totals.soValue;
      const dengan = computeDay(d.rows.map((r) => toInput(r, MACET_SOLAR))).totals.soValue;
      expect(tanpa - dengan, d.date).toBeCloseTo(NILAI_SOLAR_MACET, 2);
    }
  });

  it("SO PREMIUM tak mengubah RUPIAH — ia mencolok di VOLUME saja", () => {
    // BB-01 tak punya harga beli ⇒ soValue-nya null, jadi menandainya macet
    // tidak menggeser satu rupiah pun. Penting: jangan mengharapkan penandaan
    // ini "memperbaiki" neraca.
    for (const d of emas.dates) {
      const a = computeDay(d.rows.map((r) => toInput(r))).totals.soValue;
      const b = computeDay(d.rows.map((r) => toInput(r, { "BB-01": 2_000_000 }))).totals.soValue;
      expect(b, d.date).toBeCloseTo(a, 2);
    }
    const premium = emas.dates[0]!.rows.find((r) => r.productKey === "BB-01")!;
    expect(premium.sisaSo).toBeGreaterThan(1_000_000);
    expect(premium.buyPrice).toBeNull();
  });

  it("penandaan tidak menyentuh pos lain — hanya SOValue yang bergerak", () => {
    for (const d of emas.dates) {
      const a = computeDay(d.rows.map((r) => toInput(r))).totals;
      const b = computeDay(d.rows.map((r) => toInput(r, MACET_SOLAR))).totals;
      for (const k of ["revenue", "cogs", "teraValue", "inventoryValue", "lossesGainValue"] as const) {
        expect(b[k], `${d.date} · ${k}`).toBeCloseTo(a[k], 2);
      }
    }
  });
});

/**
 * SISA SELISIH SETELAH MACET — dicatat apa adanya, TIDAK dipaksa cocok.
 *
 * Selisih `SOValue` terhadap workbook (T3) punya DUA komponen. Menandai SO mati
 * menutup komponen pertama SELURUHNYA; komponen kedua **tidak bisa** ditutup
 * olehnya, sebab arahnya berlawanan — workbook mencatat SO OUTSTANDING LEBIH
 * BANYAK daripada SolaMax, sedangkan `sisa_macet` hanya bisa MENGURANGI SolaMax.
 *
 * Keempat sisa itu satu kelas: **beda sumbu tanggal** (B7). SolaMax mengurangi
 * sisa SO pada tanggal TERIMA (`dtgltrm`), sedangkan §10.7 memutuskan `SOValue`
 * memakai **tanggal SO ditutup**. Sumbu kedua itu belum diimplementasikan —
 * itulah kandidat penutupnya, bukan penandaan macet.
 */
describe("sisa selisih yang TIDAK bisa ditutup macet — didokumentasikan, bukan disembunyikan", () => {
  /** Volume yang workbook catat LEBIH dari SolaMax (bukti T3 §D2/§D3). */
  const SISA: ReadonlyArray<{ date: string; produk: string; liter: number; kelas: string }> = [
    { date: "2025-06-02", produk: "BB-08", liter: 4_000, kelas: "beda sumbu tanggal (B7)" },
    { date: "2025-06-30", produk: "BB-08", liter: 4_000, kelas: "beda sumbu tanggal (B7)" },
    { date: "2025-08-31", produk: "BB-08", liter: 4_000, kelas: "beda sumbu tanggal (B7)" },
    { date: "2025-12-31", produk: "BB-07", liter: 8_000, kelas: "beda sumbu tanggal (B7)" },
  ];

  it("tepat 4 dari 10 tanggal masih menyisakan selisih", () => {
    expect(new Set(SISA.map((s) => s.date)).size).toBe(4);
  });

  it("seluruh sisanya SATU kelas — tak ada yang tak terklasifikasi", () => {
    // Kalau kelak muncul sisa berkelas lain, baris ini merah dan memaksa
    // sebabnya ditelusuri, bukan dibiarkan sebagai "selisih kecil".
    expect(new Set(SISA.map((s) => s.kelas))).toEqual(new Set(["beda sumbu tanggal (B7)"]));
  });

  it("nilainya cocok dengan angka yang dihitung TERPISAH di dokumen T3", () => {
    // Silang-cek: 8.000 L Pertalite 2025-12-31 × harga beli fixture harus
    // menghasilkan Rp 77.436.414 — angka yang di `…-t3-hasil.md` §D3 dihitung
    // lewat jalur lain (selisih Inventory). Dua jalan, satu angka.
    const d = emas.dates.find((x) => x.date === "2025-12-31")!;
    const ptl = d.rows.find((r) => r.productKey === "BB-07")!;
    expect(8_000 * ptl.buyPrice!).toBeCloseTo(77_436_414, 2);

    const d2 = emas.dates.find((x) => x.date === "2025-06-02")!;
    const dex = d2.rows.find((r) => r.productKey === "BB-08")!;
    expect(4_000 * dex.buyPrice!).toBeCloseTo(53_882_564, 2);
  });

  it("arahnya BERLAWANAN dengan macet — karena itu macet tak bisa menutupnya", () => {
    // workbook > SolaMax ⇒ menambah macet hanya MEMPERBESAR selisihnya.
    // Menyatakan ini sebagai tes supaya tak ada yang mencoba "menyetel" macet
    // sampai angkanya cocok.
    for (const s of SISA) {
      const d = emas.dates.find((x) => x.date === s.date)!;
      const r = d.rows.find((x) => x.productKey === s.produk)!;
      const aktif = sisaSoAktif(r.sisaSo!, s.liter);
      expect(aktif, `${s.date} ${s.produk}`).toBeLessThanOrEqual(r.sisaSo!);
    }
  });
});
