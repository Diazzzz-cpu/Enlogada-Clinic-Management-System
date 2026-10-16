// @ts-check
import { test, expect, request } from 'playwright/test';
import { registerClient } from './helpers/accounts.js';

// Changing a password must end sessions that predate it.
//
// "Reset the password" is the standard response to a stolen session, and it used to do nothing to
// the attacker. The token lives in localStorage, so XSS, a shared reception workstation or a
// token captured from a log is enough to lift one; there is no server-side logout; and
// verifyToken checked only the signature, the account's existence and its status. A lifted token
// kept full access to patient records until it expired on its own — which the deployed config set
// to seven days.
//
// Uses a throwaway registered client rather than a seeded account: this spec changes a password,
// and a failure partway through must not leave a seeded login broken for everything else.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

test.describe('Password change ends older sessions', () => {
  let apiContext;
  let email;
  const firstPassword = 'TestPass123!';
  const secondPassword = 'TestPass456!';

  const login = async (password) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
    return { status: res.status(), token: (await res.json()).data?.token };
  };
  const whoAmI = async (token) =>
    (await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status();

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    email = `revoke_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
    await registerClient(apiContext, {
      firstName: 'Isagani', lastName: 'Cadiz', email, password: firstPassword, contactNumber: '09170000000',
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a session opened before the change is rejected, and the one that changed it survives', async () => {
    // Two live sessions for the same account: the user's own, and a copy on another device.
    const own = (await login(firstPassword)).token;
    const otherDevice = (await login(firstPassword)).token;
    expect(await whoAmI(own)).toBe(200);
    expect(await whoAmI(otherDevice)).toBe(200);

    // A JWT's `iat` is whole seconds while password_changed_at carries milliseconds, so the
    // check allows one second of slack — without it, the replacement token issued moments after
    // the change would reject itself. Tokens therefore have to be more than a second old for
    // this assertion to mean anything; a genuinely stolen token is minutes or hours old.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const changed = await apiContext.put(`${API}/auth/change-password`, {
      headers: { Authorization: `Bearer ${own}` },
      data: { currentPassword: firstPassword, newPassword: secondPassword },
    });
    expect(changed.status()).toBe(200);
    const replacement = (await changed.json()).data?.token;
    expect(replacement, 'the change must hand back a replacement token').toBeTruthy();

    // The point of the whole exercise.
    expect(await whoAmI(otherDevice), 'the other device must be signed out').toBe(401);
    expect(await whoAmI(own), 'the pre-change token must be signed out too').toBe(401);

    // ...without logging out the person who just changed their own password.
    expect(await whoAmI(replacement), 'the replacement token must still work').toBe(200);
  });

  test('the old password no longer works and the new one does', async () => {
    expect((await login(firstPassword)).status).toBe(401);
    const fresh = await login(secondPassword);
    expect(fresh.status).toBe(200);
    expect(await whoAmI(fresh.token)).toBe(200);
  });
});
