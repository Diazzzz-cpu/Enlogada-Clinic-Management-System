// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * There are no refunds: a paid receipt is final. [1.121.0]
 *
 * Steven: a refund does not fit how the clinic works. It let one person take money and hand it
 * back with nobody else involved, a reprinted refunded receipt still read as paid, and only a whole
 * receipt could be reversed. So the route, the permission and the button are gone, not hidden.
 * Reversals recorded before then stay in the cash book, which still reports them.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('No refunds', () => {
  let ctx;
  let cashier, reception, admin;
  let visitId, paymentId;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [cashier, reception, admin] = await Promise.all(
      ['cashier@enlogada.com', 'receptionist@enlogada.com', 'admin@enlogada.com'].map(login)
    );
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(), birthdate: '1979-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId: patient.id, visitType: 'Walk in', notes: 'no refunds spec' },
    })).json()).data.visit;
    visitId = visit.id;
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    await ctx.post(`${API}/tests/visit-tests`, { headers: auth(reception), data: { patientVisitId: visitId, testIds: [labTest.id] } });
    const paid = await payAndReleaseWalkIn(ctx, API, visitId, cashier);
    paymentId = paid?.body?.data?.payment?.id;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('the API has no way to reverse a paid receipt, for anyone', async () => {
    const id = paymentId || 1;
    for (const token of [cashier, admin]) {
      const res = await ctx.patch(`${API}/payments/${id}/status`, {
        headers: auth(token), data: { status: 'Refunded', reason: 'testing the removed route' },
      });
      expect(res.status(), 'the route is gone').toBe(404);
    }
    const matrix = (await (await ctx.get(`${API}/rbac/matrix`, { headers: auth(admin) })).json()).data;
    expect(matrix.permissions.map((p) => p.name), 'and so is its permission').not.toContain('billing:refund');
  });

  test('a paid visit says to start another visit, not to reverse the payment', async () => {
    const extra = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active)[1];
    const res = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception), data: { patientVisitId: visitId, testIds: [extra.id] },
    });
    expect(res.status()).toBe(409);
    const { message } = await res.json();
    expect(message).toContain('Start another visit');
    expect(message).not.toMatch(/reverse|refund/i);
  });

  test("the cashier's receipt log offers no Refund", async ({ page }) => {
    await signInTo(page, 'cashier@enlogada.com', 'Transaction History');
    await expect(page.getByRole('button', { name: 'Reprint' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Refund' })).toHaveCount(0);
  });
});
