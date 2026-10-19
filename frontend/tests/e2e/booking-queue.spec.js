// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { nthWorkingDay } from './helpers/dates.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { registerClient } from './helpers/accounts.js';

/**
 * A booking joins today's queue when the patient checks in, not when it is made. [1.92.0]
 *
 * A booking used to join the queue on the day it was MADE and carry that day's ticket. Next week's
 * bookings sat in today's queue and at the till as "waiting", and a booking made last week never
 * reached the queue on its own day, so a patient who had booked ahead and came in unpaid could not
 * be found at the till. The desk's check-in is now the moment: the visit is stamped with it and
 * given today's next ticket. Until then a booking is a reservation, with a reference and no ticket.
 *
 * Pinned here: a new booking has no ticket and is in no queue (the staff list or the public
 * count); the check-in reply carries today's ticket; the visit is then in the queue with that
 * ticket, starting now; and checking it in a second time does not move it to the back of the line
 * with another number.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';

test.describe('a booking joins the queue at check-in', () => {
  /** @type {import('playwright/test').APIRequestContext} */
  let ctx;
  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  const login = async (email) =>
    (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  test('a booking has no ticket and no place in line until the desk checks the patient in', async () => {
    const staff = await login('receptionist@enlogada.com');
    const person = fixturePerson();
    // The patient's own booking [1.132.0]: one made at the desk is paid as it is made, and so goes
    // straight to the departments at check-in. A patient's, unpaid, waits in the queue to pay.
    const { token: patientToken } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });

    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(staff) })).json()).data.patientTypes;
    const selfPay = types.find((t) => t.name === 'Self Pay') || types[0];
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(patientToken),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1987-05-21', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;

    // A far weekday, different on every run. A brand-new patient cannot collide with anyone else's
    // booking of the same slot.
    const date = nthWorkingDay(90 + (Date.now() % 60));
    const slot = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(staff) })).json())
      .data.slots.find((s) => s.available);
    expect(slot, `a free slot on ${date}`).toBeTruthy();

    // Searched by surname, so the check reads this patient's rows and not a page of the day's queue.
    const queueRows = async () => (await (await ctx.get(
      `${API}/visits/active?limit=50&search=${encodeURIComponent(person.lastName)}`, { headers: auth(staff) }
    )).json()).data.visits;
    const waiting = async () => (await (await ctx.get(`${API}/visits/queue-status`)).json()).data.queue.waiting;

    const waitingBefore = await waiting();
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(patientToken),
      multipart: appointmentForm({ patientId: patient.id, scheduledDate: date, scheduledTime: slot.time, testIds: [await bookableTestId(ctx)] }),
    });
    expect(booked.status(), 'the booking should be created').toBe(201);
    const { appointment } = (await booked.json()).data;

    expect(appointment.queue_number, 'a booking holds no ticket until check-in').toBeNull();
    expect((await queueRows()).some((v) => v.id === appointment.patient_visit_id), 'nor a place in the queue').toBe(false);
    expect(await waiting(), 'nor does it count as somebody waiting').toBe(waitingBefore);

    const checkIn = () => ctx.patch(`${API}/appointments/${appointment.id}/status`, {
      headers: auth(staff), data: { status: 'Confirmed' },
    });
    const first = await checkIn();
    expect(first.status()).toBe(200);
    const ticket = (await first.json()).data.appointment.queue_number;
    expect(ticket, "the check-in hands back today's ticket").toMatch(/^\d{4}$/);

    const row = (await queueRows()).find((v) => v.id === appointment.patient_visit_id);
    expect(row, 'checked in, the patient is in the queue').toBeTruthy();
    expect(row.queue_number).toBe(ticket);
    expect(row.status).toBe('Pending');
    // Stamped with the moment they arrived, so the wait on the Desk starts now, not on the day
    // they booked.
    expect(Math.abs(Date.parse(row.created_at) - Date.now()), 'the visit starts at check-in')
      .toBeLessThan(5 * 60 * 1000);
    expect(await waiting(), 'and counts as one more person waiting').toBe(waitingBefore + 1);

    // A second check-in (a double click, or a second receptionist) keeps the place and the number.
    const again = await checkIn();
    expect(again.status()).toBe(200);
    expect((await again.json()).data.appointment.queue_number, 'the same ticket, not a new one').toBe(ticket);
    expect((await queueRows()).find((v) => v.id === appointment.patient_visit_id)?.queue_number).toBe(ticket);
  });
});
