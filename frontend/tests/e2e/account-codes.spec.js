// @ts-check
import { test, expect, request } from 'playwright/test';
import { registerClient, setAuthCode, TEST_CODE } from './helpers/accounts.js';
import { fixturePerson } from './helpers/people.js';

/**
 * Accounts are confirmed with an emailed 6-digit code, and so are password resets. [1.73.0]
 *
 * ── What must stay true ─────────────────────────────────────────────────────────────────────
 *
 *   NO ACCOUNT BEFORE THE CODE   a sign-up is pending until its code is entered, so there is
 *                                nothing under the address to sign in to, or to take over.
 *   A CODE BELONGS TO A TICKET   a code finishes only the attempt that asked for it; a stranger's
 *                                sign-up with your address cannot be finished from your inbox.
 *   FIVE TRIES, ONE USE          and a wrong code is a 400, never a 401 (which the browser treats
 *                                as "you have been signed out").
 *   FORGOT PASSWORD IS SILENT    every address gets the same answer and a ticket that looks the
 *                                same, so it cannot be used to find out who has an account.
 *   A RESET ENDS EVERY SESSION   and clears a sign-in lock, and a code resets a password once —
 *                                even with two requests racing.
 *
 * The code itself is set with helpers/accounts.js setAuthCode, because the suite cannot read the
 * email; everything else here is the production path.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'TestPass123!';
const NEW_PASSWORD = 'TestPass456!';

const address = (tag) => `codes_${tag}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
const hasSession = (page) => page.evaluate(() => Boolean(localStorage.getItem('token')));

test.describe('Sign-up needs the emailed code', () => {
  let api;
  test.beforeAll(async () => {
    api = await request.newContext();
  });
  test.afterAll(async () => {
    await api.dispose();
  });

  const start = (email) =>
    api.post(`${API}/auth/register`, {
      data: { ...fixturePerson(), email, password: PASSWORD, contactNumber: '' },
    });
  const verify = (ticket, code) => api.post(`${API}/auth/register/verify`, { data: { ticket, code } });

  test('starting a sign-up gives a ticket and no session, and there is no account yet', async () => {
    const email = address('pending');
    const res = await start(email);
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(data.token, 'no session before the code').toBeUndefined();

    const login = await api.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(login.status(), 'the account does not exist until the code is entered').toBe(401);
  });

  test('the right code creates the account and signs it in, once', async () => {
    const email = address('verify');
    const { ticket } = (await (await start(email)).json()).data;
    setAuthCode(email, 'signup');

    const ok = await verify(ticket, TEST_CODE);
    expect(ok.status()).toBe(201);
    const { token, user } = (await ok.json()).data;
    expect(user.roles).toEqual(['Client']);
    expect((await api.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);

    expect((await verify(ticket, TEST_CODE)).status(), 'a used code must not make a second account').toBe(400);
  });

  test('five wrong codes use it up, and then even the right one is refused', async () => {
    const email = address('wrong');
    const { ticket } = (await (await start(email)).json()).data;
    setAuthCode(email, 'signup');

    for (let left = 4; left >= 0; left -= 1) {
      const res = await verify(ticket, '000000');
      expect(res.status(), 'a wrong code is a 400, never a 401').toBe(400);
      if (left > 0) expect((await res.json()).message).toContain(`${left} ${left === 1 ? 'try' : 'tries'} left`);
    }
    const right = await verify(ticket, TEST_CODE);
    expect(right.status()).toBe(400);
    expect((await right.json()).message).toMatch(/send a new one/i);
  });

  test('a code finishes only the sign-up that asked for it', async () => {
    // Two sign-ups for one address; the first could be a stranger's. The code set here is on the
    // newest, so it must finish that one and not the other.
    const email = address('ticket');
    const first = (await (await start(email)).json()).data.ticket;
    const second = (await (await start(email)).json()).data.ticket;
    setAuthCode(email, 'signup');

    expect((await verify(first, TEST_CODE)).status()).toBe(400);
    expect((await verify(second, TEST_CODE)).status()).toBe(201);
  });

  test('an address that already has an account is told to sign in, whatever the capitals', async () => {
    const email = address('taken');
    await registerClient(api, { ...fixturePerson(), email, password: PASSWORD });

    const res = await start(email.toUpperCase());
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/sign in/i);
  });

  test('a new code can be sent after the wait, and it replaces the old one', async () => {
    const email = address('resend');
    const { ticket, resendAfterSeconds } = (await (await start(email)).json()).data;
    expect(resendAfterSeconds).toBe(60);

    const early = await api.post(`${API}/auth/codes/resend`, { data: { ticket } });
    expect(early.status()).toBe(200);
    const wait = (await early.json()).data.resendAfterSeconds;
    expect(wait, 'too soon: the answer says how long is left').toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);

    // A known code on the current one, and the cooldown moved out of the way.
    setAuthCode(email, 'signup', { readyToResend: true });
    const resent = await api.post(`${API}/auth/codes/resend`, { data: { ticket } });
    expect((await resent.json()).data.resendAfterSeconds).toBe(60);

    expect((await verify(ticket, TEST_CODE)).status(), 'the resend drew a fresh code').toBe(400);
    setAuthCode(email, 'signup');
    expect((await verify(ticket, TEST_CODE)).status()).toBe(201);
  });

  test('a patient signs up on the card, types the code, and lands signed in', async ({ page }) => {
    const person = fixturePerson();
    const email = address('ui');

    await page.goto('/');
    await page.getByText('Create Account', { exact: true }).first().click();
    await expect(page.locator('form')).toHaveCount(1);

    await page.getByLabel('First Name').fill(person.firstName);
    await page.getByLabel('Last Name').fill(person.lastName);
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm Password').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    setAuthCode(email, 'signup');
    // The sixth digit submits the code by itself.
    await page.getByLabel('Verification code').fill(TEST_CODE);

    await expect.poll(() => hasSession(page), { timeout: 20000 }).toBe(true);
    await expect(page.getByText(/your account is ready/i)).toBeVisible();
  });
});

test.describe('Forgot password is a code, and says nothing about who has an account', () => {
  let api;
  test.beforeAll(async () => {
    api = await request.newContext();
  });
  test.afterAll(async () => {
    await api.dispose();
  });

  const forgot = async (email) => (await api.post(`${API}/auth/forgot-password`, { data: { email } }));
  const reset = (ticket, code, newPassword) =>
    api.post(`${API}/auth/reset-password`, { data: { ticket, code, newPassword } });
  const login = (email, password) => api.post(`${API}/auth/login`, { data: { email, password } });

  test('an unknown address gets exactly the answer a real one does', async () => {
    const real = address('real');
    await registerClient(api, { ...fixturePerson(), email: real, password: PASSWORD });

    const [a, b] = [await forgot(real), await forgot(address('nobody'))];
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(jb.message).toBe(ja.message);
    expect(Object.keys(jb.data).sort()).toEqual(Object.keys(ja.data).sort());
    expect(jb.data.ticket).toMatch(/^[0-9a-f]{64}$/);

    expect((await reset(jb.data.ticket, TEST_CODE, NEW_PASSWORD)).status(), 'and its ticket does nothing').toBe(400);
  });

  test('the code resets the password once, ends older sessions, and only the new password works', async () => {
    const email = address('reset');
    await registerClient(api, { ...fixturePerson(), email, password: PASSWORD });
    const before = (await (await login(email, PASSWORD)).json()).data.token;
    // A JWT's iat is whole seconds; see session-revocation.spec.js for why this wait is needed.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const { ticket } = (await (await forgot(email)).json()).data;
    setAuthCode(email, 'password_reset');

    expect((await reset(ticket, TEST_CODE, 'short')).status(), 'a weak password is refused first').toBe(400);
    expect((await reset(ticket, TEST_CODE, NEW_PASSWORD)).status(), 'and spent none of the tries').toBe(200);

    const me = await api.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${before}` } });
    expect(me.status(), 'the session from before the reset is over').toBe(401);
    expect((await login(email, PASSWORD)).status()).toBe(401);
    expect((await login(email, NEW_PASSWORD)).status()).toBe(200);
    expect((await reset(ticket, TEST_CODE, 'TestPass789!')).status(), 'a code resets a password once').toBe(400);
  });

  test('two requests racing with one code: exactly one changes the password', async () => {
    const email = address('race');
    await registerClient(api, { ...fixturePerson(), email, password: PASSWORD });
    const { ticket } = (await (await forgot(email)).json()).data;
    setAuthCode(email, 'password_reset');

    const results = await Promise.all([
      reset(ticket, TEST_CODE, 'RaceWinner123!'),
      reset(ticket, TEST_CODE, 'RaceWinner456!'),
    ]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 400]);
  });

  test('a reset clears a sign-in lock', async () => {
    const email = address('locked');
    await registerClient(api, { ...fixturePerson(), email, password: PASSWORD });
    for (let i = 0; i < 10; i += 1) await login(email, 'wrong-password');
    expect((await login(email, PASSWORD)).status(), 'locked').toBe(423);

    const { ticket } = (await (await forgot(email)).json()).data;
    setAuthCode(email, 'password_reset');
    expect((await reset(ticket, TEST_CODE, NEW_PASSWORD)).status()).toBe(200);
    expect((await login(email, NEW_PASSWORD)).status(), 'proving the inbox lifts the lock').toBe(200);
  });

  test('on the card: email, code and new password, then Sign In with the address filled in', async ({ page }) => {
    const email = address('card');
    await registerClient(api, { ...fixturePerson(), email, password: PASSWORD });

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.locator('form'), 'the turn has finished').toHaveCount(1);

    await page.getByLabel('Email Address').fill(email);
    await page.locator('form').getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();

    setAuthCode(email, 'password_reset');
    await page.getByLabel('Verification code').fill(TEST_CODE);
    await page.getByLabel('New Password').fill(NEW_PASSWORD);
    await page.getByLabel('Confirm Password').fill(NEW_PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    // The card turns back to Sign In by itself, with the address filled in.
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('form')).toHaveCount(1);
    await expect(page.locator('#login-email')).toHaveValue(email);
    await page.fill('input[type="password"]', NEW_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect.poll(() => hasSession(page), { timeout: 20000 }).toBe(true);
  });

  test('an old emailed reset link opens the forgot card, explains, and leaves the address bar clean', async ({ page }) => {
    await page.goto('/?reset_token=0123abcd');
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByText(/reset links are no longer used/i)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });
});
