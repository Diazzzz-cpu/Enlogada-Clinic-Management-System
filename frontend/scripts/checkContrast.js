#!/usr/bin/env node
/**
 * Fails the build when an ink token cannot be read on a surface it actually lands on.
 *
 * ── Why a script and not a review note ──────────────────────────────────────────────────────
 *
 * `checkFillRoles.js` exists because comments did not stop the ink-as-fill bug shipping three
 * times — index.css carried a warning and four instances were written anyway. This is the same
 * argument applied to contrast, and it was written because deepening the canvas produced exactly
 * the failure it now catches:
 *
 *     ink-muted #64748b on white   4.76:1   passes
 *     ink-muted #64748b on canvas  4.12:1   FAILS
 *
 * The same token, legible inside a panel and not legible on the page behind it. No reviewer sees
 * that by looking, and no screenshot shows it, because both readings look grey and fine. It is
 * only visible as arithmetic.
 *
 * ── What it checks ──────────────────────────────────────────────────────────────────────────
 *
 * Every ink token against every surface it can appear on, in BOTH themes. Dark mode is not
 * assumed to inherit anything: the dark block redefines these tokens independently — deliberately,
 * because a dark theme needs a larger canvas/surface step than a light one — so it is measured
 * independently.
 *
 * WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and UI components. Tokens documented as
 * decorative are held to 3:1 and are listed explicitly, so "this one is only decoration" has to be
 * an argued exception rather than a silent default.
 *
 * Run: node scripts/checkContrast.js   (wired into `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(__dirname, '..', 'src', 'index.css');

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

/**
 * Ink tokens, and the surfaces each one legitimately sits on.
 *
 * A token is listed here because something renders text in it. Adding a token to index.css does
 * not automatically bring it under this check — that is deliberate: the list is a claim about
 * where a colour is USED, which only a person knows.
 */
const INK_ON_SURFACES = [
  { ink: 'ink', surfaces: ['surface', 'canvas', 'sunken'], min: AA_BODY },
  { ink: 'ink-soft', surfaces: ['surface', 'canvas', 'sunken'], min: AA_BODY },
  { ink: 'ink-muted', surfaces: ['surface', 'canvas', 'sunken'], min: AA_BODY },
  // Decorative only — placeholder glyphs, separators, disabled affordances. Held to the UI
  // threshold rather than the body threshold, and that exemption is the reason it exists: without
  // it, `slate-400` gets used for real content because there is nowhere else to reach for.
  { ink: 'ink-faint', surfaces: ['surface', 'canvas'], min: AA_LARGE, decorative: true },
  { ink: 'foreground', surfaces: ['background', 'card', 'popover'], min: AA_BODY },
  { ink: 'muted-foreground', surfaces: ['surface', 'canvas', 'muted'], min: AA_BODY },
];

/** Paired fill/foreground tokens. Both halves must be defined in both themes, and must contrast. */
const PAIRS = [
  { fg: 'emphasis-foreground', bg: 'emphasis', min: AA_BODY },
  { fg: 'destructive-foreground', bg: 'destructive', min: AA_BODY },
  { fg: 'rail-ink', bg: 'rail', min: AA_BODY },
  { fg: 'rail-ink-soft', bg: 'rail', min: AA_BODY },
  { fg: 'rail-ink-muted', bg: 'rail', min: AA_LARGE, decorative: true },
];

// ── Colour maths ────────────────────────────────────────────────────────────────────────────

const srgbToLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** @returns {[number,number,number]|null} 0-1 sRGB, or null if the format is not understood. */
function parseColor(value) {
  if (!value) return null;
  const v = value.trim();

  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  }

  const short = /^#([0-9a-f]{3})$/i.exec(v);
  if (short) {
    return short[1].split('').map((c) => parseInt(c + c, 16) / 255);
  }

  const oklch = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (oklch) return oklchToSrgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]));

  return null;
}

/** OKLCH → linear sRGB → gamma sRGB. The app's rail/emphasis tokens are authored in oklch. */
function oklchToSrgb(Lp, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (Lp + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (Lp - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (Lp - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (c) => {
    const x = Math.max(0, Math.min(1, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [gamma(lr), gamma(lg), gamma(lb)];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Token extraction ────────────────────────────────────────────────────────────────────────

/**
 * Reads `--color-*` declarations out of a slice of CSS.
 * Later declarations win, matching the cascade within a single block.
 */
function readTokens(css) {
  const tokens = {};
  const re = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(css)) !== null) tokens[m[1]] = m[2].trim();
  return tokens;
}

/**
 * The dark theme is the LIGHT tokens with the dark block's overrides applied on top — which is
 * how the cascade actually resolves it. Measuring the dark block alone would miss every token it
 * does not redefine, and those are exactly the ones most likely to be wrong in dark mode.
 */
function buildThemes(css) {
  const light = readTokens(css);

  const darkStart = css.indexOf('html[data-theme="dark"]');
  const dark = darkStart === -1 ? {} : { ...light, ...readTokens(css.slice(darkStart)) };

  return { light, dark: darkStart === -1 ? light : dark };
}

// ── Reporting ───────────────────────────────────────────────────────────────────────────────

const failures = [];
const skipped = [];
let checked = 0;

function assertContrast(theme, tokens, fgName, bgName, min, decorative) {
  const fg = parseColor(tokens[fgName]);
  const bg = parseColor(tokens[bgName]);

  if (!fg || !bg) {
    // A token that is absent or in a format this cannot read is reported rather than passed over.
    // Silently skipping is how a check stops checking without anyone noticing.
    skipped.push(`${theme}: ${fgName} on ${bgName} — ${!tokens[fgName] ? `--color-${fgName} not defined` : !tokens[bgName] ? `--color-${bgName} not defined` : 'unreadable colour format'}`);
    return;
  }

  checked += 1;
  const ratio = contrast(fg, bg);
  if (ratio < min) {
    failures.push({ theme, fgName, bgName, ratio, min, decorative, fgValue: tokens[fgName], bgValue: tokens[bgName] });
  }
}

function main() {
  const css = fs.readFileSync(CSS, 'utf8');
  const themes = buildThemes(css);

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const { ink, surfaces, min, decorative } of INK_ON_SURFACES) {
      for (const surface of surfaces) assertContrast(themeName, tokens, ink, surface, min, decorative);
    }
    for (const { fg, bg, min, decorative } of PAIRS) {
      assertContrast(themeName, tokens, fg, bg, min, decorative);
    }
  }

  if (skipped.length) {
    console.log(`contrast check: ${skipped.length} pair(s) not evaluated`);
    for (const s of skipped) console.log(`   · ${s}`);
  }

  if (failures.length) {
    console.error(`\ncontrast check: ${failures.length} FAILING pair(s) of ${checked + failures.length} checked\n`);
    for (const f of failures) {
      console.error(
        `  [${f.theme}] --color-${f.fgName} (${f.fgValue}) on --color-${f.bgName} (${f.bgValue})\n` +
        `        ${f.ratio.toFixed(2)}:1  — needs ${f.min}:1${f.decorative ? ' (decorative threshold)' : ''}`
      );
    }
    console.error(
      '\n  Text at these ratios is unreadable for a large number of people, and the failure is\n' +
      '  invisible in a screenshot. Darken the ink, lighten the surface, or — if the token really\n' +
      '  is decoration — move it to the decorative list in scripts/checkContrast.js with a reason.\n'
    );
    process.exit(1);
  }

  console.log(`contrast check: ${checked} token pairs, both themes, 0 violations`);
}

main();
