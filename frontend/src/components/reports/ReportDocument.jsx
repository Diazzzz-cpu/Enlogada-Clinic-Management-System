import React, { forwardRef } from 'react';
import { useClinic } from '../../lib/clinic';
import { useAuth } from '../../contexts/AuthContext';
import { dayLabel, pageFooter } from '../../lib/reportPrint';

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
 *   - a signature block: "Prepared by", the person who printed it, and "Noted by", the clinic's
 *     proprietor (`reportNotedBy`, Jesie B. Enlogada unless CLINIC_REPORT_NOTED_BY says otherwise),
 *     each a line to sign on over the printed name and title [1.118.0];
 *   - at the foot of every page the clinic, the report, its period and "Confidential", with
 *     "Page N of M" opposite (`pageFooter`, written into `@page document` while it prints).
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
  const generated = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const footer = pageFooter({ clinicName: clinic.name, title, startDate, endDate });

  return (
    <div ref={ref} className="report-doc print-area hidden print:block" data-testid="report-document" data-footer={footer}>
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
        <Signatory label="Prepared by" name={preparedBy} title={role} />
        <Signatory label="Noted by" name={clinic.reportNotedBy} title={clinic.reportNotedByTitle} />
      </footer>
    </div>
  );
});

/** One signature: what it is, a line to sign on, and the printed name and title beneath it. */
const Signatory = ({ label, name, title }) => (
  <div className="report-doc__signatory" data-signatory>
    <p className="report-doc__sign-label">{label}:</p>
    <span className="report-doc__line" aria-hidden="true" />
    <p className="report-doc__sign-name">{name}</p>
    {title && <p className="report-doc__sign-title">{title}</p>}
  </div>
);

/** A numbered section: "1. Takings", with an optional line saying what it counts. */
export const ReportSection = ({ number, title, note, children }) => (
  <section className="report-doc__section">
    <h2>{number ? `${number}. ` : ''}{title}</h2>
    {note && <p className="report-doc__note">{note}</p>}
    {children}
  </section>
);

/** Two sections side by side, for tables too narrow to deserve the width of the page. [1.119.0] */
export const ReportColumns = ({ children }) => <div className="report-doc__columns">{children}</div>;

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
