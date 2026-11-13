import { describe, expect, it } from "vitest";
import {
  BATAS_JATUH_TEMPO_EASYMAX_HARI,
  compareTagihanRows,
  deriveTagihanStatus,
  isTagihanFilter,
  matchesTagihanFilter,
  normalizeTagihanFilter,
  paginateTagihan,
  resolveJatuhTempo,
  summarizeTagihan,
  tagihanJatuhTempoLabel,
  tagihanStatusBayarLabel,
  tagihanSumberJatuhTempoLabel,
  TAGIHAN_FILTERS,
  TAGIHAN_PAGE_SIZE,
  type TagihanFaktur,
  type TagihanFilter,
  type TagihanPembayaran,
  type TagihanRow,
  type TagihanStatus,
  type TagihanTermin,
} from "./tagihan-model";

// Semua angka dan nama di sini ilustratif.
const HARI_INI = "2026-03-20";
const TANPA_TERMIN: TagihanTermin = { terminPelanggan: null, terminUnit: null };

const faktur = (overrides: Partial<TagihanFaktur> = {}): TagihanFaktur => ({
  kode: "INV-0001",
  customerCode: "P001",
  tanggalFaktur: "2026-03-01",
  jatuhTempoEasymax: null,
  nilai: 10_000_000,
  statusEasymax: 0,
  sisaEasymax: null,
  batal: false,
  ...overrides,
});

const bayar = (jumlah: number, batal = false): TagihanPembayaran => ({ jumlah, batal });

function status(
  overrides: Partial<TagihanFaktur> = {},
  pembayaran: TagihanPembayaran[] = [],
  termin: TagihanTermin = TANPA_TERMIN,
  hariIni = HARI_INI,
): TagihanStatus {
  const result = deriveTagihanStatus(faktur(overrides), pembayaran, termin, hariIni);
  if (!result) throw new Error("faktur batal tidak punya status");
  return result;
}

function row(
  kode: string,
  overrides: Partial<TagihanFaktur> = {},
  pembayaran: TagihanPembayaran[] = [],
  termin: TagihanTermin = TANPA_TERMIN,
): TagihanRow {
  const f = faktur({ kode, ...overrides });
  return { faktur: f, status: deriveTagihanStatus(f, pembayaran, termin, HARI_INI)! };
}

