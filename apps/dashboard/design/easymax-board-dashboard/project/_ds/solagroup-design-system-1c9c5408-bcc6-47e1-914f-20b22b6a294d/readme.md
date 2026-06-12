# SolaGroup Design System

A reusable React design system for the **SolaGroup** corporate website and future internal web apps.

## Company context

SolaGroup is an Indonesian energy/fuel holding group:
- **SPBU / Pertamina fuel stations** — retail fuel network
- **LPG distribution** — household and commercial gas
- **Retail energy** — adjacent energy retail businesses

**Tone:** trustworthy, established, institutional. Not a flashy startup.
**Primary audience:** Board of Directors (older readers) — legibility and clarity are optimized for relentlessly, over trendiness.

## Design north star

Apple Human Interface / apple.com web design language:
- **Light theme only** (hard requirement). Tokens are semantic so a dark theme can be added later without touching components.
- Generous whitespace, clear hierarchy, restrained color — neutral grays + white, one confident accent used sparingly.
- Apple-style typography: large confident headings, comfortable body line-height, system font stack (`-apple-system, "SF Pro", Inter, "Segoe UI", Roboto, sans-serif`).
- Subtle depth: soft shadows, hairline borders, 8–12px radii, minimal smooth motion. No heavy gradients, no neon.

## Accessibility floor (non-negotiable)

- Body text ≥ 17px; nothing below 16px.
- All text/background pairs meet WCAG AA 4.5:1; body text targets AAA 7:1.
- Click targets ≥ 44×44px.
- Never rely on color alone; always-visible focus states.

## Stack decision

**Plain CSS custom properties (design tokens on `:root`) + CSS-Modules-compatible class conventions, consumed by typed React components.**
Why: zero-runtime (no CSS-in-JS hydration cost in Next.js), tokens are framework-agnostic and rebrandable in one layer (`--color-text-primary`, never `--gray-800`), and a future dark theme is a single `:root[data-theme="dark"]` scope — no component edits.

## Brand decision (Gate 1 — resolved)

User chose "Pertamina Branding" and supplied the SolaGroup logo (`assets/solagroup-logo.png`). Colors sampled from the logo:
- **Brand Navy `#1A3252`** — wordmark. 10.4:1 on white (AAA). Headings, footer, inverse surfaces.
- **Brand Sky `#1CA0E6`** — dot + swoosh. 2.9:1 — **decorative only, never text**.
- **Interactive accent `#0A6EBD`** (`--accent-600`) — derived from the sky hue, darkened to pass AA (5.3:1). Hover `#085A9C` (7.1:1 AAA).

## Foundations (Gate 2)

- `styles.css` — entry point, `@import` only.
- `tokens/colors.css` — neutral ramp 50–900, accent ramp 50–900, semantic layer (`--color-*`). Light theme on `:root`; dark theme later = re-declare semantic layer under `:root[data-theme="dark"]`.
- `tokens/typography.css` — system stack; display→h6, body-lg/body/caption/eyebrow. Body 17px floor, 16px absolute minimum.
- `tokens/spacing.css` — 4px base scale, radius scale (6/10/14/20/full), `--target-min: 44px`.
- `tokens/elevation.css` — 4 soft shadow levels + frosted-nav blur tokens.
- `tokens/motion.css` — 150/250/400ms, ease-out; no bounces.
- `tokens/layout.css` — breakpoints 640/768/1024/1280, containers 720/980/1200.
- `base.css` — body defaults, `.text-*` type classes, `:focus-visible` ring.
- `Token Reference.html` — Gate 2 sign-off page with live specimens + contrast ratios.
- `guidelines/*.html` — specimen cards for the Design System tab.

## Sources

- No existing brand guide, codebase, or Figma was provided. Logo supplied by user (`uploads/logo_file-1781199790991.png`, copied to `assets/`).
- `Palette Options.html` — Gate 1 exploration (superseded by logo-derived palette).

## Status

- ✅ Gate 1: palette — resolved (logo-derived blues).
- ✋ **Gate 2: foundations — awaiting sign-off** (`Token Reference.html`).
- Gate 3: core components. Then page patterns + docs site.
