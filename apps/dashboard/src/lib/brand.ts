/**
 * Brand registry — the single, token-driven, swappable source describing each
 * logo variant: its intrinsic aspect (for zero-CLS dimension reservation), how it
 * renders (external <img> vs inline SVG), and its reversed (dark-surface) asset.
 *
 * White-label: to reskin, add another Brand and point ACTIVE_BRAND at it. Nothing
 * else in the app references logo files directly — only <Logo> reads this.
 * Colors live in ds/tokens/colors.css (--brand-navy / --brand-navy-deep /
 * --brand-sky); this file only maps variants → assets + geometry.
 */

export type LogoVariant =
  | "auto" // responsive: horizontal lockup ↔ badge-mark by container width
  | "horizontal"
  | "stacked"
  | "symbol"
  | "badge"
  | "badge-mark";

/** Concrete (non-"auto") variants that map to a real asset. */
export type ResolvedVariant = Exclude<LogoVariant, "auto">;

export interface VariantSpec {
  /** intrinsic width ÷ height — reserves box dimensions so there is no layout shift. */
  aspect: number;
  /** "img" = external optimized SVG file; "inline" = embedded SVG markup (crisp, tintable). */
  mode: "img" | "inline";
  /** img mode: light-surface asset URL. */
  src?: string;
  /** img mode: dark-surface asset URL (reversed wordmark). Falls back to `src`. */
  srcReversed?: string;
  /** inline mode: which markup constant in brand-marks.generated.ts to render. */
  inlineKey?: "symbol" | "badgeMark";
  /** inline mode: tints via CSS `color` (currentColor). */
  tintable?: boolean;
  /** human label for the mark (used when the logo is meaningful, not decorative). */
  alt: string;
}

export interface Brand {
  name: string;
  /** default accessible name for the linked/meaningful logo. */
  wordmark: string;
  variants: Record<ResolvedVariant, VariantSpec>;
}

const BASE = "/brand";

export const SOLAMAX: Brand = {
  name: "SolaMax",
  wordmark: "SolaMax",
  variants: {
    horizontal: {
      aspect: 487.5 / 120, // ≈ 4.0625
      mode: "img",
      src: `${BASE}/solamax-horizontal.svg`,
      srcReversed: `${BASE}/solamax-horizontal-reversed.svg`,
      alt: "SolaMax",
    },
    stacked: {
      aspect: 1, // 375×375
      mode: "img",
      src: `${BASE}/solamax-stacked.svg`,
      // no reversed stacked asset yet — reversed falls back to light (flagged).
      alt: "SolaMax",
    },
    badge: {
      aspect: 1, // 375×375 — navy disc reads on light and dark
      mode: "img",
      src: `${BASE}/solamax-badge.svg`,
      alt: "SolaMax",
    },
    "badge-mark": {
      aspect: 1, // 375×375 disc, wordmark-free — favicon + collapsed rail
      mode: "inline",
      inlineKey: "badgeMark",
      alt: "SolaMax",
    },
    symbol: {
      aspect: 193.98 / 120.73, // ≈ 1.607 (derived tight gauge crop)
      mode: "inline",
      inlineKey: "symbol",
      tintable: true,
      alt: "SolaMax",
    },
  },
};

export const ACTIVE_BRAND: Brand = SOLAMAX;

/** "auto" resolves to these two, swapped by container width in <Logo>. */
export const AUTO_WIDE: ResolvedVariant = "horizontal";
export const AUTO_NARROW: ResolvedVariant = "badge-mark";
