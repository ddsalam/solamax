import { cookies } from "next/headers";
import { todayWib } from "./periods";
import type { ScopedUnit } from "./scope";
import { DATE_COOKIE, UNIT_COOKIE } from "./selection-keys";

/**
 * Pilihan unit + tanggal bisnis yang TERBAWA antar layar, dibaca dari cookie
 * dan DIVALIDASI terhadap scope caller.
 *
 * Cookie hanya SEED default — bukan otoritas. Unit dihormati HANYA bila sudah
 * ada dalam `units` (hasil getDataScope → unitVisible); cookie palsu yang
 * menunjuk unit di luar scope MUSTAHIL melebarkan akses (jatuh ke unit pertama
 * scope), dan tiap halaman per-unit tetap melewati requireUnit/ScopedUnitId →
 * notFound. Tanggal divalidasi format; selain itu → hari ini (WIB).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getSelection(units: ScopedUnit[]): { unitCode: string | undefined; date: string } {
  const jar = cookies();
  const rawUnit = jar.get(UNIT_COOKIE)?.value;
  const rawDate = jar.get(DATE_COOKIE)?.value;
  const unitCode = units.some((u) => u.code === rawUnit) ? rawUnit : units[0]?.code;
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : todayWib();
  return { unitCode, date };
}
