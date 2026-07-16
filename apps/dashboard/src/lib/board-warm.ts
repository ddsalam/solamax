/**
 * Pre-warm cache G/L board (keputusan owner 2026-07-16 №2) — bagian MURNI,
 * teruji unit. Route /api/warm-board memakai ini lalu memanggil
 * getDailyGlWindow() LANGSUNG (bukan fetch halaman /board yang terkunci OAuth)
 * → mengisi unstable_cache dengan KEY IDENTIK dengan yang diminta halaman.
 *
 * Cakupan: jendela SEMUA preset (today/7d/30d/bulan) × (range, MoM-prev,
 * YoY-prev, YTD-cur, YTD-prev), didedup. Key cache per (unit,from,to) →
 * otomatis melayani subset unit apa pun; rentang custom tak di-pre-warm
 * (by design). Jadwal: harian pagi WIB SETELAH jendela deep-rescan agent
 * (off-peak 02:00–05:00 WIB) → cache memuat angka pasca-koreksi.
 */
import { timingSafeEqual } from "node:crypto";
import { resolveBoardPeriod, type BoardPeriodKey, type DateRange } from "./periods";

const WARM_PRESETS: BoardPeriodKey[] = ["today", "7d", "30d", "bulan"];

/** Daftar jendela G/L unik yang di-warm untuk tanggal bisnis `today`. */
export function boardWarmPlan(today: string, now?: Date): DateRange[] {
  const seen = new Map<string, DateRange>();
  const at = now ?? new Date(`${today}T09:00:00+07:00`);
  for (const key of WARM_PRESETS) {
    const p = resolveBoardPeriod(key, {}, at);
    for (const w of [p.range, p.mom.prev, p.yoy.prev, p.ytd.cur, p.ytd.prev]) {
      seen.set(`${w.from}|${w.to}`, w);
    }
  }
  return [...seen.values()];
}

/**
 * Gerbang shared-secret route warm (header `x-warm-secret`, nilai dari Secret
 * Manager via env). FAIL-CLOSED: env absen/pendek/header absen → false — route
 * tanpa konfigurasi TIDAK PERNAH bisa dipicu (bukan vektor beban publik).
 * Perbandingan constant-time (timingSafeEqual).
 */
export function isWarmAuthorized(
  given: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
