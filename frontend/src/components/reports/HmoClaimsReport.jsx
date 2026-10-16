import { useState, useEffect, useCallback, useRef } from 'react';
import { printReport } from '../../lib/reportPrint';
import { HmoClaimsPrint } from './ReportPrints';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import EmptyState from '../ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import ExportButton from '../ui/export-button';
import MetricCard from '../ui/metric-card';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { todayStr, daysAgoStr } from '../../lib/date';
import { Info, RefreshCw, ShieldCheck, DollarSign, Clock, AlertTriangle, Printer, FlaskConical } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../ui/date-field';

// --- HMO claim value, per provider. -----------------------------------------------------------
//
// The clinic had no way to see what its HMO work was worth. Every existing money figure comes from
// `payments`, and an HMO claim is not in `payments` — the insurer is billed and pays later, through
// a channel this system does not see.
//
// Which is exactly the trap this screen has to avoid. "Approved" is a RECEIVABLE, not takings; put
// it beside "Today's Revenue" without saying so and the same peso is reported twice, once as a
// claim and once as cash. So the approved figure is labelled as billable, the counter takings sit
// in their own column, and the two are never added together anywhere on this panel.
const HmoClaimsReport = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(29));
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The range the figures are FOR, for the printed period. [1.117.0]
  const [period, setPeriod] = useState({ startDate, endDate });
  const printRef = useRef(null);

  const fetchClaims = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/hmo-claims', { params: { startDate: from, endDate: to } });
      setReport(res.data.data.report);
      setPeriod({ startDate: from, endDate: to });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load HMO claim figures.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaims(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = report?.totals;
  const providers = report?.providers || [];
  const tests = report?.tests || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-surface p-5 rounded-xl border border-line">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-900 m-0">HMO Claim Value</h3>
          <p className="text-xs text-gray-500 m-0">
            What the clinic&apos;s HMO work is worth, by provider and by test. Counted on the date of
            the visit, so a claim decided later never moves money out of a period already reported.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <DateField presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-36" aria-label="HMO report start date" />
          <span className="text-xs text-gray-400">to</span>
          <DateField presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-36" aria-label="HMO report end date" />
          <Button variant="outline" onClick={() => fetchClaims(startDate, endDate)} className="flex items-center space-x-1.5 text-xs font-semibold">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Apply</span>
          </Button>
          {/* The exported file carries the receivable caveat in its own header block — see
              reportCsv.hmoClaimsCsv. A claim total copied out of here without it is the one
              mistake this report can cause. */}
          <ExportButton
            path="/reports/hmo-claims"
            params={{ startDate, endDate }}
            fallbackName={`hmo-claims-report-${startDate}_to_${endDate}.xlsx`}
            className="text-xs font-semibold"
          />
          <Button variant="outline" disabled={!report || loading} onClick={() => printReport(printRef.current)} className="text-xs font-semibold">
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          tone="error"
          title="Could not load HMO claim figures"
          description={error}
          action={<Button variant="outline" size="sm" onClick={() => fetchClaims(startDate, endDate)}>Try again</Button>}
        />
      ) : loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
      ) : providers.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No HMO claims in this range"
          description="Claims are counted from the date of the visit they were raised on. Widen the range above."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Approved"
              value={formatCurrency(t.approved)}
              caption="Billable to the insurer — not counter takings"
              captionTone="slate"
              icon={ShieldCheck}
              tone="emerald"
            />
            <MetricCard
              label="Awaiting Decision"
              value={formatCurrency(t.pending)}
              caption="Undecided — may become either column"
              captionTone="slate"
              icon={Clock}
              tone="indigo"
            />
            <MetricCard
              label="Refused"
              value={formatCurrency(t.refused)}
              caption="Falls to the patient to settle"
              captionTone="slate"
              icon={AlertTriangle}
              tone="purple"
            />
            <MetricCard
              label="Paid at the Counter"
              value={formatCurrency(t.collected)}
              caption="Already inside the clinic's revenue"
              captionTone="slate"
              icon={DollarSign}
              tone="green"
            />
          </div>

          {/* Said in words, once, where the figure is read. A caption on a tile is easy to skim
              past, and this is the one misreading that would overstate the clinic's income. */}
          <p className="m-0 flex items-start gap-2 rounded-xl border border-azure-200 bg-azure-50/50 px-3.5 py-2.5 text-fine leading-relaxed text-slate-700">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-azure-600" aria-hidden="true" />
            <span>
              <strong>Approved is money still owed to the clinic</strong>, billed to the provider and
              settled outside this system. Only &ldquo;Paid at the Counter&rdquo; is in the cash-up —
              do not add the two together.
            </span>
          </p>

          <Card className="border-line rounded-xl bg-surface overflow-hidden">
            <CardHeader className="flex flex-row items-center gap-2.5 border-b border-line px-5 py-3.5">
              <ShieldCheck className="w-4 h-4 text-brand-600" />
              <CardTitle className="text-note font-semibold text-slate-900">By Provider</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Tests</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Refused</TableHead>
                      <TableHead className="text-right">At Counter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providers.map((p) => (
                      <TableRow key={p.provider_name}>
                        <TableCell className="font-semibold text-slate-900">{p.provider_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.visits}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.tests_claimed}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-emerald-700">{formatCurrency(p.approved)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{formatCurrency(p.pending)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{formatCurrency(p.refused)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{formatCurrency(p.collected)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Which tests the claims were for. [1.127.0] The provider rows say what is owed and not
              what for, and Departments' sales by service mixes a covered test in with paid ones. */}
          <Card className="border-line rounded-xl bg-surface overflow-hidden" data-testid="hmo-by-test">
            <CardHeader className="flex flex-row items-center gap-2.5 border-b border-line px-5 py-3.5">
              <FlaskConical className="w-4 h-4 text-brand-600" />
              <CardTitle className="text-note font-semibold text-slate-900">By Test</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Test</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Claimed</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Refused</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tests.map((r) => (
                      <TableRow key={`${r.provider_name}|${r.test_name}|${r.category_name}`}>
                        <TableCell className="text-slate-600">{r.provider_name}</TableCell>
                        <TableCell className="font-semibold text-slate-900">{r.test_name}</TableCell>
                        <TableCell className="text-slate-600">{r.category_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.tests_claimed}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-emerald-700">{formatCurrency(r.approved)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{formatCurrency(r.pending)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{formatCurrency(r.refused)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <HmoClaimsPrint ref={printRef} report={report} startDate={period.startDate} endDate={period.endDate} />
    </div>
  );
};

export default HmoClaimsReport;
