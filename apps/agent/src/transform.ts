/**
 * Konversi waktu EasyMax → UTC ISO. Temuan terkunci: server menyimpan datetime
 * sebagai waktu lokal WIB (UTC+7) TANPA offset; driver dikonfigurasi `dateStrings`
 * sehingga kita terima string mentah "YYYY-MM-DD HH:MM:SS" dan mengonversi sendiri.
 * Indonesia tak ber-DST → offset tetap, aman dipetakan dari nama zona.
 */
const ZONE_OFFSET_MIN: Record<string, number> = {
  "Asia/Jakarta": 420, // WIB  UTC+7
  "Asia/Pontianak": 420, // WIB  UTC+7
  "Asia/Makassar": 480, // WITA UTC+8
  "Asia/Jayapura": 540, // WIT  UTC+9
};

export function tzOffsetMinutes(timezone: string): number {
  const off = ZONE_OFFSET_MIN[timezone];
  if (off === undefined) {
    throw new Error(
      `Zona waktu '${timezone}' tak dikenal. Tambahkan ke ZONE_OFFSET_MIN (offset tetap, Indonesia tanpa DST).`,
    );
  }
  return off;
}

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * "2026-06-11 14:30:00" (WIB) → "2026-06-11T07:30:00.000Z" (UTC).
 * Mengembalikan null bila input null/kosong (baris legacy DTGLJAM NULL difilter
 * di SQL, ini hanya jaga-jaga). Melempar bila format tak dikenal.
 */
export function wibDateTimeToUtcIso(
  value: string | null | undefined,
  offsetMin: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const m = DT_RE.exec(value.trim());
  if (!m) throw new Error(`format datetime tak dikenal: '${value}'`);
  const [, y, mo, d, h, mi, s] = m;
  const localEpoch = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
  return new Date(localEpoch - offsetMin * 60_000).toISOString();
}

/** UTC ISO → string WIB "YYYY-MM-DD HH:MM:SS" untuk di-bind ke query MySQL. */
export function utcIsoToWibString(iso: string, offsetMin: number): string {
  const local = new Date(new Date(iso).getTime() + offsetMin * 60_000);
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ` +
    `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}`
  );
}

/** Kurangi `min` menit dari UTC ISO (untuk safety re-scan window). */
export function subtractMinutesIso(iso: string, min: number): string {
  return new Date(new Date(iso).getTime() - min * 60_000).toISOString();
}

/** Kurangi `days` hari dari tanggal "YYYY-MM-DD" → "YYYY-MM-DD". */
export function subtractDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Tanggal bisnis "YYYY-MM-DD" → tetap apa adanya (tanpa konversi tz). */
export function businessDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!m) throw new Error(`format tanggal tak dikenal: '${value}'`);
  return m[1]!;
}

/** `ctgl` EasyMax "YYYYMMDD" → tanggal bisnis "YYYY-MM-DD" (null bila tak valid). */
export function ctglToBusinessDate(ctgl: string | null | undefined): string | null {
  if (ctgl === null || ctgl === undefined) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(ctgl).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * `JrnKey` EasyMax → tanggal bisnis. Bentuknya `YYYYMMDD` + satu digit SHIFT,
 * mis. `202608311` = 31 Agustus 2026 shift 1, `202608312` = shift 2.
 *
 * Dipakai untuk **baris detail yatim** (`tr_djualplg.CKDJUALPLG IS NULL`), yang
 * tak punya header sehingga tak punya `DTGL`. `JrnKey` lebih benar daripada
 * `DATE(TanggalJam)` karena ia membawa tanggal BISNIS — shift yang melewati
 * tengah malam tetap jatuh pada harinya sendiri.
 *
 * Null bila bentuknya tak dikenal; pemanggil wajib menyediakan cadangan.
 */
export function jrnKeyToBusinessDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d)$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, da] = m;
  const yy = Number(y);
  const mm = Number(mo);
  const dd = Number(da);
  if (yy < 2000 || yy > 2099 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${mo}-${da}`;
}

/** Nomor shift dari `JrnKey` (digit terakhir). Null bila bentuknya tak dikenal. */
export function jrnKeyToShift(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const m = /^\d{8}(\d)$/.exec(String(value).trim());
  return m ? Number(m[1]) : null;
}

/** Tanggal bisnis "YYYY-MM-DD" → `ctgl` "YYYYMMDD" (untuk bind ke vw_edc3.ctgl). */
export function businessDateToCtgl(date: string): string {
  return date.replace(/-/g, "");
}

/** Konversi numeric MySQL (string/number/null) → number|null. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Integer atau null. */
export function int(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.trunc(n);
}

/** String trim atau null. */
export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}
