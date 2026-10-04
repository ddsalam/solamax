/**
 * G/L per jendela dengan CACHE SERVER untuk jendela HISTORIS (keputusan owner
 * FASE 0 №2): unstable_cache Next.js, revalidate 24 jam (selaras cadence
 * deep-rescan), key = (unit_id, from, to, committed source revision). Cache per UNIT — BUKAN per user —
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
 * kemarin pagi pada operasi normal. Umur tanggal BUKAN bukti kelengkapan:
 * sinkron terlambat/koreksi tetap membatalkan cache melalui revisi sumber.
 *
 * Jendela yang menyentuh hari berjalan dipecah: prefix historis (cache) +
 * suffix segar. EKSAK karena tiap baris harian getDailyGlByProduct dihitung
 * mandiri dari data ≤ D (lookback 365 hari di dalam query menyediakan anchor
 * Fisik(D−1) & jendela celah lintas batas pecahan) — tidak ada state antar
 * baris output. Hasil historis provisional/null juga selalu dibaca ulang.
 */
import { unstable_cache } from "next/cache";
import * as React from "react";
import { addDays, todayWib } from "./periods";
import { getDailyGlByProduct, getGlSourceRevision, type DailyGlRow } from "./queries";
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

/**
 * JANGAN SAJIKAN HASIL KOSONG DARI CACHE (keputusan owner D13, 2026-07-25).
 *
 * AKAR MASALAH — bukan hipotetis, ini menjatuhkan Gate 4: bila prefiks historis
 * pernah di-query saat datanya BELUM ada, `unstable_cache` menyimpan array
 * kosong dan menyajikannya **24 jam**. Akibatnya seluruh G/L tampil 0, dan 0
 * tak bisa dibedakan dari "tidak ada selisih". Terbukti di `-rlsstg`: render
 * pertama 15:20:13 UTC (`rows_sales: 5`, sebelum data masuk) → seluruh render
 * 22 Juli sesudahnya `ms_gl: 1` ms = cache hit atas hasil kosong, sementara
 * query yang sama langsung ke DB itu mengembalikan 132 baris.
 *
 * JALUR PRODUKSINYA NYATA: onboarding unit baru. Siapa pun yang membuka
 * `/board` atau `/laporan-harian` saat backfill unit baru masih berjalan akan
 * mengunci G/L unit itu jadi 0 sampai sehari penuh.
 *
 * Hasil nol BARIS berbeda dari nol NILAI. Unit yang sah-sah saja tak punya
 * selisih (Σ gl = 0) tetap ter-cache bila lengkap/final. Hasil tanpa baris,
 * provisional, null atau tangki dikecualikan dibaca ulang.
 *
 * Extended after the October incident: null, excluded, or provisional rows
 * also bypass a cached result. Committed sync revisions invalidate nonempty
 * previously-final results when late receipts/corrections arrive.
 *
 * ⚠️ INI MELENGKAPI `glIncomplete` (harian-model.ts), BUKAN MENGGANTIKANNYA.
 * Jangan hapus salah satunya karena mengira redundan:
 *   - di sini  → menutup keracunan TOTAL (nol baris sama sekali);
 *   - di sana  → menangkap prefiks SEBAGIAN (beberapa hari ada, sisanya hilang),
 *                yang TIDAK akan pernah terdeteksi pemeriksaan kosong ini.
 * Keduanya nyata dan tak saling menutupi.
 *
 * BIAYA — DIUKUR, bukan ditaksir (LIVE lewat proxy, median dari 3 kali, 2026-07-25):
 *   nol baris  AS Sep 2025  →  154 ms      nol baris  AS Ags 2025 →  135 ms
 *   berisi     AS Jun 2026  →  224 ms      berisi     IB Jun 2026 →  415 ms
 * Jadi jendela nol-baris memang dihitung ulang tiap request, ~135–155 ms per
 * unit-jendela pada pengukuran lama. Setelah invalidasi berbasis sumber,
 * frekuensi cold query mengikuti ingest; ukur ulang latensi setelah staging.
 */
export function shouldBypassEmptyCache(rows: readonly DailyGlRow[]): boolean {
  return rows.length === 0 || rows.some((r) => r.provisional || r.gl === null || r.excluded_tanks > 0);
}

/**
 * Ambil prefiks historis. Valid/final → NILAI CACHE dipakai apa adanya dan
 * `fresh` TIDAK pernah dipanggil (netralitas perilaku untuk `/board`).
 * Terpisah dari `cachedGl` agar keputusannya teruji tanpa runtime Next
 * (`unstable_cache` melempar di luar RSC).
 */
export async function resolveHistoricPart(
  cached: () => Promise<DailyGlRow[]>,
  fresh: () => Promise<DailyGlRow[]>,
): Promise<DailyGlRow[]> {
  const hit = await cached();
  if (!shouldBypassEmptyCache(hit)) return hit;
  return fresh();
}

function cachedGl(unit: ScopedUnitId, from: string, to: string, revision: string): Promise<DailyGlRow[]> {
  return resolveHistoricPart(
    unstable_cache(
      () => getDailyGlByProduct(unit, from, to),
      ["gl-window-v2", String(unit), from, to, revision],
      { revalidate: GL_CACHE_REVALIDATE_S },
    ),
    () => getDailyGlByProduct(unit, from, to),
  );
}

// React.cache hanya ada di build server (RSC); fallback identity utk vitest.
const reactCache: <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A) => R =
  (React as unknown as { cache?: typeof reactCache }).cache ?? ((fn) => fn);

/** Source commits invalidate ALL overlapping windows for this unit. This is
 * request-memoized so board comparison windows share one tiny scoped read. */
const sourceRevision = reactCache(getGlSourceRevision);

/**
 * Baris G/L harian per produk utk jendela [from..to] — historis dari cache,
 * hari berjalan segar. React cache() = memo per-request: jendela identik yang
 * diminta beberapa seksi (KPI + tabel evaluasi) hanya di-query sekali.
 */
export const getDailyGlWindow = reactCache(
  async (unit: ScopedUnitId, from: string, to: string): Promise<DailyGlRow[]> => {
    const split = splitGlWindow(from, to, todayWib());
    const revision = split.cached ? await sourceRevision(unit) : "";
    const [hist, fresh] = await Promise.all([
      split.cached ? cachedGl(unit, split.cached.from, split.cached.to, revision) : Promise.resolve([]),
      split.fresh
        ? getDailyGlByProduct(unit, split.fresh.from, split.fresh.to)
        : Promise.resolve([]),
    ]);
    return [...hist, ...fresh];
  },
);
