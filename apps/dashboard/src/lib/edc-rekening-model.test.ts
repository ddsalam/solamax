import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalisasiEdc,
  rekeningBerlaku,
  saranRekening,
  susunPengaturanEdc,
  type KartuEdc,
  type VersiRekening,
} from "./edc-rekening-model";
import { temuanPengaturanEdc } from "./keuangan-pantau-model";
import { canAturRekeningEdc, canPetakanKartuEdc } from "./keuangan-wewenang";

const v = (o: Partial<VersiRekening> & Pick<VersiRekening, "acquirer" | "toAccountId" | "berlakuSejak">): VersiRekening => ({
  id: `${o.acquirer}-${o.berlakuSejak}-${o.toAccountId}`,
  namaAkun: `Bank ${o.toAccountId}`,
  catatan: null,
  oleh: "finance@x",
  dibuat: `${o.berlakuSejak} 09:00`,
  void: false,
  ...o,
});
const k = (ckdkartu: string, acquirer: string | null, rp: number, n = 1): KartuEdc => ({
  ckdkartu,
  namaKartu: `kartu ${ckdkartu}`,
  acquirer,
  rp,
  n,
});

describe("rekeningBerlaku — versi aktif dengan tanggal berlaku terbesar ≤ tanggal", () => {
  const riwayat = [
    v({ acquirer: "BCA", toAccountId: "A", berlakuSejak: "2026-10-01" }),
    v({ acquirer: "BCA", toAccountId: "B", berlakuSejak: "2026-11-15" }),
    v({ acquirer: "MANDIRI", toAccountId: "M", berlakuSejak: "2026-10-01" }),
  ];

  it("sebelum pengaturan pertama → null (belum diatur, BUKAN rekening pertama)", () => {
    expect(rekeningBerlaku(riwayat, "BCA", "2026-09-30")).toBeNull();
  });
  it("tepat di tanggal berlaku → versi itu", () => {
    expect(rekeningBerlaku(riwayat, "BCA", "2026-10-01")?.toAccountId).toBe("A");
    expect(rekeningBerlaku(riwayat, "BCA", "2026-11-15")?.toAccountId).toBe("B");
  });
  it("di antara dua versi → yang lebih awal; sesudahnya → yang terbaru", () => {
    expect(rekeningBerlaku(riwayat, "BCA", "2026-11-14")?.toAccountId).toBe("A");
    expect(rekeningBerlaku(riwayat, "BCA", "2027-01-01")?.toAccountId).toBe("B");
  });
  it("🔴 versi yang dibatalkan DIABAIKAN — yang sebelumnya berlaku lagi", () => {
    const batal = riwayat.map((x) => (x.toAccountId === "B" ? { ...x, void: true } : x));
    expect(rekeningBerlaku(batal, "BCA", "2027-01-01")?.toAccountId).toBe("A");
  });
  it("EDC lain tak tercampur, dan ejaannya dirapikan (\" bca \" = BCA)", () => {
    expect(rekeningBerlaku(riwayat, "MANDIRI", "2026-12-01")?.toAccountId).toBe("M");
    expect(rekeningBerlaku(riwayat, " bca ", "2026-10-02")?.toAccountId).toBe("A");
    expect(rekeningBerlaku(riwayat, "BRI", "2026-12-01")).toBeNull();
  });
});

describe("normalisasiEdc — ejaan tunggal, sama dengan peta kode kartu", () => {
  it("huruf besar, spasi dirapikan", () => {
    expect(normalisasiEdc("  link  aja ")).toBe("LINK AJA");
    expect(normalisasiEdc("Mandiri")).toBe("MANDIRI");
  });
  it("sama dengan cara simpanPetaKartu merapikan acquirer (satu ejaan di dua jalur)", () => {
    const src = readFileSync(resolve(__dirname, "edc-shift-actions.ts"), "utf8");
    expect(src).toMatch(/\.trim\(\)\.replace\(\/\\s\+\/g, " "\)\.toUpperCase\(\)/);
  });
});

describe("saranRekening — formulir batch settlement", () => {
  const riwayat = [v({ acquirer: "BCA", toAccountId: "A", berlakuSejak: "2026-10-01" })];
  it("memakai tanggal UANG MASUK: pengaturan yang belum berlaku tak disarankan", () => {
    expect(saranRekening(riwayat, "BCA", "2026-09-30", "A").keadaan).toBe("belum_diatur");
    expect(saranRekening(riwayat, "BCA", "2026-10-01", "A").keadaan).toBe("sesuai");
  });
  it("rekening pilihan tangan yang berbeda → 'beda', tidak ditimpa", () => {
    const s = saranRekening(riwayat, "BCA", "2026-10-02", "X");
    expect(s.keadaan).toBe("beda");
    if (s.keadaan === "beda") expect(s.versi.toAccountId).toBe("A");
  });
  it("acquirer kosong → belum diatur (tak ada yang disarankan)", () => {
    expect(saranRekening(riwayat, "  ", "2026-10-02", "A").keadaan).toBe("belum_diatur");
  });
});

