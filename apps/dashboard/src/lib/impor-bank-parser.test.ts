import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bacaRekeningKoranBca, GalatRekeningKoran, parseSen } from "./impor-bank-parser";

// Fixture SINTETIS: tata letak `pdftotext -layout` e-statement BCA (kolom,
// keterangan bertingkat, pergantian halaman, kaki) dengan nama, rekening, dan
// nominal karangan. Rekening koran asli tidak pernah masuk repo.
const fixture = (nama: string) =>
  readFileSync(new URL(`./__fixtures__/rekening-koran-sintetis-${nama}.txt`, import.meta.url), "utf8");

const tangkap = (fn: () => unknown): GalatRekeningKoran => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GalatRekeningKoran) return e;
    throw e;
  }
  throw new Error("diharapkan GalatRekeningKoran, tidak ada galat");
};

describe("parseSen", () => {
  it("membaca nominal BCA sebagai sen bulat tanpa float", () => {
    expect(parseSen("1,234,567.89")).toBe(123456789);
    expect(parseSen("0.00")).toBe(0);
    expect(parseSen("24.93")).toBe(2493);
    expect(parseSen("12,103,680,490.27")).toBe(1210368049027);
  });
  it("menolak bentuk yang bukan nominal BCA", () => {
    expect(() => parseSen("1.234,56")).toThrow(GalatRekeningKoran);
    expect(() => parseSen("12,34.00")).toThrow(GalatRekeningKoran);
    expect(() => parseSen("100")).toThrow(GalatRekeningKoran);
  });
});

describe("bacaRekeningKoranBca — giro", () => {
  const rk = bacaRekeningKoranBca(fixture("giro"));

  it("kepala: nomor rekening ternormalisasi & periode", () => {
    expect(rk.nomorRekening).toBe("9876543210");
    expect(rk.periode).toBe("2027-03");
    expect(rk.saldoAwalSen).toBe(50_000_000_000);
  });

  it("6 baris dengan nominal sen bertanda (DB negatif) & tanggal ISO", () => {
    expect(rk.rows.map((r) => [r.tanggal, r.urutan, r.amountSen, r.saldoSen])).toEqual([
      ["2027-03-03", 1, 1_234_500_000, null],
      ["2027-03-03", 2, -9_876_543_210, 41_357_956_790],
      ["2027-03-04", 1, -3_000_000, null],
      ["2027-03-05", 1, 125_000_055, null],
      ["2027-03-05", 2, -5_000_000, null],
      ["2027-03-31", 1, -432_109, 41_474_524_736],
    ]);
  });

  it("keterangan baris lanjutan digabung; kepala halaman tidak ikut", () => {
    expect(rk.rows[0]!.keterangan).toBe("KR OTOMATIS | SETORAN JEMPUTAN | 0981 / STR030327");
    expect(rk.rows[1]!.keterangan).toBe(
      "TRSF E-BANKING DB | 0303/FTSCY/WS99999 / H00001234567654321 / 98722161409 / PT MIGAS KARANGAN",
    );
    expect(rk.rows[3]!.keterangan).toBe("BI-FAST CR | BIF TRANSFER DR");
    for (const r of rk.rows) expect(r.keterangan).not.toMatch(/REKENING GIRO|Bersambung|KCP|CATATAN|HALAMAN/);
  });

  it("SO B2B: 7 digit sesudah H0000+sold-to + 3 digit pertama token berikutnya", () => {
    expect(rk.rows[1]!.so).toBe("7654321987");
    expect(rk.rows.filter((r) => r.so !== null)).toHaveLength(1);
    expect(rk.rows.every((r) => r.dokRef === null)).toBe(true);
  });

  it("kaki terbaca", () => {
    expect(rk.footer).toEqual({
      mutasiCrSen: 1_359_500_055,
      nCr: 2,
      mutasiDbSen: 9_884_975_319,
      nDb: 4,
      saldoAkhirSen: 41_474_524_736,
    });
  });
});

