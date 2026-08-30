import React from 'react';
import { Clock, Hourglass, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * How much longer this patient should expect to wait. Sibling to `wait-badge.jsx`. [1.63.0]
 *
 * ── Two different questions, and both are worth asking ──────────────────────────────────────
 *
 *   WaitBadge  "18m waiting"        — how long they HAVE waited. Backward-looking, measured.
 *   EtaBadge   "~20 min · 3 ahead"  — how much longer they WILL. Forward-looking, predicted.
 *
 * Staff act on the first (the oldest ticket is usually the priority) and patients ask the second.
 * They belong side by side, and the two consoles that show only one each are showing half.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────────
 *
 * `WaitBadge` was already the shared primitive for "time in a queue", with escalation thresholds
 * and an icon change so the state is not carried by colour alone. When predicted ETAs were added
 * in [1.62.0] they were hand-rolled inline in `ActiveQueuePanel` and again in `BookingPass`
 * instead of following that convention — so a receptionist saw a prediction with no elapsed time
 * while a cashier saw elapsed time with no prediction, in two visually unrelated treatments.
 * Extracting it here is the correction, and it is why the shape deliberately mirrors its sibling:
 * the two sit in the same row and must read as the same kind of object.
 *
 * ── Every word is hedged, and that is the design ────────────────────────────────────────────
 *
 * "About", and a figure rounded to five minutes. The estimate is a queue length times a measured
 * service rate; it cannot know that the patient in front needs three tests explained. A clinic
 * that says "18 minutes" has made a promise, one that says "about 20 minutes" has given an
 * estimate, and only the second is true.
 *
 * The head count sits beside the time because it is the half a patient can verify. A number
 * ticking 3 → 2 → 1 is visibly working; a bare time, from a system that has been wrong before,
 * is not believed.
 */

// Ordered longest-first; the first match wins. Thresholds are the patient's experience of a wait,
// not the clinic's: 45 minutes is where somebody starts asking, an hour is where they complain.
const LEVELS = [
  { minMinutes: 60, tone: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200', icon: AlertTriangle, note: 'Long wait expected' },
  { minMinutes: 45, tone: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200', icon: Hourglass, note: 'Longer than usual' },
  { minMinutes: 0, tone: 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200', icon: Clock, note: 'Expected wait' },
];

/**
 * @param {object} props
 * @param {number|null} [props.minutes]  `estimated_wait_minutes` from the API. Null renders nothing.
 * @param {number|null} [props.ahead]    `patients_ahead`. Null hides the head count, keeps the time.
 * @param {boolean} [props.capped]       The real estimate ran past the reportable ceiling.
 * @param {boolean} [props.compact]      Time only — for a dense table cell with no room for prose.
 * @param {string} [props.className]
 */
const EtaBadge = ({ minutes, ahead = null, capped = false, compact = false, className }) => {
  // Absent, not zero. A booking that is not in today's queue has no wait to state, and rendering
  // "0 min" would be a claim rather than an absence — see queueEstimateService, which returns null
  // for a visit already past the desk for exactly this reason.
  if (minutes === null || minutes === undefined) return null;

  const level = LEVELS.find((l) => minutes >= l.minMinutes) ?? LEVELS[LEVELS.length - 1];
  const Icon = level.icon;

  const time = capped ? 'over 90 min' : `~${minutes} min`;
  const crowd = ahead === null || ahead === undefined
    ? null
    : ahead === 0
      ? 'next'
      : `${ahead} ahead`;

  return (
    <span
      title={level.note}
      // The full sentence for a screen reader. "~20 min · 3 ahead" is a glanceable abbreviation
      // for a sighted reader and gibberish read aloud.
      aria-label={`${capped ? 'Over 90 minutes' : `About ${minutes} minutes`}${
        crowd ? `, ${ahead === 0 ? 'you are next' : `${ahead} patients ahead`}` : ''
      }`}
      className={cn(
        // Matched to WaitBadge: same radius, padding, size and weight, because the two sit
        // together in a queue row and one being a pill while the other is a tag made them look
        // like unrelated kinds of information.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-micro font-semibold tabular-nums leading-5',
        level.tone,
        className
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
      <span aria-hidden="true">
        {time}
        {!compact && crowd && <span className="font-normal opacity-80"> · {crowd}</span>}
      </span>
    </span>
  );
};

export default EtaBadge;
