// @ts-check
import { expect } from 'playwright/test';
import { runScript } from './backendScript.js';

/**
 * Client accounts, made the way a patient makes one: sign up, get a code, enter it. [1.73.0]
 *
 * An account no longer exists until the code emailed at sign-up is entered, and the suite cannot
 * read email — `sendEmail` never mails the @enlogada-e2e.test domain, and the code is stored only
 * as a keyed hash. So each flow asks for its code the normal way, puts a code it KNOWS in its
 * place with backend/src/scripts/e2eAuthCode.js, and finishes through the real endpoint. Only the
 * six digits are borrowed; the ticket, the limits and the account creation are the production path.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;

/** Any six digits would do. This one is easy to spot in a trace. */
export const TEST_CODE = '246810';

/**
 * Replaces the code on a test address's newest open sign-up or reset with `code`.
 * `readyToResend` also moves the last send an hour back, so "Send a new code" is allowed at once.
 */
export function setAuthCode(email, purpose, { code = TEST_CODE, readyToResend = false } = {}) {
  const args = [`--email=${email}`, `--purpose=${purpose}`, `--code=${code}`];
  if (readyToResend) args.push('--ready-to-resend');
  runScript('e2eAuthCode.js', args, 'auth-code');
}

/**
 * A working client account, signed in.
 *
 * @param {import('playwright/test').APIRequestContext} apiContext
 * @param {{ firstName: string, lastName: string, email: string, password: string, contactNumber?: string }} person
 * @returns {Promise<{ token: string, user: any }>}
 */
export async function registerClient(apiContext, { firstName, lastName, email, password, contactNumber = '' }) {
  const started = await apiContext.post(`${API}/auth/register`, {
    data: { firstName, lastName, email, password, contactNumber },
  });
  const startedBody = await started.json().catch(() => ({}));
  expect(started.status(), `sign-up for ${email}: ${startedBody.message || ''}`).toBe(201);

  setAuthCode(email, 'signup');

  const verified = await apiContext.post(`${API}/auth/register/verify`, {
    data: { ticket: startedBody.data.ticket, code: TEST_CODE },
  });
  const verifiedBody = await verified.json().catch(() => ({}));
  expect(verified.status(), `code for ${email}: ${verifiedBody.message || ''}`).toBe(201);

  return { token: verifiedBody.data.token, user: verifiedBody.data.user };
}
