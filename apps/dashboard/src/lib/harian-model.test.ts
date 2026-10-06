import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildHarianModel,
  daysInYm,
  harianSpanFrom,
  OTHER_KEY,
  ymLabel,
  type HarianInput,
} from "./harian-model";
import type { DailyGlRow, DailySalesRow, SyncRow, UnitCoverageRow } from "./queries";
import type { ScopedUnit, ScopedUnitId } from "./scope-rule";

const U = (id: number, code: string, name: string): ScopedUnit => ({
  unit_id: id as ScopedUnitId,
  code,
  name,
});
const KB = U(4, "6478106", "Bundaran Kotabaru");
const IB = U(1, "6478111", "Imam Bonjol");
const AS = U(3, "6478101", "Adisucipto");

const productCode = (nama: string): string => ({
  PERTAMAX: "BB-02", SOLAR: "BB-03", "PERTAMAX TURBO": "BB-04", DEXLITE: "BB-06",
  PERTALITE: "BB-07", "PERTAMINA DEX": "BB-08",
})[nama] ?? nama;
const sale = (unit_id: number, d: string, nama: string, vol: number, omzet = vol * 10000): DailySalesRow => ({
  unit_id,
  d,
  ckdbbm: productCode(nama),
  nama: nama === "P1" ? null : nama,
  vol,
  omzet,
});
const cov = (unit_id: number, sales_min: string | null): UnitCoverageRow => ({ unit_id, sales_min });
const syn = (unit_id: number, last_run: string | null): SyncRow => ({ unit_id, last_run });

function base(over: Partial<HarianInput> = {}): HarianInput {
  return {
    units: [KB],
    date: "2026-07-22",
    dailySales: [],
    gl: new Map(),
    coverage: [cov(4, "2011-10-06")],
    sync: [syn(4, "2026-07-24T07:33:00Z")],
    recordFloor: "2025-12-29",
    ...over,
  };
}

// Angka MTD KB 1–22 Juli 2026 dari laporan Excel yang SUDAH terverifikasi Fase 1.
const KB_MTD: Array<[string, number]> = [
  ["PERTAMAX", 86_511],
  ["SOLAR", 205_513],
  ["DEXLITE", 57_548],
  ["PERTALITE", 708_437],
  ["PERTAMINA DEX", 23_431],
  ["PERTAMAX TURBO", 5_042],
];

describe("rumus terkunci — BBK ≠ bauran", () => {
  const m = buildHarianModel(
    base({ dailySales: KB_MTD.map(([n, v]) => sale(4, "2026-07-22", n, v)) }),
  );

  // Oracle sesungguhnya = angka TAMPIL di laporan Excel yang berjalan (2 desimal).
  const pct2 = (x: number | null): string => `${(x! * 100).toFixed(2)}%`;

  it("BBK GASOLINE = (Pertamax+Turbo)/(Pertalite+Pertamax+Turbo) → PDF 11,44%", () => {
    // 91.553 / 799.990
    expect(m.bbk.monthly[4]!.gasoline).toBeCloseTo(91_553 / 799_990, 12);
    expect(pct2(m.bbk.monthly[4]!.gasoline)).toBe("11.44%");
    // bauran (NPSO/PSO) memberi 12,93% — HARUS berbeda; ini definisi yang bersaing
    expect(pct2(91_553 / 708_437)).toBe("12.92%");
    expect(m.bbk.monthly[4]!.gasoline).not.toBeCloseTo(91_553 / 708_437, 4);
  });

  it("BBK DIESEL = (Dexlite+P.Dex)/(Solar+Dexlite+P.Dex) → PDF 28,27%", () => {
    expect(m.bbk.monthly[4]!.diesel).toBeCloseTo(80_979 / 286_492, 12);
    expect(pct2(m.bbk.monthly[4]!.diesel)).toBe("28.27%");
  });

  it('baris "Total" RASIO ≡ bauran gasoil = (Dexlite+P.Dex)/Solar → PDF 39,40%', () => {
    expect(m.ratios.monthly[4]!.dexSolar).toBeCloseTo(57_548 / 205_513, 12);
    expect(m.ratios.monthly[4]!.pdexSolar).toBeCloseTo(23_431 / 205_513, 12);
    expect(pct2(m.ratios.monthly[4]!.dexSolar)).toBe("28.00%"); // PDF 28,00%
    expect(pct2(m.ratios.monthly[4]!.pdexSolar)).toBe("11.40%"); // PDF 11,40%
    expect(pct2(m.ratios.monthly[4]!.total)).toBe("39.40%"); // PDF 39,40%
  });

  it("BBK adalah transformasi b/(1+b) dari baris Total rasio", () => {
    const b = m.ratios.monthly[4]!.total!;
    expect(m.bbk.monthly[4]!.diesel).toBeCloseTo(b / (1 + b), 9);
  });

  it("Solar 0 → rasio null, BUKAN 0%", () => {
    const m0 = buildHarianModel(base({ dailySales: [sale(4, "2026-07-22", "PERTALITE", 100)] }));
    expect(m0.ratios.monthly[4]).toEqual({ dexSolar: null, pdexSolar: null, total: null });
    expect(m0.bbk.monthly[4]!.diesel).toBeNull();
    expect(m0.bbk.monthly[4]!.gasoline).toBeCloseTo(0, 9); // PSO ada, NPSO 0 → 0%, sah
  });
});

describe("pembagi Rata-Rata = hari kalender 1..D", () => {
  it("D=22 Jul → 22 (bukan jumlah hari berdata, bukan 31)", () => {
    const m = buildHarianModel(
      base({ dailySales: KB_MTD.map(([n, v]) => sale(4, "2026-07-22", n, v)) }),
    );
    expect(m.avgDivisor).toBe(22);
    expect(m.monthly.grand.kum).toBeCloseTo(1_086_482, 0);
    expect(m.monthly.grand.avg).toBeCloseTo(1_086_482 / 22, 6);
  });

  it("D historis memakai day-of-month D, bukan hari ini", () => {
    const m = buildHarianModel(
      base({ date: "2026-03-10", dailySales: [sale(4, "2026-03-10", "SOLAR", 1000)] }),
    );
    expect(m.avgDivisor).toBe(10);
  });

  it("D = 1 → pembagi 1", () => {
    expect(buildHarianModel(base({ date: "2026-07-01" })).avgDivisor).toBe(1);
  });
});

