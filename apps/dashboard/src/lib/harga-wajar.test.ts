import { describe, expect, it } from "vitest";
import { ringkasHarga, selisihRp, vonisHarga, type DeviasiHarga } from "./harga-wajar";

/**
 * Kasus di bawah BUKAN karangan: tiap angka disalin dari mirror produksi
 * (7 unit, riwayat penuh) saat aturannya dikunci, 24 Agu 2026. Yang diuji
 * bukan "fungsinya jalan" melainkan "ia memvonis kejadian NYATA dengan benar" —
 * termasuk hari-hari perubahan harga yang TIDAK boleh dituduh.
 */

const row = (o: Partial<DeviasiHarga> & Pick<DeviasiHarga, "harga" | "dom">): DeviasiHarga => ({
  dom_prev: o.dom ?? null,
  dom_next: o.dom ?? null,
  vol: 100,
  ...o,
});

describe("vonisHarga — kejadian NYATA yang harus dituduh", () => {
  it("Korek 23-08-2026 shift 3: Dexlite Rp 7.850 (harga PLK) vs 20.150", () => {
    expect(
      vonisHarga({ harga: 7850, dom: 20150, dom_prev: 20150, dom_next: 20150, vol: 334.95 }),
    ).toBe("cacat");
  });

  it("Imam Bonjol 16-07-2026: Pertamina Dex Rp 2 (salah ketik telanjang)", () => {
    expect(
      vonisHarga({ harga: 2, dom: 21650, dom_prev: 21650, dom_next: 21650, vol: 54.51 }),
    ).toBe("cacat");
  });

  it("Kotabaru 05-08-2026: Pertamina Dex Rp 10.000 (harga Pertalite)", () => {
    expect(
      vonisHarga({ harga: 10000, dom: 21650, dom_prev: 21650, dom_next: 21650, vol: 337.55 }),
    ).toBe("cacat");
  });

  it("Bakau 14-01-2026: Pertalite Rp 1.000 (satu digit hilang)", () => {
    expect(
      vonisHarga({ harga: 1000, dom: 10000, dom_prev: 10000, dom_next: 10000, vol: 1642.32 }),
    ).toBe("cacat");
  });

  it("Batu Layang 10-07-2026: Pertalite Rp 21.650 (harga Pertamina Dex) — arah terbalik", () => {
    expect(
      vonisHarga({ harga: 21650, dom: 10000, dom_prev: 10000, dom_next: 10000, vol: 9.1 }),
    ).toBe("cacat");
  });
});

describe("vonisHarga — hari perubahan harga yang TIDAK boleh dituduh", () => {
  /**
   * 31 Jan 2026, Pertamina Dex 13.800 → 13.900 serentak di 5 unit. Shift 3
   * masih memakai 13.800. Aturan versi pertama (bandingkan dengan harga produk
   * lain) menuduh kelimanya; versi ini tidak, sebab 13.800 = harga dominan
   * kemarin.
   */
  it("harga minoritas = harga dominan KEMARIN → perubahan harga", () => {
    expect(
      vonisHarga({ harga: 13800, dom: 13900, dom_prev: 13800, dom_next: 13900, vol: 604.7 }),
    ).toBe("perubahan_harga");
  });

  it("harga minoritas = harga dominan BESOK → perubahan harga", () => {
    // 31 Jul 2026: Pertamax 16.650 → 16.300; shift terakhir sudah harga baru.
    expect(
      vonisHarga({ harga: 16300, dom: 16650, dom_prev: 16650, dom_next: 16300, vol: 220 }),
    ).toBe("perubahan_harga");
  });

  it("harga sama dengan dominan → tak pernah cacat (fungsi tetap total)", () => {
    expect(vonisHarga(row({ harga: 20150, dom: 20150 }))).toBe("perubahan_harga");
  });
});

describe("vonisHarga — MENUNGGU, bukan menuduh", () => {
  it("hari terakhir (dom_next belum ada) → menunggu, walau harganya aneh", () => {
    expect(
      vonisHarga({ harga: 7850, dom: 20150, dom_prev: 20150, dom_next: null, vol: 334.95 }),
    ).toBe("menunggu");
  });

  it("dom_prev cocok lebih dulu daripada dom_next kosong → perubahan harga", () => {
    // Urutan pemeriksaan penting: harga lama yang masih terpakai pada hari
    // BERJALAN tak boleh jatuh ke "menunggu" lalu terbaca sebagai gantung.
    expect(
      vonisHarga({ harga: 16650, dom: 16300, dom_prev: 16650, dom_next: null, vol: 50 }),
    ).toBe("perubahan_harga");
  });

  it("tanpa tetangga sama sekali (unit baru, hari pertama) → menunggu", () => {
    expect(vonisHarga({ harga: 9000, dom: 10000, dom_prev: null, dom_next: null, vol: 12 })).toBe(
      "menunggu",
    );
  });
});

describe("selisihRp", () => {
  it("Korek 23-08: 334,95 L × (20.150 − 7.850) = 4.119.885", () => {
    expect(
      selisihRp({ harga: 7850, dom: 20150, dom_prev: 20150, dom_next: 20150, vol: 334.95 }),
    ).toBeCloseTo(4_119_885, 2);
  });

  it("negatif bila harga dipakai LEBIH TINGGI dari dominan (omzet lebih catat)", () => {
    expect(
      selisihRp({ harga: 21650, dom: 10000, dom_prev: 10000, dom_next: 10000, vol: 9.1 }),
    ).toBeCloseTo(-106_015, 2);
  });
});

describe("ringkasHarga", () => {
  const rows: DeviasiHarga[] = [
    { harga: 7850, dom: 20150, dom_prev: 20150, dom_next: 20150, vol: 334.95 }, // cacat
    { harga: 20150, dom: 21650, dom_prev: 21650, dom_next: 21650, vol: 0.5 }, // cacat kecil
    { harga: 13800, dom: 13900, dom_prev: 13800, dom_next: 13900, vol: 604.7 }, // perubahan
    { harga: 9000, dom: 10000, dom_prev: 10000, dom_next: null, vol: 10 }, // menunggu
  ];

  it("memisahkan cacat / menunggu dan mengabaikan perubahan harga", () => {
    const r = ringkasHarga(rows);
    expect(r.cacat).toHaveLength(2);
    expect(r.menunggu).toHaveLength(1);
  });

  it("selisihRp menjumlah HANYA baris cacat", () => {
    // 4.119.885 + (0,5 × 1.500) = 4.120.635 — baris `menunggu` tak ikut.
    expect(ringkasHarga(rows).selisihRp).toBeCloseTo(4_120_635, 2);
  });

  it("maxAbsRp memakai NILAI MUTLAK (baris lebih-catat tetap terhitung berat)", () => {
    const r = ringkasHarga([
      { harga: 21650, dom: 10000, dom_prev: 10000, dom_next: 10000, vol: 100 }, // −1.165.000
      { harga: 9900, dom: 10000, dom_prev: 10000, dom_next: 10000, vol: 100 }, // +10.000
    ]);
    expect(r.selisihRp).toBeCloseTo(-1_155_000, 2);
    expect(r.maxAbsRp).toBeCloseTo(1_165_000, 2);
  });

  it("daftar kosong → nol, bukan NaN", () => {
    const r = ringkasHarga([]);
    expect(r.selisihRp).toBe(0);
    expect(r.maxAbsRp).toBe(0);
  });
});
