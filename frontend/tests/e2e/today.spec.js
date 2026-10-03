// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { todayStr } from './helpers/dates.js';

/**
 * Today — every member of staff's first screen. [1.77.0]
 *
 * Steven chose it on the decisions page: "Today" first in every sidebar, and the screen sign-in
 * lands on, with Admin's Dashboard becoming Admin's Today so there is one home, not two. It shows
 * only what each person already holds, and every item on it has a button that deals with it.
 *
 * What these hold is that promise: the landing and the order, that the buttons open the right
 * screen already doing the right thing, and that each role gets its own day rather than someone
 * else's. Where a real row could be crowded out by what a run leaves behind — the list names the
 * oldest few — the screen is served exactly the row under test, as front-desk.spec.js does.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

// Each role's own day, told apart by the part only that day has.
const ROLES = [
  { who: 'the front desk', email: 'receptionist@enlogada.com', own: 'today-bookings' },
  { who: 'the cashier', email: 'cashier@enlogada.com', own: 'today-takings' },
  { who: 'the laboratory', email: 'lab@enlogada.com', own: 'today-department' },
  { who: 'an Admin', email: 'clinicadmin@enlogada.com', own: 'today-departments' },
];

test.describe('Today', () => {
  for (const { who, email, own } of ROLES) {
    test(`${who} signs in to Today, first in the sidebar`, async ({ page }) => {
      await signIn(page, email);
      await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), / }))
        .toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId(own)).toBeVisible();
      // Only that role's day: nobody else's section is on it.
      for (const other of ROLES.filter((r) => r.own !== own)) {
        await expect(page.getByTestId(other.own)).toHaveCount(0);
      }

      const rail = page.getByRole('complementary');
      await expect(rail.getByTestId('nav-item').first()).toHaveAttribute('data-nav-id', 'today');
      await expect(rail.locator('[data-nav-id="today"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('today-needs')).toHaveCount(1);
      // Admin's Dashboard became Admin's Today: one home, not two.
      await expect(page.locator('[data-nav-id="dashboard"]')).toHaveCount(0);
    });
  }

  test("a visit with nothing on it is the desk's to fix, and Add tests opens it on the Desk", async ({ page }) => {
    const ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'receptionist@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const H = { Authorization: `Bearer ${token}` };
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: H,
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1991-06-21', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const created = await ctx.post(`${API}/visits`, {
      headers: H, data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e today no tests' },
    });
    expect(created.status()).toBe(201);
    const visitId = (await created.json()).data.visit.id;

    // The visit exactly as the queue reports it, served on its own so it is one of the rows shown.
    const active = (await (await ctx.get(`${API}/visits/active`, { headers: H })).json()).data;
    const mine = active.visits.find((v) => v.id === visitId);
    expect(mine, 'the new visit should be in today\'s queue').toBeTruthy();
    await ctx.dispose();

    await page.route((url) => url.pathname === '/api/visits/active', (route) => route.fulfill({
      json: { status: 'success', data: { visits: [mine], total: 1, pendingCount: 1, processingCount: 0, walkinCount: 1 } },
    }));

    await signIn(page, 'receptionist@enlogada.com');
    const need = page.locator(`[data-need="no-tests-${visitId}"]`);
    await expect(need).toContainText(`${person.fullName} has no tests yet`, { timeout: 20000 });
    await need.getByRole('button', { name: `Add tests for ${person.fullName}` }).click();

    // That visit's tests, open on arrival. The dialog hides the page behind it, so the Desk is
    // checked once it closes: there, with the queue narrowed to the person behind them.
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Edit Tests on This Visit' }))
      .toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: "Who's here?" })).toHaveValue(person.fullName);
  });

  test("a booking due today checks in from Today, on the Desk's own card", async ({ page }) => {
    // Served rather than booked, for the reason front-desk.spec.js gives: a booking for TODAY can
    // only be made before closing time, and this must hold at night too.
    const reference = 'APT-E2E0000BEEF';
    const booking = {
      id: 987654322, appointment_reference: reference, status: 'Pending',
      scheduled_date: todayStr(), scheduled_time: '10:30:00',
      first_name: 'Rosario', last_name: 'Magbanua', patient_id: 987654322,
      queue_number: 'Q-098', is_paid: true, categories: [],
    };
    await page.route((url) => url.pathname === '/api/appointments', (route) => route.fulfill({
      json: { status: 'success', data: { appointments: [booking], total: 1 } },
    }));
    await page.route((url) => url.pathname === `/api/appointments/verify/${reference}`, (route) => route.fulfill({
      json: { status: 'success', data: { appointment: booking } },
    }));

    await signIn(page, 'receptionist@enlogada.com');
    const row = page.getByTestId('today-booking').filter({ hasText: 'Rosario Magbanua' });
    // Due or late depends on the clock; either way it has not arrived, so it can be checked in.
    await expect(row).toContainText(/Due|Late/, { timeout: 20000 });
    await row.getByRole('button', { name: 'Check in Rosario Magbanua' }).click();

    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });
    const card = page.getByTestId('booking-card');
    await expect(card).toContainText('Rosario Magbanua');
    await expect(card.getByRole('button', { name: 'Confirm Check-In Patient' })).toBeVisible();
  });

  test('reports that never reached the patient open History already filtered to them', async ({ page }) => {
    const report = {
      visit_test_id: 987654324, test_status: 'Completed', test_name: 'Complete Blood Count (CBC)',
      category_name: 'Laboratory', first_name: 'Ana', last_name: 'Reyes', patient_id: 987654324,
      patient_email: 'ana.reyes@enlogada-e2e.test', emailed_at: null, email_count: 0,
      released_at: new Date().toISOString(), visit_date: new Date().toISOString(), queue_number: 'Q-097', version: 1,
    };
    // Only Today's read (the last seven days) is served; History asks the real server.
    const todaysRead = (url) => url.pathname === '/api/results/released/Laboratory' && url.searchParams.get('days') === '7';
    await page.route(todaysRead, (route) => route.fulfill({ json: { status: 'success', data: { released: [report] } } }));

    await signIn(page, 'lab@enlogada.com');
    const need = page.locator('[data-need="unsent-Laboratory"]');
    await expect(need).toContainText('1 released report not yet sent to the patient', { timeout: 20000 });

    const historyAsks = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return url.pathname === '/api/results/released/Laboratory'
        && url.searchParams.get('delivery') === 'unsent' && !url.searchParams.has('days');
    });
    await need.getByRole('button', { name: 'Open Laboratory History' }).click();
    await expect(page.getByRole('heading', { name: 'Laboratory History', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });
    await historyAsks;
  });

  test('the cashier sees the takings, and one way to the till', async ({ page }) => {
    await signIn(page, 'cashier@enlogada.com');
    await expect(page.getByTestId('today-takings')).toContainText('Collected today', { timeout: 20000 });

    // From the waiting row when someone waits, from the empty list when nobody does — never both.
    const open = page.getByRole('button', { name: 'Open the till', exact: true });
    await expect(open).toHaveCount(1);
    await open.click();
    await expect(page.getByRole('heading', { name: 'Billing Queue', level: 1 })).toBeVisible({ timeout: 15000 });
  });

  test("an Admin's Today is the clinic's: money, the queue and every department", async ({ page }) => {
    await signIn(page, 'clinicadmin@enlogada.com');
    const departments = page.getByTestId('today-departments');
    for (const name of ['Laboratory', 'Ultrasound', 'X-Ray']) {
      await expect(departments).toContainText(name, { timeout: 20000 });
    }
    await expect(page.getByText('Revenue today', { exact: true })).toBeVisible();
    await expect(page.getByText('In the queue', { exact: true })).toBeVisible();
    // Not a till: an Admin reads the takings, and does not take them.
    await expect(page.getByTestId('today-takings')).toHaveCount(0);
  });

  test('an HMO request waiting on an Admin is a decision on Today, one press from Service Requests', async ({ page }) => {
    const pendingClaims = (url) => url.pathname === '/api/hmo/requests' && url.searchParams.get('status') === 'Pending';
    await page.route(pendingClaims, (route) => route.fulfill({
      json: {
        status: 'success',
        data: {
          requests: [{
            id: 987654325, status: 'Pending', provider_name: 'Maxicare', patient_visit_id: 987654325,
            patient_first_name: 'Carla', patient_last_name: 'Mendoza',
          }],
        },
      },
    }));

    await signIn(page, 'clinicadmin@enlogada.com');
    const need = page.locator('[data-need="hmo-decisions"]');
    await expect(need).toContainText('1 HMO request waiting for your decision', { timeout: 20000 });
    await expect(need).toContainText('Carla Mendoza');

    // The real list from here on: Service Requests is not what is under test.
    await page.unroute(pendingClaims);
    await need.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('heading', { name: 'Service Requests', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });
  });

  test('a Receptionist who is also a Cashier gets one "Needs you now" and both days', async ({ page }) => {
    const ctx = await request.newContext();
    const exists = (await ctx.post(`${API}/auth/login`, {
      data: { email: 'multirole@enlogada.com', password: PASSWORD },
    })).ok();
    await ctx.dispose();
    test.skip(!exists, 'multirole@enlogada.com not seeded on this database');

    await signIn(page, 'multirole@enlogada.com');
    await expect(page.getByRole('region', { name: 'Front desk' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('region', { name: 'Billing' })).toBeVisible();
    await expect(page.getByTestId('today-needs')).toHaveCount(1);
  });
});
