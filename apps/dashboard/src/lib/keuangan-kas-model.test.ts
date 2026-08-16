import { describe, expect, it } from "vitest";
import { kasOnHand, saldoAkun, type MutasiKas } from "./keuangan-kas";
import {
  barisBuku,
  kakiBuku,
  nilaiTertunda,
  tawaranSetoran,
  tawaranTertunda,
} from "./keuangan-kas-model";

type Row = MutasiKas & { id: string; keterangan: string; sourceManualEntryId?: string | null };

let n = 0;
const m = (o: Partial<Row> = {}): Row => ({
  id: `m${++n}`,
  accountId: "KAS",
  businessDate: "2026-01-15",
  keterangan: "mutasi",
  jenis: "debet",
  categorySide: "debet",
  categoryLabel: "Setoran Hasil Penjualan",
  amount: 100_000,
  void: false,
  ...o,
});

describe("barisBuku — saldo BERJALAN adalah turunan, bukan kolom", () => {
  it("mulai dari saldo H−1, lalu menumpuk berurut", () => {
    const rows = [
      m({ businessDate: "2026-01-14", amount: 500_000 }),
      m({ amount: 200_000 }),
      m({ amount: -50_000, jenis: "kredit", categorySide: "kredit", categoryLabel: "Setoran ke Bank" }),
    ];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(b.map((x) => x.saldoBerjalan)).toEqual([700_000, 650_000]);
  });

  it("🔴 TIDAK memulai hari dari nol — buku yang begitu terlihat rapi dan salah", () => {
    const rows = [m({ businessDate: "2026-01-14", amount: 500_000 }), m({ amount: 1_000 })];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(b[0]!.saldoBerjalan).toBe(501_000);
    expect(b[0]!.saldoBerjalan).not.toBe(1_000);
  });

  it("baris void tidak menggerakkan saldo — pembatalan tetap membatalkan", () => {
    const rows = [
      m({ businessDate: "2026-01-14", amount: 500_000 }),
      m({ amount: 999_999, void: true }),
      m({ amount: 1_000 }),
    ];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(b).toHaveLength(1);
    expect(b[0]!.saldoBerjalan).toBe(501_000);
  });

  it("akun lain tidak bocor ke buku ini", () => {
    const rows = [m({ accountId: "BCA", amount: 9_000_000 }), m({ amount: 1_000 })];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(b).toHaveLength(1);
    expect(b[0]!.saldoBerjalan).toBe(1_000);
  });

  it("menandai baris yang lahir dari setoran pengawas", () => {
    const rows = [m({ sourceManualEntryId: "se-1" }), m({ sourceManualEntryId: null })];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(b.map((x) => x.dariSetoranPengawas)).toEqual([true, false]);
  });
});

describe("kakiBuku", () => {
  it("saldo akhir = saldo awal + Σ mutasi hari itu", () => {
    const rows = [
      m({ businessDate: "2026-01-14", amount: 500_000 }),
      m({ amount: 200_000 }),
      m({ amount: -50_000, jenis: "kredit", categorySide: "kredit", categoryLabel: "Setoran ke Bank" }),
    ];
    const awal = saldoAkun(rows, "KAS", "2026-01-14");
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(kakiBuku(b, awal)).toEqual({ nMutasi: 2, totalMutasi: 150_000, saldoAkhir: 650_000 });
  });

  it("🔴 saldoAwal yang SALAH dari pemanggil tidak bisa menggeser saldo akhir", () => {
    // Cacat yang ditemukan tes ini: dulu `kakiBuku` menghitung ulang
    // `saldoAwal + Σ`, sehingga pemanggil yang mengirim saldo awal berbeda dari
    // yang dipakai `barisBuku` menghasilkan DUA angka sah yang tak cocok.
    const rows = [m({ amount: 200_000 }), m({ amount: 30_000 })];
    const b = barisBuku(rows, "KAS", "2026-01-15", "2026-01-14");
    expect(kakiBuku(b, 500_000).saldoAkhir).toBe(b.at(-1)!.saldoBerjalan);
    expect(kakiBuku(b, 0).saldoAkhir).toBe(b.at(-1)!.saldoBerjalan);
  });

  it("hari kosong: saldo akhir = saldo awal (satu-satunya pemakaian argumen itu)", () => {
    expect(kakiBuku([], 777_000)).toEqual({ nMutasi: 0, totalMutasi: 0, saldoAkhir: 777_000 });
  });
});

describe("tawaranSetoran — ditawarkan, bukan diposting", () => {
  const setoran = [
    { id: "se-1", keterangan: "Setoran penjualan · shift 1", amount: 193_239_558 },
    { id: "se-2", keterangan: "Setoran penjualan · shift 2", amount: 70_030_708 },
  ];

  it("yang belum dibukukan tetap tertunda; yang sudah tidak ditawarkan lagi", () => {
    const t = tawaranSetoran(setoran, new Set(["se-1"]));
    expect(t.map((x) => x.sudahDibukukan)).toEqual([true, false]);
    expect(tawaranTertunda(t).map((x) => x.id)).toEqual(["se-2"]);
    expect(nilaiTertunda(t)).toBe(70_030_708);
  });

  it("🔴 dua shift bernominal SAMA tetap dua tawaran terpisah", () => {
    // Pencocokan berbasis nominal akan menganggap yang kedua sudah dibukukan —
    // setoran hilang, kas terlihat lebih kecil, tanpa satu pun angka tampak
    // salah. Karena itu kuncinya id setoran (`source_manual_entry_id`, 0033).
    const kembar = [
      { id: "se-a", keterangan: "shift 1", amount: 50_000_000 },
      { id: "se-b", keterangan: "shift 2", amount: 50_000_000 },
    ];
    const t = tawaranSetoran(kembar, new Set(["se-a"]));
    expect(tawaranTertunda(t).map((x) => x.id)).toEqual(["se-b"]);
    expect(nilaiTertunda(t)).toBe(50_000_000);
  });

  it("tak ada yang sudah dibukukan ⇒ semuanya tertunda (kontrol NEGATIF)", () => {
    const t = tawaranSetoran(setoran, new Set());
    expect(tawaranTertunda(t)).toHaveLength(2);
    expect(nilaiTertunda(t)).toBe(263_270_266);
  });
});

describe("saldo lintas-akun tetap terpisah", () => {
  it("kasOnHand menjumlah seluruh akun, saldoAkun hanya satu", () => {
    const rows = [
      m({ accountId: "KAS", amount: 300_000 }),
      m({ accountId: "BCA", amount: 700_000 }),
    ];
    expect(saldoAkun(rows, "KAS", "2026-01-15")).toBe(300_000);
    expect(kasOnHand(rows, "2026-01-15")).toBe(1_000_000);
  });
});
