import React from 'react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import { SkeletonRows } from '../ui/skeleton';
import { formatCurrency } from '../../lib/currency';
import { formatDuration } from '../../lib/duration';
import { TrendingUp, Timer, Users, Layers, AlertTriangle } from 'lucide-react';

/**
 * The per-department panels, built once and rendered wherever they belong.
 *
 * Each role's dashboard had a KPI strip that counted what was in front of it *right now* — the
 * cashier's collections today, the receptionist's queue length, the modality's pending count —
 * and not one of them measured how the department was performing. There was no answer anywhere
 * in the app to "which service earns the most", "how long does a patient wait to be billed", or
 * "is X-Ray slower this week than last".
 *
 * Shared components rather than three copies because the Admin roll-up shows exactly the same
 * panels as the individual consoles. Copies would drift, and the version an Admin reads when
 * asking a department about its numbers has to be the version that department sees.
 */

/** A small labelled figure. Used inside panels where a full MetricCard would be too loud. */
const Stat = ({ label, value, hint, tone = 'default' }) => (
  <div className="min-w-0">
    <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</span>
    <span
      className={`block text-lg font-extrabold leading-tight tabular-nums tracking-tight ${
        tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900'
      }`}
    >
      {value}
    </span>
    {hint && <span className="block text-fine text-slate-500">{hint}</span>}
  </div>
);

/**
 * A panel whose figures did not arrive. [1.74.0]
 *
 * Each panel below takes `error` (and `onRetry`) now. Without them a failed report showed a
 * skeleton that never ended, or — worse — an empty "Nothing sold in this range" and "₱0.00 net",
 * which is a claim about the clinic's money rather than an admission that it is unknown.
 * OperationsReport has its own banner and does not render the panels at all without a report, so
 * this is for the consoles that embed them.
 */
const PanelError = ({ what, error, onRetry }) => (
  <EmptyState
    compact
    tone="error"
    icon={AlertTriangle}
    title={`Couldn't load ${what}`}
    description={error === 'forbidden' ? "This account can't see these figures." : error}
    action={onRetry && error !== 'forbidden' ? (
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    ) : undefined}
  />
);

/**
 * What the clinic actually sold.
 *
 * `net` rather than `gross` is the headline because net is the money that reached the drawer —
 * gross is the shelf price before the statutory discount and the VAT exemption came off. Both are
 * shown: a manager comparing a service's list price to its yield needs the pair, and a report
 * whose total does not reconcile with the cash-up is one nobody trusts twice.
 */
