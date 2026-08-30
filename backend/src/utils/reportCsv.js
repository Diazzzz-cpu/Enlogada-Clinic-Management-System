/**
 * The CSV shape of each report. [1.62.0]
 *
 * Separated from `reportController` so the controller keeps doing one thing — decide the format,
 * call one service, send the response — and from `csvExport.js`, which knows how to serialise a
 * table but nothing about this clinic. Everything here is presentation: column order, header
 * wording, which figures belong in which block. No business logic, no queries, no permission
 * decisions; the service has already made all three by the time these functions see a report.
 *
 * ── Headers are written for a person, not for the database ──────────────────────────────────
 *
 * `median_turnaround_minutes` becomes "Median Turnaround (mins)". The clinic files these; a
 * column called `avg_wait_minutes` in a document going to an accountant or a panel is an
 * implementation detail escaping into the world. Naming them explicitly also pins them: a
 * spreadsheet reconciled against last month's export breaks the moment column names move on
 * their own, so the mapping is stated rather than derived from `Object.keys`.
 *
 * ── The caveat travels with the numbers ─────────────────────────────────────────────────────
 *
 * `getHmoClaims` returns a `note` saying that an approved claim is a receivable and not counter
 * takings, precisely so the warning survives being copied into a summary. A CSV is the most
 * likely thing anyone copies it into, so the note is written into the file's own header block —
 * not dropped because it is prose in a table of numbers.
 */

const { toCsvSections, formatters: f } = require('./csvExport');

const decimal1 = f.decimal(1);

// ── Column sets ─────────────────────────────────────────────────────────────────────────────

const REVENUE_TREND = [
  { key: 'day', header: 'Date', format: f.date },
  { key: 'total', header: 'Collected (PHP)', format: f.money },
];

const SERVICE_VOLUME = [
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'test_count', header: 'Tests Performed', format: f.integer },
];

const VISIT_STATUS = [
  { key: 'status', header: 'Visit Status', format: f.text },
  { key: 'visit_count', header: 'Visits', format: f.integer },
];

const PAYMENT_METHOD = [
  { key: 'payment_method', header: 'Payment Method', format: f.text },
  { key: 'payment_count', header: 'Receipts', format: f.integer },
  { key: 'total', header: 'Collected (PHP)', format: f.money },
];

const SALES_BY_SERVICE = [
  { key: 'test_name', header: 'Service', format: f.text },
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'sold', header: 'Sold', format: f.integer },
  { key: 'gross', header: 'Gross (PHP)', format: f.money },
  { key: 'net', header: 'Net of Discounts (PHP)', format: f.money },
];

const DIAGNOSTIC_THROUGHPUT = [
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'released', header: 'Reports Released', format: f.integer },
  { key: 'critical', header: 'Critical Results', format: f.integer },
  { key: 'amended', header: 'Amended Reports', format: f.integer },
  { key: 'avg_turnaround_minutes', header: 'Average Turnaround (mins)', format: f.integer },
  { key: 'median_turnaround_minutes', header: 'Median Turnaround (mins)', format: f.integer },
];

const OUTSTANDING_WORK = [
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'awaiting_exam', header: 'Awaiting Examination', format: f.integer },
  { key: 'awaiting_release', header: 'Awaiting Release', format: f.integer },
];

const HMO_PROVIDERS = [
  { key: 'provider_name', header: 'HMO Provider', format: f.text },
  { key: 'visits', header: 'Visits', format: f.integer },
  { key: 'tests_claimed', header: 'Tests Claimed', format: f.integer },
  { key: 'approved', header: 'Approved / Billable (PHP)', format: f.money },
  { key: 'pending', header: 'Pending Decision (PHP)', format: f.money },
  { key: 'refused', header: 'Refused / Patient Pays (PHP)', format: f.money },
  { key: 'collected', header: 'Collected at Counter (PHP)', format: f.money },
];

const STAFF_RECEPTION = [
  { key: 'first_name', header: 'First Name', format: f.text },
  { key: 'last_name', header: 'Last Name', format: f.text },
  { key: 'visit_count', header: 'Visits Registered', format: f.integer },
];

const STAFF_DIAGNOSTIC = [
  { key: 'first_name', header: 'First Name', format: f.text },
  { key: 'last_name', header: 'Last Name', format: f.text },
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'result_count', header: 'Reports Released', format: f.integer },
];

const TURNAROUND_SLA = [
  { key: 'category_name', header: 'Department', format: f.text },
  { key: 'released', header: 'Reports Released', format: f.integer },
  { key: 'median_turnaround_minutes', header: 'Median Turnaround (mins)', format: f.integer },
  { key: 'p90_turnaround_minutes', header: '90th Percentile (mins)', format: f.integer },
  { key: 'target_minutes', header: 'Target SLA (mins)', format: f.integer },
  { key: 'within_target', header: 'Within Target', format: f.integer },
  { key: 'within_target_rate', header: 'Within Target (%)', format: decimal1 },
];

const HOURLY_ARRIVALS = [
  { key: 'hour', header: 'Hour (24h)', format: f.integer },
  { key: 'walk_in', header: 'Walk-in Arrivals', format: f.integer },
  { key: 'online', header: 'Online / Booked Arrivals', format: f.integer },
  { key: 'total', header: 'Total Arrivals', format: f.integer },
];

// ── Report builders ─────────────────────────────────────────────────────────────────────────

/** The two lines every export opens with, so a file found later can say what it is. */
const rangeMeta = (title, startDate, endDate) => ([
  ['Report', title],
  ['Period', `${startDate} to ${endDate}`],
  ['Clinic', 'Enlogada Ultrasound and Diagnostic Clinic'],
]);

