import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnomalyItem } from "@/lib/anomalies";
import {
  anomalyFeedRange,
  buildBoardCore,
  buildBoardEval,
  TARGET_SOURCE_LABEL,
  type BoardCoreInput,
  type BoardEvalInput,
  type BoardUnit,
  type DatedDailyGlInput,
  type GlWindows,
  type SalesGrainRow,
} from "@/lib/board-model";
import { dateShort } from "@/lib/format";
import { addDays, rangeDays, resolveBoardPeriod, todayWib, type DateRange } from "@/lib/periods";

// 2026-07-16 WIB
const NOW = new Date("2026-07-16T03:00:00Z");
const TODAY = "2026-07-16";
const PERIOD = resolveBoardPeriod("bulan", {}, NOW); // range 1–16 Jul 2026

const IB: BoardUnit = { unit_id: 1, code: "6478111", name: "Imam Bonjol" };
const BK: BoardUnit = { unit_id: 2, code: "6378301", name: "Bakau" };

const s = (unit_id: number, d: string, nama: string, vol: number, omzet: number): SalesGrainRow => ({
  unit_id,
  d,
  ckdbbm: nama, // kunci produk unik per nama (fixture)
  nama,
  vol,
  omzet,
});

const glRow = (gl: number | null, provisional = false): DatedDailyGlInput => ({
  d: "2026-07-16",
  ckdbbm: "PERTALITE",
  nama: "PERTALITE",
  gl,
  tera: 0,
  excluded_tanks: 0,
  provisional,
});

/** Grain fixture: IB punya histori penuh; BK hanya 2026. */
const SALES: SalesGrainRow[] = [
  // IB — jendela aktif Jul 2026 (PSO + NPSO utk bauran)
  s(1, "2026-07-16", "PERTALITE", 1000, 10_000_000),
  s(1, "2026-07-16", "PERTAMAX", 120, 1_800_000),
  // IB — MoM prev (Jun 2026)
  s(1, "2026-06-16", "PERTALITE", 800, 8_000_000),
  s(1, "2026-06-16", "PERTAMAX", 80, 1_200_000),
  // IB — YoY prev (Jul 2025)
  s(1, "2025-07-16", "PERTALITE", 500, 5_000_000),
  // IB — sisa YTD cur & prev
  s(1, "2026-02-10", "PERTALITE", 200, 2_000_000),
  s(1, "2025-02-10", "PERTALITE", 100, 1_000_000),
  // BK — hanya 2026 (histori < 1 tahun)
  s(2, "2026-07-16", "PERTALITE", 400, 4_000_000),
  s(2, "2026-06-16", "PERTALITE", 300, 3_000_000),
];

/** Full dated product coverage: one nonzero balance and measured zero on other rows. */
function glWindow(unit: number, w: DateRange, total: number, provisional = false): DatedDailyGlInput[] {
  return SALES.filter((r) => r.unit_id === unit && r.d >= w.from && r.d <= w.to)
    .map((r, i) => ({ ...glRow(i === 0 ? total : 0, provisional), d: r.d, ckdbbm: r.ckdbbm, nama: r.nama }));
}

const GL_RANGE = new Map<number, DatedDailyGlInput[]>([
  [1, glWindow(1, PERIOD.range, -11.2)], // vol IB cur = 1120 → glPct = −1%
  [2, glWindow(2, PERIOD.range, 1, true)],
]);

function glWindows(): GlWindows {
  return {
    range: new Map(GL_RANGE),
    momPrev: new Map([[1, glWindow(1, PERIOD.mom.prev, -4.4)], [2, glWindow(2, PERIOD.mom.prev, 0)]]),
    yoyPrev: new Map([[1, glWindow(1, PERIOD.yoy.prev, -5)]]),
    ytdCur: new Map([[1, glWindow(1, PERIOD.ytd.cur, -13.2)], [2, glWindow(2, PERIOD.ytd.cur, 1)]]),
    ytdPrev: new Map([[1, glWindow(1, PERIOD.ytd.prev, -3)]]),
  };
}

function coreInput(over: Partial<BoardCoreInput> = {}): BoardCoreInput {
  return {
    units: [IB, BK],
    period: PERIOD,
    mode: "kumulatif",
    today: TODAY,
    dailySales: SALES,
    glRange: GL_RANGE,
    shift: new Map([
      [1, { shifts: 3, last_dtgljam: "2026-07-16T14:00:00Z" }],
      [2, { shifts: 2, last_dtgljam: null }],
    ]),
    anomalies: [],
    ...over,
  };
}

