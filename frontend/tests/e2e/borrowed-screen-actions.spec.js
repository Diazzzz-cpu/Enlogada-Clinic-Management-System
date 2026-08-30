// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * A borrowed screen must not offer actions the borrower cannot perform. [1.53.0]
 *
 * Access is permission-driven, so a screen is reachable by anyone holding the right permission
 * rather than by one named role. That is deliberate and it works — but it means a screen can be
 * legitimately VISIBLE to someone who holds only some of the permissions its controls need.
 *
 * The Active Queue is the case. A Cashier holds `visits:read`, so the queue is genuinely theirs
 * to look at: knowing who is waiting is half of running a till. They do not hold `visits:create`,
 * `tests:assign` or `hmo:request` — and the screen offered all three anyway. Measured, a Cashier
 * was shown "Register Walk-In" and "Attach Tests", and the API answers both with 403.
 *
 * CLAUDE.md states this rule about the sidebar: it must not advertise a screen the API will
 * refuse. This is the same failure one level down, inside a screen the sidebar was right to show.
 *
 * A control that cannot work is worse than a missing one. The person clicks it, gets an error
 * that reads like a fault in the system rather than a boundary, and learns to distrust the screen
 * — including the parts that do work.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

/** The permission each control's own endpoint demands. */
const QUEUE_ACTIONS = [
  { label: /Register Walk-In/, permission: 'visits:create' },
  { label: /Edit Tests/, permission: 'tests:assign' },
];

async function permissionsOf(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.user.permissions || [];
}

test.describe('Borrowed screens offer only what the borrower can do', () => {
  test('the Cashier reads the queue but is offered no action it would be refused', async ({ page }) => {
    const ctx = await request.newContext();
    const held = await permissionsOf(ctx, 'cashier@enlogada.com');
    await ctx.dispose();

    // The premise, asserted rather than assumed: if the Cashier is ever granted these, this test
    // should start expecting the buttons instead of quietly passing for the wrong reason.
    expect(held, 'Cashier must still hold visits:read to reach this screen at all').toContain('visits:read');
    for (const { permission } of QUEUE_ACTIONS) {
      expect(held, `this test assumes Cashier lacks ${permission}`).not.toContain(permission);
    }

    await signIn(page, 'cashier@enlogada.com');
    await page.getByRole('button', { name: 'Active Queue' }).first().click();

    // The queue itself renders — the screen is legitimately theirs.
    await expect(page.getByText(/Active Patient Queue/i).first()).toBeVisible({ timeout: 20000 });

    for (const { label, permission } of QUEUE_ACTIONS) {
      await expect(
        page.getByRole('button', { name: label }),
        `a Cashier lacks ${permission}, so this control must not be offered — clicking it is a 403`
      ).toHaveCount(0);
    }
  });

  test('the Receptionist, whose screen it is, keeps every action', async ({ page }) => {
    const ctx = await request.newContext();
    const held = await permissionsOf(ctx, 'receptionist@enlogada.com');
    await ctx.dispose();

    // The other half of the rule. Hiding a control from the person whose job it is would be a
    // worse bug than showing a dead one, and a gate is one typo away from doing exactly that.
    for (const { permission } of QUEUE_ACTIONS) {
      expect(held, `Receptionist must hold ${permission}`).toContain(permission);
    }

    await signIn(page, 'receptionist@enlogada.com');
    await page.getByRole('button', { name: 'Active Queue' }).first().click();
    await expect(page.getByText(/Active Patient Queue/i).first()).toBeVisible({ timeout: 20000 });

    for (const { label, permission } of QUEUE_ACTIONS) {
      await expect(
        page.getByRole('button', { name: label }).first(),
        `the Receptionist holds ${permission} and must still be offered this`
      ).toBeVisible();
    }
  });

  test('the actions the Cashier is not offered are the ones the API refuses', async () => {
    // Ties the UI gate to the server's actual answer. If someone widens the Cashier's permissions
    // later, the buttons appear AND these stop being 403 — the two move together or this fails.
    const ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'cashier@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const auth = { Authorization: `Bearer ${token}` };

    expect((await ctx.get(`${API}/visits/active`, { headers: auth })).status(),
      'the Cashier must be able to READ the queue').toBe(200);

    expect((await ctx.post(`${API}/visits`, {
      headers: auth, data: { patientId: 1, visitType: 'Walk in' },
    })).status(), 'visits:create').toBe(403);

    expect((await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth, data: { patientVisitId: 1, testIds: [1] },
    })).status(), 'tests:assign').toBe(403);

    await ctx.dispose();
  });
});