describe('baris "Lain-lain" — kode tak dikenal WAJIB terlihat & ikut TOTAL', () => {
  const m = buildHarianModel(
    base({
      units: [IB],
      coverage: [cov(1, "2022-08-31")],
      sync: [syn(1, "2026-07-24T07:33:00Z")],
      dailySales: [sale(1, "2026-07-22", "PERTALITE", 19_596), sale(1, "2026-07-22", "P1", 50)],
    }),
  );

  it("baris muncul dengan label Lain-lain", () => {
    const other = m.daily.rows.find((r) => r.key === OTHER_KEY);
    expect(other?.label).toBe("Lain-lain");
    expect(other?.byUnit[1]).toBe(50);
  });

  it("ikut TOTAL unit dan TOTAL grup (tidak hilang diam-diam)", () => {
    expect(m.daily.totalsByUnit[1]).toBe(19_646);
    expect(m.daily.grandTotal).toBe(19_646);
  });

  it("catatan kaki menyebut kode aslinya", () => {
    expect(m.notes.join(" ")).toContain("P1");
  });

  it("tanpa kode asing → baris Lain-lain TIDAK dirender", () => {
    const m2 = buildHarianModel(base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 10)] }));
    expect(m2.daily.rows.some((r) => r.key === OTHER_KEY)).toBe(false);
  });

  it("Pertalite Khusus selalu disebut di catatan kaki dgn alasan yang BENAR", () => {
    const n = m.notes.join(" ");
    expect(n).toContain("0 liter sepanjang periode laporan");
    expect(n).not.toContain("tidak ada di master");
  });
});

describe("belum-beroperasi (—) vs tak-jualan (0)", () => {
  const m = buildHarianModel(
    base({
      units: [KB, AS],
      date: "2026-07-22",
      coverage: [cov(4, "2011-10-06"), cov(3, "2025-12-29")],
      sync: [syn(4, "2026-07-24T07:33:00Z"), syn(3, "2026-07-24T07:32:00Z")],
      dailySales: [
        sale(4, "2025-08-15", "SOLAR", 100_000),
        sale(4, "2026-07-22", "SOLAR", 9_264),
        sale(3, "2026-07-22", "SOLAR", 12_304),
      ],
    }),
  );

  it("bulan sebelum sales_min unit → null di tren (bukan 0)", () => {
    const ags25 = m.trend.months.find((x) => x.ym === "2025-08")!;
    expect(ags25.byUnit[3]).toBeNull(); // AS belum ada Ags 2025
    expect(ags25.byUnit[4]).toBeCloseTo(100, 6); // KB 100.000 L = 100 KL
  });

  it("bulan sesudah sales_min tapi tanpa penjualan → 0, bukan null", () => {
    const jan26 = m.trend.months.find((x) => x.ym === "2026-01")!;
    expect(jan26.byUnit[3]).toBe(0);
  });

  it("TOTAL bulan hanya menjumlah unit yang sudah beroperasi", () => {
    expect(m.trend.months.find((x) => x.ym === "2025-08")!.totalKl).toBeCloseTo(100, 6);
  });
});

describe("tren 13 bulan — satuan KL, bulan berjalan parsial", () => {
  const m = buildHarianModel(
    base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 1_086_482)] }),
  );
  it("13 titik berakhir di bulan D", () => {
    expect(m.trend.months).toHaveLength(13);
    expect(m.trend.months[0]!.ym).toBe("2025-07");
    expect(m.trend.months[12]!.ym).toBe("2026-07");
  });
  it("liter → KL (÷1000)", () => {
    expect(m.trend.months[12]!.totalKl).toBeCloseTo(1086.482, 3);
  });
  it("bulan berjalan ditandai parsial & dibagi hari BERJALAN", () => {
    const last = m.trend.months[12]!;
    expect(last.partial).toBe(true);
    expect(last.days).toBe(22);
    expect(last.avgTotalKl).toBeCloseTo(1086.482 / 22, 6);
  });
  it("bulan penuh dibagi jumlah hari bulan itu", () => {
    expect(m.trend.months[11]!.days).toBe(30); // Juni
    expect(m.trend.months[0]!.days).toBe(31); // Juli 2025
  });
});

describe("rekor grup", () => {
  const days: DailySalesRow[] = [
    // hari terbaik: 2026-04-01
    sale(4, "2026-04-01", "SOLAR", 60_000),
    sale(1, "2026-04-01", "SOLAR", 70_000),
    // hari lain lebih kecil
    sale(4, "2026-03-05", "SOLAR", 50_000),
    sale(1, "2026-03-05", "SOLAR", 40_000),
    // SAMPAH: satu unit-hari 31,6 juta L (pola KR 2021-10-18)
    sale(1, "2026-02-10", "SOLAR", 31_615_851),
    sale(4, "2026-02-10", "SOLAR", 10_000),
    // sebelum lantai armada — harus diabaikan walau lebih besar
    sale(1, "2025-08-01", "SOLAR", 150_000),
  ];
  const m = buildHarianModel(
    base({
      units: [IB, KB],
      date: "2026-07-22",
      coverage: [cov(1, "2022-08-31"), cov(4, "2011-10-06")],
      sync: [syn(1, "2026-07-24T07:33:00Z"), syn(4, "2026-07-24T07:33:00Z")],
      dailySales: days,
    }),
  );

  it("memilih tanggal dengan TOTAL grup tertinggi", () => {
    expect(m.record.date).toBe("2026-04-01");
  });
  it("TOTAL = jumlah rincian per unit (cacat #3 Excel mustahil terulang)", () => {
    const sum = Object.values(m.record.byUnit).reduce((a, b) => a + b, 0);
    expect(m.record.total).toBe(sum);
    expect(m.record.total).toBe(130_000);
  });
  it("unit-hari sampah dibuang & dilaporkan", () => {
    expect(m.record.droppedUnitDays).toBe(1);
    expect(m.notes.join(" ")).toContain("1 unit-hari");
    expect(m.record.date).not.toBe("2026-02-10");
  });
  it("tanggal sebelum lantai armada tidak dipertimbangkan", () => {
    expect(m.record.from).toBe("2025-12-29");
    expect(m.record.date).not.toBe("2025-08-01");
  });
});

