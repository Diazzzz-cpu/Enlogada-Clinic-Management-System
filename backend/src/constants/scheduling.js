/**
 * How long before their slot a patient should be at the desk. [1.63.0]
 *
 * ── The problem this names ──────────────────────────────────────────────────────────────────
 *
 * A booking carried exactly one time, everywhere it appeared: "9:00 AM". A patient reads that as
 * the time to arrive, so they arrive at 9:00, then queue at reception to check in, and the slot
 * they were given starts late through nobody's fault. The clinic counts that as a delay; the
 * patient experiences it as being kept waiting for an appointment they were on time for.
 *
 * Two times fix it, and they have to be named differently or the second is read as a correction
 * of the first:
 *
 *     Scheduled service window   09:00        when the clinic expects to see them
 *     Recommended arrival        08:45        when they should be at the front desk
 *
 * ── Why it lives here and is served to the frontend ─────────────────────────────────────────
 *
 * It is a CLINIC POLICY, not a fact about the data — a busy Saturday might want twenty minutes
 * and a quiet Tuesday ten. So it is configurable, and it is served through `GET /api/clinic`
 * alongside the other operational settings rather than being duplicated as a frontend constant.
 *
 * That matters more than it looks. The same figure has to appear on the booking confirmation, the
 * confirmation email, the patient's booking pass and the reminder that goes out the night before.
 * Four copies of "15" is four chances for a clinic to change the policy in three places, and the
 * one it misses is the email — the surface nobody re-reads.
 */

/**
 * Minutes before the scheduled slot that a patient should be at reception.
 *
 * Fifteen is a stated default, not a measurement: it is long enough to check in, present an HMO
 * card and settle at the counter, and short enough that a patient does not resent it. The clinic's
 * own measured front-desk wait — `getReceptionThroughput`'s median — is the figure to tune this
 * against once there is enough of it.
 *
 * Clamped to a sane range so a typo in the environment cannot produce "arrive 400 minutes early"
 * on a patient's email, or a negative lead that tells them to arrive after their own appointment.
 */
const DEFAULT_ARRIVAL_LEAD_MINUTES = 15;

function parseArrivalLead(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return DEFAULT_ARRIVAL_LEAD_MINUTES;
  return Math.min(Math.max(value, 0), 120);
}

const ARRIVAL_LEAD_MINUTES = parseArrivalLead(process.env.ARRIVAL_LEAD_MINUTES);

/**
 * The recommended arrival time for a scheduled slot.
 *
 * Pure string arithmetic on `HH:MM`, deliberately — `scheduled_time` is a Postgres `TIME` with no
 * date attached, so putting it through a `Date` would require inventing one, and inventing a date
 * is how a time acquires a timezone it never had. CLAUDE.md records that bug shipping three times
 * by other routes; this avoids the class entirely.
 *
 * Clamped at midnight rather than wrapping to the previous day: a 00:10 appointment is not a real
 * booking (the clinic opens at 08:00), and "arrive at 23:55 yesterday" is a worse answer than
 * "arrive at 00:00".
 *
 * @param {string} scheduledTime  'HH:MM' or 'HH:MM:SS'.
 * @param {number} [leadMinutes]  Defaults to the configured clinic policy.
 * @returns {string|null} 'HH:MM', or null if the input is not a readable time.
 */
function arrivalTimeFor(scheduledTime, leadMinutes = ARRIVAL_LEAD_MINUTES) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(scheduledTime || '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const total = Math.max(0, hours * 60 + minutes - leadMinutes);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

module.exports = { ARRIVAL_LEAD_MINUTES, DEFAULT_ARRIVAL_LEAD_MINUTES, arrivalTimeFor };
