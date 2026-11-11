import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { edcBelumDiposting, rakitShiftEdc, type CekSlip, type EdcEasymaxShift, type PetaKartu } from "./edc-shift-model";
import { pesanEdcBelumDiposting, syaratKelengkapan } from "./keuangan-kelengkapan";
import type { KelengkapanInput } from "./keuangan-input-queries";

/**
 * Kelengkapan Layar 4 — butir "EDC per shift belum diposting" (2026-11-11).
 * Data SINTETIS; bentuknya meniru hari dengan dua bank di tiga shift.
 */

const e = (cshift: string, ckdkartu: string, rp: number, n = 1): EdcEasymaxShift => ({
  cshift,
  ckdkartu,
  namaKartu: `kartu ${ckdkartu}`,
  rp,
  n,
});
const PETA: PetaKartu[] = [
  { ckdkartu: "C012", acquirer: "BRI" },
  { ckdkartu: "QR001", acquirer: "MANDIRI" },
];
const cek = (cshift: string, acquirer: string, rp: number, o: Partial<CekSlip> = {}): CekSlip => ({
  id: `${cshift}-${acquirer}`,
  cshift,
  acquirer,
  easymaxRp: rp,
  slipRp: rp,
  checkedByUserId: 8,
  checkedByEmail: "pengawas@x",
  checkedAt: "2026-10-23 09:00",
  reasonCode: null,
  dibukukan: true,
  adaFoto: false,
  ...o,
});
const EASYMAX = [e("1", "C012", 300_000), e("1", "QR001", 10_210_300, 21), e("2", "QR001", 4_910_405, 8)];

const lengkap = (edc: KelengkapanInput["edcBelumDiposting"]): KelengkapanInput => ({
  hargaBeliLengkap: true,
  produkTanpaHarga: 0,
  adaAkunKas: true,
  settlementBelumCair: 0,
  biayaMenungguTinjauan: 0,
  edcBelumDiposting: edc,
});
const dari = (cs: CekSlip[], easymax = EASYMAX, peta = PETA) =>
  edcBelumDiposting(rakitShiftEdc(easymax, peta, cs));

describe("edcBelumDiposting — sel layar pengawas yang belum terposting", () => {
  it("🔴 EDC ada, belum satu pun dicek ⇒ semua sel muncul, total = bruto EasyMax", () => {
    const r = dari([]);
    expect(r.sel.map((s) => `${s.cshift}|${s.acquirer}|${s.status}`)).toEqual([
      "1|BRI|belum_dicek",
      "1|MANDIRI|belum_dicek",
      "2|MANDIRI|belum_dicek",
    ]);
    expect(r.totalRp).toBe(15_420_705);
  });

  it("🔴 semua sel terposting ⇒ kosong; butir kelengkapan HILANG", () => {
    const r = dari([cek("1", "BRI", 300_000), cek("1", "MANDIRI", 10_210_300), cek("2", "MANDIRI", 4_910_405)]);
    expect(r).toEqual({ sel: [], kartuTanpaPeta: [], totalRp: 0 });
    expect(pesanEdcBelumDiposting(r)).toBeNull();
    expect(syaratKelengkapan(lengkap(r))).toEqual([]);
  });

  it("cek yang DITAHAN (selisih / cocok-belum-diposting) masih dihitung belum diposting", () => {
    const r = dari([
      cek("1", "BRI", 300_000, { dibukukan: false, slipRp: 299_000 }),
      cek("1", "MANDIRI", 10_210_300, { dibukukan: false }),
      cek("2", "MANDIRI", 4_910_405),
    ]);
    expect(r.sel.map((s) => `${s.cshift}|${s.acquirer}|${s.status}`)).toEqual(["1|BRI|selisih", "1|MANDIRI|cocok"]);
    expect(r.totalRp).toBe(10_510_300);
  });

  it("cek basi (EasyMax berubah sesudah dicek, belum diposting) ikut dihitung", () => {
    const r = dari([cek("1", "BRI", 250_000, { dibukukan: false })], [e("1", "C012", 300_000)]);
    expect(r.sel).toEqual([{ cshift: "1", acquirer: "BRI", easymaxRp: 300_000, status: "berubah_sesudah_dicek" }]);
  });

  it("cek tanpa transaksi EasyMax (kelompoknya lenyap dari POS) TIDAK dihitung — tak ada penjualan untuk diposting", () => {
    const r = dari([cek("3", "BCA", 100_000, { dibukukan: false })], []);
    expect(r.sel).toEqual([]);
  });

  it("kartu tanpa peta bank ikut — penjualannya nyata tetapi tak bisa diposting", () => {
    const r = dari([], [e("1", "XX9", 125_000)], PETA);
    expect(r.sel).toEqual([]);
    expect(r.kartuTanpaPeta.map((k) => k.ckdkartu)).toEqual(["XX9"]);
    expect(r.totalRp).toBe(125_000);
    expect(pesanEdcBelumDiposting(r)).toMatch(/kartu XX9 belum dipetakan ke bank Rp 125\.000/);
  });

  it("hari tanpa EDC ⇒ tak ada butir", () => {
    expect(pesanEdcBelumDiposting(dari([], []))).toBeNull();
  });
});

