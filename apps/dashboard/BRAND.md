# SolaMax brand assets

Single source of truth for the SolaMax visual identity in the dashboard. Assets are
**generated** from four canonical source SVGs — never hand-edit the outputs; edit the
sources + regenerate.

> Ownership note: SolaMax is the sole in-app identity. The parent **SolaGroup** logo
> (`public/solagroup-logo.png`) is being retired from the dashboard UI (owner decision,
> Phase 0). No "by SolaGroup" mark in-app.

## Palette

| Token (`ds/tokens/colors.css`) | Hex | Use |
|---|---|---|
| `--brand-navy` | `#1A3252` | Wordmark. AAA (10.4:1) on white — the only brand color allowed as text. |
| `--brand-navy-deep` *(to add, Phase 2)* | `#0D284A` | Badge disc, dark surfaces, PWA/maskable field, OG background. |
| `--brand-sky` | `#1CA0E6` | Gauge (arcs + needle + dot). **Decorative only** (2.9:1) — never text. |
| — | `#FFFFFF` | Reversed wordmark on dark surfaces. |

The art is effectively two-color (sky + navy). There is **no** mid-blue.

## Variants → where each is used

| Asset | Aspect | Surface |
|---|---|---|
| `solamax-horizontal.svg` | ~4.06:1 | Expanded sidebar header, topbar (light surfaces → navy wordmark). |
| `solamax-horizontal-reversed.svg` | ~4.06:1 | Same lockup for **dark** surfaces (white wordmark). Dark-mode ready; OG card. |
| `solamax-stacked.svg` | 1:1 | Login / auth / splash — vertical, generous space. |
| `solamax-symbol.svg` | ~1.61:1 | Collapsed sidebar (~24–28px), compact/dense spots. **`currentColor`** — tints via CSS `color` (defaults to sky). Derived by cropping the gauge out of the lockup. |
| `solamax-badge.svg` | 1:1 | Avatar, social, dark tiles, large app icons (≥180px) — navy disc + gauge + **white wordmark**. |
| `solamax-badge-mark.svg` | 1:1 | Wordmark-free disc + gauge — **favicon / tiny sizes** where the wordmark would smudge (≤48px). |

### Responsive rule
Wide containers → horizontal lockup; narrow containers → symbol. Driven by the `<Logo>`
component's `variant="auto"` (Phase 2), **not** by shipping duplicate markup.

## Sizing rules

- **Minimum sizes.** Horizontal lockup: ≥ **120px** wide (below that the wordmark degrades).
  Symbol: ≥ **20px**. Badge with wordmark: ≥ **64px**; below that use `solamax-badge-mark`.
- **Favicon.** 16/32/48px use the **mark** (no wordmark) — verified legible at 16px.
  apple-icon (180) / PWA (192, 512) / social use the full badge.
- **Clear-space.** Keep padding ≥ **25% of the logo height** clear of other content on all
  sides (≈ the height of the wordmark's cap). For the symbol, ≥ 15% of its height.
- **Don't stretch.** Always preserve aspect ratio. Scale by height (lockups) or by the square
  box (symbol/badge). Never set non-proportional width+height. Reserve intrinsic width/height
  to avoid layout shift (CLS).
- **Restraint.** The logo orients; it never dominates. Topbar/sidebar lockup height ≈ 20–28px.

## Accessibility

- Header/sidebar logo is a **link to `/`** → give it an accessible name ("SolaMax, beranda")
  and a visible focus ring; adequate tap target (≥ `--target-min`) on mobile.
- Decorative repeats (e.g. a logo already labelled elsewhere on the same view) → `aria-hidden`.
- `--brand-sky` never carries text (fails contrast). Wordmark navy is AAA on white.

## Dark mode (ready, not shipped)

Light mode only for now. Dark-ready because: colors are tokens, and reversed/white assets
exist (`solamax-horizontal-reversed.svg`, `solamax-badge.svg`, and the `currentColor` symbol).
A future `:root[data-theme="dark"]` swaps the lockup to the reversed variant.

## Files

```
brand-src/                     # canonical sources (committed) — edit these, then regenerate
  stacked.svg horizontal.svg horizontal-reversed.svg badge.svg
public/brand/                  # generated: optimized SVGs, symbol, PNG fallbacks, PWA icons
src/app/                       # generated Next conventions: icon.svg favicon.ico
                               #   apple-icon.png opengraph-image.png  (+ manifest.ts, authored)
```

## Regenerate (reproducible)

```bash
nvm use 22
pnpm --filter @solamax/dashboard gen:brand
```

Idempotent — same sources produce the same bytes. The SVGO pass is conservative (verified:
before/after raster mean-abs-diff ≈ 0.002/255, so rendered geometry is unchanged). To
re-skin for a white-label tenant, replace `brand-src/` + the color constants and rerun.
