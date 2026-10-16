// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson } from './helpers/people.js';

// Who requested the test. [1.23.0]
//
// A diagnostic report is not addressed to the patient alone — it goes back to the doctor who
// ordered it, and there was nowhere to record who that was. The rule about when it is *mandatory*
// is the part worth pinning, because it is a judgement the clinic made rather than something the
// code implies:
//
//   - required on an HMO claim, because the LOA is issued against the referring physician;
//   - required for the 'Private' patient type, which at this clinic means "a physician referred
//     them" — such a visit naming nobody is a record that contradicts itself;
//   - optional for Self Pay.
//
// The last line is a deliberate gap, recorded in migrations.md: a self-paying walk-in can be
// X-rayed with no requesting physician on file. If the clinic's licensing says otherwise the fix
// is a per-category flag, not a payer rule — and this spec is where that change would announce
// itself.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Referring physician', () => {
  let ctx;
  let recToken;
  let labToken;
  let testId;
  let providerId;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A fresh patient of the given type, so no test depends on another's leftovers. */
  const makePatient = async (typeName) => {
    const res = await ctx.post(`${API}/patients`, {
      headers: auth(recToken),
      data: {
        patientTypeId: await patientTypeId(ctx, API, recToken, typeName),
        ...fixturePerson(),
        birthdate: '1988-04-02', sex: 'Female', contactNumber: '09170000000',
      },
    });
    expect(res.status(), `create ${typeName} patient`).toBe(201);
    return (await res.json()).data.patient;
  };

  const registerVisit = (patientId, body = {}) =>
    ctx.post(`${API}/visits`, {
      headers: auth(recToken),
      data: { patientId, visitType: 'Walk in', notes: '', ...body },
    });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    recToken = await login('receptionist@enlogada.com');
    labToken = await login('lab@enlogada.com');
    // Laboratory specifically: the lab account used below is department-scoped [1.21.0], so a
    // test from any other modality is correctly invisible to it and the last assertion would fail
    // for a reason that has nothing to do with referring physicians.
    const allTests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    testId = allTests.find((t) => t.category_name === 'Laboratory').id;
    providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(recToken) })).json())
      .data.providers[0].id;
  });

  test.afterAll(async () => ctx.dispose());

  test('a Self Pay walk-in needs no referring physician', async () => {
    const patient = await makePatient('Self Pay');
    const res = await registerVisit(patient.id);
    expect(res.status()).toBe(201);
    expect((await res.json()).data.visit.referring_physician).toBeNull();
  });

  test('a Private walk-in is refused without one, and accepted with one', async () => {
    const patient = await makePatient('Private');

    const without = await registerVisit(patient.id);
    expect(without.status()).toBe(400);
    expect((await without.json()).message).toMatch(/referring physician/i);

    const withDoc = await registerVisit(patient.id, {
      referringPhysician: 'Dr. Amelia Santos',
      referringPhysicianPrc: '0142887',
    });
    expect(withDoc.status()).toBe(201);
    const visit = (await withDoc.json()).data.visit;
    expect(visit.referring_physician).toBe('Dr. Amelia Santos');
    expect(visit.referring_physician_prc).toBe('0142887');
  });

  test('whitespace is not a doctor', async () => {
    const patient = await makePatient('Private');
    const res = await registerVisit(patient.id, { referringPhysician: '   ' });
    expect(res.status()).toBe(400);
  });

  test('a licence number without a name is discarded rather than stored alone', async () => {
    // A PRC number identifies nobody on its own, and a visit carrying one with no name reads as
    // though the name were lost rather than never given.
    const patient = await makePatient('Self Pay');
    const res = await registerVisit(patient.id, { referringPhysicianPrc: '0999999' });
    expect(res.status()).toBe(201);
    expect((await res.json()).data.visit.referring_physician_prc).toBeNull();
  });

  test('an HMO claim is refused unless the visit names a physician', async () => {
    const patient = await makePatient('Self Pay');
    const visit = (await (await registerVisit(patient.id)).json()).data.visit;

    const attached = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(recToken),
      data: { patientVisitId: visit.id, testIds: [testId] },
    });
    const visitTestIds = (await attached.json()).data.visitTests.map((vt) => vt.id);

    const without = await ctx.post(`${API}/hmo/request`, {
      headers: auth(recToken),
      data: { hmoProviderId: providerId, visitTestIds },
    });
    expect(without.status()).toBe(400);
    expect((await without.json()).message).toMatch(/referring physician/i);

    const withDoc = await ctx.post(`${API}/hmo/request`, {
      headers: auth(recToken),
      data: {
        hmoProviderId: providerId, visitTestIds,
        referringPhysician: 'Dr. Bayani Cruz', referringPhysicianPrc: '0098431',
      },
    });
    expect(withDoc.status()).toBe(201);

    // Written onto the VISIT, not just filed with the claim — the report is generated from the
    // visit, so a physician recorded only against the claim would never reach the document.
    const after = await ctx.get(`${API}/visits/${visit.id}`, { headers: auth(recToken) });
    expect((await after.json()).data.visit.referring_physician).toBe('Dr. Bayani Cruz');
  });

  test('a later claim does not overwrite a physician the visit already names', async () => {
    // The first name may already be on a released report. Two documents naming different doctors
    // for one episode is worse than either of them being wrong.
    const patient = await makePatient('Private');
    const visit = (await (await registerVisit(patient.id, {
      referringPhysician: 'Dr. First Recorded',
    })).json()).data.visit;

    const attached = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(recToken),
      data: { patientVisitId: visit.id, testIds: [testId] },
    });
    const visitTestIds = (await attached.json()).data.visitTests.map((vt) => vt.id);

    const claim = await ctx.post(`${API}/hmo/request`, {
      headers: auth(recToken),
      data: {
        hmoProviderId: providerId, visitTestIds,
        referringPhysician: 'Dr. Someone Else',
      },
    });
    expect(claim.status()).toBe(201);

    const after = await ctx.get(`${API}/visits/${visit.id}`, { headers: auth(recToken) });
    expect((await after.json()).data.visit.referring_physician).toBe('Dr. First Recorded');
  });

  test('the physician reaches the report the department and the patient read', async () => {
    const patient = await makePatient('Private');
    const visit = (await (await registerVisit(patient.id, {
      referringPhysician: 'Dr. Corazon Villanueva', referringPhysicianPrc: '0176520',
    })).json()).data.visit;

    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(recToken),
      data: { patientVisitId: visit.id, testIds: [testId] },
    });

    const history = await ctx.get(`${API}/results/history/${patient.id}`, { headers: auth(labToken) });
    const rows = (await history.json()).data.results;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].referring_physician).toBe('Dr. Corazon Villanueva');
    expect(rows[0].referring_physician_prc).toBe('0176520');
  });
});
