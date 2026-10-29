import { describe, expect, it } from "vitest";
import { bukuPembantu, statusPasangan, type PihakLawanBuku } from "./buku-pembantu-model";
import { sisiKasNeraca, type MutasiSisiKas } from "./keuangan-sisi-kas";
import { saldoPihakLawan } from "./pihak-lawan-model";
import type { TitipanDiterima } from "./titipan-bright";

/**
 * U6 — "saldo per pihak per tanggal sama dengan model". Pembandingnya adalah
 * fungsi yang dipakai NERACA (`sisiKasNeraca`) dan model U3 (`saldoPihakLawan`).
 */

const row = (o: Partial<MutasiSisiKas> & { amount: number; businessDate: string; categoryLabel: string | null }): MutasiSisiKas & { keterangan: string } => ({
  accountId: "BCA",
  jenis: o.amount < 0 ? "kredit" : "debet",
  categorySide: o.amount < 0 ? "kredit" : "debet",
  saldoAwal: false,
  void: false,
  pihakLawanId: null,
  tanggalAsal: null,
  keterangan: "x",
  ...o,
});

const PIHAK: PihakLawanBuku[] = [
  { id: "bpr", jenis: "kreditur", nama: "BPR Utari", aktif: true, lawanUnitId: null,
    saldoAwal: { tanggal: "2026-10-01", amountSen: -100_000_000_00, sementara: true } },
  { id: "bl", jenis: "unit", nama: "Batu Layang", aktif: true, lawanUnitId: 3, saldoAwal: null },
  { id: "nol", jenis: "karyawan", nama: "Budi", aktif: true, lawanUnitId: null, saldoAwal: null },
  { id: "br", jenis: "titipan", nama: "Outlet Bright", aktif: true, lawanUnitId: null, saldoAwal: null },
  { id: "kb", jenis: "titipan", nama: "Kebab", aktif: true, lawanUnitId: null,
    saldoAwal: { tanggal: "2026-10-05", amountSen: -1_000_000_00, sementara: false } },
];

const MUTASI = [
  row({ amount: 0, businessDate: "2026-10-01", jenis: "adjustment", categorySide: null, categoryLabel: null, saldoAwal: true }),
  row({ amount: 2_000_000, businessDate: "2026-10-03", categoryLabel: "Hutang Piutang", pihakLawanId: "bpr" }),
  row({ amount: -500_000_000, businessDate: "2026-10-04", categoryLabel: "Hutang Piutang", pihakLawanId: "bl" }),
  row({ amount: 100_000_000, businessDate: "2026-10-20", categoryLabel: "Hutang Piutang", pihakLawanId: "bl", tanggalAsal: "2026-10-18" }),
  row({ amount: 7_000_000, businessDate: "2026-10-06", categoryLabel: "Hutang Piutang" }), // belum ditetapkan
  row({ amount: -3_000_000, businessDate: "2026-10-07", categoryLabel: "Penyerahan titipan", pihakLawanId: "br" }),
  row({ amount: -800_000, businessDate: "2026-10-04", categoryLabel: "Penyerahan titipan", pihakLawanId: "kb" }), // pra-pembuka
  row({ amount: -200_000, businessDate: "2026-10-08", categoryLabel: "Penyerahan titipan", pihakLawanId: "kb" }),
  row({ amount: -999_000_000, businessDate: "2026-11-01", categoryLabel: "Hutang Piutang", pihakLawanId: "bl" }), // sesudah `per`
];
const DITERIMA: TitipanDiterima[] = [
  { pihakLawanId: "br", nama: "Outlet Bright", rp: 5_000_000, businessDate: "2026-10-02" },
  { pihakLawanId: null, nama: null, rp: 1_000_000, businessDate: "2026-10-03" }, // baris lama ⇒ Bright
  { pihakLawanId: "kb", nama: "Kebab", rp: 300_000, businessDate: "2026-10-09" },
];
const PER = "2026-10-25";

