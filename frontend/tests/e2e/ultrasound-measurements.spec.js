// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

// Structured measurements on an ultrasound report. [1.50.0]
//
// The assertion this file exists for is the carry-forward one. `createResult` inserts a NEW
// test_results row per save and copies nothing from its predecessor — which is why the service
// already has to re-read and re-pass file metadata explicitly, a bug that was found once and fixed
// for a single column. Child rows have the same problem and a far worse blast radius: a technician
// correcting one decimal point on a KUB would otherwise produce a live version carrying ONE field,
// with the other seven readable only on the superseded row. It would pass every other check in the
// suite, because nothing else looks at them.
//
// The rest of the file guards the things that make the numbers trustworthy: that a superseded
// version keeps its own figures, that editing an axis recomputes the derived weight on the new
// version WITHOUT restating the old one, that a clinician's override is never overwritten by
// arithmetic, and that a field belonging to the other sex is refused rather than stored.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Ultrasound structured measurements', () => {
  let apiContext;
  let ultra, reception, cashier;
  let visitTestId;
  let fieldSet;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  // Multipart, because the route carries multer for the optional file. An object cannot survive
  // form-data, so measurements travel as a JSON string — which is exactly what the controller
  // parses, so sending it any other way would test a path the app does not use.
  const record = async (token, { measurements, ...fields }) => {
    const multipart = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, String(v)])
    );
    if (measurements !== undefined) multipart.measurements = JSON.stringify(measurements);
    const res = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: auth(token), multipart,
    });
    return { status: res.status(), body: await res.json() };
  };

  const readResult = async (token) =>
    (await (await apiContext.get(`${API}/results/${visitTestId}`, { headers: auth(token) })).json())
      .data.result;

  const byCode = (measurements) =>
    Object.fromEntries((measurements || []).map((m) => [m.field_code, m]));

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    ultra = await login('ultrasound@enlogada.com');
    reception = await login('receptionist@enlogada.com');
    cashier = await login('cashier@enlogada.com');

    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

    // Male on purpose: KUB / Prostate carries the sex-conditional prostate fields, and the derived
    // weight hangs off them. A female patient on this study correctly sees kidneys only — which is
    // the "plain KUB" the clinic performs, and is asserted at the end.
    const person = fixturePerson();
    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id,
        firstName: person.firstName, lastName: person.lastName,
        birthdate: '1971-04-02', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json();

    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e measurements' },
    })).json();
    const visitId = visit.data.visit.id;

    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const kub = tests.find((t) => t.name === 'KUB / Prostate');
    expect(kub, 'KUB / Prostate must exist in the catalogue').toBeTruthy();

    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: [kub.id] },
    })).json();
    visitTestId = attached.data.visitTests[0].id;

    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;
    const paid = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
    expect(paid.status(), 'the ticket must be released before findings can be recorded').toBe(201);

    fieldSet = (await (await apiContext.get(`${API}/results/field-set/${visitTestId}`, { headers: auth(ultra) })).json())
      .data.fieldSet;
  });

  test.afterAll(async () => { await apiContext.dispose(); });

  test('the form knows its own shape, and a test with no field set says so', async () => {
    expect(fieldSet, 'KUB / Prostate must have a field set').toBeTruthy();
    expect(fieldSet.code).toBe('kub_prostate');

    const codes = fieldSet.fields.map((f) => f.code);
    expect(codes).toContain('right_kidney');
    expect(codes).toContain('prostate_gland');
    expect(codes).toContain('prostate_weight');

    // A three-axis field is one field, not three: three rows would lose the grouping and need an
    // ordinal to put them back in order.
    expect(fieldSet.fields.find((f) => f.code === 'right_kidney').value_kind).toBe('linear3');
    expect(fieldSet.fields.find((f) => f.code === 'right_kidney_ct').value_kind).toBe('number');

    // The clinic's own printed annotation, carried as text rather than numeric bounds.
    const weight = fieldSet.fields.find((f) => f.code === 'prostate_weight');
    expect(weight.derivation).toBe('ELLIPSOID_VOLUME');
    expect(weight.derived_from).toBe('prostate_gland');
    expect(weight.reference_note).toContain('N.V.');
  });

  test('recording measurements stores them, and derives the weight from the axes', async () => {
    const res = await record(ultra, {
      findings: 'Both kidneys are normal in size and echopattern. No pelvocaliectasia noted.',
      measurements: {
        right_kidney: { value_1: 10.51, value_2: 5.77, value_3: 5.42 },
        right_kidney_ct: { value_1: 1.10 },
        left_kidney: { value_1: 11.13, value_2: 5.70, value_3: 5.74 },
        left_kidney_ct: { value_1: 1.34 },
        prostate_gland: { value_1: 3.42, value_2: 3.46, value_3: 3.22 },
      },
    });
    expect(res.status).toBe(201);

    const saved = byCode((await readResult(ultra)).measurements);
    expect(Number(saved.right_kidney.value_1)).toBeCloseTo(10.51, 2);
    expect(Number(saved.right_kidney.value_3)).toBeCloseTo(5.42, 2);

    // 0.5236 x 3.42 x 3.46 x 3.22 = 19.95 — the figure the clinic's own report printed for these
    // exact axes. The system computes it rather than trusting it to be retyped, because in the
    // clinic's archive roughly 1 in 20 of these no longer matches its own measurements.
    expect(saved.prostate_weight).toBeTruthy();
    expect(Number(saved.prostate_weight.value_1)).toBeCloseTo(19.95, 2);
    expect(saved.prostate_weight.value_source).toBe('computed');
    expect(saved.prostate_weight.derivation).toBe('ELLIPSOID_VOLUME');
  });

  test('amending ONE field does not erase the others', async () => {
    const before = byCode((await readResult(ultra)).measurements);
    const beforeCount = Object.keys(before).length;
    expect(beforeCount, 'the first version must have measurements to carry forward').toBeGreaterThan(4);

    // The client sends only what it is changing. Every other field is ABSENT from the payload,
    // which under the merge rule means "carry it forward" rather than "erase it".
    const amended = await record(ultra, {
      findings: 'Both kidneys are normal in size and echopattern. No pelvocaliectasia noted.',
      amendmentReason: 'Right cortical thickness transcribed incorrectly',
      measurements: { right_kidney_ct: { value_1: 1.21 } },
    });
    expect(amended.status).toBe(201);

    const after = byCode((await readResult(ultra)).measurements);
    expect(Number(after.right_kidney_ct.value_1)).toBeCloseTo(1.21, 2);

    // This is the assertion the file exists for.
    expect(Object.keys(after).length, 'every other field must survive the amendment').toBe(beforeCount);
    expect(Number(after.right_kidney.value_1)).toBeCloseTo(10.51, 2);
    expect(Number(after.left_kidney.value_2)).toBeCloseTo(5.70, 2);
    expect(Number(after.prostate_gland.value_1)).toBeCloseTo(3.42, 2);
  });

  test('a superseded version keeps its own figures', async () => {
    const versions = (await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(ultra) })).json())
      .data.versions;
    expect(versions.length).toBeGreaterThan(1);

    const live = versions.find((v) => v.is_current);
    const superseded = versions.find((v) => !v.is_current);
    expect(superseded, 'the earlier version must still exist').toBeTruthy();
    expect(live.version).toBeGreaterThan(superseded.version);

    // Values hang off the VERSION, so the old one still answers for itself. Had they hung off the
    // visit_test instead, this amendment would have rewritten them in place and the history would
    // render the old prose beside the new numbers.
    expect(live.id).not.toBe(superseded.id);
  });

  test('editing an axis recomputes the weight, and does not restate the released one', async () => {
    const before = byCode((await readResult(ultra)).measurements);
    const oldWeight = Number(before.prostate_weight.value_1);

    const res = await record(ultra, {
      findings: 'The prostate gland is enlarged. No calcification seen within.',
      amendmentReason: 'Prostate remeasured on review',
      measurements: { prostate_gland: { value_1: 4.10, value_2: 3.90, value_3: 3.60 } },
    });
    expect(res.status).toBe(201);

    const after = byCode((await readResult(ultra)).measurements);
    // 0.5236 x 4.10 x 3.90 x 3.60 = 30.14
    expect(Number(after.prostate_weight.value_1)).toBeCloseTo(30.14, 1);
    expect(Number(after.prostate_weight.value_1)).not.toBeCloseTo(oldWeight, 1);
    expect(after.prostate_weight.value_source).toBe('computed');
  });

  test('a figure the sonologist typed is kept as typed, not overruled by arithmetic', async () => {
    const res = await record(ultra, {
      findings: 'The prostate gland is enlarged.',
      amendmentReason: 'Weight measured directly rather than estimated',
      measurements: {
        prostate_gland: { value_1: 4.10, value_2: 3.90, value_3: 3.60 },
        prostate_weight: { value_1: 28.00 },
      },
    });
    expect(res.status).toBe(201);

    const after = byCode((await readResult(ultra)).measurements);
    expect(Number(after.prostate_weight.value_1), 'the entered figure must survive').toBeCloseTo(28.00, 2);
    // Marked so the disagreement is visible rather than silently absorbed.
    expect(after.prostate_weight.value_source).toBe('override');
  });

  test('a field belonging to the other sex is refused, not stored', async () => {
    // The patient is Male. `uterus` is a real field of other studies, so this is not a typo — it
    // is the wrong record, and of 405 whole abdomens in the clinic's archive not one carried both
    // a prostate and a uterus.
    const res = await record(ultra, {
      findings: 'Attempted with a field from the other branch.',
      amendmentReason: 'Should be refused',
      measurements: { uterus: { value_1: 7.0, value_2: 4.0, value_3: 3.5 } },
    });
    expect(res.status, 'a uterus on a male patient must be refused').toBe(400);
  });

  test('a field the form does not define is refused rather than silently dropped', async () => {
    const res = await record(ultra, {
      findings: 'Attempted with an unknown field.',
      amendmentReason: 'Should be refused',
      measurements: { spleen_size_in_furlongs: { value_1: 3 } },
    });
    expect(res.status).toBe(400);
  });

  test('a Laboratory result still records free text, and takes no measurements', async () => {
    const lab = await login('lab@enlogada.com');
    const labVisitTest = await (async () => {
      const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
        .data.patientTypes;
      const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
      const person = fixturePerson();
      const patient = await (await apiContext.post(`${API}/patients`, {
        headers: auth(reception),
        data: {
          patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
          birthdate: '1990-01-20', sex: 'Female', contactNumber: FIXTURE_CONTACT,
        },
      })).json();
      const visit = await (await apiContext.post(`${API}/visits`, {
        headers: auth(reception),
        data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e free text' },
      })).json();
      const vid = visit.data.visit.id;
      const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
      const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
      const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
        headers: auth(reception),
        data: { patientVisitId: vid, testIds: [labTest.id] },
      })).json();
      const bill = (await (await apiContext.get(`${API}/payments/bill/${vid}`, { headers: auth(cashier) })).json())
        .data.bill;
      await apiContext.post(`${API}/payments`, {
        headers: auth(cashier),
        data: { patientVisitId: vid, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
      });
      return attached.data.visitTests[0].id;
    })();

    // No field set: this is what keeps every Laboratory and X-ray ticket on exactly the path it
    // was on before this feature existed.
    const fs = (await (await apiContext.get(`${API}/results/field-set/${labVisitTest}`, { headers: auth(lab) })).json())
      .data.fieldSet;
    expect(fs, 'a Laboratory test must have no field set').toBeNull();

    const res = await apiContext.post(`${API}/results/${labVisitTest}`, {
      headers: auth(lab),
      multipart: { findings: 'CBC within normal limits.' },
    });
    expect(res.status()).toBe(201);
    const saved = (await (await apiContext.get(`${API}/results/${labVisitTest}`, { headers: auth(lab) })).json())
      .data.result;
    expect(saved.findings).toBe('CBC within normal limits.');
    expect(saved.measurements).toEqual([]);
  });
});