describe("kesegaran dua dimensi", () => {
  const m = buildHarianModel(
    base({
      units: [KB, IB],
      date: "2026-07-23",
      coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
      // Dimensi 1: kedua agent baru saja jalan — "hijau" secara agent.
      sync: [syn(4, "2026-07-24T07:33:40Z"), syn(1, "2026-07-24T07:33:10Z")],
      // Dimensi 2: IB tidak punya baris untuk 23 Jul.
      dailySales: [sale(4, "2026-07-23", "SOLAR", 1000), sale(1, "2026-07-21", "SOLAR", 900)],
    }),
  );

  it("agent hidup TIDAK menutupi data yang tertinggal", () => {
    expect(m.freshness.worstSyncAt).toBe("2026-07-24T07:33:10Z"); // dua-duanya segar
    expect(m.freshness.staleUnits.map((s) => s.code)).toEqual(["6478111"]);
    expect(m.freshness.staleUnits[0]!.daysBehind).toBe(2);
    expect(m.freshness.incomplete).toBe(true);
  });

  it("unit mutakhir tidak ditandai", () => {
    expect(m.units.find((u) => u.unitId === 4)!.stale).toBe(false);
  });

  it("semua unit mutakhir → incomplete false", () => {
    const ok = buildHarianModel(
      base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 1)] }),
    );
    expect(ok.freshness.incomplete).toBe(false);
    expect(ok.freshness.staleUnits).toEqual([]);
  });

  it("worstSyncAt memakai MIN (unit terburuk) dan menyebut unitnya", () => {
    const m2 = buildHarianModel(
      base({
        units: [KB, IB],
        coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
        sync: [syn(4, "2026-07-24T07:33:40Z"), syn(1, "2026-07-22T21:00:00Z")],
      }),
    );
    expect(m2.freshness.worstSyncAt).toBe("2026-07-22T21:00:00Z");
    expect(m2.freshness.worstSyncUnit?.code).toBe("6478111");
  });
});

describe("Δ vs hari sebelumnya", () => {
  it("selisih total unit D vs D−1", () => {
    const m = buildHarianModel(
      base({
        dailySales: [sale(4, "2026-07-21", "SOLAR", 45_481), sale(4, "2026-07-22", "SOLAR", 45_422)],
      }),
    );
    expect(m.deltaByUnit[4]).toBe(-59);
    expect(m.deltaTotal).toBe(-59);
  });
  it("D−1 tanpa data → null, dan TOTAL Δ ikut null (tak memalsukan nol)", () => {
    const m = buildHarianModel(base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 100)] }));
    expect(m.deltaByUnit[4]).toBeNull();
    expect(m.deltaTotal).toBeNull();
  });
});

describe("G/L", () => {
  const glRow = (d: string, nama: string, gl: number | null): DailyGlRow => ({
    d,
    ckdbbm: productCode(nama),
    nama,
    fisik: 0,
    fisik_prev: 0,
    pen_do: 0,
    sales_gross: 0,
    tera: 0,
    gl,
    movement_invalid: false, excluded_tanks: 0,
    provisional: false,
  });

  it("harian difilter dari jendela MTD; MTD = Σ seluruh jendela", () => {
    const m = buildHarianModel(
      base({
        dailySales: [sale(4, "2026-07-22", "SOLAR", 0)],
        gl: new Map([
          [4, [glRow("2026-07-20", "SOLAR", 10), glRow("2026-07-22", "SOLAR", 42), glRow("2026-07-22", "PERTALITE", 107)]],
        ]),
      }),
    );
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBe(42);
    expect(m.glDaily.totalsByUnit[4]).toBe(149);
    expect(m.glMonthly.totalsByUnit[4]!.kum).toBe(159);
    expect(m.glMonthly.totalsByUnit[4]!.avg).toBeCloseTo(159 / 22, 9);
  });

  it("baris gl null dipertahankan dan total tidak memalsukan nol", () => {
    const m = buildHarianModel(
      base({ gl: new Map([[4, [glRow("2026-07-22", "SOLAR", null)]]]) }),
    );
    expect(m.glDaily.totalsByUnit[4]).toBeNull();
  });

  it("unit dengan penutup opname 0 dicatat di catatan kaki", () => {
    const m = buildHarianModel(base({ glSuspect: new Set([4]) }));
    expect(m.glSuspectUnits.map((u) => u.code)).toEqual(["6478106"]);
    expect(m.notes.join(" ")).toContain("penutup opname bernilai 0");
  });

  // Synthetic two-unit window; one product-day carries a SQL artefact verdict.
  const twoUnits = (reason: "penutup_nol" | "jangkar_nol", d = "2026-07-22") => base({
    units: [KB, IB],
    coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
    sync: [syn(4, "2026-07-24T07:33:00Z"), syn(1, "2026-07-24T07:33:00Z")],
    dailySales: [sale(4, "2026-07-21", "SOLAR", 100), sale(4, "2026-07-22", "SOLAR", 100), sale(4, "2026-07-22", "PERTALITE", 100),
      sale(1, "2026-07-21", "SOLAR", 100), sale(1, "2026-07-22", "SOLAR", 100)],
    gl: new Map([
      [4, [glRow("2026-07-22", "PERTALITE", 7),
        { ...glRow(d, "SOLAR", null), gl_raw: -6_000, gl_suspect: reason, provisional: true },
        d === "2026-07-22" ? glRow("2026-07-21", "SOLAR", -3) : glRow("2026-07-22", "SOLAR", 2)]],
      [1, [glRow("2026-07-21", "SOLAR", 4), glRow("2026-07-22", "SOLAR", -1)]],
    ]),
  });

  it.each(["penutup_nol", "jangkar_nol"] as const)(
    "artefak %s: sel/total unit & grup “—”, unit lain tetap utuh, catatan menyebut sumber", (reason) => {
      const m = buildHarianModel(twoUnits(reason));
      const solar = m.glDaily.rows.find((r) => r.key === "SOLAR")!;
      expect(solar.byUnit[4]).toBeNull();
      expect(solar.byUnit[1]).toBe(-1);
      expect(solar.total).toBeNull();
      expect(m.glDaily.rows.find((r) => r.key === "PERTALITE")!.byUnit[4]).toBe(7);
      expect(m.glDaily.totalsByUnit[4]).toBeNull();
      expect(m.glDaily.totalsByUnit[1]).toBe(-1);
      expect(m.glDaily.grandTotal).toBeNull();
      expect(m.glMonthly.totalsByUnit[4]!.kum).toBeNull();
      expect(m.glMonthly.totalsByUnit[1]!.kum).toBe(3);
      expect(m.glMonthly.grand.kum).toBeNull();
      expect(m).toMatchObject({ glProvisional: true, glMonthlyProvisional: true, glIncomplete: true });
      expect(m.glSuspectUnits.map((u) => u.unitId)).toEqual([4]);
      expect(m.notes.join(" ")).toContain("“Belum terverifikasi”");
      expect(m.notes.join(" ")).not.toMatch(/bukan kerugian|artefak/i);
      // Details name the actual unit/date/product and reason, with the raw audit.
      expect(m.glUnverified).toEqual([expect.objectContaining({
        unit: { code: expect.any(String), name: "Bundaran Kotabaru" }, d: "2026-07-22", produk: "SOLAR", reason })]);
    });

  it("artefak hari sebelumnya: hari-D tetap angka, MTD unit & grup “—”", () => {
    const m = buildHarianModel(twoUnits("penutup_nol", "2026-07-21"));
    expect(m.glDaily.totalsByUnit[4]).toBe(9);
    expect(m.glDaily.grandTotal).toBe(8);
    expect(m.glMonthly.rows.find((r) => r.key === "SOLAR")!.byUnit[4]!.kum).toBeNull();
    expect(m.glMonthly.totalsByUnit[1]!.kum).toBe(3);
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glProvisional).toBe(false);
  });

  it("baris stok 0 dengan vonis SQL null tidak ditahan (heuristik tak menyala)", () => {
    const m = buildHarianModel(base({
      dailySales: [sale(4, "2026-07-22", "SOLAR", 100)],
      gl: new Map([[4, [{ ...glRow("2026-07-22", "SOLAR", -5), gl_suspect: null, gl_raw: -5 }]]]),
    }));
    expect(m.glDaily.totalsByUnit[4]).toBe(-5);
    expect(m.glSuspectUnits).toEqual([]);
  });
});

