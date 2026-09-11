// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

// The two times a booking has, and the values a clinician must not miss. [1.63.0]
//
// Both of these are rules encoded in pure functions, and both are the kind of rule that is
// verified by a person squinting at a screen until somebody writes it down.
//
// ── Why the arrival time is worth a spec ────────────────────────────────────────────────────
//
// A booking used to carry one time. A patient reads "9:00 AM" as when to turn up, so they arrive
// at 9:00, queue at reception to check in, and their 9:00 slot starts late through nobody's fault.
// The clinic records a delay; the patient experiences being kept waiting for an appointment they
// were on time for.
//
// The fix is two NAMED times, and the naming is the load-bearing part — "9:00, arrive 8:45" reads
// as a correction, and a patient who believes the appointment is really 8:45 turns up at 8:30 next
// time. What this guards is that the lead time comes from ONE place: it appears on the booking
// confirmation, the portal list, the pass, the confirmation email and the day-before reminder, and
// the reminder previously hardcoded "about 10 minutes early" while nothing else mentioned arrival
// at all.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

test.describe('Appointment arrival policy', () => {
  let ctx;

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('the clinic publishes one arrival lead time, and it is sane', async () => {
    const res = await ctx.get(`${API}/clinic`);
    expect(res.status()).toBe(200);

    const { clinic } = (await res.json()).data;
    expect(clinic).toHaveProperty('arrivalLeadMinutes');

    const lead = Number(clinic.arrivalLeadMinutes);
    expect(Number.isFinite(lead)).toBeTruthy();
    // Clamped server-side. A negative lead would tell a patient to arrive AFTER their own
    // appointment; a huge one would put "arrive 6 hours early" on a confirmation email.
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(lead).toBeLessThanOrEqual(120);
  });

  test('the endpoint is public, because the sign-in page renders clinic details too', async () => {
    // No Authorization header. This has always been open — every field on it is already printed
    // on the public site and on receipts handed across the counter.
    const res = await ctx.get(`${API}/clinic`);
    expect(res.status()).toBe(200);
    expect((await res.json()).data.clinic.arrivalLeadMinutes).toBeTruthy();
  });
  /**
   * The instruction has to survive a reader who is not looking for it. [1.66.0]
   *
   * It rendered as `text-micro text-ink-muted` trailing the appointment on the same line — the
   * smallest size and weakest colour the system has — and the clinic reported that patients simply
   * were not seeing it. Their patients are mostly middle-aged and not especially comfortable with
   * software, and a muted 11px clause is decoration to that reader, not an instruction.
   *
   * Reads whatever booking is already on the list rather than creating one. Every card renders the
   * same `AppointmentTime`, so a fresh booking buys nothing and costs a far-future date that lands
   * pages deep — which is what made the first version of this test time out walking the pager.
   */
  test('the booking card asks for the arrival time in words a patient cannot miss', async ({ page }) => {
    await signIn(page, 'client@enlogada.com');
    await page.getByRole('tab', { name: 'Appointments' }).click();

    const card = page.locator('[data-testid="appointment-card"]').first();
    const anyCard = await card.isVisible({ timeout: 15000 }).catch(() => false);
    test.skip(!anyCard, 'Need at least one booking on the client account.');

    // 1. The WORDS. "arrive by 8:15" is a label; "Please arrive by 8:15 AM" is a request, and for a
    //    reader who is not hunting for it that difference is the entire point.
    const arrival = card.getByText(/Please arrive by/i).first();
    await expect(arrival, 'the card must ASK, not label').toBeVisible();

    // 2. The WEIGHT, asserted separately — the old markup already contained the arrival time. It
    //    was unreadable, not absent, so a text-only assertion would pass against the defect.
    const style = await arrival.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { weight: Number(cs.fontWeight), px: parseFloat(cs.fontSize) };
    });
    expect(style.weight, 'the arrival instruction must be bold').toBeGreaterThanOrEqual(700);

    // 3. And still SECOND. Leading with the instruction makes patients treat the arrival time as
    //    the real appointment and creep earlier every visit, which is why this change is emphasis
    //    rather than promotion — bold and amber, but never larger than the appointment itself.
    //
    //    count() BEFORE evaluate(). A locator that matches nothing makes evaluate() auto-wait for
    //    the whole test timeout, and a trailing .catch() only runs once that has already expired —
    //    so the test hangs for 30s and reports "timeout" rather than the assertion that failed.
    //    That cost a debugging round here; the guard is the fix.
    const scheduled = card.locator('[data-testid="appointment-scheduled-time"]');
    if (await scheduled.count()) {
      const scheduledPx = await scheduled.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(style.px, 'arrival must not outgrow the appointment time').toBeLessThanOrEqual(scheduledPx);
    }
  });
});

