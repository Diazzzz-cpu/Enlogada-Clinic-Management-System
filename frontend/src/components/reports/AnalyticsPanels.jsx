import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Clock, Info, RefreshCw, TrendingUp, Users } from 'lucide-react';
import api from '../../config/api';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarField, ToolbarSpacer } from '../ui/toolbar';
import { DateField, RANGE_PRESETS } from '../ui/date-field';
import { Button } from '../ui/button';
import ExportCsvButton from '../ui/export-csv-button';
import EmptyState from '../ui/empty-state';
import LoadingState from '../ui/loading-state';
import TurnaroundSlaChart from '../charts/TurnaroundSlaChart';
import PeakHoursArrivalChart from '../charts/PeakHoursArrivalChart';
import RevenueTrendChart from '../charts/RevenueTrendChart';
import { todayStr, daysAgoStr } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';

/**
 * The analytics tab: turnaround against target, arrivals by hour, and this period against the last.
 * [1.62.0]
 *
 * ── One fetch, three charts ─────────────────────────────────────────────────────────────────
 *
 * `GET /reports/analytics` returns all three datasets, for the same reason `/reports/operations`
 * returns six: this screen needs them together, and three requests would mean three chances for
 * the figures on one page to come from three different moments.
 *
 * ── Each panel appears only if the account may see it ───────────────────────────────────────
 *
 * The API decides, per slice, from the caller's own permissions — turnaround on `results:read`,
 * arrivals on `visits:read`, the revenue comparison on `billing:read`. A slice the caller may not
 * see is ABSENT from the response, and the panel is therefore absent from the screen rather than
 * rendered empty.
 *
 * That is deliberate and it is the same rule the operations report follows. An empty revenue chart
 * shown to a technician says the clinic took no money; a missing one says nothing at all, which is
 * the truthful thing for a screen to say about figures it was not given.
 *
 * A caller holding none of the three gets a 403, which lands here as the "nothing to report on"
 * state — a boundary, said as a boundary, not as an error.
 */

const RANGE_DAYS = 29;

