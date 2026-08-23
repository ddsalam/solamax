import { describe, expect, it } from "vitest";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import type { DayCloseRow, OverrideRow } from "@/lib/keuangan-input-queries";
import type { BarisUnit } from "@/lib/keuangan-papan-model";
import {
  LABEL_WEWENANG_TIER,
  bolehMenutup,
  type Tier,
} from "@/lib/keuangan-tutup-hari";
import { barisCsv, papanCsv, selCsv, susunCsv } from "./csv";
import { KOSONG_RINGKAS, angkaTeks, selKosong } from "./teks-kosong";
import { buildTutupHariDoc } from "./tutup-hari-doc";
import type { KopKeuangan } from "./keuangan-kop";

const KOP: KopKeuangan = {
  ptLabel: "PT Sola Petra Abadi",
  judul: "Lembar penutupan hari",
  subjudul: "Bakau — 2026-01-12",
  generatedLabel: "12 Jan 2026 · 14.05",
  dicetakOleh: "orang@contoh.co",
};

function teks(doc: TDocumentDefinitions): string {
  const kaki = typeof doc.footer === "function" ? doc.footer(1, 1, {} as never) : doc.footer;
  return JSON.stringify(doc) + JSON.stringify(kaki);
}

// ───────────────────────────── CSV (§10.19)

describe("CSV · null bernama tetap bernama — sel kosong dibaca Excel sebagai NOL", () => {
  it("null jadi teks, BUKAN sel kosong", () => {
    expect(angkaTeks(null)).toBe(KOSONG_RINGKAS);
    expect(selKosong(angkaTeks(null))).toBe(false);
  });

  it("DAYA-BEDA: nol yang SUNGGUH nol tetap '0', dan berbeda dari null", () => {
    expect(angkaTeks(0)).toBe("0");
    expect(angkaTeks(0)).not.toBe(angkaTeks(null));
  });

  it("🔴 TAK SATU PUN sel kosong di seluruh CSV papan", () => {
    const csv = papanCsv([seimbang("A"), belumDibuka("B"), belum("C", "Imam Bonjol")], "2026-01-12");
    const barisData = csv
      .split("\r\n")
      .filter((l) => l !== "" && !l.startsWith("Ringkasan"))
      .slice(1); // buang header
    expect(barisData.length).toBeGreaterThan(0); // penjaga tanpa subjek = gagal
    for (const l of barisData) {
      for (const sel of l.split(",")) {
        expect(selKosong(sel), `sel kosong di baris: ${l}`).toBe(false);
      }
    }
  });

  it("unit belum dimodelkan tetap jadi BARIS di CSV", () => {
    const csv = papanCsv([belum("6478111", "Imam Bonjol")], "2026-01-12");
    expect(csv).toContain("Imam Bonjol");
    expect(csv).toContain("Belum dimodelkan");
    expect(csv).toContain(KOSONG_RINGKAS);
  });

  it("ringkasan memakai penyebut 'sudah diperiksa' — dipanggil, bukan disalin", () => {
    const csv = papanCsv([seimbang("A"), belumDibuka("B"), belum("C", "C")], "2026-01-12");
    expect(csv).toContain("sudah diperiksa,1");
    expect(csv).toContain("seimbang (dari yang sudah diperiksa),1");
    expect(csv).toContain("termodelkan,2");
  });
});

describe("CSV · kutip yang benar (nama unit boleh mengandung koma)", () => {
  it("koma, kutip, dan baris-baru tidak memecah barisnya", () => {
    expect(selCsv("Bakau, Pontianak")).toBe('"Bakau, Pontianak"');
    expect(selCsv('dia bilang "ya"')).toBe('"dia bilang ""ya"""');
    expect(selCsv("baris\nkedua")).toBe('"baris\nkedua"');
    expect(selCsv("biasa")).toBe("biasa");
  });

  it("baris dengan koma di dalam nilai tetap 3 kolom saat dibaca ulang", () => {
    const l = barisCsv(["a,b", "c", "d"]);
    expect(l).toBe('"a,b",c,d');
  });

  it("BOM UTF-8 di depan supaya Excel Windows tak merusak '·' dan '—'", () => {
    expect(susunCsv([["x"]]).charCodeAt(0)).toBe(0xfeff);
  });
});

// ───────────────────────────── Layar 4 (§10.20)

