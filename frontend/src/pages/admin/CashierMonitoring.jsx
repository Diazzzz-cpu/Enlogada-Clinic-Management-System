import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { ToolbarField, SegmentedFilter } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import MetricCard from '../../components/ui/metric-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { todayStr, formatDateTime } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';
import { settled } from '../../lib/collections';
import { METHOD_FILTERS, METHOD_FILTER_ALL } from '../../lib/paymentMethods';
import { ExternalLink, Receipt, RefreshCw, Banknote, Hash, UserCircle2, Undo2 } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../../components/ui/date-field';

// Visual Design Improvement Plan Phase V1 — see VISUAL_IDENTITY.md §3a #11.
const PAGE_SIZE = 20;

// Module 12: cashier monitoring — reuses GET /payments/transactions (Module 14's endpoint,
// already Admin/SuperAdmin-authorized) with an admin-facing date range, rather than adding new
// backend surface.
const CashierMonitoring = () => {
  const [transactions, setTransactions] = useState([]);
  // The peso figures, aggregated in SQL over settled rows only. The list beside them deliberately
  // includes receipts that were later reversed, so it cannot be the source of a total.
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the screen rendered its
  // EMPTY state — "No transactions yet" over a 500. That is the one thing empty-state.jsx's own
  // docstring says must never happen: a quiet clinic and a broken server call for opposite
  // responses, and one of them was being reported as the other.
  const [loadError, setLoadError] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  // The range currently ON SCREEN, as distinct from the one typed into the inputs above. The
  // dates are deferred behind Apply, so a method change must re-query the range the figures were
  // actually drawn from — using the input values would silently apply a half-typed date nobody
  // asked for. [1.33.0]
  const [applied, setApplied] = useState({ from: todayStr(), to: todayStr() });
  const [method, setMethod] = useState(METHOD_FILTER_ALL);
  const [page, setPage] = useState(1);

  const fetchTransactions = useCallback(async (from, to, forMethod = METHOD_FILTER_ALL) => {
    setLoading(true);
    setLoadError('');
    setPage(1);
    setApplied({ from, to });
    try {
      // The filter is applied SERVER-side so the summary and the rows describe the same set.
      // Filtering the rows in the browser would leave summary.collected — aggregated in SQL over
      // the whole range — showing every method beside per-cashier cards showing one, which is the
      // contradiction lib/collections.js records as having already shipped on this screen.
      // 'All' means send nothing, never send the string.
      const params = { startDate: from, endDate: to };
      if (forMethod !== METHOD_FILTER_ALL) params.method = forMethod;
      const res = await api.get('/payments/transactions', { params });
      setTransactions(res.data.data.transactions || []);
      setSummary(res.data.data.summary || null);
    } catch (err) {
      // Recorded, not just logged: a swallowed failure renders as an empty list.
      console.error('Failed to fetch transactions:', err);
      setLoadError(err.response?.data?.message || 'The server did not respond. The list below may be out of date.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collected = Number(summary?.collected || 0);
  const receipts = Number(summary?.receipts || 0);
  const reversals = Number(summary?.reversals || 0);
  const reversed = Number(summary?.reversed || 0);

  // Per-cashier is a breakdown the summary does not carry, so it is reduced here — over settled
  // rows explicitly. This fetch is unpaged, so the rows in hand are the whole range.
  const byCashier = settled(transactions).reduce((acc, t) => {
    const name = t.processed_by_first_name ? `${t.processed_by_first_name} ${t.processed_by_last_name}` : 'Unknown';
    acc[name] = (acc[name] || 0) + parseFloat(t.amount || 0);
    return acc;
  }, {});
  // Capped so the strip never exceeds four cards: two fixed, a reversals card when there is
  // something to report, and the rest per-cashier. The count also decides how many columns the
  // grid draws, so an unfilled cell never renders as a grey box where a figure should be.
  const cashierCards = Object.entries(byCashier).slice(0, reversals > 0 ? 1 : 2);
  const cardCount = 2 + (reversals > 0 ? 1 : 0) + cashierCards.length;
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
  const pagedTransactions = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={Receipt}
        title="Cashier Monitoring"
        description="Every payment taken across all cashiers, for reconciliation and the daily cash-up. Read-only — Admin cannot transact."
      />

      <div>
        <Toolbar attached>
          <ToolbarField label="From" htmlFor="cm-from">
            <DateField id="cm-from" presets={RANGE_PRESETS.start} value={startDate} onChange={e => setStartDate(e.target.value)} containerClassName="w-[9.375rem]" />
          </ToolbarField>
          <ToolbarField label="To" htmlFor="cm-to">
            <DateField id="cm-to" presets={RANGE_PRESETS.end} value={endDate} onChange={e => setEndDate(e.target.value)} containerClassName="w-[9.375rem]" />
          </ToolbarField>
          <div className="flex items-end self-stretch">
            <Button variant="outline" onClick={() => fetchTransactions(startDate, endDate, method)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Apply
            </Button>
          </div>
          <ToolbarField label="Method" htmlFor="cm-method">
            {/* Applies immediately, unlike the dates: picking a method is a complete instruction,
                whereas a half-typed date is not — which is why the range waits behind Apply and
                this does not. It re-queries the range already on screen, not the input values. */}
            <SegmentedFilter
              ariaLabel="Filter transactions by payment method"
              options={METHOD_FILTERS.map(m => ({ value: m, label: m }))}
              value={method}
              onChange={(next) => {
                setMethod(next);
                fetchTransactions(applied.from, applied.to, next);
              }}
            />
          </ToolbarField>
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          {/* The range summary sits inside the table's panel rather than in a separate KPI strip
              above the filters. These figures describe *this* result set — floating them away
              from the range that produced them was how they got read as clinic-wide totals. */}
          {/* The column count follows the number of cards, rather than always being four.
              The strip is `gap-px` over a tinted container, so the gaps ARE the dividers — and a
              column with no card in it therefore rendered as a plain grey rectangle sitting where
              a figure should be. With one cashier on shift, which is the ordinary case for this
              clinic, a quarter of the strip was an empty box that read as a failed tile. */}
          {/* Hidden when the fetch failed. These are all derived from `transactions`, which is
              empty because the request errored — so the strip stated "Collections in range
              PHP 0.00" directly above a panel saying the data could not be loaded. Two claims
              that contradict each other is worse than either alone, and the peso figure is the
              one a reader believes. */}
          {!loadError && !loading && (
          <div className={`grid grid-cols-2 gap-px border-b border-line bg-[#e6ebf1] ${
            { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cardCount]
          }`}>
            {/* Named on the figure itself when a method filter is on. The strip's own note above
                says these describe THIS result set rather than the clinic — and a filtered
                collections total that does not say so is exactly how an admin reads one method's
                takings as the day's. [1.33.0] */}
            <MetricCard
              className="rounded-none border-0"
              label={method === METHOD_FILTER_ALL ? 'Collections in range' : `Collections — ${method} only`}
              value={formatCurrency(collected)}
              caption={method === METHOD_FILTER_ALL ? undefined : 'filtered by payment method'}
              captionTone={method === METHOD_FILTER_ALL ? undefined : 'slate'}
              icon={Banknote}
              tone="emerald"
            />
            <MetricCard
              className="rounded-none border-0"
              label="Receipts"
              value={receipts}
              icon={Hash}
              tone="slate"
            />
            {/* Reported beside the collections figure, never netted off it. A drawer short by a
                refund needs the refund named — a single reconciled total hides that one
                happened, which is the thing an oversight screen exists to surface.

                The caption used to read "not in collections", which the cash book [1.30.0] made
                false: a receipt taken in this range and reversed in it is counted in `collected`
                AND here, money in and money out. It now says what to do with the number instead,
                which is the question an oversight screen is actually being asked. */}
            {reversals > 0 && (
              <MetricCard
                className="rounded-none border-0"
                label="Reversed"
                value={formatCurrency(reversed)}
                caption={`${reversals} receipt${reversals === 1 ? '' : 's'} — net ${formatCurrency(collected - reversed)}`}
                captionTone="rose"
                icon={Undo2}
                tone="rose"
              />
            )}
            {cashierCards.map(([name, amt]) => (
              <MetricCard
                key={name}
                className="rounded-none border-0"
                label={name}
                value={formatCurrency(amt)}
                caption="Collected by this cashier"
                captionTone="slate"
                icon={UserCircle2}
                tone="indigo"
              />
            ))}
          </div>
          )}

          <PanelBody flush>
            <Table stack>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid At</TableHead>
                  <TableHead className="text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Error before empty. A failed fetch used to fall through to the empty branch,
                    so a 500 rendered as "nothing here yet" — which is a false statement about the
                    clinic's data, not merely an unhelpful one. */}
                {loadError ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        tone="error"
                        title="Could not load transactions"
                        description={loadError}
                        action={<Button variant="outline" size="sm" onClick={() => fetchTransactions(startDate, endDate)}>Try again</Button>}
                      />
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <SkeletonRows rows={6} columns={7} />
                ) : pagedTransactions.length > 0 ? (
                  pagedTransactions.map(t => (
                    <TableRow key={t.id}>
                      <TableCell label="Receipt #" className="font-mono text-fine font-semibold text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                      <TableCell label="Cashier" className="max-w-[10rem] truncate" title={`${t.processed_by_first_name} ${t.processed_by_last_name}`}>{t.processed_by_first_name} {t.processed_by_last_name}</TableCell>
                      <TableCell label="Patient" className="max-w-[10rem] truncate font-medium text-slate-900" title={`${t.patient_first_name} ${t.patient_last_name}`}>{t.patient_first_name} {t.patient_last_name}</TableCell>
                      <TableCell label="Method">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-slate-600">{t.payment_method}</Badge>
                          {/* A reversed receipt stays listed — that is the point of the log — so it
                              has to be unmistakably not-money at a glance. Badge AND colour AND a
                              struck figure: colour alone would leave it reading as revenue to
                              anyone who cannot separate the two greens. */}
                          {t.payment_status !== 'Paid' && (
                            <Badge className="border-rose-200 bg-rose-50 text-rose-700">{t.payment_status}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        label="Amount"
                        className={`text-right font-semibold tabular-nums ${
                          t.payment_status === 'Paid' ? 'text-emerald-700' : 'text-slate-400 line-through'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell label="Paid at" className="text-right text-fine text-slate-500">{formatDateTime(t.paid_at)}</TableCell>
                      {/* Oversight could read a receipt NUMBER here and never open the receipt —
                          so answering "send me a copy of RCT-…" meant asking a cashier to do it
                          from their own console. billing:read is what the route asks for, and an
                          Admin holds it; this is looking, not taking money. */}
                      <TableCell label="Receipt" className="text-right">
                        {t.receipt_number ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => window.open(`?receipt=${encodeURIComponent(t.receipt_number)}`, '_blank', 'noopener')}
                            title={`Open receipt ${t.receipt_number} in a new tab`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </Button>
                        ) : (
                          <span className="text-fine text-slate-400">&mdash;</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={Receipt}
                        title="No payments in this date range"
                        description="Widen the range above, or check that the cashier has settled today's bills."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalLabel={(loadError || loading) ? '' : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`}
          />
        </Panel>
      </div>
    </div>
  );
};

export default CashierMonitoring;