describe("acceptance examples", () => {
  it("AE1: two live payments that sum to the value are Lunas", () => {
    const result = status({ statusEasymax: 1 }, [bayar(4_000_000), bayar(6_000_000)]);
    expect(result).toMatchObject({ statusBayar: "lunas", dibayar: 10_000_000, sisa: 0, statusJatuhTempo: null, bedaStatus: false });
  });

  it("AE2: part-paid and due yesterday is Sebagian, remaining 6.000.000, overdue 1 day", () => {
    const result = status({ jatuhTempoEasymax: "2026-03-19" }, [bayar(4_000_000)]);
    expect(result).toMatchObject({
      statusBayar: "sebagian", sisa: 6_000_000, statusJatuhTempo: "lewat_jatuh_tempo", hariLewat: 1, hariMenujuJatuhTempo: null,
    });
    expect(tagihanJatuhTempoLabel(result)).toBe("Lewat 1 hari");
    expect(tagihanStatusBayarLabel(result.statusBayar)).toBe("Sebagian");
  });

  it("AE3: payments above the value are Lebih bayar with the excess", () => {
    const result = status({ jatuhTempoEasymax: "2026-03-10" }, [bayar(10_000_000), bayar(50_000)]);
    expect(result).toMatchObject({ statusBayar: "lebih_bayar", dibayar: 10_050_000, sisa: -50_000, statusJatuhTempo: null, hariLewat: 0 });
  });

  it("AE4: a cancelled payment does not count — unpaid, not Lunas", () => {
    const result = status({}, [bayar(10_000_000, true)]);
    expect(result).toMatchObject({ statusBayar: "belum_dibayar", dibayar: 0, sisa: 10_000_000 });
  });

  it("AE5: EasyMax says paid but live payments fall short — computed status plus the marker", () => {
    const result = status({ statusEasymax: 1 }, [bayar(4_000_000)]);
    expect(result).toMatchObject({ statusBayar: "sebagian", sisa: 6_000_000, bedaStatus: true });
  });

  it("AE6: a valid EasyMax due date wins over the SolaMax term", () => {
    const result = resolveJatuhTempo(
      { tanggalFaktur: "2026-03-01", jatuhTempoEasymax: "2026-03-15" },
      { terminPelanggan: 30, terminUnit: 30 },
    );
    expect(result).toEqual({ jatuhTempo: "2026-03-15", sumber: "easymax", terminHari: null, jtEasymaxTakWajar: false });
    expect(tagihanSumberJatuhTempoLabel(result)).toBe("dari EasyMax");
  });

  it("AE7: due date equal to the invoice date falls back to the customer term", () => {
    const result = resolveJatuhTempo(
      { tanggalFaktur: "2026-03-01", jatuhTempoEasymax: "2026-03-01" },
      { terminPelanggan: 14, terminUnit: 30 },
    );
    expect(result).toEqual({ jatuhTempo: "2026-03-15", sumber: "termin_pelanggan", terminHari: 14, jtEasymaxTakWajar: false });
    expect(tagihanSumberJatuhTempoLabel(result)).toBe("termin 14 hari");
  });

  it("AE8: no valid due date and no term is Termin belum diatur, in neither due bucket", () => {
    const result = status({ tanggalFaktur: "2020-01-01" });
    expect(result).toMatchObject({
      jatuhTempo: null, sumber: "belum_diatur", statusJatuhTempo: "termin_belum_diatur", hariLewat: 0, hariMenujuJatuhTempo: null,
    });
    expect(matchesTagihanFilter(result, "lewat_jatuh_tempo")).toBe(false);
    expect(summarizeTagihan([result])).toEqual({
      lewatJatuhTempo: { jumlah: 0, sisa: 0 },
      belumJatuhTempo: { jumlah: 0, sisa: 0 },
      terminBelumDiatur: { jumlah: 1, sisa: 10_000_000 },
    });
    expect(tagihanJatuhTempoLabel(result)).toBe("Termin belum diatur");
    expect(tagihanSumberJatuhTempoLabel(result)).toBeNull();
  });

  it("AE9: a due date decades away is flagged and days overdue come from the term", () => {
    const result = status({ jatuhTempoEasymax: "2056-03-01" }, [], { terminPelanggan: null, terminUnit: 7 });
    expect(result).toMatchObject({
      jtEasymaxTakWajar: true, sumber: "termin_unit", jatuhTempo: "2026-03-08", statusJatuhTempo: "lewat_jatuh_tempo", hariLewat: 12,
    });
  });
});

