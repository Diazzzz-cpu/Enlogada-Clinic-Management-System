import { describe, it, expect } from 'vitest';
import {
  arrivalTimeFor, windowEndFor, inferSlotMinutes, appointmentTimes,
} from '../../src/lib/appointmentTime';

/**
 * The two times a booking has. [1.63.0]
 *
 * The arithmetic is done on a bare `HH:MM` string on purpose: `scheduled_time` is a Postgres TIME
 * with no date attached, so routing it through a `Date` means inventing one — and an invented date
 * is how a time acquires a timezone it never had. CLAUDE.md records that class of bug shipping
 * three times by other routes. These assertions are what stop somebody "simplifying" it back.
 *
 * `windowEndFor` returning null without a known slot length is the other property worth pinning:
 * a window whose end is wrong is worse than a start alone, because a patient reading "9:00 – 9:30"
 * plans the rest of their morning around 9:30.
 */

describe('arrival time', () => {
  it('subtracts the lead, in both HH:MM and HH:MM:SS form', () => {
    expect(arrivalTimeFor('09:00', 15)).toBe('08:45');
    expect(arrivalTimeFor('09:00:00', 15)).toBe('08:45');
  });

  it('crosses the hour boundary', () => {
    expect(arrivalTimeFor('08:05', 15)).toBe('07:50');
    expect(arrivalTimeFor('13:00', 45)).toBe('12:15');
  });

  it('clamps at midnight rather than wrapping to the previous day', () => {
    expect(arrivalTimeFor('00:10', 15)).toBe('00:00');
  });

  it('honours a zero lead instead of falling back to a default', () => {
    expect(arrivalTimeFor('09:00', 0)).toBe('09:00');
  });

  it('returns null for anything unreadable, never a fabricated time', () => {
    for (const bad of ['not a time', '', null, undefined, '25:00', '09:99']) {
      expect(arrivalTimeFor(bad, 15)).toBeNull();
    }
  });
});

describe('the service window end', () => {
  it('is computed when the slot length is genuinely known', () => {
    expect(windowEndFor('09:00', 30)).toBe('09:30');
    expect(windowEndFor('09:45', 20)).toBe('10:05');
  });

  it('is null when the slot length is NOT known', () => {
    // A booking pass rendered weeks later has no source for the interval, and guessing 30 would
    // print a confident wrong end time on a patient's pass.
    expect(windowEndFor('09:00', null)).toBeNull();
    expect(windowEndFor('09:00')).toBeNull();
    expect(windowEndFor('09:00', 'thirty')).toBeNull();
  });
});

describe('inferring the slot length from availability', () => {
  it('reads the real configured interval from consecutive slots', () => {
    // The server generates slots from `slot_interval_minutes`, so the gap IS the interval — this
    // reads the configured value rather than assuming 30.
    expect(inferSlotMinutes([{ time: '08:00' }, { time: '08:30' }, { time: '09:00' }])).toBe(30);
    expect(inferSlotMinutes([{ time: '08:00' }, { time: '08:20' }])).toBe(20);
  });

  it('declines a list too short to tell', () => {
    expect(inferSlotMinutes([{ time: '08:00' }])).toBeNull();
    expect(inferSlotMinutes([])).toBeNull();
    expect(inferSlotMinutes(null)).toBeNull();
  });

  it('declines a nonsensical gap rather than rendering a window computed from it', () => {
    expect(inferSlotMinutes([{ time: '09:00' }, { time: '08:00' }])).toBeNull();
    expect(inferSlotMinutes([{ time: '00:00' }, { time: '23:00' }])).toBeNull();
  });
});

describe('the presented pair', () => {
  it('shows a window when the slot length is known, and a single time otherwise', () => {
    const withLength = appointmentTimes('09:00', 30);
    expect(withLength.window).toMatch(/9:00.*9:30/);

    const without = appointmentTimes('09:00');
    expect(without.window).not.toMatch(/–/);
  });

  it('always reports the lead it used, so the UI can explain the earlier time', () => {
    const times = appointmentTimes('09:00');
    expect(typeof times.arrivalLead).toBe('number');
    expect(times.arrivalLead).toBeGreaterThanOrEqual(0);
    expect(times.arrival).toBeTruthy();
  });

  it('returns null for no time at all', () => {
    expect(appointmentTimes(null)).toBeNull();
    expect(appointmentTimes('')).toBeNull();
  });

  it('never places the arrival after the appointment', () => {
    const to24 = (label) => {
      const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(label);
      if (!m) return null;
      let h = Number(m[1]) % 12;
      if (/pm/i.test(m[3])) h += 12;
      return h * 60 + Number(m[2]);
    };

    for (let hour = 8; hour <= 17; hour += 1) {
      const scheduled = `${String(hour).padStart(2, '0')}:00`;
      const { window: win, arrival } = appointmentTimes(scheduled);
      expect(to24(arrival)).toBeLessThanOrEqual(to24(win));
    }
  });
});
