import { formatDuration } from './duration';
import { formatTime12, toDateInput } from './date';
import { paidVisitIds } from './collections';
import { categoryLabel } from './categories';
import { hoursOn } from './clinicStatus';

/**
 * The rules behind the Today screens. [1.77.0]
 *
 * Every member of staff now signs in to Today: what needs them now, each with a button that does
 * something about it, and how the day is going. Steven chose it on the decisions page ("A and B":
 * Today first in every sidebar, and the screen staff land on). Nothing here fetches. The page reads
 * the endpoints the work screens already read, and these turn the answers into what it shows —
 * pure and clock-injected, so the thresholds are unit-tested rather than trusted
 * (tests/unit/today.test.js).
 *
 * A need is a DESCRIPTOR, not a component: `{ id, tone, icon, title, detail, action }`. Its action
 * says where it goes (`go`, with an `intent` for the screen it opens) or what it runs (`run`), so
 * the rules are testable without rendering and the page decides how to act on them.
 *
 * One rule shapes all of them: a fact appears once per screen. A need is something waiting on THIS
 * person; a figure is how the day is going. The same count is never both.
 */

/**
 * What a figure shows for one read: "…" until it answers, "—" if it failed, the value once it has.
 * Never 0 for a failure — a figure is a claim about the clinic. [1.74.0]
 */
export function figureValue(read, value) {
  if (read?.failed) return '—';
  if (read?.loading || read?.data === undefined) return '…';
  // Answered, but without this figure in it (a slice this account is not given): nothing to state.
  return value ?? '—';
}

/** Whole minutes from `since` to `now`, or null for a timestamp that does not parse. */
export function minutesBetween(since, now = new Date()) {
  if (!since) return null;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 60000));
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const personName = (row) => [row?.first_name, row?.last_name].filter(Boolean).join(' ');

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
export function listWords(words = []) {
  const list = words.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** A few names and how many more, for a need's second line. */
function someNames(names, shown = 2) {
  const list = names.filter(Boolean);
  const more = list.length - shown;
  return more > 0 ? `${list.slice(0, shown).join(', ')} and ${more} more` : list.join(', ');
}

const oldestFirst = (field) => (a, b) => new Date(a[field]) - new Date(b[field]);

const waitedFor = (since, now) => {
  const minutes = minutesBetween(since, now);
  return minutes === null ? null : formatDuration(minutes);
};

/** Who the till still has to charge, oldest first: the till's own rule (see paidVisitIds). */
export function waitingToPay(visits = [], transactions = []) {
  const paid = paidVisitIds(transactions);
  return visits.filter((v) => !paid.has(v.id)).sort(oldestFirst('created_at'));
}

/** How long after its slot a booking nobody has checked in reads as late rather than due. */
export const LATE_AFTER_MINUTES = 15;

/** 'arrived' | 'due' | 'late' | 'no-show' | 'cancelled' — a booking as the desk reads it now. */
export function bookingState(booking, now = new Date()) {
  switch (booking?.status) {
    case 'Confirmed':
    case 'Completed':
      return 'arrived';
    case 'No Show':
      return 'no-show';
    case 'Cancelled':
      return 'cancelled';
    default:
      break;
  }
  const [hours, minutes] = String(booking?.scheduled_time || '').split(':').map(Number);
  if (!Number.isFinite(hours)) return 'due';
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, Number.isFinite(minutes) ? minutes : 0);
  return now.getTime() - slot.getTime() > LATE_AFTER_MINUTES * 60000 ? 'late' : 'due';
}

/** Today's bookings in slot order, each with its state. A cancelled one is not coming, so it goes. */
export function todaysBookings(appointments = [], now = new Date()) {
  return appointments
    .filter((a) => a.status !== 'Cancelled')
    .map((a) => ({ ...a, state: bookingState(a, now) }))
    .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
}

/** How many visits with no tests get a row each before the rest are summed up. */
export const NO_TESTS_SHOWN = 3;

/**
 * The front desk's own work: a visit in the queue with nothing on it. The cashier cannot bill it and
 * no department will see it, so it waits for the desk and nobody else.
 */
