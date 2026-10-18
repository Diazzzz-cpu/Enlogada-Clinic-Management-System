// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { todayStr } from './helpers/dates.js';

/**
 * The front desk works from one screen. [1.75.0]
 *
 * Steven picked option F1: one Desk where a Who's here box finds the person in front of the
 * receptionist — a booking today, a record on file, or nobody yet — above the queue it feeds, with
 * registration in a side panel. It replaced three screens that one arrival used to need.
 *
 * What these hold is that the move changed where things are and nothing about what they do: the
 * same check-in flow, the same confirmation, and the rule the box adds — somebody already in today's
 * queue is not offered a second visit.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const WHO = "Who's here?";

test.describe("The Desk's Who's here box", () => {
  let ctx;
  let testName;
  const person = fixturePerson();

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'receptionist@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const H = { Authorization: `Bearer ${token}` };

    // On file, with no visit today: the case the box offers "Start visit" for.
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const created = await ctx.post(`${API}/patients`, {
      headers: H,
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1987-02-14', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    });
    expect(created.status()).toBe(201);
    testName = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory').name;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('someone on file is found by name and started on a visit from the same box', async ({ page }) => {
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });
    await page.getByRole('searchbox', { name: WHO }).fill(person.lastName);

    const match = page.getByTestId('desk-match').filter({ hasText: person.fullName });
    await expect(match).toBeVisible({ timeout: 15000 });
    await match.getByRole('button', { name: 'Start visit' }).click();
    // The same confirmation the old lookup used, which since [1.129.0] asks what the visit is for:
    // a visit is never opened empty, so Confirm waits for a test.
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Confirm Check-In', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByPlaceholder('Filter tests…').fill(testName);
    await dialog.getByRole('checkbox', { name: testName }).first().check();
    await confirm.click();

    // The ticket, announced where the receptionist is looking, and the visit in the queue below —
    // found by the same name, which the box leaves in place.
    await expect(page.getByText(`${person.fullName} checked in!`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('tbody tr', { hasText: person.fullName })).toBeVisible({ timeout: 15000 });
    await expect(match).toHaveCount(0);
  });

  test('someone already in the queue is not offered a second visit', async ({ page }) => {
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: WHO }).fill(person.lastName);

    await expect(page.locator('tbody tr', { hasText: person.fullName })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/already in today's queue/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('desk-match').filter({ hasText: person.fullName })).toHaveCount(0);
  });

  test("today's bookings wait under the box, and one opens its check-in card", async ({ page }) => {
    // Served here rather than booked: a booking for TODAY can only be made before closing time, and
    // a spec that only works in the morning is one that quietly stops testing anything at night.
    // What is under test is the Desk listing today's bookings and opening one, not the booking.
    const reference = 'APT-E2E0000FACE';
    const booking = {
      id: 987654321, appointment_reference: reference, status: 'Pending',
      scheduled_date: todayStr(), scheduled_time: '10:30:00',
      first_name: 'Rosario', last_name: 'Magbanua', patient_id: 987654321,
      queue_number: 'Q-099', is_paid: false, categories: [],
      // [1.106.0] Booked online, so it carries the doctor's signed request.
      patient_visit_id: 987654321, has_doctor_request: true,
    };
    await page.route((url) => url.pathname === '/api/visits/987654321/doctor-request', (route) => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
    }));
    await page.route((url) => url.pathname === '/api/appointments', (route) => route.fulfill({
      json: { status: 'success', data: { appointments: [booking], total: 1 } },
    }));
    await page.route((url) => url.pathname === `/api/appointments/verify/${reference}`, (route) => route.fulfill({
      json: { status: 'success', data: { appointment: booking } },
    }));

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('button', { name: /Rosario Magbanua/ }).click({ timeout: 15000 });

    const card = page.getByTestId('booking-card');
    await expect(card).toContainText('Rosario Magbanua');
    await expect(card.getByRole('button', { name: 'Confirm Check-In Patient' })).toBeVisible();
    await expect(card.getByRole('button', { name: /Reschedule this booking/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /No-Show/ })).toBeVisible();
    // Unpaid, and the card says so before anyone checks the patient in.
    await expect(card).toContainText(/no confirmed payment/i);

    // The patient uploaded the doctor's request instead of typing the doctor's name, so check-in
    // is where the desk reads it — in place, and decoded rather than a broken image. [1.106.0]
    await card.getByRole('button', { name: "View doctor's request / notes" }).click();
    const paper = card.getByAltText("The doctor's signed request for this booking");
    await expect(paper).toBeVisible();
    await expect.poll(() => paper.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    await card.getByRole('button', { name: "Hide doctor's request / notes" }).click();
    await expect(paper).toHaveCount(0);
  });

  test('registration opens beside the queue and closes back onto it', async ({ page }) => {
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('button', { name: 'Register Walk-In', exact: true }).click();

    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: 'Walk-In Registration' })).toBeVisible();
    await expect(panel.locator('#wi-email')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: WHO })).toBeVisible();
  });

  test('the Cashier reads the Desk without the box, and keeps a search of its own', async ({ page }) => {
    await signIn(page, 'cashier@enlogada.com');
    await page.getByRole('button', { name: 'Desk', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });

    // A Cashier can neither check a booking in nor start a visit, so the box that does both is not
    // offered; the queue keeps the search it always had.
    await expect(page.getByRole('searchbox', { name: WHO })).toHaveCount(0);
    await expect(page.getByPlaceholder('Search patient name or Queue #...')).toBeVisible();
  });
});
