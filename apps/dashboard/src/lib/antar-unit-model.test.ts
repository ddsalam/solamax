import { describe, expect, it } from "vitest";
import {
  KODE_MAJU_PEMBALIK,
  barisPembalik,
  kakiAntarUnit,
  keteranganKaki,
  paritasPasangan,
  periksaAntarUnit,
  rencanaBalik,
  ringkasPasangan,
  satuPt,
  senKeTeks,
  statusKaki,
  type BarisPasangan,
} from "./antar-unit-model";

/**
 * Model MURNI pasangan antar unit (rencana 2026-10-29 U4; R3, R4, R5, R31).
 * Tanda: kaki pemberi = kredit (kas keluar, piutang naik), kaki penerima =
 * debet (kas masuk, hutang naik). Saldo pihak lawan = −Σ amount (KTD2).
 */
const IB = "6478111";
const BK = "6378301";
const BL = "6478201";
const JT = 500_000_000_00; // Rp 500 jt dalam sen

describe("satuPt (R5) — dari tenant_id public.unit (satu tenant = satu PT)", () => {
  // Peta tiruan berbentuk `DataScope.tenantPerUnit`: IB & BK berbagi tenant.
  const TENANT = new Map<string, string>([
    [IB, "tenant-spa"],
    [BK, "tenant-spa"],
    [BL, "tenant-bl"],
    ["63781002", "tenant-spe"],
  ]);
  it("🔴 IB ↔ BK = satu PT (tenant sama), dua arah", () => {
    expect(satuPt(IB, BK, TENANT)).toBe(true);
    expect(satuPt(BK, IB, TENANT)).toBe(true);
  });
  it("🔴 BK ↔ BL = beda tenant", () => {
    expect(satuPt(BK, BL, TENANT)).toBe(false);
  });
  it("28 Oktober (tenant lain) bukan satu PT dengan IB — id eksak", () => {
    expect(satuPt("63781002", IB, TENANT)).toBe(false);
  });
  it("unit tak dikenal / unit yang sama ⇒ false (bukan tebakan)", () => {
    expect(satuPt("9999999", IB, TENANT)).toBe(false);
    expect(satuPt(IB, IB, TENANT)).toBe(false);
  });
  it("🔴 tidak lagi membaca teks kop config.ts — peta kosong ⇒ false", () => {
    expect(satuPt(IB, BK, new Map())).toBe(false);
  });
});

describe("periksaAntarUnit — validasi sebelum koneksi", () => {
  const sah = {
    pemberiCode: BK,
    penerimaCode: BL,
    pemberiAccountId: "11111111-1111-4111-8111-111111111111",
    penerimaAccountId: "22222222-2222-4222-8222-222222222222",
    nominal: 500_000_000,
    tanggal: "2026-10-04",
    jenis: "pinjaman",
    catatan: "modal kerja",
  };
  it("sah ⇒ nominal sen bulat", () => {
    expect(periksaAntarUnit(sah)).toEqual({ ok: true, nominalSen: JT, jenis: "pinjaman", catatan: "modal kerja" });
  });
  it.each([
    ["unit sama", { penerimaCode: BK }],
    ["nominal nol", { nominal: 0 }],
    ["nominal negatif", { nominal: -5 }],
    ["nominal derau float", { nominal: 0.1 + 0.2 }],
    ["tanggal", { tanggal: "4 Okt" }],
    ["jenis", { jenis: "hibah" }],
    ["rekening", { pemberiAccountId: "x" }],
  ])("ditolak: %s", (_n, ubah) => {
    expect(periksaAntarUnit({ ...sah, ...ubah }).ok).toBe(false);
  });
});

describe("kaki & keterangan — jenis hanya label, arah = siapa membayar siapa", () => {
  it("pemberi kredit −X, penerima debet +X", () => {
    expect(kakiAntarUnit(JT)).toEqual({
      pemberi: { jenis: "kredit", amountSen: -JT },
      penerima: { jenis: "debet", amountSen: JT },
    });
  });
  it("pengembalian: arah tetap pembayar → penerima; hanya keterangannya berubah", () => {
    expect(keteranganKaki({ jenis: "pengembalian", peran: "pemberi", namaLawan: "Bakau", catatan: "" })).toBe(
      "Pengembalian pinjaman antar unit ke Bakau",
    );
    expect(keteranganKaki({ jenis: "pinjaman", peran: "penerima", namaLawan: "Bakau", catatan: " modal " })).toBe(
      "Pinjaman antar unit dari Bakau — modal",
    );
  });
  it("senKeTeks: numeric tanpa float", () => {
    expect(senKeTeks(-JT)).toBe("-500000000.00");
    expect(senKeTeks(1)).toBe("0.01");
    expect(senKeTeks(0)).toBe("0.00");
  });
});