export function deskNeeds(visits = [], now = new Date()) {
  const bare = visits
    .filter((v) => (v.visit_status || v.status) === 'Pending' && (v.tests || []).length === 0)
    .sort(oldestFirst('created_at'));

  const rows = bare.slice(0, NO_TESTS_SHOWN).map((v) => {
    const name = personName(v);
    const since = waitedFor(v.created_at, now);
    return {
      id: `no-tests-${v.id}`,
      tone: 'amber',
      icon: 'flask',
      title: `${name} has no tests yet`,
      detail: [
        v.queue_number && `Ticket ${v.queue_number}`,
        since && `waiting ${since}`,
        "the cashier can't bill until there are",
      ].filter(Boolean).join(' · '),
      action: {
        label: 'Add tests',
        ariaLabel: `Add tests for ${name}`,
        go: 'reception-queue',
        intent: { editTests: v.id, find: name },
      },
    };
  });

  const more = bare.length - NO_TESTS_SHOWN;
  if (more > 0) {
    rows.push({
      id: 'no-tests-more',
      tone: 'amber',
      icon: 'flask',
      title: `And ${more} more with no tests yet`,
      detail: 'The Desk lists every visit in the queue.',
      action: { label: 'Open the Desk', go: 'reception-queue' },
    });
  }
  return rows;
}

/** The till's work: people waiting to pay, and online payments waiting to be checked. */
export function tillNeeds({ waiting = [], online = [], canCheck = false, now = new Date() } = {}) {
  const rows = [];
  if (waiting.length) {
    const [oldest] = waiting;
    const since = waitedFor(oldest.created_at, now);
    rows.push({
      id: 'till',
      tone: 'blue',
      icon: 'receipt',
      title: `${count(waiting.length, 'patient')} waiting to pay`,
      detail: `Longest: ${personName(oldest)}${since ? `, ${since}` : ''}`,
      action: { label: 'Open the till', go: 'cashier-queue' },
    });
  }
  if (online.length) {
    const sorted = [...online].sort(oldestFirst('submitted_at'));
    const since = waitedFor(sorted[0].submitted_at, now);
    rows.push({
      id: 'online',
      tone: 'amber',
      icon: 'wallet',
      title: `${count(online.length, 'online payment')} to check`,
      detail: [someNames(sorted.map(personName), 3), since && `the oldest was sent ${since} ago`]
        .filter(Boolean).join(' · '),
      action: canCheck ? { label: 'Check them', go: 'cashier-payments' } : undefined,
    });
  }
  return rows;
}

/**
 * A department's work. One row for its worklist, however many tests wait on it, because both
 * halves — the exam and the release — are done from the same screen; and one for released reports
 * whose email never went, which are done from History.
 *
 * `labelled` names the department in the title, for someone who works more than one.
 */
export function departmentNeeds({
  category, pending = [], unsent = [], nav, historyNav, canSend = false, labelled = false, now = new Date(),
} = {}) {
  const label = categoryLabel(category);
  const prefix = labelled ? `${label}: ` : '';
  const rows = [];

  if (pending.length) {
    const exam = pending.filter((t) => t.test_status === 'Processing').length;
    const ready = pending.filter((t) => t.test_status === 'Waiting for Release').length;
    const oldest = [...pending].sort(oldestFirst('visit_created_at'))[0];
    const since = waitedFor(oldest.visit_created_at, now);
    rows.push({
      id: `worklist-${category}`,
      tone: 'amber',
      icon: 'clock',
      title: prefix + [exam && `${exam} waiting for exam`, ready && `${ready} ready to release`].filter(Boolean).join(' · '),
      detail: `Oldest: ${personName(oldest)}, ${oldest.test_name}${since ? `, waiting ${since}` : ''}`,
      action: { label: 'Open worklist', ariaLabel: `Open the ${label} worklist`, go: nav },
    });
  }

  // Only reports that CAN be sent: an address on file and no send recorded. A walk-in with no email
  // is not work anyone can do, and listing them would bury the ones a mail outage left behind.
  const reachable = unsent.filter((r) => r.patient_email && !r.emailed_at);
  if (canSend && reachable.length) {
    rows.push({
      id: `unsent-${category}`,
      tone: 'blue',
      icon: 'mail',
      title: `${prefix}${count(reachable.length, 'released report')} not yet sent to the patient`,
      detail: `${someNames(reachable.map(personName))} · an email address is on file`,
      action: { label: 'Open History', ariaLabel: `Open ${label} History`, go: historyNav, intent: { delivery: 'unsent' } },
    });
  }
  return rows;
}

