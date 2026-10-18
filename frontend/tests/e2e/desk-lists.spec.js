// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { todayStr } from './helpers/dates.js';

/**
 * The Desk's lists, each a table like today's queue. [1.130.0]
 *
 * Steven: "still to arrive what if there would be a lot it would be hassle and would not look nice
 * ... put that same like how todays queue made". It was a row of name buttons under the Who's here
 * box. And a visit paid on an earlier day, still with a department, was on no Desk screen at all:
 * today's queue is today's. Served here rather than booked, for the reason front-desk.spec.js
 * gives: a booking for TODAY can only be made before closing time, and a visit from an EARLIER day
 * cannot be made at all. The endpoint's own rule is checked against real data below.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

const NAMES = [
  ['Rosario', 'Magbanua'], ['Danilo', 'Ocampo'], ['Imelda', 'Cuenca'], ['Ramon', 'Ylagan'],
  ['Soledad', 'Navarro'], ['Teodoro', 'Bacani'], ['Liwayway', 'Padilla'], ['Ignacio', 'Zulueta'],
  ['Perlita', 'Agbayani'], ['Federico', 'Salcedo'],
];
const bookings = NAMES.map(([first, last], i) => ({
  id: 987654300 + i, appointment_reference: `APT-E2E00000${String(i).padStart(3, '0')}`, status: 'Pending',
  scheduled_date: todayStr(), scheduled_time: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`,
  first_name: first, last_name: last, patient_id: 987654300 + i, patient_visit_id: 987654300 + i,
  patient_type_name: 'Self Pay', booked_test_names: ['Complete Blood Count (CBC)'], is_paid: i === 0,
  categories: [], has_doctor_request: false,
}));

test.describe('The Desk lists what it is waiting on, as tables', () => {
  test("today's bookings are a paged table, and Check in opens the booking's card", async ({ page }) => {
    await page.route((url) => url.pathname === '/api/appointments', (route) => route.fulfill({
      json: { status: 'success', data: { appointments: bookings, total: bookings.length } },
    }));
    await page.route((url) => url.pathname === `/api/appointments/verify/${bookings[1].appointment_reference}`, (route) => route.fulfill({
      json: { status: 'success', data: { appointment: bookings[1] } },
    }));

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const arrivals = page.getByTestId('arrivals');
    await expect(arrivals.getByRole('heading', { name: 'Still to arrive today' })).toBeVisible({ timeout: 15000 });
    for (const header of ['Time', 'Patient Name', 'Patient Category', 'Booked Tests', 'Payment']) {
      await expect(arrivals.getByRole('columnheader', { name: header })).toBeVisible();
    }
    await expect(arrivals.getByTestId('arrival-row')).toHaveCount(8);
    await expect(arrivals).toContainText('Showing 1–8 of 10');
    await expect(arrivals.getByTestId('arrival-row').first()).toContainText('Paid');
    await expect(arrivals.getByTestId('arrival-row').nth(1)).toContainText('Complete Blood Count (CBC)');

    // Not also a row of buttons in the box: a booking is listed once.
    await expect(page.getByText('Still to arrive today:')).toHaveCount(0);

    await arrivals.getByRole('button', { name: 'Check in Danilo Ocampo' }).click();
    await expect(page.getByTestId('booking-card')).toContainText('Danilo Ocampo', { timeout: 15000 });
  });

  test('a booking not paid in time is named, not listed; a row can be moved from the table', async ({ page }) => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const lapsed = { ...bookings[2], held_until: past, is_paid: false };
    const moved = { ...bookings[3], rescheduled_at: past, reschedule_reason: 'Patient asked for a later time' };
    await page.route((url) => url.pathname === '/api/appointments', (route) => route.fulfill({
      json: { status: 'success', data: { appointments: [bookings[0], bookings[1], lapsed, moved], total: 4 } },
    }));

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const arrivals = page.getByTestId('arrivals');
    await expect(arrivals.getByTestId('arrival-row')).toHaveCount(3, { timeout: 15000 });
    await expect(arrivals.getByTestId('arrival-row').filter({ hasText: 'Imelda Cuenca' })).toHaveCount(0);
    await expect(arrivals.getByTestId('arrivals-lapsed')).toContainText('Imelda Cuenca');
    await expect(arrivals.getByTestId('arrivals-lapsed')).toContainText('not paid in time');

    // A booking moved says so, and why, before the patient has to.
    await expect(arrivals.getByTestId('arrival-row').filter({ hasText: 'Ramon Ylagan' }))
      .toContainText('Moved · Patient asked for a later time');

    await arrivals.getByRole('button', { name: 'Reschedule Danilo Ocampo' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Reschedule Appointment' })).toBeVisible();
  });

  test('a paid booking nobody came for is listed to be moved, never written off', async ({ page }) => {
    const lastWeek = new Date(Date.now() - 7 * 86400000);
    await page.route((url) => url.pathname === '/api/visits/carried-over', (route) => route.fulfill({
      json: {
        status: 'success',
        data: {
          visits: [],
          missedBookings: [{
            id: 987654398, appointment_reference: 'APT-E2E0000MISS', status: 'Pending',
            scheduled_date: lastWeek.toISOString(), scheduled_time: '09:00:00', patient_visit_id: 987654398,
            patient_id: 987654398, first_name: 'Gabriela', last_name: 'Sarmiento', booked_test_names: ['Pelvic Ultrasound'],
          }],
        },
      },
    }));
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const missed = page.getByTestId('missed-bookings');
    await expect(missed.getByRole('heading', { name: 'Paid bookings nobody came for' })).toBeVisible({ timeout: 15000 });
    await expect(missed.getByTestId('missed-booking-row')).toContainText('Gabriela Sarmiento');
    await missed.getByRole('button', { name: 'Reschedule Gabriela Sarmiento' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Reschedule Appointment' })).toBeVisible();
  });

  test('a visit from an earlier day still with a department is on the Desk', async ({ page }) => {
    const yesterday = new Date(Date.now() - 86400000);
    yesterday.setHours(19, 35, 0, 0);
    await page.route((url) => url.pathname === '/api/visits/carried-over', (route) => route.fulfill({
      json: {
        status: 'success',
        data: {
          visits: [{
            id: 987654399, created_at: yesterday.toISOString(), queue_number: '0002', visit_type: 'Walk in',
            visit_status: 'Processing', patient_id: 987654399, first_name: 'Corazon', last_name: 'Dimaano',
            patient_type_name: 'Self Pay',
            tests: [
              { id: 1, name: 'Complete Blood Count (CBC)', category: 'Laboratory', status: 'Processing' },
              { id: 2, name: 'Pelvic Ultrasound', category: 'Ultrasound', status: 'Completed', released_at: yesterday.toISOString() },
            ],
          }],
        },
      },
    }));

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const carried = page.getByTestId('carried-over');
    await expect(carried.getByRole('heading', { name: 'From earlier days, still with a department' })).toBeVisible({ timeout: 15000 });
    const row = carried.getByTestId('carried-over-row');
    await expect(row).toContainText('Corazon Dimaano');
    await expect(row.locator('[data-state="in-progress"]')).toContainText('With Laboratory');
    await expect(row.locator('[data-state="released"]')).toContainText('Released');
  });

  test('and is not shown at all when there is nothing from earlier days', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/visits/carried-over', (route) => route.fulfill({
      json: { status: 'success', data: { visits: [] } },
    }));
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await expect(page.getByRole('heading', { name: "Today's queue" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('carried-over')).toHaveCount(0);
  });

  test('the endpoint lists only earlier days, only work still with a department', async () => {
    const ctx = await request.newContext();
    const token = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
    const res = await ctx.get(`${API}/visits/carried-over`, { headers: { Authorization: `Bearer ${await token('receptionist@enlogada.com')}` } });
    expect(res.status()).toBe(200);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const v of (await res.json()).data.visits) {
      expect(v.visit_status).toBe('Processing');
      expect(new Date(v.created_at).getTime(), `${v.id} is from an earlier day`).toBeLessThan(today.getTime());
    }
    // A department reads its worklist, not the Desk's.
    const lab = await ctx.get(`${API}/visits/carried-over`, { headers: { Authorization: `Bearer ${await token('lab@enlogada.com')}` } });
    expect(lab.status()).toBe(403);
    await ctx.dispose();
  });
});