test.describe('Appointment list priority', () => {
  /**
   * Ordering was never the problem; the layout was undoing it. [1.72.0]
   *
   * Every card went into one two-across grid, so a Pending booking carrying the full payment
   * panel took one cell and a Cancelled booking took the other — and because a CSS grid row is
   * as tall as its tallest child, the patient got a screen half of which was empty and the other
   * half of which gave "pay for this" and "you cancelled this" the same billing.
   *
   * Two things are asserted, and they fail for different reasons:
   *   - the GROUPING, which is what stops a cancelled booking sitting beside a live one, and
   *   - the WIDTH, which is the only thing that catches a regression back to the grid. A grid
   *     column is half-width whether or not there is anything in the neighbouring cell, so a
   *     single open booking laid out the old way still measures half the row.
   *
   * Reads whatever the client account already has rather than booking anything. This runs in a
   * suite with workers: 1 against a shared database, and a spec that creates bookings to check a
   * layout leaves rows behind for every spec after it.
   */
  test('open bookings get the width; finished ones sit under their own heading', async ({ page }) => {
    await signIn(page, 'client@enlogada.com');
    await page.getByRole('tab', { name: 'Appointments' }).click();

    const cards = page.locator('[data-testid="appointment-card"]');
    const anyCard = await cards.first().isVisible({ timeout: 15000 }).catch(() => false);
    test.skip(!anyCard, 'Need at least one booking on the client account.');

    const isFinished = (s) => s === 'Cancelled' || s === 'Completed';
    const statusesIn = async (sel) => {
      const loc = page.locator(`${sel} [data-testid="appointment-card"]`);
      // count() before evaluateAll(): a locator matching nothing makes the evaluate auto-wait out
      // the whole test timeout, and reports it as a timeout rather than as the empty list it is.
      return (await loc.count()) ? loc.evaluateAll((els) => els.map((el) => el.dataset.status)) : [];
    };

    const active = await statusesIn('[data-testid="active-bookings"]');
    const earlier = await statusesIn('[data-testid="earlier-bookings"]');

    // Nothing is lost in the split — a cancelled booking is still part of this list, which is the
    // whole reason it moved rather than being hidden.
    expect(active.length + earlier.length, 'every card belongs to exactly one group')
      .toBe(await cards.count());

    expect(active.some(isFinished), 'a cancelled booking must not sit among the live ones').toBeFalsy();
    expect(earlier.every(isFinished), 'only finished bookings belong under the heading').toBeTruthy();

    if (earlier.length) {
      await expect(
        page.getByText('Earlier bookings'),
        'the boundary between "act on this" and "this already happened" has to be named',
      ).toBeVisible();
    }

    if (active.length) {
      // The regression guard. Measured against the card's own row rather than a fixed pixel
      // count, so it holds at whatever viewport the suite runs.
      const first = page.locator('[data-testid="active-bookings"] [data-testid="appointment-card"]').first();
      const { card, row } = await first.evaluate((el) => ({
        card: el.getBoundingClientRect().width,
        row: el.parentElement.getBoundingClientRect().width,
      }));
      expect(card, 'an open booking takes the full row, not a grid column').toBeGreaterThan(row * 0.9);
    }
  });
});

test.describe('Abnormal value highlighting', () => {
  // Exercised through the browser so it runs the shipped module rather than a copy of it.
  test('out-of-range values are flagged, in-range and prose are left alone', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/lib/abnormalValues.js');
      const panel = [
        'COMPLETE BLOOD COUNT (CBC) RESULTS:',
        'Hemoglobin: 11.2 g/dL (Normal: 13.0 - 17.5)',
        'Hematocrit: 43.5 % (Normal: 40.0 - 52.0)',
        'WBC Count: 14.9 x 10^9/L (Normal: 4.5 - 11.0)',
        'Platelet Count: 280 x 10^9/L (Normal: 150 - 450)',
        '',
        'IMPRESSION:',
        'Anaemia with leucocytosis.',
      ].join('\n');

      return {
        lines: mod.analyseFindings(panel).map((l) => l.flag),
        count: mod.abnormalCount(panel),
        // Boundary values are IN range. A haemoglobin of exactly 13.0 against "13.0 - 17.5" is
        // normal, and flagging the endpoint would fire on the case clinicians care least about.
        lowerBound: mod.analyseFindings('Hb: 13.0 g/dL (Normal: 13.0 - 17.5)')[0].flag,
        upperBound: mod.analyseFindings('Hct: 52.0 % (Normal: 40.0 - 52.0)')[0].flag,
        // An inverted range means the line is not what the parser assumes; it must decline rather
        // than decide a value is abnormal against limits that cannot be right.
        inverted: mod.analyseFindings('Odd: 5 (Normal: 10 - 2)')[0].flag,
        prose: mod.analyseFindings('- Lungs are clear with no active infiltrates.')[0].flag,
      };
    });

    // Line-for-line: heading, LOW, normal, HIGH, normal, blank, heading, prose.
    expect(result.lines).toEqual([null, 'low', null, 'high', null, null, null, null]);
    expect(result.count).toBe(2);

    expect(result.lowerBound, 'a value exactly on the lower bound is normal').toBeNull();
    expect(result.upperBound, 'a value exactly on the upper bound is normal').toBeNull();
    expect(result.inverted, 'an inverted range must not produce a flag').toBeNull();
    expect(result.prose, 'a radiologist\'s prose is not an analyte').toBeNull();
  });

  test('a line it cannot parse is never rewritten', async ({ page }) => {
    await page.goto('/');

    const preserved = await page.evaluate(async () => {
      const mod = await import('/src/lib/abnormalValues.js');
      const original = 'Impression: no acute cardiopulmonary findings.\n\n  indented note';
      const lines = mod.analyseFindings(original);
      // The safety property: this only ever ADDS emphasis. Round-tripping the text unchanged is
      // what makes "the parser did not understand this" harmless — the reader sees exactly what
      // the technician typed.
      return lines.map((l) => l.text).join('\n') === original;
    });

    expect(preserved).toBeTruthy();
  });
});
