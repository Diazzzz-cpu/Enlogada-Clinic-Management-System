// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';

/**
 * A paid receipt is final, so the tests are confirmed before it, and nothing undoes it after. [1.122.0]
 *
 * With no refunds [1.121.0], two things followed:
 *
 *   - BEFORE: the patient confirms the tests. At the till the payment dialog lists them and waits
 *     for the cashier's tick that the patient confirmed; in the portal the account to pay into
 *     appears only after the patient ticks "These are the tests I want".
 *   - AFTER: nothing voids it. Cancelling a paid visit or a paid booking kept the money and gave
 *     nothing for it, a void by another name, so the server refuses both and the Desk and the
 *     portal no longer offer Cancel on one.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Final tests, then a final receipt', () => {
  let ctx;
  let reception, cashier;
  let labTest;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** An unpaid walk-in with one laboratory test, waiting at the till. */
  const walkIn = async () => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...person, birthdate: '1983-07-07', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId: patient.id, visitType: 'Walk in', notes: 'final tests spec', testIds: [labTest.id] },
    })).json()).data.visit;
    return { person, visit };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier] = await Promise.all(['receptionist@enlogada.com', 'cashier@enlogada.com'].map(login));
    labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('the till lists the tests and waits for the patient to confirm them', async ({ page }) => {
    const { person } = await walkIn();

    await signInTo(page, 'cashier@enlogada.com', 'Billing Queue');
    await page.getByPlaceholder('Search ticket # or name...').fill(person.lastName);
    await page.getByRole('button', { name: new RegExp(person.fullName) }).first().click({ timeout: 20000 });
    await page.locator('#cashierdashboard-cash-tendered').fill('100000');
    await page.getByRole('button', { name: 'Take Payment', exact: true }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Are these the final tests?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('final-tests')).toContainText(labTest.name);
    await expect(dialog).toContainText("can't be refunded");

    const take = dialog.getByRole('button', { name: /^Take ₱/ });
    await expect(take, 'not until the patient has confirmed').toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'The patient has confirmed these are their final tests.' }).check();
    await expect(take).toBeEnabled();
    await take.click();
    await expect(page.getByText(/RCT-/).first(), 'the payment went through').toBeVisible({ timeout: 20000 });
  });

  test('no visit is cancelled, paid or not, and the Desk offers no Cancel', async ({ page }) => {
    const paid = await walkIn();
    await payAndReleaseWalkIn(ctx, API, paid.visit.id, cashier);
    const unpaid = await walkIn();

    const refused = await ctx.patch(`${API}/visits/${paid.visit.id}/status`, {
      headers: auth(reception), data: { status: 'Cancelled' },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain("can't be cancelled");

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const box = page.getByRole('searchbox', { name: "Who's here?" });
    await box.fill(paid.person.fullName);
    await expect(page.getByText(paid.person.fullName).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: `Cancel visit for ${paid.person.fullName}` })).toHaveCount(0);

    // [1.131.0] Nor an unpaid one: unpaid is temporary, and it is removed on its own if it is not
    // paid by the end of the day.
    const unpaidRefused = await ctx.patch(`${API}/visits/${unpaid.visit.id}/status`, {
      headers: auth(reception), data: { status: 'Cancelled' },
    });
    expect(unpaidRefused.status()).toBe(409);
    expect((await unpaidRefused.json()).message).toMatch(/removed on its own/);
    await box.fill(unpaid.person.fullName);
    await expect(page.getByText(unpaid.person.fullName).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: `Cancel visit for ${unpaid.person.fullName}` })).toHaveCount(0);
  });

  test('online: the account appears only after the patient confirms the tests, and a paid booking is only moved', async ({ page }) => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token: client } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = await ctx.post(`${API}/patients`, {
      headers: auth(client),
      data: {
        patientTypeId: await patientTypeId(ctx, API, client, 'Self Pay'),
        ...person, birthdate: '1990-01-15', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    });
    expect(profile.status(), await profile.text()).toBe(201);
    const patientId = (await profile.json()).data.patient.id;

    const date = nthWorkingDay(170);
    const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(client) })).json())
      .data.slots.filter((s) => s.available);
    expect(free.length, `a free slot on ${date}`).toBeGreaterThan(0);
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(client),
      multipart: appointmentForm({ patientId, scheduledDate: date, scheduledTime: free[0].time, testIds: [labTest.id] }),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const appointment = (await booked.json()).data.appointment;

    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    const check = page.getByTestId('final-tests-check').first();
    await expect(check).toBeVisible({ timeout: 20000 });
    await expect(check).toContainText(labTest.name);
    await expect(page.getByLabel('Reference number'), 'nothing to pay into yet').toHaveCount(0);
    await check.getByRole('checkbox', { name: 'These are the tests I want.' }).check();
    await expect(page.getByLabel('Reference number').first()).toBeVisible();

    // Paid at the counter instead, after which the booking can be moved and nothing else: there
    // is no cancel route at all [1.131.0], and the portal offers Reschedule, not Cancel.
    await payAndReleaseWalkIn(ctx, API, appointment.patient_visit_id, cashier);
    const cancel = await ctx.put(`${API}/appointments/${appointment.id}/cancel`, { headers: auth(client) });
    expect(cancel.status()).toBe(404);
  });
});
