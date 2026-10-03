import { describe, it, expect } from 'vitest';
import {
  greeting, minutesBetween, listWords, waitingToPay, bookingState, todaysBookings,
  deskNeeds, NO_TESTS_SHOWN, tillNeeds, departmentNeeds, decisionNeed, failedNeed,
  topServices, hoursSoFar, departmentRows, nextSevenDays,
} from '../../src/lib/today.js';
import { formatTime12 } from '../../src/lib/date.js';

// 14 September 2026 is a Monday. Built from local parts so the tests hold in any time zone.
const at = (hour, minute = 0, day = 14) => new Date(2026, 8, day, hour, minute);
const iso = (hour, minute = 0) => at(hour, minute).toISOString();

describe('greeting', () => {
  it('turns at noon and at six', () => {
    expect(greeting(at(8))).toBe('Good morning');
    expect(greeting(at(11, 59))).toBe('Good morning');
    expect(greeting(at(12))).toBe('Good afternoon');
    expect(greeting(at(18))).toBe('Good evening');
  });
});

describe('minutesBetween', () => {
  it('is whole minutes, never negative, and null for nothing to measure', () => {
    expect(minutesBetween(iso(9, 0), at(9, 25, 14))).toBe(25);
    expect(minutesBetween(iso(10, 0), at(9, 0))).toBe(0);
    expect(minutesBetween(null, at(9))).toBeNull();
    expect(minutesBetween('not a date', at(9))).toBeNull();
  });
});

