// @ts-check
import { test, expect, request } from 'playwright/test';

// Registering a walk-in in one interaction. [1.26.0]
//
// Reception used to register the patient on one screen and then find that same patient again in
// the queue to attach the tests — two screens for one conversation, at the busiest point of the
// clinic's day. The failure mode is not inconvenience: a visit whose second half never happened
// reaches the cashier as a zero bill, and nothing on any screen says why.
//
// The picker also totals the selection, so the price can be quoted across the desk instead of the
// patient discovering it at the till, and shows preparation while they are still standing there —
// which is a far better moment for "come back fasting" than an email the night before.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test('reception registers a walk-in and attaches tests in one pass', async ({ page }) => {
  test.setTimeout(90000);

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', 'receptionist@enlogada.com');
  await page.fill('input[type="password"]', PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Staff land on Today since [1.77.0].
  await page.getByRole('button', { name: 'Desk', exact: true }).first().click({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });

  // Registration opens in a panel beside the queue since [1.75.0], rather than on a screen of its
  // own. The panel carries the old screen's name.
  await page.getByRole('button', { name: 'Register Walk-In', exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: /walk-in registration/i })).toBeVisible();

  const surname = `Walkin${Date.now()}`;
  // Addressed by placeholder, which is what this form actually exposes — it has no <label for>,
  // so there is no accessible name to target. Worth noting as its own finding.
  // exact, or both of these also match the referring-physician field's "Dr. Juan Dela Cruz".
  await page.getByPlaceholder('Juan', { exact: true }).fill('Onepass');
  await page.getByPlaceholder('Dela Cruz', { exact: true }).fill(surname);
  await page.locator('input[type="date"]:visible').first().fill('1988-05-12');

  // Patient type — Self Pay, so no referring physician is demanded.
  const typeCombo = page.getByRole('combobox').filter({ hasText: /select patient type|patient type/i }).first();
  await typeCombo.click();
  await page.getByRole('option', { name: 'Self Pay', exact: true }).click();

  // The new part: pick tests here rather than on a second screen.
  await expect(page.getByText('Tests Requested')).toBeVisible();
  // "Nothing selected" rather than "No tests selected" since [1.45.0] — the same control now
  // offers the clinic's package deals as well as individual tests, so the empty state has to
  // speak for both.
  await expect(page.getByText('Nothing selected')).toBeVisible();

  // Scoped to the scrolling test list on purpose. The package checkboxes sit ABOVE it in the same
  // form, so an unscoped `first()` would tick Package A — a ₱1,450 bundle — and this test would
  // quietly stop covering the thing it is named after.
  const checkboxes = page.locator('form .overflow-y-auto input[type="checkbox"]:visible');
  await checkboxes.first().check();

  // The running total is what lets reception quote a price at the desk.
  await expect(page.getByText(/1 test selected/)).toBeVisible();
  await expect(page.getByText(/₱\s?[1-9]/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' }).click();

  // The confirmation says both halves happened.
  // Scoped to the panel: the queue behind it has a "Queue Ticket" column header, which would
  // satisfy an unscoped check before anything had been registered.
  await expect(panel.getByText(/Physical Queue Ticket/i)).toBeVisible({ timeout: 20000 });
  await expect(panel.getByText(/test.*attached/i)).toBeVisible({ timeout: 10000 });

  // And the visit really carries them — the bill is what the cashier will see.
  const ctx = await request.newContext();
  const login = await ctx.post(`${API}/auth/login`, {
    data: { email: 'receptionist@enlogada.com', password: PASSWORD },
  });
  const token = (await login.json()).data.token;
  const found = await ctx.get(`${API}/patients/search?q=${surname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const patient = (await found.json()).data.patients[0];
  expect(patient, 'the registered patient should be findable').toBeTruthy();

  const visits = await ctx.get(`${API}/visits/patient/${patient.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const visit = (await visits.json()).data.visits[0];
  const tests = await ctx.get(`${API}/tests/visit-tests/${visit.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await tests.json()).data.visitTests.length).toBeGreaterThan(0);
  await ctx.dispose();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
