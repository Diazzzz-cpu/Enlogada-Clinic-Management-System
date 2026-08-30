import React, { useEffect, useState } from 'react';
import { CalendarPlus, FileText, Users, ArrowRight } from 'lucide-react';
import api from '../../config/api';
import { cn } from '../../lib/utils';

/**
 * The three things a visitor comes to this site to do. [1.63.0]
 *
 * ── Why a dock rather than more hero buttons ────────────────────────────────────────────────
 *
 * The hero already had two calls to action — "Book Now" and "View Services" — and they sit inside
 * the dark banner competing with a headline. Somebody arriving to check a result had to read past
 * a marketing paragraph to find out there was nowhere obvious to go.
 *
 * The dock straddles the seam between the hero and the page, which is where the eye lands after
 * the headline, and it names the three ERRANDS rather than the sections of a website. "View
 * Results" is a thing a person came to do; "Patient Portal" is a thing we call a screen.
 *
 * ── The third card carries live data, which is why it earns a place ─────────────────────────
 *
 * Two cards that both go to a sign-in page and one that does something is a worse dock than three
 * that all do something. `GET /visits/queue-status` is public and aggregate-only — two counts and
 * a wait estimate, no name, no ticket, nothing joinable to a person — so a patient can decide
 * whether to set off now or after lunch without an account.
 *
 * It fails quietly. A clinic whose backend is unreachable shows a dock with two working cards and
 * a third that simply omits the number, rather than a home page carrying an error nobody visiting
 * it can act on.
 */

const ACTIONS = [
  {
    id: 'book',
    label: 'Book an Appointment',
    description: 'Choose a service and a time that suits you.',
    icon: CalendarPlus,
    tab: 'login',
    primary: true,
  },
  {
    id: 'results',
    label: 'View My Results',
    description: 'Released reports, in your own portal.',
    icon: FileText,
    tab: 'login',
  },
];

/**
 * Polls only while the page is visible.
 *
 * A home page left open on a spare monitor would otherwise poll all day for a number nobody is
 * reading. `visibilitychange` is the cheap fix, and it matters more here than on a staff console:
 * this endpoint is unauthenticated, so every open tab in the world is traffic the clinic pays for.
 */
function useQueueStatus() {
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await api.get('/visits/queue-status');
        if (!cancelled) setQueue(res.data.data.queue);
      } catch {
        // Silent. A visitor cannot act on "the queue count failed to load", and a home page that
        // announces its own backend problems is worse than one that shows two cards instead of
        // three.
        if (!cancelled) setQueue(null);
      }
    };

    load();
    timer = window.setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  return queue;
}

const HeroQuickDock = ({ onNavigate }) => {
  const queue = useQueueStatus();

  const go = (tab) => onNavigate && onNavigate(tab);

  return (
    // Negative margin pulls it across the hero's lower edge, so it reads as one object bridging
    // the two sections rather than as the first row of the page below.
    <div className="relative z-20 -mt-10 sm:-mt-12">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 px-4 sm:grid-cols-3 sm:gap-4 sm:px-6">
        {ACTIONS.map(({ id, label, description, icon: Icon, tab, primary }) => (
          <button
            key={id}
            type="button"
            onClick={() => go(tab)}
            className={cn(
              'group flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 text-left shadow-float transition-all',
              'hover:-translate-y-0.5 hover:shadow-overlay',
              primary ? 'border-brand-200 ring-1 ring-inset ring-brand-100' : 'border-line'
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                primary ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-ink-soft'
              )}
            >
              <Icon className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-note font-bold text-ink">
                {label}
                <ArrowRight
                  className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-0.5 block text-fine leading-relaxed text-ink-muted">{description}</span>
            </span>
          </button>
        ))}

        {/* The live card. Not a button — there is nowhere better to send somebody than the number
            itself, and a card that looks clickable and merely reloads is a small lie. */}
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-float">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-azure-100 text-azure-700">
            <Users className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-note font-bold text-ink">Clinic Right Now</span>

            {queue ? (
              <>
                <span className="mt-0.5 block text-fine leading-relaxed text-ink-muted">
                  {queue.waiting === 0
                    ? 'No one is waiting — walk in any time.'
                    : `${queue.waiting} ${queue.waiting === 1 ? 'person' : 'people'} waiting`}
                </span>
                {queue.waiting > 0 && queue.estimatedWaitMinutes != null && (
                  <span className="mt-1 inline-flex items-center rounded-md bg-azure-50 px-1.5 py-0.5 text-micro font-semibold text-azure-800 ring-1 ring-inset ring-azure-200">
                    {queue.estimateIsCapped
                      ? 'over 90 min wait'
                      : `about ${queue.estimatedWaitMinutes} min wait`}
                  </span>
                )}
              </>
            ) : (
              // The card keeps its shape while loading, and if the fetch never succeeds it simply
              // says what the clinic's hours are for. No spinner, no error — a visitor is not
              // waiting on this.
              <span className="mt-0.5 block text-fine leading-relaxed text-ink-muted">
                Walk-ins welcome during clinic hours.
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HeroQuickDock;
