// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * A visit is for something. [1.129.0]
 *
 * A walk-in could be registered with no test on it: the patient joined the queue, reached the till
 * with a ₱0 bill, and no department ever saw them. Registration was also three requests (record,
 * visit, tests), so a failure between them left a record with no visit or a visit with no tests.
 * Now POST /visits takes the tests with the visit and does all of it in one transaction, and a
 * record that matches someone already on file (same name, same birthdate) is a question for the
 * desk rather than a second copy of the same person.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('A visit carries its tests from the start', () => {
  let ctx;
  let reception, selfPay, labTest;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  // This run's own records for a person. The names come from a pool a demo patient may share, so
  // the reserved fixture number is what makes them ours.
  const search = async (person) =>
    ((await (await ctx.get(`${API}/patients/search`, { headers: auth(reception), params: { q: person.fullName, limit: 100 } })).json()).data.patients || [])
      .filter((p) => p.contact_number === FIXTURE_CONTACT
        && p.first_name.toLowerCase() === person.firstName.toLowerCase()
        && p.last_name.toLowerCase() === person.lastName.toLowerCase());
  const visitsOf = async (patientId) =>
    (await (await ctx.get(`${API}/visits/patient/${patientId}`, { headers: auth(reception) })).json()).data.visits || [];

  test.beforeAll(async () => {
    ctx = await request.newContext();
    reception = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'receptionist@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    selfPay = await patientTypeId(ctx, API, reception, 'Self Pay');
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory' && Number(t.price) > 0);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  const newPatient = (person, birthdate = '1986-09-19') => ({
    patientTypeId: selfPay, firstName: person.firstName, lastName: person.lastName,
    birthdate, sex: 'Female', contactNumber: FIXTURE_CONTACT,
  });

  test('a visit with no tests is refused, and nothing is created', async () => {
    const person = fixturePerson();
    const res = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patient: newPatient(person), visitType: 'Walk in' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/at least one test or package/i);
    expect(await search(person), 'no record without its visit').toHaveLength(0);
  });

  test('a new patient, the visit, its ticket and its tests come from one request', async () => {
    const person = fixturePerson();
    const res = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patient: newPatient(person), visitType: 'Walk in', testIds: [labTest.id] },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { visit } = (await res.json()).data;
    expect(visit.queue_number, 'a walk-in is given its ticket at once').toBeTruthy();
    expect(visit.patient?.id).toBeTruthy();

    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    expect(lines.map((l) => l.test_id)).toEqual([labTest.id]);
  });

  test('a test that cannot be attached leaves no record behind', async () => {
    const person = fixturePerson();
    const res = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patient: newPatient(person), visitType: 'Walk in', testIds: [99999999] },
    });
    expect(res.status()).toBe(404);
    expect(await search(person), 'all or nothing').toHaveLength(0);
  });

  test('someone already on file is asked about, not copied', async () => {
    const person = fixturePerson();
    const first = await ctx.post(`${API}/patients`, { headers: auth(reception), data: newPatient(person, '1979-12-03') });
    expect(first.status()).toBe(201);
    const onFile = (await first.json()).data.patient;

    // The same name, typed with different spacing and case, and the same birthdate.
    const again = {
      ...newPatient(person, '1979-12-03'),
      firstName: ` ${person.firstName.toUpperCase()} `, lastName: person.lastName.toLowerCase(),
    };
    const asked = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patient: again, visitType: 'Walk in', testIds: [labTest.id] },
    });
    expect(asked.status()).toBe(409);
    const match = (await asked.json()).details?.possibleDuplicate;
    expect(match?.id, 'the record on file is named').toBe(onFile.id);
    expect(match.birthdate, 'as the date it is, not the day before').toBe('1979-12-03');
    expect(await search(person)).toHaveLength(1);

    // The desk says they are someone else: a second record, on purpose.
    const confirmed = await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patient: again, confirmNewPatient: true, visitType: 'Walk in', testIds: [labTest.id] },
    });
    expect(confirmed.status(), await confirmed.text()).toBe(201);
    expect(await search(person)).toHaveLength(2);
  });

  test('the Desk asks for a test before it registers anyone, and finds the record on file', async ({ page }) => {
    const person = fixturePerson();
    const birthdate = '1990-02-17';
    const onFile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception), data: newPatient(person, birthdate),
    })).json()).data.patient;

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('button', { name: 'Register Walk-In', exact: true }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: /walk-in registration/i })).toBeVisible();

    await panel.getByPlaceholder('Juan', { exact: true }).fill(person.firstName);
    await panel.getByPlaceholder('Dela Cruz', { exact: true }).fill(person.lastName);
    await panel.locator('input[type="date"]:visible').first().fill(birthdate);
    await panel.getByRole('combobox').filter({ hasText: /patient type/i }).first().click();
    await page.getByRole('option', { name: 'Self Pay', exact: true }).click();

    // Nothing ticked: refused at the desk, before anything is sent.
    await panel.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' }).click();
    await expect(panel.getByRole('alert').filter({ hasText: /at least one test or package/i })).toBeVisible();
    expect(await visitsOf(onFile.id)).toHaveLength(0);

    await panel.getByPlaceholder('Filter tests…').fill(labTest.name);
    await panel.getByRole('checkbox', { name: labTest.name }).first().check();
    await panel.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' }).click();

    // The same person is already on file: the desk is asked, and keeps their history together.
    const duplicate = panel.getByTestId('possible-duplicate');
    await expect(duplicate).toBeVisible({ timeout: 15000 });
    await expect(duplicate).toContainText(`born ${birthdate}`);
    await duplicate.getByRole('button', { name: 'Use the record on file' }).click();
    await expect(panel.getByText(/Physical Queue Ticket/i)).toBeVisible({ timeout: 15000 });

    expect(await search(person), 'no second record').toHaveLength(1);
    expect(await visitsOf(onFile.id), 'the visit is on the record on file').toHaveLength(1);
  });
});
