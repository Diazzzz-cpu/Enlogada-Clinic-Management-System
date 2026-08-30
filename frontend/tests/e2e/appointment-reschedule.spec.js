// @ts-check
import { test, expect, request } from 'playwright/test';
import { loginAs } from './helpers/ticketRelease.js';
import { selfPayProfile } from './helpers/patients.js';
import { nthWorkingDay, dateStr } from './helpers/dates.js';

// Moving a booking instead of cancelling and rebooking it.
//
// Cancel-and-rebook was the only route to a different time, and it is not equivalent: between the
// two calls the patient holds nothing, and at the seeded one-patient-per-slot somebody else can
// take the replacement in the gap. The patient ends up with no appointment having started with
// one. PUT /appointments/:id/reschedule keeps the original until the new slot is secured.
//
// The reference is the other half of it. A patient holding a booking pass has that code on their
// phone, so a reschedule that reissued it would silently invalidate the thing they present at the
// desk.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

const CLIENT = { email: 'client@enlogada.com', password: PASSWORD };
const RECEPTION = { email: 'receptionist@enlogada.com', password: PASSWORD };
const LAB = { email: 'lab@enlogada.com', password: PASSWORD };

/**
 * Two days far enough out that no other spec and no seeded demo booking competes for them.
 *
 * Counted as WORKING days rather than "today + N, pushed off a weekend" — see helpers/dates.js.
 * That offset-then-skip shape has now failed this spec twice for two different reasons, most
 * recently by collapsing DAY_A and DAY_B onto the same Monday whenever today+150 landed on a
 * Sunday. Two constants meant to be different days silently became one, so "move this booking to
 * another day" became "move it to the slot it already holds" and four tests failed on a correct
 * 409. Counting makes the distinctness structural: nthWorkingDay(n) and nthWorkingDay(n + 1) are
 * different days on every calendar.
 */

test.describe('Appointment reschedule (API)', () => {
  let ctx;
  let clientToken;
  let recToken;
  let labToken;
  let patientId;

  const DAY_A = nthWorkingDay(150);
  const DAY_B = nthWorkingDay(151);

  // Distinct slots per test, for the reason spelled out in booking-atomicity.spec.js: a dev
  // database with the cap lifted reports every slot as available however many bookings it holds,
  // so "the first free slot" is the same slot every time and the tests silently share a booking.
  const claimed = new Set();

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const slots = async (date, token = clientToken) => {
    const res = await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(token) });
    return (await res.json()).data.slots.filter((s) => s.available);
  };

  const claimSlot = async (date) => {
    const free = await slots(date);
    const slot = free.find((s) => !claimed.has(`${date} ${s.time}`));
    expect(slot, `no unclaimed slot left on ${date}`).toBeTruthy();
    claimed.add(`${date} ${slot.time}`);
    return slot.time;
  };

  const book = async (date, time) => {
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(clientToken),
      data: { patientId, scheduledDate: date, scheduledTime: time },
    });
    expect(res.status(), 'booking setup').toBe(201);
    return (await res.json()).data.appointment;
  };

  const move = (id, date, time, token = clientToken) =>
    ctx.put(`${API}/appointments/${id}/reschedule`, {
      headers: auth(token),
      data: { scheduledDate: date, scheduledTime: time },
    });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    clientToken = await loginAs(ctx, API, CLIENT);
    recToken = await loginAs(ctx, API, RECEPTION);
    labToken = await loginAs(ctx, API, LAB);
    const profiles = await ctx.get(`${API}/patients/my-profiles`, { headers: auth(clientToken) });
    patientId = selfPayProfile((await profiles.json()).data.patients).id;
  });

  test.afterAll(async () => ctx.dispose());

  test('a patient moves their own booking, and the reference survives', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);
    const to = await claimSlot(DAY_B);

    const res = await move(appt.id, DAY_B, to);
    expect(res.status()).toBe(200);

    const moved = (await res.json()).data.appointment;
    // The whole point: same booking, different time. A reissued reference would invalidate the
    // pass already on the patient's phone.
    expect(moved.appointment_reference).toBe(appt.appointment_reference);
    expect(moved.scheduled_time.slice(0, 5)).toBe(to);
  });

  test('the old slot is released and the new one taken, in one move', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);
    const to = await claimSlot(DAY_B);

    expect(await move(appt.id, DAY_B, to)).toBeTruthy();

    const onA = (await slots(DAY_A)).map((s) => s.time);
    const onB = (await slots(DAY_B)).map((s) => s.time);
    expect(onA, 'vacated slot is offered again').toContain(from);
    expect(onB, 'new slot is no longer offered').not.toContain(to);
  });

  test('a booking is not blocked from moving by its own row', async () => {
    // The capacity check has to exclude the appointment being moved. Without that exclusion, a
    // patient changing only the date — keeping the same time of day — is refused at capacity 1,
    // and the thing standing in their way is their own booking.
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);

    const res = await move(appt.id, DAY_A, from);
    expect(res.status()).toBe(200);
  });

  test('a slot the patient already holds is refused rather than merged', async () => {
    const first = await claimSlot(DAY_A);
    const second = await claimSlot(DAY_A);
    const a = await book(DAY_A, first);
    await book(DAY_A, second);

    const res = await move(a.id, DAY_A, second);
    expect(res.status()).toBe(409);
    // Merging would silently drop whatever is attached to one of the two bookings.
    expect((await res.json()).message).toMatch(/already has a booking/i);
  });

  test('a closed day and an out-of-hours time are both refused', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);

    const outOfHours = await move(appt.id, DAY_B, '21:00');
    expect(outOfHours.status()).toBe(409);

    // The next Sunday: closed in the seeded schedule.
    const sunday = new Date();
    sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7 || 7));
    const closed = await move(appt.id, dateStr(sunday), '09:00');
    expect(closed.status()).toBe(409);
  });

  test('a malformed date is refused before any transaction opens', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);

    expect((await move(appt.id, 'next tuesday', '09:00')).status()).toBe(400);
    expect((await move(appt.id, DAY_B, '9am')).status()).toBe(400);

    const missing = await ctx.put(`${API}/appointments/${appt.id}/reschedule`, {
      headers: auth(clientToken),
      data: {},
    });
    expect(missing.status()).toBe(400);
  });

  test('only roles holding appointments:reschedule may move a booking', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);
    const to = await claimSlot(DAY_B);

    // Diagnostic staff hold no appointments permissions at all.
    expect((await move(appt.id, DAY_B, to, labToken)).status()).toBe(403);
    // Reception does, and reschedules on a patient's behalf over the phone.
    expect((await move(appt.id, DAY_B, to, recToken)).status()).toBe(200);
  });

  test('a checked-in appointment can no longer be moved', async () => {
    const from = await claimSlot(DAY_A);
    const appt = await book(DAY_A, from);
    const to = await claimSlot(DAY_B);

    const checkIn = await ctx.patch(`${API}/appointments/${appt.id}/status`, {
      headers: auth(recToken),
      data: { status: 'Confirmed' },
    });
    expect(checkIn.status()).toBe(200);

    const res = await move(appt.id, DAY_B, to);
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/checked in/i);
  });
});
