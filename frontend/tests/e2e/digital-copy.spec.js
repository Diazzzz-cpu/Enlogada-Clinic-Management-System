// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { pdfReport } from './helpers/reportFile.js';
import { PNG } from './helpers/payments.js';
import { docxReport, MIME } from './helpers/officeFiles.js';

/**
 * A patient's copy is a DIGITAL COPY; the clinic keeps the original. [1.114.0]
 *
 * What reaches a patient in the portal or by email is the clinic's report marked DIGITAL COPY on
 * every page, with a line saying the original, with the official seal, is at the clinic. The staff
 * side is served the original, untouched, because that is what the clinic prints and seals. The
 * point is forgery: nothing a patient can save should pass for the clinic's document.
 *
 * What the marks look like is checked in the backend unit tests and by eye; these hold who gets
 * which file, and that a file which cannot be marked is refused rather than handed over as it is.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Digital copy for the patient, original for the clinic', () => {
  let ctx;
  let client, lab, reception, cashier;
  /** visit_test ids: a PDF report, an image report, a Word report. */
  let pdfId, imageId, wordId;
  const pdf = pdfReport('digital copy');

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const attachAndRelease = async (visitTestId, file) => {
    const saved = await ctx.post(`${API}/results/${visitTestId}`, { headers: auth(lab), multipart: { file } });
    expect(saved.status(), await saved.text()).toBe(201);
    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status(), await released.text()).toBe(200);
  };
  const fileAs = (token, visitTestId) => ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(token) });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [client, lab, reception, cashier] = await Promise.all(
      ['client@enlogada.com', 'lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com'].map(login)
    );

    // The seeded client's own patient, so the patient's side of each file can be fetched.
    const profile = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json())
      .data.patients[0];
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: profile.id, visitType: 'Walk in', notes: 'digital copy spec' },
    })).json()).data.visit;
    const labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active)
      .slice(0, 3);
    expect(labTests.length, 'need three active laboratory tests').toBe(3);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: labTests.map((t) => t.id) },
    });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    [pdfId, imageId, wordId] = ((await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests || []).map((vt) => vt.id);

    await attachAndRelease(pdfId, { name: 'CBC report.pdf', mimeType: 'application/pdf', buffer: pdf });
    await attachAndRelease(imageId, { name: 'Urinalysis scan.png', mimeType: 'image/png', buffer: PNG });
    await attachAndRelease(wordId, { name: 'Lipid report.docx', mimeType: MIME.docx, buffer: docxReport() });
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('the clinic is served the original, byte for byte', async () => {
    const res = await fileAs(lab, pdfId);
    expect(res.status()).toBe(200);
    expect(Buffer.compare(await res.body(), pdf), 'the staff side is never marked').toBe(0);
    expect(res.headers()['content-disposition']).toContain('CBC report.pdf');
  });

  test('the patient is served a marked copy, named as one', async () => {
    const res = await fileAs(client, pdfId);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect(res.headers()['content-disposition']).toContain('CBC report (Digital Copy).pdf');

    const body = await res.body();
    expect(body.subarray(0, 5).toString('latin1'), 'still a PDF').toBe('%PDF-');
    expect(Buffer.compare(body, pdf), 'never the original').not.toBe(0);
    expect(body.length, 'the marks add to the file').toBeGreaterThan(pdf.length);
  });

  test('an image report reaches the patient as a marked PDF', async () => {
    const res = await fileAs(client, imageId);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'], 'a patient copy is always a PDF').toContain('application/pdf');
    expect(res.headers()['content-disposition']).toContain('Urinalysis scan (Digital Copy).pdf');
  });

  test('a Word report is never handed to the patient unmarked', async () => {
    const res = await fileAs(client, wordId);
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('visit the clinic');

    const staff = await fileAs(lab, wordId);
    expect(staff.status(), 'the clinic still opens its own document').toBe(200);
  });

  test('nor emailed: the person pressing Send is told why', async () => {
    const res = await ctx.post(`${API}/results/${wordId}/email`, { headers: auth(lab) });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('cannot be marked DIGITAL COPY');
  });

  test('the portal labels the copy and explains a refusal', async ({ page }) => {
    await signIn(page, 'client@enlogada.com');
    await openPortalTab(page, 'results');

    const row = (id) => page.locator('li').filter({ hasText: `REQ-${id}` });

    // The summary says it is a copy, and offers no "official" print of it.
    await row(pdfId).getByRole('button', { name: 'View report' }).click({ timeout: 20000 });
    const summary = page.getByRole('dialog').last();
    await expect(summary.getByTestId('digital-copy-note')).toContainText('DIGITAL COPY');
    await expect(summary.getByRole('button', { name: /official/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The Word report: the viewer shows the server's reason, not a generic failure.
    await row(wordId).getByRole('button', { name: 'View report' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'View Report' }).click();
    await expect(page.getByRole('dialog').last()).toContainText('visit the clinic', { timeout: 15000 });
  });
});
