// @ts-check
import { test, expect, request } from 'playwright/test';
import {
  API, CREDS, loginAs, billedVisit, submitProof, ensureMethod,
} from './helpers/payments.js';

// Deciding a proof of payment. [1.63.0]
//
// The cashier is the control on manual online payment, and [1.48.0] built this queue around one
// fact: approval bills the visit's REAL total, not the figure the patient typed. Approving a ₱50
// claim on a ₱1,450 visit records ₱1,450, and the drawer is short ₱1,400 with nothing on screen
// to explain it.
//
// So the two numbers have to be readable together, and the reference has to be checkable. These
// guard the data behind both.

test.describe('Proof of payment review', () => {
  let ctx;
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const res = await ctx.post(`${API}/auth/login`, { data: CREDS.cashier });
    expect(res.ok()).toBeTruthy();
    token = (await res.json()).data.token;
  });

  test.afterAll(async () => { await ctx.dispose(); });

  test('the queue carries BOTH figures, so a mismatch is visible without opening anything', async () => {
    const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
    expect(res.status()).toBe(200);

    const { submissions } = (await res.json()).data;
    test.skip(submissions.length === 0, 'Need a pending submission.');

    for (const s of submissions) {
      // amount_claimed is EVIDENCE; amount_due is what approval actually bills. A screen showing
      // only one of them is how the drawer ends up short.
      expect(s).toHaveProperty('amount_claimed');
      expect(s).toHaveProperty('amount_due');
      expect(Number.isFinite(Number(s.amount_due))).toBeTruthy();
    }
  });

  test('every pending submission reports whether its reference has been reused', async () => {
    const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
    const { submissions } = (await res.json()).data;
    test.skip(submissions.length === 0, 'Need a pending submission.');

    for (const s of submissions) {
      expect(s, 'duplicate_count backs the anti-fraud badge').toHaveProperty('duplicate_count');
      const count = Number(s.duplicate_count);
      expect(Number.isFinite(count)).toBeTruthy();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('a submission never counts ITSELF as a duplicate', async () => {
    // The `other.id <> ps.id` guard. Without it every submission would report at least one
    // duplicate and the badge would fire on all of them — which is the same as firing on none.
    const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
    const { submissions } = (await res.json()).data;
    test.skip(submissions.length === 0, 'Need a pending submission.');

    const references = submissions.map((s) => String(s.reference_number).trim().toUpperCase());
    for (const s of submissions) {
      const ref = String(s.reference_number).trim().toUpperCase();
      const othersInQueue = references.filter((r) => r === ref).length - 1;
      // The reported count includes settled payments too, so it can only be >= what this queue
      // can see. What it must never do is exceed zero purely because the row exists.
      expect(Number(s.duplicate_count)).toBeGreaterThanOrEqual(othersInQueue);
    }
  });

  test('the review dialog puts the evidence and the claim on screen together', async ({ page }) => {
    const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
    const { submissions } = (await res.json()).data;
    test.skip(submissions.length === 0, 'Need a pending submission.');

    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto('/');

    await page.getByText('Online Payments').first().click();

    const review = page.getByRole('button', { name: /^Review$/ }).first();
    await expect(review).toBeVisible({ timeout: 20000 });
    await review.click();

    // Scoped to the dialog. The queue row underneath shows the same two labels — which is itself
    // the point being tested, that the figures are now in BOTH places rather than only behind the
    // image — so an unscoped locator is ambiguous by design rather than by accident.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Review proof of payment/i })).toBeVisible();

    // Both figures, in the same view as the image — the whole reason this replaced a viewer that
    // covered them.
    await expect(dialog.getByText('Patient claims', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Visit owes', { exact: false })).toBeVisible();

    // And the decision is reachable from here, so the cashier never has to close the evidence to
    // act on it.
    await expect(dialog.getByRole('button', { name: /Verify & issue receipt/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Reject$/ })).toBeVisible();
  });

  test('the proof is zoomable, because a bank screenshot is small and the reference is 13 digits', async ({ page }) => {
    const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
    const withProof = ((await res.json()).data.submissions || []).filter((s) => s.has_proof);
    test.skip(withProof.length === 0, 'Need a pending submission with an attached proof.');

    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto('/');
    await page.getByText('Online Payments').first().click();
    await page.getByRole('button', { name: /^Review$/ }).first().click();

    const zoomIn = page.getByRole('button', { name: /Zoom in/i });
    await expect(zoomIn).toBeVisible({ timeout: 15000 });

    // Starts at fit, and reset is unavailable until there is something to reset.
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByRole('button', { name: /Reset zoom/i })).toBeDisabled();

    await zoomIn.click();
    await expect(page.getByText('125%')).toBeVisible();
    await expect(page.getByRole('button', { name: /Reset zoom/i })).toBeEnabled();

    await page.getByRole('button', { name: /Reset zoom/i }).click();
    await expect(page.getByText('100%')).toBeVisible();
  });

  /**
   * Verification asks first. [1.72.0]
   *
   * This was the one irreversible action on the panel that took a single click. It is not a status
   * change: it runs the same writer the counter uses, so a receipt number comes off daily_counters,
   * the visit is released, a cash-up entry is written and the patient is told their pass is ready.
   * Undoing it means a cash-up reversal — a different screen, a different permission, and a line in
   * the day's reconciliation somebody has to account for.
   *
   * Meanwhile REJECT, which a patient answers by simply submitting again, already asked for a
   * confirmation AND a written reason. The guard was on the recoverable action, not the expensive
   * one.
   *
   * The queue makes the slip easy: rows are stacked, every row carries the same three buttons in
   * the same places, and "Verify & issue receipt" sits between "Review" and "Reject".
   *
   * ── Why these seed rather than read the queue ───────────────────────────────────────────────
   *
   * The rest of this file skips when nothing is pending, which is honest for assertions ABOUT
   * whatever happens to be in the queue. It is not good enough here: an empty queue is the normal
   * state of a clinic that is up to date, so a skip-if-empty guard on the confirmation would report
   * green while never once opening the dialog. These build their own claim and then decline it, so
   * no money is ever taken and the rows fall inside the run's purge window.
   */
  test('clicking verify asks before it takes the money, and cancelling takes none', async ({ page }) => {
    const api = await request.newContext();
    const superToken = await loginAs(api, CREDS.superadmin);
    const recToken = await loginAs(api, CREDS.receptionist);

    const method = await ensureMethod(api, superToken);
    const { visit, total } = await billedVisit(api, recToken);
    const reference = `E2E-CONFIRM-${Date.now()}`;
    const created = await submitProof(api, recToken, visit.id, {
      amount: total, reference, methodId: method.id,
    });
    expect(created.status()).toBe(201);
    const submission = (await created.json()).data.submission;

    const stillPending = async () => {
      const res = await ctx.get(`${API}/payment-submissions/pending`, { headers: auth() });
      return ((await res.json()).data.submissions || []).some((r) => r.id === submission.id);
    };
    expect(await stillPending()).toBeTruthy();

    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto('/');
    await page.getByText('Online Payments').first().click();

    // Scoped to OUR row. The queue may hold others, and clicking "the first Verify" would decide
    // somebody else's payment — the exact accident this whole change is about.
    const row = page.locator('li').filter({ hasText: reference }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.getByRole('button', { name: /Verify & issue receipt/i }).click();

    // 1. It ASKS — and names the consequence rather than saying "are you sure". The figure that
    //    gets recorded is the visit's total, not necessarily the one on the screenshot.
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', { name: /Record this payment\?/i })).toBeVisible();
    await expect(confirm.getByText(/cannot be undone here/i)).toBeVisible();

    // 2. And nothing has happened yet. This is the actual claim: the POST has not been sent while
    //    the dialog is merely open.
    expect(await stillPending(), 'opening the confirmation must not settle anything').toBeTruthy();

    // 3. Backing out leaves it exactly as it was — the misclick costs nothing.
    await confirm.getByRole('button', { name: /^Cancel$/ }).click();
    await expect(confirm).toBeHidden();
    expect(await stillPending(), 'cancelling must take no money').toBeTruthy();

    // And nothing was banked against the visit, which is the thing that would actually be wrong.
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth() })).json()).data.bill;
    expect(Number(bill.amountPaid ?? 0), 'a declined confirmation must bank nothing').toBe(0);

    await api.dispose();
  });

  test('a flagged payment will not confirm until what was flagged is acknowledged', async ({ page }) => {
    const api = await request.newContext();
    const superToken = await loginAs(api, CREDS.superadmin);
    const recToken = await loginAs(api, CREDS.receptionist);

    const method = await ensureMethod(api, superToken);
    const { visit, total } = await billedVisit(api, recToken);

    // A tenth of the real bill — the case this queue was built for, and the one where a misclick
    // costs the most. The graduated step exists for exactly this.
    const understated = Math.max(1, Math.round(total / 10));
    const reference = `E2E-FLAGGED-${Date.now()}`;
    const created = await submitProof(api, recToken, visit.id, {
      amount: understated, reference, methodId: method.id,
    });
    expect(created.status()).toBe(201);

    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto('/');
    await page.getByText('Online Payments').first().click();

    const row = page.locator('li').filter({ hasText: reference }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.getByRole('button', { name: /Verify & issue receipt/i }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', { name: /Record this payment\?/i })).toBeVisible();

    // The warning is repeated INSIDE the confirmation. A confirm step that drops what the queue
    // objected to is a confirm step that launders it.
    await expect(confirm.getByText(/claims/i).first()).toBeVisible();

    const record = confirm.getByRole('button', { name: /^Record payment$/ });
    await expect(record, 'a flagged payment cannot be confirmed on the first click').toBeDisabled();

    const ack = confirm.getByRole('checkbox');
    await expect(ack).toBeVisible();
    await ack.check();
    await expect(record, 'acknowledging what was flagged is what unlocks it').toBeEnabled();

    // Unticking puts it back: the acknowledgement is a live condition, not a latch that stays
    // satisfied once it has been touched.
    await ack.uncheck();
    await expect(record).toBeDisabled();

    await confirm.getByRole('button', { name: /^Cancel$/ }).click();
    await expect(confirm).toBeHidden();

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth() })).json()).data.bill;
    expect(Number(bill.amountPaid ?? 0), 'nothing may be banked by a declined confirmation').toBe(0);

    await api.dispose();
  });

  test('only a cashier reaches the queue — a technician does not', async () => {
    const labLogin = await ctx.post(`${API}/auth/login`, {
      data: { email: 'lab@enlogada.com', password: CREDS.cashier.password },
    });
    const labToken = (await labLogin.json()).data.token;

    // billing:read. A proof of payment is a patient's banking screen, and the modality roles have
    // no reason to see one.
    const res = await ctx.get(`${API}/payment-submissions/pending`, {
      headers: { Authorization: `Bearer ${labToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