/** An Admin's decisions: HMO claims the front desk raised and only an Admin can settle. */
export function decisionNeed(requests = []) {
  if (!requests.length) return [];
  const who = requests.map((r) => [r.patient_first_name, r.patient_last_name].filter(Boolean).join(' '));
  return [{
    id: 'hmo-decisions',
    tone: 'blue',
    icon: 'shield',
    title: `${count(requests.length, 'HMO request')} waiting for your decision`,
    detail: someNames(who),
    action: { label: 'Review', go: 'service-requests' },
  }];
}

/**
 * What could not be checked, said once. Without it an empty list would read "nothing needs you"
 * over a request that failed — the most confident possible way to be wrong. [1.74.0]
 */
export function failedNeed(labels = []) {
  if (!labels.length) return [];
  return [{
    id: 'failed',
    tone: 'rose',
    icon: 'offline',
    title: `Couldn't check ${listWords(labels)}`,
    detail: 'So this list may be missing something. Refresh to try again.',
  }];
}

/** The best-selling services today, by what they actually brought in. */
export function topServices(byService = [], shown = 5) {
  return [...byService].sort((a, b) => Number(b.net) - Number(a.net)).slice(0, shown);
}

/** Arrivals up to the hour now, so the chart does not draw hours that have not happened as zeros. */
export function hoursSoFar(rows = [], now = new Date()) {
  return rows.filter((r) => Number(r.hour) <= now.getHours());
}

const DEPARTMENT_ORDER = ['Laboratory', 'Ultrasound', 'Xray'];

/**
 * One row per department for the clinic view: what waits there now, and how today went. The three
 * the clinic runs are always listed, so a quiet one reads as quiet rather than missing.
 */
export function departmentRows({ outstanding = [], byCategory = [], sla = [] } = {}) {
  const names = new Set(DEPARTMENT_ORDER);
  [...outstanding, ...byCategory, ...sla].forEach((r) => r?.category_name && names.add(r.category_name));
  const rank = (name) => (DEPARTMENT_ORDER.includes(name) ? DEPARTMENT_ORDER.indexOf(name) : DEPARTMENT_ORDER.length);

  return [...names]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const waiting = outstanding.find((r) => r.category_name === name) || {};
      const done = byCategory.find((r) => r.category_name === name) || {};
      const target = sla.find((r) => r.category_name === name) || {};
      const released = Number(done.released) || 0;
      return {
        category: name,
        awaitingExam: Number(waiting.awaiting_exam) || 0,
        awaitingRelease: Number(waiting.awaiting_release) || 0,
        released,
        // No release today means nothing was measured, which is not a turnaround of 0 minutes.
        medianMinutes: released > 0 ? Number(done.median_turnaround_minutes) : null,
        targetMinutes: target.target_minutes ?? null,
      };
    });
}

/**
 * Opening hours for today and the six days after it, with any date that differs from the usual
 * week marked — the question a patient on the phone is asking ("are you open Saturday?").
 */
export function nextSevenDays(week = [], upcoming = [], now = new Date()) {
  return Array.from({ length: 7 }, (_, ahead) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const hours = hoursOn(date, week, upcoming);
    const usual = hoursOn(date, week, []);
    return {
      key: toDateInput(date),
      label: ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : date.toLocaleDateString('en-PH', { weekday: 'long' }),
      date: date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }),
      open: hours.open,
      text: hours.open ? `${formatTime12(hours.from)} – ${formatTime12(hours.to)}` : 'Closed',
      changed: hours.open !== usual.open || hours.from !== usual.from || hours.to !== usual.to,
    };
  });
}
