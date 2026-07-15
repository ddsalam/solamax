/**
 * Parser state filter board dari URL searchParams — MURNI (tanpa import server)
 * agar teruji unit langsung. KEAMANAN: `units` dari URL WAJIB di-intersect dengan
 * unit ber-scope caller (keputusan FASE 0 №3: intersect-fallback, bukan 404) —
 * user TIDAK BISA memilih unit di luar scope-nya via URL; hasil intersect kosong
 * / param absen → fallback SEMUA unit ber-scope (URL shareable terdegradasi anggun,
 * tanpa membocorkan keberadaan unit asing).
 *
 * Kompat mundur URL lama: p=week→7d, p=month→30d (link/bookmark pra-redesign).
 */
import { resolveBoardPeriod, type BoardPeriod } from "./periods";
import type { ScopedUnit } from "./scope-rule";

export type BoardMode = "kumulatif" | "banding";

export interface BoardParams {
  /** Unit terpilih — SELALU ⊆ scope caller, urutan mengikuti scope. */
  units: ScopedUnit[];
  /** true bila semua unit ber-scope terpilih (default). */
  allUnits: boolean;
  period: BoardPeriod;
  mode: BoardMode;
}

export interface BoardSearchParams {
  units?: string;
  p?: string;
  from?: string;
  to?: string;
  mode?: string;
}

/** p lama (rolling resolvePeriod) → key baru. */
const LEGACY_P: Record<string, string> = { week: "7d", month: "30d" };

export function parseBoardParams(
  sp: BoardSearchParams,
  scopeUnits: ScopedUnit[],
  now: Date = new Date(),
): BoardParams {
  // ── Unit: intersect URL ∩ scope (fallback semua scope) ──
  const requested = new Set(
    (sp.units ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const picked = scopeUnits.filter((u) => requested.has(u.code));
  const units = picked.length > 0 ? picked : scopeUnits;

  // ── Periode (default today — selaras board lama) ──
  const key = sp.p === undefined ? "today" : (LEGACY_P[sp.p] ?? sp.p);
  const period = resolveBoardPeriod(key, { from: sp.from, to: sp.to }, now);

  const mode: BoardMode = sp.mode === "banding" ? "banding" : "kumulatif";

  return { units, allUnits: units.length === scopeUnits.length, period, mode };
}

/** Serialisasi state → query string kanonik (dipakai link preset/komponen filter). */
export function boardParamsToQuery(args: {
  unitCodes: string[];
  allUnits: boolean;
  p: string;
  from?: string;
  to?: string;
  mode: BoardMode;
}): string {
  const q = new URLSearchParams();
  if (!args.allUnits && args.unitCodes.length > 0) q.set("units", args.unitCodes.join(","));
  if (args.p !== "today") q.set("p", args.p);
  if (args.p === "custom" && args.from && args.to) {
    q.set("from", args.from);
    q.set("to", args.to);
  }
  if (args.mode === "banding") q.set("mode", "banding");
  const s = q.toString();
  return s ? `?${s}` : "";
}