describe("susunPengaturanEdc — isi layar", () => {
  const kartu = [
    k("C003", "BCA", 60_000_000, 40),
    k("QR01", "BCA", 30_000_000, 90),
    k("QRST", "MANDIRI", 29_000_000, 70),
    k("LA001", "LINKAJA", 3_000_000, 5),
    k("X9", null, 400_000, 1),
    k("OLD", null, 0, 0),
  ];
  const versi = [
    v({ acquirer: "BCA", toAccountId: "A", berlakuSejak: "2026-10-01" }),
    v({ acquirer: "BCA", toAccountId: "B", berlakuSejak: "2026-12-01" }),
    v({ acquirer: "BRI", toAccountId: "R", berlakuSejak: "2026-10-01" }),
  ];
  const { edc, kartuTanpaPeta } = susunPengaturanEdc(kartu, versi, "2026-10-05");

  it("EDC = gabungan peta kartu ∪ pengaturan — BRI tanpa kode tetap tampil", () => {
    expect(edc.map((e) => e.acquirer)).toEqual(["BCA", "MANDIRI", "LINKAJA", "BRI"]);
  });
  it("penjualan dijumlah per EDC, terbesar di atas", () => {
    const bca = edc.find((e) => e.acquirer === "BCA")!;
    expect(bca.rp).toBe(90_000_000);
    expect(bca.n).toBe(130);
    expect(bca.kartu.map((x) => x.ckdkartu)).toEqual(["C003", "QR01"]);
  });
  it("rekening kini + pergantian terjadwal dipisahkan", () => {
    const bca = edc.find((e) => e.acquirer === "BCA")!;
    expect(bca.kini?.toAccountId).toBe("A");
    expect(bca.berikutnya?.toAccountId).toBe("B");
    expect(bca.riwayat.map((x) => x.toAccountId)).toEqual(["B", "A"]);
  });
  it("EDC tanpa pengaturan → kini null", () => {
    expect(edc.find((e) => e.acquirer === "LINKAJA")!.kini).toBeNull();
  });
  it("kode tanpa peta hanya yang BERJUALAN — kode sepi tak menagih apa pun", () => {
    expect(kartuTanpaPeta.map((x) => x.ckdkartu)).toEqual(["X9"]);
  });
});

describe("temuanPengaturanEdc — kesiapan di Pemantauan", () => {
  const r = (ckdkartu: string, acquirer: string | null, adaRekening: boolean) => ({
    unitId: 1,
    ckdkartu,
    acquirer,
    adaRekening,
  });
  it("unit tanpa penjualan EDC tak ditagih apa pun", () => {
    expect(temuanPengaturanEdc([])).toEqual([]);
  });
  it("kode tanpa EDC & EDC tanpa rekening → dua temuan kuning, EDC disebut sekali", () => {
    const t = temuanPengaturanEdc([
      r("X9", null, false),
      r("C003", "BCA", false),
      r("QR01", "BCA", false),
      r("QRST", "MANDIRI", true),
    ]);
    expect(t.map((x) => [x.kode, x.nada])).toEqual([
      ["edc_kode_tanpa_peta", "kuning"],
      ["edc_tanpa_rekening", "kuning"],
    ]);
    expect(t[1]!.rinci.startsWith("BCA —")).toBe(true);
  });
  it("lengkap → satu hijau", () => {
    const t = temuanPengaturanEdc([r("C003", "BCA", true)]);
    expect(t).toHaveLength(1);
    expect(t[0]!.nada).toBe("hijau");
  });
});

describe("canAturRekeningEdc — tim Finance (keputusan owner 26 Sep 2026)", () => {
  const HOF = ["hof@x"];
  it("staf keuangan, HoF (apa pun perannya), Direksi, super admin", () => {
    expect(canAturRekeningEdc({ role: "keuangan", email: "staf@x" }, HOF)).toBe(true);
    expect(canAturRekeningEdc({ role: "admin_perusahaan", email: "hof@x" }, HOF)).toBe(true);
    expect(canAturRekeningEdc({ role: "direksi", email: "a@x" }, HOF)).toBe(true);
    expect(canAturRekeningEdc({ role: "super_admin", email: "a@x" }, HOF)).toBe(true);
  });
  it("BUKAN pengawas, BUKAN admin perusahaan biasa", () => {
    expect(canAturRekeningEdc({ role: "pengawas", email: "a@x" }, HOF)).toBe(false);
    expect(canAturRekeningEdc({ role: "admin_perusahaan", email: "a@x" }, HOF)).toBe(false);
  });
  it("🔴 berbeda dari peta kode kartu DENGAN SENGAJA — dua predikat, dua daftar", () => {
    // Staf keuangan boleh mengatur rekening, tapi tidak memetakan kode (§10.25);
    // pengawas sebaliknya. Kalau keduanya disatukan, salah satu keputusan hilang.
    expect(canAturRekeningEdc({ role: "keuangan", email: "staf@x" }, HOF)).toBe(true);
    expect(canPetakanKartuEdc({ role: "keuangan", email: "staf@x" }, HOF)).toBe(false);
    expect(canAturRekeningEdc({ role: "pengawas", email: "a@x" }, HOF)).toBe(false);
    expect(canPetakanKartuEdc({ role: "pengawas", email: "a@x" }, HOF)).toBe(true);
  });
});

describe("server action — pengaturan tak pernah ditimpa, selalu diaudit", () => {
  const src = readFileSync(resolve(__dirname, "edc-rekening-actions.ts"), "utf8");
  const tanpaKomentar = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
    .join("\n");

  it("tidak ada DELETE, dan UPDATE hanya untuk membatalkan (void)", () => {
    expect(tanpaKomentar).not.toMatch(/DELETE\s+FROM/i);
    const updates = [...tanpaKomentar.matchAll(/UPDATE app\.edc_rekening_pencairan[\s\S]*?SET ([^\n]*)/g)];
    expect(updates.length).toBeGreaterThan(0); // jangan hijau karena kosong
    for (const u of updates) expect(u[1]).toMatch(/^void = true/);
  });
  it("setiap jalan tulis mencatat audit_log", () => {
    expect((tanpaKomentar.match(/INSERT INTO app\.audit_log/g) ?? []).length).toBe(2);
  });
  it("wewenang dicek di KEDUA action, di server", () => {
    expect((tanpaKomentar.match(/canAturRekeningEdc\(/g) ?? []).length).toBe(2);
  });
});
