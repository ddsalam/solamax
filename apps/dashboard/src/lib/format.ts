/** Format angka id-ID sesuai spec: Rp pemisah titik, volume L/KL, persen koma. */

export const idn = (n: number, d = 0): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Rupiah. Nilai negatif (mis. Summary H = E+F−G yang sah negatif) ditampilkan
 *  dgn tanda minus "−Rp …" — JANGAN jatuhkan tanda (positif menyesatkan). */
export const rp = (n: number): string => {
  const v = Math.round(n) || 0; // `|| 0` menormalkan -0 → 0 (toLocaleString(-0) = "-0")
  return v < 0 ? `−Rp ${idn(Math.abs(v))}` : `Rp ${idn(v)}`;
};

/** Omzet ringkas ala spec: ≥1 M → "Rp 1,61 M", else "Rp 312,4 jt". */
export function rpShort(n: number): string {
  const jt = n / 1_000_000;
  return jt >= 1000 ? `Rp ${idn(jt / 1000, 2)} M` : `Rp ${idn(jt, 1)} jt`;
}

export const fmtL = (n: number, d = 0): string => `${idn(n, d)} L`;
export const fmtKL = (n: number, d = 1): string => `${idn(n / 1000, d)} KL`;

/** Tinggi cairan: sumber EasyMax dalam mm → tampil cm. */
export const fmtCm = (mm: number, d = 1): string => `${idn(mm / 10, d)} cm`;

/** Suhu °C. */
export const fmtTemp = (c: number, d = 1): string => `${idn(c, d)} °C`;

/** Persen dari rasio 0–1: 0.1217 → "12,2%". */
export const pct = (ratio: number, d = 1): string => `${idn(ratio * 100, d)}%`;

/** Selisih bertanda gaya spec: −412 / +14 / 0. */
export function signed(n: number, d = 0): string {
  if (n === 0) return "0";
  return (n > 0 ? "+" : "−") + idn(Math.abs(n), d);
}

/** "(6.989 L)" utk kekurangan, "+1.650 L" utk kelebihan. */
export function parenNeg(n: number, suffix = " L"): string {
  return n < 0 ? `(${idn(Math.abs(n))}${suffix})` : `+${idn(n)}${suffix}`;
}

const WIB = "Asia/Pontianak";

/** "Kamis, 11 Juni 2026" dari "YYYY-MM-DD". */
export function dateLong(iso: string): string {
  return new Date(`${iso}T12:00:00+07:00`).toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: WIB,
  });
}

/** "11 Jun 2026". */
export function dateShort(iso: string): string {
  return new Date(`${iso}T12:00:00+07:00`).toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: WIB,
  });
}

/** Jam WIB "06.10" dari timestamptz ISO. */
export function timeWib(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: WIB })
    .replace(/:/g, ".");
}

/** "x mnt lalu" / "x jam lalu" / "x hari lalu" / "x,x TAHUN lalu". */
export function ago(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso.length === 10 ? `${iso}T23:59:59+07:00` : iso).getTime();
  const min = ms / 60000;
  if (min < 1) return "baru saja";
  if (min < 90) return `${Math.round(min)} mnt lalu`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h)} jam lalu`;
  const d = h / 24;
  if (d < 365) return `${Math.round(d)} hari lalu`;
  return `${idn(d / 365, 1)} TAHUN lalu`;
}
