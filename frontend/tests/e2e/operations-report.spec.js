// @ts-check
import { test, expect, request } from 'playwright/test';

// Per-department operating metrics, and the rule that decides who sees which parts.
//
// Every role had a KPI strip counting what was in front of it right now and nothing measuring how
// the department performed — no answer anywhere to "which service earns the most", "how long does
// a patient wait to be billed", or "is X-Ray slower this week".
//
// This is the one report route with no `authorizePermissions` of its own, deliberately: requiring
// `reports:view` would make it Admin-only and defeat the point. The SLICES are the gate instead,
// so these tests are the thing standing between that design and an accidental data leak.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const RANGE = 'startDate=2026-01-01&endDate=2030-01-01';

test.describe('Operations report', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const ops = async (token) => {
    const res = await ctx.get(`${API}/reports/operations?${RANGE}`, { headers: auth(token) });
    return { status: res.status(), body: await res.json() };
  };

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => ctx.dispose());

  test('each role receives exactly the slices its permissions cover', async () => {
    const expected = [
      // email,                       slices it should get
      ['admin@enlogada.com',          ['billing', 'reception', 'diagnostics']],
      ['clinicadmin@enlogada.com',    ['billing', 'reception', 'diagnostics']],
      ['cashier@enlogada.com',        ['billing', 'reception']],   // holds billing:read + visits:read
      ['receptionist@enlogada.com',   ['reception']],              // no billing:read, no results:read
      ['lab@enlogada.com',            ['diagnostics']],            // no billing:read
    ];

    for (const [email, slices] of expected) {
      const { status, body } = await ops(await login(email));
      expect(status, `${email} should reach the report`).toBe(200);
      const got = Object.keys(body.data.report).filter((k) => !['startDate', 'endDate'].includes(k));
      expect(got.sort(), `${email} slices`).toEqual([...slices].sort());
    }
  });

  test('a diagnostic account is not handed the clinic revenue', async () => {
    // The sharp edge of the design. `billing` here is the day's takings, and a lab account asking
    // for its own turnaround must not receive them as a side effect.
    const { body } = await ops(await login('lab@enlogada.com'));
    expect(body.data.report.billing).toBeUndefined();
    // Absent, not zeroed — a zero would read as "no money taken", which is a different claim.
    expect(JSON.stringify(body.data.report)).not.toContain('collected');
  });

  test('diagnostics are department-scoped, like every other clinical read', async () => {
    const lab = (await ops(await login('lab@enlogada.com'))).body.data.report;
    const xray = (await ops(await login('xray@enlogada.com'))).body.data.report;

    expect(lab.diagnostics.scope).toEqual(['Laboratory']);
    expect(xray.diagnostics.scope).toEqual(['Xray']);
    for (const row of lab.diagnostics.byCategory) expect(row.category_name).toBe('Laboratory');
    for (const row of xray.diagnostics.byCategory) expect(row.category_name).toBe('Xray');

    const su = (await ops(await login('admin@enlogada.com'))).body.data.report;
    expect(su.diagnostics.scope, 'oversight is unrestricted').toBeNull();
    expect(su.diagnostics.byCategory.length).toBeGreaterThan(lab.diagnostics.byCategory.length);
  });

  test('a patient cannot reach it at all', async () => {
    const { status } = await ops(await login('client@enlogada.com'));
    expect(status).toBe(403);
  });

  test('sales by service reconciles with the money actually taken', async () => {
    // The property that makes the report worth reading. Revenue is attributed per test from
    // price_at_time and the visit's discount is apportioned across its tests — if that
    // apportionment were dropped, the breakdown would sum to more than the drawer holds, and a
    // report that does not reconcile with the cash-up is one nobody trusts twice.
    const report = (await ops(await login('admin@enlogada.com'))).body.data.report;
    const collected = parseFloat(report.billing.totals.collected);
    const summed = report.billing.byService.reduce((total, row) => total + parseFloat(row.net), 0);

    expect(collected).toBeGreaterThan(0);
    // Within a peso: the apportionment rounds per line.
    expect(Math.abs(summed - collected)).toBeLessThan(1);
  });

  test('an invalid range is refused rather than silently returning everything', async () => {
    const token = await login('admin@enlogada.com');
    const backwards = await ctx.get(`${API}/reports/operations?startDate=2030-01-01&endDate=2020-01-01`, {
      headers: auth(token),
    });
    expect(backwards.status()).toBe(400);

    const missing = await ctx.get(`${API}/reports/operations`, { headers: auth(token) });
    expect(missing.status()).toBe(400);
  });
});