describe("buildBoardCore — KPI & struktur", () => {
  it.each([
    { gl: 4000, provisional: false, value: "+48,78%", ratio: "48,78%" },
    { gl: -4000, provisional: false, value: "−48,78%", ratio: "-48,78%" },
    { gl: 4000, provisional: true, value: "+48,78%", ratio: "48,78%" },
    { gl: -4000, provisional: true, value: "−48,78%", ratio: "-48,78%" },
    { gl: 0, provisional: false, value: "0%", ratio: "0%" },
  ])("labels G/L $gl (provisional=$provisional) without calling a gain a loss", ({ gl, provisional, value, ratio }) => {
    const m = buildBoardCore(coreInput({
      units: [IB], dailySales: [s(1, TODAY, "PERTALITE", 8200, 82_000_000)],
      glRange: new Map([[1, [glRow(gl, provisional)]]]),
    }));
    expect(m.kpi[1]).toMatchObject({ value, provisional, subTone: provisional ? "warning" : gl === 0 ? "success" : "danger" });
    expect(m.ranking[0]).toMatchObject({ gl: value, glAbnormal: gl !== 0, glProvisional: provisional, glStatus: provisional ? "SEMENTARA" : null });
    const chips = m.verdict.chips.filter((c) => /G\/L|Losses/.test(c.text));
    const notes = m.ranking[0]!.notes.filter((n) => /G\/L|Losses/.test(n.text));
    expect(chips).toEqual(gl === 0 ? [] : [{ tone: provisional ? "warning" : "danger", text: provisional
      ? "G/L Imam Bonjol · sementara (opname belum final)" : `G/L Imam Bonjol ${ratio}` }]);
    expect(notes).toEqual(gl === 0 ? [] : [{ tone: provisional ? "warning" : "danger", text: provisional
      ? "G/L sementara — menunggu opname penutup" : `G/L ${ratio} — di atas ambang 0,5%/100 L` }]);
  });

  it("baris KPI = 4 keluarga TETAP (omzet, gl, gas, oil) — kepatuhan input BUKAN kartu", () => {
    const m = buildBoardCore(coreInput());
    expect(m.kpi.map((k) => k.key)).toEqual(["omzet", "gl", "gas", "oil"]);
    // kepatuhan pindah ke chips (unit shift 2/3) — identitas exception dipertahankan
    expect(m.verdict.chips.some((c) => c.text.includes("Bakau: shift 2/3"))).toBe(true);
    expect(m.incompleteToday).toBe(true);
  });
  it("agregat omzet/vol = Σ unit terpilih; G/L% = Σ signed / Σ vol", () => {
    const m = buildBoardCore(coreInput());
    expect(m.kpi[0]!.value).toContain("15,8"); // 10M+1,8M+4M = Rp 15,8 jt
    // gl: (−11,2 + 1) / (1120 + 400) = −0,671%
    expect(m.kpi[1]!.value).toBe("−0,67%");
    expect(m.kpi[1]!.provisional).toBe(true); // BK provisional menular ke agregat
  });
  it("bauran pakai target rata-rata tertimbang periode (Jul = 12,53%)", () => {
    const m = buildBoardCore(coreInput({ units: [IB] }));
    const gas = m.kpi[2]!;
    expect(gas.value).toBe("12,0%"); // 120/1000
    expect(gas.sub).toContain("target rata-rata periode");
    expect(gas.sub).toContain("12,5%");
  });
  it("RBAC: model HANYA memuat unit dari input (tak menambah unit)", () => {
    const m = buildBoardCore(coreInput({ units: [BK] }));
    expect(m.unitsCount).toBe(1);
    expect(m.ranking).toHaveLength(1);
    expect(m.ranking[0]!.code).toBe(BK.code);
  });
  it("ranking desc by omzet + kolom NPSO gasoil (rd) ada", () => {
    const m = buildBoardCore(coreInput());
    expect(m.ranking.map((r) => r.name)).toEqual(["Imam Bonjol", "Bakau"]);
    expect(m.ranking[0]!.rd).toBeDefined();
    expect(m.ranking[0]!.laporanHref).toContain(PERIOD.range.to);
  });
});

describe("buildBoardCore — label konteks: feed anomali & sumber target", () => {
  // Laporan historis (Feb 2024) dibuka saat feed hidup berada di Okt 2026.
  const FEED_NOW = new Date("2026-10-06T03:00:00Z");
  const FEED_TODAY = todayWib(FEED_NOW);
  const FEB_2024 = resolveBoardPeriod("custom", { from: "2024-02-01", to: "2024-02-29" }, FEED_NOW);
  const febSales = [s(1, "2024-02-10", "PERTALITE", 1000, 10_000_000), s(1, "2024-02-10", "PERTAMAX", 120, 1_800_000)];
  const historical = (anomalies: AnomalyItem[]) => buildBoardCore(coreInput({
    units: [IB], period: FEB_2024, today: FEED_TODAY, dailySales: febSales, glRange: new Map(), anomalies,
  }));
  const item = (dateIso: string): AnomalyItem => ({
    tone: "warning", tier: "major", sev: 1, dateIso, title: "Uji", unit: "64.781.11", desc: "", time: "",
  });
  const fullWeek = { from: addDays(FEED_TODAY, -6), to: FEED_TODAY };

  it("feed kosong pada periode historis tetap menyebut tujuh hari penuh s/d hari ini, bukan periode laporan", () => {
    const m = historical([]);
    expect(FEB_2024.range).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(m.anomalyFeed.range).toEqual(fullWeek);
    expect(rangeDays(m.anomalyFeed.range)).toBe(7);
    expect(m.anomalyFeed.label).toContain(`${dateShort(fullWeek.from)} – ${dateShort(fullWeek.to)}`);
    expect(m.anomalyFeed.label).toContain("tidak mengikuti filter periode");
    expect(m.anomalyFeed.label).not.toContain("2024");
  });

  it("feed jarang: rentang TIDAK diturunkan dari min/max tanggal item; item diteruskan apa adanya", () => {
    const items = [item(addDays(FEED_TODAY, -2)), item(addDays(FEED_TODAY, -3))];
    const m = historical(items);
    expect(m.anomalyFeed.range).toEqual(fullWeek);
    expect(m.anomalies).toBe(items);
  });

  it("rentang feed sama untuk setiap filter periode", () => {
    const ranges = (["today", "7d", "bulan"] as const)
      .map((k) => resolveBoardPeriod(k, {}, FEED_NOW))
      .concat(FEB_2024)
      .map((period) => buildBoardCore(coreInput({ period, today: FEED_TODAY })).anomalyFeed.range);
    for (const r of ranges) expect(r).toEqual(fullWeek);
  });

  it("target bauran periode historis tetap dihitung (semantik tak berubah) dan menyebut workbook 2026", () => {
    const gas = historical([]).kpi.find((k) => k.key === "gas")!;
    expect(gas.sub).toBe(`target rata-rata periode 10,7% · ${TARGET_SOURCE_LABEL}`); // Feb: .107
    expect(TARGET_SOURCE_LABEL).toBe("workbook 2026");
  });

  it("batas feed sama dengan buildAnomalies (today − 6 … today)", () => {
    // Penjaga drift: bila jendela anomalies.ts berubah, label ini wajib ikut.
    const src = readFileSync(resolve(__dirname, "anomalies.ts"), "utf8");
    expect(src).toContain("const dari = addDays(today, -6);");
    expect(src).toContain("getDailyGlByProduct(u.unit_id, addDays(today, -6), today)");
    expect(src).toContain("getZeroClosingEvents(unitIds, addDays(today, -6), today)");
    expect(anomalyFeedRange(FEED_TODAY)).toEqual(fullWeek);
  });
});

