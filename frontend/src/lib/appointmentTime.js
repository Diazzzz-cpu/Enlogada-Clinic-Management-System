import { formatTime12 } from './date';
import { getClinic } from './clinic';

/**
 * The two times a booking actually has. [1.63.0]
 *
 * ── One time was ambiguous, and the ambiguity cost the patient ──────────────────────────────
 *
 * A booking showed exactly one time — "9:00 AM" — on the confirmation, the pass, the email and
 * the portal list. A patient reads that as when to arrive, so they arrive at 9:00, queue at
 * reception to check in, and their 9:00 slot starts late. The clinic records a delay; the patient
 * experiences being kept waiting for an appointment they were on time for. Nobody was wrong, and
 * the screen never told either of them what it expected.
 *
 * Two named times remove it:
 *
 *     Scheduled service window   9:00 AM        when the clinic expects to see them
 *     Recommended arrival        8:45 AM        when to be at the front desk
 *
 * The naming carries the weight. "9:00, arrive 8:45" reads as a correction — as though the real
 * appointment were 8:45 — and a patient who believes that turns up at 8:30 next time. Labelling
 * both, in that order, is what makes them two facts rather than one fact revised.
 *
 * ── The lead time comes from the server ─────────────────────────────────────────────────────
 *
 * It is clinic policy (`ARRIVAL_LEAD_MINUTES`), served through `GET /api/clinic` beside the other
 * operational settings. Not a constant here: the same figure has to appear on four surfaces, one
 * of which is an email rendered server-side, and duplicating it is how a clinic changes the policy
 * in three places and misses the fourth.
 */

/** Fallback when the clinic config has not loaded yet. Matches the backend's own default. */
const DEFAULT_ARRIVAL_LEAD_MINUTES = 15;

/**
 * @returns {number} The configured lead, or the default if the server has not answered yet.
 */
export function arrivalLeadMinutes() {
  const raw = Number.parseInt(getClinic()?.arrivalLeadMinutes, 10);
  if (!Number.isFinite(raw)) return DEFAULT_ARRIVAL_LEAD_MINUTES;
  return Math.min(Math.max(raw, 0), 120);
}

/**
 * Subtracts the lead from an `HH:MM` slot time.
 *
 * String arithmetic, not `Date`. `scheduled_time` is a bare time with no date attached, so putting
 * it through a `Date` means inventing one — and an invented date is how a time acquires a timezone
 * it never had. CLAUDE.md records that class of bug shipping three times by other routes.
 *
 * @param {string} scheduledTime  'HH:MM' or 'HH:MM:SS'.
 * @param {number} [lead]
 * @returns {string|null} 'HH:MM', or null if unreadable.
 */
export function arrivalTimeFor(scheduledTime, lead = arrivalLeadMinutes()) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(scheduledTime || '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  // Clamped at midnight rather than wrapping: "arrive 23:55 yesterday" is a worse answer than
  // "arrive at 00:00", and the clinic does not open near midnight anyway.
  const total = Math.max(0, hours * 60 + minutes - lead);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The end of the service window, when the slot length is genuinely known.
 *
 * `slotMinutes` is NOT guessed. The booking dialog can supply it — it holds the full slot list and
 * consecutive slots are exactly one interval apart — but a booking pass rendered weeks later has
 * no such source, and `clinic_operating_hours.slot_interval_minutes` is per weekday and
 * overridable per date. Rather than plumb it through every surface, callers that do not know it
 * pass nothing and get no end time.
 *
 * Showing a window whose end is wrong is worse than showing only a start: a patient who reads
 * "9:00 – 9:30" plans the rest of their morning around 9:30.
 *
 * @param {string} scheduledTime
 * @param {number|null} [slotMinutes]
 * @returns {string|null} 'HH:MM', or null when the slot length is unknown.
 */
export function windowEndFor(scheduledTime, slotMinutes = null) {
  if (!slotMinutes || !Number.isFinite(Number(slotMinutes))) return null;
  return arrivalTimeFor(scheduledTime, -Math.abs(Number(slotMinutes)));
}

/**
 * Infers the slot length from a list of availability slots.
 *
 * The gap between consecutive slots IS the interval — the server generates them from
 * `slot_interval_minutes`, so this reads the real configured value rather than assuming 30.
 * Returns null for a list too short to tell, which is the honest answer.
 *
 * @param {Array<{time: string}>} slots
 * @returns {number|null} Minutes.
 */
export function inferSlotMinutes(slots) {
  if (!Array.isArray(slots) || slots.length < 2) return null;

  const toMinutes = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  const a = toMinutes(slots[0].time);
  const b = toMinutes(slots[1].time);
  if (a === null || b === null) return null;

  const gap = b - a;
  // A negative or absurd gap means the list is not what this assumes; say so by returning null
  // rather than rendering a window computed from nonsense.
  return gap > 0 && gap <= 240 ? gap : null;
}

/**
 * The two-tier presentation, formatted for display.
 *
 * @param {string} scheduledTime
 * @param {number|null} [slotMinutes]
 * @returns {{window: string, arrival: string|null, arrivalLead: number}|null}
 */
export function appointmentTimes(scheduledTime, slotMinutes = null) {
  if (!scheduledTime) return null;

  const lead = arrivalLeadMinutes();
  const arrival = arrivalTimeFor(scheduledTime, lead);
  const end = windowEndFor(scheduledTime, slotMinutes);

  return {
    window: end
      ? `${formatTime12(scheduledTime)} – ${formatTime12(end)}`
      : formatTime12(scheduledTime),
    arrival: arrival ? formatTime12(arrival) : null,
    arrivalLead: lead,
  };
}
