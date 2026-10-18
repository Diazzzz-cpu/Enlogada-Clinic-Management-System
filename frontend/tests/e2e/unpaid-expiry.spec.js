// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId, selfPayProfile } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { runScript } from './helpers/backendScript.js';
import { appointmentForm, bookableTestId, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { holdSlot, expireHold } from './helpers/slotHold.js';

/**
 * Unpaid is temporary. [1.131.0]
 *
 * Steven: a booking is paid first, a walk-in pays for its tests to go ahead, and once paid there
 * are no takebacks. So nothing is "Cancelled": an unpaid walk-in or booking whose time is up is
 * REMOVED, with a line in the Activity Log. Its time is up at the end of its day, or, for a
 * patient's own booking, when its time to pay runs out. A PAID visit is never removed; the Desk
 * shows it instead. And a booking not paid in time is not checked in as if it held its slot; the
 * patient moving it gets a fresh time to pay.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Unpaid is temporary', () => {
  let ctx;
  let reception, client, superAdmin;
  let labTest;
  const moved = [];

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
  const backdate = (visitId, days) => runScript('e2eBackdateVisit.js', [`--visit=${visitId}`, `--days=${days}`], 'backdate visit');
  const sweep = () => runScript('removeExpiredUnpaid.js', [], 'remove expired unpaid');
  const visitStatus = async (id) => (await ctx.get(`${API}/visits/${id}`, { headers: auth(reception) })).status();
  const visit = async (id) => (await (await ctx.get(`${API}/visits/${id}`, { headers: auth(reception) })).json()).data.visit;
  const myBookings = async () => {
    const data = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(client) })).json()).data;
    return data.appointments || data.bookings || [];
  };

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

  const booking = async (day) => {
    const patientId = selfPayProfile((await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients).id;
    const date = nthWorkingDay(day);
    const slots = ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(client) })).json()).data.slots || [])
      .filter((s) => s.available);
    test.skip(slots.length < 2, 'no free slots');
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(client),
      multipart: appointmentForm({ patientId, scheduledDate: date, scheduledTime: slots[0].time, testIds: [await bookableTestId(ctx)] }),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    return { appt: (await booked.json()).data.appointment, date, slots };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, client, superAdmin] = await Promise.all(['receptionist@enlogada.com', 'client@enlogada.com', 'admin@enlogada.com'].map(login));
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory');
  });

  test.afterAll(async () => {
    // Back to today, so the teardown's run-window purge finds what is left of them.
    for (const id of moved) {
      try { backdate(id, -1); } catch { /* removed, as it should be */ }
    }
    await ctx?.dispose();
  });

  test("an unpaid walk-in whose day has ended is removed, and logged; today's is left alone", async () => {
    const yesterdays = await walkIn();
    const todays = await walkIn();
    backdate(yesterdays.id, 1);
    moved.push(yesterdays.id);

    sweep();

    expect(await visitStatus(yesterdays.id), 'removed').toBe(404);
    expect((await visit(todays.id)).status, 'still today: it may yet be paid').toBe('Pending');

    const log = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(superAdmin), params: { limit: 50 } })).json()).data.entries;
    const entry = log.find((e) => e.action === 'visit.removed_unpaid' && String(e.entity_id) === String(yesterdays.id));
    expect(entry, 'the one record left is the Activity Log line').toBeTruthy();
    expect(entry.description).toMatch(/not paid by the end of/);
  });

  test('a paid visit from an earlier day is never removed: the Desk shows it', async () => {
    const paid = await walkIn();
    await payAndReleaseWalkIn(ctx, API, paid.id);
    backdate(paid.id, 1);
    moved.push(paid.id);

    sweep();

    expect((await visit(paid.id)).status).toBe('Processing');
    const carried = (await (await ctx.get(`${API}/visits/carried-over`, { headers: auth(reception) })).json()).data.visits;
    expect(carried.map((v) => v.id), 'on the Desk, from earlier days').toContain(paid.id);
  });

  test("a booking whose time to pay ran out is removed; it is not checked in, and moving it first renews it", async () => {
    // Moved before the sweep: a fresh time to pay, so it stays.
    const { appt: kept, date, slots } = await booking(6);
    holdSlot(kept.id);
    expireHold(kept.id);
    const refused = await ctx.patch(`${API}/appointments/${kept.id}/status`, { headers: auth(reception), data: { status: 'Confirmed' } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toMatch(/not paid in time.*walk-in/i);
    const movedRes = await ctx.put(`${API}/appointments/${kept.id}/reschedule`, {
      headers: auth(client), data: { scheduledDate: date, scheduledTime: slots[1].time, reason: 'Could not pay in time' },
    });
    expect(movedRes.status(), await movedRes.text()).toBe(200);
    expect(new Date((await movedRes.json()).data.appointment.held_until).getTime(), 'a fresh time to pay').toBeGreaterThan(Date.now());

    // Left alone: removed by the sweep, as unpaid and out of time.
    const { appt: lapsed } = await booking(7);
    holdSlot(lapsed.id);
    expireHold(lapsed.id);
    try {
      sweep();
      const ids = (await myBookings()).map((b) => b.id);
      expect(ids, 'the lapsed booking is gone').not.toContain(lapsed.id);
      expect(ids, 'the renewed one stays').toContain(kept.id);
    } finally {
      removeUnpaid(kept.id);
      removeUnpaid(lapsed.id);
    }
  });
});