describe("resolveJatuhTempo", () => {
  const tanggalFaktur = "2026-03-01";

  it("treats a due date equal to the invoice date, or empty, as not filled — no flag", () => {
    for (const jatuhTempoEasymax of ["2026-03-01", null]) {
      expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax }, TANPA_TERMIN))
        .toEqual({ jatuhTempo: null, sumber: "belum_diatur", terminHari: null, jtEasymaxTakWajar: false });
    }
  });

  it("flags a due date before the invoice date and falls back", () => {
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: "2026-02-28" }, { terminPelanggan: null, terminUnit: 30 }))
      .toEqual({ jatuhTempo: "2026-03-31", sumber: "termin_unit", terminHari: 30, jtEasymaxTakWajar: true });
  });

  it("keeps the flag when nothing is left to fall back to", () => {
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: "2026-02-28" }, TANPA_TERMIN))
      .toEqual({ jatuhTempo: null, sumber: "belum_diatur", terminHari: null, jtEasymaxTakWajar: true });
  });

  it("accepts exactly 1 day and exactly the bound; rejects one day past the bound", () => {
    expect(BATAS_JATUH_TEMPO_EASYMAX_HARI).toBe(365);
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: "2026-03-02" }, TANPA_TERMIN).sumber).toBe("easymax");
    // 2026-03-01 + 365 hari = 2027-03-01 (tidak melewati 29 Februari).
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: "2027-03-01" }, TANPA_TERMIN))
      .toMatchObject({ sumber: "easymax", jtEasymaxTakWajar: false });
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: "2027-03-02" }, TANPA_TERMIN))
      .toMatchObject({ sumber: "belum_diatur", jtEasymaxTakWajar: true });
  });

  it("lets the customer term win over the unit term, in both directions", () => {
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: null }, { terminPelanggan: 45, terminUnit: 14 }))
      .toMatchObject({ jatuhTempo: "2026-04-15", sumber: "termin_pelanggan", terminHari: 45 });
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: null }, { terminPelanggan: null, terminUnit: 14 }))
      .toMatchObject({ jatuhTempo: "2026-03-15", sumber: "termin_unit", terminHari: 14 });
  });

  it("treats a term of 0 days as a valid term due on the invoice date", () => {
    const result = resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: null }, { terminPelanggan: 0, terminUnit: 30 });
    expect(result).toEqual({ jatuhTempo: "2026-03-01", sumber: "termin_pelanggan", terminHari: 0, jtEasymaxTakWajar: false });
    expect(tagihanSumberJatuhTempoLabel(result)).toBe("termin 0 hari");
    expect(resolveJatuhTempo({ tanggalFaktur, jatuhTempoEasymax: null }, { terminPelanggan: null, terminUnit: 0 }))
      .toMatchObject({ jatuhTempo: "2026-03-01", sumber: "termin_unit", terminHari: 0 });
  });

  it("crosses month, leap-day and year boundaries in day arithmetic", () => {
    expect(resolveJatuhTempo({ tanggalFaktur: "2026-01-31", jatuhTempoEasymax: null }, { terminPelanggan: 30, terminUnit: null }).jatuhTempo)
      .toBe("2026-03-02");
    expect(resolveJatuhTempo({ tanggalFaktur: "2028-02-15", jatuhTempoEasymax: null }, { terminPelanggan: 14, terminUnit: null }).jatuhTempo)
      .toBe("2028-02-29");
    expect(resolveJatuhTempo({ tanggalFaktur: "2026-12-20", jatuhTempoEasymax: null }, { terminPelanggan: 14, terminUnit: null }).jatuhTempo)
      .toBe("2027-01-03");
    // Jatuh tempo EasyMax melintasi tahun tetap sah.
    expect(resolveJatuhTempo({ tanggalFaktur: "2026-12-20", jatuhTempoEasymax: "2027-01-19" }, TANPA_TERMIN).sumber).toBe("easymax");
  });
});

