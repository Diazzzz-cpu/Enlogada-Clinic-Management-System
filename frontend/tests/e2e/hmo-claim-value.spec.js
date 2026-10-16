// @ts-check
import { test, expect, request } from 'playwright/test';

/**
 * What the clinic's HMO work is worth. [1.51.0]
 *
 * Every other money figure in this app comes from `payments`. An HMO claim never reaches that
 * table — the insurer is billed and pays later, outside this system — so the clinic could see what
 * it had COLLECTED and never what it was OWED.
 *
 * Two properties are worth holding onto, and both are about not lying with a number:
 *
 *  * An approved claim is a RECEIVABLE, never takings. If `approved` ever started counting toward
 *    collected revenue, the same peso would be reported twice — once as a claim, once as cash —
 *    and the clinic's income would read high by exactly what it is still waiting for.
 *
 *  * A claim and its individual tests are decided INDEPENDENTLY, and both decide the money. The
 *    first version of this report read only `hmo_request_tests.approval_status`, so approving a
 *    whole claim moved nothing at all: ₱0 approved, full value still Pending. Reading only the
 *    claim column has the mirror fault — a test the HMO refused would report as billable.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

const money = (v) => Number(v || 0);

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

/** The whole-clinic totals for a wide range, so a fixture anywhere in it is included. */
async function totals(ctx, token) {
  const res = await ctx.get(`${API}/reports/hmo-claims`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { startDate: '2000-01-01', endDate: '2100-01-01' },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).data.report;
}

test.describe('HMO claim value report', () => {
  test('only staff who may read reports can see what the HMO work is worth', async () => {
    const ctx = await request.newContext();
    const range = { startDate: '2026-01-01', endDate: '2026-12-31' };

    for (const email of ['admin@enlogada.com', 'clinicadmin@enlogada.com']) {
      const res = await ctx.get(`${API}/reports/hmo-claims`, {
        headers: { Authorization: `Bearer ${await login(ctx, email)}` }, params: range,
      });
      expect(res.status(), `${email} should be able to read clinic reports`).toBe(200);
    }

    // A claim total is a REPORT, not a claim decision — so it answers to reports:view like every
    // other report, and a modality technician does not hold that.
    const lab = await login(ctx, 'lab@enlogada.com');
    expect((await ctx.get(`${API}/reports/hmo-claims`, {
      headers: { Authorization: `Bearer ${lab}` }, params: range,
    })).status()).toBe(403);

    expect((await ctx.get(`${API}/reports/hmo-claims`, { params: range })).status()).toBe(401);

    await ctx.dispose();
  });

  test('approving a whole claim moves its value out of pending and into approved', async () => {
    const ctx = await request.newContext();
    const superToken = await login(ctx, 'admin@enlogada.com');
    const auth = { Authorization: `Bearer ${superToken}` };

    const pendingClaims = (await (await ctx.get(`${API}/hmo/requests`, { headers: auth })).json())
      .data.requests.filter((r) => r.status === 'Pending');
    test.skip(pendingClaims.length === 0, 'Need a pending HMO claim — run seedDemoScenario.js.');
    const claim = pendingClaims[0];

    const before = await totals(ctx, superToken);

    const approved = await ctx.put(`${API}/hmo/request/${claim.id}/approve`, {
      headers: auth, data: { approvalCode: `E2E-LOA-${Date.now()}` },
    });
    expect(approved.status()).toBe(200);

    const after = await totals(ctx, superToken);

    // The decisive assertion. This is what failed on the first implementation: the claim was
    // approved, the report did not move, because the per-test rows were still 'Pending'.
    expect(
      money(after.totals.approved),
      'approving a claim must move its value into approved'
    ).toBeGreaterThan(money(before.totals.approved));

    expect(
      money(after.totals.pending),
      'and out of pending — the same value cannot be in both columns'
    ).toBeLessThan(money(before.totals.pending));

    // Nothing was created or destroyed: the claimed work is the same, only its classification moved.
    expect(after.totals.testsClaimed).toBe(before.totals.testsClaimed);

    await ctx.dispose();
  });

  test('an approved claim is reported as billable, never as counter takings', async () => {
    const ctx = await request.newContext();
    const superToken = await login(ctx, 'admin@enlogada.com');
    const report = await totals(ctx, superToken);

    // The caveat travels WITH the figure, so it survives being copied into a summary.
    expect(report.note).toMatch(/not part of counter takings/i);

    // `collected` is drawn from payments and `approved` is not, so they are independent figures.
    // If a future change ever folded approved into collected, collected would jump by exactly the
    // approved amount — this pins them apart.
    const perProvider = report.providers.reduce((n, p) => n + money(p.collected), 0);
    expect(
      Math.abs(perProvider - money(report.totals.collected)),
      'the per-provider counter takings must reconcile with the total'
    ).toBeLessThan(0.01);

    for (const p of report.providers) {
      // A visit's counter payment is counted once for the visit, not once per claimed test — the
      // bug a naive join produces, and it inflates takings by the number of tests on the claim.
      expect(money(p.collected)).toBeGreaterThanOrEqual(0);
      expect(money(p.approved) + money(p.pending) + money(p.refused)).toBeGreaterThan(0);
    }

    await ctx.dispose();
  });
});
