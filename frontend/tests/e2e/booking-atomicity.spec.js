// @ts-check
import { test, expect, request } from 'playwright/test';
import { loginAs } from './helpers/ticketRelease.js';
import { selfPayProfile } from './helpers/patients.js';
import { daysAgoStr } from '../../src/lib/date.js';
import { holdSlot, expireHold, releaseLeftoverBookings } from './helpers/slotHold.js';
import { dateStr, nthWorkingDay } from './helpers/dates.js';
import { appointmentForm } from './helpers/booking.js';

// Booking atomicity and duplicate handling.
//
// Online booking used to be three sequential HTTP calls — create the appointment, attach the
// tests, file the HMO claim — each committing on its own. A failure in the second or third left
// an appointment that existed while the patient was told the booking had failed. Because a
// non-cancelled appointment occupies its slot, and max_concurrent_bookings is seeded to 1, that
// phantom then refused the patient's own retry as "no longer available", steering them into
// booking a second, different slot. Two slots, one patient.
//
// POST /appointments now does all of it in one transaction, and recognises a repeat of a booking
// the same patient already holds instead of reporting a slot conflict. These tests lock in both
// halves; without them the failure is invisible until a receptionist notices a queue entry with
// nothing attached to it.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };
const RECEPTION = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const LAB = { email: 'lab@enlogada.com', password: 'Password123!' };

// A date of its own for each test. [1.124.0] A patient may hold one booking a day, and every test
// here books the same seeded patient, so a shared date let only the first test book at all. A
// fixed calendar date also stopped working the day it passed. Working days 215-230 are this
// spec's alone (nthWorkingDay, so each is a different open day on every calendar).
let BOOKING_DATE;
let dayIndex = 0;

