import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JENIS_DIBUAT_KEUANGAN,
  KATEGORI_PIHAK_LAWAN,
  kategoriPihakLawan,
  nominalSisiLawan,
  periksaPecahan,
  periksaPihakLawanMutasi,
  periksaSaldoAwalPihakLawan,
  pihakLawanUntuk,
  rupiahKeSen,
  saldoPihakLawan,
  teksKeSen,
  type MutasiPihakLawan,
} from "./pihak-lawan-model";

/**
 * Model MURNI pihak lawan (rencana 2026-10-29 U3; R2, R7, R9; KTD2, KTD3).
 * Uang dibandingkan dalam SEN BULAT — tak satu pun asersi di sini memakai float.
 */

describe("sen bulat — tak pernah float", () => {
  it("rupiah → sen: dua desimal sah, lebih dari itu ditolak", () => {
    expect(rupiahKeSen(6_500_000)).toBe(650_000_000);
    expect(rupiahKeSen(-0.01)).toBe(-1);
    expect(rupiahKeSen(0.1 + 0.2)).toBeNull(); // 0.30000000000000004 bukan dua desimal
    expect(rupiahKeSen(1.005)).toBeNull();
    expect(rupiahKeSen(Number.NaN)).toBeNull();
    expect(rupiahKeSen(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("teks numeric DB → sen tanpa melewati float", () => {
    expect(teksKeSen("-6500000.00")).toBe(-650_000_000);
    expect(teksKeSen("500000")).toBe(50_000_000);
    expect(teksKeSen("0.5")).toBe(50);
    expect(teksKeSen("-0.01")).toBe(-1);
    expect(() => teksKeSen("1.234,00")).toThrow();
    expect(() => teksKeSen("")).toThrow();
  });
});

describe("kategori pihak lawan — daftar SAMA dengan CHECK 0049", () => {
  it("dua kategori, dan keduanya disebut CHECK cash_ledger_pihak_lawan_wajib", () => {
    expect([...KATEGORI_PIHAK_LAWAN]).toEqual(["Hutang Piutang", "Penyerahan titipan"]);
    const m = readFileSync(
      resolve(__dirname, "../../../backend/prisma/migrations/0049_pihak_lawan/migration.sql"),
      "utf8",
    );
    expect(m).toMatch(/"category_label" NOT IN \('Hutang Piutang', 'Penyerahan titipan'\)/);
    expect(kategoriPihakLawan("Hutang Piutang")).toBe(true);
    expect(kategoriPihakLawan("Penyerahan titipan")).toBe(true);
    // 0045: baris lama Bright tetap lewat pengenal titipan-bright, bukan pihak lawan.
    expect(kategoriPihakLawan("Penyerahan titipan Bright")).toBe(false);
    expect(kategoriPihakLawan(null)).toBe(false);
  });

  it("jenis `unit` disemai migrasi, tidak dibuat Keuangan", () => {
    expect(JENIS_DIBUAT_KEUANGAN).not.toContain("unit");
    expect([...JENIS_DIBUAT_KEUANGAN].sort()).toEqual(
      ["afiliasi", "karyawan", "kreditur", "lain", "titipan"].sort(),
    );
  });
});

describe("periksaPihakLawanMutasi — R2, KTD3", () => {
  const bpr = { nama: "BPR Uji", jenis: "kreditur" as const, aktif: true };
  const bright = { nama: "Outlet Bright", jenis: "titipan" as const, aktif: true };

  it("🔴 kategori pihak lawan TANPA pihak lawan ditolak, pesannya menyebut perbaikannya", () => {
    const e = periksaPihakLawanMutasi({ categoryLabel: "Hutang Piutang", pihakLawanId: null, pihak: null });
    expect(e).toMatch(/wajib menyebut pihak lawan/);
    expect(e).toMatch(/pilih/i);
  });

  it("kategori lain + pihak lawan ditolak — saldo pihak lawan akan ikut bergerak", () => {
    expect(
      periksaPihakLawanMutasi({ categoryLabel: "Biaya Operasional", pihakLawanId: "x", pihak: bpr }),
    ).toMatch(/hanya dipakai untuk kategori/);
    expect(periksaPihakLawanMutasi({ categoryLabel: "Biaya Operasional", pihakLawanId: null, pihak: null })).toBeNull();
  });

  it("🔴 pihak lawan NONAKTIF tak bisa dipilih", () => {
    expect(
      periksaPihakLawanMutasi({
        categoryLabel: "Hutang Piutang",
        pihakLawanId: "x",
        pihak: { ...bpr, aktif: false },
      }),
    ).toMatch(/nonaktif/);
  });

  it("pihak lawan tak ditemukan di unit ini ditolak", () => {
    expect(periksaPihakLawanMutasi({ categoryLabel: "Hutang Piutang", pihakLawanId: "x", pihak: null })).toMatch(
      /tak ditemukan/,
    );
  });

  it("titipan hanya untuk penyerahan, penyerahan hanya ke titipan — dua arah", () => {
    expect(
      periksaPihakLawanMutasi({ categoryLabel: "Penyerahan titipan", pihakLawanId: "x", pihak: bpr }),
    ).toMatch(/pemilik titipan/);
    expect(
      periksaPihakLawanMutasi({ categoryLabel: "Hutang Piutang", pihakLawanId: "x", pihak: bright }),
    ).toMatch(/Penyerahan titipan/);
    expect(periksaPihakLawanMutasi({ categoryLabel: "Penyerahan titipan", pihakLawanId: "x", pihak: bright })).toBeNull();
    expect(periksaPihakLawanMutasi({ categoryLabel: "Hutang Piutang", pihakLawanId: "x", pihak: bpr })).toBeNull();
  });
});

describe("periksaPecahan — AE6 (R9)", () => {
  const baris = (amount: number, label = "Hutang Piutang") => ({
    amount,
    categorySide: "kredit" as const,
    categoryLabel: label,
  });

  it("🔴 AE6: 6.500.000 = 6.000.000 (pokok) + 500.000 (bunga) DITERIMA", () => {
    expect(
      periksaPecahan({
        jenis: "kredit",
        total: -6_500_000,
        baris: [baris(-6_000_000), baris(-500_000, "Biaya Operasional")],
      }),
    ).toBeNull();
  });

  it("🔴 AE6: 6.000.000 + 499.999 DITOLAK dengan selisih Rp 1", () => {
    const e = periksaPecahan({
      jenis: "kredit",
      total: -6_500_000,
      baris: [baris(-6_000_000), baris(-499_999, "Biaya Operasional")],
    });
    expect(e).toMatch(/selisih Rp 1\b/);
    expect(e).toMatch(/Rp 0/); // pesan menyebut perbaikannya
  });

  it("toleransi Rp 0 dalam SEN: selisih satu sen pun ditolak", () => {
    const e = periksaPecahan({
      jenis: "debet",
      total: 100.01,
      baris: [
        { amount: 50, categorySide: "debet", categoryLabel: "Hutang Piutang" },
        { amount: 50, categorySide: "debet", categoryLabel: "Hutang Piutang" },
      ],
    });
    expect(e).toMatch(/selisih Rp 0,01/);
  });

  it("minimal dua baris; tanda & sisi kategori tiap baris mengikuti jenis", () => {
    expect(periksaPecahan({ jenis: "kredit", total: -10, baris: [baris(-10)] })).toMatch(/minimal dua/);
    expect(periksaPecahan({ jenis: "kredit", total: -10, baris: [baris(-15), baris(5)] })).toMatch(/Baris 2/);
    expect(
      periksaPecahan({
        jenis: "kredit",
        total: -10,
        baris: [baris(-5), { amount: -5, categorySide: "debet", categoryLabel: "Hutang Piutang" }],
      }),
    ).toMatch(/sesisi/);
    expect(periksaPecahan({ jenis: "kredit", total: 10, baris: [baris(-5), baris(-5)] })).toMatch(/Nominal mutasi/);
    expect(
      periksaPecahan({ jenis: "kredit", total: -10, baris: [baris(-5), { ...baris(-5), categoryLabel: "" }] }),
    ).toMatch(/kategori/i);
  });
});

describe("periksaSaldoAwalPihakLawan — R7, 0049 nol_sementara", () => {
  const sah = { tanggal: "2026-10-01", amount: 1_000_000, sementara: false, alasan: "rekap BPR" };
  it("Rp 0 hanya bila sementara", () => {
    expect(periksaSaldoAwalPihakLawan({ ...sah, amount: 0 })).toMatch(/SEMENTARA/);
    expect(periksaSaldoAwalPihakLawan({ ...sah, amount: 0, sementara: true })).toBeNull();
  });
  it("alasan wajib, tanggal & nominal sah", () => {
    expect(periksaSaldoAwalPihakLawan({ ...sah, alasan: "  " })).toMatch(/Alasan wajib/);
    expect(periksaSaldoAwalPihakLawan({ ...sah, tanggal: "1-10-2026" })).toMatch(/Tanggal/);
    expect(periksaSaldoAwalPihakLawan({ ...sah, amount: 1.234 })).toMatch(/Nominal/);
    expect(periksaSaldoAwalPihakLawan(sah)).toBeNull();
  });
});

describe("pasangan unit — satu pengisian, dua sisi berlawanan tanda (R7)", () => {
  it("unit A piutang +X ⇔ unit B hutang −X", () => {
    expect(nominalSisiLawan(500_000_000)).toBe(-500_000_000);
    expect(nominalSisiLawan(-25)).toBe(25);
    expect(Object.is(nominalSisiLawan(0), 0)).toBe(true); // bukan −0
  });
});

describe("saldoPihakLawan — saldo pembuka + (−Σ amount) per business_date (KTD2)", () => {
  const P = "pl-1";
  const m = (businessDate: string, rupiah: number, over: Partial<MutasiPihakLawan> = {}): MutasiPihakLawan => ({
    pihakLawanId: P,
    businessDate,
    amountSen: rupiah * 100,
    void: false,
    ...over,
  });
  const mutasi = [
    m("2026-10-02", -6_000_000), // kas keluar ke kreditur = hutang berkurang / piutang bertambah
    m("2026-10-05", 2_000_000), // kas masuk dari pihak lawan
    m("2026-10-06", -1, { void: true }), // void tak dihitung
    m("2026-10-03", -999, { pihakLawanId: "lain" }), // pihak lawan lain tak dihitung
    m("2026-10-09", -500_000),
  ];

  it("positif = piutang; kas keluar menambah piutang, kas masuk menguranginya", () => {
    const s = saldoPihakLawan({
      pihakLawanId: P,
      saldoAwal: { tanggal: "2026-10-01", amountSen: -10_000_000 * 100, sementara: false },
      mutasi,
      per: "2026-10-05",
    });
    // −10 jt (hutang pembuka) + 6 jt − 2 jt = −6 jt
    expect(s.saldoSen).toBe(-6_000_000 * 100);
    expect(s.nMutasi).toBe(2);
  });

  it("per tanggal: baris sesudah tanggal itu tidak ikut", () => {
    const s = saldoPihakLawan({ pihakLawanId: P, saldoAwal: null, mutasi, per: "2026-10-09" });
    expect(s.saldoSen).toBe((6_000_000 - 2_000_000 + 500_000) * 100);
    expect(saldoPihakLawan({ pihakLawanId: P, saldoAwal: null, mutasi, per: "2026-10-01" }).saldoSen).toBe(0);
  });

  it("🔴 baris SEBELUM tanggal saldo pembuka tidak dihitung dua kali — dan disebut jumlahnya", () => {
    const s = saldoPihakLawan({
      pihakLawanId: P,
      saldoAwal: { tanggal: "2026-10-04", amountSen: 100, sementara: true },
      mutasi,
      per: "2026-10-31",
    });
    // pembuka 1 sen + (−2 jt) + 500 rb; baris 2 Okt sudah termuat di pembuka.
    expect(s.saldoSen).toBe(100 - 2_000_000 * 100 + 500_000 * 100);
    expect(s.nPraSaldoAwal).toBe(1);
    expect(s.sementara).toBe(true);
  });

  it("tanggal sebelum saldo pembuka berlaku: pembuka belum dihitung", () => {
    const s = saldoPihakLawan({
      pihakLawanId: P,
      saldoAwal: { tanggal: "2026-10-04", amountSen: 100, sementara: false },
      mutasi,
      per: "2026-10-03",
    });
    expect(s.saldoSen).toBe(6_000_000 * 100);
    expect(s.saldoAwalBerlaku).toBe(false);
  });
});

describe("pihakLawanUntuk — layar tak menawarkan pilihan yang pasti ditolak", () => {
  const semua = [
    { id: "a", nama: "BPR", jenis: "kreditur" as const },
    { id: "b", nama: "Outlet Bright", jenis: "titipan" as const },
    { id: "c", nama: "Bakau", jenis: "unit" as const },
  ];
  it("sejalan periksaPihakLawanMutasi", () => {
    expect(pihakLawanUntuk("Penyerahan titipan", semua).map((p) => p.id)).toEqual(["b"]);
    expect(pihakLawanUntuk("Hutang Piutang", semua).map((p) => p.id)).toEqual(["a", "c"]);
    expect(pihakLawanUntuk("Biaya Operasional", semua)).toEqual([]);
    for (const k of ["Penyerahan titipan", "Hutang Piutang"]) {
      for (const p of pihakLawanUntuk(k, semua)) {
        expect(periksaPihakLawanMutasi({ categoryLabel: k, pihakLawanId: p.id, pihak: { ...p, aktif: true } })).toBeNull();
      }
    }
  });
});
