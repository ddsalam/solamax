import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bolehDisetujui,
  butuhAlasan,
  rakitShiftEdc,
  statusBaris,
  type CekSlip,
  type EdcEasymaxShift,
} from "./edc-shift-model";
import { canCekSlipEdc, canPetakanKartuEdc } from "./keuangan-wewenang";

const e = (cshift: string, ckdkartu: string, rp: number, n = 1): EdcEasymaxShift => ({
  cshift,
  ckdkartu,
  namaKartu: `kartu ${ckdkartu}`,
  rp,
  n,
});
const cek = (o: Partial<CekSlip>): CekSlip => ({
  id: "c1",
  cshift: "1",
  acquirer: "BCA",
  easymaxRp: 1_000_000,
  slipRp: 1_000_000,
  checkedByUserId: 7,
  checkedByEmail: "pengawas@x",
  checkedAt: "2026-09-26 21:00",
  reasonCode: null,
  dibukukan: false,
  adaFoto: false,
  ...o,
});

describe("rakitShiftEdc — per shift × bank, dari EasyMax", () => {
  it("dua kode kartu ke bank yang sama dijumlah dalam satu baris", () => {
    const { baris } = rakitShiftEdc(
      [e("1", "BCA1", 600_000, 3), e("1", "BCA2", 400_000, 2), e("2", "BCA1", 50_000)],
      [
        { ckdkartu: "BCA1", acquirer: "BCA" },
        { ckdkartu: "BCA2", acquirer: "BCA" },
      ],
      [],
    );
    expect(baris.map((b) => [b.cshift, b.acquirer, b.easymaxRp, b.nTransaksi])).toEqual([
      ["1", "BCA", 1_000_000, 5],
      ["2", "BCA", 50_000, 1],
    ]);
  });

  it("🔴 kode kartu tanpa peta TIDAK ditebak ke bank mana pun — ia disebut", () => {
    const r = rakitShiftEdc([e("1", "XX9", 250_000)], [], []);
    expect(r.baris).toEqual([]);
    expect(r.kartuTanpaPeta).toEqual([{ ckdkartu: "XX9", namaKartu: "kartu XX9", rp: 250_000, n: 1 }]);
  });

  it("cek yang kelompoknya hilang dari EasyMax tetap tampil — sebagai berubah, bukan lenyap", () => {
    const { baris } = rakitShiftEdc([], [], [cek({})]);
    expect(baris).toHaveLength(1);
    expect(baris[0]!.status).toBe("berubah_sesudah_dicek");
  });
});

describe("statusBaris — satu pembuat vonis", () => {
  it.each([
    ["belum dicek", 1_000_000, null, "belum_dicek"],
    ["cocok", 1_000_000, cek({}), "cocok"],
    ["selisih", 1_000_000, cek({ slipRp: 990_000 }), "selisih"],
    ["pecahan sen bukan selisih", 1_000_000.4, cek({ easymaxRp: 1_000_000.4, slipRp: 1_000_000 }), "cocok"],
    ["EasyMax berubah sesudah dicek", 1_200_000, cek({}), "berubah_sesudah_dicek"],
    ["sudah dibukukan menang atas apa pun", 1_200_000, cek({ dibukukan: true }), "dibukukan"],
  ] as const)("%s", (_n, bruto, c, harap) => expect(statusBaris(bruto, c)).toBe(harap));

  it("hanya cocok & selisih yang bisa disetujui; selisih wajib alasan", () => {
    const b = (status: string) => ({ status }) as never;
    expect(["cocok", "selisih"].map((s) => bolehDisetujui(b(s)))).toEqual([true, true]);
    expect(["belum_dicek", "berubah_sesudah_dicek", "dibukukan"].map((s) => bolehDisetujui(b(s)))).toEqual([
      false,
      false,
      false,
    ]);
    expect(butuhAlasan(b("selisih"))).toBe(true);
    expect(butuhAlasan(b("cocok"))).toBe(false);
  });
});

describe("wewenang §10.25 — keputusan owner 26 Sep 2026", () => {
  const HOF = ["hof@x"];
  it("peta kartu: HoF, Direksi, super admin, pengawas — BUKAN staf keuangan", () => {
    expect(canPetakanKartuEdc({ role: "pengawas", email: "a@x" }, HOF)).toBe(true);
    expect(canPetakanKartuEdc({ role: "direksi", email: "a@x" }, HOF)).toBe(true);
    expect(canPetakanKartuEdc({ role: "super_admin", email: "a@x" }, HOF)).toBe(true);
    expect(canPetakanKartuEdc({ role: "keuangan", email: "hof@x" }, HOF)).toBe(true);
    expect(canPetakanKartuEdc({ role: "keuangan", email: "staf@x" }, HOF)).toBe(false);
    expect(canPetakanKartuEdc({ role: "admin_perusahaan", email: "a@x" }, HOF)).toBe(false);
  });
  it("cek slip: pengawas (pemegang slip) & super admin", () => {
    expect(canCekSlipEdc({ role: "pengawas", email: null })).toBe(true);
    expect(canCekSlipEdc({ role: "super_admin", email: null })).toBe(true);
    expect(canCekSlipEdc({ role: "keuangan", email: null })).toBe(false);
  });
});

describe("penjaga server action — yang tak boleh hilang", () => {
  const s = readFileSync(resolve(__dirname, "edc-shift-actions.ts"), "utf8");
  const badan = (nama: string) => {
    const i = s.indexOf(`export async function ${nama}`);
    const j = s.indexOf("\nexport ", i + 1);
    return s.slice(i, j < 0 ? undefined : j);
  };

  it("bruto dihitung ULANG di server saat mencocokkan dan saat menyetujui", () => {
    expect(badan("cekSlipEdc")).toMatch(/brutoSekarang\(/);
    expect(badan("setujuiPenjualanEdc")).toMatch(/brutoSekarang\(/);
  });

  it("🔴 yang mencocokkan tidak menyetujui cek yang sama", () => {
    expect(badan("setujuiPenjualanEdc")).toMatch(/k\.checkedByUserId === scope\.userId/);
  });

  it("gerbang wewenang mendahului koneksi DB di ketiga aksi", () => {
    for (const [nama, gerbang] of [
      ["simpanPetaKartu", "canPetakanKartuEdc("],
      ["cekSlipEdc", "canCekSlipEdc("],
      ["setujuiPenjualanEdc", "alasanTakBolehInput("],
    ] as const) {
      const b = badan(nama);
      expect(b.indexOf(gerbang), nama).toBeGreaterThan(-1);
      expect(b.indexOf(gerbang), nama).toBeLessThan(b.indexOf("pool.connect()"));
    }
  });

  it("baris dikunci (FOR UPDATE) sebelum divonis & ditulis", () => {
    expect(badan("setujuiPenjualanEdc")).toMatch(/FOR UPDATE/);
    expect(badan("cekSlipEdc")).toMatch(/FOR UPDATE/);
  });

  it("nominal yang dibukukan = bruto EasyMax dari cek, bukan slip", () => {
    const b = badan("setujuiPenjualanEdc");
    expect(b).toMatch(/cek\.easymaxRp,\s*\n\s*scope\.userId/);
    expect(b).not.toMatch(/slipRp,\s*\n\s*scope\.userId/);
  });
});
