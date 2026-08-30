// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { selfPayProfile } from './helpers/patients.js';
import { formatTime12 } from '../../src/lib/date.js';

// The reschedule dialog, driven through the browser.
//
// appointment-reschedule.spec.js proves the rule; this proves a patient can actually reach it.
// The dialog is the only place the shared SlotPicker is used with a `currentTime`, and the whole
// design of that state — the slot you already hold stays selectable and is marked, rather than
// appearing free like any other — is invisible to an API test.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';


test('a patient reschedules from their own booking list', async ({ page }) => {
  // Seeded through the API so the test starts from a known booking rather than depending on
  // whatever the demo data happens to hold.
  const ctx = await request.newContext();
  const login = await ctx.post(`${API}/auth/login`, {
    data: { email: 'client@enlogada.com', password: PASSWORD },
  });
  const token = (await login.json()).data.token;
  const auth = { Authorization: `Bearer ${token}` };

  const patientId = selfPayProfile(
    (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth })).json()).data.patients
  ).id;

  const day = new Date();
  day.setDate(day.getDate() + 300 + (Date.now() % 30));
  // Saturday too, not just Sunday: the clinic is open 08:00-17:00 on weekdays but only
  // 08:00-12:00 on a Saturday, so a booking spec that lands there has 8 slots instead of 18
  // and starts failing on the day of the week rather than on anything in the app.
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

  const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth })).json())
    .data.slots.filter((s) => s.available);
  test.skip(free.length < 2, 'Need two free slots to move between.');

  const created = await ctx.post(`${API}/appointments`, {
    headers: auth,
    data: { patientId, scheduledDate: date, scheduledTime: free[0].time },
  });
  expect(created.status()).toBe(201);
  const reference = (await created.json()).data.appointment.appointment_reference;
  await ctx.dispose();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'client@enlogada.com');

  // The bookings live on their own tab; the dashboard opens on Diagnostic Results.
  await page.getByRole('tab', { name: 'Appointments' }).click();

  // Addressed by data-testid, not by markup shape: `locator('div').filter(...)` matches every
  // ancestor div containing the text and is one layout change away from selecting the wrong one.
  const card = page.locator(`[data-testid="appointment-card"][data-reference="${reference}"]`);

  // Page to it rather than assuming page one. Open bookings sort soonest-first, eight to a page,
  // and the rest of the suite books plenty of nearer dates — so which page this lands on depends
  // on what else has run. Waiting on the list to render first, so the loop is not racing the fetch.
  await expect(page.locator('[data-testid="appointment-card"]').first()).toBeVisible({ timeout: 15000 });
  const nextPage = page.getByLabel('Next page');
  for (let i = 0; i < 12 && (await card.count()) === 0; i += 1) {
    if (!(await nextPage.isEnabled().catch(() => false))) break;
    await nextPage.click();
    await page.waitForTimeout(150);
  }
  await expect(card, 'the booking just created should be somewhere in the list').toBeVisible();
  await card.getByRole('button', { name: 'Reschedule' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Reschedule Appointment')).toBeVisible();
  // The before/after summary: the patient should not have to work out what they are moving from.
  await expect(dialog.getByText('Current appointment')).toBeVisible();

  // Confirm is inert until something actually changes — the dialog opens on the current slot.
  const confirm = dialog.getByRole('button', { name: /confirm new time/i });
  await expect(confirm).toBeDisabled();

  // The slot currently held is marked and still selectable; a different one is picked here.
  // By testid, not by label. The button now reads "9:30 AM" while the API still says "09:30",
  // and a test that clicks a rendered clock breaks the next time the clinic changes how it
  // writes one. Same rule CLAUDE.md states for class names. [1.36.0]
  await dialog.getByTestId(`slot-${free[1].time}`).click();
  // exact, or it also substring-matches the "Confirm new time" button.
  await expect(dialog.getByText('New time', { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 10000 });

  // The list reflects the move without a reload, and the reference is unchanged.
  await expect(page.getByText(reference).first()).toBeVisible();
  // The list renders a 12-hour clock, so assert on that rather than on the wire value.
  await expect(page.getByText(formatTime12(free[1].time)).first()).toBeVisible({ timeout: 10000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
