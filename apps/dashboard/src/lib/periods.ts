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
