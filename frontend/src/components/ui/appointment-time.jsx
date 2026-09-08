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
 * The reason is stated too — "for check-in at the front desk" is why the earlier time exists. An
 * unexplained instruction to come early reads as the clinic padding its own schedule, and patients
 * discount it accordingly.
 *
 * It sits on its OWN line in the stacked variant. [1.68.0] It used to trail the time, so the label
 * "PLEASE ARRIVE BY" opened a sentence that the value line finished — one sentence across two type
 * treatments, ending in a hyphenated compound that read as a token rather than as English. Keep
 * label, value and reason on three lines; do not fold the reason back onto the time.
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
    // Side by side once there is room, stacked on a phone. [1.69.0] The two times are a PAIR —
    // one fact and the instruction that qualifies it — and reading them across rather than down
    // makes that relationship visible instead of implied.
    //
    // `sm:` (640px) and not smaller: mobile-patient.spec.js runs at 390px, where two columns would
    // squeeze "for check-in at the front desk" into a ragged stack of three words. Breakpoints are
    // viewport-based, so the max-w-xl (576px) dialog still gets two columns on a desktop — about
    // 270px each, which both labels and the reason line fit inside.
    <span className={cn('grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4', className)}>
      {/* Flush left, flush right. [1.69.1] BookingConfirmation's card carries `text-center`, so
          without these each block centred inside its own half and the pair drifted toward the
          middle with dead space at both edges. `text-left` keeps each block's own lines aligned to
          each other — only the BLOCKS move apart, not the words inside them. */}
      <span className="flex items-baseline gap-1.5 text-left sm:justify-self-start">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5 text-ink-muted" aria-hidden="true" />
        <span>
          <span className="block text-micro font-semibold uppercase tracking-wide text-ink-muted">
            Scheduled service {slotMinutes ? 'window' : 'time'}
          </span>
          <span className="block text-note font-bold text-ink">{times.window}</span>
        </span>
      </span>

      {showArrival && (
        <span className="flex items-baseline gap-1.5 text-left sm:justify-self-end">
          <LogIn className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5 text-amber-900" aria-hidden="true" />
          <span>
            {/* "Recommended arrival" read as optional, which is not what the clinic means. Both
                variants ask in the same words now — the component exists so these cannot drift. */}
            <span className="block text-micro font-semibold uppercase tracking-wide text-ink-muted">
              Please arrive by
            </span>
            <span className="block text-note font-bold text-amber-900">{times.arrival}</span>
            {/* Its own line, not trailing the time. [1.68.0] "PLEASE ARRIVE BY" is a label and
                "8:45 AM for front-desk check-in" was a value, so one sentence ran across two type
                treatments and the reader had to stitch it together. The hyphenated compound made
                the tail read as a token rather than as English.

                The reason STAYS rather than being dropped for tidiness: an unexplained instruction
                to come early reads as the clinic padding its own schedule, and patients discount
                it accordingly. It just says where to go, in words. */}
            <span className="block text-micro text-ink-muted">for check-in at the front desk</span>
          </span>
        </span>
      )}
    </span>
  );
};

export default AppointmentTime;
