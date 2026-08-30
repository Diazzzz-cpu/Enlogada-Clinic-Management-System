// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * A receipt has to be findable again. [1.52.0]
 *
 * The printable document already existed, but only as a dialog inside the cashier's console,
 * reachable only from the day's transaction list. Three things followed from that, and all three
 * are what this file holds:
 *
 *  * A receipt had no ADDRESS. "Send me a copy of RCT-…", asked weeks later by a patient holding a
 *    printed slip, had no answer — there was nothing to open and nothing to link to.
 *  * Admin and SuperAdmin could read receipt NUMBERS on the oversight screen and could not open
 *    one, so every such request had to be handed to a cashier.
 *  * A patient could not print the receipt for money they had paid, which is the document an HMO
 *    or an employer asks them to produce.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

/** Any issued receipt in a wide range, so this never depends on today having takings. */
async function anyReceipt(ctx, token) {
  const res = await ctx.get(`${API}/payments/transactions`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { startDate: '2000-01-01', endDate: '2100-01-01', limit: 50 },
  });
  const rows = (await res.json()).data.transactions || [];
  return rows.find((r) => r.receipt_number) || null;
}

test.describe('Receipt lookup and printing', () => {
  test('a receipt is readable by billing staff, refused to a technician, 404 when it does not exist', async () => {
    const ctx = await request.newContext();
    const cashier = await login(ctx, 'cashier@enlogada.com');
    const t = await anyReceipt(ctx, cashier);
    test.skip(!t, 'Need at least one issued receipt — run seedDemoScenario.js.');

    for (const email of ['cashier@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com']) {
      const res = await ctx.get(`${API}/payments/receipt/${t.receipt_number}`, {
        headers: { Authorization: `Bearer ${await login(ctx, email)}` },
      });
      expect(res.status(), `${email} should be able to open a receipt`).toBe(200);

      // A receipt is not one row: the payment carries the money, the bill carries the lines that
      // explain it. Rendering the document needs both in one load.
      const { payment, bill } = (await res.json()).data;
      expect(payment.receipt_number).toBe(t.receipt_number);
      expect(bill, 'the itemised bill must come with it').toBeTruthy();
    }

    // Looking up a receipt is billing:read, which a modality technician does not hold.
    const lab = await login(ctx, 'lab@enlogada.com');
    expect((await ctx.get(`${API}/payments/receipt/${t.receipt_number}`, {
      headers: { Authorization: `Bearer ${lab}` },
    })).status()).toBe(403);

    expect((await ctx.get(`${API}/payments/receipt/${t.receipt_number}`)).status()).toBe(401);
    expect((await ctx.get(`${API}/payments/receipt/RCT-00000000-9999`, {
      headers: { Authorization: `Bearer ${cashier}` },
    })).status()).toBe(404);

    await ctx.dispose();
  });

  test('a patient may print their own receipt and nobody else\'s', async () => {
    const ctx = await request.newContext();
    const client = await login(ctx, 'client@enlogada.com');
    const cashier = await login(ctx, 'cashier@enlogada.com');

    const bookings = (await (await ctx.get(`${API}/appointments/my-bookings`, {
      headers: { Authorization: `Bearer ${client}` },
    })).json()).data.bookings || [];
    const paid = bookings.find((b) => b.is_paid && b.receipt_number);
    test.skip(!paid, 'Need a paid client booking carrying a receipt.');

    // Their own: the whole point of issuing a receipt.
    expect((await ctx.get(`${API}/payments/receipt/${paid.receipt_number}`, {
      headers: { Authorization: `Bearer ${client}` },
    })).status(), 'a patient must be able to open their own receipt').toBe(200);

    // Someone else's: the boundary that makes the above safe to offer.
    const other = await anyReceipt(ctx, cashier);
    if (other && other.receipt_number !== paid.receipt_number) {
      expect((await ctx.get(`${API}/payments/receipt/${other.receipt_number}`, {
        headers: { Authorization: `Bearer ${client}` },
      })).status(), "a patient must not read another patient's receipt").toBe(403);
    }

    await ctx.dispose();
  });

  test('the transaction log can be searched by receipt number and by patient', async () => {
    const ctx = await request.newContext();
    const cashier = await login(ctx, 'cashier@enlogada.com');
    const t = await anyReceipt(ctx, cashier);
    test.skip(!t, 'Need at least one issued receipt.');

    const range = { startDate: '2000-01-01', endDate: '2100-01-01', limit: 50 };
    const find = async (term) => {
      const res = await ctx.get(`${API}/payments/transactions`, {
        headers: { Authorization: `Bearer ${cashier}` },
        params: { ...range, search: term },
      });
      expect(res.status()).toBe(200);
      return await res.json();
    };

    const byNumber = await find(t.receipt_number);
    expect(byNumber.data.transactions.length, 'the receipt number must find its own receipt').toBeGreaterThan(0);
    expect(byNumber.data.transactions.some((r) => r.receipt_number === t.receipt_number)).toBeTruthy();

    const bySurname = await find(t.patient_last_name);
    expect(bySurname.data.transactions.length, 'a surname must find that patient').toBeGreaterThan(0);

    // The summary is the day's cash position, NOT a description of the filtered rows. If searching
    // narrowed it, the totals would move as somebody typed — the fastest way to make a money
    // figure untrustworthy.
    const unfiltered = await find('');
    expect(
      Number(bySurname.data.summary.collected),
      'searching must not change what the drawer took'
    ).toBeCloseTo(Number(unfiltered.data.summary.collected), 2);

    await ctx.dispose();
  });

  test('a receipt opens at its own URL, renders, and is printable', async ({ page }) => {
    const ctx = await request.newContext();
    const cashier = await login(ctx, 'cashier@enlogada.com');
    const t = await anyReceipt(ctx, cashier);
    test.skip(!t, 'Need at least one issued receipt.');
    await ctx.dispose();

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await signIn(page, 'cashier@enlogada.com');

    // The deep link — the same URL the Open buttons put in a new tab. Reached directly here,
    // which is the case that matters: a link pasted to a colleague has none of this app's state.
    await page.goto(`/?receipt=${encodeURIComponent(t.receipt_number)}`);

    // A real document, not a placeholder: the clinic's name, the receipt number, and an amount.
    await expect(page.getByText(t.receipt_number).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/ENLOGADA/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled();

    // The print rule reveals `.print-area` and hides everything else, so the document must BE the
    // print area — otherwise the printer produces a blank page.
    await expect(page.locator('.print-area')).toHaveCount(1);
    // And the toolbar must be excluded, or the Print button prints itself — the defect the
    // receipt component's own history records.
    await expect(page.locator('.no-print').first()).toBeVisible();

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
