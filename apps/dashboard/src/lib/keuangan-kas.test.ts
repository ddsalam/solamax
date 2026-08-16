import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cashFlowCheck,
  kasOnHand,
  kategoriCocok,
  ringkasPerKategori,
  saldoAkun,
  saldoSemuaAkun,
  tandaCocok,
  type MutasiKas,
} from "./keuangan-kas";

const m = (o: Partial<MutasiKas> = {}): MutasiKas => ({
  accountId: "kas-besar",
  businessDate: "2026-01-10",
  jenis: "debet",
  categorySide: "debet",
  categoryLabel: "Setoran Hasil Penjualan",
  amount: 1_000,
  void: false,
  ...o,
});

const kredit = (o: Partial<MutasiKas> = {}): MutasiKas =>
  m({ jenis: "kredit", categorySide: "kredit", categoryLabel: "Setoran ke Bank", amount: -1_000, ...o });

describe("saldo — TURUNAN, bukan kolom", () => {
  const buku: MutasiKas[] = [
    m({ businessDate: "2026-01-01", amount: 500_000 }),
    kredit({ businessDate: "2026-01-05", amount: -200_000 }),
    m({ businessDate: "2026-01-10", amount: 300_000 }),
  ];

  it("saldo = Σ nominal bertanda", () => {
    expect(saldoAkun(buku, "kas-besar", "2026-01-10")).toBe(600_000);
  });

  it("batas tanggal INKLUSIF", () => {
    expect(saldoAkun(buku, "kas-besar", "2026-01-05")).toBe(300_000);
    expect(saldoAkun(buku, "kas-besar", "2026-01-04")).toBe(500_000);
  });

  it("mutasi VOID diabaikan — menghitungnya = membatalkan pembatalan", () => {
    const dgnVoid = [...buku, m({ businessDate: "2026-01-06", amount: 9_999_999, void: true })];
    expect(saldoAkun(dgnVoid, "kas-besar", "2026-01-10")).toBe(600_000);
  });

  it("akun lain tidak bocor ke saldo akun ini", () => {
    const dua = [...buku, m({ accountId: "bca-5125036811", amount: 7_000_000 })];
    expect(saldoAkun(dua, "kas-besar", "2026-01-10")).toBe(600_000);
    expect(saldoAkun(dua, "bca-5125036811", "2026-01-10")).toBe(7_000_000);
  });

  it("urutan masukan tidak memengaruhi hasil", () => {
    expect(saldoAkun([...buku].reverse(), "kas-besar", "2026-01-10")).toBe(
      saldoAkun(buku, "kas-besar", "2026-01-10"),
    );
  });

  it("SISIPAN DI TENGAH langsung terpantul ke saldo — inilah alasan tidak disimpan", () => {
    // Di workbook, menyisipkan baris bertanggal lampau meninggalkan seluruh
    // kolom `Saldo Akhir` di bawahnya tetap pada angka lama — terlihat benar,
    // dan diamnya itu yang mahal.
    const sisipan = [...buku, m({ businessDate: "2026-01-03", amount: 111 })];
    expect(saldoAkun(sisipan, "kas-besar", "2026-01-10")).toBe(600_111);
    expect(saldoAkun(sisipan, "kas-besar", "2026-01-04")).toBe(500_111);
  });

  it("akun tanpa mutasi bersaldo nol, bukan undefined", () => {
    expect(saldoAkun(buku, "bank-bni", "2026-01-10")).toBe(0);
    expect(saldoSemuaAkun(buku, "2026-01-10").get("bank-bni")).toBeUndefined();
  });
});

describe("kasOnHand — tujuh akun dijumlah jadi satu", () => {
  it("menjumlah seluruh akun pada tanggal itu", () => {
    const buku = [
      m({ accountId: "kas-besar", amount: 300_000 }),
      m({ accountId: "edc-penampungan", amount: 12_000_000 }),
      kredit({ accountId: "bca-5125036811", amount: -2_000_000 }),
    ];
    expect(kasOnHand(buku, "2026-01-10")).toBe(10_300_000);
  });

  it("saldo negatif ikut apa adanya — rekening bisa memang negatif di buku", () => {
    // BCA-5125036811 Bakau tercatat −1.834.794.594 pada 28-01-2026.
    expect(kasOnHand([kredit({ amount: -1_834_794_594 })], "2026-01-28")).toBe(-1_834_794_594);
  });
});