describe("buildBoardCore — tren mengikuti filter & mode", () => {
  it("kumulatif: satu seri; hari = panjang rentang", () => {
    const m = buildBoardCore(coreInput());
    expect(m.trend.series).toHaveLength(1);
    expect(m.trend.days).toHaveLength(16); // 1–16 Jul
    expect(m.trend.note).toBeNull();
    // nilai Rp & Liter tersedia utk toggle
    expect(m.trend.series[0]!.rp).toHaveLength(16);
    expect(m.trend.series[0]!.liter).toHaveLength(16);
  });
  it("banding: multi-seri per unit + perUnit di kartu KPI", () => {
    const m = buildBoardCore(coreInput({ mode: "banding" }));
    expect(m.trend.series.map((s) => s.code)).toEqual([IB.code, BK.code]);
    expect(m.kpi[0]!.perUnit).toHaveLength(2);
  });
  it("filter 1 hari → konteks 14 hari dengan catatan eksplisit", () => {
    const p = resolveBoardPeriod("today", {}, NOW);
    const m = buildBoardCore(coreInput({ period: p }));
    expect(m.trend.days).toHaveLength(14);
    expect(m.trend.note).toContain("14 hari");
  });
  it("penanda hari berjalan: runningIdx = indeks hari ini; null utk rentang historis", () => {
    // preset bulan berakhir hari ini → titik terakhir = hari berjalan
    const m = buildBoardCore(coreInput());
    expect(m.trend.runningIdx).toBe(m.trend.days.length - 1);
    expect(m.trend.days[m.trend.runningIdx!]).toBe(TODAY);
    // konteks 14-hari (filter 1 hari) juga berakhir di hari berjalan
    const t = buildBoardCore(coreInput({ period: resolveBoardPeriod("today", {}, NOW) }));
    expect(t.trend.runningIdx).toBe(13);
    // rentang custom sepenuhnya historis → tanpa penanda
    const h = buildBoardCore(
      coreInput({ period: resolveBoardPeriod("custom", { from: "2026-06-01", to: "2026-06-30" }, NOW) }),
    );
    expect(h.trend.runningIdx).toBeNull();
  });
});

function evalInput(over: Partial<BoardEvalInput> = {}): BoardEvalInput {
  return {
    units: [IB],
    period: PERIOD,
    today: TODAY,
    dailySales: SALES,
    gl: glWindows(),
    coverage: new Map([
      [1, "2022-08-31"],
      [2, "2026-01-05"],
    ]),
    incompleteToday: false,
    ...over,
  };
}