describe('listWords', () => {
  it('reads as a sentence', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['the queue'])).toBe('the queue');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('waitingToPay', () => {
  it("drops a visit paid today, keeps a refunded one, and lists the longest wait first", () => {
    const visits = [
      { id: 1, created_at: iso(9, 30) },
      { id: 2, created_at: iso(8, 10) },
      { id: 3, created_at: iso(8, 50) },
    ];
    const log = [
      { patient_visit_id: 1, payment_status: 'Paid' },
      // Reversed: the visit owes again, so it is back in the queue.
      { patient_visit_id: 3, payment_status: 'Refunded' },
    ];
    expect(waitingToPay(visits, log).map((v) => v.id)).toEqual([2, 3]);
  });
});

describe('bookingState', () => {
  const booking = (status, time = '10:30:00') => ({ status, scheduled_time: time });

  it('reads a checked-in booking as arrived, and says so for no-shows and cancellations', () => {
    expect(bookingState(booking('Confirmed'), at(9))).toBe('arrived');
    expect(bookingState(booking('Completed'), at(9))).toBe('arrived');
    expect(bookingState(booking('No Show'), at(9))).toBe('no-show');
    expect(bookingState(booking('Cancelled'), at(9))).toBe('cancelled');
  });

  it('is due until fifteen minutes past its slot, then late', () => {
    expect(bookingState(booking('Pending'), at(10, 0))).toBe('due');
    expect(bookingState(booking('Pending'), at(10, 45))).toBe('due');
    expect(bookingState(booking('Pending'), at(10, 46))).toBe('late');
  });
});

describe('todaysBookings', () => {
  it('leaves out cancellations and runs in slot order', () => {
    const rows = todaysBookings([
      { id: 1, status: 'Pending', scheduled_time: '14:00:00' },
      { id: 2, status: 'Cancelled', scheduled_time: '09:00:00' },
      { id: 3, status: 'Confirmed', scheduled_time: '08:30:00' },
    ], at(9));
    expect(rows.map((r) => [r.id, r.state])).toEqual([[3, 'arrived'], [1, 'due']]);
  });
});

describe('deskNeeds', () => {
  const visit = (id, over = {}) => ({
    id, first_name: 'Pat', last_name: `No${id}`, queue_number: `00${id}`, visit_status: 'Pending',
    created_at: iso(8, id), tests: [], ...over,
  });

  it('asks only about a waiting visit with nothing on it, and opens it for editing', () => {
    const rows = deskNeeds([
      visit(1),
      visit(2, { tests: [{ id: 9 }] }),
      visit(3, { visit_status: 'Processing' }),
    ], at(8, 31));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Pat No1 has no tests yet');
    expect(rows[0].detail).toBe("Ticket 001 · waiting 30m · the cashier can't bill until there are");
    expect(rows[0].action).toMatchObject({ label: 'Add tests', go: 'reception-queue', intent: { editTests: 1, find: 'Pat No1' } });
  });

  it('sums up past a few, rather than pushing the rest of the page away', () => {
    const rows = deskNeeds([1, 2, 3, 4, 5].map((id) => visit(id)), at(9));
    expect(rows).toHaveLength(NO_TESTS_SHOWN + 1);
    expect(rows.at(-1).title).toBe('And 2 more with no tests yet');
  });
});

describe('tillNeeds', () => {
  it('says who has waited longest, and offers the check only to someone who may take the money', () => {
    const rows = tillNeeds({
      waiting: [{ first_name: 'Ben', last_name: 'Cruz', created_at: iso(8, 52) }],
      online: [{ first_name: 'Ana', last_name: 'Reyes', submitted_at: iso(8, 45) }],
      canCheck: false,
      now: at(10, 5),
    });
    expect(rows.map((r) => r.title)).toEqual(['1 patient waiting to pay', '1 online payment to check']);
    expect(rows[0].detail).toBe('Longest: Ben Cruz, 1h 13m');
    expect(rows[1].action).toBeUndefined();
    expect(tillNeeds({ waiting: [], online: [], now: at(10) })).toEqual([]);
  });
});

describe('departmentNeeds', () => {
  const pending = [
    { test_status: 'Processing', first_name: 'Dan', last_name: 'Villanueva', test_name: 'CBC', visit_created_at: iso(9, 24) },
    { test_status: 'Processing', first_name: 'Ana', last_name: 'Reyes', test_name: 'CBC', visit_created_at: iso(8, 40) },
    { test_status: 'Waiting for Release', first_name: 'Ana', last_name: 'Reyes', test_name: 'Urinalysis', visit_created_at: iso(8, 40) },
  ];

  it('is one worklist row with both halves of the work, oldest named', () => {
    const [row] = departmentNeeds({ category: 'Laboratory', pending, nav: 'lab-ops', now: at(10, 5) });
    expect(row.title).toBe('2 waiting for exam · 1 ready to release');
    expect(row.detail).toBe('Oldest: Ana Reyes, CBC, waiting 1h 25m');
    expect(row.action.go).toBe('lab-ops');
  });

  it('counts only reports that can be sent, and only for someone who may send them', () => {
    const unsent = [
      { first_name: 'Liza', last_name: 'Tan', patient_email: 'liza@example.com', emailed_at: null },
      { first_name: 'Walk', last_name: 'In', patient_email: null, emailed_at: null },
      { first_name: 'Sent', last_name: 'Already', patient_email: 'x@example.com', emailed_at: iso(9) },
    ];
    const base = { category: 'Xray', unsent, historyNav: 'xray-history', now: at(10) };
    expect(departmentNeeds({ ...base, canSend: false })).toEqual([]);
    const [row] = departmentNeeds({ ...base, canSend: true, labelled: true });
    expect(row.title).toBe('X-Ray: 1 released report not yet sent to the patient');
    expect(row.action).toMatchObject({ go: 'xray-history', intent: { delivery: 'unsent' } });
  });
});

describe('decisionNeed and failedNeed', () => {
  it('name who is waiting, and what could not be checked', () => {
    const [decision] = decisionNeed([
      { patient_first_name: 'Carla', patient_last_name: 'Mendoza' },
      { patient_first_name: 'Mark', patient_last_name: 'Ong' },
      { patient_first_name: 'Rosa', patient_last_name: 'Lim' },
    ]);
    expect(decision.title).toBe('3 HMO requests waiting for your decision');
    expect(decision.detail).toBe('Carla Mendoza, Mark Ong and 1 more');
    expect(failedNeed(['the queue', 'online payments'])[0].title).toBe("Couldn't check the queue and online payments");
    expect(failedNeed([])).toEqual([]);
  });
});

describe('topServices', () => {
  it('ranks by money as numbers, not as text', () => {
    // As strings, "900.00" sorts above "1250.00".
    const ranked = topServices([
      { test_name: 'CBC', net: '900.00' },
      { test_name: 'Whole Abdomen', net: '1250.00' },
      { test_name: 'Urinalysis', net: '90.00' },
    ], 2);
    expect(ranked.map((r) => r.test_name)).toEqual(['Whole Abdomen', 'CBC']);
  });
});

describe('hoursSoFar', () => {
  it('stops at the hour it is now', () => {
    const rows = [7, 8, 9, 10, 11].map((hour) => ({ hour, total: 1 }));
    expect(hoursSoFar(rows, at(9, 40)).map((r) => r.hour)).toEqual([7, 8, 9]);
  });
});

describe('departmentRows', () => {
  it('always lists the three departments, and measures nothing where nothing was released', () => {
    const rows = departmentRows({
      outstanding: [{ category_name: 'Laboratory', awaiting_exam: 2, awaiting_release: 1 }],
      byCategory: [{ category_name: 'Xray', released: 3, median_turnaround_minutes: 21 }],
      sla: [{ category_name: 'Xray', target_minutes: 30 }],
    });
    expect(rows.map((r) => r.category)).toEqual(['Laboratory', 'Ultrasound', 'Xray']);
    expect(rows[0]).toMatchObject({ awaitingExam: 2, awaitingRelease: 1, released: 0, medianMinutes: null });
    expect(rows[2]).toMatchObject({ released: 3, medianMinutes: 21, targetMinutes: 30 });
  });
});

describe('nextSevenDays', () => {
  const WEEK = [
    { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
    ...[1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: '08:00:00', closeTime: '17:00:00' })),
    { dayOfWeek: 6, isOpen: true, openTime: '08:00:00', closeTime: '12:00:00' },
  ];

  it('marks a date that differs from the usual week, and not a Sunday that is always closed', () => {
    const days = nextSevenDays(WEEK, [{ date: '2026-09-15', isOpen: false }], at(9));
    expect(days.map((d) => d.label).slice(0, 2)).toEqual(['Today', 'Tomorrow']);
    expect(days[0]).toMatchObject({ open: true, changed: false, text: `${formatTime12('08:00:00')} – ${formatTime12('17:00:00')}` });
    expect(days[1]).toMatchObject({ open: false, changed: true, text: 'Closed' });
    // Sunday the 20th: closed, as it always is.
    expect(days[6]).toMatchObject({ open: false, changed: false });
  });
});
