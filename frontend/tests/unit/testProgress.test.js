import { describe, it, expect } from 'vitest';
import { testProgress } from '../../src/lib/testProgress.js';
import { formatDate } from '../../src/lib/date.js';

// Where a test stands, as the front desk tells a patient. [1.130.0]
const ON = '2026-10-19T10:30:00';

describe('testProgress', () => {
  it('a released report says when', () => {
    const p = testProgress({ category: 'Laboratory', status: 'Completed', released_at: ON });
    expect(p).toMatchObject({ state: 'released', label: `Released ${formatDate(ON)}` });
  });

  it('an X-ray done says when, and where its result comes from', () => {
    const p = testProgress({ category: 'Xray', status: 'Completed', done_at: ON });
    expect(p).toMatchObject({ state: 'done', label: `Done ${formatDate(ON)}`, detail: 'Result from the X-Ray department' });
  });

  it('an X-ray released before X-ray stopped issuing reports still reads as released', () => {
    expect(testProgress({ category: 'Xray', status: 'Completed', released_at: ON }).state).toBe('released');
  });

  it('work with a department names the department, including a report not yet released', () => {
    expect(testProgress({ category: 'Ultrasound', status: 'Processing' }).label).toBe('With Ultrasound');
    expect(testProgress({ category: 'Laboratory', status: 'Waiting for Release' }).label).toBe('With Laboratory');
  });

  it('a test not started is waiting for payment, unless the visit is paid', () => {
    expect(testProgress({ category: 'Laboratory', status: 'Pending' }, { paid: false }))
      .toMatchObject({ state: 'unpaid', label: 'Waiting for payment' });
    expect(testProgress({ category: 'Laboratory', status: 'Pending' }, { paid: true }))
      .toMatchObject({ state: 'not-started', label: 'Not started yet' });
  });

  it("unfinished work from an earlier day says since when; today's does not", () => {
    const yesterday = '2026-10-18T19:35:00';
    const old = testProgress({ category: 'Laboratory', status: 'Processing' }, { since: yesterday, today: '2026-10-19' });
    expect(old).toMatchObject({ label: 'With Laboratory', detail: `Since ${formatDate(yesterday)}` });
    expect(testProgress({ category: 'Laboratory', status: 'Processing' }, { since: '2026-10-19T08:10:00', today: '2026-10-19' }).detail)
      .toBeNull();
    // A finished test is finished, whenever its visit was.
    expect(testProgress({ category: 'Laboratory', status: 'Completed', released_at: ON }, { since: yesterday, today: '2026-10-19' }).detail)
      .toBeUndefined();
  });

  it('a cancelled test says so', () => {
    expect(testProgress({ category: 'Laboratory', status: 'Cancelled' }).state).toBe('cancelled');
  });
});