describe("share (pengganti pie)", () => {
  it("proporsi MTD per unit, jumlah = 1", () => {
    const m = buildHarianModel(
      base({
        units: [KB, IB],
        coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
        sync: [syn(4, "2026-07-24T07:33:00Z"), syn(1, "2026-07-24T07:33:00Z")],
        dailySales: [sale(4, "2026-07-22", "SOLAR", 300), sale(1, "2026-07-22", "SOLAR", 700)],
      }),
    );
    expect(m.share.find((s) => s.unitId === 4)!.pct).toBeCloseTo(0.3, 9);
    expect(m.share.reduce((a, s) => a + (s.pct ?? 0), 0)).toBeCloseTo(1, 9);
  });
  it("total 0 → pct null (bukan NaN, bukan 0)", () => {
    expect(buildHarianModel(base()).share[0]!.pct).toBeNull();
  });
});

describe("scope: TOTAL hanya menjumlah unit ber-scope", () => {
  it("baris unit di luar daftar diabaikan (sabuk pengaman di atas RLS)", () => {
    const m = buildHarianModel(
      base({
        dailySales: [sale(4, "2026-07-22", "SOLAR", 100), sale(99, "2026-07-22", "SOLAR", 999_999)],
      }),
    );
    expect(m.daily.grandTotal).toBe(100);
    expect(m.units).toHaveLength(1);
  });
});

describe("util bulan", () => {
  it("addMonths melintasi tahun", () => {
    expect(addMonths("2026-07", -12)).toBe("2025-07");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
  });
  it("daysInYm termasuk kabisat", () => {
    expect(daysInYm("2026-02")).toBe(28);
    expect(daysInYm("2024-02")).toBe(29);
    expect(daysInYm("2026-07")).toBe(31);
  });
  it("ymLabel bahasa Indonesia", () => {
    expect(ymLabel("2026-07")).toBe("Jul 26");
    expect(ymLabel("2025-08")).toBe("Ags 25");
  });
  it("span mencakup 12 bulan DAN lantai rekor", () => {
    expect(harianSpanFrom("2026-07-22", "2025-12-29")).toBe("2025-07-01");
    // Jauh di masa depan: lantai rekor lebih tua dari 12 bulan → span melebar
    expect(harianSpanFrom("2028-07-22", "2025-12-29")).toBe("2025-12-29");
  });
});

describe("G/L provisional (hari berjalan)", () => {
  const glRow = (d: string, gl: number, provisional: boolean): DailyGlRow => ({
    d,
    ckdbbm: "BB-03",
    nama: "SOLAR",
    fisik: 0,
    fisik_prev: 0,
    pen_do: 0,
    sales_gross: 0,
    tera: 0,
    gl,
    movement_invalid: false, excluded_tanks: 0,
    provisional,
  });

  it("baris hari-D provisional → ditandai & dicatat, TIDAK disembunyikan", () => {
    const m = buildHarianModel(
      base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 0)], gl: new Map([[4, [glRow("2026-07-22", -116_445, true)]]]) }),
    );
    expect(m.glProvisional).toBe(true);
    expect(m.glDaily.totalsByUnit[4]).toBe(-116_445); // angkanya TETAP tampil
    expect(m.notes.join(" ")).toContain("SEMENTARA");
  });

  it("baris final → tak ada penanda", () => {
    const m = buildHarianModel(
      base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 0)], gl: new Map([[4, [glRow("2026-07-22", 58, false)]]]) }),
    );
    expect(m.glProvisional).toBe(false);
    expect(m.notes.join(" ")).not.toContain("SEMENTARA");
  });

  it("provisional pada hari LAIN dalam jendela MTD tidak menandai hari-D", () => {
    const m = buildHarianModel(
      base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 0)], gl: new Map([[4, [glRow("2026-07-20", 10, true), glRow("2026-07-22", 5, false)]]]) }),
    );
    expect(m.glProvisional).toBe(false);
  });
});