/** A caption under a chart. The number a chart cannot state on its own. */
const ChartNote = ({ children }) => (
  <p className="m-0 mt-2 flex items-start gap-1.5 text-fine leading-relaxed text-slate-500">
    <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

/**
 * Sums both series and states the movement in words.
 *
 * A trend chart shows a shape; "up 12% on the previous 30 days" is the sentence somebody repeats
 * in a meeting, and leaving the reader to estimate it off two overlaid lines is how a chart gets
 * quoted wrongly. Percentage suppressed when the previous period took nothing — a change from
 * zero has no percentage, and "+Infinity%" has been shipped by better systems than this one.
 */
const ComparisonSummary = ({ current, previous }) => {
  const sum = (rows) => (rows || []).reduce((n, r) => n + parseFloat(r.total || 0), 0);
  const now = sum(current);
  const before = sum(previous);
  if (!previous?.length) return null;

  const delta = now - before;
  const pct = before > 0 ? (delta / before) * 100 : null;
  const up = delta >= 0;

  return (
    <p className="m-0 mt-2 text-fine text-slate-500">
      <span className="font-semibold text-slate-700">{formatCurrency(now)}</span> this period
      {' vs '}
      <span className="font-semibold text-slate-700">{formatCurrency(before)}</span> previously —{' '}
      <span className={up ? 'font-bold text-brand-700' : 'font-bold text-slate-700'}>
        {up ? '+' : '−'}{formatCurrency(Math.abs(delta))}
        {pct !== null && ` (${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`}
      </span>
    </p>
  );
};

const AnalyticsReport = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(RANGE_DAYS));
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAnalytics = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/analytics', { params: { startDate: from, endDate: to } });
      setReport(res.data.data.report);
    } catch (err) {
      // 403 is a boundary, not a fault, and must not be reported in the language of a failure —
      // "something went wrong" sends the reader looking for a problem that does not exist.
      setError(err.response?.status === 403 ? 'forbidden' : (err.response?.data?.message || 'The analytics could not be loaded.'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnalytics(startDate, endDate); }, [fetchAnalytics, startDate, endDate]);

  if (error === 'forbidden') {
    return (
      <EmptyState
        icon={BarChart3}
        title="Nothing here to report on"
        description="This account holds no result, visit or billing permission, so none of these figures are yours to see."
      />
    );
  }

  const turnaround = report?.turnaroundSla || [];
  const arrivals = report?.hourlyArrivals || [];
  const comparison = report?.revenueComparison || null;
  const targets = report?.targets || {};

  return (
    <div className="space-y-4">
      <Toolbar>
        <ToolbarField label="From" htmlFor="an-from">
          <DateField
            id="an-from"
            presets={RANGE_PRESETS.start}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            containerClassName="w-[9.375rem]"
          />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="an-to">
          <DateField
            id="an-to"
            presets={RANGE_PRESETS.end}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            containerClassName="w-[9.375rem]"
          />
        </ToolbarField>
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={() => fetchAnalytics(startDate, endDate)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
        <ToolbarSpacer />
        <ExportCsvButton
          path="/reports/analytics"
          params={{ startDate, endDate }}
          fallbackName={`clinic-analytics-${startDate}_to_${endDate}.csv`}
        />
      </Toolbar>

      {error && error !== 'forbidden' && (
        <div role="alert" className="alert alert-error">
          <Info />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading analytics…" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {report?.turnaroundSla && (
            <Panel>
              <PanelHeader
                icon={Clock}
                title="Turnaround against target"
                description="Payment to released report, per department."
              />
              <PanelBody>
                {turnaround.length ? (
                  <>
                    <TurnaroundSlaChart data={turnaround} />
                    <ChartNote>
                      The median is the typical patient; the 90th percentile is the one who
                      telephones.{' '}
                      {Object.keys(targets).length > 0 ? (
                        <>
                          Targets are{' '}
                          {Object.entries(targets).map(([name, mins], i) => (
                            <React.Fragment key={name}>
                              {i > 0 && ', '}
                              <span className="font-semibold text-slate-600">{name} {mins} min</span>
                            </React.Fragment>
                          ))}
                          {' '}— a clinic setting, not a measurement.
                        </>
                      ) : (
                        /* Says what is absent and how to supply it. [1.63.0] This used to draw
                           invented targets — Ultrasound read 7.7% against a benchmark nobody had
                           agreed. Measured and unjudged is the honest state until the clinic
                           decides what it is promising. */
                        <span>
                          No turnaround targets are set, so these are measured but not compared
                          against anything. Set <code className="font-mono">TURNAROUND_TARGETS</code>{' '}
                          in the backend environment to show a benchmark.
                        </span>
                      )}
                    </ChartNote>
                  </>
                ) : (
                  <EmptyState
                    compact
                    icon={Clock}
                    title="No reports released in this range"
                    description="Turnaround is measured from released reports, so it fills in once a department completes work."
                  />
                )}
              </PanelBody>
            </Panel>
          )}

          {report?.hourlyArrivals && (
            <Panel>
              <PanelHeader
                icon={Users}
                title="Arrivals by hour"
                description="When patients actually turn up, walk-in against booked."
              />
              <PanelBody>
                {arrivals.some((h) => h.total > 0) ? (
                  <>
                    <PeakHoursArrivalChart data={arrivals} />
                    <ChartNote>
                      Hours come from the clinic&apos;s own opening times, so an hour with no bar
                      was open and quiet — not missing. A peak made of walk-ins is a desk to staff;
                      the same peak made of bookings is a schedule to change.
                    </ChartNote>
                  </>
                ) : (
                  <EmptyState
                    compact
                    icon={Users}
                    title="No arrivals in this range"
                    description="Widen the date range above."
                  />
                )}
              </PanelBody>
            </Panel>
          )}

          {comparison && (
            <Panel className="xl:col-span-2">
              <PanelHeader
                icon={TrendingUp}
                title="This period against the last"
                description={`Compared with ${comparison.previousRange?.startDate} to ${comparison.previousRange?.endDate}.`}
              />
              <PanelBody>
                {comparison.current?.length ? (
                  <>
                    <RevenueTrendChart data={comparison.current} previous={comparison.previous} />
                    <ComparisonSummary current={comparison.current} previous={comparison.previous} />
                    <ChartNote>
                      The two lines are aligned by position in the period, not by date — day one
                      against day one — so the dashed line&apos;s own date is named in its tooltip.
                      Takings are counted on the day the money came in and are never restated.
                    </ChartNote>
                  </>
                ) : (
                  <EmptyState
                    compact
                    icon={TrendingUp}
                    title="No takings in this range"
                    description="Widen the date range above, or check the day's bills have been settled."
                  />
                )}
              </PanelBody>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyticsReport;