describe("buku pembantu — saldo SAMA dengan neraca (R2)", () => {
  const buku = bukuPembantu({ per: PER, pihak: PIHAK, mutasi: MUTASI, titipanDiterima: DITERIMA });
  const sisi = sisiKasNeraca({
    mutasi: MUTASI, date: PER, adaAkun: true, kasTerhitung: true, pihakLawan: PIHAK, titipanDiterima: DITERIMA,
  });
  const s = (id: string) => buku.find((b) => b.id === id)!;

  it("🔴 Σ saldo pihak lawan non-titipan + 'belum ditetapkan' = baris neraca Hutang piutang non-EasyMax", () => {
    const nonTitipan = buku.filter((b) => b.jenis !== "titipan").reduce((t, b) => t + b.saldoSen, 0);
    expect((nonTitipan + sisi.pihakLawanBelumDitetapkan! * 100) / 100).toBe(sisi.hutangPiutangNonEasymax);
  });

  it("🔴 tiap pemilik titipan = −(liabilitas titipan pemilik itu di neraca)", () => {
    for (const t of sisi.titipanPerPemilik) {
      expect(s(t.pihakLawanId!).saldoSen / 100, t.nama).toBe(-t.saldo);
    }
    expect(s("br").saldoSen).toBe(-(5_000_000 + 1_000_000 - 3_000_000) * 100);
    // Kebab: pembuka utang 1 jt per 5 Okt; penyerahan 4 Okt termuat; +0,3 jt diterima, −0,2 jt diserahkan.
    expect(s("kb").saldoSen).toBe(-(1_000_000 + 300_000 - 200_000) * 100);
  });

  it("non-titipan sama dengan model U3 `saldoPihakLawan`", () => {
    for (const p of PIHAK.filter((x) => x.jenis !== "titipan")) {
      const m = saldoPihakLawan({
        pihakLawanId: p.id, saldoAwal: p.saldoAwal, per: PER,
        mutasi: MUTASI.filter((x) => x.pihakLawanId === p.id).map((x) => ({
          pihakLawanId: p.id, businessDate: x.businessDate, amountSen: Math.round(x.amount * 100), void: x.void,
        })),
      });
      expect(s(p.id).saldoSen, p.nama).toBe(m.saldoSen);
    }
  });

  it("saldo ditampilkan sebagai nilai MUTLAK + arah eksplisit", () => {
    expect(s("bpr").arah).toBe("Hutang"); // −100 jt pembuka − 2 jt diterima
    expect(s("bl").arah).toBe("Piutang"); // 500 jt keluar − 100 jt kembali
    expect(s("nol").arah).toBeNull();
    expect(s("nol").saldoSen).toBe(0);
  });

  it("rincian bersaldo berjalan, urut hari buku, saldo terakhir = saldo", () => {
    for (const b of buku) {
      const akhir = b.rincian.at(-1)?.saldoSen ?? 0;
      expect(akhir, b.nama).toBe(b.saldoSen);
      const hari = b.rincian.map((r) => r.hariBuku);
      expect([...hari].sort()).toEqual(hari);
    }
    const bl = s("bl").rincian;
    expect(bl.map((r) => r.saldoSen)).toEqual([500_000_000_00, 400_000_000_00]);
    expect(bl[1]!.tanggalAsal).toBe("2026-10-18");
  });

  it("baris sebelum saldo pembuka DISEBUT jumlahnya, tidak dijumlah", () => {
    expect(s("kb").nPraSaldoAwal).toBe(1);
  });

  it("saldo pembuka sementara ditandai (§10.26)", () => {
    expect(s("bpr").sementara).toBe(true);
    expect(s("kb").sementara).toBe(false);
  });

  it("per tanggal: saldo sebelum mutasi kedua", () => {
    const awal = bukuPembantu({ per: "2026-10-10", pihak: PIHAK, mutasi: MUTASI, titipanDiterima: DITERIMA });
    expect(awal.find((b) => b.id === "bl")!.saldoSen).toBe(500_000_000_00);
  });
});

describe("statusPasangan — kolom Status (R3, R4, R5)", () => {
  it("kaki hidup yang belum dicocokkan ⇒ Dalam perjalanan; semua dicocokkan ⇒ Lunas di bank", () => {
    expect(statusPasangan([{ lawanUnitId: 3, status: "dalam_perjalanan" }], 3, { satuPt: false, tidakSeimbang: false }).kaki)
      .toBe("Dalam perjalanan");
    expect(statusPasangan([{ lawanUnitId: 3, status: "lunas_di_bank" }], 3, { satuPt: true, tidakSeimbang: false }).kaki)
      .toBe("Lunas di bank");
    expect(statusPasangan([{ lawanUnitId: 3, status: "dibatalkan" }], 3, { satuPt: false, tidakSeimbang: false }).kaki).toBeNull();
  });
});
