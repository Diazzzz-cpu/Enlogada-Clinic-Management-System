// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { submitProof, ensureMethod } from './helpers/payments.js';
import { expireHold } from './helpers/slotHold.js';
import { docxReport, MIME } from './helpers/officeFiles.js';

/**
 * Processes that did not make sense once a paid receipt became final. [1.123.0]
 *
 * Each test is one finding from the whole-system review, held so it cannot come back:
 *   1  an HMO claim approved after the patient paid in full (the insurer billed for it too)
 *   2  a patient paying online AND at the counter, with one of the two recorded nowhere
 *   3  closing a date with bookings on it, and nobody told
 *   4  a paid booking written off as a no-show
 *   5  "open a new visit" for extra tests, which the Desk would not let anyone do
 *   6  a walk-in who signs up later, never connected to their own record
 *   7  a Word or Excel report released with no word that the patient cannot open it
 *   8  archiving a patient who is in the building or booked
 *   9  an unpaid online booking holding its slot for good, against "payment first"
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Processes that make sense', () => {
  let ctx;
  let reception, cashier, admin, superAdmin;
  let labTest;
  const claimed = new Set();

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A walk-in with one laboratory test. */
  const walkIn = async (extra = {}) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...person, birthdate: '1981-03-03', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId: patient.id, visitType: 'Walk in', notes: 'process fixes spec', ...extra },
    })).json()).data.visit;
    const attached = (await (await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception), data: { patientVisitId: visit.id, testIds: [labTest.id] },
    })).json()).data.visitTests;
    return { person, patient, visit, visitTestIds: attached.map((v) => v.id) };
  };

  /** A new patient account with one self-pay booking far ahead, unpaid. */
  const freshBooking = async (daysAhead) => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        ...person, birthdate: '1992-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const date = nthWorkingDay(daysAhead);
    const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(token) })).json())
      .data.slots.filter((s) => s.available && !claimed.has(`${date} ${s.time}`));
    expect(free.length, `a free slot on ${date}`).toBeGreaterThan(0);
    claimed.add(`${date} ${free[0].time}`);
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: patient.id, scheduledDate: date, scheduledTime: free[0].time, testIds: [labTest.id] }),
    });
    expect(res.status(), await res.text()).toBe(201);
    return { token, email, person, patient, date, appointment: (await res.json()).data.appointment };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier, admin, superAdmin] = await Promise.all(
      ['receptionist@enlogada.com', 'cashier@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com'].map(login)
    );
    labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    // Online payment is by the clinic's own account, so the payment window applies to bookings.
    await ensureMethod(ctx, superAdmin);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('1. a test still waiting on the HMO is charged only by withdrawing its claim', async () => {
    const { visit, visitTestIds } = await walkIn({ referringPhysician: 'Dr. Ana Villanueva', referringPhysicianPrc: '0123456' });
    const providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(reception) })).json()).data.providers[0].id;
    const claimRes = await ctx.post(`${API}/hmo/request`, {
      headers: auth(reception),
      data: { hmoProviderId: providerId, memberNumber: `MBR-${Date.now()}`, visitTestIds },
    });
    expect(claimRes.status(), await claimRes.text()).toBe(201);
    const claimBody = await claimRes.json();
    const claimId = claimBody.data.request?.id || claimBody.data.hmoRequest?.id;

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json()).data.bill;
    const pay = (data) => ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount), ...data },
    });
    const refused = await pay({});
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain("waiting for the HMO's decision");

    expect((await pay({ withdrawPendingClaims: true })).status()).toBe(201);
    const approve = await ctx.put(`${API}/hmo/request/${claimId}/approve`, {
      headers: auth(admin), data: { approvalCode: 'LOA-LATE' },
    });
    expect(approve.status(), 'the withdrawn claim can no longer be approved').toBe(409);
  });

  test('2. a proof waiting to be checked stops a second payment at the counter', async () => {
    const { appointment, token } = await freshBooking(181);
    const method = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods[0];
    const sent = await submitProof(ctx, token, appointment.patient_visit_id, { amount: 100, reference: `REF${Date.now()}`, methodId: method.id });
    expect(sent.status(), await sent.text()).toBe(201);

    const bill = (await (await ctx.get(`${API}/payments/bill/${appointment.patient_visit_id}`, { headers: auth(cashier) })).json()).data.bill;
    expect(bill.pendingProof, 'the till is told').toBeTruthy();
    const counter = await ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: appointment.patient_visit_id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
    });
    expect(counter.status()).toBe(409);
    expect((await counter.json()).message).toContain('already sent an online payment');
  });

  test('3. closing a date names its bookings, so each can be moved', async ({ page }) => {
    const { date, appointment, person } = await freshBooking(182);
    const closed = await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(superAdmin), data: { date, isOpen: false, note: 'E2E closure' },
    });
    try {
      expect(closed.status(), await closed.text()).toBe(200);
      expect((await closed.json()).data.affectedBookings).toBeGreaterThan(0);
      const list = (await (await ctx.get(`${API}/schedule/overrides/${date}/bookings`, { headers: auth(superAdmin) })).json()).data.bookings;
      expect(list.map((b) => b.id), 'the booking is named').toContain(appointment.id);

      // Clinic Schedule opens the same list, each booking with Move.
      await signInTo(page, 'admin@enlogada.com', 'Clinic Schedule');
      await page.getByRole('button', { name: `Bookings to move on ${date}` }).click({ timeout: 20000 });
      const row = page.getByTestId('affected-booking').filter({ hasText: person.fullName });
      await expect(row).toContainText(appointment.appointment_reference);
      await expect(row.getByRole('button', { name: 'Move' })).toBeVisible();
    } finally {
      await ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(superAdmin) });
    }
  });

  test('4. a paid booking is moved, not written off as a no-show', async () => {
    const { appointment } = await freshBooking(183);
    await payAndReleaseWalkIn(ctx, API, appointment.patient_visit_id, cashier);
    const res = await ctx.patch(`${API}/appointments/${appointment.id}/status`, {
      headers: auth(reception), data: { status: 'No Show' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('Move it to another day');
  });

  test('5. a patient with a paid visit can be given another visit at the Desk', async ({ page }) => {
    const { person, visit } = await walkIn();
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(person.fullName);
    const match = page.getByTestId('desk-match').filter({ hasText: person.fullName });
    await expect(match).toContainText('Already has a paid visit today', { timeout: 20000 });
    await expect(match.getByRole('button', { name: 'Start another visit' })).toBeVisible();
  });

  test('5b. someone waiting unpaid is not offered a second visit, found by their full name', async ({ page }) => {
    const { person } = await walkIn();

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    // The queue matched a first OR a last name, so a full name found nobody waiting and the
    // box offered "Start visit" to a patient already in the queue.
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(person.fullName);
    await expect(page.getByText("One match is already in today's queue")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('desk-match').filter({ hasText: person.fullName })).toHaveCount(0);
  });

  test('6. a walk-in record is linked to the account its patient signed up with', async () => {
    const { patient } = await walkIn();
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });

    const staffAccount = await ctx.put(`${API}/patients/${patient.id}/link-account`, {
      headers: auth(reception), data: { email: 'cashier@enlogada.com' },
    });
    expect(staffAccount.status(), 'never a staff account').toBe(404);

    const linked = await ctx.put(`${API}/patients/${patient.id}/link-account`, { headers: auth(reception), data: { email } });
    expect(linked.status(), await linked.text()).toBe(200);
    const mine = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(token) })).json()).data.patients;
    expect(mine.map((p) => p.id), 'the record is now in their portal').toContain(patient.id);

    const again = await ctx.put(`${API}/patients/${patient.id}/link-account`, { headers: auth(reception), data: { email } });
    expect(again.status(), 'a record is linked once').toBe(409);
  });

  test('7. attaching a Word report says the patient cannot open it online', async ({ page }) => {
    const { person, visit } = await walkIn();
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);

    await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
    await page.getByPlaceholder('Search patient, test, queue...').fill(person.lastName);
    const row = page.locator('tbody tr', { hasText: person.fullName }).first();
    await row.getByRole('button', { name: 'Attach Report' }).click({ timeout: 20000 });
    await page.locator('input[type="file"]').setInputFiles({ name: 'report.docx', mimeType: MIME.docx, buffer: docxReport() });
    await expect(page.getByTestId('office-report-warning')).toContainText("can't open a Word or Excel report");
  });

  test('8. a patient with a visit in progress cannot be archived', async () => {
    const { patient, visit } = await walkIn();
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    const res = await ctx.patch(`${API}/patients/${patient.id}/archive`, { headers: auth(admin), data: { archived: true } });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain("can't be archived yet");
  });

  test('9. payment first: an unpaid booking holds its slot only for the time to pay', async () => {
    const { appointment, token } = await freshBooking(184);
    expect(appointment.held_until, 'held, not taken').toBeTruthy();

    // The window runs out: the slot is released, and a late proof is refused.
    expireHold(appointment.id);
    const method = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods[0];
    const late = await submitProof(ctx, token, appointment.patient_visit_id, { amount: 100, reference: `LATE${Date.now()}`, methodId: method.id });
    expect(late.status()).toBe(409);
    expect((await late.json()).message).toContain("wasn't paid in time");
  });
});