describe("bacaRekeningKoranBca — EDC (kaki 'SALDO AWAL :' persis sesudah baris terakhir)", () => {
  const rk = bacaRekeningKoranBca(fixture("edc"));

  it("rekening '1 234 5678 90' ternormalisasi", () => {
    expect(rk.nomorRekening).toBe("1234567890");
    expect(rk.periode).toBe("2027-05");
  });

  it("baris terakhir tidak tercemar kaki — nominal & keterangan utuh", () => {
    const akhir = rk.rows[rk.rows.length - 1]!;
    expect(akhir.amountSen).toBe(249_525_075);
    expect(akhir.saldoSen).toBe(1_111_807_175);
    expect(akhir.keterangan).toBe(
      "KR OTOMATIS | MID : 000000000001 | 0998 / SPBU CONTOH SATU / TGH: 2499000.00 / DDR: | 3749.25",
    );
    expect(akhir.keterangan).not.toContain("SALDO AWAL");
    expect(rk.saldoAwalSen).toBe(765_432_100);
    expect(rk.rows).toHaveLength(3);
  });
});

describe("bacaRekeningKoranBca — KURANG BAYAR & lanjutan di kolom keterangan", () => {
  const rk = bacaRekeningKoranBca(fixture("kurang-bayar"));

  it("nomor dokumen sesudah 'KURANG BAYAR' tertangkap", () => {
    expect(rk.rows.map((r) => r.dokRef)).toEqual(["101;202;303", "01-10.06.27"]);
  });

  it("baris lanjutan berindentasi kolom 21 tetap milik barisnya", () => {
    expect(rk.rows[1]!.keterangan).toContain("TANGGAL :12/06");
    expect(rk.rows[1]!.keterangan).toContain("NAMA KARANGAN");
    expect(rk.rows[1]!.amountSen).toBe(-50_000_000);
  });
});

describe("bacaRekeningKoranBca — penolakan utuh", () => {
  it("Σ DB berbeda Rp 0,01 dari kaki ⇒ ditolak, tidak ada baris (AE3)", () => {
    const teks = fixture("giro").replace(/(MUTASI DB\s+:\s+)98,849,753\.19/, "$198,849,753.20");
    let hasil: unknown;
    const g = tangkap(() => {
      hasil = bacaRekeningKoranBca(teks);
    });
    expect(hasil).toBeUndefined();
    expect(g.kode).toBe("kaki-tidak-cocok");
    expect(g.ketidakcocokan).toContainEqual({
      pemeriksaan: "mutasi-db",
      terbaca: 9_884_975_319,
      kaki: 9_884_975_320,
      selisih: -1,
    });
    expect(g.message).toMatch(/kaki tidak cocok/i);
    expect(g.message).toMatch(/MUTASI DB/);
  });

  it("jumlah mutasi CR berbeda ⇒ ditolak dengan nama pemeriksaannya", () => {
    const teks = fixture("giro").replace(/(MUTASI CR\s+:\s+13,595,000\.55\s+)2/, "$13");
    const g = tangkap(() => bacaRekeningKoranBca(teks));
    expect(g.ketidakcocokan.map((k) => k.pemeriksaan)).toEqual(["jumlah-cr"]);
  });

  it("saldo awal + CR − DB ≠ saldo akhir ⇒ ditolak", () => {
    const teks = fixture("giro").replace(/(SALDO AKHIR\s+:\s+)414,745,247\.36/, "$1414,745,247.37");
    const g = tangkap(() => bacaRekeningKoranBca(teks));
    expect(g.ketidakcocokan.map((k) => k.pemeriksaan)).toEqual(["saldo-akhir"]);
  });

  it("teks bukan e-statement BCA ⇒ galat format yang jelas", () => {
    const g = tangkap(() => bacaRekeningKoranBca("Faktur Pajak\nNomor: 010.000-27.00000001\nTotal 1,000.00\n"));
    expect(g.kode).toBe("format");
    expect(g.message).toMatch(/bukan e-statement BCA/i);
  });

  it("kaki hilang (mis. halaman terpotong) ⇒ galat format", () => {
    const teks = fixture("giro").split("SALDO AWAL      :")[0]!;
    const g = tangkap(() => bacaRekeningKoranBca(teks));
    expect(g.kode).toBe("format");
    expect(g.message).toMatch(/kaki/i);
  });
});
