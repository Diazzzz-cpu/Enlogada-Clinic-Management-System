// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { runScript } from './helpers/backendScript.js';
import { selfPayProfile } from './helpers/patients.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { holdSlot, expireHold } from './helpers/slotHold.js';

/**
 * What an earlier day leaves open is closed, or shown, never left. [1.130.0]
 *
 * Steven, checking that every process makes sense, found walk-ins from days before still
 * "Pending": nobody paid, so they sat in no queue (today's queue is today's, and so is the till's)
 * with nothing able to pay for them or serve them. The end-of-day close closes those, saying why;
 * a PAID visit is never closed, and the Desk shows it instead. And a booking not paid within its
 * time to pay released its slot, so it is no longer checked in as if it held one.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('The end of the day', () => {
  let ctx;
  let reception, client;
  let labTest;
  const moved = [];

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
  const backdate = (visitId, days) => runScript('e2eBackdateVisit.js', [`--visit=${visitId}`, `--days=${days}`], 'backdate visit');
  const closeDay = () => runScript('closeEarlierDays.js', [], 'end-of-day close');
  const visit = async (id) => (await (await ctx.get(`${API}/visits/${id}`, { headers: auth(reception) })).json()).data.visit;

  const walkIn = async () => {
    const person = fixturePerson();
    const res = await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: {
        patient: {
          patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
          firstName: person.firstName, lastName: person.lastName,
          birthdate: '1977-07-17', sex: 'Female', contactNumber: FIXTURE_CONTACT,
        },
        visitType: 'Walk in', testIds: [labTest.id],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data.visit;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, client] = await Promise.all(['receptionist@enlogada.com', 'client@enlogada.com'].map(login));
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory');
  });

  test.afterAll(async () => {
    // Back to today, so the teardown's run-window purge finds them.
    for (const id of moved) backdate(id, -1);
    await ctx?.dispose();
  });

  test("an unpaid walk-in from an earlier day is closed, saying why; today's is left alone", async () => {
    const yesterdays = await walkIn();
    const todays = await walkIn();
    backdate(yesterdays.id, 1);
    moved.push(yesterdays.id);

    closeDay();

    const closed = await visit(yesterdays.id);
    expect(closed.status).toBe('Cancelled');
    expect(closed.closed_reason).toMatch(/^Not paid by the end of /);
    expect((await visit(todays.id)).status, 'still today: it may yet be paid').toBe('Pending');
  });

  test('a paid visit from an earlier day is never closed: the Desk shows it', async () => {
    const paid = await walkIn();
    await payAndReleaseWalkIn(ctx, API, paid.id);
    backdate(paid.id, 1);
    moved.push(paid.id);

    closeDay();

    expect((await visit(paid.id)).status).toBe('Processing');
    const carried = (await (await ctx.get(`${API}/visits/carried-over`, { headers: auth(reception) })).json()).data.visits;
    expect(carried.map((v) => v.id), 'on the Desk, from earlier days').toContain(paid.id);
  });

  test('a booking not paid in time is not checked in as if it held its slot', async () => {
    const patientId = selfPayProfile((await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients).id;
    const date = nthWorkingDay(6);
    const slots = ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(client) })).json()).data.slots || [])
      .filter((s) => s.available);
    test.skip(!slots.length, 'no free slot');
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(client),
      multipart: appointmentForm({ patientId, scheduledDate: date, scheduledTime: slots[0].time, testIds: [await bookableTestId(ctx)] }),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const appt = (await booked.json()).data.appointment;
    try {
      holdSlot(appt.id);
      expireHold(appt.id);
      const res = await ctx.patch(`${API}/appointments/${appt.id}/status`, {
        headers: auth(reception), data: { status: 'Confirmed' },
      });
      expect(res.status()).toBe(409);
      expect((await res.json()).message).toMatch(/not paid in time.*walk-in/i);
    } finally {
      await ctx.put(`${API}/appointments/${appt.id}/cancel`, { headers: auth(client) });
    }
  });
});
