// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * A result is its report file, and nothing typed. [1.109.0]
 *
 * [1.94.0] stopped asking for typed findings and measurements; [1.109.0] removed the tables those
 * forms lived in. What is worth holding:
 *
 *   - a caller still sending typed values is told they were not stored, not silently ignored;
 *   - the route that served a test's form is gone;
 *   - the entry dialog offers exactly ONE file input, because laboratory.spec.js attaches the
 *     report with a bare page.locator('input[type="file"]') and a second one would break it from a
 *     file that never mentions this one. (This guard lived in ultrasound-measurements.spec.js.)
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Result entry', () => {
  let ctx;
  let lab, reception, cashier;
  let patient, visitTestId;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [lab, reception, cashier] = await Promise.all(
      ['lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com'].map(login)
    );

    const person = fixturePerson();
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(reception) })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1988-03-11', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'result entry spec' },
    })).json()).data.visit;
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active && parseFloat(t.price) > 0);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cashier) })).json()).data.bill;
    await ctx.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
    visitTestId = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests[0].id;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('typed values are refused with a reason, never dropped in silence', async () => {
    const res = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { file: reportPart('typed values'), measurements: JSON.stringify({ fbs: { value_1: '88' } }) },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/no longer recorded/i);

    // The same report without them is accepted.
    const ok = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab), multipart: { file: reportPart('report only') },
    });
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test('the route that served a test’s form is gone', async () => {
    const res = await ctx.get(`${API}/results/field-set/${visitTestId}`, { headers: auth(lab) });
    // It falls through to GET /results/:visitTestId with "field-set" as the id, which is not one.
    expect(res.status()).not.toBe(200);
  });

  test('the entry dialog offers exactly one file input, and nothing to type', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'lab@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.getByRole('button', { name: 'Laboratory Worklist', exact: true }).first().click({ timeout: 20000 });

    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    const name = page.getByText(`${patient.first_name} ${patient.last_name}`);
    await expect(name).toBeVisible({ timeout: 15000 });
    const row = name.locator('xpath=ancestor::tr[1]');
    await row.getByRole('button', { name: /Attach Report|Edit Report/ }).click();

    await expect(
      page.locator('input[type="file"]'),
      'a second file input would break laboratory.spec.js from a file that never names it'
    ).toHaveCount(1);
    await expect(page.locator('textarea')).toHaveCount(0);
  });
});
