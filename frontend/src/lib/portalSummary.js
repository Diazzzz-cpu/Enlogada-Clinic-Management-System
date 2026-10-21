import { toDateInput, formatAppointmentDate, formatTime12 } from './date';
import { formatCurrency } from './currency';
import { issuesReports } from './categories';

/**
 * What the patient portal's Home says, worked out from what its tabs already hold. [1.81.0]
 *
 * No endpoint of its own. The next visit, what is owed and what is new all come from the same
 * bookings, results and payments the tabs read, so Home cannot disagree with the tab it opens.
 * Pure, so the rules are unit-tested (tests/unit/portalSummary.test.js).
 */

/** A released result is marked New on Home for this many days. */
export const RECENT_RESULT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isOpenBooking = (a) => Boolean(a) && a.status !== 'Cancelled' && a.status !== 'Completed';

/**
 * A booking's date as YYYY-MM-DD, local. The API sends `scheduled_date` as the UTC instant of local
 * midnight, so local getters give back the calendar date the patient booked (lib/date.js).
 */
export function bookingDay(appt) {
  if (!appt?.scheduled_date) return null;
  const d = new Date(appt.scheduled_date);
  return Number.isNaN(d.getTime()) ? null : toDateInput(d);
}

const timeKey = (appt) => String(appt?.scheduled_time || '').slice(0, 5) || '99:99';
const forPatient = (patientId) => (a) => patientId == null || String(a.patient_id) === String(patientId);

/**
 * Open bookings from today on, soonest first. An account's bookings cover every profile on it, so
 * `patientId` narrows them to the patient being viewed; null keeps them all.
 */
export function upcomingBookings(appointments = [], { patientId = null, today }) {
  return appointments
    .filter(isOpenBooking)
    .filter(forPatient(patientId))
    .filter((a) => {
      const day = bookingDay(a);
      return day !== null && day >= today;
    })
    .sort((a, b) => `${bookingDay(a)} ${timeKey(a)}`.localeCompare(`${bookingDay(b)} ${timeKey(b)}`));
}

export function nextVisit(appointments = [], options) {
  return upcomingBookings(appointments, options)[0] || null;
}

/**
 * What is still to pay: upcoming bookings not yet paid. A booking whose day has passed is not
 * asked for money here — an unattended visit is not a bill.
 */
export function owing(appointments = [], options) {
  const rows = upcomingBookings(appointments, options).filter((a) => !a.is_paid && Number(a.amount_due) > 0);
  return { rows, total: rows.reduce((sum, a) => sum + Number(a.amount_due), 0) };
}

