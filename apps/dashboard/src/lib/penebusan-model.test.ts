import { describe, expect, it } from "vitest";
import {
  KATEGORI_PENEBUSAN,
  KODE_MAJU_PENEBUSAN,
  keteranganKasPenebusan,
  normalisasiSo,
  periksaPenebusan,
  pilihKandidat,
  rekapPajak,
  ringkasKomponen,
  unitSatuPt,
  type MasukanPenebusan,
} from "./penebusan-model";
import { arusBukuKas } from "./keuangan-sisi-kas";

/**
 * Model MURNI penebusan per SO (rencana 2026-10-29 U7; R10–R14, R29; KTD9).
 * Angka AE2 ilustratif (bentuk bukti penebusan Bakau, nilai bukan data nyata): Gross Rp 118.750.000.
 */
const AE2: MasukanPenebusan = {
  noSo: "  SO-1234567 ",
  tanggalBayar: "2026-10-02",
  accountId: "11111111-1111-4111-8111-111111111111",
  net: 100_000_000,
  ppn: 11_000_000,
  pph: 250_000,
  pbbkb: 7_500_000,
  nota: 0,
  gross: 118_750_000,
};

describe("periksaPenebusan — Σ komponen = Gross, tepat Rp 0 (R10, AE2)", () => {
  it("🔴 AE2: 100.000.000 + 11.000.000 + 250.000 + 7.500.000 + 0 = 118.750.000 ⇒ sah, dalam sen bulat", () => {
    const r = periksaPenebusan(AE2);
    expect(r).toEqual({
      ok: true,
      noSo: "so-1234567",
      noSoTampil: "SO-1234567",
      sen: {
        net: 10_000_000_000,
        ppn: 1_100_000_000,
        pph: 25_000_000,
        pbbkb: 750_000_000,
        nota: 0,
        gross: 11_875_000_000,
      },
    });
  });

  it("🔴 AE2: PBBKB 7.500.001 (+1) ⇒ ditolak, selisih Rp 1 disebut", () => {
    const r = periksaPenebusan({ ...AE2, pbbkb: 7_500_001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/selisih Rp 1\b/);
  });

  it("selisih ke arah kurang juga disebut (−Rp 1 000)", () => {
    const r = periksaPenebusan({ ...AE2, net: 99_999_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/selisih Rp 1\.000\b/);
  });

  it("nota bertanda: nota kredit (−) mengurangi, nota debet (+) menambah", () => {
    expect(periksaPenebusan({ ...AE2, net: 100_000_000 + 5_000, nota: -5_000 }).ok).toBe(true);
    expect(periksaPenebusan({ ...AE2, net: 100_000_000 - 5_000, nota: 5_000 }).ok).toBe(true);
  });

  it("komponen harus sen bulat (paling banyak dua desimal) — tak ada float yang lolos", () => {
    const r = periksaPenebusan({ ...AE2, ppn: 11_000_000.001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PPN/);
    expect(periksaPenebusan({ ...AE2, pph: Number.NaN }).ok).toBe(false);
  });

  it("Gross wajib positif (baris kasnya kredit −Gross)", () => {
    const r = periksaPenebusan({ ...AE2, gross: 0, net: 0, ppn: 0, pph: 0, pbbkb: 0 });
    expect(r.ok).toBe(false);
  });

  it("SO kosong sesudah normalisasi ditolak; tanggal & rekening diperiksa", () => {
    expect(periksaPenebusan({ ...AE2, noSo: "   " }).ok).toBe(false);
    expect(periksaPenebusan({ ...AE2, tanggalBayar: "2026-10-2" }).ok).toBe(false);
    expect(periksaPenebusan({ ...AE2, accountId: "bukan-uuid" }).ok).toBe(false);
  });
});

describe("normalisasiSo — konvensi lower(trim(cnoso)) (0028, queries.ts)", () => {
  it("spasi & huruf besar dinormalisasi", () => {
    expect(normalisasiSo("  SO-1234567 ")).toBe("so-1234567");
    expect(normalisasiSo("so-1234567")).toBe(normalisasiSo("SO-1234567"));
  });
});

describe("ringkasKomponen — kaki formulir Σ / Gross / Selisih", () => {
  it("selisih 0 hanya bila semua angka terbaca dan jumlahnya tepat", () => {
    const k = ringkasKomponen({
      net: "100.000.000",
      ppn: "11.000.000",
      pph: "250.000",
      pbbkb: "7.500.000",
      nota: "",
      gross: "118.750.000",
    });
    expect(k).toMatchObject({ lengkap: true, jumlah: 118_750_000, gross: 118_750_000, selisih: 0 });
  });

  it("PBBKB +1 ⇒ selisih 1, dan nota negatif dibaca", () => {
    const k = ringkasKomponen({
      net: "100000000",
      ppn: "11000000",
      pph: "250000",
      pbbkb: "7500001",
      nota: "",
      gross: "118750000",
    });
    expect(k.selisih).toBe(1);
    const n = ringkasKomponen({ net: "100", ppn: "0", pph: "0", pbbkb: "0", nota: "-10", gross: "90" });
    expect(n).toMatchObject({ lengkap: true, selisih: 0 });
  });

  it("angka tak terbaca ⇒ tidak lengkap (Simpan nonaktif)", () => {
    const k = ringkasKomponen({ net: "1,5", ppn: "0", pph: "0", pbbkb: "0", nota: "", gross: "1" });
    expect(k.lengkap).toBe(false);
  });
});

describe("pilihKandidat — ikat baris kas yang sudah diketik (R29)", () => {
  const k = (id: string) => ({ id, businessDate: "2026-10-02", tanggalAsal: null, keterangan: "manual", amountSen: -11_875_000_000 });

  it("nol kandidat ⇒ buat baris kas baru", () => {
    expect(pilihKandidat([], null)).toEqual({ aksi: "buat" });
  });

  it("tepat satu ⇒ diikat otomatis", () => {
    expect(pilihKandidat([k("a")], null)).toEqual({ aksi: "ikat", id: "a" });
  });

  it("🔴 dua kandidat ⇒ TIDAK diikat otomatis; kandidat dikembalikan untuk dipilih", () => {
    expect(pilihKandidat([k("a"), k("b")], null)).toEqual({ aksi: "pilih", kandidat: [k("a"), k("b")] });
  });

  it("pilihan eksplisit harus salah satu kandidat", () => {
    expect(pilihKandidat([k("a"), k("b")], "b")).toEqual({ aksi: "ikat", id: "b" });
    expect(pilihKandidat([k("a"), k("b")], "z").aksi).toBe("tolak");
    expect(pilihKandidat([], "z").aksi).toBe("tolak");
  });
});

describe("baris kas penebusan — satu baris arus, tanpa hitung ganda (KTD9, R16, R14)", () => {
  it("kategori & kode alasan maju dari master 0029/0049", () => {
    expect(KATEGORI_PENEBUSAN).toBe("Pembelian BBM");
    expect(KODE_MAJU_PENEBUSAN).toBe("ADJ-FWD-PURCHASE");
    expect(keteranganKasPenebusan("SO-1234567")).toBe("Penebusan SO SO-1234567");
  });

  it("🔴 arus 'Penebusan SO' hari itu = −118.750.000 dari SATU baris kas; tak ada baris laba", () => {
    const arus = arusBukuKas(
      [
        {
          accountId: "A",
          businessDate: "2026-10-02",
          jenis: "kredit",
          categorySide: "kredit",
          categoryLabel: KATEGORI_PENEBUSAN,
          amount: -118_750_000,
          saldoAwal: false,
          void: false,
        },
      ],
      "2026-10-02",
    );
    expect(arus.get("Penebusan SO")).toBe(-118_750_000);
    // R14: penebusan tidak menyentuh pendapatan/biaya — hanya satu baris arus.
    expect([...arus.keys()]).toEqual(["Penebusan SO"]);
  });
});

describe("rekapPajak — total per bulan (R13)", () => {
  it("Σ komponen dalam sen; daftar SO ikut", () => {
    const r = rekapPajak([
      { noSo: "so-1", netSen: 100_00, ppnSen: 11_00, pphSen: 3_00, pbbkbSen: 5_00, notaSen: 0, grossSen: 119_00 },
      { noSo: "so-2", netSen: 200_00, ppnSen: 22_00, pphSen: 6_00, pbbkbSen: 10_00, notaSen: -1_00, grossSen: 237_00 },
    ]);
    expect(r).toEqual({ n: 2, netSen: 300_00, ppnSen: 33_00, pphSen: 9_00, pbbkbSen: 15_00, notaSen: -1_00, grossSen: 356_00 });
  });

  it("kosong ⇒ nol, bukan galat", () => {
    expect(rekapPajak([])).toEqual({ n: 0, netSen: 0, ppnSen: 0, pphSen: 0, pbbkbSen: 0, notaSen: 0, grossSen: 0 });
  });
});

describe("unitSatuPt — rekap per PT hanya bagi yang memegang SEMUA unit tenant itu", () => {
  const tenant = new Map([
    ["6478111", "spa"],
    ["6378301", "spa"],
    ["6478201", "blj"],
  ]);
  const u = (code: string, id: number) => ({ code, unit_id: id });

  it("memegang IB & Bakau ⇒ keduanya", () => {
    expect(unitSatuPt("6378301", tenant, [u("6478111", 1), u("6378301", 2), u("6478201", 4)])?.map((x) => x.code)).toEqual([
      "6478111",
      "6378301",
    ]);
  });

  it("hanya Bakau ⇒ null (rekap PT tidak ditampilkan)", () => {
    expect(unitSatuPt("6378301", tenant, [u("6378301", 2)])).toBeNull();
  });

  it("unit tanpa tenant ⇒ null", () => {
    expect(unitSatuPt("9999999", tenant, [u("9999999", 9)])).toBeNull();
  });
});
