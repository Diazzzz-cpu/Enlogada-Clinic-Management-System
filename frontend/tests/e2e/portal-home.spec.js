// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInOnPhone } from './helpers/auth.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson } from './helpers/people.js';
import { nthWorkingDay } from './helpers/dates.js';
import { PORTAL_TABS, openPortalTab } from './helpers/portal.js';
import { expectHeaderSpreadsOnScroll } from './helpers/header.js';
import { appointmentForm } from './helpers/booking.js';

/**
 * The patient portal's Home, and the shell around every tab. [1.81.0]
 *
 * Layout A2 in the Flat colouring, which Steven picked. These are the four things that would make the
 * new portal worse than the old one if they broke:
 *
 *   - Home is where a patient finds out they owe money, so it says how much, with the button that
 *     goes where it is paid.
 *   - On a phone the tabs are one bar fixed to the bottom of the screen. A bar that covers the last
 *     thing on the page hides it, and a second copy of the tabs would give every name two matches.
 *   - App holds the tab, so a trip to My Account and back lands where the patient left.
 *   - A failed read of the bookings reads as "couldn't check", never as "nothing booked".
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5050'}/api`;
const PASSWORD = 'TestPass123!';

/** A brand-new client with one Self Pay profile and one unpaid booking of their own. */
async function clientWithUnpaidBooking() {
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = `portal-home-${Date.now()}-${Math.floor(Math.random() * 1e4)}@enlogada-e2e.test`;
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const headers = { Authorization: `Bearer ${token}` };

  const types = (await (await ctx.get(`${API}/patients/types`, { headers })).json()).data.patientTypes;
  const selfPay = types.find((t) => t.name === 'Self Pay') || types[0];
  const patient = (await (await ctx.post(`${API}/patients`, {
    headers,
    data: {
      patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
      birthdate: '1990-01-01', sex: 'Female', address: 'Bugo, Cagayan de Oro City',
      contactNumber: '', emergencyContact: '',
    },
  })).json()).data.patient;

  const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
    .find((t) => t.category_name === 'Laboratory' && Number(t.price) > 0);

  // A far weekday, different on every run, so the booking is not competing with the rest of the
  // suite for slots. A brand-new patient cannot collide with anyone else's booking either way.
  const date = nthWorkingDay(90 + (Date.now() % 60));
  const slot = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers })).json())
    .data.slots.find((s) => s.available);
  expect(slot, `a free slot on ${date}`).toBeTruthy();

  const booked = await ctx.post(`${API}/appointments`, {
    headers,
    multipart: appointmentForm({ patientId: patient.id, scheduledDate: date, scheduledTime: slot.time, testIds: [labTest.id] }),
  });
  expect(booked.status(), 'the booking should be created').toBe(201);
  const { appointment } = (await booked.json()).data;
  await ctx.dispose();
  return { email, appointment };
}

test('Home tells a new client what they owe, and its button goes where it is paid', async ({ page }) => {
  test.setTimeout(120000);
  const { email, appointment } = await clientWithUnpaidBooking();
  await signIn(page, email, PASSWORD);

  const need = page.locator(`[data-testid="portal-need"][data-need="pay-${appointment.id}"]`);
  await expect(need).toBeVisible({ timeout: 20000 });
  await expect(need).toContainText('Pay for your visit');
  await expect(need).toContainText('₱');
  await expect(page.locator('[data-testid="portal-tile"][data-tile="next"]')).not.toContainText('None booked');

  await need.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('tab', { name: PORTAL_TABS.appointments, exact: true }))
    .toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`[data-testid="appointment-card"][data-reference="${appointment.appointment_reference}"]`))
    .toBeVisible({ timeout: 15000 });
});

test('the tab you were on survives a trip to My Account and back', async ({ page }) => {
  await signIn(page, 'client@enlogada.com');
  await openPortalTab(page, 'payments');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByTestId('account-menu').getByRole('button', { name: 'My Account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Account' })).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Back to the portal' }).click();
  await expect(page.getByRole('tab', { name: PORTAL_TABS.payments, exact: true }))
    .toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
});

test('a failed read of the bookings says so on Home, never "nothing booked"', async ({ page }) => {
  await signIn(page, 'client@enlogada.com');
  await page.route('**/api/appointments/my-bookings**', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
  }));
  await page.reload();

  await expect(page.locator('[data-testid="portal-need"][data-need="bookings-failed"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="portal-tile"][data-tile="next"]')).toContainText('—');
  const home = await page.locator('main').innerText();
  expect(home, 'Home stated there was no booking over a failed read').not.toMatch(/none booked/i);
  expect(home, 'Home said nothing needs them over a failed read').not.toMatch(/nothing needs you/i);
});

test('a new account adds its first patient from Profile, and the chip then shows them', async ({ page }) => {
  test.setTimeout(120000);
  // An account with no patient profile yet: the state every online sign-up starts in.
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = `portal-profile-${Date.now()}-${Math.floor(Math.random() * 1e4)}@enlogada-e2e.test`;
  await registerClient(ctx, { ...person, email, password: PASSWORD });
  await ctx.dispose();
  await signIn(page, email, PASSWORD);

  // Home asks for a profile before anything else, and its button opens Profile.
  const need = page.locator('[data-testid="portal-need"][data-need="no-profile"]');
  await expect(need).toBeVisible({ timeout: 20000 });
  await need.getByRole('button', { name: 'Add a profile' }).click();
  await expect(page.getByRole('tab', { name: PORTAL_TABS.profile, exact: true })).toHaveAttribute('aria-selected', 'true');

  // One form for adding and for correcting a profile (ProfileFormDialog). [1.82.0]
  await page.getByTestId('portal-family').getByRole('button', { name: 'Add a profile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill(person.firstName);
  await dialog.getByLabel('Last name').fill(person.lastName);
  await dialog.locator('#add-profile-birthdate').fill('1992-03-14');
  await dialog.getByLabel('Billing category').click();
  await page.getByRole('option', { name: 'Self Pay', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save profile' }).click();

  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(page.getByTestId('portal-family')).toContainText(`${person.firstName} ${person.lastName}`);
  await expect(page.getByRole('combobox', { name: 'Active patient profile' })).toContainText(person.firstName);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the tabs are one bar along the bottom of the screen, and it covers nothing', async ({ page }) => {
    await signInOnPhone(page, 'client@enlogada.com');
    const bar = page.getByTestId('portal-tab-bar');
    await expect(bar).toBeVisible({ timeout: 20000 });

    for (const name of Object.values(PORTAL_TABS)) {
      await expect(page.getByRole('tab', { name, exact: true }), `"${name}" should be one tab`).toHaveCount(1);
    }

    const box = await bar.boundingBox();
    expect(box, 'the bar should have a box').toBeTruthy();
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - 844), 'the bar should sit on the bottom edge').toBeLessThanOrEqual(1);

    // The header at the top does what the public site's does: floats, then spreads once scrolled.
    await expectHeaderSpreadsOnScroll(page, 400);

    const measured = await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      const content = document.querySelector('main')?.firstElementChild?.getBoundingClientRect();
      const barTop = document.querySelector('[data-testid="portal-tab-bar"]')?.getBoundingClientRect().top ?? 0;
      return {
        gap: barTop - (content?.bottom ?? 0),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    expect(measured.gap, 'the last thing on the page should stop above the bar').toBeGreaterThanOrEqual(0);
    expect(measured.overflow, 'Home should not scroll sideways').toBe(0);
  });
});
