import { describe, expect, it } from "vitest";
import {
  buildBoardCore,
  buildBoardEval,
  type BoardCoreInput,
  type BoardEvalInput,
  type BoardUnit,
  type SalesGrainRow,
} from "@/lib/board-model";
import type { DailyGlInput } from "@/lib/derive";
import { resolveBoardPeriod } from "@/lib/periods";

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

const glRow = (gl: number | null, provisional = false): DailyGlInput => ({
  ckdbbm: "PERT",
  nama: "PERTALITE",
  gl,
  tera: 0,
  excluded_tanks: 0,
  provisional,
});

/** Grain fixture: IB punya histori penuh; BK hanya 2026. */
const SALES: SalesGrainRow[] = [
  // IB — jendela aktif Jul 2026 (PSO + NPSO utk bauran)
  s(1, "2026-07-10", "PERTALITE", 1000, 10_000_000),
  s(1, "2026-07-10", "PERTAMAX", 120, 1_800_000),
  // IB — MoM prev (Jun 2026)
  s(1, "2026-06-10", "PERTALITE", 800, 8_000_000),
  s(1, "2026-06-10", "PERTAMAX", 80, 1_200_000),
  // IB — YoY prev (Jul 2025)
  s(1, "2025-07-10", "PERTALITE", 500, 5_000_000),
  // IB — sisa YTD cur & prev
  s(1, "2026-02-10", "PERTALITE", 200, 2_000_000),
  s(1, "2025-02-10", "PERTALITE", 100, 1_000_000),
  // BK — hanya 2026 (histori < 1 tahun)
  s(2, "2026-07-11", "PERTALITE", 400, 4_000_000),
  s(2, "2026-06-11", "PERTALITE", 300, 3_000_000),
];

const GL_RANGE = new Map<number, DailyGlInput[]>([
  [1, [glRow(-11.2)]], // vol IB cur = 1120 → glPct = −1% (abnormal)
  [2, [glRow(1, true)]], // BK provisional
]);

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
});

function evalInput(over: Partial<BoardEvalInput> = {}): BoardEvalInput {
  return {
    units: [IB],
    period: PERIOD,
    today: TODAY,
    dailySales: SALES,
    gl: {
      range: new Map([[1, [glRow(-11.2)]]]),
      momPrev: new Map([[1, [glRow(-4.4)]]]), // vol mom IB = 880 → −0,5%
      yoyPrev: new Map([[1, [glRow(-5)]]]), // vol yoy = 500 → −1%
      ytdCur: new Map([[1, [glRow(-13.2)]]]), // vol ytd = 1320 → −1%
      ytdPrev: new Map([[1, [glRow(-3)]]]), // vol 600 → −0,5%
    },
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
    const e = buildBoardEval(evalInput({ units: [IB, BK], gl: {
      range: GL_RANGE,
      momPrev: new Map([[1, [glRow(-4.4)]], [2, [glRow(0)]]]),
      yoyPrev: new Map([[1, [glRow(-5)]]]),
      ytdCur: new Map([[1, [glRow(-13.2)]], [2, [glRow(1)]]]),
      ytdPrev: new Map([[1, [glRow(-3)]]]),
    } }));
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
    const e = buildBoardEval(
      evalInput({ gl: {
        range: new Map([[1, [glRow(-11.2, true)]]]),
        momPrev: new Map([[1, [glRow(-4.4)]]]),
        yoyPrev: new Map([[1, [glRow(-5)]]]),
        ytdCur: new Map([[1, [glRow(-13.2, true)]]]),
        ytdPrev: new Map([[1, [glRow(-3)]]]),
      } }),
    );
    expect(e.cards.gl.mom.provisional).toBe(true);
    expect(e.cards.gl.ytdProvisional).toBe(true);
  });
});