describe("syaratKelengkapan — kalimat & hitungan 'N belum'", () => {
  it("🔴 butir EDC muncul dengan shift, bank, Rp, keadaan, dan total; menambah satu ke hitungan", () => {
    const k = { ...lengkap(dari([cek("2", "MANDIRI", 4_910_405)])), settlementBelumCair: 2 };
    const s = syaratKelengkapan(k);
    expect(s).toHaveLength(2);
    expect(s[0]).toBe("2 settlement EDC belum disetujui");
    expect(s[1]).toBe(
      "EDC per shift belum diposting — shift 1 BRI Rp 300.000 (belum dicek pengawas), " +
        "shift 1 MANDIRI Rp 10.210.300 (belum dicek pengawas); total Rp 10.510.300",
    );
  });

  it("butir lama tetap sama", () => {
    const s = syaratKelengkapan({
      hargaBeliLengkap: false,
      produkTanpaHarga: 3,
      adaAkunKas: false,
      settlementBelumCair: 1,
      biayaMenungguTinjauan: 4,
      edcBelumDiposting: { sel: [], kartuTanpaPeta: [], totalRp: 0 },
    });
    expect(s).toEqual([
      "3 produk belum punya harga beli",
      "belum ada akun kas",
      "1 settlement EDC belum disetujui",
      "4 baris biaya menunggu tinjauan",
    ]);
  });
});

describe("penjaga teks — bahan sama dengan layar pengawas, dan TIDAK menahan tutup hari", () => {
  const baca = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
  const Q = baca("keuangan-input-queries.ts");
  const PANEL = baca("../components/keuangan/TutupHariPanel.tsx");

  it("kueri kelengkapan memakai getEdcPerShift/getPetaKartu/getCekSlip + rakitShiftEdc (bukan kueri tiruan)", () => {
    const fn = Q.slice(Q.indexOf("export async function getKelengkapanInput"));
    expect(fn).toMatch(/getEdcPerShift\(unit, date\)/);
    expect(fn).toMatch(/getPetaKartu\(unit\)/);
    expect(fn).toMatch(/getCekSlip\(unit, date\)/);
    expect(fn).toMatch(/edcBelumDiposting\(rakitShiftEdc\(edcShift, petaKartu, cekSlip\)\)/);
  });

  it("blank-card tetap tersisih di sumbernya (SQL_EDC_PER_SHIFT)", () => {
    expect(baca("edc-shift-queries.ts")).toMatch(/AND e\.ckdkartu IS NOT NULL AND trim\(e\.ckdkartu\) <> ''/);
  });

  it("🔴 kelengkapan TIDAK ikut menentukan tombol tutup", () => {
    const tombol = PANEL.slice(PANEL.indexOf("disabled={"));
    expect(tombol.slice(0, tombol.indexOf("}") + 1)).not.toMatch(/syaratKurang|kelengkapan/);
  });
});
