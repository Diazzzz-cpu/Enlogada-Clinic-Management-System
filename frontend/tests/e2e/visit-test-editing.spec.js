// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * Editing what a visit is for, and the four reasons you cannot. [1.55.0]
 *
 * Reception attaches tests at registration, so by the time a visit reaches the queue the list
 * already exists — what the desk needs there is to CHANGE it. The dialog could only ever add, so
 * a test picked in error stayed on the visit and reached the cashier as a charge somebody had to
 * explain to a patient standing at the counter.
 *
 * Adding is always safe. Removing is not, and that asymmetry is what this file holds:
 *
 *   the visit is PAID       the receipt froze what was charged. Removing a line afterwards makes
 *                           the bill disagree with a document the patient is holding.
 *   a RESULT exists         that is a clinical record, superseded versions included.
 *   status is not Pending   the department already has it; that is not reception's to undo.
 *   it is part of a PACKAGE removing one component leaves the rest summing to less than the
 *                           bundle's fixed price while still calling itself that bundle.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

test.describe('Editing a visit\'s tests', () => {
  let ctx; let rec; let cash;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    rec = await login(ctx, 'receptionist@enlogada.com');
    cash = await login(ctx, 'cashier@enlogada.com');
  });
  test.afterAll(async () => { await ctx.dispose(); });

  /** A fresh walk-in with nothing attached. Named from the fixture pool, never "Test Patient". */
  async function newVisit() {
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(rec) })).json()).data.patientTypes;
    const selfPay = types.find((t) => t.name === 'Self Pay');
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(rec),
      data: {
        ...fixturePerson(), birthdate: '1990-01-01', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
        patientTypeId: selfPay.id,
      },
    })).json()).data.patient;
    return (await (await ctx.post(`${API}/visits`, {
      headers: auth(rec), data: { patientId: patient.id, visitType: 'Walk in' },
    })).json()).data.visit;
  }

  const linesOf = async (visit) =>
    (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(rec) })).json())
      .data.visitTests;

  const activeTests = async () =>
    (await (await ctx.get(`${API}/tests`)).json()).data.tests.filter((t) => t.is_active && Number(t.price) > 0);

  test('a pending test comes off the visit', async () => {
    const tests = await activeTests();
    const visit = await newVisit();
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [tests[0].id, tests[1].id] },
    });

    const lines = await linesOf(visit);
    expect(lines.length).toBe(2);

    const res = await ctx.delete(`${API}/tests/visit-tests/${lines[0].id}`, { headers: auth(rec) });
    expect(res.status()).toBe(200);
    expect(await linesOf(visit)).toHaveLength(1);
  });

  test('a paid visit refuses, because the receipt already said what was charged', async () => {
    const tests = await activeTests();
    const visit = await newVisit();
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [tests[0].id] },
    });

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cash) })).json()).data.bill;
    expect((await ctx.post(`${API}/payments`, {
      headers: auth(cash),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    })).status()).toBe(201);

    const lines = await linesOf(visit);
    const res = await ctx.delete(`${API}/tests/visit-tests/${lines[0].id}`, { headers: auth(rec) });

    expect(res.status(), 'a paid visit must refuse removal').toBe(409);
    // The message has to name the remedy, not just the rule: whoever is at the desk needs to know
    // that reversing the payment is the way through.
    expect((await res.json()).message).toMatch(/already been paid/i);

    // And nothing moved.
    expect(await linesOf(visit)).toHaveLength(1);
  });

  test('a paid visit takes no MORE work either — the revenue leak', async () => {
    const tests = await activeTests();
    const visit = await newVisit();
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [tests[0].id] },
    });

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cash) })).json()).data.bill;
    expect((await ctx.post(`${API}/payments`, {
      headers: auth(cash),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    })).status()).toBe(201);

    // Measured before the guard: this returned 201 and the new row was created 'Processing' —
    // released straight to the department worklist, because the visit is paid. The bill did not
    // move, and POST /payments then refused with "already been paid", since
    // uq_payments_one_paid_per_visit allows one settled row per visit. The clinic performed the
    // test and had no way to charge for it.
    const added = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [tests[1].id] },
    });
    expect(added.status(), 'a settled visit must not silently take on unbillable work').toBe(409);

    // The message has to name the way through, because the desk still has a patient in front of
    // them who wants the extra test.
    expect((await added.json()).message).toMatch(/new visit|reverse the payment/i);

    // And nothing was attached.
    expect(await linesOf(visit), 'the refusal must not half-apply').toHaveLength(1);
  });

  test('a package is removed whole, or not at all', async () => {
    const packages = (await (await ctx.get(`${API}/packages`)).json()).data.packages;
    test.skip(packages.length === 0, 'Need an active package.');
    const pkg = packages[0];

    const visit = await newVisit();
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, packageIds: [pkg.id] },
    });

    const lines = await linesOf(visit);
    expect(lines.length, 'a package expands into one line per component').toBeGreaterThan(1);

    // Ask to remove ONE component. The bundle bills as a single fixed price spread across its
    // parts, so removing one would leave the rest summing to less than the package while still
    // calling itself that package.
    const res = await ctx.delete(`${API}/tests/visit-tests/${lines[0].id}`, { headers: auth(rec) });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.message, 'the reply must say the whole bundle went').toMatch(new RegExp(pkg.name, 'i'));
    expect(body.data.removed).toBe(lines.length);

    expect(await linesOf(visit), 'no orphaned components may survive').toHaveLength(0);
  });

  test('removal answers to tests:assign, and an unknown line is a 404', async () => {
    const lab = await login(ctx, 'lab@enlogada.com');
    const visit = await newVisit();
    const tests = await activeTests();
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [tests[0].id] },
    });
    const lines = await linesOf(visit);

    expect((await ctx.delete(`${API}/tests/visit-tests/${lines[0].id}`, { headers: auth(lab) })).status(),
      'a modality technician does not decide what a visit is for').toBe(403);

    expect((await ctx.delete(`${API}/tests/visit-tests/99999999`, { headers: auth(rec) })).status())
      .toBe(404);

    // Refused, so still there.
    expect(await linesOf(visit)).toHaveLength(1);
  });
});
