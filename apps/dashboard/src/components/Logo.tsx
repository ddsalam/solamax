import Link from "next/link";
import {
  ACTIVE_BRAND,
  AUTO_NARROW,
  AUTO_WIDE,
  type LogoVariant,
  type ResolvedVariant,
} from "@/lib/brand";
import { BADGE_MARK_MARKUP, SYMBOL_MARKUP } from "@/lib/brand-marks.generated";

/**
 * <Logo> — the SINGLE source for every logo in the app. Nothing else may import a
 * logo asset directly (BRAND.md). Token-driven + swappable via the brand registry
 * (src/lib/brand.ts). No hooks → usable from server or client components.
 *
 * Zero CLS: every variant reserves explicit width×height from its intrinsic aspect.
 * a11y: linked logos expose an accessible name + focus ring; the visual is always
 * aria-hidden so the name is announced once. Decorative (unlinked) → silent.
 * Responsive: variant="auto" swaps horizontal lockup ↔ badge-mark by CONTAINER
 * width (pure CSS, no duplication at the call site).
 */

const MARKUP: Record<"symbol" | "badgeMark", string> = {
  symbol: SYMBOL_MARKUP,
  badgeMark: BADGE_MARK_MARKUP,
};

export interface LogoProps {
  /** which lockup; "auto" = responsive horizontal ↔ badge-mark. Default "horizontal". */
  variant?: LogoVariant;
  /** dark surface → white-wordmark asset (only horizontal has one; else falls back). */
  reversed?: boolean;
  /** rendered height in px; width derives from the variant aspect. Default 28. */
  height?: number;
  /** when set, wraps in a link (focus ring + accessible name). */
  href?: string | null;
  /** accessible name for a meaningful logo. Defaults to the brand wordmark. */
  label?: string;
  /** purely decorative (unlinked) → hidden from assistive tech. */
  decorative?: boolean;
  /** eager-load the lockup image (e.g. above-the-fold topbar). Default lazy. */
  priority?: boolean;
  className?: string;
}

/** Render one concrete variant's visual (always aria-hidden — name lives on the wrapper). */
function Mark({
  variant,
  reversed,
  height,
  priority,
  className,
}: {
  variant: ResolvedVariant;
  reversed?: boolean;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  const spec = ACTIVE_BRAND.variants[variant];
  const width = Math.round(height * spec.aspect * 100) / 100;

  if (spec.mode === "inline") {
    const markup = MARKUP[spec.inlineKey!];
    return (
      <span
        aria-hidden="true"
        className={`logo-inline${spec.tintable ? " logo-symbol" : ""}${className ? ` ${className}` : ""}`}
        // width/height reserve the box (no CLS); `display` stays in CSS so the
        // container-query swap can override it.
        style={{ width, height, flex: "none" }}
        // markup is build-time-generated brand SVG (scripts/gen-brand-assets.mjs), not user input
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }

  const src = reversed && spec.srcReversed ? spec.srcReversed : spec.src!;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      // eslint-disable-next-line @next/next/no-img-element -- explicit <img> keeps intrinsic dims + no optimizer for vector SVG
      className={`logo-img${className ? ` ${className}` : ""}`}
      // `display` stays in CSS (.logo-img) so the container-query swap can override it.
      style={{ width, height }}
    />
  );
}

export function Logo({
  variant = "horizontal",
  reversed = false,
  height = 28,
  href,
  label,
  decorative = false,
  priority = false,
  className,
}: LogoProps) {
  const name = label ?? ACTIVE_BRAND.wordmark;
  const isAuto = variant === "auto";

  // The marks. For "auto" both are rendered and CSS shows exactly one; each
  // reserves its own width×height so neither the swap nor image load shifts layout.
  const marks = isAuto ? (
    <>
      <Mark variant={AUTO_WIDE} reversed={reversed} height={height} priority={priority} className="logo-lockup" />
      <Mark variant={AUTO_NARROW} reversed={reversed} height={height} priority={priority} className="logo-compact" />
    </>
  ) : (
    <Mark variant={variant} reversed={reversed} height={height} priority={priority} />
  );

  // The semantic wrapper IS the query container for "auto": container-type +
  // width:100% makes it measure the CONSUMER's slot (not its own content), so a
  // narrow slot → badge-mark, wide slot → lockup. Fixed variants shrink-wrap.
  const autoStyle: React.CSSProperties = isAuto
    ? { height, width: "100%", display: "flex", alignItems: "center" }
    : { display: "inline-flex", alignItems: "center" };
  const cls = (base: string) => `${base}${isAuto ? " logo-auto" : ""}${className ? ` ${className}` : ""}`;

  // Linked: the link carries the accessible name + focus ring; marks stay aria-hidden.
  if (href != null) {
    return (
      <Link href={href} aria-label={name} className={cls("logo-link")} style={autoStyle}>
        {marks}
      </Link>
    );
  }
  // Unlinked decorative → silent. Unlinked meaningful → role=img with a name.
  if (decorative) {
    return (
      <span className={cls("logo")} style={autoStyle}>
        {marks}
      </span>
    );
  }
  return (
    <span role="img" aria-label={name} className={cls("logo")} style={autoStyle}>
      {marks}
    </span>
  );
}
