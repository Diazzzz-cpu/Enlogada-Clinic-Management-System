// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { selfPayProfile } from './helpers/patients.js';

// What the patient is told about their own booking. [1.24.0]
//
// Before this the system sent exactly two emails — a password reset and a result release. Booking
// online notified *staff* and told the patient nothing, so their only record was a confirmation
// screen that vanished with the tab, taking the reference the front desk asks for.
//
// And nowhere did it say what to do beforehand. A Fasting Blood Sugar needs eight hours without
// food; a pelvic ultrasound needs a full bladder. A patient told neither arrives unable to be
// tested and the slot is lost with them — the most expensive kind of defect in a clinic system,
// because the cost lands on the patient, the schedule and the front desk at once.
//
// SMTP is usually unconfigured in development, and sendEmail returns `{skipped:true}` rather than
// throwing. So these tests assert the things that hold either way: the instruction reaches the
// API, it reaches the screen where the patient chooses, and a booking still succeeds when there
// is no mail server and no address to send to.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Booking communication and preparation', () => {
  let ctx;
  let adminToken;
  let clientToken;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    adminToken = await login('admin@enlogada.com');
    clientToken = await login('client@enlogada.com');
  });

  test.afterAll(async () => ctx.dispose());

  test('preparation is served with the public catalogue', async () => {
    // Public, because the services page and the booking wizard both need it before anyone has
    // committed to anything.
    const res = await ctx.get(`${API}/tests`);
    expect(res.status()).toBe(200);

    const tests = (await res.json()).data.tests;
    expect(tests.length).toBeGreaterThan(0);
    expect(tests[0]).toHaveProperty('preparation');

    // The seed sets instructions on the tests that need them, and leaves the rest null.
    const withPrep = tests.filter((t) => t.preparation);
    expect(withPrep.length).toBeGreaterThan(0);
    expect(tests.some((t) => !t.preparation), 'not every test should carry one').toBe(true);
  });

  test('staff can write and clear a preparation instruction', async () => {
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    const target = tests[0];
    const payload = (preparation) => ({
      categoryId: target.category_id, name: target.name,
      price: target.price, isActive: target.is_active, preparation,
    });

    const set = await ctx.put(`${API}/tests/${target.id}`, {
      headers: auth(adminToken), data: payload('Fast for 8 hours before this test.'),
    });
    expect(set.status()).toBe(200);
    expect((await set.json()).data.test.preparation).toBe('Fast for 8 hours before this test.');

    // Blank means "nothing required" and must land as NULL, not as an empty instruction that
    // renders an empty amber box.
    const cleared = await ctx.put(`${API}/tests/${target.id}`, {
      headers: auth(adminToken), data: payload('   '),
    });
    expect(cleared.status()).toBe(200);
    expect((await cleared.json()).data.test.preparation).toBeNull();

    // Put the seeded value back so this test leaves the catalogue as it found it.
    await ctx.put(`${API}/tests/${target.id}`, {
      headers: auth(adminToken), data: payload(target.preparation),
    });
  });

  test('a booking still succeeds when there is no mail server', async () => {
    // The email is a courtesy; the appointment is the thing that matters. sendEmail swallows its
    // own failures, and appointmentService wraps the whole send — so an SMTP outage must not
    // surface as a failed booking.
    const patientId = selfPayProfile(
      (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(clientToken) })).json()).data.patients
    ).id;

    const day = new Date();
    day.setDate(day.getDate() + 250 + (Date.now() % 40));
    // Saturday too, not just Sunday: the clinic is open 08:00-17:00 on weekdays but only
    // 08:00-12:00 on a Saturday, so a booking spec that lands there has 8 slots instead of 18
    // and starts failing on the day of the week rather than on anything in the app.
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

    const slots = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(clientToken) })).json())
      .data.slots.filter((s) => s.available);
    test.skip(!slots.length, 'no free slot');

    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(clientToken),
      data: { patientId, scheduledDate: date, scheduledTime: slots[0].time },
    });
    expect(booked.status()).toBe(201);

    // And the same for a reschedule and a cancel, which also send now.
    const appt = (await booked.json()).data.appointment;
    const later = slots[1] || slots[0];
    const moved = await ctx.put(`${API}/appointments/${appt.id}/reschedule`, {
      headers: auth(clientToken), data: { scheduledDate: date, scheduledTime: later.time },
    });
    expect(moved.status()).toBe(200);

    const cancelled = await ctx.put(`${API}/appointments/${appt.id}/cancel`, { headers: auth(clientToken) });
    expect(cancelled.status()).toBe(200);
  });
});

test('the booking wizard shows preparation for the test the patient picks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signIn(page, 'client@enlogada.com');

  await page.getByRole('button', { name: 'Book Schedule' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Nothing is shown until a test is actually chosen — a note against every line in a scrolling
  // catalogue is wallpaper, and the point is that it is read.
  await expect(dialog.getByText(/8 hours|full bladder|do not empty your bladder/i)).toHaveCount(0);

  // Tick the tests until one of them carries an instruction.
  const boxes = dialog.locator('input[type="checkbox"]');
  const count = Math.min(await boxes.count(), 8);
  let shown = false;
  for (let i = 0; i < count && !shown; i += 1) {
    await boxes.nth(i).check();
    shown = await dialog.getByText(/water for 8 hours|do not empty your bladder|pregnant|loose top/i)
      .first().isVisible().catch(() => false);
  }

  expect(shown, 'at least one seeded test should show its preparation once selected').toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

// The public Services page — read while somebody is still deciding whether to book at all.
//
// [1.24.0] put preparation on the booking picker, the confirmation and the day-before reminder,
// every one of which happens AFTER the decision. "Nothing to eat or drink except water for 8
// hours" is exactly what decides whether you take a morning slot, and this page is the only one
// a person reads beforehand. It is also the one page that needs no account, so nothing else in
// this suite would notice it going quiet.
test('the public services page tells you how to prepare, before you have an account', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Services', exact: true }).first().click();

  // The catalogue is fetched live, so wait for a real service rather than a fixed delay.
  await expect(page.getByText('Blood Typing').first()).toBeVisible({ timeout: 15000 });

  // Laboratory folds past 8 services [1.38.0], and FBS's position in an alphabetical list is not
  // something this test should depend on — one service beginning with "A" would silently push it
  // behind the fold and fail an assertion about preparation text. Expand if the control is there.
  const seeAll = page.getByTestId('services-toggle-laboratory');
  if (await seeAll.count()) {
    await seeAll.click();
    await page.waitForTimeout(200);
  }
  await expect(page.getByText('Fasting Blood Sugar (FBS)').first()).toBeVisible({ timeout: 15000 });

  // Signed out, no account, no booking started.
  await expect(page.getByText(/water for 8 hours/i).first()).toBeVisible();
  await expect(page.getByText(/do not empty your bladder/i).first()).toBeVisible();

  // And the price is still there — the instruction must not have displaced it.
  //
  // Read from the catalogue rather than hardcoded. This asserted a literal ₱200.00, which was a
  // demo figure; the moment the clinic's real price list was loaded (FBS is ₱190.00) the test
  // failed on a change that was entirely correct. A spec that has to be edited every time the
  // clinic re-prices a service is testing the wrong thing — what matters is that the price
  // renders at all, beside its preparation.
  const fbs = (await (await request.newContext()).get(`${BACKEND_URL}/api/tests`).then((r) => r.json()))
    .data.tests.find((t) => t.name === 'Fasting Blood Sugar (FBS)');
  const formatted = `₱${Number(fbs.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await expect(page.getByText(formatted).first()).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