describe("buildBoardEval — MoM/YoY/YTD", () => {
  it("omzet: MoM/YoY naik, YTD = Σ 1 Jan..to & Δ vs YTD tahun lalu", () => {
    const e = buildBoardEval(evalInput());
    const o = e.cards.omzet;
    // cur = 11,8jt; mom prev = 9,2jt → naik
    expect(o.mom.text).toContain("▲");
    expect(o.mom.tone).toBe("up");
    // yoy prev 5jt → cur 11,8jt
    expect(o.yoy.text).toContain("▲");
    // ytd cur = Feb 2jt + Jun 9,2jt + Jul 11,8jt = 23jt
    expect(o.ytdValue).toContain("23,0");
    expect(o.ytdDelta.tone).toBe("up"); // vs 6jt (2025: Feb 1jt + Jul 5jt)
  });
  it("G/L: delta poin persen bertanda (−1% vs −0,5% = −0,50 pt)", () => {
    const e = buildBoardEval(evalInput());
    expect(e.cards.gl.mom.text).toBe("−0,50 pt");
    expect(e.cards.gl.mom.tone).toBe("down");
    // ytd: gl −13,2 / vol ytd (200+880+1120) = −0,60%
    expect(e.cards.gl.ytdValue).toBe("−0,60%");
  });
  it("bauran: pembanding tanpa target (aktual vs aktual, pt)", () => {
    const e = buildBoardEval(evalInput());
    // cur 12% vs mom 10% = +2 pt
    expect(e.cards.gas.mom.text).toBe("+2,00 pt");
  });
  it("histori < 1 tahun → '—' + keterangan, BUKAN 0/parsial (per unit & agregat)", () => {
    // BK onboard 2026-01-05: YoY (Jul 2025) & YTD-prev (2025) tak tercakup
    const e = buildBoardEval(evalInput({ units: [IB, BK] }));
    expect(e.cards.omzet.yoy.text).toBe("—");
    expect(e.cards.omzet.yoy.note).toContain("histori < 1 tahun");
    expect(e.cards.omzet.yoy.note).toContain("Bakau");
    // MoM (Jun 2026) TERCAKUP utk BK → tetap angka
    expect(e.cards.omzet.mom.text).not.toBe("—");
    // blok per unit: IB YoY berangka, BK "—"
    const ib = e.units.find((u) => u.code === IB.code)!;
    const bk = e.units.find((u) => u.code === BK.code)!;
    expect(ib.rows[0]!.yoy.text).not.toBe("—");
    expect(bk.rows[0]!.yoy.text).toBe("—");
    expect(bk.rows[0]!.yoy.note).toContain("histori < 1 tahun");
  });
  it("blok evaluasi per unit: 5 metrik (Omset, Volume, Gain/Loss, NPSO G, NPSO D)", () => {
    const e = buildBoardEval(evalInput());
    expect(e.units[0]!.rows.map((r) => r.metric)).toEqual([
      "Omset",
      "Volume",
      "Gain/Loss",
      "NPSO (G)",
      "NPSO (D)",
    ]);
  });
  it("label jendela eksplisit (MTD utk preset bulan)", () => {
    const e = buildBoardEval(evalInput());
    expect(e.labels.mom).toContain("MTD");
    expect(e.labels.yoy).toContain("2025");
  });
  it("provisional menular ke sel G/L terdampak", () => {
    const gl = glWindows();
    gl.range = new Map([[1, glWindow(1, PERIOD.range, -11.2, true)]]);
    gl.ytdCur = new Map([[1, glWindow(1, PERIOD.ytd.cur, -13.2, true)]]);
    const e = buildBoardEval(evalInput({ gl }));
    expect(e.cards.gl.mom.provisional).toBe(true);
    expect(e.cards.gl.ytdProvisional).toBe(true);
  });
});

