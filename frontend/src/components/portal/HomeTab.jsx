import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle, ClipboardList, FileText, Info, Receipt, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import PortalBand from './PortalBand';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import { SkeletonList } from '../ui/skeleton';
import { greeting } from '../../lib/today';
import { todayStr, formatAppointmentDate, formatTime12 } from '../../lib/date';
import { nextVisit, latestResults, isNewResult, attentionItems, figure } from '../../lib/portalSummary';
import { cn } from '../../lib/utils';

// A wallet for money, a list for what to do before a visit. Both are amber — each asks something
// of the patient — but the shape says which, so the tone is never the only difference.
const NEED_ICON = { error: AlertTriangle, amber: Wallet, prepare: ClipboardList, info: Info };
const NEED_TONE = {
  error: 'bg-rose-50 text-rose-700',
  amber: 'bg-amber-50 text-amber-800',
  prepare: 'bg-amber-50 text-amber-800',
  info: 'bg-azure-50 text-azure-700',
};

/** One of the four figures across the band's lower edge. Each opens the tab it summarises. */
function SummaryTile({ tile, label, icon: Icon, value, caption, onClick }) {
  return (
    <button
      type="button"
      data-testid="portal-tile"
      data-tile={tile}
      onClick={onClick}
      className="flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-xl border border-line bg-surface p-3.5 text-left shadow-float transition-all hover:-translate-y-0.5 hover:shadow-overlay sm:p-4"
    >
      <span className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className="max-w-full break-words text-lead font-bold leading-tight text-ink sm:text-xl">{value}</span>
      {caption && <span className="text-fine leading-snug text-ink-muted">{caption}</span>}
    </button>
  );
}

/**
 * The portal's first tab: what is coming up, what needs doing, and what is new. [1.81.0]
 *
 * Layout A2 from the gallery Steven picked, in the Flat colouring. Four tiles straddle the band —
 * Next visit, Results, Payments, Family — then "Needs your attention" and the latest results.
 * Every figure is read from the hooks the other tabs already use (lib/portalSummary.js), and a
 * figure whose read failed says "—" rather than a zero it never had.
 *
 * `bookButton` is the dashboard's one booking dialog, so Home and Appointments offer the same one.
 */
export default function HomeTab({ profiles, results, bookings, payments, onOpenTab, refresh, bookButton, feedback = [], onRate }) {
  const { user } = useAuth();
  const now = new Date();
  const today = todayStr();
  const patientId = profiles.selectedId;
  const hasProfile = profiles.profiles.length > 0;

  const next = nextVisit(bookings.appointments, { patientId, today });
  const needs = attentionItems({
    appointments: bookings.appointments, patientId, today, hasProfile, bookingsFailed: Boolean(bookings.error), feedback,
  });
  const latest = latestResults(results.history, 3);
  const receipts = payments.payments.length;
  const lastPaid = payments.payments[0]?.paid_at;
  const family = profiles.profiles.length;

  return (
    <div className="space-y-5">
      <PortalBand
        title={`${greeting(now)}${user?.firstName ? `, ${user.firstName}` : ''}`}
        subtitle="Book Laboratory, Ultrasound and X-Ray visits, pay ahead, and read your reports."
        actions={bookButton}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryTile
            tile="next"
            label="Next visit"
            icon={CalendarClock}
            value={figure(
              { failed: Boolean(bookings.error), loading: bookings.loading },
              next ? formatAppointmentDate(next.scheduled_date) : 'None booked'
            )}
            caption={!bookings.error && !bookings.loading && next ? formatTime12(next.scheduled_time) : null}
            onClick={() => onOpenTab('appointments')}
          />
          <SummaryTile
            tile="results"
            label="Results"
            icon={FileText}
            value={figure({ failed: Boolean(results.error), loading: results.loading }, `${results.completedCount} ready`)}
            caption={!results.error && !results.loading && results.pendingCount > 0 ? `${results.pendingCount} not released yet` : null}
            onClick={() => onOpenTab('results')}
          />
          <SummaryTile
            tile="payments"
            label="Payments"
            icon={Receipt}
            value={figure(
              { failed: Boolean(payments.error), loading: payments.loading },
              `${receipts} receipt${receipts === 1 ? '' : 's'}`
            )}
            // The only figure on Home with no list of its own beneath it, so it carries its own
            // caption when its read fails (CLAUDE.md, "A counter that could not load").
            caption={payments.error
              ? "Couldn't check"
              : !payments.loading && lastPaid ? `Last paid ${formatAppointmentDate(lastPaid)}` : null}
            onClick={() => onOpenTab('payments')}
          />
          <SummaryTile
            tile="family"
            label="Family"
            icon={Users}
            value={String(family)}
            caption={`${family === 1 ? 'profile' : 'profiles'} on this account`}
            onClick={() => onOpenTab('profile')}
          />
        </div>
      </PortalBand>

      {refresh && <div className="flex justify-end">{refresh}</div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data-testid="portal-attention" className="overflow-hidden">
          <PanelHeader title="Needs your attention" icon={AlertTriangle} />
          <PanelBody flush>
            {bookings.loading && !bookings.error ? (
              <div className="p-4"><SkeletonList rows={2} /></div>
            ) : needs.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle}
                title="Nothing needs you right now"
                description="Anything to pay, to prepare for, or to rate shows up here."
              />
            ) : (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {needs.map((need) => {
                  const Icon = NEED_ICON[need.tone] || Info;
                  return (
                    <li
                      key={need.id}
                      data-testid="portal-need"
                      data-need={need.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
                    >
                      <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', NEED_TONE[need.tone])}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-note font-semibold text-ink">{need.title}</span>
                        <span className="block text-fine leading-relaxed text-ink-muted">{need.detail}</span>
                      </span>
                      {need.action && (
                        <Button
                          size="sm"
                          variant={need.id.startsWith('pay-') ? 'default' : 'outline'}
                          onClick={() => (need.feedbackVisit ? onRate?.(need.feedbackVisit) : onOpenTab(need.tab))}
                        >
                          {need.action}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelBody>
        </Panel>

        <Panel data-testid="portal-latest-results" className="overflow-hidden">
          <PanelHeader title="Latest results" icon={FileText} />
          <PanelBody flush>
            {results.error ? (
              <EmptyState
                tone="error"
                compact
                title="Couldn't load your results"
                description={results.error}
                action={<Button variant="outline" size="sm" onClick={results.reload}>Try again</Button>}
              />
            ) : results.loading ? (
              <div className="p-4"><SkeletonList rows={2} /></div>
            ) : latest.length === 0 ? (
              <EmptyState
                compact
                icon={FileText}
                title="No results released yet"
                description="A report appears here, and under Results, once the clinic releases it."
              />
            ) : (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {latest.map((r) => (
                  <li key={r.visit_test_id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-note font-semibold text-ink">{r.test_name}</span>
                      <span className="block text-fine text-ink-muted">
                        {r.category_name}
                        {r.released_at ? ` · released ${formatAppointmentDate(r.released_at)}` : ''}
                      </span>
                    </span>
                    {isNewResult(r, now) && (
                      <span className="flex-shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-micro font-bold text-brand-700 ring-1 ring-inset ring-brand-200">
                        New
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
