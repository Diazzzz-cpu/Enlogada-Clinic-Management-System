import { FlaskConical, Scan, Stethoscope } from 'lucide-react';
/**
 * One colour per diagnostic category, for the whole app. [1.28.0]
 *
 * These five categories were coloured twice, independently, and the two disagreed on every one
 * of them. The Service Volume chart had Laboratory green, Ultrasound blue, Xray amber and ECG
 * cyan; the public Services page had Laboratory teal, Ultrasound sage, Xray indigo and ECG amber.
 * A patient who browsed the services page and a manager who read the
 * report were looking at the same five things in two unrelated colour schemes, and Xray was
 * amber in one place and indigo in the other.
 *
 * Colour follows the entity, never the context it appears in. That is what makes it worth
 * anything: if Laboratory is always this green, the reader learns it once.
 *
 * The hex values are the chart's, because that palette was the one chosen against the
 * constraints that matter for colour — a lightness band, a chroma floor, colourblind separation
 * between adjacent pairs, and contrast against the surface. It passes all of them. The tint
 * classes here are the pale companions for an icon tile, where the hex is the saturated mark.
 *
 * Matching is by substring rather than exact name because the categories arrive from the
 * database and have been written as both "Xray" and "X-Ray" in different places.
 */

// Saturated marks — bars, dots, anything the eye reads as the datum itself.
export const CATEGORY_COLORS = {
  Laboratory: '#53843b',   // brand green, the clinic's primary service
  Ultrasound: '#2563eb',   // chart-only blue; navy fails the categorical lightness check
  Xray: '#d97706',         // amber
  ECG: '#0891b2',          // cyan
};

// Anything not in the map above: a category added to the database after this was written should
// look deliberately unremarkable rather than borrow another category's colour.
export const UNMAPPED_CATEGORY_COLOR = '#94a3b8';

/**
 * The order categories are shown in, offered first and busiest first.
 *
 * A DISPLAY order, not a list of what exists. 'ECG' stays because its category row is still in the
 * database — a patient with a past ECG has to be able to filter to it. '2D Echo' is gone entirely
 * [1.50.0]: its category and tests were deleted once nothing referenced them.
 *
 * Anything reading this must decide from the DATA which of these to show. Hardcoding the array
 * itself into a filter is how the portal came to advertise services the clinic does not sell to
 * every patient who had never had one.
 */
export const CATEGORY_ORDER = ['Laboratory', 'Ultrasound', 'Xray', 'ECG'];

// Pale tile + saturated glyph, for an icon beside a heading. Kept as Tailwind classes rather
// than derived from the hex, because an opacity variant of the mark colour is exactly the
// "five different pale greens on one screen" problem the design notes warn about.
const CATEGORY_TINTS = {
  Laboratory: 'bg-brand-50 text-brand-700',
  Ultrasound: 'bg-blue-50 text-blue-700',
  Xray: 'bg-amber-50 text-amber-700',
  ECG: 'bg-cyan-50 text-cyan-700',
};

const UNMAPPED_TINT = 'bg-slate-100 text-slate-700';

/**
 * How a category is written on screen, where that differs from how the database spells it.
 *
 * One entry now, and it is earned: the column stores 'Xray' and a radiographer reads "X-Ray".
 * Anything not listed is already correct as stored — 'Ultrasound' used to be listed as
 * "Ultrasound (incl. 2D Echo)" and became a no-op mapping to itself when 2D Echo was removed
 * [1.50.0], so it is gone rather than left as an entry that says nothing.
 */
export const CATEGORY_LABELS = {
  Xray: 'X-Ray',
};

/**
 * The icon a department is recognised by on its own worklist.
 *
 * Beside the label rather than inside the diagnostic console, for the same reason: one place
 * that decides how a category presents itself. Laboratory is the fallback because it is the
 * department with no distinctive instrument to draw.
 */
export function categoryIcon(name) {
  if (name === 'Ultrasound') return Stethoscope;
  if (name === 'Xray') return Scan;
  return FlaskConical;
}

/** The display name for a category, falling back to whatever the database has. */
export function categoryLabel(name) {
  return CATEGORY_LABELS[name] || name;
}

/** The canonical key for a category name as the database happens to have spelled it. */
export function categoryKey(name = '') {
  const lower = String(name).toLowerCase();
  if (lower.includes('lab')) return 'Laboratory';
  if (lower.includes('ultra')) return 'Ultrasound';
  if (lower.includes('xray') || lower.includes('x-ray')) return 'Xray';
  if (lower.includes('ecg')) return 'ECG';
  return null;
}

/** The saturated mark colour for a category, for charts and any coloured datum. */
export function categoryColor(name) {
  return CATEGORY_COLORS[categoryKey(name)] || UNMAPPED_CATEGORY_COLOR;
}

/** The pale tile classes for a category icon. */
export function categoryTint(name) {
  return CATEGORY_TINTS[categoryKey(name)] || UNMAPPED_TINT;
}