describe("N3 — provisional pada D−1 di JAM PAGI (kondisi harian, bukan tepi)", () => {
  /**
   * Tanggal default halaman = KEMARIN. Opname PENUTUP D−1 baru terekam pagi
   * hari D — jadi direksi yang membuka halaman ini pukul 6 pagi melihat D−1
   * dalam keadaan provisional. Ini terjadi SETIAP hari kerja.
   */
  const glRow = (d: string, gl: number, provisional: boolean): DailyGlRow => ({
    d,
    ckdbbm: "BB-03",
    nama: "SOLAR",
    fisik: provisional ? null : 1000,
    fisik_prev: 900,
    pen_do: 0,
    sales_gross: 0,
    tera: 0,
    gl,
    movement_invalid: false, excluded_tanks: 0,
    provisional,
  });

  it("D = kemarin, penutupnya belum masuk → DITANDAI", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-23", // kemarin, dilihat pagi tanggal 24
        gl: new Map([[4, [glRow("2026-07-22", 40, false), glRow("2026-07-23", -98_000, true)]]]),
        dailySales: [sale(4, "2026-07-23", "SOLAR", 1000)],
      }),
    );
    expect(m.glProvisional).toBe(true);
    expect(m.notes.join(" ")).toContain("SEMENTARA");
  });

  it("siang hari, penutup D−1 sudah masuk → TIDAK ditandai", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-23",
        gl: new Map([[4, [glRow("2026-07-23", 42, false)]]]),
        dailySales: [sale(4, "2026-07-23", "SOLAR", 1000)],
      }),
    );
    expect(m.glProvisional).toBe(false);
  });

  it("cukup SATU unit provisional untuk menandai halaman (tak boleh tenggelam)", () => {
    const m = buildHarianModel(
      base({
        units: [KB, IB],
        coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
        sync: [syn(4, "2026-07-24T07:33:00Z"), syn(1, "2026-07-24T07:33:00Z")],
        date: "2026-07-23",
        gl: new Map([
          [4, [glRow("2026-07-23", 42, false)]],
          [1, [glRow("2026-07-23", -50_000, true)]],
        ]),
        dailySales: [sale(4, "2026-07-23", "SOLAR", 1), sale(1, "2026-07-23", "SOLAR", 1)],
      }),
    );
    expect(m.glProvisional).toBe(true);
  });
});

describe("D6 — dua skala tren dipisah (batang vs garis TOTAL)", () => {
  const m = buildHarianModel(
    base({
      units: [KB, IB],
      coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
      sync: [syn(4, "2026-07-24T07:33:00Z"), syn(1, "2026-07-24T07:33:00Z")],
      dailySales: [
        sale(4, "2026-07-22", "SOLAR", 1_500_000),
        sale(1, "2026-07-22", "SOLAR", 1_000_000),
      ],
    }),
  );

  it("barMax = nilai per-unit terbesar, BUKAN total", () => {
    expect(m.trend.barMaxKum).toBeCloseTo(1500, 6);
    expect(m.trend.totalMaxKum).toBeCloseTo(2500, 6);
  });

  it("barMax selalu ≤ totalMax (≥2 unit) — sumbu kiri tak pernah lebih longgar", () => {
    expect(m.trend.barMaxKum).toBeLessThanOrEqual(m.trend.totalMaxKum);
    expect(m.trend.barMaxAvg).toBeLessThanOrEqual(m.trend.totalMaxAvg);
  });

  it("scope 1 unit: barMax == totalMax (dua sumbu berimpit, tetap benar)", () => {
    const one = buildHarianModel(
      base({ dailySales: [sale(4, "2026-07-22", "SOLAR", 1_000_000)] }),
    );
    expect(one.trend.barMaxKum).toBeCloseTo(one.trend.totalMaxKum, 6);
  });
});

describe("guard cakupan G/L — regresi BLOCKER Gate 4 (cache 24 jam menyajikan KOSONG)", () => {
  const glRow = (d: string, gl: number): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 1, fisik_prev: 1, pen_do: 0,
    sales_gross: 0, tera: 0, gl, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });
  const salesDays = (unit: number, days: string[]) =>
    days.map((d) => sale(unit, d, "SOLAR", 1000));

  it("GEJALA PERSIS Gate 4: jendela hanya berisi hari-D → MTD == harian → DITANDAI", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-23",
        dailySales: salesDays(4, ["2026-07-21", "2026-07-22", "2026-07-23"]),
        gl: new Map([[4, [glRow("2026-07-23", 100)]]]), // prefiks historis hilang
      }),
    );
    expect(m.glDaily.totalsByUnit[4]).toBe(100);
    expect(m.glMonthly.totalsByUnit[4]!.kum).toBeNull(); // tidak menjumlah jendela parsial
    expect(m.glIncomplete).toBe(true); // …dan sekarang MENYALAK
    expect(m.notes.join(" ")).toContain("Gain/Losses TIDAK LENGKAP");
    expect(m.glCoverage.find((c) => c.unitId === 4)).toMatchObject({ glDays: 1, salesDays: 3 });
  });

  it("jendela KOSONG total → sel dan total tidak tersedia, bukan 0", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-22",
        dailySales: salesDays(4, ["2026-07-21", "2026-07-22"]),
        gl: new Map([[4, []]]),
      }),
    );
    expect(m.glDaily.totalsByUnit[4]).toBeNull();
    expect(m.glIncomplete).toBe(true);
    expect(m.glCoverage.find((c) => c.unitId === 4)).toMatchObject({ glDays: 0, salesDays: 2 });
  });

  it("cakupan penuh → TIDAK menyalak (guard tak berisik)", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-22",
        dailySales: salesDays(4, ["2026-07-21", "2026-07-22"]),
        gl: new Map([[4, [glRow("2026-07-21", 10), glRow("2026-07-22", 42)]]]),
      }),
    );
    expect(m.glIncomplete).toBe(false);
    expect(m.glDaily.totalsByUnit[4]).toBe(42);
    expect(m.glMonthly.totalsByUnit[4]!.kum).toBe(52); // MTD ≠ harian
  });

  it("R1: produk terjual tanpa baris G/L → “Belum terverifikasi” dengan rincian; nol terukur tetap 0", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-22",
        dailySales: [...salesDays(4, ["2026-07-21", "2026-07-22"]), sale(4, "2026-07-22", "PERTAMAX", 500),
          sale(4, "2026-07-22", "DEXLITE", 0)], // nol volume: tidak dilabeli (cakupan tak diperluas)
        gl: new Map([[4, [glRow("2026-07-21", 0), glRow("2026-07-22", 0)]]]),
      }),
    );
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBe(0);
    expect(m.glDaily.rows.find((r) => r.key === "PERTAMAX")!.byUnit[4]).toBeNull();
    expect(m.glDaily.totalsByUnit[4]).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glUnverified).toEqual([{ unit: { code: KB.code, name: KB.name }, d: "2026-07-22", ckdbbm: "BB-02",
      produk: "PERTAMAX", reason: "penutup_tak_ada", tangki: null, prevDate: null, priorTeori: null, audit: null, terjual: 500 }]);
    // Status generik tetap ada dan menunjuk rinciannya.
    expect(m.glIncomplete).toBe(true);
    expect(m.notes.join(" ")).toContain("Gain/Losses TIDAK LENGKAP");
    expect(m.notes.join(" ")).toContain("panel “G/L Belum terverifikasi”");
  });

  it("hari G/L LEBIH banyak dari hari penjualan bukan alarm (opname tanpa jualan)", () => {
    const m = buildHarianModel(
      base({
        date: "2026-07-22",
        dailySales: salesDays(4, ["2026-07-22"]),
        gl: new Map([[4, [glRow("2026-07-21", 10), glRow("2026-07-22", 42)]]]),
      }),
    );
    expect(m.glIncomplete).toBe(false);
  });
});


