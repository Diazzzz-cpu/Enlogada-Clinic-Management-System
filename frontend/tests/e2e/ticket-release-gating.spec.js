// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn, confirmAppointmentCheckIn } from './helpers/ticketRelease.js';
import { selfPayTypeId } from './helpers/patients.js';
import { COUNTER_PAYMENT_METHODS } from '../../src/lib/paymentMethods.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson } from './helpers/people.js';

// Ticket Release Gating.
//
// The rule under test: a ticket reaches an Ultrasound/X-Ray/Laboratory worklist only when its
// visit is 'Processing', and a visit only becomes 'Processing' when BOTH a payment has been
// confirmed AND staff have confirmed the patient (front-desk registration for a walk-in, QR
// check-in for an online appointment).
//
// Before this, resultRepository.findPendingByCategory filtered on visit_tests.status alone and
// never looked at the parent visit, so a ticket appeared on a modality worklist the moment a
// client picked tests during online booking — unconfirmed, unpaid, and even if the visit was
// later cancelled. These tests pin both halves: that un-released tickets are invisible AND
// that they are genuinely refused at the API, not merely hidden by the UI.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };


async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

/** A walk-in with a Laboratory test attached, deliberately left unpaid and un-released. */
async function createUnreleasedWalkIn(apiContext, recToken) {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: {
      // Self Pay, resolved by name. This was `patientTypeId: 2` — 'Private' — chosen as a
      // placeholder when the type was only a label. [1.23.0] made 'Private' mean "a physician
      // referred them", so it now requires a referring physician and every fixture here failed.
      // These are ordinary unpaid walk-ins with no doctor, which is what Self Pay describes.
      patientTypeId: await selfPayTypeId(apiContext, API, recToken),
      ...fixturePerson(),
      birthdate: '1990-01-01',
      sex: 'Male',
      address: 'Addr',
      contactNumber: '09170000000',
      emergencyContact: ''
    }
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' }
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [labTest.id] }
  });
  const visitTestId = (await vtRes.json()).data.visitTests[0].id;

  return { patient, visit, visitTestId };
}

test.describe('Ticket release gating (API)', () => {
  let apiContext;
  let recToken;
  let labToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    labToken = await loginAs(apiContext, LAB_STAFF);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('an unpaid walk-in ticket does NOT appear on the department worklist', async () => {
    const { visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    expect(res.status()).toBe(200);

    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBe(false);
  });

  test('the same ticket DOES appear once payment releases it', async () => {
    const { visit, visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);

    await payAndReleaseWalkIn(apiContext, API, visit.id);

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    const pending = (await res.json()).data.pending;
    const ticket = pending.find((p) => p.visit_test_id === visitTestId);

    expect(ticket).toBeTruthy();
    // It arrives already Processing — the department did not start it.
    expect(ticket.test_status).toBe('Processing');
  });

  test('diagnostic staff are REFUSED on an un-released ticket, not merely shown less', async () => {
    const { visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);

    // Hiding a row is not enforcement: a visit_test id is a small integer, so the guard has to
    // hold against a direct API call too.
    const statusRes = await apiContext.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { status: 'Waiting for Release' }
    });
    expect(statusRes.status()).toBe(403);

    const uploadRes = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'should never be recorded', remarks: '' }
    });
    expect(uploadRes.status()).toBe(403);
  });

  test('diagnostic staff cannot set a ticket to Processing even after release', async () => {
    const { visit, visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);
    await payAndReleaseWalkIn(apiContext, API, visit.id);

    const res = await apiContext.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { status: 'Processing' }
    });
    expect(res.status()).toBe(403);
  });

  test('a receptionist cannot push an unpaid visit onto a worklist by setting Processing', async () => {
    const { visit } = await createUnreleasedWalkIn(apiContext, recToken);

    const res = await apiContext.patch(`${API}/visits/${visit.id}/status`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { status: 'Processing' }
    });

    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('payment');
  });

  test('recording findings parks the ticket in Waiting for Release, not Completed', async () => {
    const { visit, visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);
    await payAndReleaseWalkIn(apiContext, API, visit.id);

    const uploadRes = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'CBC within normal limits.', remarks: '' }
    });
    expect(uploadRes.status()).toBe(201);

    const pendingRes = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    const ticket = (await pendingRes.json()).data.pending.find((p) => p.visit_test_id === visitTestId);

    // Still on the worklist — recording findings is not releasing them.
    expect(ticket).toBeTruthy();
    expect(ticket.test_status).toBe('Waiting for Release');
  });

  test('releasing the last test completes the visit', async () => {
    const { visit, visitTestId } = await createUnreleasedWalkIn(apiContext, recToken);
    await payAndReleaseWalkIn(apiContext, API, visit.id);

    await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'Findings.', remarks: '' }
    });
    const releaseRes = await apiContext.post(`${API}/results/${visitTestId}/release`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    expect(releaseRes.status()).toBe(200);

    const visitRes = await apiContext.get(`${API}/visits/${visit.id}`, {
      headers: { Authorization: `Bearer ${recToken}` }
    });
    expect((await visitRes.json()).data.visit.status).toBe('Completed');
  });
});

