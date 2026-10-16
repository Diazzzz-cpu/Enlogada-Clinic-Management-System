// @ts-check
import { test, expect, request } from 'playwright/test';

// The one deliberately public endpoint that touches the patient queue. [1.63.0]
//
// `GET /visits/queue-status` backs the home page's live-queue card, and it is unauthenticated on
// purpose: a patient deciding whether to set off now should not need an account, and a clinic
// waiting-room display carries the same information.
//
// That argument holds ONLY while the response stays aggregate. These tests are the boundary — they
// fail if anybody widens the SELECT, because the privacy control here is the shape of the payload
// rather than a permission check. Everything else under /visits is staff-gated, so this route is
// the exception and exceptions are what get copied.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

test.describe('Public queue status', () => {
  let ctx;

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('it answers without a token', async () => {
    const res = await ctx.get(`${API}/visits/queue-status`);
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe('success');
  });

  test('it returns counts and an estimate — and NOTHING that identifies a patient', async () => {
    const { queue } = (await (await ctx.get(`${API}/visits/queue-status`)).json()).data;

    // An exact allow-list, not a "does not contain" check. A new field has to be added here
    // consciously, which is the point — this is where somebody decides what the open internet
    // may see about a clinic's patients.
    expect(Object.keys(queue).sort()).toEqual([
      'asOf', 'estimateBasis', 'estimateIsCapped', 'estimatedWaitMinutes', 'inProgress', 'waiting',
    ]);

    expect(typeof queue.waiting).toBe('number');
    expect(typeof queue.inProgress).toBe('number');
    expect(queue.waiting).toBeGreaterThanOrEqual(0);
    expect(queue.inProgress).toBeGreaterThanOrEqual(0);

    // Belt and braces: nothing anywhere in the serialised body that looks like a person.
    const body = JSON.stringify(queue).toLowerCase();
    for (const forbidden of ['first_name', 'last_name', 'patient', 'queue_number', 'email', 'contact', 'birthdate']) {
      expect(body, `must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('the estimate obeys the same rules as the staff-facing one', async () => {
    const { queue } = (await (await ctx.get(`${API}/visits/queue-status`)).json()).data;

    // Same estimator as the reception queue and the booking pass. A patient told "about 25
    // minutes" here and something different at the desk has been misled by the clinic twice in
    // ten minutes.
    if (queue.estimatedWaitMinutes !== null) {
      expect(queue.estimatedWaitMinutes % 5, 'rounded to five minutes').toBe(0);
      expect(queue.estimatedWaitMinutes).toBeGreaterThanOrEqual(5);
      expect(queue.estimatedWaitMinutes).toBeLessThanOrEqual(90);
    }
    expect(['measured', 'default']).toContain(queue.estimateBasis);
  });

  test('every OTHER visits route still refuses an anonymous caller', async () => {
    // The exception must not have widened into a hole. If `/queue-status` being public somehow
    // made its siblings public, this is where that shows up.
    for (const path of ['/visits/active', '/visits/history', '/visits/1']) {
      const res = await ctx.get(`${API}${path}`);
      expect(res.status(), `${path} must stay gated`).toBe(401);
    }
  });

  test('the home page shows the live card without anyone signing in', async ({ page }) => {
    await page.goto('/');

    // The three errands a visitor arrives to run.
    await expect(page.getByRole('button', { name: /Book an Appointment/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /View My Results/i })).toBeVisible();
    await expect(page.getByText('Clinic Right Now')).toBeVisible();

    // The card resolves to real copy — either a count or the walk-in fallback — rather than
    // sitting empty when the fetch fails.
    await expect(
      page.getByText(/waiting|Walk-ins welcome|No one is waiting/i).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
