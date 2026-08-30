// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * The pass is a receipt, not a booking confirmation.
 *
 * The clinic takes payment before the visit [1.48.0], and every screen agreed about that except
 * the one the patient actually sees first: `BookingConfirmation` rendered the scannable QR the
 * instant a booking succeeded, with the words "present this code at the front desk" under it.
 * `AppointmentsTab` had the rule right the whole time (`showPass = isOpen && appt.is_paid`), and
 * `appointmentRepository.findByPatientUserId` documents it — so the app stated the rule in three
 * places and broke it in the one place a patient reads.
 *
 * The failure is not that reception would honour a QR for unpaid work. It is that the patient
 * stops: they have a pass, the screen tells them to present it, and nothing anywhere mentions
 * money. They arrive expecting to walk in.
 *
 * This drives the real wizard rather than asserting on props, because the bug was invisible to
 * every API test in the suite — the endpoint behaved correctly and always had.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

/** A weekday far enough out that nothing else in the suite is competing for its slots. */
function farWorkingDay() {
  const d = new Date();
  d.setDate(d.getDate() + 240 + (Date.now() % 40));
  // Saturday closes at noon and carries 8 slots instead of 18, so a spec that lands there starts
  // failing on the day of the week rather than on anything in the app.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


test('a self-pay booking is confirmed without issuing the pass', async ({ page }) => {
  const ctx = await request.newContext();

  // Availability is behind auth — it exposes how full the clinic's day is.
  const token = (await (await ctx.post(`${API}/auth/login`, {
    data: { email: 'client@enlogada.com', password: PASSWORD },
  })).json()).data.token;

  const date = farWorkingDay();
  const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()).data.slots.filter((s) => s.available);
  test.skip(free.length === 0, 'Need a free slot to book into.');
  const slot = free[0].time;
  await ctx.dispose();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'client@enlogada.com');

  await page.getByRole('button', { name: 'Book Schedule' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Step 1 — what, and when.
  await dialog.locator('#slotpicker-label').fill(date);
  const slotButton = dialog.locator(`[data-testid="slot-${slot}"]`);
  await expect(slotButton).toBeVisible({ timeout: 15000 });
  await slotButton.click();

  // Any priced item will do — the assertion is about the pass, not about which test. Each
  // checkbox carries its own name and price, so this deliberately does not hard-code a fixture's
  // name the way laboratory.spec.js once did.
  const box = dialog.getByRole('checkbox').first();
  await expect(box).toBeVisible({ timeout: 10000 });
  await box.check();

  // Step 2 — the HMO question, left on its Self-Pay default, which is the case under test. The
  // step pill rather than the Next button: the pill is always in view, while Next sits below a
  // catalogue of 60-odd tests.
  await dialog.getByRole('button', { name: /2\. HMO/i }).click();
  const submit = dialog.getByRole('button', { name: /submit schedule request/i });
  await expect(submit).toBeVisible({ timeout: 10000 });
  await submit.click();

  // The booking succeeded — the reference is issued either way, and the counter path has never
  // depended on the QR.
  await expect(dialog.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });

  // The rule. A pass must not exist for money the clinic has not received.
  await expect(
    dialog.locator('[data-testid="booking-pass-qr"]'),
    'an unpaid booking must not be issued a scannable pass'
  ).toHaveCount(0);

  // And the patient is told what to do instead, with the amount named. "The amount due" is not an
  // instruction to someone about to type a figure into a banking app.
  const awaiting = dialog.locator('[data-testid="booking-awaiting-payment"]');
  await expect(awaiting, 'the confirmation must say payment is outstanding').toBeVisible();
  await expect(dialog.getByText(/Awaiting payment/i)).toBeVisible();
  await expect(
    dialog.getByText(/₱/).first(),
    'the confirmation must name the figure, not just mention payment'
  ).toBeVisible();

  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});
