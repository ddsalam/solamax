// @ts-check
/**
 * gen-brand-assets.mjs — regenerates the ENTIRE SolaMax brand asset set from the
 * four canonical source SVGs in ../brand-src. Idempotent: same inputs → same
 * outputs. Reproducible/white-label ready — swap brand-src/ + BRAND config to
 * reskin. Node 22 (nvm) + sharp + svgo + png-to-ico (see package.json devDeps).
 *
 *   pnpm --filter @solamax/dashboard gen:brand
 *
 * Sources (verified Phase 0):
 *   stacked.svg            1:1  gauge above navy #1A3252 wordmark
 *   horizontal.svg         ~4:1 gauge + navy #1A3252 wordmark
 *   horizontal-reversed.svg~4:1 gauge + white  #FFFFFF wordmark (dark surfaces)
 *   badge.svg              1:1  #0D284A disc + sky gauge + white wordmark
 *   symbol  = DERIVED: strip the 7 white glyph groups from horizontal-reversed,
 *            leaving the pure sky #1CA0E6 gauge (arcs+needle+dot), recolored to
 *            currentColor and cropped to a tight viewBox via raster trim.
 *
 * Outputs land in public/brand/ (SVGs, PNG fallbacks, PWA icons) and src/app/
 * (Next file conventions: icon.svg, favicon.ico, apple-icon.png,
 * opengraph-image.png). manifest.ts is hand-authored source, not generated here.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { optimize } from "svgo";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "brand-src");
const PUB = join(ROOT, "public", "brand");
const APP = join(ROOT, "src", "app");

// Brand constants — mirror src/styles/ds/tokens/colors.css (single source elsewhere).
const NAVY = "#1A3252"; // wordmark
const NAVY_DEEP = "#0D284A"; // badge disc / dark surface
const SKY = "#1CA0E6"; // gauge (decorative)
const WHITE = "#FFFFFF";

/** Conservative SVGO: shrink structure but DO NOT alter rendered geometry.
 *  floatPrecision kept high (3) and path-data conversion left lossless-ish so a
 *  before/after raster diff stays ~0 (verified in the report). */
const svgoConfig = {
  multipass: true,
  floatPrecision: 3,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false, // viewBox is load-bearing for responsive sizing
          // keep geometry byte-safe: no aggressive merging/rounding that moves pixels
          convertPathData: { floatPrecision: 3, transformPrecision: 5 },
          cleanupNumericValues: { floatPrecision: 3 },
          mergePaths: false,
        },
      },
    },
    // KEEP width/height (do NOT removeDimensions): a dimensionless SVG (viewBox
    // only) renders BLANK inside <img> on Chromium. Intrinsic dims fix img-mode;
    // inline marks override them via CSS (.logo-inline svg { width/height:100% }).
  ],
};

async function optimizeSvg(srcName, outName) {
  const raw = await readFile(join(SRC, srcName), "utf8");
  const { data } = optimize(raw, { ...svgoConfig, path: srcName });
  await writeFile(join(PUB, outName), data, "utf8");
  return data;
}