describe("paritas pasangan (R4) + status kaki (R3)", () => {
  const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const kosong = { saldoAwal: null };

  it("🔴 AE1: BK → BL 500 jt, kedua hari 4 Okt: piutang BK = hutang BL; BK cocok bank, BL dalam perjalanan", () => {
    const kaki = kakiAntarUnit(JT);
    const p = paritasPasangan({
      per: "2026-10-04",
      a: { ...kosong, mutasi: [{ pasanganUuid: P, businessDate: "2026-10-04", amountSen: kaki.pemberi.amountSen, void: false }] },
      b: { ...kosong, mutasi: [{ pasanganUuid: P, businessDate: "2026-10-04", amountSen: kaki.penerima.amountSen, void: false }] },
    });
    expect(p.saldoASen).toBe(JT); // piutang BK ke BL
    expect(p.saldoBSen).toBe(-JT); // hutang BL ke BK
    expect(p.status).toBe("seimbang");
    // U10 kelak memasok id kaki yang sudah dicocokkan rekening koran.
    const cocok = new Set(["kaki-bk"]);
    expect(statusKaki({ id: "kaki-bk", void: false }, cocok)).toBe("lunas_di_bank");
    expect(statusKaki({ id: "kaki-bl", void: false }, cocok)).toBe("dalam_perjalanan");
    expect(statusKaki({ id: "kaki-bl", void: false })).toBe("dalam_perjalanan");
    expect(statusKaki({ id: "kaki-bl", void: true })).toBe("dibatalkan");
  });

  it("🔴 hari penerima tertutup: kaki BL terdorong ke 6 Okt — 4–5 Okt menunggu sisi lawan, BUKAN tidak seimbang", () => {
    const masuk = (per: string) =>
      paritasPasangan({
        per,
        a: { ...kosong, mutasi: [{ pasanganUuid: P, businessDate: "2026-10-04", amountSen: -JT, void: false }] },
        b: { ...kosong, mutasi: [{ pasanganUuid: P, businessDate: "2026-10-06", amountSen: JT, void: false }] },
      });
    expect(masuk("2026-10-04").status).toBe("menunggu_sisi_lawan");
    expect(masuk("2026-10-05").status).toBe("menunggu_sisi_lawan");
    expect(masuk("2026-10-05").dalamJendelaSen).toBe(JT);
    expect(masuk("2026-10-06").status).toBe("seimbang");
    expect(masuk("2026-10-03").status).toBe("seimbang");
  });

  it("🔴 baris Hutang Piutang TANPA pasangan ke unit lawan ⇒ tidak seimbang (cacat)", () => {
    const p = paritasPasangan({
      per: "2026-10-10",
      a: { ...kosong, mutasi: [{ pasanganUuid: null, businessDate: "2026-10-04", amountSen: -1_000_00, void: false }] },
      b: { ...kosong, mutasi: [] },
    });
    expect(p.status).toBe("tidak_seimbang");
    expect(p.selisihSen).toBe(1_000_00);
  });

  it("void diabaikan; saldo pembuka pasangan (U3, tanda berlawanan) seimbang", () => {
    const p = paritasPasangan({
      per: "2026-10-10",
      a: {
        saldoAwal: { tanggal: "2026-10-01", amountSen: 7_00, sementara: false },
        mutasi: [{ pasanganUuid: P, businessDate: "2026-10-04", amountSen: -JT, void: true }],
      },
      b: {
        saldoAwal: { tanggal: "2026-10-01", amountSen: -7_00, sementara: false },
        mutasi: [{ pasanganUuid: P, businessDate: "2026-10-04", amountSen: JT, void: true }],
      },
    });
    expect(p.status).toBe("seimbang");
    expect(p.saldoASen).toBe(7_00);
  });

  it("pembalik maju (pasangan_uuid sama) di hari berbeda: jendela, lalu seimbang lagi", () => {
    const a = [
      { pasanganUuid: P, businessDate: "2026-10-04", amountSen: -JT, void: false },
      { pasanganUuid: P, businessDate: "2026-10-10", amountSen: JT, void: false },
    ];
    const b = [
      { pasanganUuid: P, businessDate: "2026-10-04", amountSen: JT, void: false },
      { pasanganUuid: P, businessDate: "2026-10-12", amountSen: -JT, void: false },
    ];
    const per = (d: string) => paritasPasangan({ per: d, a: { ...kosong, mutasi: a }, b: { ...kosong, mutasi: b } });
    expect(per("2026-10-05").status).toBe("seimbang");
    expect(per("2026-10-11").status).toBe("menunggu_sisi_lawan");
    expect(per("2026-10-12")).toMatchObject({ status: "seimbang", saldoASen: 0, saldoBSen: 0 });
  });
});