describe("buildBoardCore — G/L completeness and source quality", () => {
  const glCard = (m: ReturnType<typeof buildBoardCore>) => m.kpi.find((k) => k.key === "gl")!;

  function expectIncomplete(input: BoardCoreInput, unit = IB) {
    const m = buildBoardCore({ ...input, mode: "banding" });
    const card = glCard(m);
    expect(card.value).toBe("—");
    expect(card.sub).toBe("G/L belum lengkap"); // never leak a partial liter subtotal
    expect(card.subTone).toBe("warning");
    expect(card.provisional).toBe(true);
    const perUnit = card.perUnit!.find((u) => u.name === unit.name)!;
    expect(perUnit.value).toBe("—");
    expect(perUnit.sub).toBe("G/L belum lengkap");
    const rank = m.ranking.find((r) => r.code === unit.code)!;
    expect(rank.gl).toBe("—");
    expect(rank.glAbnormal).toBe(false);
    expect(rank.glProvisional).toBe(true);
    expect(rank.notes).toContainEqual({ tone: "warning", text: "G/L belum lengkap" });
    expect(rank.notes.some((n) => n.tone === "success")).toBe(false);
    expect(m.verdict.chips).toContainEqual({ tone: "warning", text: `${unit.name}: G/L belum lengkap` });
    return m;
  }

  it("hides the group ratio when an entire sales unit has no G/L, while retaining a complete unit", () => {
    const glRange = new Map(GL_RANGE);
    glRange.delete(BK.unit_id);
    const m = expectIncomplete(coreInput({ glRange }), BK);
    expect(glCard(m).perUnit!.find((u) => u.name === IB.name)!.value).toBe("−1,00%");
    expect(m.ranking.find((r) => r.code === IB.code)!.gl).toBe("−1,00%");
  });

  it("requires every sales day, not just one valid G/L day in the month", () => {
    expectIncomplete(coreInput({
      dailySales: [...SALES, s(1, "2026-07-12", "PERTALITE", 400, 4_000_000)],
    }));
  });

  it("requires every product on an otherwise covered sales day", () => {
    const glRange = new Map(GL_RANGE);
    glRange.set(1, [glRow(-11.2)]); // Pertalite covered; Pertamax missing on the same date
    expectIncomplete(coreInput({ glRange }));
  });

  it.each([
    { name: "null G/L", patch: { gl: null } },
    { name: "excluded tank with a partial numeric G/L", patch: { excluded_tanks: 1 } },
  ])("does not publish partial totals for $name", ({ patch }) => {
    const glRange = new Map(GL_RANGE);
    glRange.set(1, GL_RANGE.get(1)!.map((r, i) => i === 1 ? { ...r, ...patch } : r));
    expectIncomplete(coreInput({ glRange }));
  });

  it("accepts a measured zero closing balance without inventing loss or incompleteness", () => {
    const glRange = new Map([[1, glWindow(1, PERIOD.range, 0).map((r) => ({
      ...r, fisik: 0, fisik_prev: 1000, pen_do: 0, sales_gross: 1000,
    }))]]);
    const m = buildBoardCore(coreInput({ units: [IB], glRange }));
    expect(glCard(m).value).toBe("0%");
    expect(glCard(m).sub).toBe("0 L");
    expect(glCard(m).provisional).toBe(false);
    expect(glCard(m).subTone).toBe("success");
    expect(m.verdict.chips.some((c) => /G\/L|stok fisik/.test(c.text))).toBe(false);
  });

  it("withholds a suspicious source zero from totals and percentages, with explicit quality warnings", () => {
    const glRange = new Map([[1, glWindow(1, PERIOD.range, -5000).map((r, i) => i === 0 ? {
      ...r, fisik: 0, fisik_prev: 6000, pen_do: 0, sales_gross: 1000,
    } : r)]]);
    const m = buildBoardCore(coreInput({ units: [IB], mode: "banding", glRange }));
    expect(glCard(m).value).toBe("—");
    expect(glCard(m).sub).toBe("data sumber perlu verifikasi"); // no artefact liters
    expect(glCard(m).subTone).toBe("warning");
    expect(glCard(m).provisional).toBe(true);
    expect(glCard(m).perUnit![0]).toMatchObject({ value: "—", sub: "data sumber perlu verifikasi" });
    expect(m.verdict.chips).toContainEqual({ tone: "warning", text: "Imam Bonjol: data sumber perlu verifikasi" });
    expect(m.verdict.chips.some((c) => c.tone === "danger")).toBe(false);
    expect(m.ranking[0]).toMatchObject({ gl: "—", glAbnormal: false, glProvisional: true, glStatus: "PERLU PERIKSA" });
    expect(m.ranking[0]!.notes).toContainEqual({ tone: "warning", text: "data sumber perlu verifikasi" });
  });

  it.each(["penutup_nol", "jangkar_nol"] as const)(
    "SQL artefact verdict %s gates its unit and the group, not an unaffected unit", (reason) => {
      const glRange = new Map(GL_RANGE);
      glRange.set(1, GL_RANGE.get(1)!.map((r, i) => i === 0 ? { ...r, gl: null, gl_suspect: reason, provisional: true } : r));
      const m = buildBoardCore(coreInput({ mode: "banding", glRange }));
      expect(glCard(m)).toMatchObject({ value: "—", sub: "data sumber perlu verifikasi", provisional: true });
      expect(glCard(m).perUnit!.find((u) => u.name === IB.name)).toMatchObject({ value: "—", sub: "data sumber perlu verifikasi" });
      // Bakau has its own complete (provisional) window: still numeric.
      expect(glCard(m).perUnit!.find((u) => u.name === BK.name)!.value).toBe("+0,25%");
      expect(m.ranking.find((r) => r.code === IB.code)).toMatchObject({ gl: "—", glStatus: "PERLU PERIKSA" });
      expect(m.ranking.find((r) => r.code === BK.code)!.gl).toBe("+0,25%");
    });

  it.each([
    ["invalid movement", { movement_invalid: true }],
    ["non-finite G/L", { gl: Number.NaN }],
  ] as const)("a structural %s row gates its unit and the group as incomplete, not as an artefact", (_name, over) => {
    const glRange = new Map(GL_RANGE);
    glRange.set(1, GL_RANGE.get(1)!.map((r, i) => i === 0 ? { ...r, ...over } : r));
    const m = buildBoardCore(coreInput({ mode: "banding", glRange }));
    expect(glCard(m)).toMatchObject({ value: "—", sub: "G/L belum lengkap", provisional: true });
    expect(glCard(m).perUnit!.find((u) => u.name === IB.name)).toMatchObject({ value: "—", sub: "G/L belum lengkap" });
    expect(glCard(m).perUnit!.find((u) => u.name === BK.name)!.value).toBe("+0,25%");
    expect(m.ranking.find((r) => r.code === IB.code)).toMatchObject({ gl: "—", glStatus: "TIDAK LENGKAP" });
  });

  it("a zero-stock row with an explicit null SQL verdict is not withheld (heuristic did not fire)", () => {
    const glRange = new Map([[1, glWindow(1, PERIOD.range, -11.2).map((r) => ({
      ...r, fisik: 0, fisik_prev: 6000, pen_do: 0, sales_gross: 1000, gl_suspect: null,
    }))]]);
    const m = buildBoardCore(coreInput({ units: [IB], glRange }));
    expect(glCard(m).value).toBe("−1,00%");
    expect(glCard(m).provisional).toBe(false);
  });

  it("does not demand G/L for a dormant product on an observed day, but does for a nonzero adjustment", () => {
    const zero = s(1, TODAY, "NEW-PRODUCT", 0, 0);
    const m = buildBoardCore(coreInput({ dailySales: [...SALES, zero] }));
    expect(glCard(m).value).toBe("−0,67%");
    expectIncomplete(coreInput({ dailySales: [...SALES, { ...zero, vol: -1, omzet: -10_000 }] }));
  });

  it("ignores out-of-scope and out-of-window G/L rows, including their warnings", () => {
    const glRange = new Map(GL_RANGE);
    glRange.set(1, [...GL_RANGE.get(1)!, { ...glRow(null, true), d: "2026-06-30" }]);
    glRange.set(2, [{ ...glRow(null, true), d: "2026-07-16" }]);
    const m = buildBoardCore(coreInput({ units: [IB], glRange }));
    expect(glCard(m).value).toBe("−1,00%");
    expect(glCard(m).provisional).toBe(false);
  });

  it("keeps a complete provisional numeric result visibly provisional even below the loss threshold", () => {
    const m = buildBoardCore(coreInput({ units: [BK] }));
    expect(glCard(m).value).toBe("+0,25%");
    expect(glCard(m).sub).toContain("sementara");
    expect(m.verdict.chips.some((c) => c.text.includes("G/L Bakau") && c.tone === "warning")).toBe(true);
    expect(m.ranking[0]!.notes.some((n) => n.text.includes("G/L sementara"))).toBe(true);
  });
});

