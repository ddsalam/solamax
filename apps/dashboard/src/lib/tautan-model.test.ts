import { describe, expect, it } from "vitest";
import {
  kandidatMutasi,
  kosong,
  periksaTautanBeban,
  susunPerluDitautkan,
  type BebanTautan,
  type KasTautan,
} from "./tautan-model";

let n = 0;
const kas = (o: Partial<KasTautan> = {}): KasTautan => ({
  id: `k${++n}`,
  accountId: "BANK",
  namaAkun: "Bank Contoh",
  kindAkun: "bank",
  businessDate: "2026-10-10",
  keterangan: "mutasi",
  categoryLabel: "Biaya Operasional",
  amount: -300_000,
  void: false,
  bebanAktif: false,
  penebusanAktif: false,
  bulanTertutup: false,
  ...o,
});
const beban = (o: Partial<BebanTautan> = {}): BebanTautan => ({
  id: `b${++n}`,
  businessDate: "2026-10-10",
  section: "pengeluaran",
  sourceDoor: "finance",
  keterangan: "biaya",
  amount: 300_000,
  operationalCategory: "Lain-Lain",
  void: false,
  cashLedgerId: null,
  hariTertutup: false,
  bulanTertutup: false,
  ...o,
});

describe("susunPerluDitautkan — tiga daftar R27, kedua arah", () => {
  it("mutasi biaya tanpa Biaya DAN Biaya tanpa mutasi tampil; yang bertaut tidak", () => {
    const k1 = kas({ categoryLabel: "Biaya Operasional" });
    const k2 = kas({ categoryLabel: "Pendapatan Lain-Lain", amount: 50_000 });
    const k3 = kas({ categoryLabel: "Management Fee", bebanAktif: true });
    const k4 = kas({ categoryLabel: "Setoran ke Bank", amount: 1_000 });
    const k5 = kas({ categoryLabel: "Biaya Operasional", void: true });
    const b1 = beban();
    const b2 = beban({ cashLedgerId: "kX" });
    const b3 = beban({ sourceDoor: "pengawas" });
    const b4 = beban({ void: true });
    const p = susunPerluDitautkan([k1, k2, k3, k4, k5], [b1, b2, b3, b4]);
    expect(p.mutasiTanpaBiaya.map((x) => x.id)).toEqual([k1.id, k2.id]);
    expect(p.biayaTanpaMutasi.map((x) => x.id)).toEqual([b1.id]);
    expect(kosong(p)).toBe(false);
  });

  it("Pembelian BBM bank tanpa penebusan tampil; Kas Besar & yang berpenebusan tidak", () => {
    const k1 = kas({ categoryLabel: "Pembelian BBM", amount: -9_000_000 });
    const k2 = kas({ categoryLabel: "Pembelian BBM", penebusanAktif: true });
    const k3 = kas({ categoryLabel: "Pembelian BBM", kindAkun: "kas" });
    const p = susunPerluDitautkan([k1, k2, k3], []);
    expect(p.bbmTanpaPenebusan.map((x) => x.id)).toEqual([k1.id]);
  });

  it("kosong ⇒ kosong()", () => {
    expect(kosong(susunPerluDitautkan([], []))).toBe(true);
  });
});

describe("periksaTautanBeban — penjaga tautan (b)", () => {
  it("baris pengawas ditolak", () => {
    expect(periksaTautanBeban(beban({ sourceDoor: "pengawas" }), kas())).toMatch(/pengawas/);
  });
  it("mutasi yang sudah punya Biaya aktif ditolak (satu per mutasi)", () => {
    expect(periksaTautanBeban(beban(), kas({ bebanAktif: true }))).toMatch(/sudah punya baris Biaya aktif/);
  });
  it("Biaya yang sudah bertaut ditolak", () => {
    expect(periksaTautanBeban(beban({ cashLedgerId: "k0" }), kas())).toMatch(/sudah bertaut/);
  });
  it("nominal beda, tanggal > 3 hari, seksi beda, bulan/hari tertutup ⇒ ditolak", () => {
    expect(periksaTautanBeban(beban({ amount: 300_001 }), kas())).toMatch(/Nominal/);
    expect(periksaTautanBeban(beban({ businessDate: "2026-10-14" }), kas())).toMatch(/lebih dari 3 hari/);
    expect(periksaTautanBeban(beban({ section: "pendapatan_lain" }), kas())).toMatch(/Pendapatan Lain-Lain/);
    expect(periksaTautanBeban(beban(), kas({ bulanTertutup: true }))).toMatch(/ditutup/);
    expect(periksaTautanBeban(beban({ hariTertutup: true }), kas())).toMatch(/tutup hari/);
  });
  it("cocok ±3 hari ⇒ boleh; Management Fee sah untuk pengeluaran", () => {
    expect(periksaTautanBeban(beban({ businessDate: "2026-10-13" }), kas())).toBeNull();
    expect(periksaTautanBeban(beban(), kas({ categoryLabel: "Management Fee" }))).toBeNull();
  });
});

describe("kandidatMutasi — menyaring, tidak memilihkan", () => {
  it("hanya yang lolos penjaga, terdekat dulu; dua kandidat tetap dua", () => {
    const b = beban({ businessDate: "2026-10-10" });
    const jauh = kas({ businessDate: "2026-10-12" });
    const dekat = kas({ businessDate: "2026-10-09" });
    const beda = kas({ amount: -1 });
    const terpakai = kas({ bebanAktif: true });
    expect(kandidatMutasi(b, [jauh, beda, terpakai, dekat]).map((k) => k.id)).toEqual([dekat.id, jauh.id]);
  });
});