describe("G/L integrity — product coverage and source quality", () => {
  const row = (over: Partial<DailyGlRow> = {}): DailyGlRow => ({
    d: "2026-10-02", ckdbbm: "BB-03", nama: "SOLAR", fisik: 1000,
    fisik_prev: 1100, pen_do: 0, sales_gross: 100, tera: 0, gl: 0,
    movement_invalid: false, excluded_tanks: 0, provisional: false, ...over,
  });
  const input = (over: Partial<HarianInput> = {}) => base({
    date: "2026-10-02",
    dailySales: [sale(4, "2026-10-02", "SOLAR", 100), sale(4, "2026-10-02", "PERTALITE", 200)],
    gl: new Map([[4, [row(), row({ ckdbbm: "BB-07", nama: "PERTALITE", gl: 12 })]]]), ...over,
  });
  it("one absent product is not hidden by another product on the same day", () => {
    const m = buildHarianModel(input({ gl: new Map([[4, [row()]]]) }));
    expect(m.glCoverage[0]).toMatchObject({ salesDays: 1, glDays: 1 });
    expect(m.glIncomplete).toBe(true);
    expect(m.glDaily.rows.find((r) => r.key === "PERTALITE")!.byUnit[4]).toBeNull();
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glMonthly.grand.avg).toBeNull();
  });
  it("null product and excluded partial product cannot become zero or a signed result", () => {
    const m = buildHarianModel(input({ gl: new Map([[4, [row({ gl: null }), row({
      ckdbbm: "BB-07", nama: "PERTALITE", gl: -6000, excluded_tanks: 1,
    })]]]) }));
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBeNull();
    expect(m.glDaily.rows.find((r) => r.key === "PERTALITE")!.byUnit[4]).toBeNull();
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glProvisional).toBe(true);
    expect(m.glMonthlyProvisional).toBe(true);
  });
  it("a measured zero stays numeric, while unused products stay zero", () => {
    const m = buildHarianModel(input());
    expect(m.glIncomplete).toBe(false);
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBe(0);
    expect(m.glDaily.rows.find((r) => r.key === "PERTAMAX TURBO")!.byUnit[4]).toBe(0);
    expect(m.glDaily.grandTotal).toBe(12);
  });
  it("provisional earlier day affects MTD but not final selected day", () => {
    const m = buildHarianModel(input({ gl: new Map([[4, [row(), row({ckdbbm:"BB-07",nama:"PERTALITE",gl:12}), row({d:"2026-10-01", gl:7, provisional:true})]]]) }));
    expect(m.glProvisional).toBe(false);
    expect(m.glMonthlyProvisional).toBe(true);
    expect(m.glMonthly.grand.kum).toBe(19);
  });
  it("source zero-closing is warned and withheld, never silently repaired or summed", () => {
    const m = buildHarianModel(input({dailySales: [sale(4,"2026-10-02","SOLAR",100)], gl:new Map([[4,[row({fisik:0,fisik_prev:5000,gl:-4900})]]])}));
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glIncomplete).toBe(true);
    expect(m.glProvisional).toBe(true);
    expect(m.glSuspectUnits.map((u) => u.unitId)).toEqual([4]);
    expect(m.notes.join(" ")).toContain("penutup opname bernilai 0");
  });
  it.each([
    ["invalid movement", { movement_invalid: true }],
    ["non-finite G/L", { gl: Number.NaN }],
  ] as const)("structural %s row is unavailable, never a signed cell or total", (_name, over) => {
    const m = buildHarianModel(input({ gl: new Map([[4, [row({ gl: -40, ...over }),
      row({ ckdbbm: "BB-07", nama: "PERTALITE", gl: 12 })]]]) }));
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBeNull();
    expect(m.glDaily.rows.find((r) => r.key === "PERTALITE")!.byUnit[4]).toBe(12);
    expect(m.glDaily.totalsByUnit[4]).toBeNull();
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m).toMatchObject({ glProvisional: true, glMonthlyProvisional: true, glIncomplete: true });
    expect(m.glSuspectUnits).toEqual([]);
  });
});


it("distinct unknown product codes cannot mask one another through Lain-lain", () => {
  const m = buildHarianModel(base({ date:"2026-10-02", dailySales:[sale(4,"2026-10-02","P1",100),sale(4,"2026-10-02","P2",200)], gl:new Map([[4,[{
    d:"2026-10-02",ckdbbm:"P1",nama:null,fisik:100,fisik_prev:200,pen_do:0,sales_gross:100,tera:0,gl:0,movement_invalid: false, excluded_tanks:0,provisional:false,
  }]]]) }));
  expect(m.glIncomplete).toBe(true);
  expect(m.glDaily.rows.find((r) => r.key === OTHER_KEY)!.byUnit[4]).toBeNull();
});


it("dated zero-closing warns its day and following anchor without flagging unrelated days", () => {
  const r: DailyGlRow = { d:"2026-10-02",ckdbbm:"BB-03",nama:"SOLAR",fisik:500,fisik_prev:400,pen_do:0,sales_gross:0,tera:0,gl:100,movement_invalid: false, excluded_tanks:0,provisional:false };
  const input=base({date:"2026-10-02",dailySales:[sale(4,"2026-10-02","SOLAR",0)],gl:new Map([[4,[r]]])});
  for (const day of ["2026-10-01","2026-10-02"]) {
    const m=buildHarianModel({...input,glSuspectDates:[{unitId:4,date:day}]});
    expect(m.glProvisional).toBe(true);expect(m.glMonthlyProvisional).toBe(true);
    expect(m.glDaily.grandTotal).toBe(100);
  }
  const before=buildHarianModel({...input,glSuspectDates:[{unitId:4,date:"2026-09-30"}]});
  expect(before.glProvisional).toBe(false);expect(before.glMonthlyProvisional).toBe(true);
  const future=buildHarianModel({...input,glSuspectDates:[{unitId:4,date:"2026-10-03"}]});
  expect(future.glProvisional).toBe(false);expect(future.glMonthlyProvisional).toBe(false);
});


