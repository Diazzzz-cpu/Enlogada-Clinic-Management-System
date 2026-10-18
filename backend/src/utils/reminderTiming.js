/**
 * When an appointment's reminder goes out. [1.130.0]
 *
 * Steven: send it the day before, and when the booking is closer than that, at half the time that
 * is left (30 minutes away: 15 minutes before; 2 hours away: 1 hour before). That rule, with three
 * guards it needs:
 *
 *   1. THE EVENING BEFORE, at 18:00, not 24 hours before. Preparation is the reason the reminder
 *      matters most ("nothing to eat or drink after 10 PM"), and it can be acted on in the evening.
 *      Twenty-four hours before an 08:00 appointment is 08:00 the day before, at work.
 *
 *   2. A booking made after that moment gets one HALFWAY between the booking and the appointment,
 *      Steven's rule, but:
 *        - never within 30 minutes of the booking. The confirmation email went out the moment it
 *          was booked, with the same date, time and preparation; a second email minutes later
 *          says it again. So a booking 30 minutes away gets no reminder (the confirmation is it),
 *          and one 2 hours away gets one an hour before.
 *        - never at night (21:00 to 07:00). A halfway point at 03:00 for an 08:00 appointment
 *          moves to 07:00, when it will be read.
 *        - never under 30 minutes before the appointment, when it can no longer help.
 *
 *   3. Sent late rather than never, within reason. A sweep that was not running at the due time
 *      (the server was off) still sends it when it next runs, unless that is at night (it waits
 *      for the morning) or the appointment is under 15 minutes away (too late to be of use).
 *
 * Pure: every function takes the moments it needs and reads no clock, so the rules are tested in
 * tests/unit/reminderTiming.test.js. Times are the server's local time, which is the clinic's.
 */

const MINUTE = 60 * 1000;

const DEFAULTS = Object.freeze({
  eveningHour: 18,        // the evening before
  quietStart: 21,         // no email from 21:00 ...
  quietEnd: 7,            // ... until 07:00
  minAfterBooking: 30,    // minutes: sooner after the confirmation is the same email twice
  minBeforeStart: 30,     // minutes: a reminder is planned at least this long before
  lateCutoff: 15,         // minutes: a reminder sent late is still sent if at least this long before
});

const inQuietHours = (date, { quietStart, quietEnd } = DEFAULTS) => {
  const h = date.getHours();
  return quietStart > quietEnd ? (h >= quietStart || h < quietEnd) : (h >= quietStart && h < quietEnd);
};

/** The next moment quiet hours end, on or after `date`. */
const endOfQuiet = (date, { quietEnd } = DEFAULTS) => {
  const out = new Date(date);
  if (out.getHours() >= quietEnd) out.setDate(out.getDate() + 1);
  out.setHours(quietEnd, 0, 0, 0);
  return out;
};

/**
 * When the reminder for an appointment is due.
 *
 * `startsAt` is the appointment, `bookedAt` the last time the patient was emailed about this slot:
 * when it was booked, or when it was last moved (a reschedule sends its own email and clears the
 * reminder). Returns `{ at, kind }`, with `kind` 'evening-before' or 'short-notice', or
 * `{ at: null, kind: 'none', reason }` when the confirmation itself is the only email that fits.
 */
function reminderDueAt({ startsAt, bookedAt }, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const start = new Date(startsAt);
  const booked = new Date(bookedAt);

  const evening = new Date(start);
  evening.setDate(evening.getDate() - 1);
  evening.setHours(o.eveningHour, 0, 0, 0);
  if (evening - booked >= o.minAfterBooking * MINUTE) return { at: evening, kind: 'evening-before' };

  let at = new Date(booked.getTime() + (start - booked) / 2);
  if (inQuietHours(at, o)) at = endOfQuiet(at, o);

  if (at - booked < o.minAfterBooking * MINUTE) {
    return { at: null, kind: 'none', reason: 'booked too close to the appointment: the confirmation is the reminder' };
  }
  if (start - at < o.minBeforeStart * MINUTE) {
    return { at: null, kind: 'none', reason: 'no time left between the confirmation and the appointment' };
  }
  return { at, kind: 'short-notice' };
}

/**
 * What a sweep running at `now` does with one reminder: 'send', 'wait' (not due yet, or due during
 * quiet hours), or 'skip' (too late to help, or never due). A skip is final.
 */
function decide({ startsAt, bookedAt, now }, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const due = reminderDueAt({ startsAt, bookedAt }, o);
  if (!due.at) return { action: 'skip', due, reason: due.reason };
  const current = new Date(now);
  if (current < due.at) return { action: 'wait', due };
  if (new Date(startsAt) - current < o.lateCutoff * MINUTE) {
    return { action: 'skip', due, reason: 'missed: the appointment is too close for a reminder to help' };
  }
  if (inQuietHours(current, o)) return { action: 'wait', due };
  return { action: 'send', due };
}

module.exports = { reminderDueAt, decide, inQuietHours, REMINDER_TIMING: DEFAULTS };