/** Render an SVG string to a PNG buffer at an exact pixel width (height auto). */
function svgToPng(svg, width) {
  return sharp(Buffer.from(svg), { density: 384 }).resize({ width }).png().toBuffer();
}
/** Render an SVG string to a square PNG of `size`×`size` px. */
function svgToSquare(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Derive the symbol: from horizontal-reversed, remove the white wordmark glyph
 * groups (fill="#ffffff"), recolor the remaining sky gauge to currentColor, then
 * compute a tight viewBox by rasterising + trimming transparent margins and
 * mapping the trimmed box back into SVG user units.
 */
async function deriveSymbol() {
  let svg = await readFile(join(SRC, "horizontal-reversed.svg"), "utf8");

  // 1) Drop every <g fill="#ffffff" ...> ... </g> subtree (the 7 wordmark glyphs).
  //    These groups are self-contained and non-nested w.r.t. each other, so a
  //    balanced-tag scan is exact.
  svg = removeGroupsByFill(svg, "#ffffff");

  // 2) Optimize (also prunes now-empty clip wrappers left behind).
  svg = optimize(svg, { ...svgoConfig, path: "symbol" }).data;

  // 3) Read the source viewBox (user-unit space).
  const vb = /viewBox="([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+)"/.exec(svg);
  const [vbX, vbY, vbW, vbH] = vb.slice(1).map(Number);

  // 4) Rasterise gauge-only at a DETERMINISTIC size — inject explicit width/height
  //    (= viewBox × K) so sharp renders exactly K px per user unit regardless of
  //    density/removeDimensions. Then trim transparent margins → pixel bbox.
  const K = 4; // px per user unit
  const measSvg = svg
    .replace(/\s(?:width|height)="[^"]*"/g, "") // strip source dims (svgo now keeps them)
    .replace(/<svg /, `<svg width="${vbW * K}" height="${vbH * K}" `);
  const { info } = await sharp(Buffer.from(measSvg))
    .trim({ threshold: 1 })
    .png()
    .toBuffer({ resolveWithObject: true });
  // trimOffset{Left,Top} = how far the kept region sits from the original edge
  // (negative). width/height in info = trimmed box dimensions, in px.
  const offL = -info.trimOffsetLeft;
  const offT = -info.trimOffsetTop;
  const boxW = info.width;
  const boxH = info.height;

  // 5) Map pixel bbox → user units, add a small uniform pad for optical breathing.
  const PAD = (Math.max(boxW, boxH) / K) * 0.03;
  const nx = vbX + offL / K - PAD;
  const ny = vbY + offT / K - PAD;
  const nw = boxW / K + PAD * 2;
  const nh = boxH / K + PAD * 2;
  const round = (n) => Math.round(n * 100) / 100;
  const newVb = `${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}`;

  // 6) Recolor sky → currentColor (tintable), reset intrinsic dims to the cropped
  //    box (source dims no longer match), and apply the tight viewBox.
  svg = svg
    .replace(/\s(?:width|height)="[^"]*"/g, "") // drop stale source dims
    .replace(/fill="#1ca0e6"/gi, 'fill="currentColor"')
    .replace(/viewBox="[^"]*"/, `viewBox="${newVb}"`)
    // default sky color (overridable via CSS `color`) + intrinsic dims = crop box
    .replace(/<svg /, `<svg color="${SKY}" width="${round(nw)}" height="${round(nh)}" `);

  await writeFile(join(PUB, "solamax-symbol.svg"), svg, "utf8");
  return { newVb, aspect: round(nw / nh) };
}

/** Remove balanced <g ...fill="COLOR"...>…</g> subtrees from an SVG string. */
function removeGroupsByFill(svg, color) {
  const open = new RegExp(`<g[^>]*fill="${color}"[^>]*>`, "i");
  let out = svg;
  for (;;) {
    const m = open.exec(out);
    if (!m) break;
    // walk forward counting <g …>/<g/> vs </g> to find the matching close.
    let i = m.index + m[0].length;
    let depth = 1;
    const tag = /<g\b|<\/g>/g;
    tag.lastIndex = i;
    let mm;
    while ((mm = tag.exec(out))) {
      if (mm[0] === "</g>") {
        depth--;
        if (depth === 0) {
          out = out.slice(0, m.index) + out.slice(mm.index + 4);
          break;
        }
      } else {
        depth++;
      }
    }
    if (depth !== 0) break; // malformed — stop rather than loop forever
  }
  return out;
}

/** Compose a maskable PWA icon: badge content on a full-bleed navy square,
 *  scaled to the 80% safe zone so the platform mask never clips the mark. */
async function maskableIcon(badgeSvg, size) {
  const inner = Math.round(size * 0.8);
  const badge = await svgToSquare(badgeSvg, inner);
  return sharp({
    create: { width: size, height: size, channels: 4, background: NAVY_DEEP },
  })
    .composite([{ input: badge, gravity: "center" }])
    .png()
    .toBuffer();
}

/** OG / social card: reversed horizontal lockup centered on deep navy + tagline. */
async function ogImage(reversedSvg) {
  const W = 1200,
    H = 630;
  const lockup = await svgToPng(reversedSvg, 760); // wordmark reads at this width
  const lockupMeta = await sharp(lockup).metadata();
  const tagline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
       <text x="${W / 2}" y="430" text-anchor="middle"
         font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
         font-size="30" letter-spacing="0.5" fill="#9FC7E8"
         font-weight="500">Pengawasan &amp; analisa jaringan SPBU SolaGroup</text>
     </svg>`,
  );
  return sharp({
    create: { width: W, height: H, channels: 4, background: NAVY_DEEP },
  })
    .composite([
      { input: lockup, top: Math.round(210 - lockupMeta.height / 2), left: Math.round((W - 760) / 2) },
      { input: tagline, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(PUB, { recursive: true });
  const manifest = [];
  const record = async (relDir, name, buf) => {
    const dir = relDir === "app" ? APP : PUB;
    await writeFile(join(dir, name), buf);
    manifest.push([`${relDir === "app" ? "src/app" : "public/brand"}/${name}`, buf.length]);
  };

  // ---- 1. Optimized source SVGs ----
  const horizontal = await optimizeSvg("horizontal.svg", "solamax-horizontal.svg");
  const reversed = await optimizeSvg("horizontal-reversed.svg", "solamax-horizontal-reversed.svg");
  const stacked = await optimizeSvg("stacked.svg", "solamax-stacked.svg");
  const badge = await optimizeSvg("badge.svg", "solamax-badge.svg");
  for (const [n, d] of [
    ["solamax-horizontal.svg", horizontal],
    ["solamax-horizontal-reversed.svg", reversed],
    ["solamax-stacked.svg", stacked],
    ["solamax-badge.svg", badge],
  ])
    manifest.push([`public/brand/${n}`, Buffer.byteLength(d)]);

  // ---- 2. Derived symbol ----
  const symMeta = await deriveSymbol();
  const symbol = await readFile(join(PUB, "solamax-symbol.svg"), "utf8");
  manifest.push([`public/brand/solamax-symbol.svg`, Buffer.byteLength(symbol)]);

  // ---- 2b. Wordmark-free badge (disc + gauge) for tiny favicon legibility ----
  //   The full badge's wordmark is an illegible smudge ≤32px; strip the 7 white
  //   glyph groups, keep the #0D284A disc + sky gauge → reads as a mark at 16px.
  let badgePlain = removeGroupsByFill(await readFile(join(SRC, "badge.svg"), "utf8"), "#ffffff");
  badgePlain = optimize(badgePlain, { ...svgoConfig, path: "badge-plain" }).data;
  await writeFile(join(PUB, "solamax-badge-mark.svg"), badgePlain, "utf8");
  manifest.push([`public/brand/solamax-badge-mark.svg`, Buffer.byteLength(badgePlain)]);

  // ---- 3. PNG raster fallbacks (@1x/@2x) for the lockups ----
  await record("brand", "solamax-horizontal.png", await svgToPng(horizontal, 240));
  await record("brand", "solamax-horizontal@2x.png", await svgToPng(horizontal, 480));
  await record("brand", "solamax-stacked.png", await svgToSquare(stacked, 200));
  await record("brand", "solamax-stacked@2x.png", await svgToSquare(stacked, 400));

  // ---- 4. PWA icons (badge) + maskable (badge on navy safe-zone) ----
  await record("brand", "icon-192.png", await svgToSquare(badge, 192));
  await record("brand", "icon-512.png", await svgToSquare(badge, 512));
  await record("brand", "icon-192-maskable.png", await maskableIcon(badge, 192));
  await record("brand", "icon-512-maskable.png", await maskableIcon(badge, 512));

  // ---- 4b. Inline mark markup → TS module (single source for <Logo> inline SVGs) ----
  //   symbol: strip the default color attr so it inherits currentColor (tintable);
  //   badge-mark: keep its fixed navy+sky. Both rendered inline for crispness.
  const symbolInline = (await readFile(join(PUB, "solamax-symbol.svg"), "utf8"))
    .replace(/\s*color="[^"]*"/, "")
    .trim();
  const badgeMarkInline = badgePlain.trim();
  const marksModule =
    `// GENERATED by scripts/gen-brand-assets.mjs — do not edit by hand.\n` +
    `// Inline SVG markup for the tiny marks used by <Logo> (crisp + tintable).\n` +
    `export const SYMBOL_MARKUP = ${JSON.stringify(symbolInline)};\n` +
    `export const BADGE_MARK_MARKUP = ${JSON.stringify(badgeMarkInline)};\n`;
  await writeFile(join(ROOT, "src", "lib", "brand-marks.generated.ts"), marksModule, "utf8");
  manifest.push([`src/lib/brand-marks.generated.ts`, Buffer.byteLength(marksModule)]);

  // ---- 5. Next file conventions in src/app ----
  //   icon.svg (scalable favicon = wordmark-free mark → legible when UA rasterises small)
  await record("app", "icon.svg", Buffer.from(badgePlain, "utf8"));
  //   apple-icon 180 (full badge — wordmark reads at this size, adds brand on iOS home)
  await record("app", "apple-icon.png", await svgToSquare(badge, 180));
  //   favicon.ico 16/32/48 (wordmark-free mark — disc + gauge reads at 16px)
  const icoSizes = await Promise.all([16, 32, 48].map((s) => svgToSquare(badgePlain, s)));
  const ico = await pngToIco(icoSizes);
  await record("app", "favicon.ico", ico);
  //   OG image 1200×630
  await record("app", "opengraph-image.png", await ogImage(reversed));

  // ---- Report ----
  console.log("\nSolaMax brand assets — generated:\n");
  for (const [p, n] of manifest.sort()) console.log(`  ${String(n).padStart(7)} B  ${p}`);
  console.log(`\nDerived symbol viewBox: ${symMeta.newVb}  (aspect ${symMeta.aspect}:1)`);
  console.log(`Total: ${manifest.length} files\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