const DC: DayCloseRow = {
  status: "closed",
  differenceRp: 0,
  tier: "within_tolerance",
  reasonCode: null,
  reasonRequiresTarget: null,
  targetDate: null,
  closedByUserId: 7,
  closedAt: "2026-01-12 16:40",
  approvedByUserId: null,
  approvedAt: null,
  closedByEmail: "penutup@contoh.co",
  approvedByEmail: null,
};

const dasarDoc = { kop: KOP, langkahHarian: 0, tier: "within_tolerance" as Tier, overrides: [], labelReason: {} };

describe("Layar 4 · lima hal yang tak boleh diringkas", () => {
  it("1 · selisih apa adanya, TERMASUK yang nol persis — tak pernah dihilangkan", () => {
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC }));
    expect(s).toContain("Selisih (langkah harian)");
    expect(s).toContain("nol persis");
  });

  it("1′ · selisih di dalam toleransi tapi BUKAN nol tetap tercetak angkanya", () => {
    const s = teks(buildTutupHariDoc({
      ...dasarDoc, langkahHarian: 750,
      dayClose: { ...DC, differenceRp: 750 },
    }));
    expect(s).toContain("750");
    expect(s).not.toContain("nol persis");
  });

  it("2 · tier DAN wewenangnya, bukan hanya penekan tombolnya", () => {
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC }));
    expect(s).toContain("Wewenang pada tier ini");
    expect(s).toContain(LABEL_WEWENANG_TIER.within_tolerance);
    expect(s).toContain("penutup@contoh.co"); // penekannya juga, keduanya
  });

  it("3 · reason_code + tanggal target; target WAJIB yang kosong disebut kosong", () => {
    const s = teks(buildTutupHariDoc({
      ...dasarDoc,
      dayClose: { ...DC, reasonCode: "CLS-INV", reasonRequiresTarget: true, targetDate: null },
      labelReason: { "CLS-INV": "Sedang diselidiki" },
    }));
    expect(s).toContain("CLS-INV");
    expect(s).toContain("Sedang diselidiki");
    expect(s).toContain("WAJIB, tetapi kosong");
  });

  it("4 · jalur override ikut — pengaju, penyetuju, kapan dikonsumsi", () => {
    const ov: OverrideRow = {
      id: "1", reasonCode: "BD-01", alasan: "sistem mati",
      requestedBy: "aju@contoh.co", approvedBy: "setuju@contoh.co",
      approvedAt: "2026-01-11 09:00", consumedAt: "2026-01-12 08:00", void: false,
    };
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC, overrides: [ov] }));
    for (const x of ["BD-01", "aju@contoh.co", "setuju@contoh.co", "2026-01-12 08:00"]) {
      expect(s).toContain(x);
    }
  });

  it("4′ · override yang DIBATALKAN tidak dihitung sebagai jalur yang dipakai", () => {
    const ov: OverrideRow = {
      id: "1", reasonCode: "BD-01", alasan: "batal", requestedBy: "a@b.co",
      approvedBy: null, approvedAt: null, consumedAt: null, void: true,
    };
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC, overrides: [ov] }));
    expect(s).toContain("tidak memakai jalur override");
    expect(s).not.toContain("BD-01");
  });

  it("5 · kumulatif disebut BELUM TERSEDIA, tidak disembunyikan", () => {
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC }));
    expect(s).toContain("belum tersedia");
    expect(s).toContain("saldo pembuka ekuitas belum punya sumber");
  });
});

describe("Layar 4 · status di MUKA, sebab kertas tanpa status terbaca final", () => {
  it("sudah ditutup", () => {
    expect(teks(buildTutupHariDoc({ ...dasarDoc, dayClose: DC }))).toContain("SUDAH DITUTUP");
  });

  it("belum ditutup — dan dikatakan bisa berubah", () => {
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: { ...DC, status: "open" } }));
    expect(s).toContain("BELUM DITUTUP");
    expect(s).toContain("MASIH BISA BERUBAH");
  });

  it("belum punya baris penilaian sama sekali — dan menolak disebut bukti", () => {
    const s = teks(buildTutupHariDoc({ ...dasarDoc, dayClose: null, langkahHarian: null, tier: null }));
    expect(s).toContain("BELUM PUNYA BARIS PENILAIAN");
    expect(s).toContain("BUKAN bukti penutupan");
  });
});

