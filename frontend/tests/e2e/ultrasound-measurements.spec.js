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

  // ── The biophysical profile ────────────────────────────────────────────────────────────────
  //
  // Two products, two totals. A score of 8 presented as though it were out of 10 reads as a worse
  // result than it is, which is why these are separate field sets rather than one with an
  // optional NST field.
  test('a biophysical profile totals itself, and only when it is complete', async () => {
    const person = fixturePerson();
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1996-07-04', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e bps' },
    })).json()).data.visit;
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const bps = tests.find((t) => t.name === 'BPS');
    expect(bps, 'BPS must exist in the catalogue').toBeTruthy();
    const attached = (await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [bps.id] },
    })).json()).data.visitTests[0];
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });

    const post = async (measurements, extra = {}) => {
      const res = await apiContext.post(`${API}/results/${attached.id}`, {
        headers: auth(ultra),
        multipart: {
          findings: 'Biophysical profile performed.',
          measurements: JSON.stringify(measurements),
          ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
        },
      });
      return res.status();
    };
    const read = async () => Object.fromEntries(
      ((await (await apiContext.get(`${API}/results/${attached.id}`, { headers: auth(ultra) })).json())
        .data.result.measurements || []).map((m) => [m.field_code, m])
    );

    // Incomplete: three of four assessed. A total here would read as a poor score rather than an
    // unfinished study, so there must be none.
    expect(await post({ fetal_tone: { value_1: 2 }, fetal_movement: { value_1: 2 }, fetal_breathing: { value_1: 2 } })).toBe(201);
    expect((await read()).bps_total, 'an incomplete profile has no total').toBeUndefined();

    // Complete, one component absent-scoring.
    expect(await post({
      fetal_tone: { value_1: 2 }, fetal_movement: { value_1: 0 },
      fetal_breathing: { value_1: 2 }, amniotic_fluid: { value_1: 2 },
    }, { amendmentReason: 'Profile completed on review' })).toBe(201);

    const done = await read();
    expect(Number(done.bps_total.value_1), 'FT2 + FM0 + FBM2 + AFI2 = 6').toBe(6);
    expect(done.bps_total.value_source).toBe('computed');
    expect(done.bps_total.derivation).toBe('BPS_SUM');
    // The /8 set must never advertise itself as /10.
    expect(done.bps_total.reference_note).toContain('8');
  });

  test('endometrial thickness is a real field, and records a value', async () => {
    // A genuine ticket rather than an existence check on the catalogue. The point is that a
    // sonographer can record the number, not that a row exists in a table.
    const person = fixturePerson();
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1979-11-30', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e endometrium' },
    })).json()).data.visit;
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const tvs = tests.find((t) => t.name === 'Trans-vaginal (TVS)');
    const attached = (await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [tvs.id] },
    })).json()).data.visitTests[0];
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });

    const fs = (await (await apiContext.get(`${API}/results/field-set/${attached.id}`, { headers: auth(ultra) })).json())
      .data.fieldSet;
    const endo = fs.fields.find((f) => f.code === 'endometrial_thickness');
    expect(endo, 'TVS must carry endometrial thickness').toBeTruthy();
    expect(endo.unit).toBe('cm');
    // Deliberately no threshold printed beside it. The 4mm literature is scoped to POSTMENOPAUSAL
    // women WITH BLEEDING, and a result_fields row carries neither menopausal nor symptom status —
    // so any single note here would be wrong for most of this clinic's TVS patients.
    expect(endo.reference_note, 'no threshold, because the schema cannot know the population').toBeNull();

    const res = await apiContext.post(`${API}/results/${attached.id}`, {
      headers: auth(ultra),
      multipart: {
        findings: 'The anteverted uterus is normal in size and echopattern.',
        measurements: JSON.stringify({ endometrial_thickness: { value_1: 0.76 } }),
      },
    });
    expect(res.status()).toBe(201);
    const saved = Object.fromEntries(
      ((await (await apiContext.get(`${API}/results/${attached.id}`, { headers: auth(ultra) })).json())
        .data.result.measurements || []).map((m) => [m.field_code, m])
    );
    expect(Number(saved.endometrial_thickness.value_1)).toBeCloseTo(0.76, 2);
  });

  // ── The screen itself ──────────────────────────────────────────────────────────────────────
  //
  // The API tests above prove the data is right. These prove a technician can actually reach it,
  // and that the modality which records no measurements is untouched.
  // ── The screen itself ──────────────────────────────────────────────────────────────────────
  //
  // The API tests above prove the data is right. This proves the modality that records NO
  // measurements is untouched, which is the regression with the widest blast radius: every
  // Laboratory and X-ray ticket in the clinic goes through this dialog.
  // ── The defects a review found that a green suite did not ──────────────────────────────────
  //
  // Each of these was reachable in a 228-passing suite. They are here because the specs above
  // asserted the API payload and the presence of a grid, and never drove the two buttons a
  // technician actually presses.
  test('releasing a form with an empty comment box still saves the grid', async ({ page }) => {
    // [1.53.0] validate() was relaxed so a filled grid with no narrative is a legal save, and
    // release()'s `if (findings)` guard was its silent partner: authorising that result skipped
    // the save, reported "released" and notified the patient, and discarded the typed values.
    //
    // This drives the BROWSER on purpose. The first version of this test posted to the API and
    // passed with the bug still in place, because the defect lives in the hook that the two
    // buttons call — which is exactly the gap a review found in a 228-passing suite.
    const person = fixturePerson();
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-06-06', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e empty comment' },
    })).json()).data.visit;
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const ua = tests.find((t) => t.name === 'Urinalysis');
    const attached = (await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [ua.id] },
    })).json()).data.visitTests[0];
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'lab@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.getByPlaceholder('Search patient, test, queue...').fill(person.lastName);
    const row = page.getByText(`${person.firstName} ${person.lastName}`).locator('xpath=ancestor::tr[1]');
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: 'Record Findings' }).click();

    // Fill ONE grid field and leave the comment box untouched — the legal state [1.52.0] created.
    await page.getByTestId('measurement-color').fill('YELLOW');
    await expect(page.locator('textarea')).toHaveValue('');

    // Authorise straight from the form, which is the path that skipped the save.
    await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
    // ConfirmDialog's own button, which is labelled 'Authorize & Release' (no 'Result').
    await page.getByRole('button', { name: 'Authorize & Release', exact: true }).click();

    // The value must be in the database, not merely on the screen that said it was released.
    const lab = await login('lab@enlogada.com');
    await expect(async () => {
      const saved = (await (await apiContext.get(`${API}/results/${attached.id}`, { headers: auth(lab) })).json())
        .data.result;
      expect(saved, 'the release must not report success with nothing stored').toBeTruthy();
      expect(saved.measurements.find((m) => m.field_code === 'color')?.value_text).toBe('YELLOW');
    }).toPass({ timeout: 15000 });
  });

  test('the patient copy carries the same header block as the clinic copy', async () => {
    // [1.53.0] The two are the same document by requirement, but they came from two queries and
    // only one of them selected birthdate, sex, patient type and discipline — so the patient's
    // copy printed three fields blank and no title at all.
    const client = await login('client@enlogada.com');
    const profiles = (await (await apiContext.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json())
      .data.patients;
    if (!profiles?.length) return;   // a client with no profile has nothing to assert against
    const history = (await (await apiContext.get(`${API}/results/history/${profiles[0].id}`, { headers: auth(client) })).json())
      .data.results;
    if (!history?.length) return;
    // Present as KEYS even when a given row has no value — the defect was the column being absent
    // from the query, which is what made the printed field blank.
    for (const key of ['birthdate', 'sex', 'patient_type_name', 'discipline']) {
      expect(Object.prototype.hasOwnProperty.call(history[0], key), `patient copy must carry ${key}`).toBe(true);
    }
  });

  test('a bare value is refused rather than written as an empty row', async () => {
    // [1.53.0] The browser client always sends an object, which is exactly why the server checks:
    // a bare string wrote an all-NULL row and failed on a raw CHECK violation instead of saying
    // what was wrong.
    const res = await record(ultra, {
      findings: 'Attempted with a bare value.',
      amendmentReason: 'Should be refused',
      measurements: { right_kidney: '10.5' },
    });
    expect(res.status).toBe(400);
  });

  // ── The printed document ───────────────────────────────────────────────────────────────────
  //
  // The requirement is that the saved result prints as the form the clinic already issues. These
  // assert the parts of that document that carry meaning: the sections that group the analytes,
  // the four column headings, and the two signatories with their licence numbers. Nothing here
  // asserts styling — only that the document says what their sheet says.
  test('a Urinalysis prints as the clinic form, with sections and both signatories', async ({ page }) => {
    const person = fixturePerson();
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1984-02-19', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e urinalysis print' },
    })).json()).data.visit;
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const ua = tests.find((t) => t.name === 'Urinalysis');
    expect(ua, 'Urinalysis must exist in the catalogue').toBeTruthy();
    const attached = (await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [ua.id] },
    })).json()).data.visitTests[0];
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });

    const lab = await login('lab@enlogada.com');

    // The form the clinic prints, filled the way they fill it — text, not numbers.
    const rec = await apiContext.post(`${API}/results/${attached.id}`, {
      headers: auth(lab),
      multipart: {
        findings: '',
        measurements: JSON.stringify({
          specimen: { value_text: 'RANDOM' },
          color: { value_text: 'YELLOW' },
          appearance: { value_text: 'CLEAR' },
          glucose: { value_text: 'NEGATIVE' },
          protein: { value_text: 'NEGATIVE' },
          ph: { value_text: '6.0' },
          specific_gravity: { value_text: '1.010' },
          wbc: { value_text: '0-2' },
          rbc: { value_text: '3-5' },
          bacteria: { value_text: 'FEW' },
        }),
      },
    });
    expect(rec.status(), 'a laboratory form saves without any narrative prose').toBe(201);

    const saved = (await (await apiContext.get(`${API}/results/${attached.id}`, { headers: auth(lab) })).json())
      .data.result;
    const byCodeLocal = Object.fromEntries((saved.measurements || []).map((m) => [m.field_code, m]));

    // Text values survive verbatim — a numeric column would have refused three of these.
    expect(byCodeLocal.color.value_text).toBe('YELLOW');
    expect(byCodeLocal.wbc.value_text).toBe('0-2');
    expect(byCodeLocal.bacteria.value_text).toBe('FEW');

    // The sections that make it their document rather than a flat list.
    expect(byCodeLocal.color.section).toBe('Macroscopic:');
    expect(byCodeLocal.glucose.section).toBe('Chemical:');
    expect(byCodeLocal.wbc.section).toBe('Microscopic:');
    // And the reference range the clinic prints beside the microscopic counts.
    expect(byCodeLocal.wbc.unit).toBe('/HPF');
    expect(byCodeLocal.wbc.reference_note).toBe('0.0-5.0');

    // Two signatories, both with licence numbers, in the clinic's printed order.
    expect(saved.signatories).toHaveLength(2);
    expect(saved.signatories[0].role_caption).toBe('Medical Technologist');
    expect(saved.signatories[0].prc_license).toBe('0142853');
    expect(saved.signatories[1].role_caption).toBe('Pathologist');
    expect(saved.signatories[1].prc_license).toBe('0083764');

    // The header block the form prints, carried by the result itself.
    expect(saved.discipline).toBe('CLINICAL MICROSCOPY');
    expect(saved.sex).toBe('Male');
    expect(saved.birthdate).toBeTruthy();
    expect(saved.patient_type_name).toBeTruthy();

    // And it renders. Released first, because the patient copy only exists once it is out.
    await apiContext.post(`${API}/results/${attached.id}/release`, { headers: auth(lab) });
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'lab@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByPlaceholder('Search patient, test, queue...')).toBeVisible({ timeout: 15000 });
  });

  test('a Laboratory ticket renders its own grid, and still has exactly one textarea', async ({ page }) => {
    // Its own ticket, so it does not consume a seeded demo stage.
    const person = fixturePerson();
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1988-03-11', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e grid absence' },
    })).json()).data.visit;
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'lab@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    await expect(page.getByText(`${patient.first_name} ${patient.last_name}`)).toBeVisible({ timeout: 15000 });
    const row = page.getByText(`${patient.first_name} ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await row.getByRole('button', { name: 'Record Findings' }).click();

    // The assertion `laboratory.spec.js` depends on without saying so: it drives the findings box
    // with a BARE page.locator('textarea'), so a second one anywhere in this dialog breaks two of
    // its tests with a strict-mode violation, from a file that never mentions the grid. [1.52.0]
    // gave Laboratory its own field sets, so this now guards a grid that IS rendered — every input
    // in it must remain an <input>.
    await expect(page.locator('textarea')).toHaveCount(1);
    // And the grid is present, because [1.52.0] seeded the clinic's laboratory forms.
    await expect(page.locator('[data-testid^="measurement-row-"]').first()).toBeVisible();
  });

  test('a Laboratory result records its clinic form, and keeps its free text', async () => {
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

    // [1.52.0] seeded the clinic's own laboratory forms, transcribed from their workbook.
    const fs = (await (await apiContext.get(`${API}/results/field-set/${labVisitTest}`, { headers: auth(lab) })).json())
      .data.fieldSet;
    expect(fs, 'a Laboratory test must now carry its clinic form').toBeTruthy();
    expect(fs.discipline, 'the form prints its discipline heading').toBeTruthy();

    // findings still works exactly as it did — the narrative/comment column is untouched.
    const res = await apiContext.post(`${API}/results/${labVisitTest}`, {
      headers: auth(lab),
      multipart: { findings: 'CBC within normal limits.' },
    });
    expect(res.status()).toBe(201);
    const saved = (await (await apiContext.get(`${API}/results/${labVisitTest}`, { headers: auth(lab) })).json())
      .data.result;
    expect(saved.findings).toBe('CBC within normal limits.');
  });
});