describe("buildBoardEval — G/L completeness across every window", () => {
  it.each(["range", "momPrev", "yoyPrev", "ytdCur", "ytdPrev"] as const)(
    "gates affected current/comparison/YTD cells when %s lacks a sales product/day",
    (window) => {
      const gl = glWindows();
      gl[window] = new Map([[1, gl[window].get(1)!.slice(1)]]);
      const e = buildBoardEval(evalInput({ gl }));
      const unit = e.units[0]!.rows.find((r) => r.metric === "Gain/Loss")!;
      const affected: ("mom" | "yoy" | "ytdDelta")[] = window === "range" ? ["mom", "yoy"]
        : window === "momPrev" ? ["mom"] : window === "yoyPrev" ? ["yoy"] : ["ytdDelta"];
      for (const key of affected) {
        expect(e.cards.gl[key].text).toBe("—");
        expect(e.cards.gl[key].note).toContain("G/L belum lengkap");
        expect(e.cards.gl[key].provisional).toBe(true);
        expect(unit[key]).toEqual(e.cards.gl[key]);
      }
      if (window === "range") {
        expect(unit.cur).toBe("—");
        expect(unit.curProvisional).toBe(true);
      }
      if (window === "ytdCur") {
        expect(e.cards.gl.ytdValue).toBe("—");
        expect(e.cards.gl.ytdProvisional).toBe(true);
        expect(unit.ytd).toBe("—");
      }
      if (window === "ytdPrev") {
        expect(e.cards.gl.ytdValue).toBe("−0,60%");
        expect(e.cards.gl.ytdProvisional).toBe(false);
      }
      expect(e.cards.omzet.mom.text).not.toBe("—"); // unrelated metrics remain usable
    },
  );

  it("rejects group comparisons when one sales unit is entirely absent from the G/L map", () => {
    const gl = glWindows();
    gl.momPrev = new Map([[1, gl.momPrev.get(1)!]]);
    const e = buildBoardEval(evalInput({ units: [IB, BK], gl }));
    expect(e.cards.gl.mom.text).toBe("—");
    expect(e.cards.gl.mom.note).toBe("G/L belum lengkap");
    const ib = e.units.find((u) => u.code === IB.code)!.rows.find((r) => r.metric === "Gain/Loss")!;
    const bk = e.units.find((u) => u.code === BK.code)!.rows.find((r) => r.metric === "Gain/Loss")!;
    expect(ib.mom.text).toBe("−0,50 pt");
    expect(bk.mom.text).toBe("—");
  });

  it.each([
    { name: "null row", patch: { gl: null } },
    { name: "excluded tank", patch: { excluded_tanks: 1 } },
  ])("treats $name in a previous window as incomplete despite other valid rows", ({ patch }) => {
    const gl = glWindows();
    gl.momPrev = new Map([[1, gl.momPrev.get(1)!.map((r, i) => i === 1 ? { ...r, ...patch } : r)]]);
    const e = buildBoardEval(evalInput({ gl }));
    expect(e.cards.gl.mom.text).toBe("—");
    expect(e.cards.gl.mom.note).toBe("G/L belum lengkap");
  });

  it.each(["momPrev", "yoyPrev", "ytdPrev"] as const)(
    "preserves numeric comparisons and provisional warnings originating only in %s",
    (window) => {
      const gl = glWindows();
      gl[window] = new Map([[1, gl[window].get(1)!.map((r) => ({ ...r, provisional: true }))]]);
      const e = buildBoardEval(evalInput({ gl }));
      const key = window === "momPrev" ? "mom" : window === "yoyPrev" ? "yoy" : "ytdDelta";
      expect(e.cards.gl[key].text).not.toBe("—");
      expect(e.cards.gl[key].provisional).toBe(true);
      const unit = e.units[0]!.rows.find((r) => r.metric === "Gain/Loss")!;
      expect(unit[key].provisional).toBe(true);
      expect(unit.curProvisional).toBe(false);
      expect(e.cards.gl.ytdProvisional).toBe(false);
    },
  );

  it.each(["range", "momPrev", "yoyPrev", "ytdCur", "ytdPrev"] as const)(
    "withholds suspicious-zero artefacts from %s comparisons with a source warning",
    (window) => {
      const gl = glWindows();
      gl[window] = new Map([[1, gl[window].get(1)!.map((r, i) => i === 0 ? {
        ...r, fisik: 0, fisik_prev: 6000, pen_do: 0, sales_gross: 1000,
      } : r)]]);
      const e = buildBoardEval(evalInput({ gl }));
      const unit = e.units[0]!.rows.find((r) => r.metric === "Gain/Loss")!;
      const affected: ("mom" | "yoy" | "ytdDelta")[] = window === "range" ? ["mom", "yoy"]
        : window === "momPrev" ? ["mom"] : window === "yoyPrev" ? ["yoy"] : ["ytdDelta"];
      for (const key of affected) {
        expect(e.cards.gl[key].text).toBe("—");
        expect(e.cards.gl[key].provisional).toBe(true);
        expect(e.cards.gl[key].note).toBe("data sumber perlu verifikasi");
        expect(unit[key]).toEqual(e.cards.gl[key]);
      }
      if (window === "range") {
        expect(unit.cur).toBe("—");
        expect(unit.curProvisional).toBe(true);
      }
      if (window === "ytdCur") {
        expect(e.cards.gl.ytdValue).toBe("—");
        expect(e.cards.gl.ytdProvisional).toBe(true);
      }
    },
  );
});


