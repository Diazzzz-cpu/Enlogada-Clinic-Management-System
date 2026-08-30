// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * Asking for a slice, and asking for it again. [1.58.0]
 *
 * ── Filtering on a column the table already shows ────────────────────────────────────────────
 *
 * Visit History printed Visit Type and Status in their own columns from the first release and
 * offered no way to ask for either, so "show me yesterday's walk-ins" — the ordinary question at
 * a front desk — meant reading 53 rows and counting by eye. Transaction History had the same gap
 * on Payment Method, on the screen used to reconcile a cash drawer.
 *
 * Both filter at the SERVER, and that is the property worth guarding. Both lists are paged at the
 * database, so narrowing the 25 rows already fetched would filter one page and then report the
 * count of the whole range beside it — a screen reading "53 visits" over a list of four.
 *
 * The money case goes further. `summary` narrows with `method` and deliberately does NOT narrow
 * with `search`, because those are different questions: a method is a real partition of the
 * drawer ("what came in as cash?"), while a name typed to find one receipt is a lookup and must
 * not move the day's totals. The parts must sum to the whole.
 *
 * ── Refresh ─────────────────────────────────────────────────────────────────────────────────
 *
 * Four screens polled; the rest fetched once on mount and then showed that reading indefinitely.
 * Nobody closes a browser between patients, so an admin was routinely reading a queue as it stood
 * hours earlier with nothing on screen to say so.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

// Local getters, never toISOString — that returns the UTC date, which is yesterday in PHT for the
// first eight hours of every day, and a spec that quietly queries the wrong range still passes.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthAgo = () => { const d = new Date(); d.setDate(d.getDate() - 40); return iso(d); };
const today = () => iso(new Date());