function summaryCsv(report, startDate, endDate) {
  return toCsvSections([
    { title: 'Revenue Trend', rows: report.revenueTrend, columns: REVENUE_TREND },
    { title: 'Service Volume by Department', rows: report.serviceVolume, columns: SERVICE_VOLUME },
    { title: 'Visits by Status', rows: report.visitStatusBreakdown, columns: VISIT_STATUS },
    { title: 'Collections by Payment Method', rows: report.paymentMethodBreakdown, columns: PAYMENT_METHOD },
  ], rangeMeta('Clinic Summary', startDate, endDate));
}

/**
 * The operations report is assembled from whichever slices the caller was entitled to, so the
 * sections are built conditionally and in the same order the screen shows them.
 *
 * A slice the caller may not see is ABSENT from the file, exactly as it is absent from the JSON.
 * Writing an empty "Takings" block instead would tell a diagnostic technician that the clinic
 * collected nothing, which is worse than not mentioning money at all — the same reasoning the
 * service gives for omitting rather than zeroing.
 */
function operationsCsv(report, startDate, endDate) {
  const sections = [];

  if (report.billing) {
    const t = report.billing.totals || {};
    sections.push({
      title: 'Takings',
      pairs: [
        ['Receipts Issued', f.integer(t.receipts)],
        ['Collected (PHP)', f.money(t.collected)],
        ['Discounts Granted (PHP)', f.money(t.discounts)],
        ['VAT Exempted (PHP)', f.money(t.vat_exempted)],
        ['Reversals', f.integer(t.refunds)],
        ['Reversed (PHP)', f.money(t.refunded)],
        // Stated rather than left to the reader: `reversed` is reported beside `collected` and
        // never netted off it, so anyone who wants the net has to be told which subtraction is
        // the intended one. Naming it here stops somebody inventing a different arithmetic.
        ['Net of Reversals (PHP)', f.money(Number(t.collected || 0) - Number(t.refunded || 0))],
      ],
    });
    sections.push({ title: 'Sales by Service', rows: report.billing.byService, columns: SALES_BY_SERVICE });
    sections.push({ title: 'Collections by Payment Method', rows: report.billing.byMethod, columns: PAYMENT_METHOD });
  }

  if (report.reception) {
    const r = report.reception;
    sections.push({
      title: 'Front Desk Throughput',
      pairs: [
        ['Visits', f.integer(r.visits)],
        ['Walk-ins', f.integer(r.walk_ins)],
        ['Appointments', f.integer(r.appointments)],
        ['Completed', f.integer(r.completed)],
        ['Cancelled', f.integer(r.cancelled)],
        ['Average Wait to Billing (mins)', f.integer(r.avg_wait_minutes)],
        ['Median Wait to Billing (mins)', f.integer(r.median_wait_minutes)],
      ],
    });
  }

  if (report.diagnostics) {
    sections.push({
      title: 'Department Turnaround',
      rows: report.diagnostics.byCategory,
      columns: DIAGNOSTIC_THROUGHPUT,
    });
    sections.push({
      title: 'Outstanding Work (as at export time, not the period)',
      rows: report.diagnostics.outstanding,
      columns: OUTSTANDING_WORK,
    });
  }

  return toCsvSections(sections, rangeMeta('Operations', startDate, endDate));
}

function hmoClaimsCsv(report, startDate, endDate) {
  const t = report.totals || {};
  return toCsvSections([
    { title: 'Claims by Provider', rows: report.providers, columns: HMO_PROVIDERS },
    {
      title: 'Totals',
      pairs: [
        ['Visits', f.integer(t.visits)],
        ['Tests Claimed', f.integer(t.testsClaimed)],
        ['Approved / Billable (PHP)', f.money(t.approved)],
        ['Pending Decision (PHP)', f.money(t.pending)],
        ['Refused / Patient Pays (PHP)', f.money(t.refused)],
        ['Collected at Counter (PHP)', f.money(t.collected)],
      ],
    },
  ], [
    ...rangeMeta('HMO Claims', startDate, endDate),
    // The one thing a reader of this file can get wrong, on its face rather than in a footnote.
    ['Note', report.note || 'Approved is billable to the insurer and is not part of counter takings.'],
  ]);
}

function staffWorkloadCsv(report, startDate, endDate) {
  return toCsvSections([
    { title: 'Check-ins by Reception Staff', rows: report.receptionWorkload, columns: STAFF_RECEPTION },
    { title: 'Reports Released by Diagnostic Staff', rows: report.diagnosticWorkload, columns: STAFF_DIAGNOSTIC },
  ], rangeMeta('Staff Workload', startDate, endDate));
}

/** [1.62.0] The two analytics datasets the BI dashboard added, exported alongside it. */
function analyticsCsv(report, startDate, endDate) {
  const sections = [];
  if (report.turnaroundSla) {
    sections.push({ title: 'Turnaround against Target', rows: report.turnaroundSla, columns: TURNAROUND_SLA });
  }
  if (report.hourlyArrivals) {
    sections.push({ title: 'Arrivals by Hour of Day', rows: report.hourlyArrivals, columns: HOURLY_ARRIVALS });
  }
  return toCsvSections(sections, rangeMeta('Clinic Analytics', startDate, endDate));
}

module.exports = {
  summaryCsv,
  operationsCsv,
  hmoClaimsCsv,
  staffWorkloadCsv,
  analyticsCsv,
};
