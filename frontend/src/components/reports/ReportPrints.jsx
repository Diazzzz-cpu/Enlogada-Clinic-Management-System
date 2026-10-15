import React, { forwardRef } from 'react';
import { ReportDocument, ReportSection, ReportFigures, ReportTable, ReportColumns } from './ReportDocument';
import { formatCurrency } from '../../lib/currency';
import { formatDate } from '../../lib/date';

/**
 * What each Reports tab puts on paper. [1.117.0]
 *
 * One component per tab, each given the figures its tab already fetched, so the sheet and the
 * screen cannot disagree. Sections are numbered in the order they print, and a slice the account
 * cannot see (the operations report omits takings for a laboratory account) is left out rather
 * than printed as zeroes.
 */

const num = (v) => Number(v) || 0;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hourLabel = (hour) => {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${h < 12 ? 'AM' : 'PM'}`;
};
const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** Departments: takings and sales by service. [1.119.0] No front desk or turnaround: see OperationsReport. */
export const OperationsPrint = forwardRef(function OperationsPrint({ report, startDate, endDate }, ref) {
  const sections = [];
  const billing = report?.billing;

  if (billing?.totals) {
    const t = billing.totals;
    const receipts = num(t.receipts);
    const items = [
      { label: 'Collected', value: formatCurrency(t.collected) },
      { label: 'Receipts', value: receipts },
      { label: 'Average receipt', value: formatCurrency(receipts > 0 ? num(t.collected) / receipts : 0) },
      { label: 'Discounts given', value: formatCurrency(t.discounts) },
      { label: 'VAT exempted', value: formatCurrency(t.vat_exempted) },
    ];
    if (num(t.refunded) > 0) items.push({ label: `Refunded (${plural(num(t.refunds), 'reversal')})`, value: formatCurrency(t.refunded) });
    sections.push({
      title: 'Takings',
      body: (
        <ReportFigures items={items} />
      ),
    });
  }

  if (billing?.byService) {
    const rows = billing.byService;
    sections.push({
      title: 'Sales by service',
      note: 'Net is after discounts.',
      body: (
        <ReportTable
          columns={[
            { key: 'test_name', label: 'Service' },
            { key: 'category_name', label: 'Department' },
            { key: 'sold', label: 'Sold', align: 'right' },
            { key: 'gross', label: 'Gross', align: 'right', render: (r) => formatCurrency(r.gross) },
            { key: 'net', label: 'Net', align: 'right', render: (r) => formatCurrency(r.net) },
          ]}
          rows={rows}
          total={{
            test_name: 'Total',
            sold: rows.reduce((s, r) => s + num(r.sold), 0),
            gross: formatCurrency(rows.reduce((s, r) => s + num(r.gross), 0)),
            net: formatCurrency(rows.reduce((s, r) => s + num(r.net), 0)),
          }}
          empty="Nothing was sold in this period."
        />
      ),
    });
  }

  return (
    <ReportDocument
      ref={ref}
      title="Departments Report"
      startDate={startDate}
      endDate={endDate}
    >
      {sections.map(({ title, note, body }, i) => (
        <ReportSection key={title} number={i + 1} title={title} note={note}>{body}</ReportSection>
      ))}
    </ReportDocument>
  );
});

/** Trends: money by day and by method, tests by department, visits by status, arrivals by hour. */
export const TrendsPrint = forwardRef(function TrendsPrint({ report, startDate, endDate }, ref) {
  const revenue = report?.revenueTrend || [];
  const volume = report?.serviceVolume || [];
  const statuses = report?.visitStatusBreakdown || [];
  const methods = report?.paymentMethodBreakdown || [];
  const hours = report?.hourlyArrivals || [];
  const totalVisits = statuses.reduce((s, r) => s + num(r.visit_count), 0);

  return (
    <ReportDocument ref={ref} title="Trends Report" startDate={startDate} endDate={endDate}>
      {/* Two narrow tables to a row: they are two or three columns wide, and a sheet of paper
          is not. [1.119.0] Side by side, the whole report fits on one page. */}
      <ReportColumns>
        <ReportSection number={1} title="Takings by day">
          <ReportTable
            columns={[
              { key: 'day', label: 'Day', render: (r) => formatDate(r.day) },
              { key: 'total', label: 'Collected', align: 'right', render: (r) => formatCurrency(r.total) },
            ]}
            rows={revenue}
            total={{ day: 'Total', total: formatCurrency(revenue.reduce((s, r) => s + num(r.total), 0)) }}
            empty="No payment was taken in this period."
          />
        </ReportSection>
        <ReportSection number={2} title="Payments by method">
          <ReportTable
            columns={[
              { key: 'payment_method', label: 'Method' },
              { key: 'payment_count', label: 'Payments', align: 'right' },
              { key: 'total', label: 'Amount', align: 'right', render: (r) => formatCurrency(r.total) },
            ]}
            rows={methods}
            total={{
              payment_method: 'Total',
              payment_count: methods.reduce((s, r) => s + num(r.payment_count), 0),
              total: formatCurrency(methods.reduce((s, r) => s + num(r.total), 0)),
            }}
            empty="No payment in this period."
          />
        </ReportSection>
      </ReportColumns>

      <ReportColumns>
        <ReportSection number={3} title="Tests by department">
          <ReportTable
            columns={[
              { key: 'category_name', label: 'Department' },
              { key: 'test_count', label: 'Tests', align: 'right' },
            ]}
            rows={volume}
            total={{ category_name: 'Total', test_count: volume.reduce((s, r) => s + num(r.test_count), 0) }}
            empty="No test was recorded in this period."
          />
        </ReportSection>
        <ReportSection number={4} title="Visits by status">
          <ReportTable
            columns={[
              { key: 'status', label: 'Status' },
              { key: 'visit_count', label: 'Visits', align: 'right' },
              { key: 'share', label: 'Share', align: 'right', render: (r) => percent(num(r.visit_count), totalVisits) },
            ]}
            rows={statuses}
            total={{ status: 'Total', visit_count: totalVisits, share: totalVisits > 0 ? '100%' : '' }}
            empty="No visit in this period."
          />
        </ReportSection>
      </ReportColumns>

      <ReportSection number={5} title="Arrivals by hour" note="When patients arrived, walk-in against booked, over the whole period.">
        <ReportTable
          columns={[
            { key: 'hour', label: 'Hour', render: (r) => hourLabel(r.hour) },
            { key: 'walk_in', label: 'Walk-in', align: 'right' },
            { key: 'online', label: 'Booked', align: 'right' },
            { key: 'total', label: 'Total', align: 'right' },
          ]}
          rows={hours}
          total={{
            hour: 'Total',
            walk_in: hours.reduce((s, r) => s + num(r.walk_in), 0),
            online: hours.reduce((s, r) => s + num(r.online), 0),
            total: hours.reduce((s, r) => s + num(r.total), 0),
          }}
          empty="No arrival in this period."
        />
      </ReportSection>
    </ReportDocument>
  );
});

/** HMO Claims: what each provider owes, decided and undecided, beside what was paid at the counter. */
export const HmoClaimsPrint = forwardRef(function HmoClaimsPrint({ report, startDate, endDate }, ref) {
  const t = report?.totals || {};
  const providers = report?.providers || [];
  return (
    <ReportDocument ref={ref} title="HMO Claims Report" startDate={startDate} endDate={endDate}>
      <ReportSection
        number={1}
        title="Summary"
        note="Approved is money still owed to the clinic, billed to the provider and settled outside this system. Only Paid at the counter is in the cash-up. Do not add the two together."
      >
        <ReportFigures items={[
          { label: 'Approved (receivable)', value: formatCurrency(t.approved) },
          { label: 'Awaiting decision', value: formatCurrency(t.pending) },
          { label: 'Refused', value: formatCurrency(t.refused) },
          { label: 'Paid at the counter', value: formatCurrency(t.collected) },
        ]} />
      </ReportSection>

      <ReportSection number={2} title="By provider" note="Counted on the date of the visit the claim was raised on.">
        <ReportTable
          columns={[
            { key: 'provider_name', label: 'Provider' },
            { key: 'visits', label: 'Visits', align: 'right' },
            { key: 'tests_claimed', label: 'Tests', align: 'right' },
            { key: 'approved', label: 'Approved', align: 'right', render: (r) => formatCurrency(r.approved) },
            { key: 'pending', label: 'Pending', align: 'right', render: (r) => formatCurrency(r.pending) },
            { key: 'refused', label: 'Refused', align: 'right', render: (r) => formatCurrency(r.refused) },
            { key: 'collected', label: 'At counter', align: 'right', render: (r) => formatCurrency(r.collected) },
          ]}
          rows={providers}
          total={{
            provider_name: 'Total',
            visits: providers.reduce((s, r) => s + num(r.visits), 0),
            tests_claimed: providers.reduce((s, r) => s + num(r.tests_claimed), 0),
            approved: formatCurrency(t.approved),
            pending: formatCurrency(t.pending),
            refused: formatCurrency(t.refused),
            collected: formatCurrency(t.collected),
          }}
          empty="No HMO claim in this period."
        />
      </ReportSection>
    </ReportDocument>
  );
});

/** Staff Workload: check-ins at the desk, and reports released per person and department. */
export const WorkloadPrint = forwardRef(function WorkloadPrint({ reception, diagnostic, startDate, endDate }, ref) {
  const name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
  return (
    <ReportDocument ref={ref} title="Staff Workload Report" startDate={startDate} endDate={endDate}>
      <ReportSection number={1} title="Front desk: visits opened" note="Visits each member of staff opened: walk-ins and bookings made at the desk. A patient's own online booking is not counted.">
        <ReportTable
          columns={[
            { key: 'name', label: 'Staff', render: name },
            { key: 'visit_count', label: 'Visits', align: 'right' },
          ]}
          rows={reception}
          total={{ name: 'Total', visit_count: reception.reduce((s, r) => s + num(r.visit_count), 0) }}
          empty="No visit was opened in this period."
        />
      </ReportSection>

      <ReportSection number={2} title="Departments: reports released" note="Each test's report counted once, credited to who released it.">
        <ReportTable
          columns={[
            { key: 'name', label: 'Staff', render: name },
            { key: 'breakdown', label: 'By department', render: (r) => r.byCategory.map((c) => `${c.category} ${c.count}`).join(', ') },
            { key: 'total', label: 'Released', align: 'right' },
          ]}
          rows={diagnostic}
          total={{ name: 'Total', total: diagnostic.reduce((s, r) => s + num(r.total), 0) }}
          empty="No report was released in this period."
        />
      </ReportSection>
    </ReportDocument>
  );
});

/**
 * Patient Feedback: the forms received, each question's answers, and the forms themselves.
 * `forms` is the list as the screen shows it, so "Only forms with a Dili maayo" prints that list.
 */
export const FeedbackPrint = forwardRef(function FeedbackPrint({ report, forms, ratings, ratingLabel, startDate, endDate }, ref) {
  const questions = report?.questions || [];
  const number = new Map(questions.map((q, i) => [String(q.id), i + 1]));
  const poor = (report?.forms || []).filter((f) => Object.values(f.answers || {}).includes(1)).length;
  return (
    <ReportDocument ref={ref} title="Patient Feedback Report" startDate={startDate} endDate={endDate}>
      <ReportSection number={1} title="Summary">
        <ReportFigures items={[
          { label: 'Forms received', value: num(report?.responses) },
          {
            label: 'Of finished visits',
            value: report?.responseRate === null || report?.responseRate === undefined
              ? '—'
              : `${report.responseRate}% of ${num(report.completedVisits)}`,
          },
          { label: 'From the portal', value: num(report?.byChannel?.portal) },
          { label: 'Paper forms typed in', value: num(report?.byChannel?.paper) },
          { label: 'Forms with a Dili maayo', value: poor },
        ]} />
      </ReportSection>

      <ReportSection number={2} title="By question" note="Each answer as a share of everyone who answered that question.">
        <ReportTable
          columns={[
            { key: 'n', label: '#', render: (q) => number.get(String(q.id)) },
            {
              key: 'prompt',
              label: 'Question',
              render: (q) => (
                <>
                  {q.prompt_ceb}{q.is_active ? '' : ' (turned off)'}
                  {q.prompt_en && <><br /><span className="report-doc__note">{q.prompt_en}</span></>}
                </>
              ),
            },
            ...ratings.map((r) => ({
              key: r.key,
              label: r.label.ceb,
              align: 'right',
              render: (q) => (q.total ? `${q[r.key]} (${q[`${r.key}Pct`]}%)` : '—'),
            })),
            { key: 'total', label: 'Answers', align: 'right' },
          ]}
          rows={questions}
          empty="No question is being asked."
        />
      </ReportSection>

      <ReportSection number={3} title="Forms" note="Newest visit first. A name is shown only when the patient gave it.">
        <ReportTable
          columns={[
            { key: 'visit_date', label: 'Visit', render: (f) => formatDate(f.visit_date) },
            { key: 'patient_name', label: 'Patient', render: (f) => f.patient_name || 'Name not given' },
            { key: 'channel', label: 'Form', render: (f) => (f.feedback_channel === 'paper' ? 'Paper' : 'Portal') },
            {
              key: 'answers',
              label: 'Answers',
              render: (f) => Object.entries(f.answers || {})
                .sort(([a], [b]) => (number.get(a) || 99) - (number.get(b) || 99))
                .map(([qid, rating]) => `Q${number.get(qid) || '?'} ${ratingLabel(rating, 'ceb')}`)
                .join(', '),
            },
            { key: 'feedback_comment', label: 'Comment', render: (f) => f.feedback_comment || '' },
          ]}
          rows={forms}
          empty="No form in this period."
        />
      </ReportSection>
    </ReportDocument>
  );
});