test.describe('Booking atomicity (API)', () => {
  let apiContext;
  let clientToken;
  let patientId;
  let testIds;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    clientToken = await loginAs(apiContext, API, CLIENT);

    const profilesRes = await apiContext.get(`${API}/patients/my-profiles`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    patientId = selfPayProfile((await profilesRes.json()).data.patients).id;

    const testsRes = await apiContext.get(`${API}/tests`);
    testIds = (await testsRes.json()).data.tests.slice(0, 2).map((t) => t.id);

  });

  // A run stopped before its teardown leaves its bookings on the date, and a slot that patient
  // already holds fails the next run for reasons that have nothing to do with booking. Released
  // first, so every test starts from a clean date. Measured on 2026-09-12: eleven leftovers from
  // two interrupted runs. [1.72.0]
  test.beforeEach(() => {
    BOOKING_DATE = nthWorkingDay(215 + dayIndex++);
    releaseLeftoverBookings(BOOKING_DATE);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  async function freeSlot(date) {
    const res = await apiContext.get(`${API}/appointments/availability?date=${date}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    return (await res.json()).data.slots.filter((s) => s.available);
  }

  // Slots this file has already used. Taking `slots[0]` each time is not enough on its own: a dev
  // database whose slot cap has been lifted (cleanE2eData.js --unlimited-slots, which exists
  // precisely because 18 slots a day cannot absorb repeated suite runs) still reports a booked
  // slot as available, so every test would book the same one — and the duplicate guard would then
  // correctly answer 200/alreadyBooked, failing the tests that expect a fresh 201. Tracking the
  // slots here makes the spec assert the behaviour it is about rather than the value of a
  // dev-only configuration knob.
  //
  // `claimed` only knows about THIS run, so the slots this patient already holds on BOOKING_DATE
  // are skipped as well. The E2E purge removes everything a run books inside its own window, but a
  // run whose purge was skipped (E2E_SKIP_PURGE) or never reached leaves its bookings behind, and
  // on a fixed date they stay. With the cap lifted a held slot still reads as free, so the "fresh"
  // booking landed on one the patient already held and got the correct 200 instead of 201 — a
  // failure that had been cleared once already by deleting rows by hand. Skipping them makes the
  // spec independent of whatever an earlier run left, rather than dependent on that cleanup.
  const claimed = new Set();

  async function heldTimes() {
    const res = await apiContext.get(`${API}/appointments/my-bookings`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    return new Set(
      (await res.json()).data.bookings
        // The server's own duplicate check, restated: this patient, this date, not cancelled.
        // scheduled_date arrives as a UTC instant, so it is read back as a LOCAL date.
        .filter((b) => b.patient_id === patientId
          && b.status !== 'Cancelled'
          && dateStr(new Date(b.scheduled_date)) === BOOKING_DATE)
        // TIME comes back as '09:00:00'; compared on HH:MM so the two formats cannot disagree.
        .map((b) => String(b.scheduled_time).slice(0, 5))
    );
  }

  async function claimSlot() {
    const [slots, held] = await Promise.all([freeSlot(BOOKING_DATE), heldTimes()]);
    const slot = slots.find((s) => !claimed.has(s.time) && !held.has(String(s.time).slice(0, 5)));
    expect(slot, `no slot left on ${BOOKING_DATE} that this run has not used and this patient does not already hold`).toBeTruthy();
    claimed.add(slot.time);
    return slot.time;
  }

  function book(body) {
    return apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: appointmentForm({ patientId, scheduledDate: BOOKING_DATE, ...body })
    });
  }

  test('one call creates the appointment and attaches its tests together', async () => {
    const res = await book({ scheduledTime: await claimSlot(), testIds });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.appointment.appointment_reference).toBeTruthy();
    expect(body.data.visitTests).toHaveLength(testIds.length);
    expect(body.data.alreadyBooked).toBe(false);
  });

  // [1.106.0] A patient's HMO booking carries the doctor's signed request, in place of the
  // doctor's name and clinical notes they used to type: the HMO approves the tests against it.
  // Refused before the transaction, so the slot stays free; and the file reaches the visit,
  // readable by its owner.
  test("a patient's HMO booking without the doctor's request is refused and consumes no slot", async () => {
    const providerId = (await (await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    })).json()).data.providers[0].id;
    const target = await claimSlot();
    const before = await countMyBookings();

    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: appointmentForm(
        { patientId, scheduledDate: BOOKING_DATE, scheduledTime: target, testIds, hmo: { providerId } },
        { doctorRequest: false, hmoCard: true }
      )
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/doctor's signed request/i);

    expect(await countMyBookings()).toBe(before);
    expect((await freeSlot(BOOKING_DATE)).some((s) => s.time === target)).toBe(true);
  });

  // [1.107.0] Self-pay is not asked for it. A patient paying for their own test books without the
  // paper, and the visit simply has none on file.
  test("a self-pay booking needs no doctor's request", async () => {
    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: appointmentForm(
        { patientId, scheduledDate: BOOKING_DATE, scheduledTime: await claimSlot(), testIds },
        { doctorRequest: false }
      )
    });
    expect(res.status()).toBe(201);
    const visitId = (await res.json()).data.appointment.patient_visit_id;

    const file = await apiContext.get(`${API}/visits/${visitId}/doctor-request`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    expect(file.status()).toBe(404);
  });

  test("the doctor's request lands on the visit, and only its owner and staff may read it", async () => {
    const res = await book({ scheduledTime: await claimSlot(), testIds });
    expect(res.status()).toBe(201);
    const visitId = (await res.json()).data.appointment.patient_visit_id;
    const url = `${API}/visits/${visitId}/doctor-request`;

    const mine = await apiContext.get(url, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(mine.status()).toBe(200);
    expect(mine.headers()['content-type']).toMatch(/image\/png/);

    const reception = await loginAs(apiContext, API, RECEPTION);
    expect((await apiContext.get(url, { headers: { Authorization: `Bearer ${reception}` } })).status()).toBe(200);

    // Diagnostic staff hold no visits:read; and nobody unauthenticated.
    const lab = await loginAs(apiContext, API, LAB);
    expect((await apiContext.get(url, { headers: { Authorization: `Bearer ${lab}` } })).status()).toBe(403);
    expect((await apiContext.get(url)).status()).toBe(401);
  });

  // Shared by both "nothing was written" assertions. A count is timezone-proof where a date
  // comparison is not: the API serialises scheduled_date as a UTC instant.
  const countMyBookings = async () => {
    const res = await apiContext.get(`${API}/appointments/my-bookings`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    return (await res.json()).data.bookings.length;
  };

  test('a rejected booking leaves nothing behind and frees its slot', async () => {
    const target = await claimSlot();
    const before = await countMyBookings();

    // An unknown test id fails after the appointment row would have been written. If the write
    // were not transactional, this is exactly where a phantom booking would be created.
    const res = await book({ scheduledTime: target, testIds: [testIds[0], 99999999] });
    expect(res.status()).toBe(404);

    // The assertion that matters, and the one that holds whatever the slot cap is set to: no
    // booking was recorded. Counted rather than filtered by date — the API returns scheduled_date
    // as a UTC instant, so comparing it to a local calendar date is its own source of false
    // results.
    expect(await countMyBookings()).toBe(before);

    // And the slot is still offered. Weaker than it looks on a dev database with the cap lifted,
    // where every slot always reads as free — which is why it is the second assertion, not the
    // first.
    const after = await freeSlot(BOOKING_DATE);
    expect(after.some((s) => s.time === target)).toBe(true);
  });

  test('re-submitting the same booking returns the original, not a slot conflict', async () => {
    const target = await claimSlot();

    const first = await book({ scheduledTime: target, testIds });
    expect(first.status()).toBe(201);
    const firstRef = (await first.json()).data.appointment.appointment_reference;

    // The retry a patient makes when the first response never reached them.
    const second = await book({ scheduledTime: target, testIds });
    expect(second.status()).toBe(200);

    const body = await second.json();
    expect(body.data.alreadyBooked).toBe(true);
    expect(body.data.appointment.appointment_reference).toBe(firstRef);
  });

  // A 1x1 PNG, so the server's MIME filter sees a genuine image rather than bytes we made up.
  const CARD_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  function bookWithCard({ scheduledTime, testIds: ids, providerId, withCard }) {
    // FormData rather than the plain multipart object: testIds[] is a repeated field, and only
    // FormData can carry the same name more than once.
    const form = new FormData();
    form.append('patientId', String(patientId));
    form.append('scheduledDate', BOOKING_DATE);
    form.append('scheduledTime', scheduledTime);
    form.append('notes', 'card-spec');
    // The [] suffix is required: it makes a single test arrive as a one-element array.
    ids.forEach((id) => form.append('testIds[]', String(id)));
    form.append('hmo[providerId]', String(providerId));
    form.append('hmo[approvalCode]', 'LOA-E2E');
    // No typed referring physician. [1.106.0] The LOA is issued against the requesting doctor
    // ([1.23.0]), and the signed request names them — which is why the patient stopped typing it.
    form.append('doctorRequest', new Blob([CARD_PNG], { type: 'image/png' }), 'doctor-request.png');
    if (withCard) {
      form.append('hmoCard', new Blob([CARD_PNG], { type: 'image/png' }), 'card.png');
    }
    return apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: form
    });
  }

  test('an HMO claim filed with a card starts Pending, never self-approved', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await bookWithCard({
      scheduledTime: await claimSlot(), testIds, providerId, withCard: true
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.hmoRequest).toBeTruthy();
    expect(body.data.hmoRequest.status).toBe('Pending');
  });

  // The card is mandatory, so this is the case that decides whether the guard actually holds.
  // Asserting the slot too is the point: the card is written to disk before the transaction
  // opens, so a rejection has to roll back the booking AND drop the file.
  test('an HMO claim with no card is refused and consumes no slot', async () => {
    const target = await claimSlot();
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await bookWithCard({
      scheduledTime: target, testIds, providerId, withCard: false
    });
    expect(res.status()).toBe(400);

    const after = await freeSlot(BOOKING_DATE);
    expect(after.some((s) => s.time === target)).toBe(true);
  });

  // The rule lives in hmoService, not just the booking controller, so the standalone route is
  // not a way around it.
  test('a client cannot file a card-less claim on the standalone HMO route', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const booked = await book({ scheduledTime: await claimSlot(), testIds });
    expect(booked.status()).toBe(201);
    const visitTestIds = (await booked.json()).data.visitTests.map((vt) => vt.id);

    const res = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { hmoProviderId: providerId, visitTestIds }
    });
    expect(res.status()).toBe(400);
    // Asserted on the message, not just the status: a claim now has two ways to be refused with
    // 400 — no card, and no referring physician [1.23.0] — and a test that accepts either is no
    // longer testing the rule in its own title.
    expect((await res.json()).message).toMatch(/hmo card/i);
  });

  // [1.106.0] Nor is the standalone route a way round the doctor's request. A visit the front desk
  // booked for this patient carries none (staff are exempt), so the patient claiming HMO on it
  // from home is refused, card or no card.
  test("a patient cannot claim HMO on a visit with no doctor's request", async () => {
    const providerId = (await (await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    })).json()).data.providers[0].id;

    const reception = await loginAs(apiContext, API, RECEPTION);
    const booked = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${reception}` },
      data: { patientId, scheduledDate: BOOKING_DATE, scheduledTime: await claimSlot(), testIds },
    });
    expect(booked.status(), 'the desk books without the paper').toBe(201);
    const visitTestIds = (await booked.json()).data.visitTests.map((vt) => vt.id);

    const form = new FormData();
    form.append('hmoProviderId', String(providerId));
    visitTestIds.forEach((id) => form.append('visitTestIds[]', String(id)));
    form.append('hmoCard', new Blob([CARD_PNG], { type: 'image/png' }), 'card.png');
    const res = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: form
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/doctor's signed request/i);
  });

  // A booking may be for today or later, never before. [1.33.0]
  //
  // The date picker has carried min={todayStr()} all along, but nothing on the server compared
  // the date to today — so POST /appointments would create a real visit and a real appointment
  // row for last week, occupying a slot on a day that has already happened, on a queue nobody
  // will ever call. `min` is a browser hint; it does not exist for anything talking to the API.
  test('a booking in the past is refused, and its slot is never consumed', async () => {
    const yesterday = daysAgoStr(1);
    const before = await countMyBookings();

    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: appointmentForm({ patientId, scheduledDate: yesterday, scheduledTime: '09:00', testIds }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/already passed|from today onwards/i);

    // Nothing was written — counted, not matched by date.
    //
    // This asserted `!bookings.some(b => b.scheduled_date.startsWith(yesterday))` and was wrong in
    // exactly the way the comment above it claimed to be avoiding. scheduled_date is serialised as
    // a UTC instant, so an appointment for TODAY in Manila (UTC+8) comes back as
    // 2026-08-23T16:00:00.000Z — which startsWith yesterday's date. The seeded demo carries a
    // booking for today, so the test reported a past booking that does not exist. Counting is the
    // only form of this assertion that does not depend on a timezone.
    expect(await countMyBookings()).toBe(before);
  });

  // The screen and the API must agree: a client should never be offered a slot the server would
  // then refuse. Availability answers "closed" for a past day rather than erroring, because a
  // date-picker keystroke turning into a red toast is not what a closed day looks like.
  test('a past date offers no slots at all', async () => {
    const res = await apiContext.get(`${API}/appointments/availability?date=${daysAgoStr(1)}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(data.isOpen).toBe(false);
    expect(data.slots).toHaveLength(0);
  });

  /**
   * The scenario [1.35.0] exists for: two clients, one slot, one unfinished payment.
   *
   * Before this, `POST /appointments` took the slot the instant the row existed — capacity asked
   * only `status <> 'Cancelled'` and no capacity query joined `payments`. So a patient who opened
   * GCash and closed the tab held 11:30 forever: there is no cron in this project, no retention
   * pass touches appointments, `cancelPendingGatewayPayments` updates only the payments table, and
   * the webhook understands nothing but a successful payment. Client 2 was refused a slot that
   * Client 1 never paid for, permanently.
   *
   * The hold is evaluated at READ time rather than swept by a job, so the slot returns at the
   * exact moment it lapses. That is what the second half of this test asserts — nothing runs in
   * between.
   */
  test('an unpaid self-pay booking holds its slot, then releases it when the hold lapses', async () => {
    const target = await claimSlot();

    const booked = await book({ scheduledTime: target, testIds });
    expect(booked.status()).toBe(201);
    const appointment = (await booked.json()).data.appointment;

    // Put it into the state an online payment creates. Done explicitly because a booking is only
    // provisional when the gateway is configured, and this machine may have no key — the rule
    // that decides WHICH bookings are held is asserted separately, below.
    holdSlot(appointment.id);

    // Client 2's view: the slot is taken while Client 1 is paying. This half worked before.
    const whileHeld = await freeSlot(BOOKING_DATE);
    expect(whileHeld.some((s) => s.time === target),
      'the slot must be held while the patient is paying').toBe(false);

    // Client 1 walks away. Nothing cancels the booking; the hold simply runs out.
    expireHold(appointment.id);

    // The assertion that fails against the old code: the slot is offered again, immediately,
    // with no job having run.
    const afterLapse = await freeSlot(BOOKING_DATE);
    expect(afterLapse.some((s) => s.time === target),
      'a lapsed hold must return the slot').toBe(true);

    // And Client 2 can actually take it, not merely be shown it — the availability grid and the
    // booking-time capacity check are separate queries and used to be separately spelled.
    const client2 = await book({ scheduledTime: target, testIds });
    expect([200, 201]).toContain(client2.status());

    // The abandoned row is still there, as the record of an attempt rather than a deletion.
    const mine = await apiContext.get(`${API}/appointments/my-bookings`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    expect((await mine.json()).data.bookings.some((b) => b.id === appointment.id)).toBe(true);
  });

  // An HMO booking is settled at the clinic by design, so it must never be made conditional on an
  // online payment that is never going to happen.
  test('an HMO booking is permanent, not held', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await bookWithCard({
      scheduledTime: await claimSlot(), testIds, providerId, withCard: true
    });
    expect(res.status()).toBe(201);
    const appointment = (await res.json()).data.appointment;

    // No hold to lapse. The helper refuses a permanent booking, which is the assertion.
    expect(() => expireHold(appointment.id)).toThrow(/permanent, not held/i);
  });

  test('the Self-Pay sentinel is rejected rather than stored as a null provider', async () => {
    const res = await book({
      scheduledTime: await claimSlot(),
      testIds,
      // The UI's "Self-Pay / None" option carries this string; it must never be treated as a
      // provider id, which is how it previously reached the database as NaN.
      hmo: { providerId: 'none' }
    });

    expect(res.status()).toBe(400);
  });
});
