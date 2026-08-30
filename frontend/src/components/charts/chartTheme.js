/**
 * The chart palette, chosen by validation rather than by eye. [1.62.0]
 *
 * ── These two hues were checked, not picked ─────────────────────────────────────────────────
 *
 * `#53843b` (the logo's green) and `#0a71a9` (its azure) are the clinic's own two brand colours,
 * and they were run through a colour-blindness validator against BOTH theme surfaces before being
 * used as a categorical pair:
 *
 *   light surface  ΔE 18.7 protan · 19.2 normal vision — all checks pass
 *   dark  surface  ΔE 18.7 protan · 19.2 normal vision — all checks pass
 *
 * The obvious instinct — lighten both for dark mode, the way ink is lightened — was tested and
 * FAILS: `brand-400`/`azure-400` on the dark surface fall below the chroma floor and land at
 * ΔE 13.6 for normal vision, which is under the 15 threshold. Two series a fully-sighted reader
 * cannot reliably tell apart. So the same two steps are used in both themes, deliberately, and
 * that is a measured decision rather than an oversight.
 *
 * Tritan separation is 5.2, which is the weak axis for a green/blue pair. That is why every chart
 * using them ALSO carries a legend and a tooltip naming each series — colour is never the only
 * thing distinguishing them, which is what makes the pair legal at that separation.
 *
 * ── Sequential is one hue, two steps ────────────────────────────────────────────────────────
 *
 * Median and 90th-percentile turnaround are the same measurement at two points of one
 * distribution, not two different things. They therefore share a hue and differ in lightness —
 * a categorical pair there would imply they are independent quantities.
 *
 * ── The target line is deliberately NOT a status colour ─────────────────────────────────────
 *
 * Amber and red are reserved in this app for states that need acting on. A turnaround target is a
 * benchmark, and painting the reference line in a warning colour would say the target itself is a
 * problem. It is drawn in recessive slate, dashed, and named in the legend.
 */

/** The two-hue categorical pair. Fixed order — never cycled, never reassigned by rank. */
export const SERIES = {
  primary: '#53843b',   // brand-500, the logo's green
  secondary: '#0a71a9', // azure-500, the logo's azure
};

/** One hue, light to dark, for two points on the same distribution. */
export const SEQUENTIAL = {
  strong: '#53843b',  // brand-500 — the median, the headline figure
  soft: '#acc4a1',    // brand-300 — the 90th percentile, the tail behind it
};

/** Recessive furniture. Grid and axes must never compete with the data. */
export const AXIS = {
  grid: '#f1f5f9',
  tick: '#94a3b8',
  label: '#475569',
  reference: '#64748b',
};

/**
 * The gap between stacked segments.
 *
 * A hairline in the surface colour, so segments read as separate marks rather than as one bar
 * with a colour change partway up. `var(--color-surface)` rather than white: the panel behind
 * these charts is `#131c2b` in dark mode, and a white seam there would be a bright line drawn
 * across every bar.
 */
export const STACK_GAP = {
  stroke: 'var(--color-surface, #ffffff)',
  strokeWidth: 1.5,
};

/** Shared tooltip chrome, matching the two charts that predate these. */
export const TOOLTIP_CLASS =
  'bg-surface border border-line rounded-lg shadow-float px-3 py-2 text-xs';
