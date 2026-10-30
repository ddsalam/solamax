import { describe, expect, it } from "vitest";
import {
  MAKS_BERKAS_BYTE,
  bandingkanSaldoAwal,
  daftarBulan,
  nomorRekeningSama,
  normalisasiNomorRekening,
  periksaBerkas,
  periodeAwal,
  selMatriks,
} from "./impor-bank-model";

describe("nomor rekening ternormalisasi (KTD13, R18)", () => {
  it("digit saja, nol di depan dibuang — kepala 10 digit = sumber lain 11 digit", () => {
    expect(normalisasiNomorRekening("05125036811")).toBe("5125036811");
    expect(normalisasiNomorRekening("512-503 6811")).toBe("5125036811");
    expect(nomorRekeningSama("5125036811", "05125036811")).toBe(true);
  });
  it("beda angka ⇒ tidak sama; kosong / nol semua ⇒ tidak pernah sama", () => {
    expect(nomorRekeningSama("5125036811", "5125978301")).toBe(false);
    expect(nomorRekeningSama("", "")).toBe(false);
    expect(nomorRekeningSama("0000000000", "0")).toBe(false);
    expect(nomorRekeningSama(null, "5125036811")).toBe(false);
  });
});

describe("periode & bulan matriks", () => {
  it("YYYY-MM ⇒ hari pertama bulan", () => {
    expect(periodeAwal("2026-09")).toBe("2026-09-01");
    expect(() => periodeAwal("2026-9")).toThrow();
  });
  it("daftar bulan inklusif, melintasi tahun", () => {
    expect(daftarBulan("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(daftarBulan("2026-10", "2026-10")).toEqual(["2026-10"]);
    expect(daftarBulan("2026-10", "2026-09")).toEqual([]);
  });
});

describe("periksaBerkas — sebelum dibaca pdftotext", () => {
  it("kosong & lebih dari batas ⇒ pesan jelas yang menyebut batasnya", () => {
    expect(periksaBerkas(0)).toMatch(/kosong/);
    const besar = periksaBerkas(MAKS_BERKAS_BYTE + 1);
    expect(besar).toMatch(/1 MB/);
    expect(besar).toMatch(/30–75 KB/);
    expect(periksaBerkas(75 * 1024)).toBeNull();
    expect(periksaBerkas(MAKS_BERKAS_BYTE)).toBeNull();
  });
});

describe("bandingkanSaldoAwal (R18) — saldo buku hari sebelum periode vs saldo awal rekening koran", () => {
  it("cocok tepat Rp 0", () => {
    expect(
      bandingkanSaldoAwal({ periode: "2026-10", saldoAwalSen: 100_00, buku: { cutOver: "2026-10-01", saldoSen: 100_00, sementara: false } }),
    ).toEqual({ status: "cocok", bukuSen: 100_00, selisihSen: 0, sementara: false });
  });
  it("selisih = rekening koran − buku; bertanda sementara bila saldo pembuka sementara (§10.26)", () => {
    expect(
      bandingkanSaldoAwal({ periode: "2026-11", saldoAwalSen: 150_00, buku: { cutOver: "2026-10-01", saldoSen: 100_01, sementara: true } }),
    ).toEqual({ status: "selisih", bukuSen: 100_01, selisihSen: 49_99, sementara: true });
  });
  it("rekening tanpa saldo pembuka ⇒ tidak dibandingkan", () => {
    expect(bandingkanSaldoAwal({ periode: "2026-10", saldoAwalSen: 1, buku: null })).toEqual({
      status: "tanpa-saldo-pembuka",
    });
  });
  it("🔴 rekening tanpa saldo pembuka sendiri, bulan SEBELUM cut-over unit ⇒ 'sebelum-cut-over' (sama dengan kepala baris & pra_cutover)", () => {
    expect(bandingkanSaldoAwal({ periode: "2026-09", saldoAwalSen: 1, buku: null, cutOverUnit: "2026-10-01" })).toEqual({
      status: "sebelum-cut-over",
      cutOver: "2026-10-01",
    });
    expect(bandingkanSaldoAwal({ periode: "2026-10", saldoAwalSen: 1, buku: null, cutOverUnit: "2026-10-01" })).toEqual({
      status: "tanpa-saldo-pembuka",
    });
  });
  it("AE8: periode mulai SEBELUM cut-over (termasuk cut-over di tengah bulan) ⇒ tidak dibandingkan", () => {
    const buku = { cutOver: "2026-10-01", saldoSen: 5, sementara: false };
    expect(bandingkanSaldoAwal({ periode: "2026-09", saldoAwalSen: 1, buku })).toEqual({
      status: "sebelum-cut-over",
      cutOver: "2026-10-01",
    });
    expect(
      bandingkanSaldoAwal({ periode: "2026-10", saldoAwalSen: 1, buku: { ...buku, cutOver: "2026-10-15" } }),
    ).toEqual({ status: "sebelum-cut-over", cutOver: "2026-10-15" });
  });
});

describe("selMatriks — satu sel (rekening × bulan)", () => {
  const rk = (status: "aktif" | "ditarik", over: Partial<{ nBaris: number; nPraCutover: number; nCocok: number; uploadedAt: string }> = {}) => ({
    id: status,
    status,
    nBaris: 10,
    nPraCutover: 0,
    nCocok: 0,
    uploadedAt: "2026-10-29T01:00:00Z",
    ...over,
  });
  it("tanpa rekening koran ⇒ belum diunggah", () => {
    expect(selMatriks([])).toEqual({ status: "belum" });
  });
  it("yang AKTIF menang atas yang ditarik; terbuka = N − pra-cut-over − tercocok (U10)", () => {
    expect(selMatriks([rk("ditarik"), rk("aktif", { nBaris: 12, nPraCutover: 2 })])).toEqual({
      status: "diunggah",
      id: "aktif",
      nBaris: 12,
      nTerbuka: 10,
    });
    expect(selMatriks([rk("aktif", { nBaris: 12, nPraCutover: 2, nCocok: 7 })])).toMatchObject({ nTerbuka: 3 });
  });
  it("hanya yang ditarik ⇒ ditarik", () => {
    expect(selMatriks([rk("ditarik")])).toEqual({ status: "ditarik", id: "ditarik" });
  });
});
