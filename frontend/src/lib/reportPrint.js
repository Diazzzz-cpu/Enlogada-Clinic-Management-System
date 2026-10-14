import { printElement } from './printArea';

/**
 * Printing a report on A4. [1.117.0] The document itself is components/reports/ReportDocument.jsx;
 * these are the two helpers it and the tabs share, kept out of the component file so Vite's fast
 * refresh still works there.
 */

/** "2026-10-09" -> "October 9, 2026", read as a LOCAL calendar date (never through UTC). */
export const dayLabel = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value || '');
  const [, y, m, d] = match.map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/** Print a report document on A4 (`@page document` in index.css). */
export const printReport = (node) => printElement(node, 'printing-document');
