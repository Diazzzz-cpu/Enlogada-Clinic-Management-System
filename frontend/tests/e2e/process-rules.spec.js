// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay, dateStr, todayStr } from './helpers/dates.js';
import { submitProof, ensureMethod } from './helpers/payments.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

/**
 * What the server refuses, whoever asks and whatever screen they skip. [1.124.0]
 *
 * A probe of every route sent each one input it should refuse and ran the clinic's processes out
 * of order. These are the refusals it found missing; each was a 2xx (or a 500) before. The rule
 * lives in the service, so the API cannot be talked past a screen that hides the button.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Process rules the server enforces', () => {
  let ctx;
  let desk, cashier, superAdmin;
  let labTests;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  const walkIn = async ({ tests = [labTests[0].id], birthdate = '1980-04-04' } = {}) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate, sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in' } })).json()).data.visit;
    if (tests.length) await ctx.post(`${API}/tests/visit-tests`, { headers: auth(desk), data: { patientVisitId: visit.id, testIds: tests } });
    return { patient, visit };
  };
  const client = async () => {
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    return { token, patient };
  };
  const book = (c, date, time, testIds = [labTests[0].id]) => ctx.post(`${API}/appointments`, {
    headers: auth(c.token),
    multipart: appointmentForm({ patientId: c.patient.id, scheduledDate: date, scheduledTime: time, testIds }),
  });
  const override = (body) => ctx.put(`${API}/schedule/overrides`, { headers: auth(superAdmin), data: body });
  const clearOverride = (date) => ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(superAdmin) });
  const billTotal = async (visitId) => Number((await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill.totalAmount);
  const pay = async (visitId) => ctx.post(`${API}/payments`, { headers: auth(cashier), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: await billTotal(visitId) } });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, cashier, superAdmin] = await Promise.all(['receptionist@enlogada.com', 'cashier@enlogada.com', 'admin@enlogada.com'].map(login));
    labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || []).filter((t) => t.category_name === 'Laboratory' && t.is_active);
    await ensureMethod(ctx, superAdmin);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('a malformed id, date or page is a 400 in words, never a 500', async () => {
    for (const path of ['/visits/abc', '/patients/9999999999999999999', '/payments/bill/abc', '/results/abc/versions']) {
      const res = await ctx.get(`${API}${path}`, { headers: auth(superAdmin) });
      expect(res.status(), path).toBe(400);
      expect((await res.json()).message, path).not.toMatch(/syntax|integer|relation/i);
    }
    expect((await ctx.get(`${API}/visits/history`, { headers: auth(desk), params: { startDate: '2026-02-30', endDate: '2026-03-01' } })).status()).toBe(400);
    expect((await ctx.get(`${API}/admin/activity`, { headers: auth(superAdmin), params: { limit: '-5' } })).status()).toBe(400);
  });

  test('booking honours a date the clinic closed, and its grid, horizon and tests', async () => {
    const c = await client();
    const closed = nthWorkingDay(240);
    await override({ date: closed, isOpen: false, note: 'Holiday' });
    try {
      // The hole: booking checked the weekly pattern only, so a closed date with free slots took a booking.
      expect((await book(c, closed, '10:00')).status()).toBe(409);
    } finally { await clearOverride(closed); }

    const day = nthWorkingDay(241);
    expect((await book(c, day, '09:07')).status(), 'off the slot grid').toBe(400);
    expect((await book(c, day, '09:00', [])).status(), 'no tests').toBe(400);
    const far = new Date(); far.setDate(far.getDate() + 400);
    expect((await book(c, dateStr(far), '09:00')).status(), 'past the horizon').toBe(400);
    expect((await book(c, day, '09:00')).status()).toBe(201);
  });

  test('two patients racing for the last slot of a capacity-1 date: one gets it', async () => {
    const day = nthWorkingDay(242);
    await override({ date: day, isOpen: true, openTime: '09:00', closeTime: '09:30', slotIntervalMinutes: 30, maxConcurrentBookings: 1 });
    try {
      const [a, b] = [await client(), await client()];
      const codes = (await Promise.all([book(a, day, '09:00'), book(b, day, '09:00')])).map((r) => r.status()).sort();
      expect(codes).toEqual([201, 409]);
    } finally { await clearOverride(day); }
  });

  test('a booking checked in on another day moves to today; a checked-in one is no no-show', async () => {
    const c = await client();
    const appt = (await (await book(c, nthWorkingDay(243), '09:00')).json()).data.appointment;
    expect((await ctx.patch(`${API}/appointments/${appt.id}/status`, { headers: auth(desk), data: { status: 'No Show' } })).status(), 'not yet its day').toBe(409);
    expect((await ctx.patch(`${API}/appointments/${appt.id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } })).status()).toBe(200);
    const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(c.token) })).json()).data;
    const moved = (mine.appointments || mine.bookings || []).find((a) => a.id === appt.id);
    expect(dateStr(new Date(moved.scheduled_date))).toBe(todayStr());
    expect((await ctx.patch(`${API}/appointments/${appt.id}/status`, { headers: auth(desk), data: { status: 'No Show' } })).status()).toBe(409);
  });

  test('a cancelled booking is final, and one whose proof waits cannot be cancelled', async () => {
    const c = await client();
    const gone = (await (await book(c, nthWorkingDay(244), '09:00')).json()).data.appointment;
    expect((await ctx.put(`${API}/appointments/${gone.id}/cancel`, { headers: auth(c.token) })).status()).toBe(200);
    expect((await ctx.patch(`${API}/appointments/${gone.id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } })).status(), 'check in a cancelled booking').toBe(409);
    const method = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods[0];
    expect((await submitProof(ctx, c.token, gone.patient_visit_id, { amount: 100, reference: `G${Date.now()}`, methodId: method.id })).status(), 'a proof for a cancelled booking').toBe(409);

    const d = await client();
    const waiting = (await (await book(d, nthWorkingDay(245), '09:00')).json()).data.appointment;
    expect((await submitProof(ctx, d.token, waiting.patient_visit_id, { amount: 100, reference: `W${Date.now()}`, methodId: method.id })).status()).toBe(201);
    expect((await ctx.put(`${API}/appointments/${waiting.id}/cancel`, { headers: auth(d.token) })).status()).toBe(409);
    const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(d.token) })).json()).data;
    expect((mine.appointments || mine.bookings || []).find((a) => a.id === waiting.id).has_pending_proof).toBe(true);
  });

  test('a paid booking re-sent with an extra test is refused, not quietly extended', async () => {
    const c = await client();
    const day = nthWorkingDay(246);
    const appt = (await (await book(c, day, '09:00')).json()).data.appointment;
    await payAndReleaseWalkIn(ctx, API, appt.patient_visit_id, cashier);
    expect((await book(c, day, '09:00', [labTests[0].id, labTests[1].id])).status()).toBe(409);
    expect((await book(c, day, '09:00')).status(), 'the same booking, unchanged').toBe(200);
  });

  test('money is taken only for a live visit with tests on it', async () => {
    const empty = await walkIn({ tests: [] });
    expect((await ctx.post(`${API}/payments`, { headers: auth(cashier), data: { patientVisitId: empty.visit.id, paymentMethod: 'Cash', amount: 0 } })).status()).toBe(409);
    const gone = await walkIn();
    await ctx.patch(`${API}/visits/${gone.visit.id}/status`, { headers: auth(desk), data: { status: 'Cancelled' } });
    expect((await pay(gone.visit.id)).status(), 'a cancelled visit').toBe(409);
    const live = await walkIn();
    expect((await ctx.post(`${API}/payments`, { headers: auth(cashier), data: { patientVisitId: live.visit.id, paymentMethod: 'Bitcoin', amount: await billTotal(live.visit.id) } })).status(), 'an unknown method').toBe(400);
  });

  test('a visit status is the process\'s to set: no Completed by hand, no un-cancelling', async () => {
    const w = await walkIn();
    expect((await ctx.patch(`${API}/visits/${w.visit.id}/status`, { headers: auth(desk), data: { status: 'Completed' } })).status()).toBe(409);
    await ctx.patch(`${API}/visits/${w.visit.id}/status`, { headers: auth(desk), data: { status: 'Cancelled' } });
    expect((await ctx.patch(`${API}/visits/${w.visit.id}/status`, { headers: auth(desk), data: { status: 'Pending' } })).status()).toBe(409);
    expect((await ctx.post(`${API}/tests/visit-tests`, { headers: auth(desk), data: { patientVisitId: w.visit.id, testIds: [labTests[1].id] } })).status(), 'tests on a cancelled visit').toBe(409);
  });

  test('one unpaid visit at a time; a paid one does not block the next', async () => {
    const w = await walkIn();
    expect((await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: w.patient.id, visitType: 'Walk in' } })).status()).toBe(409);
    await pay(w.visit.id);
    expect((await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: w.patient.id, visitType: 'Walk in' } })).status()).toBe(201);
  });

  // [1.125.0] The bill read only each test's own HMO status, so a claim approved as a whole left
  // every test "Pending" at the till: no coverage, and the payment refused over tests "still
  // waiting for the HMO". Both levels now decide, by one rule (constants/hmoEffectiveStatus).
  test('a claim approved as a whole covers its tests at the till', async () => {
    const admin = await login('clinicadmin@enlogada.com');
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk, 'HMO'), ...person, birthdate: '1984-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(desk),
      data: { patientId: patient.id, visitType: 'Walk in', referringPhysician: 'Dr. Amelia R. Santos', referringPhysicianPrc: '0142887' },
    })).json()).data.visit;
    const vts = (await (await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(desk), data: { patientVisitId: visit.id, testIds: [labTests[0].id, labTests[1].id] },
    })).json()).data.visitTests;
    const providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0].id;
    const claim = (await (await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk), data: { hmoProviderId: providerId, memberNumber: `M${Date.now()}`, visitTestIds: vts.map((v) => v.id) },
    })).json()).data;
    const claimId = claim.request?.id || claim.hmoRequest?.id;
    expect((await ctx.put(`${API}/hmo/request/${claimId}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-2026-1' } })).status()).toBe(200);

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json()).data.bill;
    expect(bill.hmoPendingCount, 'nothing is still waiting on the HMO').toBe(0);
    expect(bill.items.every((i) => i.hmoApproved), 'every test reads covered').toBe(true);
    expect(Number(bill.totalAmount), 'the patient owes nothing for covered tests').toBe(0);
    expect((await pay(visit.id)).status(), 'and the till takes the payment').toBe(201);
  });

  test('a Senior Citizen discount needs a patient of 60 or over', async () => {
    const child = await walkIn({ birthdate: '2015-06-01' });
    const discounts = (await (await ctx.get(`${API}/discounts`, { headers: auth(cashier) })).json()).data.discounts;
    const senior = discounts.find((d) => /senior/i.test(d.name));
    const res = await ctx.post(`${API}/discounts/visit/${child.visit.id}`, { headers: auth(cashier), data: { discountTypeId: senior.id, idNumber: 'OSCA-1' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('60 and over');
  });

  test('a patient record must be believable', async () => {
    const base = { patientTypeId: await patientTypeId(ctx, API, desk), ...fixturePerson(), birthdate: '1980-01-01', sex: 'Female', contactNumber: FIXTURE_CONTACT };
    const future = new Date(); future.setDate(future.getDate() + 30);
    for (const bad of [{ birthdate: dateStr(future) }, { birthdate: '1800-01-01' }, { firstName: '   ' }, { sex: 'Robot' }, { contactNumber: 'call me maybe' }]) {
      expect((await ctx.post(`${API}/patients`, { headers: auth(desk), data: { ...base, ...bad } })).status(), JSON.stringify(bad)).toBe(400);
    }
  });

  test('the catalogue refuses a nameless service, a department not offered, and a package with a retired test', async () => {
    const categories = (await (await ctx.get(`${API}/tests/categories`)).json()).data.categories;
    const cat = categories.find((c) => c.name === 'Laboratory').id;
    const ecg = categories.find((c) => c.name === 'ECG');
    if (ecg) expect((await ctx.post(`${API}/tests`, { headers: auth(superAdmin), data: { categoryId: ecg.id, name: `E2E Ecg ${Date.now()}`, price: 100 } })).status(), 'an active service in a department not offered').toBe(400);
    expect((await ctx.post(`${API}/tests`, { headers: auth(superAdmin), data: { categoryId: cat, name: '   ', price: 100 } })).status()).toBe(400);
    expect((await ctx.post(`${API}/tests`, { headers: auth(superAdmin), data: { categoryId: cat, name: `E2E Negative ${Date.now()}`, price: -1 } })).status()).toBe(400);
    const all = (await (await ctx.get(`${API}/tests`, { headers: auth(superAdmin), params: { includeInactive: 'true' } })).json()).data.tests;
    const retired = all.find((t) => !t.is_active);
    test.skip(!retired, 'no retired service in this catalogue');
    expect((await ctx.post(`${API}/packages`, { headers: auth(superAdmin), data: { code: `E2E${Date.now()}`, name: `E2E Pkg ${Date.now()}`, price: 300, testIds: [labTests[0].id, retired.id] } })).status()).toBe(400);
  });
});
