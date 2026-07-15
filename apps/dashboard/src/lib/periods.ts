/** Tanggal bisnis & periode (WIB). "Hari ini" = tanggal bisnis berjalan. */

const WIB = "Asia/Pontianak";

/** "YYYY-MM-DD" hari ini dalam WIB. */
export function todayWib(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: WIB });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PeriodKey = "today" | "week" | "month";

export interface Period {
  key: PeriodKey;
  label: string;
  /** inklusif */
  from: string;
  to: string;
  /** periode pembanding (panjang sama, tepat sebelumnya) */
  prevFrom: string;
  prevTo: string;
  deltaVs: string;
}

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): Period {
  const to = todayWib(now);
  const len = key === "today" ? 1 : key === "week" ? 7 : 30;
  const from = addDays(to, -(len - 1));
  return {
    key,
    label: key === "today" ? "Hari ini" : key === "week" ? "7 hari" : "30 hari",
    from,
    to,
    prevFrom: addDays(from, -len),
    prevTo: addDays(to, -len),
    deltaVs:
      key === "today" ? "vs kemarin" : key === "week" ? "vs 7 hari sebelumnya" : "vs 30 hari sebelumnya",
  };
}

// ---------------------------------------------------------------------------
// Periode board direksi — custom range + jendela pembanding MoM/YoY/YTD.
// Metodologi TERKUNCI (keputusan owner, FASE 0 redesign board):
//   MoM = bulan kalender, MTD-vs-MTD (rentang digeser -1 bulan, day-clamp).
//   YoY = rentang kalender sama tahun sebelumnya (29 Feb → clamp 28 Feb).
//   YTD = 1 Jan s/d tanggal akhir filter, vs YTD tahun lalu rentang sama.
// ---------------------------------------------------------------------------

/** Rentang tanggal bisnis inklusif [from..to], ISO "YYYY-MM-DD". */
export interface DateRange {
  from: string;
  to: string;
}

export function rangeDays(r: DateRange): number {
  const a = new Date(`${r.from}T00:00:00Z`).getTime();
  const b = new Date(`${r.to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** true bila string tanggal ISO valid DAN nyata (2026-02-30 → false). */
export function isValidIsoDate(iso: string | undefined): iso is string {
  if (!iso || !ISO_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function clampedDate(y: number, m: number, d: number): string {
  // m 1–12; day di-clamp ke jumlah hari bulan tsb (31 Jan −1 bln → 28/29 Feb).
  const maxD = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = Math.min(d, maxD);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Geser bulan kalender dengan day-clamp (2026-03-31 −1 → 2026-02-28). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y! * 12 + (m! - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return clampedDate(ny, nm, d!);
}

/** Geser tahun dengan day-clamp (2024-02-29 −1 → 2023-02-28). */
export function addYearsClamped(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return clampedDate(y! + years, m!, d!);
}

export type BoardPeriodKey = "today" | "7d" | "30d" | "bulan" | "custom";

export interface BoardPeriod {
  key: BoardPeriodKey;
  /** Rentang aktif filter (jendela "cur" untuk semua pembanding). */
  range: DateRange;
  /** MoM: rentang digeser −1 bulan kalender (MTD-vs-MTD saat range = bulan berjalan). */
  mom: { prev: DateRange };
  /** YoY: rentang sama tahun lalu. */
  yoy: { prev: DateRange };
  /** YTD: 1 Jan(tahun range.to)..range.to vs tahun lalu rentang sama. */
  ytd: { cur: DateRange; prev: DateRange };
}

function boardWindows(key: BoardPeriodKey, range: DateRange): BoardPeriod {
  const yTo = Number(range.to.slice(0, 4));
  return {
    key,
    range,
    mom: { prev: { from: addMonthsClamped(range.from, -1), to: addMonthsClamped(range.to, -1) } },
    yoy: { prev: { from: addYearsClamped(range.from, -1), to: addYearsClamped(range.to, -1) } },
    ytd: {
      cur: { from: `${yTo}-01-01`, to: range.to },
      prev: { from: `${yTo - 1}-01-01`, to: addYearsClamped(range.to, -1) },
    },
  };
}

/**
 * Resolusi periode board dari URL. `custom` butuh from+to valid; input invalid
 * (format salah, tanggal tak nyata, from>to, rentang seluruhnya di masa depan)
 * → fallback preset 30 hari (key ikut "30d" agar UI mencerminkan kenyataan).
 * `to` di masa depan di-clamp ke hari ini (tanggal bisnis WIB).
 */
export function resolveBoardPeriod(
  key: string | undefined,
  opts: { from?: string; to?: string } = {},
  now: Date = new Date(),
): BoardPeriod {
  const today = todayWib(now);
  switch (key) {
    case "today":
      return boardWindows("today", { from: today, to: today });
    case "7d":
      return boardWindows("7d", { from: addDays(today, -6), to: today });
    case "bulan":
      return boardWindows("bulan", { from: monthStart(today), to: today });
    case "custom": {
      if (!isValidIsoDate(opts.from) || !isValidIsoDate(opts.to)) break;
      const to = opts.to > today ? today : opts.to;
      const from = opts.from;
      if (from > to) break;
      return boardWindows("custom", { from, to });
    }
    default:
      break;
  }
  // fallback & preset default: 30 hari rolling.
  return boardWindows("30d", { from: addDays(today, -29), to: today });
}

/** Bulan (1–12) & jumlah hari berjalan dari tanggal bisnis, utk target/prorata. */
export function monthInfo(iso: string): { month: number; year: number; dayOfMonth: number; daysInMonth: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return {
    month: m!,
    year: y!,
    dayOfMonth: d!,
    daysInMonth: new Date(Date.UTC(y!, m!, 0)).getUTCDate(),
  };
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
