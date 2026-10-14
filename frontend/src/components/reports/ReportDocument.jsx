import React, { forwardRef } from 'react';
import { useClinic } from '../../lib/clinic';
import { useAuth } from '../../contexts/AuthContext';
import { dayLabel } from '../../lib/reportPrint';

/**
 * The printed form of a report. [1.117.0]
 *
 * Every Reports tab used to print its own SCREEN: the date pickers' panel chrome, coloured tiles, a
 * chart sized for a monitor, and on Departments no title at all. The tables carried
 * `break-inside: avoid`, so a long one jumped whole to the next sheet and left most of the first
 * one blank, and a wide one ran off the right edge of the paper. Nothing on the sheet said which
 * clinic, which report, which dates, or who printed it.
 *
 * This is the one format all four tabs print in, built from the same figures the screen shows:
 *
 *   - the clinic's letterhead, then the report's title, its period, when it was generated and by
 *     whom (`useClinic`, `useAuth`), so a sheet found in a drawer says what it is;
 *   - numbered sections of plain bordered tables, with a total row where the column adds up;
 *   - figures as TABLES, not charts. A clinic printer is usually black and white, and the charts'
 *     two series are told apart by colour, which a grey printout throws away;
 *   - a signature block, "Prepared by" with the printed name and "Noted by" left blank, because a
 *     printed report is usually handed to someone to sign;
 *   - page numbers in the page margin (`@page document` in index.css).
 *
 * Hidden on screen (`hidden print:block`) and printed through `printReport` (lib/reportPrint.js), which isolates it
 * with lib/printArea.js and selects the A4 page. Styled by `.report-doc` in index.css in points,
 * not rem: paper does not follow the reader's text-size setting, and a printed report should come
 * out the same whoever presses Print.
 */

export const ReportDocument = forwardRef(function ReportDocument({ title, startDate, endDate, scope, children }, ref) {
  const clinic = useClinic();
  const { user } = useAuth();
  const preparedBy = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const role = (user?.roles || []).join(', ');
  const generated = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return (
    <div ref={ref} className="report-doc print-area hidden print:block" data-testid="report-document">
      <header className="report-doc__letterhead">
        <p className="report-doc__clinic">{clinic.name}</p>
        {clinic.services && <p className="report-doc__services">{clinic.services}</p>}
        <p className="report-doc__contact">{clinic.address}</p>
        <p className="report-doc__contact">
          {[clinic.phone, clinic.email].filter(Boolean).join('  ·  ')}
        </p>
      </header>

      <h1 className="report-doc__title">{title}</h1>
      <table className="report-doc__meta">
        <tbody>
          <tr>
            <th scope="row">Period</th>
            <td>{startDate === endDate ? dayLabel(startDate) : `${dayLabel(startDate)} to ${dayLabel(endDate)}`}</td>
            <th scope="row">Generated</th>
            <td>{generated}</td>
          </tr>
          <tr>
            <th scope="row">Prepared by</th>
            <td>{preparedBy}{role ? ` (${role})` : ''}</td>
            <th scope="row">Covers</th>
            <td>{scope || 'All departments'}</td>
          </tr>
        </tbody>
      </table>

      {children}

      <footer className="report-doc__sign">
        <div>
          <span className="report-doc__line">{preparedBy}</span>
          <span className="report-doc__caption">Prepared by (signature over printed name)</span>
        </div>
        <div>
          <span className="report-doc__line" />
          <span className="report-doc__caption">Noted by (signature over printed name)</span>
        </div>
      </footer>
    </div>
  );
});

/** A numbered section: "1. Takings", with an optional line saying what it counts. */
export const ReportSection = ({ number, title, note, children }) => (
  <section className="report-doc__section">
    <h2>{number ? `${number}. ` : ''}{title}</h2>
    {note && <p className="report-doc__note">{note}</p>}
    {children}
  </section>
);

/** Headline figures, label beside value, two pairs to a row. */
export const ReportFigures = ({ items }) => {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <table className="report-doc__figures">
      <tbody>
        {rows.map((pair, i) => (
          <tr key={i}>
            {pair.map(({ label, value }) => (
              <React.Fragment key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </React.Fragment>
            ))}
            {pair.length === 1 && <><th aria-hidden="true" /><td aria-hidden="true" /></>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * A plain table. `columns` is `[{ key, label, align?, render? }]`; `total` is one row of the same
 * keys, printed bold under a rule. A table may run onto the next sheet; its header repeats there.
 */
export const ReportTable = ({ columns, rows, total, empty = 'Nothing in this period.' }) => {
  if (!rows.length) return <p className="report-doc__empty">{empty}</p>;
  const cell = (col, row) => (col.render ? col.render(row) : row[col.key]);
  return (
    <table className="report-doc__table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={col.align === 'right' ? 'is-num' : undefined}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={col.key} className={col.align === 'right' ? 'is-num' : undefined}>{cell(col, row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr>
            {columns.map((col) => (
              <td key={col.key} className={col.align === 'right' ? 'is-num' : undefined}>{total[col.key] ?? ''}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
};

export default ReportDocument;