describe("board G/L freshness", () => {
  it("does not present a stale active unit's prior-day G/L as a complete current window", () => {
    const dailySales = SALES.map((r) => r.unit_id === 2 && r.d === TODAY ? { ...r, d: "2026-07-15" } : r);
    const glRange = new Map(GL_RANGE);
    glRange.set(2, GL_RANGE.get(2)!.map((r) => ({ ...r, d: "2026-07-15", provisional: false })));
    const m = buildBoardCore(coreInput({ dailySales, glRange, mode: "banding" }));
    const card = m.kpi.find((k) => k.key === "gl")!;
    expect(card.value).toBe("—");
    expect(card.sub).toBe("G/L belum lengkap");
    expect(card.perUnit!.find((u) => u.name === IB.name)!.value).toBe("−1,00%");
    expect(card.perUnit!.find((u) => u.name === BK.name)!.value).toBe("—");
    expect(m.ranking.find((u) => u.code === BK.code)!.glProvisional).toBe(true);
  });

  it("gates comparison periods with stale sales even if all known product/day keys match", () => {
    const dailySales = SALES.map((r) => r.unit_id === 1 && r.d === "2026-06-16" ? { ...r, d: "2026-06-15" } : r);
    const gl = glWindows();
    gl.momPrev = new Map([[1, gl.momPrev.get(1)!.map((r) => ({ ...r, d: "2026-06-15" }))]]);
    const e = buildBoardEval(evalInput({ dailySales, gl }));
    expect(e.cards.gl.mom.text).toBe("—");
    expect(e.cards.gl.mom.note).toBe("G/L belum lengkap");
    expect(e.units[0]!.rows.find((r) => r.metric === "Gain/Loss")!.cur).toBe("−1,00%");
  });

  it("does not mistake a unit with only future activity for a stale unit in a historical window", () => {
    const period = resolveBoardPeriod("custom", { from: "2025-07-01", to: "2025-07-16" }, NOW);
    const m = buildBoardCore(coreInput({ period, mode: "banding", glRange: glWindows().yoyPrev }));
    const card = m.kpi.find((k) => k.key === "gl")!;
    expect(card.value).toBe("−1,00%");
    expect(card.sub).toBe("−5 L");
    expect(card.provisional).toBe(false);
  });
});

