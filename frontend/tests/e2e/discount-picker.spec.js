// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * The till's discount picker has a way back. [1.137.0]
 *
 * Choosing Senior Citizen or PWD by mistake left the picker on it, with no "No discount" to return
 * to: harmless (nothing is applied until Apply, and Apply wants an ID number), but it looked as if
 * the discount was on. "No discount" puts the picker, the ID box and its message back as they began.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('the cashier can go back to "No discount" before applying one', async ({ page }) => {
  const ctx = await request.newContext();
  const reception = (await (await ctx.post(`${API}/auth/login`, {
    data: { email: 'receptionist@enlogada.com', password: PASSWORD },
  })).json()).data.token;
  const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
  const labTest = tests.find((t) => t.category_name === 'Laboratory' && t.is_active !== false);
  const person = fixturePerson();
  const created = await ctx.post(`${API}/visits`, {
    headers: auth(reception),
    data: {
      visitType: 'Walk in',
      testIds: [labTest.id],
      patient: {
        firstName: person.firstName, lastName: person.lastName, birthdate: '1980-05-05', sex: 'Female',
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'), contactNumber: FIXTURE_CONTACT,
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  await ctx.dispose();

  await signInTo(page, 'cashier@enlogada.com', 'Billing Queue');
  await page.getByPlaceholder('Search ticket # or name...').fill(person.lastName);
  await page.getByRole('button', { name: new RegExp(person.fullName) }).first().click({ timeout: 20000 });

  const picker = page.getByRole('combobox', { name: 'Statutory or other discount' });
  const apply = page.getByRole('button', { name: 'Apply', exact: true });
  const idNumber = page.getByLabel('Senior Citizen or PWD ID number');

  await picker.click();
  await page.getByRole('option', { name: /^PWD/ }).click();
  await idNumber.fill('PWD-0001');
  await expect(apply).toBeEnabled();

  await picker.click();
  await page.getByRole('option', { name: 'No discount' }).click();
  await expect(picker).toHaveText('No discount');
  await expect(idNumber, 'the ID typed for it goes too').toHaveValue('');
  await expect(apply, 'nothing to apply').toBeDisabled();
});