test.describe('Filtering a list on what it already shows', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('visit history filters by how the patient arrived', async () => {
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const range = { startDate: monthAgo(), endDate: today(), limit: 100 };

    const all = await (await ctx.get(`${API}/visits/history`, { headers: auth(rec), params: range })).json();
    expect(all.data.total, 'need visits in the range to filter').toBeGreaterThan(0);

    let counted = 0;
    for (const type of ['Walk in', 'Appointment']) {
      const res = await ctx.get(`${API}/visits/history`, {
        headers: auth(rec), params: { ...range, visitType: type },
      });
      expect(res.status()).toBe(200);
      const { visits, total } = (await res.json()).data;
      expect(visits.every((v) => v.visit_type === type), `every row must be a ${type}`).toBeTruthy();
      counted += total;
    }
    // The two types are the whole of chk_visits_type, so they must account for every visit. A
    // filter that drops rows into neither bucket is the failure this catches.
    expect(counted, 'the parts must sum to the whole').toBe(all.data.total);
  });

  test('visit history filters by status, and the two filters combine', async () => {
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const range = { startDate: monthAgo(), endDate: today(), limit: 100 };

    const done = await (await ctx.get(`${API}/visits/history`, {
      headers: auth(rec), params: { ...range, status: 'Completed' },
    })).json();
    expect(done.data.visits.every((v) => v.status === 'Completed')).toBeTruthy();

    const both = await (await ctx.get(`${API}/visits/history`, {
      headers: auth(rec), params: { ...range, status: 'Completed', visitType: 'Walk in' },
    })).json();
    expect(
      both.data.visits.every((v) => v.status === 'Completed' && v.visit_type === 'Walk in'),
      'the two filters must AND, not replace each other'
    ).toBeTruthy();
    expect(both.data.total).toBeLessThanOrEqual(done.data.total);
  });

  test('the count beside the list is the RANGE, not the page', async () => {
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const range = { startDate: monthAgo(), endDate: today(), visitType: 'Walk in' };

    const full = await (await ctx.get(`${API}/visits/history`, {
      headers: auth(rec), params: { ...range, limit: 100 },
    })).json();
    const firstPage = await (await ctx.get(`${API}/visits/history`, {
      headers: auth(rec), params: { ...range, limit: 5 },
    })).json();

    expect(firstPage.data.visits.length).toBeLessThanOrEqual(5);
    // Filtering in the browser instead of in SQL is exactly what would break this: the footer
    // would describe the five rows in hand and call it the range.
    expect(firstPage.data.total, 'the total must count every match, not the page').toBe(full.data.total);
  });

  test('an unrecognised filter is dropped, never applied as nothing', async () => {
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const range = { startDate: monthAgo(), endDate: today(), limit: 100 };

    const all = await (await ctx.get(`${API}/visits/history`, { headers: auth(rec), params: range })).json();
    const bogus = await ctx.get(`${API}/visits/history`, {
      headers: auth(rec), params: { ...range, visitType: 'Teleportation' },
    });

    expect(bogus.status()).toBe(200);
    // Passing it through to SQL would match nothing and render an empty screen — and an empty
    // screen is indistinguishable from a clinic that saw nobody. The value is allow-listed
    // against chk_visits_type and simply not applied.
    expect((await bogus.json()).data.total, 'a typo must not report an empty clinic').toBe(all.data.total);
  });

  test('receipts filter by payment method, and the totals follow', async () => {
    const cash = await login(ctx, 'cashier@enlogada.com');
    const range = { startDate: monthAgo(), endDate: today(), limit: 100 };

    const all = await (await ctx.get(`${API}/payments/transactions`, { headers: auth(cash), params: range })).json();
    test.skip(all.data.total === 0, 'Need settled receipts in the range.');

    let receipts = 0;
    let collected = 0;
    for (const method of ['Cash', 'GCash', 'Bank']) {
      const res = await ctx.get(`${API}/payments/transactions`, {
        headers: auth(cash), params: { ...range, method },
      });
      expect(res.status()).toBe(200);
      const { transactions, total, summary } = (await res.json()).data;
      expect(transactions.every((t) => t.payment_method === method)).toBeTruthy();
      receipts += total;
      collected += Number(summary.collected);
    }

    expect(receipts, 'every receipt is one of the three methods').toBe(all.data.total);
    // The reason a method may narrow the summary at all: it is a partition of the drawer, so the
    // parts have to reconcile to the day. A figure that did not would be worse than no filter.
    expect(collected.toFixed(2), 'the per-method money must sum to the day')
      .toBe(Number(all.data.summary.collected).toFixed(2));
  });

  test('a method the clinic cannot settle is refused, not silently ignored', async () => {
    const cash = await login(ctx, 'cashier@enlogada.com');
    // Unlike a visit type, this one is a 400: chk_payment_method is what the cash-up buckets are,
    // and a caller asking for a bucket that does not exist has made a mistake worth reporting.
    const res = await ctx.get(`${API}/payments/transactions`, {
      headers: auth(cash), params: { startDate: monthAgo(), endDate: today(), method: 'Crypto' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/Cash|GCash|Bank/);
  });
});

test.describe('Refreshing a screen that does not poll', () => {
  test('visit history offers both filter strips on screen', async ({ page }) => {
    await signIn(page, 'receptionist@enlogada.com');
    await page.getByRole('button', { name: 'Visit History' }).first().click();

    await expect(page.getByRole('tablist', { name: /how they arrived/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('tab', { name: 'Walk in' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Appointment' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: /by status/i })).toBeVisible();

    // Applies on click — a chip that needs a second press on Apply reads as broken.
    await page.getByRole('tab', { name: 'Walk in' }).click();
    await expect(page.getByRole('tab', { name: 'Walk in' })).toHaveAttribute('aria-selected', 'true');
  });

  test('the admin screens that fetch once can be asked again', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');

    for (const screen of ['Service Requests', 'Appointments', 'Activity Log', 'Staff Accounts']) {
      await page.getByRole('button', { name: screen }).first().click();
      await expect(
        page.getByRole('button', { name: 'Refresh' }).first(),
        `${screen} fetches once on mount and must offer a way to fetch again`
      ).toBeVisible({ timeout: 20000 });
    }
  });

  test('the patient can ask again, having no notification bell to tell them', async ({ page }) => {
    await signIn(page, 'client@enlogada.com');
    // A patient is emailed that a result is ready and switches back to the tab they left open
    // this morning — which is still showing what it fetched this morning.
    const refresh = page.getByRole('button', { name: 'Refresh' }).first();
    await expect(refresh).toBeVisible({ timeout: 20000 });

    await refresh.click();
    // The timestamp is the half that matters: a screen that can be refreshed still cannot be
    // trusted unless it says how old what you are reading is.
    await expect(page.getByText(/Updated \d{1,2}:\d{2}/)).toBeVisible({ timeout: 15000 });
  });
});
