const test = require('node:test');
const assert = require('node:assert/strict');
const { reminderDueAt, decide, inQuietHours } = require('../../src/utils/reminderTiming');

// When an appointment's reminder goes out. [1.130.0] Built from local parts, as the server reads
// the clinic's own clock: 19 October 2026 is a Monday.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);
const hm = (d) => `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('booked ahead: the evening before, at 18:00', () => {
  const due = reminderDueAt({ startsAt: at(22, 8), bookedAt: at(5, 10) });
  assert.equal(due.kind, 'evening-before');
  assert.equal(hm(due.at), '21 18:00');
});

test('booked the afternoon before still gets the evening reminder', () => {
  const due = reminderDueAt({ startsAt: at(20, 16), bookedAt: at(19, 17) });
  assert.equal(due.kind, 'evening-before');
  assert.equal(hm(due.at), '19 18:00');
});

test("Steven's example: two hours away, reminded an hour before", () => {
  const due = reminderDueAt({ startsAt: at(19, 14), bookedAt: at(19, 12) });
  assert.equal(due.kind, 'short-notice');
  assert.equal(hm(due.at), '19 13:00');
});

test('half the time left, for anything later than the evening before', () => {
  assert.equal(hm(reminderDueAt({ startsAt: at(19, 16), bookedAt: at(19, 8) }).at), '19 12:00');
  assert.equal(hm(reminderDueAt({ startsAt: at(19, 10), bookedAt: at(19, 9) }).at), '19 09:30');
});

test('thirty minutes away: no second email, the confirmation just sent is the reminder', () => {
  const due = reminderDueAt({ startsAt: at(19, 14, 30), bookedAt: at(19, 14) });
  assert.equal(due.at, null);
  assert.equal(due.kind, 'none');
});

test('a halfway point at night moves to 07:00', () => {
  // Booked at 22:00 for 08:00: halfway is 03:00.
  const due = reminderDueAt({ startsAt: at(20, 8), bookedAt: at(19, 22) });
  assert.equal(due.kind, 'short-notice');
  assert.equal(hm(due.at), '20 07:00');
});

test('booked just before the evening reminder: not two emails ten minutes apart', () => {
  // The evening reminder would land 10 minutes after the confirmation; the morning one is useful.
  const due = reminderDueAt({ startsAt: at(20, 8), bookedAt: at(19, 17, 50) });
  assert.equal(hm(due.at), '20 07:00');
});

test('a reschedule counts as the latest email: timed from it, not from the first booking', () => {
  const due = reminderDueAt({ startsAt: at(19, 15), bookedAt: at(19, 11) });
  assert.equal(hm(due.at), '19 13:00');
});

test('a sweep sends what is due, waits for what is not, and never at night', () => {
  const booking = { startsAt: at(22, 8), bookedAt: at(5, 10) };
  assert.equal(decide({ ...booking, now: at(21, 17, 59) }).action, 'wait');
  assert.equal(decide({ ...booking, now: at(21, 18) }).action, 'send');
  // The server was off at 18:00 and comes back at 23:00: it waits for the morning.
  assert.equal(decide({ ...booking, now: at(21, 23) }).action, 'wait');
  assert.equal(decide({ ...booking, now: at(22, 7) }).action, 'send');
  // Back at 07:50 for an 08:00 appointment: too late to help, and it says so once.
  const late = decide({ ...booking, now: at(22, 7, 50) });
  assert.equal(late.action, 'skip');
  assert.match(late.reason, /too close/);
});

test('one that was never due is skipped at once', () => {
  assert.equal(decide({ startsAt: at(19, 14, 30), bookedAt: at(19, 14), now: at(19, 14, 1) }).action, 'skip');
});

test('quiet hours run from 21:00 to 07:00', () => {
  assert.equal(inQuietHours(at(19, 20, 59)), false);
  assert.equal(inQuietHours(at(19, 21)), true);
  assert.equal(inQuietHours(at(20, 3)), true);
  assert.equal(inQuietHours(at(20, 6, 59)), true);
  assert.equal(inQuietHours(at(20, 7)), false);
});
