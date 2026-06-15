/**
 * Logika kepatuhan input — murni & teruji. Inti alat pengawasan:
 * MENYOROT YANG KOSONG, bukan sekadar menampilkan yang ada.
 */

export type Status = "green" | "yellow" | "red";

export const STATUS_ICON: Record<Status, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

/** Penjualan: target 3 shift/hari. 3+ 🟢, 1–2 🟡, 0 🔴. */
export function salesStatus(shifts: number): Status {
  if (shifts >= 3) return "green";
  if (shifts >= 1) return "yellow";
  return "red";
}

/** Opname: target semua tangki. Semua 🟢, sebagian 🟡, nol 🔴. */
export function opnameStatus(tanks: number, totalTanks: number): Status {
  if (tanks <= 0) return "red";
  if (totalTanks > 0 && tanks < totalTanks) return "yellow";
  return "green";
}

/** Kas: minimal ada 1 nota hari itu. (Biner — tak ada "sebagian".) */
export function cashStatus(rows: number): Status {
  return rows > 0 ? "green" : "red";
}

/**
 * Ambang stale "last input" per modul (jam). Kas sengaja longgar (mingguan
 * masih wajar) — tapi dorman bertahun-tahun akan menyala MERAH menonjol.
 */
export const STALE_HOURS = {
  sales: 26, // tiap shift; >1 hari = ada yang tak diinput
  opname: 26,
  cash: 7 * 24,
  delivery: 30 * 24, // info: kiriman tak tentu; merah hanya bila lama sekali
} as const;

export interface Staleness {
  stale: boolean;
  ageHours: number | null; // null = belum pernah input
  ageText: string;
}

export function staleness(
  lastIso: string | null,
  thresholdHours: number,
  now: Date = new Date(),
): Staleness {
  if (!lastIso) return { stale: true, ageHours: null, ageText: "belum pernah" };
  const last = new Date(lastIso.length === 10 ? `${lastIso}T23:59:59+07:00` : lastIso);
  const ageHours = (now.getTime() - last.getTime()) / 3_600_000;
  return { stale: ageHours > thresholdHours, ageHours, ageText: ageText(ageHours) };
}

export function ageText(hours: number): string {
  if (hours < 1) return "baru saja";
  if (hours < 48) return `${Math.floor(hours)} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} hari lalu`;
  const years = days / 365;
  if (years >= 1) return `${years.toFixed(1)} TAHUN lalu`;
  return `${Math.floor(days / 30)} bulan lalu`;
}

/**
 * Selisih abnormal (losses / kekurangan kiriman):
 * abnormal bila |selisih| > ABS_LIMIT liter, ATAU > PCT_LIMIT dari basis
 * (stok buku / volume DO) bila basis tersedia.
 */
export const SELISIH_ABS_LIMIT = 100; // liter
export const SELISIH_PCT_LIMIT = 0.005; // 0,5%

export function isSelisihAbnormal(
  selisih: number,
  basis: number | null,
): boolean {
  const abs = Math.abs(selisih);
  if (abs > SELISIH_ABS_LIMIT) return true;
  if (basis !== null && basis > 0 && abs / basis > SELISIH_PCT_LIMIT) return true;
  return false;
}

export const fmtL = (n: number): string =>
  `${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })} L`;

export const fmtRp = (n: number): string =>
  `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
