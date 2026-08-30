const test = require('node:test');
const assert = require('node:assert/strict');

const { arrivalTimeFor, ARRIVAL_LEAD_MINUTES, DEFAULT_ARRIVAL_LEAD_MINUTES } = require('../../src/constants/scheduling');

/**
 * The recommended-arrival arithmetic. [1.63.0]
 *
 * Small enough to look correct and worth a test anyway, because it is done on a bare `HH:MM`
 * string on purpose. `scheduled_time` is a Postgres TIME with no date attached, so routing it
 * through a `Date` means inventing one — and an invented date is how a time acquires a timezone
 * it never had. CLAUDE.md records that class of bug shipping three times by other routes; these
 * assertions are what stop somebody "simplifying" this into `new Date(...)`.
 */

test('the lead is subtracted, in both HH:MM and HH:MM:SS form', () => {
  assert.equal(arrivalTimeFor('09:00', 15), '08:45');
  assert.equal(arrivalTimeFor('09:00:00', 15), '08:45', 'Postgres TIME arrives with seconds');
});

test('it crosses the hour boundary correctly', () => {
  assert.equal(arrivalTimeFor('08:05', 15), '07:50');
  assert.equal(arrivalTimeFor('13:00', 45), '12:15');
  assert.equal(arrivalTimeFor('10:00', 60), '09:00');
});

test('a single-digit hour is accepted and normalised', () => {
  assert.equal(arrivalTimeFor('8:30', 15), '08:15');
});

test('it clamps at midnight rather than wrapping to the previous day', () => {
  // "Arrive at 23:55 yesterday" is a worse answer than "arrive at 00:00", and the clinic does not
  // open near midnight anyway.
  assert.equal(arrivalTimeFor('00:10', 15), '00:00');
  assert.equal(arrivalTimeFor('00:00', 15), '00:00');
});

test('a zero lead is honoured rather than falling back to the default', () => {
  // A clinic that genuinely wants no lead must be able to say so.
  assert.equal(arrivalTimeFor('09:00', 0), '09:00');
});

test('unreadable input yields null, never a fabricated time', () => {
  // The surfaces that render this show the scheduled time alone when arrival is null, which is
  // exactly what they showed before the feature existed.
  for (const bad of ['not a time', '', null, undefined, '25:00', '09:99', '9', 'noon']) {
    assert.equal(arrivalTimeFor(bad, 15), null, JSON.stringify(bad));
  }
});

test('the configured lead is clamped to a sane range', () => {
  // A typo in the environment must not put "arrive 400 minutes early" on a patient's email, nor a
  // negative lead telling them to arrive after their own appointment.
  assert.ok(ARRIVAL_LEAD_MINUTES >= 0);
  assert.ok(ARRIVAL_LEAD_MINUTES <= 120);
  assert.equal(typeof ARRIVAL_LEAD_MINUTES, 'number');
});

test('the stated default is 15 minutes', () => {
  // Long enough to check in, present an HMO card and settle; short enough not to be resented.
  assert.equal(DEFAULT_ARRIVAL_LEAD_MINUTES, 15);
});

test('the arrival is always before the appointment, across the clinic day', () => {
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  for (let hour = 8; hour <= 17; hour += 1) {
    for (const minute of ['00', '30']) {
      const scheduled = `${String(hour).padStart(2, '0')}:${minute}`;
      const arrival = arrivalTimeFor(scheduled, ARRIVAL_LEAD_MINUTES);
      assert.ok(arrival, scheduled);
      assert.ok(
        toMinutes(arrival) <= toMinutes(scheduled),
        `${arrival} must not be after ${scheduled}`
      );
    }
  }
});