test.describe('Online appointment gating (API)', () => {
  let apiContext;
  let recToken;
  let clientToken;
  let labToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    clientToken = await loginAs(apiContext, CLIENT);
    labToken = await loginAs(apiContext, LAB_STAFF);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  // Slots this file has already booked into. Each test needs its OWN appointment: POST
  // /appointments recognises a repeat of a booking the same patient already holds and returns the
  // original rather than creating a second one, so two tests landing on the same slot would
  // silently share one visit — and the third test here would then be checking in a visit the
  // second test already checked in. `find(s => s.available)` cannot prevent that on its own,
  // because a dev database with the slot cap lifted (cleanE2eData.js --unlimited-slots) reports
  // every slot as available however many bookings it holds.
  const claimedSlots = new Set();

  async function createOnlineBooking() {
    const profilesRes = await apiContext.get(`${API}/patients/my-profiles`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const profiles = (await profilesRes.json()).data.patients;
    test.skip(!profiles || profiles.length === 0, 'Seeded client has no patient profile to book with.');

    // Probe forward for a day the clinic is actually OPEN, rather than assuming tomorrow is one.
    //
    // This used to ask for `new Date(Date.now() + 86400000).toISOString().slice(0, 10)`, which is
    // the UTC-vs-local bug CLAUDE.md documents, and it made the suite's coverage depend on the
    // clock: before 08:00 Manila that expression returns TODAY, after it returns tomorrow. Run on
    // a Saturday morning it therefore probed Sunday, the one day the clinic is closed, and these
    // three tests skipped — silently, reported only as "3 skipped" with no indication that a
    // release-gating boundary had gone unchecked that run.
    //
    // daysAgoStr uses local getters. The loop is bounded because a clinic closed all week is a
    // fixture problem worth failing on rather than looping over.
    // A far-future working day this file owns, rather than "the next open day". [1.65.0]
    //
    // Probing forward from tomorrow put these three tests in the busiest week of the calendar —
    // the one the demo seed fills and every other booking spec reaches for. `claimedSlots` below
    // de-duplicates by TIME and is file-local, so it cannot see a slot another spec already took
    // on the same date with this same seeded client.
    //
    // That collision is silent and it inverts the assertion. `POST /appointments` returns the
    // EXISTING booking with 200 when the same patient re-submits the same date and time, so this
    // helper would hand back an appointment another spec had already paid for and checked in —
    // and "a freshly booked appointment is invisible to the department" then legitimately fails,
    // because that appointment really was released. Measured: the failure moved between runs and
    // reproduced on a clean tree, which is what a shared-state flake looks like and a regression
    // does not.
    //
    // 170 is clear of the 120-151 band the other booking specs already claim. The probe is kept
    // in case that exact date carries a schedule override, but it starts somewhere quiet.
    let avail = null;
    for (let ahead = 0; ahead <= 7 && !avail?.isOpen; ahead += 1) {
      const availRes = await apiContext.get(`${API}/appointments/availability`, {
        headers: { Authorization: `Bearer ${clientToken}` },
        params: { date: nthWorkingDay(170 + ahead) }
      });
      avail = (await availRes.json()).data;
    }
    expect(avail?.isOpen, 'no open day in the next week — check clinic_operating_hours').toBe(true);
    const slot = avail.slots.find((s) => s.available && !claimedSlots.has(s.time));
    test.skip(!slot, 'No available slot to book.');
    claimedSlots.add(slot.time);

    const apptRes = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: {
        patientId: profiles[0].id,
        scheduledDate: avail.date,
        scheduledTime: slot.time,
        notes: 'gating spec'
      }
    });
    const appointment = (await apptRes.json()).data.appointment;

    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
    const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientVisitId: appointment.patient_visit_id, testIds: [labTest.id] }
    });
    const visitTestId = (await vtRes.json()).data.visitTests[0].id;

    return { appointment, visitTestId };
  }

  test('a freshly booked online appointment is invisible to the department', async () => {
    const { visitTestId } = await createOnlineBooking();

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBe(false);
  });

  test('check-in alone does not release an unpaid appointment', async () => {
    const { appointment, visitTestId } = await createOnlineBooking();

    const checkIn = await confirmAppointmentCheckIn(apiContext, API, appointment.id, recToken);
    expect(checkIn.status()).toBe(200);

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBe(false);
  });

  test('payment plus check-in together release the appointment', async () => {
    const { appointment, visitTestId } = await createOnlineBooking();

    // Payment first, check-in second — the release fires on whichever completes last.
    await payAndReleaseWalkIn(apiContext, API, appointment.patient_visit_id);

    const beforeCheckIn = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    expect((await beforeCheckIn.json()).data.pending.some((p) => p.visit_test_id === visitTestId)).toBe(false);

    await confirmAppointmentCheckIn(apiContext, API, appointment.id, recToken);

    const afterCheckIn = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${labToken}` }
    });
    expect((await afterCheckIn.json()).data.pending.some((p) => p.visit_test_id === visitTestId)).toBe(true);
  });
});

test.describe('Payment gateway configuration', () => {
  let apiContext;
  let clientToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    clientToken = await loginAs(apiContext, CLIENT);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('gateway status reports availability and only ever offers methods the clinic can settle', async () => {
    const res = await apiContext.get(`${API}/payments/gateway/status`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    expect(res.status()).toBe(200);

    const gateway = (await res.json()).data.gateway;
    expect(typeof gateway.available).toBe('boolean');
    // Asserted against the clinic's own vocabulary rather than a list repeated here, so this
    // goes on testing the rule when the vocabulary changes. PayMaya was removed in [1.33.0] —
    // the owner holds no PayMaya merchant account — and a hard-coded pair would have kept
    // passing while asserting something no longer true. If credentials are absent the list is
    // empty and the UI falls back to counter payment entirely.
    for (const method of gateway.methods) {
      expect(COUNTER_PAYMENT_METHODS).toContain(method);
    }
  });

  test('the webhook rejects an unsigned request', async () => {
    const res = await apiContext.post(`${API}/payments/gateway/webhook`, {
      data: { data: { attributes: { type: 'checkout_session.payment.paid', data: { id: 'cs_forged' } } } }
    });
    // No valid signature means no settlement, regardless of how legitimate the body looks.
    expect(res.status()).toBe(401);
  });
});
