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
 * ── Why the arrival time is SECOND but no longer quiet ──────────────────────────────────────
 *
 * Both halves of this matter, and they pull in opposite directions. Change one without reading
 * the other and you will undo a decision that was made on purpose.
 *
 * SECOND, and smaller than the appointment time. The appointment time is the fact; the arrival
 * time is the instruction. Leading with the instruction — "Arrive 8:45 (appointment 9:00)" —
 * makes patients treat 8:45 as the real time, and next time they arrive at 8:30 to be safe.
 * Order and size are what keep them two facts rather than one fact being corrected.
 *
 * BOLD and amber, though. [1.66.0] It used to be `text-micro text-ink-muted` trailing the
 * appointment on the same line — the smallest size and the weakest colour in the system — and
 * the clinic reported that patients were simply not seeing it. Their patients are mostly
 * middle-aged and not especially comfortable with software, and a muted 11px clause is not an
 * instruction to that reader; it is decoration.
 *
 * So the weight comes from colour, boldness and its own row, NOT from size or order. That is the
 * whole trick: unmissable without being promoted above the thing it qualifies. Amber because the
 * preparation callout on the same card already uses it and index.css redefines the ramp for dark
 * mode, so it is proven in both themes rather than invented here.
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
          // `basis-full` so it takes its own row rather than trailing the appointment as a clause.
          // The parent is already flex-wrap, so no call site changes.
          <span className="flex basis-full items-center gap-1 text-fine font-bold text-amber-900">
            <LogIn className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Please arrive by {times.arrival}
          </span>
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
          <LogIn className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5 text-amber-900" aria-hidden="true" />
          <span>
            {/* "Recommended arrival" read as optional, which is not what the clinic means. Both
                variants ask in the same words now — the component exists so these cannot drift. */}
            <span className="block text-micro font-semibold uppercase tracking-wide text-ink-muted">
              Please arrive by
            </span>
            <span className="block text-note font-bold text-amber-900">
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
