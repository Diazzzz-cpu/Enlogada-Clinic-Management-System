const { buildXlsx } = require('./xlsxWriter');

/**
 * What each report puts in its Excel file. [1.119.0]
 *
 * Laid out like the printed report (frontend/src/components/reports/ReportPrints.jsx): the same
 * sections, in the same order, under the same names, so the file and the sheet of paper can be
 * read against each other. Presentation only, like reportCsv.js: the service has already decided
 * what the caller may see, and a slice it left out is left out here too.
 *
 * Departments is takings and sales only. [1.119.0] Front desk throughput and turnaround were in it;
 * Steven: a department report does not need them, and every section printed is paper. They are
 * still measured, on Today (turnaround) and Visit History (the front desk).
 */

const DEFAULT_CLINIC = 'Enlogada Ultrasound & Diagnostic Clinic';
const clinicName = () => (process.env.CLINIC_NAME || '').trim() || DEFAULT_CLINIC;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "2026-10-09" -> "October 9, 2026", as written, never through UTC. */
const dayLabel = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(value || '');
};
const periodLabel = (start, end) => (start === end ? dayLabel(start) : `${dayLabel(start)} to ${dayLabel(end)}`);
const shortDay = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${Number(m[3])}, ${m[1]}` : String(value || '');
};

const generated = () => new Date().toLocaleString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const hourLabel = (hour) => {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
};

const num = (v) => Number(v) || 0;

/** The workbook every report shares: clinic, title, period, generated, then its sections. */
function workbook(title, startDate, endDate, sections, extraMeta = []) {
  const clinic = clinicName();
  const blocks = [];
  sections.forEach((section, i) => {
    blocks.push({ type: 'section', title: `${i + 1}. ${section.title}` });
    if (section.note) blocks.push({ type: 'note', text: section.note });
    blocks.push(...section.blocks);
  });
  return buildXlsx({
    clinic,
    title,
    sheetName: title.replace(/ Report$/, ''),
    meta: [
      ['Period', periodLabel(startDate, endDate)],
      ['Generated', generated()],
      ...extraMeta,
    ],
    blocks,
    footer: [clinic, title, `${shortDay(startDate)} to ${shortDay(endDate)}`, 'Confidential'].join('  ·  '),
  });
}

/** Departments: what was taken, and what was sold. */
function operationsXlsx(report, startDate, endDate) {
  const sections = [];
  if (report.billing) {
    const t = report.billing.totals || {};
    const receipts = num(t.receipts);
    const items = [
      { label: 'Collected', value: t.collected, kind: 'money' },
      { label: 'Receipts', value: receipts, kind: 'int' },
      { label: 'Average receipt', value: receipts > 0 ? num(t.collected) / receipts : 0, kind: 'money' },
      { label: 'Discounts given', value: t.discounts, kind: 'money' },
      { label: 'VAT exempted', value: t.vat_exempted, kind: 'money' },
    ];
    if (num(t.refunded) > 0) {
      items.push({ label: 'Refunded', value: t.refunded, kind: 'money' });
      items.push({ label: 'Reversals', value: t.refunds, kind: 'int' });
    }
    sections.push({ title: 'Takings', blocks: [{ type: 'pairs', items }] });
    sections.push({
      title: 'Sales by service',
      note: 'Net is after discounts.',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'test_name', header: 'Service', kind: 'text' },
          { key: 'category_name', header: 'Department', kind: 'text' },
          { key: 'sold', header: 'Sold', kind: 'int' },
          { key: 'gross', header: 'Gross', kind: 'money' },
          { key: 'net', header: 'Net', kind: 'money' },
        ],
        rows: report.billing.byService || [],
        total: { label: 'Total', sum: ['sold', 'gross', 'net'] },
        empty: 'Nothing was sold in this period.',
      }],
    });
  }
  if (!sections.length) {
    sections.push({ title: 'Takings', blocks: [{ type: 'note', text: 'This account may not see the takings.' }] });
  }
  return workbook('Departments Report', startDate, endDate, sections);
}

/** Trends: takings by day and by method, tests by department, visits by status, arrivals, in the printed order. */
function summaryXlsx(report, startDate, endDate) {
  const statuses = report.visitStatusBreakdown || [];
  const totalVisits = statuses.reduce((s, r) => s + num(r.visit_count), 0);
  const sections = [
    {
      title: 'Takings by day',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'day', header: 'Day', kind: 'date' },
          { key: 'total', header: 'Collected', kind: 'money' },
        ],
        rows: report.revenueTrend || [],
        total: { label: 'Total', sum: ['total'] },
        empty: 'No payment was taken in this period.',
      }],
    },
    {
      title: 'Payments by method',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'payment_method', header: 'Method', kind: 'text' },
          { key: 'payment_count', header: 'Payments', kind: 'int' },
          { key: 'total', header: 'Amount', kind: 'money' },
        ],
        rows: report.paymentMethodBreakdown || [],
        total: { label: 'Total', sum: ['payment_count', 'total'] },
        empty: 'No payment in this period.',
      }],
    },
    {
      title: 'Tests by department',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'category_name', header: 'Department', kind: 'text' },
          { key: 'test_count', header: 'Tests', kind: 'int' },
        ],
        rows: report.serviceVolume || [],
        total: { label: 'Total', sum: ['test_count'] },
        empty: 'No test was recorded in this period.',
      }],
    },
    {
      title: 'Visits by status',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'status', header: 'Status', kind: 'text' },
          { key: 'visit_count', header: 'Visits', kind: 'int' },
          { key: 'share', header: 'Share', kind: 'percent', value: (r) => (totalVisits > 0 ? num(r.visit_count) / totalVisits : null) },
        ],
        rows: statuses,
        total: { label: 'Total', sum: ['visit_count'], values: { share: totalVisits > 0 ? 1 : null } },
        empty: 'No visit in this period.',
      }],
    },
  ];
  if (report.hourlyArrivals) {
    sections.push({
      title: 'Arrivals by hour',
      note: 'When patients arrived, walk-in against booked, over the whole period.',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'hour', header: 'Hour', kind: 'text', value: (r) => hourLabel(r.hour) },
          { key: 'walk_in', header: 'Walk-in', kind: 'int' },
          { key: 'online', header: 'Booked', kind: 'int' },
          { key: 'total', header: 'Total', kind: 'int' },
        ],
        rows: report.hourlyArrivals,
        total: { label: 'Total', sum: ['walk_in', 'online', 'total'] },
        empty: 'No arrival in this period.',
      }],
    });
  }
  return workbook('Trends Report', startDate, endDate, sections);
}

/** HMO Claims: what is owed, by provider, never added to the takings. */
function hmoClaimsXlsx(report, startDate, endDate) {
  const t = report.totals || {};
  return workbook('HMO Claims Report', startDate, endDate, [
    {
      title: 'Summary',
      note: report.note || 'Approved is money still owed to the clinic, billed to the provider and settled outside this system. Only Paid at the counter is in the cash-up. Do not add the two together.',
      blocks: [{
        type: 'pairs',
        items: [
          { label: 'Approved (receivable)', value: t.approved, kind: 'money' },
          { label: 'Awaiting decision', value: t.pending, kind: 'money' },
          { label: 'Refused', value: t.refused, kind: 'money' },
          { label: 'Paid at the counter', value: t.collected, kind: 'money' },
        ],
      }],
    },
    {
      title: 'By provider',
      note: 'Counted on the date of the visit the claim was raised on.',
      blocks: [{
        type: 'table',
        columns: [
          { key: 'provider_name', header: 'Provider', kind: 'text' },
          { key: 'visits', header: 'Visits', kind: 'int' },
          { key: 'tests_claimed', header: 'Tests', kind: 'int' },
          { key: 'approved', header: 'Approved', kind: 'money' },
          { key: 'pending', header: 'Pending', kind: 'money' },
          { key: 'refused', header: 'Refused', kind: 'money' },
          { key: 'collected', header: 'At counter', kind: 'money' },
        ],
        rows: report.providers || [],
        total: { label: 'Total', sum: ['visits', 'tests_claimed', 'approved', 'pending', 'refused', 'collected'] },
        empty: 'No HMO claim in this period.',
      }],
    },
  ]);
}

/** Staff Workload: visits opened at the desk, and reports released, per person. */
function staffWorkloadXlsx(report, startDate, endDate) {
  const name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
  const released = [...(report.diagnosticWorkload || [])]
    .sort((a, b) => name(a).localeCompare(name(b)) || String(a.category_name).localeCompare(String(b.category_name)));
  return workbook('Staff Workload Report', startDate, endDate, [
    {
      title: 'Front desk: visits opened',
      note: "Walk-ins and bookings made at the desk. A patient's own online booking is not counted.",
      blocks: [{
        type: 'table',
        columns: [
          { key: 'name', header: 'Staff', kind: 'text', value: name },
          { key: 'visit_count', header: 'Visits', kind: 'int' },
        ],
        rows: report.receptionWorkload || [],
        total: { label: 'Total', sum: ['visit_count'] },
        empty: 'No visit was opened in this period.',
      }],
    },
    {
      title: 'Departments: reports released',
      note: "Each test's report counted once, credited to who released it.",
      blocks: [{
        type: 'table',
        columns: [
          { key: 'name', header: 'Staff', kind: 'text', value: name },
          { key: 'category_name', header: 'Department', kind: 'text' },
          { key: 'result_count', header: 'Released', kind: 'int' },
        ],
        rows: released,
        total: { label: 'Total', sum: ['result_count'] },
        empty: 'No report was released in this period.',
      }],
    },
  ]);
}

module.exports = { operationsXlsx, summaryXlsx, hmoClaimsXlsx, staffWorkloadXlsx, dayLabel, hourLabel };