describe("🔴 label wewenang dan PREDIKATNYA wajib sepakat — dibuktikan dijalankan", () => {
  const PERAN = ["keuangan", "direksi", "admin_perusahaan", "pengawas", "super_admin"] as const;
  const HOF = ["hof@contoh.co"] as const;

  /**
   * ⛔ DITURUNKAN DARI LABELNYA, bukan diketik.
   *
   * Versi pertama uji ini mengetik daftar perannya sendiri — sehingga label
   * boleh berbohong tanpa memerahkan apa pun (mutasi S5 lulus). Peta yang
   * disalin selalu setuju dengan dirinya, bukan dengan yang diujinya.
   */
  const FRASA: Record<string, (typeof PERAN)[number]> = {
    "peran keuangan": "keuangan",
    Direksi: "direksi",
    "super admin": "super_admin",
  };
  function peranDisebut(label: string): string[] {
    return Object.entries(FRASA)
      .filter(([frasa]) => label.includes(frasa))
      .map(([, role]) => role);
  }
  const disebut: Record<Tier, readonly string[]> = {
    within_tolerance: peranDisebut(LABEL_WEWENANG_TIER.within_tolerance),
    exception_hof: peranDisebut(LABEL_WEWENANG_TIER.exception_hof),
    override_direksi: peranDisebut(LABEL_WEWENANG_TIER.override_direksi),
  };

  it("penurunannya punya SUBJEK — tiap label menyebut minimal satu peran", () => {
    for (const t of Object.keys(disebut) as Tier[]) {
      expect(disebut[t].length, `label ${t} tak menyebut satu peran pun`).toBeGreaterThan(0);
    }
  });

  for (const tier of Object.keys(LABEL_WEWENANG_TIER) as Tier[]) {
    it(`${tier}: yang disebut label DITERIMA, yang tidak DITOLAK`, () => {
      for (const role of PERAN) {
        const ctx = { role, email: "biasa@contoh.co" };
        const harusnya = disebut[tier].includes(role);
        expect(
          bolehMenutup(tier, ctx, HOF),
          `${tier} × ${role}: label berkata "${LABEL_WEWENANG_TIER[tier]}"`,
        ).toBe(harusnya);
      }
    });
  }

  it("Head of Finance disebut HANYA pada tier kedua, dan predikatnya setuju", () => {
    const hof = { role: "admin_perusahaan" as const, email: HOF[0] };
    expect(LABEL_WEWENANG_TIER.exception_hof).toContain("Head of Finance");
    expect(bolehMenutup("exception_hof", hof, HOF)).toBe(true);
    expect(LABEL_WEWENANG_TIER.within_tolerance).not.toContain("Head of Finance");
    expect(bolehMenutup("within_tolerance", hof, HOF)).toBe(false);
    expect(LABEL_WEWENANG_TIER.override_direksi).not.toContain("Head of Finance");
    expect(bolehMenutup("override_direksi", hof, HOF)).toBe(false);
  });
});

function dasar(code: string, nama: string): BarisUnit {
  return {
    unitId: 1, code, nama, labaBersih: 0, kasAkhir: 0, langkahHarian: 0,
    bsCheckKumulatif: null, status: "ditutup_normal", tier: null, nada: "baik",
    kekuranganBagan: [],
  };
}
const seimbang = (n: string): BarisUnit => dasar("1", n);
const belumDibuka = (n: string): BarisUnit => ({
  ...dasar("3", n), status: "belum_pernah_dibuka", langkahHarian: null, nada: "tak_terhitung",
});
const belum = (code: string, nama: string): BarisUnit => ({
  ...dasar(code, nama), status: "belum_dimodelkan",
  labaBersih: null, kasAkhir: null, langkahHarian: null, nada: "tak_terhitung",
});

describe("§10.22 · bagan tak lengkap ikut ke CSV dan PDF", () => {
  const timpang: BarisUnit = { ...dasar("9", "Korek"), kekuranganBagan: ["Kas Besar", "EDC Penampungan"] };

  it("CSV menyebut apa yang belum ada, dan 'lengkap' bila tak ada yang kurang", () => {
    const csv = papanCsv([timpang, dasar("1", "Bakau")], "2026-08-22");
    expect(csv).toContain("belum ada Kas Besar & EDC Penampungan");
    expect(csv).toContain("lengkap");
  });

  it("🔴 tetap tanpa sel kosong sesudah kolom baru", () => {
    for (const l of papanCsv([timpang], "2026-08-22").split("\r\n").slice(1)) {
      if (l === "" || l.startsWith("Ringkasan")) continue;
      for (const sel of l.split(",")) expect(selKosong(sel), l).toBe(false);
    }
  });
});
