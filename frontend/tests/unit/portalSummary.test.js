import { describe, it, expect } from 'vitest';
import {
  bookingDay, upcomingBookings, nextVisit, owing, latestResults, isNewResult, attentionItems, figure,
  RECENT_RESULT_DAYS,
} from '../../src/lib/portalSummary.js';

// 14 September 2026 is a Monday. Built from local parts so the tests hold in any time zone.
const at = (month, day, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute);
// The API sends a DATE as the UTC instant of local midnight.
const dateOf = (month, day) => at(month, day).toISOString();
const TODAY = '2026-09-14';
const NOW = at(9, 14, 10);

const booking = (over = {}) => ({
  id: 1, patient_id: 7, status: 'Pending', scheduled_date: dateOf(9, 15), scheduled_time: '09:00:00',
  is_paid: false, amount_due: '1450.00', preparation_notes: [], ...over,
});

describe('bookingDay', () => {
  it('reads the instant back as the calendar date that was booked', () => {
    expect(bookingDay(booking())).toBe('2026-09-15');
    expect(bookingDay({ scheduled_date: 'not a date' })).toBeNull();
    expect(bookingDay({})).toBeNull();
  });
});

describe('upcomingBookings and nextVisit', () => {
  const list = [
    booking({ id: 1, scheduled_date: dateOf(9, 20), scheduled_time: '08:00:00' }),
    booking({ id: 2, scheduled_date: dateOf(9, 15), scheduled_time: '13:00:00' }),
    booking({ id: 3, scheduled_date: dateOf(9, 15), scheduled_time: '09:30:00' }),
    booking({ id: 4, scheduled_date: dateOf(9, 14) }),
    booking({ id: 5, scheduled_date: dateOf(9, 13) }),
    booking({ id: 6, status: 'Cancelled', scheduled_date: dateOf(9, 14) }),
    booking({ id: 7, status: 'Completed', scheduled_date: dateOf(9, 16) }),
    booking({ id: 8, patient_id: 9, scheduled_date: dateOf(9, 14) }),
  ];

  it('keeps open bookings from today on, soonest first, then by time', () => {
    expect(upcomingBookings(list, { patientId: 7, today: TODAY }).map((a) => a.id)).toEqual([4, 3, 2, 1]);
  });

  it('answers for the patient being viewed, or for the whole account', () => {
    expect(upcomingBookings(list, { patientId: 9, today: TODAY }).map((a) => a.id)).toEqual([8]);
    expect(upcomingBookings(list, { patientId: null, today: TODAY })).toHaveLength(5);
  });

  it('the next visit is the soonest, or none', () => {
    expect(nextVisit(list, { patientId: 7, today: TODAY }).id).toBe(4);
    expect(nextVisit([booking({ status: 'Cancelled' })], { patientId: 7, today: TODAY })).toBeNull();
  });
});

describe('owing', () => {
  it('adds up upcoming bookings not yet paid, and nothing else', () => {
    const list = [
      booking({ id: 1, amount_due: '1450.00' }),
      booking({ id: 2, amount_due: '250.50' }),
      booking({ id: 3, is_paid: true }),
      booking({ id: 4, amount_due: '0' }),
      booking({ id: 5, scheduled_date: dateOf(9, 10) }),
      booking({ id: 6, patient_id: 9 }),
    ];
    const due = owing(list, { patientId: 7, today: TODAY });
    expect(due.rows.map((a) => a.id)).toEqual([1, 2]);
    expect(due.total).toBeCloseTo(1700.5);
  });
});

describe('latestResults and isNewResult', () => {
  const history = [
    { visit_test_id: 1, test_status: 'Completed', released_at: at(9, 1).toISOString() },
    { visit_test_id: 2, test_status: 'Processing', released_at: null },
    { visit_test_id: 3, test_status: 'Completed', released_at: at(9, 12).toISOString() },
    { visit_test_id: 4, test_status: 'Completed', released_at: at(8, 20).toISOString() },
  ];

  it('lists released results only, newest first', () => {
    expect(latestResults(history, 2).map((r) => r.visit_test_id)).toEqual([3, 1]);
  });

  it(`marks a result New for ${RECENT_RESULT_DAYS} days`, () => {
    expect(isNewResult(history[2], NOW)).toBe(true);
    expect(isNewResult(history[0], NOW)).toBe(true);
    expect(isNewResult(history[3], NOW)).toBe(false);
    expect(isNewResult(history[1], NOW)).toBe(false);
  });
});

describe('attentionItems', () => {
  it('asks for payment once per unpaid visit, naming the amount', () => {
    const items = attentionItems({ appointments: [booking()], patientId: 7, today: TODAY });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'pay-1', action: 'Pay', tab: 'appointments' });
    expect(items[0].detail).toContain('1,450.00');
  });

  it('tells the next visit what to do beforehand', () => {
    const items = attentionItems({
      appointments: [booking({ is_paid: true, preparation_notes: ['Nothing to eat for 8 hours.', 'Wear a loose top.'] })],
      patientId: 7, today: TODAY,
    });
    expect(items.map((i) => i.id)).toEqual(['prepare-1']);
    expect(items[0].detail).toBe('Nothing to eat for 8 hours. And 1 more.');
  });

  it('says it could not check, rather than that nothing needs them', () => {
    const items = attentionItems({ appointments: [], patientId: 7, today: TODAY, bookingsFailed: true });
    expect(items.map((i) => i.id)).toEqual(['bookings-failed']);
  });

  it('invites a rating for a finished visit, for the profile on screen, after everything to do', () => {
    const visit = { visit_id: 40, patient_id: 7, visit_date: dateOf(9, 10), first_name: 'Elena', last_name: 'Cabrera' };
    const other = { ...visit, visit_id: 41, patient_id: 8 };
    const items = attentionItems({ appointments: [booking()], patientId: 7, today: TODAY, feedback: [visit, other] });
    expect(items.map((i) => i.id)).toEqual(['pay-1', 'rate-40']);
    expect(items[1]).toMatchObject({ action: 'Rate visit', feedbackVisit: visit });
  });

  it('asks for a profile first when the account has none', () => {
    expect(attentionItems({ appointments: [], today: TODAY, hasProfile: false })[0].tab).toBe('profile');
  });

  it('is empty when nothing needs doing', () => {
    expect(attentionItems({ appointments: [booking({ is_paid: true })], patientId: 7, today: TODAY })).toEqual([]);
  });
});

describe('figure', () => {
  it('is a dash when the read failed, never the zero it started as', () => {
    expect(figure({ failed: true, loading: false }, 0)).toBe('—');
    expect(figure({ loading: true }, 0)).toBe('…');
    expect(figure({}, 0)).toBe(0);
  });
});
