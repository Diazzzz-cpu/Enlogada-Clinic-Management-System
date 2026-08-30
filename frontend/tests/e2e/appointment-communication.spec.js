// @ts-check
import { test, expect, request } from 'playwright/test';

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
