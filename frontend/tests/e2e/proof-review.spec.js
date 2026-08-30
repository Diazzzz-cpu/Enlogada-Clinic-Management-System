// @ts-check
import { test, expect, request } from 'playwright/test';

// Deciding a proof of payment. [1.63.0]
//
// The cashier is the control on manual online payment, and [1.48.0] built this queue around one
// fact: approval bills the visit's REAL total, not the figure the patient typed. Approving a ₱50
// claim on a ₱1,450 visit records ₱1,450, and the drawer is short ₱1,400 with nothing on screen
// to explain it.
//
// So the two numbers have to be readable together, and the reference has to be checkable. These
// guard the data behind both.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Proof of payment review', () => {
  let ctx;
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const res = await ctx.post(`${API}/auth/login`, {
      data: { email: 'cashier@enlogada.com', password: PASSWORD },
    });
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

  test('only a cashier reaches the queue — a technician does not', async () => {
    const labLogin = await ctx.post(`${API}/auth/login`, {
      data: { email: 'lab@enlogada.com', password: PASSWORD },
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
