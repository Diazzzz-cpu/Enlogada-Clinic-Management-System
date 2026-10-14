import { printElement } from './printArea';

/**
 * Printing a report on A4. [1.117.0] The document itself is components/reports/ReportDocument.jsx;
 * these are the helpers it and the tabs share, kept out of the component file so Vite's fast
 * refresh still works there.
 */

const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return new Date(y, m - 1, d);
};

/** "2026-10-09" -> "October 9, 2026", read as a LOCAL calendar date (never through UTC). */
export const dayLabel = (value) => {
  const date = parseDay(value);
  return date
    ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : String(value || '');
};

/**
 * A period short enough for the foot of a page: "Oct 9 to Oct 15, 2026", or with both years when
 * it spans a new year, or one date when it is one day. [1.118.0]
 */
export const periodShort = (startDate, endDate) => {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (!start || !end) return [startDate, endDate].filter(Boolean).join(' to ');
  const md = { month: 'short', day: 'numeric' };
  const mdy = { ...md, year: 'numeric' };
  if (start.getTime() === end.getTime()) return start.toLocaleDateString('en-US', mdy);
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.toLocaleDateString('en-US', md)} to ${end.toLocaleDateString('en-US', mdy)}`;
  }
  return `${start.toLocaleDateString('en-US', mdy)} to ${end.toLocaleDateString('en-US', mdy)}`;
};

/** What the foot of every page says, beside "Page N of M". [1.118.0] */
export const pageFooter = ({ clinicName, title, startDate, endDate }) =>
  [clinicName, title, periodShort(startDate, endDate), 'Confidential'].filter(Boolean).join('  ·  ');

/** A CSS string literal, for `content:`. Quotes and backslashes escaped, line breaks flattened. */
export const cssString = (text) =>
  `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

const FOOTER_STYLE_ID = 'report-page-footer';

/**
 * Print a report document on A4 (`@page document` in index.css).
 *
 * The page footer names the report on every sheet, so a page separated from the others still says
 * what it is. CSS cannot read that from the document (`string-set` is not in Chrome), so it is
 * written into a style rule for the length of the print and removed after, even if the dialog was
 * cancelled. The rule in index.css stays as the fallback.
 */
export const printReport = (node) => {
  const footer = node?.dataset?.footer;
  let style = null;
  if (footer) {
    document.getElementById(FOOTER_STYLE_ID)?.remove();
    style = document.createElement('style');
    style.id = FOOTER_STYLE_ID;
    style.textContent = `@page document { @bottom-left { content: ${cssString(footer)}; font-size: 7.5pt; color: #444; } }`;
    document.head.appendChild(style);
  }
  try {
    printElement(node, 'printing-document');
  } finally {
    style?.remove();
  }
};