describe("G/L freshness for known active units", () => {
  const glRow = (d: string, gl: number): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 2000, fisik_prev: 3000,
    pen_do: 0, sales_gross: 1000, tera: 0, gl, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });

  it("withholds stale-unit daily and MTD contributions even when every received sales row has G/L", () => {
    const m = buildHarianModel(base({
      units: [KB, IB], date: "2026-10-04",
      dailySales: [sale(4, "2026-10-04", "SOLAR", 1000), sale(1, "2026-10-03", "SOLAR", 1000)],
      gl: new Map([[4, [glRow("2026-10-04", -5)]], [1, [glRow("2026-10-03", 7)]]]),
      coverage: [cov(4, "2011-10-06"), cov(1, "2022-08-31")],
    }));
    expect(m.freshness.incomplete).toBe(true);
    expect(m.glDaily.totalsByUnit[4]).toBe(-5);
    expect(m.glMonthly.totalsByUnit[4]).toEqual({ kum: -5, avg: -1.25 });
    expect(m.glDaily.totalsByUnit[1]).toBeNull();
    expect(m.glMonthly.totalsByUnit[1]).toEqual({ kum: null, avg: null });
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand).toEqual({ kum: null, avg: null });
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.total).toBeNull();
    expect(m.glIncomplete).toBe(true);
    expect(m.glProvisional).toBe(true);
    expect(m.glMonthlyProvisional).toBe(true);
  });

  it("keeps not-yet-operating units neutral instead of declaring historical group totals missing", () => {
    const m = buildHarianModel(base({
      units: [KB, IB], date: "2026-10-04",
      dailySales: [sale(4, "2026-10-04", "SOLAR", 1000)],
      gl: new Map([[4, [glRow("2026-10-04", -5)]]]),
      coverage: [cov(4, "2011-10-06"), cov(1, "2026-10-05")],
    }));
    expect(m.units.find((u) => u.unitId === 1)!.notYet).toBe(true);
    expect(m.freshness.incomplete).toBe(false);
    expect(m.glDaily.grandTotal).toBe(-5);
    expect(m.glMonthly.grand.kum).toBe(-5);
    expect(m.glIncomplete).toBe(false);
    expect(m.glProvisional).toBe(false);
  });
});

describe("Harian G/L rejects absent product identities", () => {
  const date = "2026-10-04";
  const glRow = (ckdbbm: string | null): DailyGlRow => ({
    d: date, ckdbbm, nama: null, fisik: 2000, fisik_prev: 3000,
    pen_do: 0, sales_gross: 1000, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });
  const unknownSale = (ckdbbm: string | null): DailySalesRow => ({
    ...sale(4, date, "UNKNOWN", 1000), ckdbbm, nama: null,
  });

  it.each([null, "", "   ", "\t\n"])("does not crash or verify zero for matching unidentified sales/stock (%j)", (ckdbbm) => {
    const m = buildHarianModel(base({ date, dailySales: [unknownSale(ckdbbm)], gl: new Map([[4, [glRow(ckdbbm)]]]) }));
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glDaily.rows.find((r) => r.key === OTHER_KEY)!.byUnit[4]).toBeNull();
    expect(m.glIncomplete).toBe(true);
    expect(m.glProvisional).toBe(true);
    expect(m.glMonthlyProvisional).toBe(true);
    expect(m.glCoverage[0]!.glDays).toBe(0);
    expect(m.notes.join(" ")).toContain("tanpa kode produk");
  });

  it.each([null, "", "   "])("unknown active sales without G/L invalidate product and dependent totals (%j)", (ckdbbm) => {
    const m = buildHarianModel(base({ date, dailySales: [unknownSale(ckdbbm)], gl: new Map() }));
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glIncomplete).toBe(true);
  });

  it("unknown stock cannot satisfy a known sales product by borrowing its name", () => {
    const m = buildHarianModel(base({
      date, dailySales: [sale(4, date, "SOLAR", 1000)],
      gl: new Map([[4, [{ ...glRow(null), nama: "SOLAR" }]]]),
    }));
    expect(m.glDaily.rows.find((r) => r.key === "SOLAR")!.byUnit[4]).toBeNull();
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glIncomplete).toBe(true);
  });

  it("keeps trimmed nonempty unmapped codes valid and distinct", () => {
    const dailySales = [unknownSale("UNMAPPED-A"), unknownSale("UNMAPPED-B")];
    const gl = new Map([[4, [glRow(" UNMAPPED-A "), glRow("UNMAPPED-B")]]]);
    const m = buildHarianModel(base({ date, dailySales, gl }));
    expect(m.glDaily.grandTotal).toBe(0);
    expect(m.glMonthly.grand.kum).toBe(0);
    expect(m.glIncomplete).toBe(false);
    expect(m.glProvisional).toBe(false);
    gl.set(4, [glRow("UNMAPPED-A")]);
    const missing = buildHarianModel(base({ date, dailySales, gl }));
    expect(missing.glDaily.grandTotal).toBeNull();
    expect(missing.glIncomplete).toBe(true);
  });

  it("ignores unknown identities outside the requested units and dates", () => {
    const m = buildHarianModel(base({
      date,
      dailySales: [unknownSale("UNMAPPED-A"), { ...unknownSale(null), unit_id: 1 }, { ...unknownSale(null), d: "2026-11-01" }],
      gl: new Map([[4, [glRow("UNMAPPED-A"), { ...glRow(null), d: "2026-11-01" }]], [1, [glRow(null)]]]),
    }));
    expect(m.glDaily.grandTotal).toBe(0);
    expect(m.glIncomplete).toBe(false);
  });
});

it("Harian does not infer measured zero from an unidentified zero-volume sales row without G/L", () => {
  const m = buildHarianModel(base({
    date: "2026-10-04",
    dailySales: [{ ...sale(4, "2026-10-04", "UNKNOWN", 0), ckdbbm: null, nama: null }],
  }));
  expect(m.glDaily.grandTotal).toBeNull();
  expect(m.glMonthly.grand.kum).toBeNull();
  expect(m.glIncomplete).toBe(true);
});