describe("balik pasangan — rencana murni", () => {
  const baris = (o: Partial<BarisPasangan>): BarisPasangan => ({
    id: "x",
    unitId: 2,
    accountId: "acc",
    businessDate: "2026-10-04",
    amountSen: -JT,
    jenis: "kredit",
    categorySide: "kredit",
    categoryLabel: "Hutang Piutang",
    pihakLawanId: "pl",
    keterangan: "Pinjaman antar unit ke Batu Layang",
    void: false,
    alasanMaju: null,
    ...o,
  });
  const dua = [
    baris({ id: "bk", unitId: 2 }),
    baris({ id: "bl", unitId: 4, amountSen: JT, jenis: "debet", categorySide: "debet" }),
  ];

  it("dua kaki asli, satu per unit ⇒ ok", () => {
    const r = rencanaBalik(dua, [2, 4]);
    expect(r.ok).toBe(true);
  });
  it("🔴 sudah dibalik (ada baris pembalik atau kaki void) ⇒ ditolak", () => {
    expect(rencanaBalik([...dua, baris({ id: "r", alasanMaju: KODE_MAJU_PEMBALIK, amountSen: JT })], [2, 4]).ok).toBe(false);
    expect(rencanaBalik([dua[0]!, { ...dua[1]!, void: true }], [2, 4]).ok).toBe(false);
  });
  it("🔴 unit kaki ≠ unit yang lolos gerbang ⇒ ditolak", () => {
    expect(rencanaBalik(dua, [2, 5]).ok).toBe(false);
    expect(rencanaBalik([dua[0]!], [2, 4]).ok).toBe(false);
  });
  it("pembalik = tanda & sisi berlawanan, kategori/pihak lawan sama", () => {
    expect(barisPembalik(dua[0]!)).toEqual({
      jenis: "debet",
      categorySide: "debet",
      amountSen: JT,
      keterangan: "Pembalik — Pinjaman antar unit ke Batu Layang",
    });
  });
});

describe("ringkasPasangan — daftar di halaman unit", () => {
  it("satu baris per pasangan; dibalik terdeteksi dari baris pembalik", () => {
    const r = ringkasPasangan([
      { id: "k1", pasanganUuid: "p1", lawanUnitId: 4, businessDate: "2026-10-06", tanggalAsal: "2026-10-04", amountSen: -JT, void: false, alasanMaju: "ADJ-FWD-INTERUNIT", keterangan: "x", akun: "Bank" },
      { id: "k2", pasanganUuid: "p1", lawanUnitId: 4, businessDate: "2026-10-12", tanggalAsal: "2026-10-06", amountSen: JT, void: false, alasanMaju: KODE_MAJU_PEMBALIK, keterangan: "y", akun: "Bank" },
      { id: "k3", pasanganUuid: "p2", lawanUnitId: 1, businessDate: "2026-10-07", tanggalAsal: null, amountSen: 5_00, void: false, alasanMaju: null, keterangan: "z", akun: "Kas" },
    ]);
    expect(r).toHaveLength(2);
    const p1 = r.find((x) => x.pasanganUuid === "p1")!;
    expect(p1).toMatchObject({ arah: "pinjamkan", tanggal: "2026-10-04", hariBuku: "2026-10-06", dibalik: true, status: "dibatalkan" });
    const p2 = r.find((x) => x.pasanganUuid === "p2")!;
    expect(p2).toMatchObject({ arah: "terima", dibalik: false, status: "dalam_perjalanan", amountSen: 5_00 });
  });
});
