import { useState, useEffect, useCallback, useRef } from 'react';
import { printReport } from '../../lib/reportPrint';
import { TrendsPrint } from './ReportPrints';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import Toolbar, { ToolbarField, ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import ExportButton from '../ui/export-button';
import RevenueTrendChart from '../charts/RevenueTrendChart';
import CategoryVolumeChart from '../charts/CategoryVolumeChart';
import PeakHoursArrivalChart from '../charts/PeakHoursArrivalChart';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { todayStr, daysAgoStr } from '../../lib/date';
import { ClipboardList, Info, RefreshCw, DollarSign, FlaskConical, Printer, TrendingUp, Users } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../ui/date-field';

const STATUS_COLORS = {
  Pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  Processing: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  Completed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  Cancelled: 'bg-rose-50 text-rose-800 ring-rose-200',
};

// --- Date-Range Reports: revenue trend, service volume, operational breakdown (Module 17) --
const DateRangeReports = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The range the figures on screen are FOR, which is not the date boxes until Apply is pressed.
  // The printed period comes from here. [1.117.0]
  const [period, setPeriod] = useState({ startDate, endDate });
  const printRef = useRef(null);

  const fetchReport = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/summary', { params: { startDate: from, endDate: to } });
      setReport(res.data.data.report);
      setPeriod({ startDate: from, endDate: to });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revenueTrend = report?.revenueTrend || [];
  const serviceVolume = report?.serviceVolume || [];
  const visitStatusBreakdown = report?.visitStatusBreakdown || [];
  const paymentMethodBreakdown = report?.paymentMethodBreakdown || [];
  const hourlyArrivals = report?.hourlyArrivals || [];

  const totalRevenue = revenueTrend.reduce((s, r) => s + parseFloat(r.total), 0);
  const totalVisits = visitStatusBreakdown.reduce((s, v) => s + parseInt(v.visit_count, 10), 0);

  return (
    <div className="space-y-5">
      {/* No PageHeader here. This renders inside the Date Range tab of ReportsOverview, which
          already titles the page — a second one printed "Clinic Reports" twice down the screen,
          the same duplicate-title problem the breadcrumb change fixed on the console shells. The
          tab label says which view this is; the one line worth keeping is the print hint. */}
      <p className="m-0 text-fine leading-relaxed text-slate-500">
        Revenue, service volume and operational metrics for a chosen period. Print gives the same
        figures as tables on A4.
      </p>

      <Toolbar>
        <ToolbarField label="From" htmlFor="rep-from">
          <DateField id="rep-from" presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-[9.375rem]" />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="rep-to">
          <DateField id="rep-to" presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-[9.375rem]" />
        </ToolbarField>
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={() => fetchReport(startDate, endDate)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
        <ToolbarSpacer />
        <div className="flex items-end self-stretch gap-2">
          {/* Export sits BEFORE Print, and that order is deliberate: a file you can total is the
              more useful of the two, and Print was the only option for long enough that it reads
              as the default. */}
          <ExportButton
            path="/reports/summary"
            params={{ startDate, endDate }}
            fallbackName={`trends-report-${startDate}_to_${endDate}.xlsx`}
          />
          <Button variant="outline" disabled={!report || loading} onClick={() => printReport(printRef.current)}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </Toolbar>

      {error && (
        <div role="alert" className="alert alert-error">
          <Info />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="space-y-0.5 border-b border-line px-5 py-3.5">
            <CardTitle className="text-note font-semibold text-slate-900">Revenue Trend</CardTitle>
            <p className="text-fine text-gray-500 m-0">Total for range: <span className="font-bold text-slate-900">{formatCurrency(totalRevenue)}</span></p>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
            ) : revenueTrend.length === 0 ? (
              <EmptyState compact icon={TrendingUp} title="No paid transactions in this range" description="Widen the date range above, or check that the cashier has settled the day's bills." />
            ) : (
              <RevenueTrendChart data={revenueTrend} />
            )}
          </CardContent>
        </Card>

        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="border-b border-line px-5 py-3.5">
            <CardTitle className="text-note font-semibold text-slate-900">Service Volume by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
            ) : serviceVolume.length === 0 ? (
              <EmptyState compact icon={FlaskConical} title="No tests recorded in this range" description="Volume is counted from tests attached to a visit, not from bookings." />
            ) : (
              <CategoryVolumeChart data={serviceVolume} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="border-b border-line px-5 py-3.5">
            <CardTitle className="text-note font-semibold text-slate-900">Visit Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
            ) : visitStatusBreakdown.length === 0 ? (
              <EmptyState compact icon={ClipboardList} title="No visits in this range" description="Walk-ins and checked-in appointments both count as visits." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {visitStatusBreakdown.map((row) => (
                  <Badge key={row.status} variant="outline" className={`text-fine font-bold px-3 py-1.5 ${STATUS_COLORS[row.status] || 'border-gray-200 text-gray-700'}`}>
                    {row.status}: {row.visit_count} ({totalVisits > 0 ? Math.round((row.visit_count / totalVisits) * 100) : 0}%)
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="border-b border-line px-5 py-3.5">
            <CardTitle className="text-note font-semibold text-slate-900">Payment Method Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={3} className="py-10 text-center text-fine text-slate-400">Loading…</TableCell></TableRow>
                ) : paymentMethodBreakdown.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="p-0"><EmptyState compact icon={DollarSign} title="No payments in this range" description="Method breakdown fills in once bills are settled." /></TableCell></TableRow>
                ) : (
                  paymentMethodBreakdown.map((row) => (
                    <TableRow key={row.payment_method}>
                      <TableCell className="py-3 text-xs font-semibold text-slate-800">{row.payment_method}</TableCell>
                      <TableCell className="py-3 text-xs text-right text-gray-600">{row.payment_count}</TableCell>
                      <TableCell className="py-3 text-xs text-right font-bold text-slate-900">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* When patients arrive. [1.111.0] Moved here from the Analytics tab, which is gone: a
          peak made of walk-ins is a desk to staff, the same peak made of bookings is a schedule to
          change. Hours come from the clinic's own opening times, so an hour with no bar was open
          and quiet, not missing. */}
      <Card className="border-line rounded-xl bg-surface overflow-hidden">
        <CardHeader className="space-y-0.5 border-b border-line px-5 py-3.5">
          <CardTitle className="text-note font-semibold text-slate-900">Arrivals by Hour</CardTitle>
          <p className="text-fine text-gray-500 m-0">When patients turn up, walk-in against booked.</p>
        </CardHeader>
        <CardContent className="p-5">
          {loading ? (
            <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
          ) : !hourlyArrivals.some((h) => Number(h.total) > 0) ? (
            <EmptyState compact icon={Users} title="No arrivals in this range" description="Walk-ins and checked-in appointments both count as arrivals." />
          ) : (
            <PeakHoursArrivalChart data={hourlyArrivals} />
          )}
        </CardContent>
      </Card>
      </div>

      <TrendsPrint ref={printRef} report={report} startDate={period.startDate} endDate={period.endDate} />
    </div>
  );
};

export default DateRangeReports;
