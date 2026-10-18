/**
 * Date helpers for the clinic's LOCAL day.
 *
 * Four screens each defined their own `todayStr` as
 * `new Date().toISOString().slice(0, 10)`, which is the **UTC** date, not the local one. The
 * clinic runs in Philippine time (UTC+8), so between midnight and 08:00 every single day that
 * expression returns *yesterday*. The consequences are all silent and all wrong in the same
 * direction:
 *
 *   - the Admin overview's "Today's Revenue" shows yesterday's takings,
 *   - Visit History and Transaction History open on yesterday's range,
 *   - a receptionist arriving for an 08:00 shift can be looking at the previous day's numbers.
 *
 * Nothing errors, so it reads as a quiet morning rather than a bug. The backend has always been
 * consistent about this — Postgres CURRENT_DATE is the server's local date, and
 * appointmentService already had a local-date helper for exactly this reason — so the frontend
 * was also disagreeing with the very rows it was asking for.
 *
 * These build the string from local getters instead, which is what every caller meant.
 */

/** Today, as YYYY-MM-DD in the clinic's local timezone. */
export const todayStr = () => toDateInput(new Date());

/** N days before today, as YYYY-MM-DD local. */
export const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
};

/**
 * Formats a Date as the YYYY-MM-DD an <input type="date"> and the API both expect.
 *
 * Uses local getters rather than toISOString() — see the note above.
 */
export function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whole years between a birthdate and today, or null when there is no usable date.
 *
 * Written out rather than done with a millisecond division: a year is not a fixed number of
 * milliseconds, and dividing by 365.25 puts somebody one day either side of their birthday into
 * the wrong year. That matters here because diagnostic reference ranges are banded by age, and
 * the bands have hard edges — a paediatric range and an adult one are different documents.
 *
 * Local getters throughout, per the rule at the top of this file: the API serialises a DATE as a
 * UTC instant, so a birthdate read with UTC getters is a day early everywhere east of Greenwich.
 */
export function ageFromBirthdate(value) {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/**
 * A date and time, written the way the rest of this app writes dates. [1.28.0]
 *
 * Ten screens rendered timestamps with a bare `toLocaleString()`, which returns whatever the
 * browser is set to — "8/18/2026, 2:49:29 AM" on a US-locale machine, sitting on the same page
 * as "Aug 18, 2026" from the tables that pass explicit options. Two formats for the same fact,
 * decided by a setting nobody in the clinic knows they have.
 *
 * `undefined` for the locale is deliberate: the reader's own language and numerals still apply.
 * What is pinned is the SHAPE — a written month, so 08/09 is never read as the ninth of August
 * in one place and the eighth of September in another. The clinic is Philippine and its staff
 * read both conventions; a written month is the one form that cannot be misread.
 *
 * Seconds are dropped. They were shown on every audit row and no one has ever needed them to the
 * second; they made a column of timestamps harder to scan for no gain.
 */
export function formatDateTime(value, { seconds = false } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit', hour12: true,
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

/** Just the date, same shape: "Aug 18, 2026". */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * An appointment's date, as the patient reads it. [1.29.0]
 *
 * Lifted out of ClientDashboard.jsx when the booking dialog was extracted — the page and the
 * dialog both need it, so it belongs to neither. Reception had written its own identical copy,
 * on the same field and carrying the same note; that copy is gone and this one absorbed its
 * unparseable-value guard.
 *
 * The API always sends `scheduled_date` as a full ISO instant (pg parses the SQL DATE column with
 * the local-timezone constructor server-side, then JSON serialises that to UTC). `new Date(...)`
 * parses the instant correctly and toLocaleDateString converts it back to the browser's local
 * calendar date, so no manual timezone arithmetic is needed — and none should be added, which is
 * the whole reason this note travels with the function.
 */
export function formatAppointmentDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  // Show whatever we were given rather than the string "Invalid Date". A reference or a booking
  // that arrives in an unexpected shape is a thing a receptionist can read out and report; the
  // browser's failure message is not.
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A clock time as a patient reads it. "09:30" -> "9:30 AM". [1.36.0]
 *
 * The clinic runs on a 12-hour clock, and every stored time is 24-hour: `scheduled_time` is a
 * Postgres TIME, the availability grid emits zero-padded "HH:MM", and the reschedule endpoint
 * validates that shape. So this is a DISPLAY function and nothing more — the value it is given is
 * never the value that is sent back. Formatting on the way out and leaving the wire format alone
 * is what keeps a booking round-tripping through an API that has not changed.
 *
 * Written out rather than routed through toLocaleTimeString, for two reasons. The stored value is
 * a bare "HH:MM" string with no date, and `new Date("09:30")` is Invalid Date — so a Date would
 * have to be fabricated around it first, which is where UTC-vs-local errors get in. And the locale
 * form is not pinned: `hour: 'numeric'` renders 24-hour on an en-GB browser, so the clinic's clock
 * would depend on a machine's regional settings rather than on the clinic.
 *
 * Accepts "HH:MM" and "HH:MM:SS" — Postgres returns seconds and several callers had been slicing
 * them off by hand, one of which had been missed and was showing "09:00:00" on the check-in panel.
 *
 * Midnight and noon are the cases hand-rolled versions get wrong: `12` is neither `0` nor `24`,
 * so `h % 12` alone renders both as "0:00". Both are covered by tests.
 */
export function formatTime12(value) {
  if (!value) return '—';
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!match) return '—';
  const hours = Number(match[1]);
  const minutes = match[2];
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return '—';
  const suffix = hours < 12 ? 'AM' : 'PM';
  // 0 -> 12 AM, 12 -> 12 PM, 13 -> 1 PM.
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/**
 * A date and a time as two pieces, for text that may wrap. [1.130.0]
 *
 * `formatDateTime` is one string, and a narrow table column broke it before "PM" ("Oct 18, 2026,
 * 7:35" / "PM"). `DateTime` (components/ui/date-time.jsx) keeps each piece whole, so a column can
 * only break between the date and the time.
 */
export function formatDateTimeParts(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
  };
}
