// @ts-check
import { expect } from 'playwright/test';

/**
 * Signing in through the browser, in one place. [1.52.0]
 *
 * ── Why this helper exists ──────────────────────────────────────────────────────────────────
 *
 * Six specs carried a byte-identical copy of it, and all six ended the same way:
 *
 *     await expect(page.getByText(/good day|welcome|…/i).first()).toBeVisible();
 *
 * `/welcome/i` matches **"Welcome Back"** — the heading of the LOGIN FORM. So the assertion was
 * satisfied by the page the browser was already looking at, before the login request had been
 * sent, let alone answered. It was not waiting for a session; it was waiting for nothing.
 *
 * That is survivable while the next step happens to be a Playwright locator, because those
 * auto-wait. It stops being survivable the moment a spec does something that does NOT — a
 * `page.goto`, a `page.evaluate`, an API call using the browser's state. Exactly that cost one
 * afternoon on receipt-lookup.spec.js: the deep link navigated a signed-OUT page and the failure
 * pointed at the receipt, which was fine, rather than at the login, which had not happened.
 *
 * ── What replaces it ────────────────────────────────────────────────────────────────────────
 *
 * The stored token. It is written by AuthContext only after `POST /auth/login` returns 200, so it
 * is the one signal on the page that cannot be true early. It is also what the app itself treats
 * as "signed in", which makes this helper agree with the thing it is testing rather than with a
 * piece of copy that a designer may reword at any time.
 */

export const E2E_PASSWORD = 'Password123!';

/** Resolves once the app has actually stored a session — not merely rendered a hopeful heading. */
async function awaitSession(page, email) {
  await expect
    .poll(async () => page.evaluate(() => Boolean(localStorage.getItem('token'))), {
      timeout: 20000,
      message: `signing in as ${email} did not establish a session`,
    })
    .toBe(true);
}

/** Sign in at desktop width. */
export async function signIn(page, email, password = E2E_PASSWORD) {
  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.locator('button[type="submit"]').click();
  await awaitSession(page, email);
}

/**
 * Sign in at phone width.
 *
 * The desktop nav is `display:none` at this width, so its "Sign In" is present in the DOM but
 * unclickable — scoping to the mobile panel is the difference between testing the phone and
 * testing nothing.
 */
export async function signInOnPhone(page, email, password = E2E_PASSWORD) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.locator('header div.md\\:hidden').last();
  await menu.getByRole('button', { name: 'Sign In' }).click();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.locator('button[type="submit"]').click();
  await awaitSession(page, email);
}