describe("deriveTagihanStatus", () => {
  it("yields no status for a cancelled invoice", () => {
    expect(deriveTagihanStatus(faktur({ batal: true }), [bayar(10_000_000)], { terminPelanggan: 14, terminUnit: 30 }, HARI_INI)).toBeNull();
  });

  it("does not count today equal to the due date as overdue", () => {
    const result = status({ jatuhTempoEasymax: HARI_INI });
    expect(result).toMatchObject({ statusJatuhTempo: "belum_jatuh_tempo", hariLewat: 0, hariMenujuJatuhTempo: 0 });
    expect(tagihanJatuhTempoLabel(result)).toBe("Jatuh tempo hari ini");
  });

  it("exposes days until due for an invoice not yet due", () => {
    const result = status({ jatuhTempoEasymax: "2026-03-25" });
    expect(result).toMatchObject({ statusJatuhTempo: "belum_jatuh_tempo", hariLewat: 0, hariMenujuJatuhTempo: 5 });
    expect(tagihanJatuhTempoLabel(result)).toBe("Jatuh tempo 5 hari lagi");
  });

  it("gives a part-paid overdue invoice both Sebagian and Lewat jatuh tempo", () => {
    const result = status({}, [bayar(2_500_000)], { terminPelanggan: 7, terminUnit: null });
    expect(result).toMatchObject({ statusBayar: "sebagian", sisa: 7_500_000, statusJatuhTempo: "lewat_jatuh_tempo", hariLewat: 12 });
    expect(matchesTagihanFilter(result, "sebagian")).toBe(true);
    expect(matchesTagihanFilter(result, "lewat_jatuh_tempo")).toBe(true);
  });

  it("counts days overdue across month and year boundaries", () => {
    expect(status({ tanggalFaktur: "2025-12-01", jatuhTempoEasymax: "2025-12-31" }, [], TANPA_TERMIN, "2026-01-01").hariLewat).toBe(1);
    expect(status({ tanggalFaktur: "2028-02-01", jatuhTempoEasymax: "2028-02-28" }, [], TANPA_TERMIN, "2028-03-01").hariLewat).toBe(2);
    expect(status({ tanggalFaktur: "2026-02-01", jatuhTempoEasymax: "2026-02-28" }, [], TANPA_TERMIN, "2026-03-01").hariLewat).toBe(1);
  });

  it("counts floating-point payments within a fraction of a rupiah as Lunas", () => {
    const pecahan = status({ nilai: 10_000 }, [bayar(3_333.33), bayar(3_333.33), bayar(3_333.34)]);
    expect(pecahan).toMatchObject({ statusBayar: "lunas", dibayar: 10_000, sisa: 0 });
    const artefak = status({ nilai: 73_867_616.45999999, sisaEasymax: 0.00000001, statusEasymax: 1 }, [bayar(73_867_616.46)]);
    expect(artefak).toMatchObject({ statusBayar: "lunas", sisa: 0, bedaStatus: false, bedaSisa: false });
    expect(Object.is(artefak.sisa, -0)).toBe(false);
  });

  it("has no overpayment threshold: one rupiah over is Lebih bayar", () => {
    expect(status({}, [bayar(10_000_001)])).toMatchObject({ statusBayar: "lebih_bayar", sisa: -1 });
  });

  it("applies a term to an old open invoice immediately", () => {
    const result = status({ tanggalFaktur: "2025-06-01" }, [], { terminPelanggan: null, terminUnit: 30 });
    expect(result).toMatchObject({ jatuhTempo: "2025-07-01", statusJatuhTempo: "lewat_jatuh_tempo", hariLewat: 262 });
  });

  describe("markers", () => {
    it("fires beda_status alone", () => {
      expect(status({ statusEasymax: 1, sisaEasymax: 6_000_000 }, [bayar(4_000_000)]))
        .toMatchObject({ bedaStatus: true, bedaSisa: false });
    });

    it("fires beda_sisa alone", () => {
      expect(status({ statusEasymax: 0, sisaEasymax: 5_000_000 }, [bayar(4_000_000)]))
        .toMatchObject({ bedaStatus: false, bedaSisa: true });
    });

    it("fires neither when both agree, and both when both disagree", () => {
      expect(status({ statusEasymax: 0, sisaEasymax: 6_000_000 }, [bayar(4_000_000)]))
        .toMatchObject({ bedaStatus: false, bedaSisa: false });
      expect(status({ statusEasymax: 1, sisaEasymax: 0 }, [bayar(4_000_000)]))
        .toMatchObject({ bedaStatus: true, bedaSisa: true });
    });

    it("compares the paid state with the EasyMax flag", () => {
      expect(status({ statusEasymax: 1 }, []).bedaStatus).toBe(true);
      expect(status({ statusEasymax: 1 }, [bayar(10_000_000)]).bedaStatus).toBe(false);
      expect(status({ statusEasymax: 0 }, [bayar(10_000_000)]).bedaStatus).toBe(true);
      expect(status({ statusEasymax: 1 }, [bayar(10_050_000)]).bedaStatus).toBe(false);
      expect(status({ statusEasymax: 0 }, [bayar(10_050_000)]).bedaStatus).toBe(true);
      expect(status({ statusEasymax: 0 }, []).bedaStatus).toBe(false);
    });

    it("raises no marker when the EasyMax field is absent", () => {
      expect(status({ statusEasymax: null, sisaEasymax: null }, [bayar(10_000_000)]))
        .toMatchObject({ bedaStatus: false, bedaSisa: false });
    });
  });
});

describe("filters", () => {
  const lunas = status({}, [bayar(10_000_000)]);
  const lebih = status({}, [bayar(10_050_000)]);
  const sebagian = status({ jatuhTempoEasymax: "2026-03-25" }, [bayar(1_000_000)]);
  const lewat = status({ jatuhTempoEasymax: "2026-03-10" });
  const tanpaTermin = status();

  it("defaults to perlu_tindakan and falls back on unknown values", () => {
    expect(TAGIHAN_FILTERS).toEqual(["perlu_tindakan", "lewat_jatuh_tempo", "sebagian", "lebih_bayar", "lunas"]);
    expect(normalizeTagihanFilter(undefined)).toBe("perlu_tindakan");
    expect(normalizeTagihanFilter("belum_ditagihkan")).toBe("perlu_tindakan");
    expect(normalizeTagihanFilter("lunas")).toBe("lunas");
    expect(isTagihanFilter("sebagian")).toBe(true);
    expect(isTagihanFilter(1)).toBe(false);
  });

  it.each<[TagihanFilter, boolean[]]>([
    ["perlu_tindakan", [false, true, true, true, true]],
    ["lewat_jatuh_tempo", [false, false, false, true, false]],
    ["sebagian", [false, false, true, false, false]],
    ["lebih_bayar", [false, true, false, false, false]],
    ["lunas", [true, false, false, false, false]],
  ])("%s selects the right invoices", (filter, expected) => {
    expect([lunas, lebih, sebagian, lewat, tanpaTermin].map((item) => matchesTagihanFilter(item, filter))).toEqual(expected);
  });
});

