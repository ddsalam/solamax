import { describe, expect, it } from "vitest";
import {
  berubahSesudahDiposting,
  bolehDisetujui,
  butuhAlasan,
  PESAN_HASIL_CEK,
  perluKeputusanFinance,
  rakitShiftEdc,
  statusBaris,
  vonisCekSlip,
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

describe("posting otomatis saat pengawas mencocokkan — R15, R16, KTD7", () => {
  it("AE3 shift 2: slip Rp 8.000.000 = EasyMax Rp 8.000.000 → terposting", () => {
    expect(vonisCekSlip({ slipRp: 8_000_000, easymaxRp: 8_000_000, riwayat: [] })).toBe("terposting");
  });

  it("AE3 shift 3: slip Rp 7.950.000 vs EasyMax Rp 8.000.000 → ditahan", () => {
    expect(vonisCekSlip({ slipRp: 7_950_000, easymaxRp: 8_000_000, riwayat: [] })).toBe("ditahan");
  });

  it("🔴 cek ulang slip = EasyMax sesudah PERNAH beda (cek lama sudah batal) → tetap ditahan", () => {
    const riwayat = [{ slipRp: 7_950_000, easymaxRp: 8_000_000 }];
    expect(vonisCekSlip({ slipRp: 8_000_000, easymaxRp: 8_000_000, riwayat })).toBe("ditahan");
  });

  it("riwayat yang selalu cocok tidak menahan cek berikutnya", () => {
    const riwayat = [{ slipRp: 5_000_000, easymaxRp: 5_000_000 }];
    expect(vonisCekSlip({ slipRp: 8_000_000, easymaxRp: 8_000_000, riwayat })).toBe("terposting");
  });

  it("pecahan sen bukan beda — di cek ini maupun di riwayat", () => {
    const riwayat = [{ slipRp: 1_000_000, easymaxRp: 1_000_000.4 }];
    expect(vonisCekSlip({ slipRp: 1_000_000, easymaxRp: 1_000_000.4, riwayat })).toBe("terposting");
  });

  it("kalimat hasil untuk pengawas", () => {
    expect(PESAN_HASIL_CEK.terposting).toBe("Terposting");
    expect(PESAN_HASIL_CEK.ditahan).toBe("Ditahan, menunggu Finance");
  });
});

describe("berubah sesudah diposting — KTD7", () => {
  it("nominal terposting ≠ EasyMax sekarang → berubah", () => {
    expect(berubahSesudahDiposting(cek({ dibukukan: true, easymaxRp: 8_000_000 }), 8_100_000)).toBe(true);
  });
  it("kelompok lenyap dari EasyMax sesudah diposting → berubah", () => {
    expect(berubahSesudahDiposting(cek({ dibukukan: true, easymaxRp: 8_000_000 }), 0)).toBe(true);
  });
  it("terposting dan EasyMax tetap → tidak berubah", () => {
    expect(berubahSesudahDiposting(cek({ dibukukan: true, easymaxRp: 8_000_000 }), 8_000_000)).toBe(false);
  });
  it("belum terposting bukan urusan detektor ini (itu berubah_sesudah_dicek)", () => {
    expect(berubahSesudahDiposting(cek({ dibukukan: false, easymaxRp: 8_000_000 }), 8_100_000)).toBe(false);
    expect(berubahSesudahDiposting(null, 8_100_000)).toBe(false);
  });

  it("rakitShiftEdc menandai baris & daftar keputusan Finance memuatnya — yang terposting utuh tidak", () => {
    const { baris } = rakitShiftEdc(
      [e("1", "BRI1", 8_100_000), e("2", "BRI1", 8_000_000), e("3", "BRI1", 8_000_000), e("4", "BRI1", 8_000_000)],
      [{ ckdkartu: "BRI1", acquirer: "BRI" }],
      [
        cek({ id: "a", cshift: "1", acquirer: "BRI", easymaxRp: 8_000_000, slipRp: 8_000_000, dibukukan: true }),
        cek({ id: "b", cshift: "2", acquirer: "BRI", easymaxRp: 8_000_000, slipRp: 8_000_000, dibukukan: true }),
        cek({ id: "c", cshift: "3", acquirer: "BRI", easymaxRp: 8_000_000, slipRp: 7_950_000 }),
      ],
    );
    expect(baris.map((b) => [b.cshift, b.status, b.berubahSesudahDiposting, perluKeputusanFinance(b)])).toEqual([
      ["1", "dibukukan", true, true],
      ["2", "dibukukan", false, false],
      ["3", "selisih", false, true],
      ["4", "belum_dicek", false, false],
    ]);
  });
});