export const SalesByServicePanel = ({ billing, loading, error, onRetry, limit }) => {
  const rows = billing?.byService || [];
  const shown = limit ? rows.slice(0, limit) : rows;
  const totalNet = rows.reduce((sum, r) => sum + parseFloat(r.net || 0), 0);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Sales by service"
        description={limit && rows.length > limit ? `Top ${limit} of ${rows.length} services` : 'Every service sold in this range'}
        icon={Layers}
        actions={
          !loading && !error && (
            <span className="text-fine font-semibold tabular-nums text-slate-600">
              {formatCurrency(totalNet)} net
            </span>
          )
        }
      />
      <PanelBody flush>
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="p-0">
                  <PanelError what="sales by service" error={error} onRetry={onRetry} />
                </TableCell>
              </TableRow>
            ) : loading ? (
              <SkeletonRows rows={5} columns={5} />
            ) : shown.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="p-0">
                  <EmptyState
                    compact
                    icon={TrendingUp}
                    title="Nothing sold in this range"
                    description="A service appears here once a visit including it has been paid for."
                  />
                </TableCell>
              </TableRow>
            ) : (
              shown.map((row) => (
                <TableRow key={`${row.category_name}-${row.test_name}`}>
                  <TableCell className="font-medium text-slate-900">{row.test_name}</TableCell>
                  <TableCell className="text-slate-500">{row.category_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.sold}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">{formatCurrency(row.gross)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-emerald-700">
                    {formatCurrency(row.net)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  );
};

/** Cash-up summary: taken, given away, reversed. */
export const BillingTotalsPanel = ({ billing, loading, error, onRetry }) => {
  const t = billing?.totals;
  return (
    <Panel>
      <PanelHeader title="Takings" description="Settled payments in this range" icon={TrendingUp} />
      <PanelBody>
        {error ? (
          <PanelError what="the takings" error={error} onRetry={onRetry} />
        ) : loading || !t ? (
          <div className="h-16 animate-pulse rounded-lg bg-skeleton" />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Collected" value={formatCurrency(t.collected)} hint={`${t.receipts} receipt${t.receipts === 1 ? '' : 's'}`} tone="good" />
            <Stat
              label="Average receipt"
              value={formatCurrency(t.receipts > 0 ? parseFloat(t.collected) / t.receipts : 0)}
            />
            {/* Statutory deductions are a cost the clinic reclaims, so they are reported, not
                hidden inside the net figure. */}
            <Stat label="Discounts given" value={formatCurrency(t.discounts)} hint={`plus ${formatCurrency(t.vat_exempted)} VAT exempted`} />
            {parseFloat(t.refunded) > 0 && (
              <Stat label="Refunded" value={formatCurrency(t.refunded)} hint={`${t.refunds} reversal${t.refunds === 1 ? '' : 's'}`} tone="warn" />
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
};

/**
 * Front-desk throughput.
 *
 * The median leads and the mean is the footnote, which is the opposite of the usual instinct and
 * the right way round: one patient who arrived at 08:00 and paid at 17:00 drags a mean into
 * uselessness, while the median still describes a normal morning.
 */
export const ReceptionThroughputPanel = ({ reception, loading, error, onRetry, description = 'Check-in to payment' }) => (
  <Panel>
    <PanelHeader title="Front desk" description={description} icon={Users} />
    <PanelBody>
      {error ? (
        <PanelError what="the front desk figures" error={error} onRetry={onRetry} />
      ) : loading || !reception ? (
        <div className="h-16 animate-pulse rounded-lg bg-skeleton" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Visits" value={reception.visits} hint={`${reception.walk_ins} walk-in · ${reception.appointments} booked`} />
          <Stat
            label="Typical wait"
            value={formatDuration(reception.median_wait_minutes)}
            hint={`mean ${formatDuration(reception.avg_wait_minutes)}`}
            tone={reception.median_wait_minutes > 30 ? 'warn' : 'good'}
          />
          <Stat label="Completed" value={reception.completed} />
          <Stat label="Cancelled" value={reception.cancelled} tone={reception.cancelled > 0 ? 'warn' : 'default'} />
        </div>
      )}
    </PanelBody>
  </Panel>
);

/**
 * Per-modality turnaround, measured payment → released report.
 *
 * Payment is the right start point: a visit registered at 08:00 but paid at 11:00 did not spend
 * three hours in the lab, and blaming the department for the queue in front of it makes the
 * number useless for the thing it exists to answer.
 */
export const TurnaroundPanel = ({
  diagnostics, loading, error, onRetry,
  title = 'Turnaround by department',
  description = 'From payment to released report',
}) => {
  const rows = diagnostics?.byCategory || [];
  const outstanding = diagnostics?.outstanding || [];
  const backlogFor = (name) => outstanding.find((o) => o.category_name === name);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title={title}
        description={description}
        icon={Timer}
        actions={
          diagnostics?.scope ? (
            <span className="text-fine text-slate-500">{diagnostics.scope.join(', ')} only</span>
          ) : undefined
        }
      />
      <PanelBody flush>
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Released</TableHead>
              <TableHead className="text-right">Typical</TableHead>
              <TableHead className="text-right">Mean</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Amended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <PanelError what="turnaround" error={error} onRetry={onRetry} />
                </TableCell>
              </TableRow>
            ) : loading ? (
              <SkeletonRows rows={4} columns={6} />
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    compact
                    icon={Timer}
                    title="No results released in this range"
                    description="Turnaround is measured on released reports, so it fills in as work completes."
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const backlog = backlogFor(row.category_name);
                const waiting = (backlog?.awaiting_exam || 0) + (backlog?.awaiting_release || 0);
                return (
                  <TableRow key={row.category_name}>
                    <TableCell className="font-medium text-slate-900">{row.category_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.released}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatDuration(row.median_turnaround_minutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {formatDuration(row.avg_turnaround_minutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {waiting > 0 ? (
                        <span className="font-semibold text-amber-700">{waiting}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {row.amended > 0 && (
                          <span
                            title={`${row.amended} amended report${row.amended === 1 ? '' : 's'}`}
                            className="rounded-md bg-amber-50 px-1.5 py-0.5 text-micro font-semibold leading-5 text-amber-800 ring-1 ring-inset ring-amber-200"
                          >
                            {row.amended}
                          </span>
                        )}
                        {row.amended === 0 && <span className="text-slate-400">—</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  );
};
