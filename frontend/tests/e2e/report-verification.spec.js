// @ts-check
import { inflateSync } from 'node:zlib';
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { pdfReport } from './helpers/reportFile.js';

/**
 * Anyone can check a report is genuine. [1.126.0]
 *
 * Releasing a report issues it a verification code. The patient's copy carries the code and a QR
 * to `?verify=CODE`, where the page says which clinic issued it, for which test, the patient's
 * initials, when, and whether a correction has replaced it. Never a result: the page is public.
 *
 * What the strip looks like is in the backend unit tests and was checked by eye (and by scanning
 * the QR); these hold the rules: a code per authorised version, an amendment turning the old code
 * into "replaced", nothing private in the answer, and the patient's copy carrying its own code.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** Every stream in a PDF, inflated where it is compressed, so a spec can look inside the copy. */
function pdfStreams(buffer) {
  const text = buffer.toString('latin1');
  const out = [text];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(inflateSync(buffer.subarray(start, end)).toString('latin1'));
    } catch {
      // Not compressed, or not a stream we need: its raw bytes are already in `text`.
    }
  }
  return out.join('\n');
}

test.describe('Report verification', () => {
  let ctx;
  let client, lab, reception, cashier;
  let visitTestId;
  let patient;
  let firstCode;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const attach = async (fields = {}) => {
    const res = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { file: { name: 'CBC report.pdf', mimeType: 'application/pdf', buffer: pdfReport('verification') }, ...fields },
    });
    expect(res.status(), await res.text()).toBe(201);
  };
  const release = async () => {
    const res = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).data.result;
  };
  // Anonymous: the person checking has no account.
  const verify = (code) => ctx.get(`${API}/verify/${encodeURIComponent(code)}`);

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [client, lab, reception, cashier] = await Promise.all(
      ['client@enlogada.com', 'lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com'].map(login)
    );
    patient = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0];
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'verification spec', testIds: [labTest.id] },
    })).json()).data.visit;
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    visitTestId = ((await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests || [])[0].id;

    await attach();
    const released = await release();
    firstCode = released.verificationCode;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('releasing a report issues it a code, and the code checks out', async () => {
    expect(firstCode).toMatch(CODE);
    const res = await verify(firstCode);
    expect(res.status()).toBe(200);
    const { report } = (await res.json()).data;
    expect(report.status).toBe('genuine');
    expect(report.code).toBe(firstCode);
    expect(report.department).toBe('Laboratory');
    const initials = `${patient.first_name} ${patient.last_name}`
      .split(/[\s.]+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ');
    expect(report.patientInitials).toBe(initials);
  });

  test('the answer carries nothing private: no name, no result, no file', async () => {
    const { report } = (await (await verify(firstCode)).json()).data;
    expect(Object.keys(report).sort()).toEqual([
      'clinic', 'clinicPhone', 'code', 'department', 'patientInitials', 'releasedAt',
      'replacedAt', 'status', 'testName', 'version',
    ]);
    expect(JSON.stringify(report)).not.toContain(patient.last_name);
  });

  test('a code is read the way a person types it', async () => {
    const sloppy = firstCode.toLowerCase().replace('-', ' ');
    expect((await verify(sloppy)).status()).toBe(200);
  });

  test('a made-up code is not found, and something that is not a code is refused', async () => {
    const unknown = await verify('00000-00000');
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).message).toContain('call the clinic');
    expect((await verify('not-a-code')).status()).toBe(400);
  });

  test("the patient's copy carries its own code and a link to check it", async () => {
    const res = await ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(client) });
    expect(res.status()).toBe(200);
    const inside = pdfStreams(await res.body());
    expect(inside).toContain(`?verify=${firstCode}`);

    // The clinic's original is untouched [1.114.0]: no code is stamped on what it prints.
    const original = await ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(lab) });
    expect(pdfStreams(await original.body())).not.toContain('?verify=');
  });

  test('a correction gets a new code, and the old one reads as replaced', async () => {
    await attach({ amendmentReason: 'Corrected platelet count' });

    // Until the correction is released, the first report is still the clinic's word.
    expect((await (await verify(firstCode)).json()).data.report.status).toBe('genuine');

    const released = await release();
    const secondCode = released.verificationCode;
    expect(secondCode).toMatch(CODE);
    expect(secondCode).not.toBe(firstCode);

    const old = (await (await verify(firstCode)).json()).data.report;
    expect(old.status).toBe('replaced');
    expect(old.replacedAt).toBeTruthy();

    const current = (await (await verify(secondCode)).json()).data.report;
    expect(current.status).toBe('genuine');
    expect(current.version).toBe(old.version + 1);
  });

  test('the QR lands on a page that says so, signed out', async ({ page }) => {
    await page.goto(`/?verify=${firstCode}`);
    const answer = page.getByTestId('verify-result');
    await expect(answer).toHaveAttribute('data-status', /genuine|replaced/, { timeout: 20000 });
    await expect(answer).toContainText(firstCode);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Verify a report');

    // Typing a code that does not exist says so, in words.
    await page.getByLabel('Verification code').fill('00000-00000');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(answer).toHaveAttribute('data-status', 'not-found');
  });

  test('the footer opens the page with no code', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('button', { name: 'Verify a report' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Verify a report');
    await expect(page.getByTestId('verify-result')).toHaveCount(0);
    await expect(page.getByText('Where to find the code')).toBeVisible();
  });
});
