// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson } from './helpers/people.js';

// Correcting a patient's details. [1.24.0]
//
// PUT /patients/:id existed from the beginning and no staff screen ever called it, so a misspelt
// surname or a wrong birthdate could only be fixed in the database. Birthdate and sex are what
// diagnostic reference ranges are banded by, so a patient carrying the wrong one has every result
// on their file interpreted against the wrong band — and the people who could see the mistake had
// no way to correct it.
//
// Three things worth pinning: who may edit, that the department scope applies to writes and not
// only reads, and that the change lands in the audit log with what it was before. The last one is
// the whole point — "someone edited this record" does not answer the question that gets asked
// afterwards.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Patient record corrections', () => {
  let ctx;
  let recToken;
  let labToken;
  let adminToken;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  const makePatient = async () => {
    const res = await ctx.post(`${API}/patients`, {
      headers: auth(recToken),
      data: {
        patientTypeId: await patientTypeId(ctx, API, recToken, 'Self Pay'),
        // A fresh person per call, so no test depends on another's leftovers.
        ...fixturePerson(),
        birthdate: '1990-01-01', sex: 'Male', contactNumber: '09170000000',
      },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).data.patient;
  };

  const put = (id, body, token = recToken) =>
    ctx.put(`${API}/patients/${id}`, { headers: auth(token), data: body });

  /**
   * A DATE that arrived as a UTC instant, as the calendar date it actually is.
   *
   * `String(p.birthdate).slice(0, 10)` is the obvious thing and it is wrong: the API serialises
   * 1990-01-01 Philippine time as "1989-12-31T16:00:00.000Z", so slicing hands back the previous
   * day and the birthdate walks backwards once per save. Local getters, same as the edit dialog.
   */
  const toDateInput = (value) => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const asPayload = (p, overrides = {}) => ({
    patientTypeId: p.patient_type_id,
    firstName: p.first_name,
    lastName: p.last_name,
    birthdate: toDateInput(p.birthdate),
    sex: p.sex,
    address: p.address || '',
    contactNumber: p.contact_number || '',
    emergencyContact: p.emergency_contact || '',
    ...overrides,
  });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    recToken = await login('receptionist@enlogada.com');
    labToken = await login('lab@enlogada.com');
    adminToken = await login('admin@enlogada.com');
  });

  test.afterAll(async () => ctx.dispose());

  test('reception corrects a misspelt name', async () => {
    const patient = await makePatient();
    const res = await put(patient.id, asPayload(patient, { lastName: `Villaruel${stamp}` }));

    expect(res.status()).toBe(200);
    expect((await res.json()).data.patient.last_name).toBe(`Villaruel${stamp}`);
  });

  test('a birthdate correction sticks, because reference ranges depend on it', async () => {
    const patient = await makePatient();
    const res = await put(patient.id, asPayload(patient, { birthdate: '1975-06-30' }));

    expect(res.status()).toBe(200);
    // Compared as a local calendar date, not by string-matching the ISO instant — the stored
    // 1975-06-30 comes back as "1975-06-29T16:00:00.000Z" in Philippine time.
    expect(toDateInput((await res.json()).data.patient.birthdate)).toBe('1975-06-30');
  });

  test('a full timestamp is refused rather than shifting the date', async () => {
    // The trap this guard exists for: reading a patient and writing it straight back used to
    // re-submit the UTC instant, which Postgres re-parsed a day earlier. Every round trip moved
    // the birthdate, silently, on the field diagnostic reference ranges are banded by.
    const patient = await makePatient();
    const res = await put(patient.id, {
      ...asPayload(patient),
      birthdate: '1989-12-31T16:00:00.000Z',
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/YYYY-MM-DD/);
  });

  test('diagnostic staff may read a patient but not rewrite one', async () => {
    // The sharp edge. A lab account holds patients:read so it can see whose result it is looking
    // at, and deliberately not patients:update — birthdate and sex decide how that result is
    // interpreted, and the person running the analyser is not the person who corrects the record.
    const patient = await makePatient();

    const read = await ctx.get(`${API}/patients/${patient.id}`, { headers: auth(labToken) });
    expect([200, 404]).toContain(read.status()); // 404 if outside the lab's department scope

    const write = await put(patient.id, asPayload(patient, { sex: 'Female' }), labToken);
    expect(write.status()).toBe(403);
  });

  test('required fields are still required', async () => {
    const patient = await makePatient();
    const res = await put(patient.id, asPayload(patient, { firstName: '' }));
    expect(res.status()).toBe(400);
  });

  test('the correction is audited with what the record said before', async () => {
    const patient = await makePatient();
    const res = await put(patient.id, asPayload(patient, { birthdate: '1968-02-11', sex: 'Female' }));
    expect(res.status()).toBe(200);

    const log = await ctx.get(`${API}/admin/activity?limit=25`, { headers: auth(adminToken) });
    expect(log.status()).toBe(200);
    const entries = (await log.json()).data.entries || [];

    const entry = entries.find(
      (e) => e.action === 'patient.updated' && String(e.description || '').includes(`PT-${patient.id}`)
    );
    expect(entry, 'a patient.updated entry for this patient').toBeTruthy();

    // The before-and-after is the point. An entry saying only "patient updated" cannot answer
    // "what did this record say when the result was reported?".
    expect(entry.description).toContain('1990-01-01');
    expect(entry.description).toContain('1968-02-11');
    expect(entry.description).toMatch(/Sex Male → Female/);
  });

  test('saving an unchanged record writes no audit entry', async () => {
    // A no-op edit is not an event. Logging it anyway fills the one log somebody reads during an
    // investigation with rows that say nothing happened.
    const patient = await makePatient();

    const before = await ctx.get(`${API}/admin/activity?limit=50`, { headers: auth(adminToken) });
    const countBefore = ((await before.json()).data.entries || [])
      .filter((e) => e.action === 'patient.updated').length;

    expect((await put(patient.id, asPayload(patient))).status()).toBe(200);

    const after = await ctx.get(`${API}/admin/activity?limit=50`, { headers: auth(adminToken) });
    const countAfter = ((await after.json()).data.entries || [])
      .filter((e) => e.action === 'patient.updated').length;

    expect(countAfter).toBe(countBefore);
  });
});