const releasedTime = (r) => {
  const t = new Date(r.released_at || r.visit_date || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** The newest released results, whatever their age. */
export function latestResults(history = [], limit = 3) {
  return history
    .filter((r) => r.test_status === 'Completed')
    // An X-ray exam marked done has no report here [1.129.0]: there is nothing to open.
    .filter((r) => issuesReports(r.category_name) || r.file_path)
    .sort((a, b) => releasedTime(b) - releasedTime(a))
    .slice(0, limit);
}

/** Released in the last RECENT_RESULT_DAYS days. */
export function isNewResult(result, now, days = RECENT_RESULT_DAYS) {
  if (!result?.released_at) return false;
  const t = new Date(result.released_at).getTime();
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age < days * DAY_MS;
}

/** "Sep 15, 2026, 9:00 AM" */
export const visitWhen = (appt) => `${formatAppointmentDate(appt.scheduled_date)}, ${formatTime12(appt.scheduled_time)}`;

/**
 * What Home lists under "Needs your attention", as descriptors the screen draws. Each thing to DO
 * appears once, with the one button that deals with it; `tab` is where that button goes.
 *
 * News is not here. A newly released result is on Home's "Latest results", and listing it twice
 * would be the same fact said in two places.
 */
export function attentionItems({
  appointments = [], patientId = null, today, bookingsFailed = false, hasProfile = true, feedback = [],
  invitations = [], invitesNeedEmailCheck = false, invitesFailed = false,
}) {
  // [1.136.0] Records the clinic invited this account to accept. First, and in place of "Add a
  // patient profile": a person told to add their mother by hand while her clinic record waits for
  // them makes a second record of her.
  const waiting = invitesNeedEmailCheck
    ? [{
        id: 'record-email-check',
        tone: 'info',
        title: 'Confirm your email to see a record waiting',
        detail: 'The clinic has a record for this account. Confirm your address first.',
        action: 'Confirm email',
        acceptInvitation: { emailCheck: true },
      }]
    : invitations.map((inv) => ({
        id: `record-${inv.id}`,
        tone: 'info',
        title: `A record is waiting: ${inv.patientName}`,
        detail: inv.forSelf
          ? 'Your record from the clinic. Add it to see your visits, reports and receipts here.'
          : `The clinic invited you to see this record, as their ${String(inv.relationshipLabel || 'family member').toLowerCase()}.`,
        action: 'Review',
        acceptInvitation: inv,
      }));
  const invitesError = invitesFailed
    ? [{
        id: 'invites-failed',
        tone: 'error',
        title: "Couldn't check for records waiting for you",
        detail: 'Refresh to try again.',
      }]
    : [];

  if (!hasProfile) {
    // Something waiting, or a check that failed, is the thing to say; "add a profile" would be a
    // claim nobody could check.
    if (waiting.length || invitesError.length) return [...waiting, ...invitesError];
    return [{
      id: 'no-profile',
      tone: 'info',
      title: 'Add a patient profile',
      detail: 'A booking belongs to a patient: you, or someone in your family.',
      action: 'Add a profile',
      tab: 'profile',
    }];
  }
  // Everything below is read from the bookings. When they did not load, that is the one thing
  // to say — "nothing needs you" would be a claim about bookings nobody could read.
  if (bookingsFailed) {
    return [...waiting, ...invitesError, {
      id: 'bookings-failed',
      tone: 'error',
      title: "Couldn't check your bookings",
      detail: 'Your bookings are safe. Refresh to try again.',
    }];
  }

  const items = [...waiting, ...invitesError, ...owing(appointments, { patientId, today }).rows.map((a) => ({
    id: `pay-${a.id}`,
    tone: 'amber',
    title: `Pay for your visit on ${formatAppointmentDate(a.scheduled_date)}`,
    detail: `${formatCurrency(a.amount_due)}. Your booking pass appears once it is paid.`,
    action: 'Pay',
    tab: 'appointments',
  }))];

  const next = nextVisit(appointments, { patientId, today });
  const notes = (next?.preparation_notes || []).filter(Boolean);
  if (next && notes.length) {
    items.push({
      id: `prepare-${next.id}`,
      tone: 'prepare',
      title: `Before your visit on ${formatAppointmentDate(next.scheduled_date)}`,
      detail: notes.length > 1 ? `${notes[0]} And ${notes.length - 1} more.` : notes[0],
      action: 'See booking',
      tab: 'appointments',
    });
  }

  // [1.112.0] A finished visit not yet rated, for the profile on screen. Last, because it is an
  // invitation, not something they have to do; and `feedbackVisit` rather than a tab, because the
  // button opens the form where they are.
  feedback
    // forPatient: the selected profile's id arrives as a string, the API's as a number.
    .filter(forPatient(patientId))
    .forEach((v) => items.push({
      id: `rate-${v.visit_id}`,
      tone: 'info',
      title: `How was your visit on ${formatAppointmentDate(v.visit_date)}?`,
      detail: 'Tell the clinic how it went. It takes a minute.',
      action: 'Rate visit',
      feedbackVisit: v,
    }));
  return items;
}

/** A tile's figure: "—" when its read failed, "…" while it loads, never a zero it does not have. */
export function figure({ failed = false, loading = false }, value) {
  if (failed) return '—';
  if (loading) return '…';
  return value;
}
