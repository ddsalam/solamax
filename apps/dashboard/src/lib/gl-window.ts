/**
 * G/L per jendela dengan CACHE SERVER untuk jendela HISTORIS (keputusan owner
 * FASE 0 №2): unstable_cache Next.js, revalidate 24 jam (selaras cadence
 * deep-rescan), key = (unit_id, from, to). Cache per UNIT — BUKAN per user —
 * dan HANYA dibaca setelah intersect RBAC menentukan unit yang boleh dirender
 * (parseBoardParams ∩ getDataScope) → tidak ada jalur bocor. Mekanisme bawaan
 * Next — TANPA tabel cache di DB (read-only penuh).
 *
 * Batas "historis": `to ≤ hari-ini − 2` (SEDIKIT lebih ketat dari "to < hari
 * ini" di spec — pengetatan yang diungkap & disetujui arahnya oleh invarian
 * owner sendiri): baris D masih PROVISIONAL selama opname penutup D+1 belum
 * terekam, dan penutup untuk D=kemarin baru masuk PAGI INI — meng-cache jendela
 * berujung kemarin bisa mengawetkan baris provisional 24 jam (dilarang spec:
 * "baris provisional tidak boleh awet di cache"). D = hari-ini−2 penutupnya
 * kemarin pagi (data: 0 hari opname bolong dari 400 hari, kedua unit) → final.
 *
 * Jendela yang menyentuh hari berjalan dipecah: prefix historis (cache) +
 * suffix segar. EKSAK karena tiap baris harian getDailyGlByProduct dihitung
 * mandiri dari data ≤ D (lookback 365 hari di dalam query menyediakan anchor
 * Fisik(D−1) & jendela celah lintas batas pecahan) — tidak ada state antar
 * baris output. Baris provisional dengan demikian HANYA pernah lewat jalur segar.
 */
import { unstable_cache } from "next/cache";
import * as React from "react";
import { addDays, todayWib } from "./periods";
import { getDailyGlByProduct, type DailyGlRow } from "./queries";
import type { ScopedUnitId } from "./scope-rule";

export interface GlWindowSplit {
  /** Bagian sepenuhnya historis (boleh cache 24 jam); null bila tak ada. */
  cached: { from: string; to: string } | null;
  /** Bagian menyentuh hari berjalan (selalu query segar); null bila tak ada. */
  fresh: { from: string; to: string } | null;
}

/** Aturan pecah jendela — MURNI agar teruji unit (batas historis = today−2). */
export function splitGlWindow(from: string, to: string, today: string): GlWindowSplit {
  if (from > to) return { cached: null, fresh: null };
  const histTo = addDays(today, -2);
  if (to <= histTo) return { cached: { from, to }, fresh: null };
  if (from > histTo) return { cached: null, fresh: { from, to } };
  return { cached: { from, to: histTo }, fresh: { from: addDays(histTo, 1), to } };
}

/** Revalidate 24 jam — selaras cadence deep-rescan agent (koreksi back-dated). */
const GL_CACHE_REVALIDATE_S = 86_400;

function cachedGl(unit: ScopedUnitId, from: string, to: string): Promise<DailyGlRow[]> {
  return unstable_cache(
    () => getDailyGlByProduct(unit, from, to),
    ["gl-window", String(unit), from, to],
    { revalidate: GL_CACHE_REVALIDATE_S },
  )();
}

// React.cache hanya ada di build server (RSC); fallback identity utk vitest.
const reactCache: <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A) => R =
  (React as unknown as { cache?: typeof reactCache }).cache ?? ((fn) => fn);

/**
 * Baris G/L harian per produk utk jendela [from..to] — historis dari cache,
 * hari berjalan segar. React cache() = memo per-request: jendela identik yang
 * diminta beberapa seksi (KPI + tabel evaluasi) hanya di-query sekali.
 */
export const getDailyGlWindow = reactCache(
  async (unit: ScopedUnitId, from: string, to: string): Promise<DailyGlRow[]> => {
    const split = splitGlWindow(from, to, todayWib());
    const [hist, fresh] = await Promise.all([
      split.cached ? cachedGl(unit, split.cached.from, split.cached.to) : Promise.resolve([]),
      split.fresh
        ? getDailyGlByProduct(unit, split.fresh.from, split.fresh.to)
        : Promise.resolve([]),
    ]);
    return [...hist, ...fresh];
  },
);
