// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * A department's worklist, one row per patient. [1.115.0]
 *
 * A patient in for several tests used to fill one row per test, with the same ticket, name and wait
 * on each. Now they are one row, and their tests open under their name; a patient with one test
 * keeps the ordinary row, which is what every other worklist spec drives.
 *
 * Each fixture is found by its queue ticket, which is unique for the day, so a demo patient who
 * happens to share the fixture's name cannot answer for it.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Worklist: one row per patient', () => {
  let ctx;
  let reception, cashier;
  /** A walk-in with three laboratory tests, and one with a single test. */
  let many, one;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A walk-in with `count` paid laboratory tests on the worklist. */
  const walkInWith = async (count) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...person, birthdate: '1985-03-12', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active)
      .slice(0, count);
    expect(labTests.length).toBe(count);
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'worklist groups spec', testIds: labTests.map((t) => t.id) },
    })).json()).data.visit;
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    expect(visit.queue_number, 'a walk-in is given its ticket at once').toBeTruthy();
    return { person, ticket: visit.queue_number, testNames: labTests.map((t) => t.name) };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier] = await Promise.all(['receptionist@enlogada.com', 'cashier@enlogada.com'].map(login));
    many = await walkInWith(3);
    one = await walkInWith(1);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  const find = async (page, ticket) => {
    await page.getByPlaceholder('Search patient, test, queue...').fill(ticket);
  };

  test('several tests are one row under the name, and open beneath it', async ({ page }) => {
    await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
    await find(page, many.ticket);

    const group = page.getByTestId('worklist-group');
    await expect(group).toHaveCount(1, { timeout: 15000 });
    await expect(group).toContainText(many.person.fullName);
    await expect(group).toContainText('3 tests');
    await expect(group).toContainText('3 Processing');
    await expect(page.locator('tbody').getByText(many.person.fullName), 'the name is said once').toHaveCount(1);
    await expect(page.getByText('1 patient · 3 tests')).toBeVisible();

    // Closed: the tests are named, but there is nothing to act on until the name is opened.
    const tests = page.getByTestId('worklist-group-test');
    await expect(tests).toHaveCount(0);
    await expect(group.getByRole('button', { name: 'Attach Report' })).toHaveCount(0);

    const name = group.getByRole('button', { name: many.person.fullName });
    await expect(name).toHaveAttribute('aria-expanded', 'false');
    await name.click();
    await expect(name).toHaveAttribute('aria-expanded', 'true');
    await expect(tests).toHaveCount(3);
    for (const testName of many.testNames) {
      await expect(tests.filter({ hasText: testName }).getByRole('button', { name: 'Attach Report' })).toBeVisible();
    }

    // Each test's own action opens that test.
    await tests.filter({ hasText: many.testNames[1] }).getByRole('button', { name: 'Attach Report' }).click();
    await expect(page.getByRole('dialog')).toContainText(many.testNames[1]);
    await page.keyboard.press('Escape');

    await name.click();
    await expect(tests).toHaveCount(0);
  });

  test('a patient with one test keeps the ordinary row', async ({ page }) => {
    await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
    await find(page, one.ticket);

    const row = page.locator('tbody tr', { hasText: one.person.fullName });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(page.getByTestId('worklist-group')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Attach Report' })).toBeVisible();
    await expect(row).toContainText(one.testNames[0]);
  });
});
