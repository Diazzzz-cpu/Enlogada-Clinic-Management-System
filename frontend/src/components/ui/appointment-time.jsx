import React from 'react';
import { Clock, LogIn } from 'lucide-react';
import { cn } from '../../lib/utils';
import { appointmentTimes } from '../../lib/appointmentTime';

/**
 * "Scheduled 9:00 AM · Please arrive by 8:45 AM for check-in." [1.63.0]
 *
 * One component so the confirmation, the portal list and the booking pass cannot drift into
 * saying it three ways — which is what happened to the seventeen mono treatments `DataBadge`
 * replaced, and to the ETA before `EtaBadge`.
 *
 * ── Why the arrival time is SECOND and quieter ──────────────────────────────────────────────
 *
 * The appointment time is the fact; the arrival time is the instruction. Leading with the
 * instruction — "Arrive 8:45 (appointment 9:00)" — makes patients treat 8:45 as the real time,
 * and next time they arrive at 8:30 to be safe. Order and weight are what keep them two facts
 * rather than one fact being corrected.
 *
 * The reason is stated too: "for front-desk check-in" is why the earlier time exists. An
 * unexplained instruction to come early reads as the clinic padding its own schedule, and
 * patients discount it accordingly.
 */
const AppointmentTime = ({
  scheduledTime,
  slotMinutes = null,
  /** `stacked` for a card with room; `inline` for a dense list row. */
  variant = 'stacked',
  className,
}) => {
  const times = appointmentTimes(scheduledTime, slotMinutes);
  if (!times) return null;

  // No arrival line rather than a wrong one: an unparseable time still shows the slot it came
  // from, which is exactly what this component replaced and is never worse than nothing.
  const showArrival = Boolean(times.arrival);

  if (variant === 'inline') {
    return (
      <span className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
        <span className="text-fine font-semibold text-ink">{times.window}</span>
        {showArrival && (
          <span className="text-micro text-ink-muted">arrive by {times.arrival}</span>
        )}
      </span>
    );
  }

  return (
    <span className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-baseline gap-1.5">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5 text-ink-muted" aria-hidden="true" />
        <span>
          <span className="block text-micro font-semibold uppercase tracking-wide text-ink-muted">
            Scheduled service {slotMinutes ? 'window' : 'time'}
          </span>
          <span className="block text-note font-bold text-ink">{times.window}</span>
        </span>
      </span>

      {showArrival && (
        <span className="flex items-baseline gap-1.5">
          <LogIn className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5 text-brand-600" aria-hidden="true" />
          <span>
            <span className="block text-micro font-semibold uppercase tracking-wide text-ink-muted">
              Recommended arrival
            </span>
            <span className="block text-note font-semibold text-brand-800">
              {times.arrival}
              <span className="ml-1 font-normal text-ink-muted">for front-desk check-in</span>
            </span>
          </span>
        </span>
      )}
    </span>
  );
};

export default AppointmentTime;