describe("compareTagihanRows", () => {
  it("sorts by days overdue descending, due date ascending with undated last, then invoice key", () => {
    const rows = [
      row("INV-F"),
      row("INV-E", { jatuhTempoEasymax: "2026-03-28" }),
      row("INV-D", { jatuhTempoEasymax: "2026-03-22" }),
      row("INV-C", { jatuhTempoEasymax: "2026-03-18" }),
      row("INV-B", { jatuhTempoEasymax: "2026-03-05" }),
      row("INV-A", { jatuhTempoEasymax: "2026-03-18" }),
      row("INV-G"),
    ];
    expect([...rows].sort(compareTagihanRows).map((item) => item.faktur.kode))
      .toEqual(["INV-B", "INV-A", "INV-C", "INV-D", "INV-E", "INV-F", "INV-G"]);
  });
});

describe("paginateTagihan", () => {
  const rows = Array.from({ length: 120 }, (_, index) => index);

  it("pages at 50 rows", () => {
    expect(TAGIHAN_PAGE_SIZE).toBe(50);
    expect(paginateTagihan(rows, "2")).toMatchObject({ page: 2, totalPages: 3, resultCount: 120, pageSize: 50 });
    expect(paginateTagihan(rows, "2").rows).toEqual(rows.slice(50, 100));
    expect(paginateTagihan(rows, 3).rows).toHaveLength(20);
  });

  it("clamps unknown and out-of-range pages", () => {
    expect(paginateTagihan(rows, "abc").page).toBe(1);
    expect(paginateTagihan(rows, null).page).toBe(1);
    expect(paginateTagihan(rows, "99").page).toBe(3);
    expect(paginateTagihan([], "5")).toMatchObject({ page: 1, totalPages: 1, resultCount: 0, rows: [] });
  });
});

describe("summarizeTagihan", () => {
  it("counts and totals the remaining amount per due state, leaving Lunas and Lebih bayar out", () => {
    const result = summarizeTagihan([
      status({ jatuhTempoEasymax: "2026-03-10" }),
      status({ jatuhTempoEasymax: "2026-03-10" }, [bayar(4_000_000)]),
      status({ jatuhTempoEasymax: "2026-03-25" }, [bayar(1_000_000)]),
      status({ nilai: 2_000_000 }),
      status({}, [bayar(10_000_000)]),
      status({}, [bayar(10_050_000)]),
    ]);
    expect(result).toEqual({
      lewatJatuhTempo: { jumlah: 2, sisa: 16_000_000 },
      belumJatuhTempo: { jumlah: 1, sisa: 9_000_000 },
      terminBelumDiatur: { jumlah: 1, sisa: 2_000_000 },
    });
  });
});

describe("labels", () => {
  it("names the paid-state pills", () => {
    expect(tagihanStatusBayarLabel("sebagian")).toBe("Sebagian");
    expect(tagihanStatusBayarLabel("lunas")).toBe("Lunas");
    expect(tagihanStatusBayarLabel("lebih_bayar")).toBe("Lebih bayar");
    expect(tagihanStatusBayarLabel("belum_dibayar")).toBeNull();
  });

  it("has no due-date pill for Lunas and Lebih bayar", () => {
    expect(tagihanJatuhTempoLabel(status({ jatuhTempoEasymax: "2026-03-10" }, [bayar(10_000_000)]))).toBeNull();
    expect(tagihanJatuhTempoLabel(status({ jatuhTempoEasymax: "2026-03-10" }, [bayar(10_050_000)]))).toBeNull();
  });
});
