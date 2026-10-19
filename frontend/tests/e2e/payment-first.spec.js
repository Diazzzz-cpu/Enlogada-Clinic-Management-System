// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm, bookableTestId, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { expireHold } from './helpers/slotHold.js';
import { runScript } from './helpers/backendScript.js';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';

/**
 * Payment first, for every booking. [1.132.0]
 *
 * Steven: a booking is the patient's once it is paid, so no slot is held for someone who has not
 * paid. Two kinds of booking used to take their slot for good, unpaid:
 *   - one made at the desk. It is now paid as it is made, in the same request, by someone who can
 *     take the payment; without the payment it is refused;
 *   - an HMO booking. The HMO's approval is its payment: it holds its slot until its own start
 *     while the claim waits. Approved, it is kept; refused, the patient has the payment window to
 *     pay it themselves; still undecided at its start, it is released, and the log says why.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';

test.describe('Payment first, for every booking', () => {
  /** @type {import('playwright/test').APIRequestContext} */
  let ctx;
  let reception, desk, clinicAdmin, cashier, lab, superAdmin;
  let labTest;
  let client;          // a patient with an account, booking for themselves
  let providerId;
  let day = 0;
  const booked = [];   // unpaid bookings to free afterwards

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  /** A free slot on a day of this spec's own, far from the other booking specs' days. */
  const nextSlot = async () => {
    const date = nthWorkingDay(160 + day++);
    const slot = ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(reception) })).json())
      .data.slots || []).find((s) => s.available);
    expect(slot, `a free slot on ${date}`).toBeTruthy();
    return { date, time: slot.time };
  };

  const deskPatient = async () => {
    const person = fixturePerson();
    return (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1984-04-14', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
  };

  const hmoBooking = async () => {
    const { date, time } = await nextSlot();
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(client.token),
      multipart: appointmentForm(
        { patientId: client.patient.id, scheduledDate: date, scheduledTime: time, testIds: [labTest.id], hmo: { providerId } },
        { hmoCard: true }
      ),
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()).data;
    booked.push(body.appointment.id);
    return { appt: body.appointment, claim: body.hmoRequest, date, time };
  };

  const myBooking = async (id) =>
    ((await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(client.token) })).json()).data.bookings || [])
      .find((b) => b.id === id);

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, desk, clinicAdmin, cashier, lab, superAdmin] = await Promise.all([
      'receptionist@enlogada.com', 'multirole@enlogada.com', 'clinicadmin@enlogada.com', 'cashier@enlogada.com',
      'lab@enlogada.com', 'admin@enlogada.com',
    ].map(login));
    const id = await bookableTestId(ctx);
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.id === id);

    const person = fixturePerson();
    const email = fixtureEmail(person);   // once: each call makes a new address
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1991-09-19', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    client = { token, patient, email };
    providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(token) })).json()).data.providers[0].id;
  });

  test.afterAll(async () => {
    for (const id of booked) {
      try { removeUnpaid(id); } catch { /* paid, or already removed */ }
    }
    await ctx?.dispose();
  });

  test('a booking made at the desk is paid as it is made, by someone who can take the payment', async () => {
    const patient = await deskPatient();
    const { date, time } = await nextSlot();
    const body = { patientId: patient.id, scheduledDate: date, scheduledTime: time, testIds: [labTest.id] };
    const price = Number(labTest.price);
    const book = (token, extra = {}) => ctx.post(`${API}/appointments`, { headers: auth(token), data: { ...body, ...extra } });

    // Front desk and Admin open visits but do not take money; a department does neither.
    for (const token of [reception, clinicAdmin]) {
      const noTill = await book(token, { payment: { paymentMethod: 'Cash', amount: price } });
      expect(noTill.status(), 'only someone who can take the money books at the desk').toBe(403);
      expect((await noTill.json()).message).toMatch(/take the payment/i);
    }
    const noVisit = await book(lab, { payment: { paymentMethod: 'Cash', amount: price } });
    expect(noVisit.status(), 'nor a role that cannot open a visit').toBe(403);
    expect((await noVisit.json()).message).toMatch(/opens a visit/i);

    const unpaid = await book(desk);
    expect(unpaid.status(), 'no payment, no booking').toBe(400);
    expect((await unpaid.json()).message).toMatch(/paid there and then/i);

    const wrong = await book(desk, { payment: { paymentMethod: 'Cash', amount: price + 50 } });
    expect(wrong.status(), 'the till checks the amount, as it always has').toBe(400);

    const paid = await book(desk, { payment: { paymentMethod: 'Cash', amount: price } });
    expect(paid.status(), 'and the refused attempt left nothing behind: a fresh booking, not "already booked"').toBe(201);
    const { appointment, payment } = (await paid.json()).data;
    expect(payment?.receipt_number, 'a receipt, from the till\'s own path').toMatch(/^RCT-/);
    expect(appointment.held_until, 'paid, so it takes its slot outright').toBeNull();

    const again = await ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: appointment.patient_visit_id, paymentMethod: 'Cash', amount: price },
    });
    expect(again.status(), 'it is paid: the till refuses a second payment').toBe(409);
  });

  test("a patient's booking is paid from the portal, not with the booking", async () => {
    const { date, time } = await nextSlot();
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(client.token),
      multipart: appointmentForm({
        patientId: client.patient.id, scheduledDate: date, scheduledTime: time, testIds: [labTest.id],
        payment: { paymentMethod: 'Cash', amount: Number(labTest.price) },
      }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/paid from your portal/i);
  });

  test('an HMO booking holds its slot until its start while the claim waits, and approval keeps it', async () => {
    const { appt, claim, date, time } = await hmoBooking();
    const held = new Date(appt.held_until);
    expect(held.getHours() * 60 + held.getMinutes(), 'held until its own start').toBe(
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
    );
    expect(`${held.getFullYear()}-${String(held.getMonth() + 1).padStart(2, '0')}-${String(held.getDate()).padStart(2, '0')}`).toBe(date);

    const mine = await myBooking(appt.id);
    expect(mine.hmo_status).toBe('Pending');

    const list = (await (await ctx.get(`${API}/hmo/requests?status=Pending`, { headers: auth(superAdmin) })).json()).data;
    const row = (Array.isArray(list) ? list : list.requests).find((r) => r.id === claim.id);
    expect(new Date(row.decide_by).getTime(), 'the Admin sees the deadline').toBe(held.getTime());

    const approved = await ctx.put(`${API}/hmo/request/${claim.id}/approve`, {
      headers: auth(superAdmin), data: { approvalCode: 'LOA-PF-0001' },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    const kept = await myBooking(appt.id);
    expect(kept.held_until, 'approved: kept, as a paid booking is').toBeNull();
    expect(kept.hmo_status).toBe('Approved');
    expect(Number(kept.amount_due), 'and the HMO covers it').toBe(0);
  });

  test('a refused HMO booking gets the time to pay it, like any other', async () => {
    const { appt, claim } = await hmoBooking();
    const refused = await ctx.put(`${API}/hmo/request/${claim.id}/reject`, {
      headers: auth(superAdmin), data: { decisionReason: 'Member not covered for this test' },
    });
    expect(refused.status(), await refused.text()).toBe(200);

    const mine = await myBooking(appt.id);
    expect(mine.hmo_status).toBe('Rejected');
    const until = new Date(mine.held_until).getTime();
    expect(until, 'a fresh time to pay, from the refusal').toBeGreaterThan(Date.now() + 10 * 60 * 1000);
    expect(until, 'not the start of a booking months away').toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
    expect(Number(mine.amount_due), 'the whole of it is the patient\'s').toBe(Number(labTest.price));
  });

  test('an HMO booking still undecided at its start is released, and the log says why', async () => {
    const { appt, claim } = await hmoBooking();
    expireHold(appt.id);
    runScript('removeExpiredUnpaid.js', [], 'remove expired unpaid');

    expect(await myBooking(appt.id), 'released').toBeUndefined();
    expect((await ctx.get(`${API}/hmo/request/${claim.id}`, { headers: auth(superAdmin) })).status(), 'with its claim').toBe(404);
    const log = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(superAdmin), params: { limit: 50 } })).json()).data.entries;
    const entry = log.find((e) => e.action === 'visit.removed_unpaid' && String(e.entity_id) === String(appt.patient_visit_id));
    expect(entry?.description).toMatch(/HMO had not approved it/);
  });

  test('the portal says a booking is waiting for the HMO, not that it must be paid', async ({ page }) => {
    const { appt } = await hmoBooking();
    await signIn(page, client.email, PASSWORD);
    await openPortalTab(page, 'appointments');
    const card = page.locator(`[data-testid="appointment-card"][data-reference="${appt.appointment_reference}"]`);
    // Open bookings sort soonest first, eight to a page; this one is months out, so page to it.
    for (let i = 0; i < 6 && !(await card.isVisible()); i++) {
      const next = page.getByRole('button', { name: /next/i });
      if (!(await next.isVisible()) || !(await next.isEnabled())) break;
      await next.click();
    }
    await expect(card.getByTestId('booking-hmo-waiting')).toContainText(/Waiting for your HMO/);
    await expect(card.getByText(/Pay by/)).toHaveCount(0);
  });
});
