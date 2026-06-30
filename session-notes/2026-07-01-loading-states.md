# Loading-state system — dashboard (pilot)

**Date:** 2026-07-01 · **Branch:** `claude/loading-state` · **PR:** [#36](https://github.com/ddsalam/solamax/pull/36) (→ `staging`, merged)
**Live revision verified:** `solamax-dashboard-staging-00026-hvg` (image-only CD, env/secrets preserved, no migration)

## Feature
A reusable, **light-theme-only** loading-state library + wiring into the highest-value pilot
surfaces. Presentation only — no data/query/`db.ts`/auth/scope/Server-Action-contract changes,
no new dependencies.

## Locked owner decisions
- **Scope = pilot**: wire only the report surfaces behind the slow G/L query (`/board`, `/laporan`,
  `/rincian`) and the manual-write forms (Pendapatan Lain / Pengeluaran / Setoran Tunai +
  Usulan Penebusan SO). Other surfaces get only the generic group fallback this pass.
- **Theme = strictly light** (consciously overrode the "light+dark" rule).
- **Coverage = full**: incl. cancellation (rule 12) on report loads + selective optimistic
  updates (rule 10) on forms.
- **loading.tsx reach** = ONE generic neutral group fallback + tailored skeletons in the 5 pilot
  segments.
- **Error** = group-level `(app)/error.tsx` with `reset()` Retry (no per-segment boundaries this pass).
- **Cancel UX** = "Batal" → `router.back()`, labelled honestly ("stop waiting / kembali") — the
  G/L query is **not** client-abortable (no AbortController on `pg` pool; 120s statement_timeout
  server-side), so cancel is client-perceived only.
- **Group fallback** = CSS-delayed fade-in (~250ms) so fast out-of-pilot navs show nothing.
- **Reduced motion** = one global `@media (prefers-reduced-motion: reduce)` block.

## Kit API (`src/components/loading/`)
| Component | Notes |
|---|---|
| `timing.ts` | `LOADER_DELAY_MS = 200` + `useDelayedFlag` — anti-flash for **in-component** loaders only (StateView/Overlay/LoadingButton spinner). Route `loading.tsx` is intentionally instant. |
| `Spinner` | size sm/md/lg, accessible label, inline/block, `role=status`. Rotation reads `--shimmer-duration`. |
| `Skeleton` + `SkeletonText/Table/Card` | token-timed shimmer (`--shimmer-duration`), `aria-hidden` (container owns the status region). |
| `Progress` | built for kit completeness, **unwired in pilot** (report load is indeterminate → escalating messages, no fake bar). |
| `LoadingButton` | instant `disabled`+`aria-busy`; spinner gated by `LOADER_DELAY_MS`; `pendingLabel`. Replaces the old `"…"` flip. |
| `LoadingOverlay` | local (scoped to nearest positioned ancestor), never full-screen. |
| `StateView` | rule-8 loading/empty/error/success; extends existing `.na-panel`/`.empty-inline`; `inline` mode for form error/success. |
| `ReportLoading` | progressive escalation (0s → 4s "Masih memproses…" + Batal → 12s → 30s "…hingga ~2 menit") + Batal→`router.back()`. |

Tokens: added `--shimmer-duration: 1200ms` (motion.css); `.spinner` rotation tokenized.
CSS: new `/* Loading kit */` section + global reduced-motion block in `app.css`.

## Surfaces wired
- Route skeletons: `(app)/loading.tsx` (generic, CSS-delayed), `(app)/error.tsx`, and tailored
  `loading.tsx` for `/board`, `/laporan/[date]`, `/rincian/[date]`, `/usulan/[date]`,
  `/usulan/[date]/edit` (each sized to the real page head).
- Forms: `useOptimistic` on ManualEntryForm (add provisional `.pending`/`aria-busy` row + void hide)
  and UsulanForm (status pill flip); `LoadingButton` on all three write buttons.
- AutoRefresh: fixed-corner "Memperbarui…" pill (out of flow → zero shift), content never blanks.

## Live evaluation results (CD revision 00026-hvg)
- **Skeleton zero-shift (/laporan)** — soft-nav skeleton: toolbar top **97 = 97** (pinned), board-head
  165 vs 170 (**5px**, no visible jump), 16 skeleton elements + ReportLoading present. ✓ (minor 5px
  on the sub-heading — skeleton toolbar ~5px shorter than the real toolbar; not pixel-perfect).
- **Progressive escalation live** — tier-0 "Menyiapkan laporan…" (+ `role=status`/`aria-live=polite`),
  tier-1 "Masih memproses…" **+ Batal appears**, tier-2 "Server database kecil…" all confirmed live
  (screenshots). Batal **renders** live; Batal→`router.back()` proven in Step-1 local (identical
  deployed component; live click timing too tight to also nail because loads are now ~1–2s).
- **Forms optimistic add** — provisional row at **+1ms** with `.pending`/`aria-busy=true`, button
  instantly `aria-busy=true`+disabled; reconciled to a real persisted row at **+557ms** via
  `revalidatePath`. ✓
- **Forms optimistic void** — row hidden at **+0ms**, reconciled +370ms. ✓
- **Forms failure rollback** — genuine server rejection (amount `0`): provisional row appears (+1ms),
  Server Action returns `{ok:false}` → `role=alert` "Jumlah harus angka > 0." + optimistic row
  **reverts to 0**; nothing persisted. ✓
- **Usulan optimistic pill** — pill flipped Draft → "Diajukan ke Keuangan" at +60ms, both
  LoadingButtons "Menyimpan…" + spinner + `aria-busy`+disabled (captured via a hung action → no
  persist). ✓
- **error.tsx live** — forced Server Action failure → group boundary renders "Halaman gagal dimuat"
  + friendly BI + "Coba lagi", **contained in the app shell**; `reset()` Retry restores the form. ✓
- **a11y** — `role=status`+`aria-live=polite` (loading), `aria-busy` toggles (forms), `role=alert`
  (form + boundary errors). ✓
- **Reduced motion (OS toggled ON live)** — spinner **visible** (colored ring `rgb(10,110,189)`) but
  `animationName: none` / `0s`; skeleton **visible**, `::after animationName: none` (shimmer off);
  `.spinner` selector covers the legacy `sm-spin`; escalation message still updates (text). OS setting
  reverted to OFF afterward. ✓
- **AutoRefresh pill** — fixed bottom-right "Memperbarui…" pill seen live; out of document flow. ✓

### Gap named honestly
- **No-flash partial flash on `/` (home)**: the group fallback IS CSS-delayed (opacity starts 0), but
  the home soft-nav measured ~400ms (> the 250ms threshold) → fallback faded to **opacity 0.58** (a
  brief partial flash). Anti-flash works for sub-250ms loads; home sits just over. Not a regression
  (threshold by design); consider raising the delay or speeding the home segment if it bothers.

## Deferred to next pass
- Out-of-pilot **tailored skeletons** (home / ketaatan / denah / kelola-akses get only the generic
  group fallback).
- **Progress** primitive wiring (built, unused — no measurable load in pilot).
- **Per-segment `error.tsx`** (group boundary sufficient so far).
- Denah/ATG live-refresh rule-4 affordance (out of pilot; noted).

## Reusable gotchas
- **corepack/Node-24 break**: the repo `pnpm` shim runs through a corepack that throws on Homebrew
  Node 24 (`URL.canParse`); and Vite 5 / vitest need Node 18+. Run the toolchain directly under
  `~/.nvm/versions/node/v20.19.6/bin` on PATH (`tsc`, `vitest`, `next build`, `oxlint`).
- **`/probe` private-folder gotcha**: Next treats `_`-prefixed app folders as private (non-routable).
  Use a plain name. Auth `middleware.ts` only checks for the **presence** of `authjs.session-token`
  (DB validation is server-side in the `(app)` group) — a placeholder cookie passes the edge gate for
  a route outside `(app)`.
- **Hung-RSC remount loop**: a `loading.tsx` whose page hangs on a long server `setTimeout` makes Next
  dev re-request repeatedly, remounting `ReportLoading` and resetting its timer (it never escalates).
  Exercise the escalation timer on a **resolved** page instead.
- **Live throttling without DevTools**: the Chrome MCP has no network-throttle UI. Monkeypatch
  `window.fetch` to slow the **RSC stream** (Next nav RSC = GET with `?_rsc=` + `RSC:1` header). Block-
  then-fetch delays the *server-streamed* skeleton too (wrong); instead buffer the body and re-emit it
  in slices over N seconds (byte-trickle) so the loading boundary commits early but content lands late.
- **React controlled inputs**: the Chrome MCP `form_input` tool sets the DOM value but React ignores it
  (onChange never fires → submit stays disabled). OS `type` keystrokes also need real OS-level focus,
  which JS `.focus()` doesn't establish in this scaled environment. The reliable path is the native
  value setter + dispatched `input` event (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,
  'value').set` then `dispatchEvent(new Event('input',{bubbles:true}))`) — this fires React's onChange
  exactly like a keystroke; **proof it's genuine** = the submit button enables.
- **Coordinate space**: the staging window CSS viewport was 2940px wide while screenshots were 1512px
  (~1.94×). Pixel clicks from screenshots missed; prefer `find`→`ref` clicks or JS-dispatched bubbling
  `MouseEvent` on elements (the latter reliably triggers React/Next `<Link>` soft navs).
- **CSS-delayed group fallback** = threshold, not a guarantee: invisible for <250ms loads, partial
  fade for ~250–600ms loads.

## Cleanup
All write tests were on the old non-today date **2026-06-20** and voided immediately:
Pendapatan Lain + Pengeluaran rows voided via the Batalkan UI; Setoran Tunai failure-test never
persisted (server-rejected); Usulan tests used a forced-fail + hung action → nothing written.
Verified post-test: all 3 rincian forms = 0 items; usulan = Draft. Today's date never touched.