describe("Harian empty G/L windows are unavailable rather than measured zero", () => {
  const date = "2026-07-22";
  const row = (d: string, gl: number | null): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 2000, fisik_prev: 2000,
    pen_do: 0, sales_gross: 0, tera: 0, gl, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });

  it("all-notYet scope has unavailable product/unit/group totals for both day and month", () => {
    const m = buildHarianModel(base({
      units: [KB, IB], date, dailySales: [], gl: new Map(),
      coverage: [cov(4, null), cov(1, "2026-08-01")],
    }));
    expect(m.units.every((u) => u.notYet)).toBe(true);
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand).toEqual({ kum: null, avg: null });
    expect(Object.values(m.glDaily.totalsByUnit)).toEqual([null, null]);
    expect(Object.values(m.glMonthly.totalsByUnit)).toEqual([{ kum: null, avg: null }, { kum: null, avg: null }]);
    for (const r of m.glDaily.rows) {
      expect(r.total).toBeNull();
      expect(Object.values(r.byUnit).every((v) => v === null)).toBe(true);
    }
    for (const r of m.glMonthly.rows) {
      expect(r.total).toEqual({ kum: null, avg: null });
      expect(Object.values(r.byUnit).every((v) => v.kum === null && v.avg === null)).toBe(true);
    }
    expect(m.glIncomplete).toBe(true);
  });

  it("a known empty selected day also invalidates the incomplete MTD sum", () => {
    const m = buildHarianModel(base({
      date, dailySales: [sale(4, date, "SOLAR", 0), sale(4, "2026-07-21", "SOLAR", 0)],
      gl: new Map([[4, [row("2026-07-21", 7)]]]),
    }));
    expect(m.freshness.incomplete).toBe(false);
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glDaily.rows.every((r) => r.total === null)).toBe(true);
    expect(m.glProvisional).toBe(true);
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glMonthly.grand.avg).toBeNull();
    expect(m.glMonthly.rows.find((r) => r.key === "SOLAR")!.byUnit[4]!.kum).toBeNull();
    expect(m.glIncomplete).toBe(true);
    expect(m.glMonthlyProvisional).toBe(true);
  });

  it("a valid selected-day zero stays measured while an earlier unknown balance blocks MTD", () => {
    const m = buildHarianModel(base({
      date, dailySales: [sale(4, date, "SOLAR", 0), sale(4, "2026-07-21", "SOLAR", 0)],
      gl: new Map([[4, [row("2026-07-21", null), row(date, 0)]]]),
    }));
    expect(m.glDaily.grandTotal).toBe(0);
    expect(m.glProvisional).toBe(false);
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glIncomplete).toBe(true);
  });

  it("a genuine observed zero keeps notYet units neutral in the group", () => {
    const m = buildHarianModel(base({
      units: [KB, IB], date, dailySales: [sale(4, date, "SOLAR", 0)],
      gl: new Map([[4, [row(date, 0)]]]),
      coverage: [cov(4, "2011-10-06"), cov(1, "2026-08-01")],
    }));
    expect(m.units.find((u) => u.unitId === 1)!.notYet).toBe(true);
    expect(m.glDaily.grandTotal).toBe(0);
    expect(m.glMonthly.grand.kum).toBe(0);
    expect(m.glIncomplete).toBe(false);
    expect(m.glProvisional).toBe(false);
  });

  it("does not infer window evidence from out-of-scope or out-of-window rows", () => {
    const m = buildHarianModel(base({
      date, dailySales: [], coverage: [cov(4, null)],
      gl: new Map([[1, [row(date, 0)]], [4, [row("2026-06-30", 0), row("2026-07-23", 0)]]]),
    }));
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
  });

  it("empty unit selection also has no observed G/L", () => {
    const m = buildHarianModel(base({ units: [], date, dailySales: [], gl: new Map(), coverage: [] }));
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glDaily.rows.every((r) => r.total === null)).toBe(true);
  });
});


it("known zero-sales dates without G/L cannot leave a final partial MTD total", () => {
  const row: DailyGlRow = {
    d: "2026-07-22", ckdbbm: "BB-03", nama: "SOLAR", fisik: 2000, fisik_prev: 2000,
    pen_do: 0, sales_gross: 0, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
  };
  const m = buildHarianModel(base({
    date: "2026-07-22",
    dailySales: [sale(4, "2026-07-21", "SOLAR", 0), sale(4, "2026-07-22", "SOLAR", 0)],
    gl: new Map([[4, [row]]]),
  }));
  expect(m.glDaily.grandTotal).toBe(0);
  expect(m.glProvisional).toBe(false);
  expect(m.glMonthly.grand.kum).toBeNull();
  expect(m.glMonthly.grand.avg).toBeNull();
  expect(m.glMonthlyProvisional).toBe(true);
  expect(m.glIncomplete).toBe(true);
});

it("zero-activity products remain neutral when their unit/date has measured G/L", () => {
  const row: DailyGlRow = {
    d: "2026-07-22", ckdbbm: "BB-03", nama: "SOLAR", fisik: 2000, fisik_prev: 2000,
    pen_do: 0, sales_gross: 0, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
  };
  const m = buildHarianModel(base({
    date: "2026-07-22",
    dailySales: [sale(4, "2026-07-22", "SOLAR", 0), sale(4, "2026-07-22", "PERTALITE", 0)],
    gl: new Map([[4, [row]]]),
  }));
  expect(m.glDaily.grandTotal).toBe(0);
  expect(m.glMonthly.grand.kum).toBe(0);
  expect(m.glIncomplete).toBe(false);
});


it("exact G/L dates are required even when distinct day counts match", () => {
  const row = (d: string): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 2000, fisik_prev: 2000,
    pen_do: 0, sales_gross: 0, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });
  const m = buildHarianModel(base({
    date: "2026-07-22",
    dailySales: [sale(4, "2026-07-20", "SOLAR", 0), sale(4, "2026-07-22", "SOLAR", 0)],
    gl: new Map([[4, [row("2026-07-20"), row("2026-07-21")]]]),
  }));
  expect(m.glCoverage[0]).toMatchObject({ salesDays: 2, glDays: 2 });
  expect(m.glDaily.grandTotal).toBeNull();
  expect(m.glMonthly.grand.kum).toBeNull();
  expect(m.glMonthlyProvisional).toBe(true);
  expect(m.glIncomplete).toBe(true);
});
