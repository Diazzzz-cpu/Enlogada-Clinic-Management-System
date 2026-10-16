// @ts-check
import { test, expect, request } from 'playwright/test';

/**
 * Lists that grow are paged where the data is. [1.128.0]
 *
 * Two screens fetched more than they showed and paged it in the browser:
 *   - a department's History fetched the last 90 days, at most 200 reports, so a busy laboratory's
 *     older reports disappeared from it and the footer's "total" was only what had been fetched;
 *   - Cashier Monitoring downloaded every receipt in the range to draw twenty, and added up each
 *     cashier's takings from them.
 * Both page at the server now. These hold the contract: a true total, pages that do not overlap,
 * a search that reaches beyond the page, and per-cashier figures that are the summary's.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

async function token(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: 'Password123!' } });
  expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

test("a department's History pages at the server, with the true total", async () => {
  const ctx = await request.newContext();
  const headers = { Authorization: `Bearer ${await token(ctx, 'lab@enlogada.com')}` };
  const get = async (params) => (await (await ctx.get(`${API}/results/released/Laboratory`, { headers, params })).json()).data;

  const first = await get({ page: 1, limit: 5 });
  expect(typeof first.total).toBe('number');
  expect(first.released.length).toBeLessThanOrEqual(5);
  expect(first.totalPages).toBe(Math.max(1, Math.ceil(first.total / 5)));
  test.skip(first.total < 6, 'Needs more than one page of released laboratory reports — run seedDemoScenario.js.');

  const second = await get({ page: 2, limit: 5 });
  const ids = (rows) => rows.map((r) => r.visit_test_id);
  expect(ids(second.released).some((id) => ids(first.released).includes(id)), 'pages overlap').toBe(false);
  expect(second.total).toBe(first.total);

  // A search reaches every report, not just the page in hand.
  const target = second.released[0];
  const found = await get({ page: 1, limit: 5, search: target.last_name });
  expect(found.released.map((r) => r.last_name)).toContain(target.last_name);
  expect(found.total).toBeLessThanOrEqual(first.total);

  // Without a page it answers as it always has: a bare list.
  const legacy = (await (await ctx.get(`${API}/results/released/Laboratory`, { headers })).json()).data;
  expect(Array.isArray(legacy.released)).toBe(true);
  expect(legacy.total).toBeUndefined();
  await ctx.dispose();
});

test("Cashier Monitoring's per-cashier figures are the summary's, and its list pages", async () => {
  const ctx = await request.newContext();
  const headers = { Authorization: `Bearer ${await token(ctx, 'admin@enlogada.com')}` };
  const res = await ctx.get(`${API}/payments/transactions`, {
    headers,
    params: { startDate: '2000-01-01', endDate: '2100-01-01', page: 1, limit: 20, byCashier: 'true' },
  });
  expect(res.status()).toBe(200);
  const data = (await res.json()).data;
  expect(data.transactions.length).toBeLessThanOrEqual(20);
  expect(Array.isArray(data.summary.byCashier)).toBe(true);
  const sum = data.summary.byCashier.reduce((n, c) => n + Number(c.collected), 0);
  expect(Math.abs(sum - Number(data.summary.collected)), 'the cashiers add up to the collected figure').toBeLessThan(0.01);
  await ctx.dispose();
});
