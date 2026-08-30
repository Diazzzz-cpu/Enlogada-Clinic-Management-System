// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { selfPayProfile } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

// Information each role needs *on the screen where they act*, rather than one screen away.
//
// These came out of a business-process walkthrough — following a visit from the front desk to the
// modality to the patient — rather than from a bug report. Each one was a case where the data
// already existed, the API already returned it, and the screen that needed it did not show it.
// That is the failure mode a page-by-page smoke test cannot see: every screen loads, nothing
// errors, and the work is still harder than it should be.

const PASSWORD = 'Password123!';
const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;



/**
 * A paid Laboratory ticket sitting on the modality worklist, built by this file rather than
 * borrowed from the demo seed.
 *
 * These tests used to assert against whatever the seeded dataset happened to leave on the
 * worklist. That made them tests of the demo data: the seeded tickets are released over a day of
 * suite runs, and once the relevant one is gone the assertion fails with "element not found",
 * which reads exactly like a code regression. `[1.52.0]` Building the ticket makes the assertion
 * exact and the failure honest.
 */
async function paidLabTicket(apiContext, { referringPhysician, sex = 'Female', birthdate = '1978-09-12' } = {}) {
  const login = async (email) =>
    (await (await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
  const rec = await login('receptionist@enlogada.com');
  const cashier = await login('cashier@enlogada.com');
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(rec) })).json())
    .data.patientTypes;
  const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

  const person = fixturePerson();
  const patient = (await (await apiContext.post(`${API}/patients`, {
    headers: auth(rec),
    data: {
      patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
      birthdate, sex, contactNumber: FIXTURE_CONTACT,
    },
  })).json()).data.patient;

  const visit = (await (await apiContext.post(`${API}/visits`, {
    headers: auth(rec),
    data: {
      patientId: patient.id, visitType: 'Walk in', notes: 'e2e worklist context',
      ...(referringPhysician ? { referringPhysician, referringPhysicianPrc: '0142887' } : {}),
    },
  })).json()).data.visit;

  const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
  const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
  await apiContext.post(`${API}/tests/visit-tests`, {
    headers: auth(rec),
    data: { patientVisitId: visit.id, testIds: [labTest.id] },
  });

  // Paying is what releases the ticket to the modality worklist.
  const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
    .data.bill;
  await apiContext.post(`${API}/payments`, {
    headers: auth(cashier),
    data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
  });
  return person;
}

/** Find this run's own row. The worklist pages at 10 against a queue that grows during a run. */
async function findRow(page, person) {
  await page.getByPlaceholder('Search patient, test, queue...').fill(person.lastName);
  const row = page.getByText(`${person.firstName} ${person.lastName}`).locator('xpath=ancestor::tr[1]');
  await expect(row).toBeVisible({ timeout: 15000 });
  return row;
}

test('the diagnostic worklist shows age and sex, which decide the reference range', async ({ page }) => {
  // Not cosmetic. Diagnostic reference ranges are banded by age and by sex — a haemoglobin that
  // is normal for a 40-year-old man is anaemia in a child — so a technician recording findings
  // has to know which band applies. The query returned birthdate and sex all along; the worklist
  // rendered neither, and the tech had to open a second screen to find out.
  const apiContext = await request.newContext();
  try {
    const person = await paidLabTicket(apiContext, { sex: 'Male', birthdate: '1994-03-08' });

    await signIn(page, 'lab@enlogada.com');
    await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
      .toBeVisible({ timeout: 15000 });

    // "PT-12 · 31y · Male" under the patient's name. Asserted on THIS run's own row, so the sex
    // is known rather than whichever the first seeded row happens to carry.
    const row = await findRow(page, person);
    await expect(row).toContainText(/\d+y/);
    await expect(row).toContainText('Male');
  } finally {
    await apiContext.dispose();
  }
});

test('the diagnostic worklist names the referring physician when there is one', async ({ page }) => {
  // The report goes back to this doctor, and a technician querying an odd result needs to know
  // who to call. [1.23.0] recorded it and put it on the report and the HMO review; the worklist
  // — where the work happens — was missed.
  const apiContext = await request.newContext();
  try {
    const person = await paidLabTicket(apiContext, { referringPhysician: 'Dr. Amelia Santos' });

    await signIn(page, 'lab@enlogada.com');
    await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
      .toBeVisible({ timeout: 15000 });

    const row = await findRow(page, person);
    await expect(row).toContainText('Dr. Amelia Santos');
  } finally {
    await apiContext.dispose();
  }
});

test('an upcoming booking tells the patient what to do beforehand', async ({ page }) => {
  // [1.24.0] put preparation in the booking wizard and the confirmation email, then left it off
  // the one screen a patient opens the day before to check the time. A patient who booked three
  // weeks ago and wants to re-read the instruction had nowhere to look.
  //
  // This books its OWN appointment on a test that carries preparation, and then finds that exact
  // card. It used to assert on `[data-testid="appointment-card"]` .first() — whatever booking the
  // database happened to hold — so it passed or failed on ambient data: booking anything through
  // the UI, as a developer demoing the app does, put a card with no preparation at the front and
  // turned this red with nothing in the app having changed. Which made it a test of the seed data
  // rather than of the screen.
  const ctx = await request.newContext();
  const token = (await (await ctx.post(`${API}/auth/login`, {
    data: { email: 'client@enlogada.com', password: PASSWORD },
  })).json()).data.token;
  const auth = { Authorization: `Bearer ${token}` };

  // Read which test carries preparation rather than naming one: the catalogue is the clinic's to
  // edit, and a fixture name hard-coded here is a second source of truth for it.
  const prepped = (await (await ctx.get(`${API}/tests`)).json()).data.tests
    .find((t) => t.is_active && t.preparation);
  expect(prepped, 'the catalogue needs at least one active test with preparation').toBeTruthy();

  const patientId = selfPayProfile(
    (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth })).json()).data.patients
  ).id;

  // Far out, and past the weekend — the clinic is shut on Sunday and closes at noon on Saturday,
  // so a nearer date makes this fail on the day of the week rather than on the app.
  const day = new Date();
  day.setDate(day.getDate() + 120 + (Date.now() % 25));
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

  const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth })).json())
    .data.slots.filter((s) => s.available);
  test.skip(free.length === 0, 'Need a free slot to book into.');

  const created = await ctx.post(`${API}/appointments`, {
    headers: auth,
    data: { patientId, scheduledDate: date, scheduledTime: free[0].time, testIds: [prepped.id] },
  });
  expect(created.status()).toBe(201);
  const reference = (await created.json()).data.appointment.appointment_reference;
  await ctx.dispose();

  await signIn(page, 'client@enlogada.com');

  await page.getByRole('tab', { name: 'Appointments' }).click();
  await expect(page.locator('[data-testid="appointment-card"]').first()).toBeVisible({ timeout: 15000 });

  // Page to the booking just made rather than assuming it is on page one — open bookings sort
  // soonest-first, eight to a page, and this one is deliberately months out.
  const card = page.locator(`[data-testid="appointment-card"][data-reference="${reference}"]`);
  const nextPage = page.getByLabel('Next page');
  for (let i = 0; i < 12 && (await card.count()) === 0; i += 1) {
    if (!(await nextPage.isEnabled().catch(() => false))) break;
    await nextPage.click();
    await page.waitForTimeout(150);
  }
  await expect(card, 'the booking just created should be somewhere in the list').toBeVisible();

  await expect(card.getByText('Before this appointment')).toBeVisible({ timeout: 10000 });
  await expect(card.getByText(prepped.preparation.slice(0, 30), { exact: false })).toBeVisible();
});
