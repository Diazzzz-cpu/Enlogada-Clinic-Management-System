import { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/card';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import MetricCard from '../ui/metric-card';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { todayStr, daysAgoStr } from '../../lib/date';
import { settled } from '../../lib/collections';
import { ClipboardList, FileText, Info, DollarSign } from 'lucide-react';

// --- Today's Snapshot (Module 12's original reporting entry point; logic unchanged) --------
const TodaySnapshot = () => {
  const [todayTotal, setTodayTotal] = useState(0);
  const [yesterdayTotal, setYesterdayTotal] = useState(0);
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [methodBreakdown, setMethodBreakdown] = useState({});
  const [loading, setLoading] = useState(true);
  // The most dangerous silent failure in the app. Every figure here initialises to 0, so a
  // failed fetch left the screen stating "Today's Revenue PHP 0.00, +0% vs yesterday" and
  // "No payments yet today" — confident, specific and false. A manager reads that as the
  // clinic having taken nothing, not as the server being down, and the two call for opposite
  // responses. A blank panel would have been safer than this was.
  const [snapshotError, setSnapshotError] = useState('');

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    setSnapshotError('');
    try {
      const today = todayStr();
      const yesterday = daysAgoStr(1);

      const [todayRes, yesterdayRes, visitsRes, testsRes] = await Promise.all([
        api.get('/payments/transactions', { params: { startDate: today, endDate: today } }),
        api.get('/payments/transactions', { params: { startDate: yesterday, endDate: yesterday } }),
        api.get('/visits/active'),
        api.get('/tests'),
      ]);

      const todayTx = todayRes.data.data.transactions || [];

      // Both totals come from the endpoint's SQL summary. The lists below include receipts that
      // were later reversed, so reducing them would count a refund as income.
      setTodayTotal(Number(todayRes.data.data.summary?.collected || 0));
      setYesterdayTotal(Number(yesterdayRes.data.data.summary?.collected || 0));
      setActiveQueueCount((visitsRes.data.data.visits || []).length);
      setCatalogCount((testsRes.data.data.tests || []).length);

      // Grouped by method, which the summary does not carry — so it is filtered explicitly.
      // Safe to reduce here only because this fetch is unpaged.
      const breakdown = settled(todayTx).reduce((acc, t) => {
        acc[t.payment_method] = (acc[t.payment_method] || 0) + parseFloat(t.amount || 0);
        return acc;
      }, {});
      setMethodBreakdown(breakdown);
    } catch (err) {
      console.error('Failed to fetch report data:', err);
      setSnapshotError(err.response?.data?.message || "Today's figures could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const percentChange = yesterdayTotal > 0
    ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100
    : (todayTotal > 0 ? 100 : 0);
  const isUp = percentChange >= 0;

  // Nothing numeric is shown at all when the fetch failed. Showing the tiles with a caveat
  // beside them would still put a wrong peso figure on screen, and the figure is what gets read.
  if (snapshotError) {
    return (
      <Card className="border-line rounded-xl bg-surface">
        <EmptyState
          tone="error"
          title="Today's figures are unavailable"
          description={snapshotError}
          action={<Button variant="outline" size="sm" onClick={fetchReportData}>Try again</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label="Today's Revenue"
          value={loading ? '…' : formatCurrency(todayTotal)}
          icon={DollarSign}
          tone="emerald"
          trend={!loading ? { direction: isUp ? 'up' : 'down', label: `${isUp ? '+' : ''}${percentChange.toFixed(0)}% vs yesterday (${formatCurrency(yesterdayTotal)})` } : undefined}
        />
        <MetricCard
          label="Active Queue"
          value={loading ? '…' : activeQueueCount}
          icon={ClipboardList}
          tone="indigo"
          caption="Pending + Processing visits today"
        />
        <MetricCard
          label="Services Catalog"
          value={loading ? '…' : catalogCount}
          icon={FileText}
          tone="green"
          caption="Active diagnostic services"
        />

        <Card className="border-line rounded-xl bg-surface p-5 space-y-1">
          <span className="field-label">Payment Methods (Today)</span>
          {loading ? (
            <div className="text-2xl font-extrabold text-slate-900">…</div>
          ) : Object.keys(methodBreakdown).length === 0 ? (
            <p className="text-xs text-slate-500 m-0">No payments yet today.</p>
          ) : (
            <div className="space-y-0.5 pt-1">
              {Object.entries(methodBreakdown).map(([method, amt]) => (
                <div key={method} className="flex justify-between text-fine font-semibold text-gray-700">
                  <span>{method}</span>
                  <span className="font-bold text-slate-900">{formatCurrency(amt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Two things were wrong with this. It pointed at a "Date-Range Reports" tab that does not
          exist — the tab was renamed to Trends and this copy was not — so the one instruction on
          the screen sent the reader looking for something they would never find.

          And it was a full-width dark slab: on a tab whose content ends halfway down the
          viewport, the single heaviest element on the page was a footnote. It is the same inline
          alert every other advisory note in the app uses now. */}
      <div role="note" className="alert alert-info">
        <Info />
        <span>
          A live snapshot of today only. For historical trends and a custom date range, see the{' '}
          <strong>Trends</strong> tab.
        </span>
      </div>
    </div>
  );
};

export default TodaySnapshot;