describe("kategori & tanda — sesisi dengan jenisnya", () => {
  it("debet berkategori debet, kredit berkategori kredit", () => {
    expect(kategoriCocok("debet", "debet")).toBe(true);
    expect(kategoriCocok("kredit", "kredit")).toBe(true);
  });

  it("🔴 silang sisi ditolak — 'Pembelian BBM' tak boleh jadi mutasi debet", () => {
    // Tanpa ini laporan kategori jadi bohong tanpa satu pun angka terlihat salah.
    expect(kategoriCocok("debet", "kredit")).toBe(false);
    expect(kategoriCocok("kredit", "debet")).toBe(false);
  });

  it("adjustment WAJIB tanpa kategori", () => {
    expect(kategoriCocok("adjustment", null)).toBe(true);
    expect(kategoriCocok("adjustment", "debet")).toBe(false);
  });

  it("debet/kredit WAJIB berkategori", () => {
    expect(kategoriCocok("debet", null)).toBe(false);
    expect(kategoriCocok("kredit", null)).toBe(false);
  });

  it("tanda mengikuti jenis; nol bukan mutasi", () => {
    expect(tandaCocok("debet", 1)).toBe(true);
    expect(tandaCocok("debet", -1)).toBe(false);
    expect(tandaCocok("kredit", -1)).toBe(true);
    expect(tandaCocok("kredit", 1)).toBe(false);
    expect(tandaCocok("adjustment", -5)).toBe(true);
    for (const j of ["debet", "kredit", "adjustment"] as const) {
      expect(tandaCocok(j, 0), j).toBe(false);
    }
  });
});

describe("cashFlowCheck — menjaga hal BERBEDA dari BalanceSheetCheck", () => {
  it("arus cocok dengan saldo buku ⇒ nol", () => {
    expect(cashFlowCheck({ netCashChange: 370_009_299, saldoBukuAwal: 0, saldoBukuAkhir: 370_009_299 }))
      .toBe(0);
  });

  it("kasus nyata Bakau 30-01-2026: penebusan masuk arus, tak masuk buku", () => {
    // Rp 915.007.430 tercatat sebagai arus keluar, tetapi tak pernah mendarat
    // di buku bank mana pun ⇒ CashFlow Check −915.007.430, sementara BSCheck
    // hari itu justru POSITIF. Gerbang yang hanya melihat satu akan bilang sehat.
    expect(
      cashFlowCheck({ netCashChange: -915_007_430, saldoBukuAwal: 0, saldoBukuAkhir: 0 }),
    ).toBe(-915_007_430);
  });

  it("tandanya bermakna: arus < perubahan buku ⇒ negatif", () => {
    expect(cashFlowCheck({ netCashChange: 100, saldoBukuAwal: 0, saldoBukuAkhir: 300 })).toBe(-200);
    expect(cashFlowCheck({ netCashChange: 300, saldoBukuAwal: 0, saldoBukuAkhir: 100 })).toBe(200);
  });
});

describe("ringkasPerKategori — tiga label dua sisi tidak boleh tergabung", () => {
  it("'Pindah Buku' debet dan kredit tetap TERPISAH", () => {
    // Kalau digabung, hasilnya saling meniadakan dan barisnya jadi ~nol —
    // terlihat rapi, artinya bukan apa-apa.
    const buku = [
      m({ categoryLabel: "Pindah Buku", amount: 5_000_000 }),
      kredit({ categoryLabel: "Pindah Buku", amount: -5_000_000 }),
    ];
    const r = ringkasPerKategori(buku, "2026-01-01", "2026-01-31");
    expect(r.get("debet|Pindah Buku")).toBe(5_000_000);
    expect(r.get("kredit|Pindah Buku")).toBe(-5_000_000);
    expect(r.size).toBe(2);
  });

  it("rentang inklusif di kedua ujung, void diabaikan", () => {
    const buku = [
      m({ businessDate: "2026-01-01", amount: 1 }),
      m({ businessDate: "2026-01-31", amount: 2 }),
      m({ businessDate: "2026-02-01", amount: 4 }),
      m({ businessDate: "2026-01-15", amount: 8, void: true }),
    ];
    expect(ringkasPerKategori(buku, "2026-01-01", "2026-01-31").get("debet|Setoran Hasil Penjualan"))
      .toBe(3);
  });
});

describe("migrasi 0029 — saldo TIDAK BOLEH jadi kolom", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../../backend/prisma/migrations/0029_cash_ledger/migration.sql"),
    "utf8",
  );
  const stmt = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("cash_ledger tidak punya kolom saldo apa pun", () => {
    // Penjaga terhadap "optimasi" yang paling mungkin diusulkan berikutnya.
    expect(stmt).not.toMatch(/"saldo[_a-z]*"\s+(DECIMAL|NUMERIC)/i);
    expect(stmt).not.toMatch(/"running_balance"|"balance"/i);
  });

  it("indeks penjumlahan saldo ada — supaya tak ada alasan menyimpannya", () => {
    expect(stmt).toMatch(/cash_ledger_saldo_idx[\s\S]*?WHERE NOT "void"/);
  });
});