describe("board G/L rejects absent product identities", () => {
  it.each([null, "", "   ", "\t\n"])("cannot verify zero from matching unidentified sales and stock (%j)", (ckdbbm) => {
    const dailySales = [{ ...s(1, TODAY, "UNKNOWN", 1000, 10_000_000), ckdbbm, nama: null }];
    const glRange = new Map([[1, [{ ...glRow(0), ckdbbm, nama: null }]]]);
    const m = buildBoardCore(coreInput({ units: [IB], dailySales, glRange, mode: "banding" }));
    const card = m.kpi.find((k) => k.key === "gl")!;
    expect(card.value).toBe("—");
    expect(card.sub).toBe("G/L belum lengkap");
    expect(card.subTone).toBe("warning");
    expect(card.provisional).toBe(true);
    expect(m.ranking[0]!.gl).toBe("—");
    expect(m.ranking[0]!.products[0]!.name).toBe("Produk tanpa kode");
    expect(m.verdict.headline).not.toBe("Grup sehat.");
  });

  it.each([null, "", "   "])("unidentified active sales with no stock invalidate dependent totals (%j)", (ckdbbm) => {
    const m = buildBoardCore(coreInput({
      units: [IB],
      dailySales: [...SALES, { ...s(1, TODAY, "UNKNOWN", 1000, 10_000_000), ckdbbm, nama: null }],
    }));
    expect(m.kpi.find((k) => k.key === "gl")!.value).toBe("—");
    expect(m.kpi.find((k) => k.key === "gl")!.subTone).toBe("warning");
  });

  it("does not count unidentified stock as coverage for a known sales product", () => {
    const glRange = new Map([[1, [glRow(0), { ...glRow(0), ckdbbm: null, nama: "PERTAMAX" }]]]);
    const m = buildBoardCore(coreInput({ units: [IB], glRange }));
    expect(m.kpi.find((k) => k.key === "gl")!.value).toBe("—");
  });

  it.each(["range", "momPrev", "yoyPrev", "ytdCur", "ytdPrev"] as const)(
    "rejects unknown product identities in %s evaluation source rows",
    (window) => {
      const gl = glWindows();
      gl[window] = new Map([[1, gl[window].get(1)!.map((r, i) => i === 0 ? { ...r, ckdbbm: null, gl: 0 } : r)]]);
      const e = buildBoardEval(evalInput({ gl }));
      const keys: ("mom" | "yoy" | "ytdDelta")[] = window === "range" ? ["mom", "yoy"]
        : window === "momPrev" ? ["mom"] : window === "yoyPrev" ? ["yoy"] : ["ytdDelta"];
      for (const key of keys) {
        expect(e.cards.gl[key].text).toBe("—");
        expect(e.cards.gl[key].note).toBe("G/L belum lengkap");
        expect(e.cards.gl[key].provisional).toBe(true);
      }
    },
  );

  it("keeps trimmed nonempty unmapped identities valid and distinct", () => {
    const dailySales = [s(1, TODAY, "UNMAPPED-A", 100, 1000), s(1, TODAY, "UNMAPPED-B", 200, 2000)];
    const glRange = new Map([[1, [
      { ...glRow(0), ckdbbm: " UNMAPPED-A ", nama: null },
      { ...glRow(0), ckdbbm: "UNMAPPED-B", nama: null },
    ]]]);
    const m = buildBoardCore(coreInput({ units: [IB], dailySales, glRange }));
    expect(m.kpi.find((k) => k.key === "gl")!.value).toBe("0%");
    expect(m.kpi.find((k) => k.key === "gl")!.subTone).toBe("success");
    expect(m.kpi.find((k) => k.key === "gl")!.provisional).toBe(false);
    glRange.set(1, glRange.get(1)!.slice(0, 1));
    expect(buildBoardCore(coreInput({ units: [IB], dailySales, glRange })).kpi.find((k) => k.key === "gl")!.value).toBe("—");
  });

  it("does not let out-of-scope or out-of-window unknown identities poison valid totals", () => {
    const m = buildBoardCore(coreInput({
      units: [IB],
      dailySales: [...SALES,
        { ...s(2, TODAY, "UNKNOWN", 1000, 1000), ckdbbm: null },
        { ...s(1, "2026-08-01", "UNKNOWN", 1000, 1000), ckdbbm: null }],
      glRange: new Map([[1, [...GL_RANGE.get(1)!, { ...glRow(0), ckdbbm: null, d: "2026-08-01" }]],
        [2, [{ ...glRow(0), ckdbbm: null }]]]),
    }));
    expect(m.kpi.find((k) => k.key === "gl")!.value).toBe("−1,00%");
    expect(m.kpi.find((k) => k.key === "gl")!.provisional).toBe(false);
  });
});

it("board does not label an unidentified zero-volume sales row as a verified G/L zero", () => {
  const m = buildBoardCore(coreInput({
    units: [IB], dailySales: [{ ...s(1, TODAY, "UNKNOWN", 0, 0), ckdbbm: null, nama: null }],
    glRange: new Map([[1, [{ ...glRow(0), ckdbbm: null, nama: null }]]]),
  }));
  const card = m.kpi.find((k) => k.key === "gl")!;
  expect(card.value).toBe("—");
  expect(card.sub).toBe("G/L belum lengkap");
  expect(card.subTone).toBe("warning");
});


describe("board exact sales-date G/L coverage", () => {
  it("does not let G/L on dates 1 and 2 mask missing zero-sales date 3", () => {
    const dailySales = [s(1, "2026-07-14", "PERTALITE", 1000, 10_000_000), s(1, TODAY, "PERTALITE", 0, 0)];
    const glRange = new Map([[1, [{ ...glRow(0), d: "2026-07-14" }, { ...glRow(0), d: "2026-07-15" }]]]);
    const m = buildBoardCore(coreInput({ units: [IB], dailySales, glRange }));
    const card = m.kpi.find((k) => k.key === "gl")!;
    expect(card.value).toBe("—");
    expect(card.sub).toBe("G/L belum lengkap");
    expect(card.provisional).toBe(true);
  });

  it.each([
    ["range", "2026-07-14", "mom"], ["momPrev", "2026-06-14", "mom"],
    ["yoyPrev", "2025-07-14", "yoy"], ["ytdCur", "2026-05-14", "ytdDelta"],
    ["ytdPrev", "2025-05-14", "ytdDelta"],
  ] as const)("requires exact known zero-sales dates in %s", (window, missingDate, cell) => {
    const dailySales = [...SALES, s(1, missingDate, "PERTALITE", 0, 0)];
    const gl = glWindows();
    gl[window] = new Map([[1, [...gl[window].get(1)!, { ...glRow(0), d: missingDate.slice(0, 8) + "15" }]]]);
    const e = buildBoardEval(evalInput({ dailySales, gl }));
    expect(e.cards.gl[cell].text).toBe("—");
    expect(e.cards.gl[cell].note).toBe("G/L belum lengkap");
    expect(e.cards.gl[cell].provisional).toBe(true);
  });
});
