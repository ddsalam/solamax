import { describe, expect, it } from "vitest";
import { kasOnHand, saldoAkun, type MutasiKas } from "./keuangan-kas";
import {
  barisBuku,
  kakiBuku,
  nilaiTertunda,
  tawaranSetoran,
  tawaranTertunda,
  butuhKategoriOperasional,
  kategoriBeban,
  rencanaBeban,
} from "./keuangan-kas-model";
import { sectionBeban } from "./klasifikasi-model";
import { PETA_KATEGORI_ARUS_KAS } from "./keuangan-sisi-kas";

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
  saldoAwal: false,
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

describe("K6 U3 — kategoriBeban & rencanaBeban (R23, P11, P12, P20)", () => {
  it("kelengkapan: tepat label yang sectionBeban anggap realisasi laba", () => {
    const dariPeta = Object.keys(PETA_KATEGORI_ARUS_KAS).filter((l) => sectionBeban(l) !== null).sort();
    const dariPredikat = Object.keys(PETA_KATEGORI_ARUS_KAS).filter((l) => kategoriBeban(l) !== null).sort();
    expect(dariPredikat).toEqual(["Biaya Operasional", "Management Fee", "Pendapatan Lain-Lain"]);
    expect(dariPredikat).toEqual(dariPeta);
    expect(kategoriBeban("Pembelian BBM")).toBeNull();
    expect(kategoriBeban(null)).toBeNull();
  });

  it("field kedua HANYA untuk Biaya Operasional", () => {
    expect(butuhKategoriOperasional("Biaya Operasional")).toBe(true);
    expect(butuhKategoriOperasional("Pendapatan Lain-Lain")).toBe(false);
    expect(butuhKategoriOperasional("Management Fee")).toBe(false);
  });

  it("Covers AE6 (bagian murni). Biaya Operasional −1.500.000 + Sarana & Prasarana ⇒ pengeluaran 150.000.000 sen", () => {
    const r = rencanaBeban({
      categoryLabel: "Biaya Operasional",
      operationalCategory: "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)",
      amount: -1_500_000,
    });
    expect(r).toEqual({
      ok: true,
      rencana: {
        section: "pengeluaran",
        kategoriOperasional: ["Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)"],
        amountSen: 150_000_000,
      },
    });
  });

  it("Biaya Operasional tanpa jenis biaya ⇒ ditolak", () => {
    for (const op of [null, "", "Bukan kategori"]) {
      const r = rencanaBeban({ categoryLabel: "Biaya Operasional", operationalCategory: op, amount: -10_000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/wajib memilih jenis biaya/);
    }
  });

  it("Pendapatan Lain-Lain tanpa field kedua ⇒ pendapatan_lain, kategori tak pernah kosong", () => {
    const r = rencanaBeban({ categoryLabel: "Pendapatan Lain-Lain", operationalCategory: null, amount: 250_000 });
    expect(r).toEqual({ ok: true, rencana: { section: "pendapatan_lain", kategoriOperasional: ["Lain-Lain"], amountSen: 25_000_000 } });
  });

  it("Management Fee tanpa field kedua ⇒ peta 'Management Fee' dulu, lalu 'Lain-Lain' (P20 awal 5700)", () => {
    const r = rencanaBeban({ categoryLabel: "Management Fee", operationalCategory: undefined, amount: -2_000_000 });
    expect(r).toEqual({
      ok: true,
      rencana: { section: "pengeluaran", kategoriOperasional: ["Management Fee", "Lain-Lain"], amountSen: 200_000_000 },
    });
  });

  it("field kedua pada kategori bertetapan ⇒ ditolak (bukan diam-diam dibuang)", () => {
    const r = rencanaBeban({ categoryLabel: "Management Fee", operationalCategory: "Lain-Lain", amount: -1 });
    expect(r.ok).toBe(false);
  });

  it("arah salah ⇒ ditolak", () => {
    expect(rencanaBeban({ categoryLabel: "Pendapatan Lain-Lain", operationalCategory: null, amount: -5 }).ok).toBe(false);
    expect(rencanaBeban({ categoryLabel: "Management Fee", operationalCategory: null, amount: 5 }).ok).toBe(false);
    expect(rencanaBeban({ categoryLabel: "Biaya Operasional", operationalCategory: "MDR", amount: 0 }).ok).toBe(false);
    expect(rencanaBeban({ categoryLabel: "Biaya Operasional", operationalCategory: "MDR", amount: -0.001 }).ok).toBe(false);
  });
});
