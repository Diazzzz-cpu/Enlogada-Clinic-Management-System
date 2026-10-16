// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { reportPart, pdfReport } from './helpers/reportFile.js';

/**
 * Releasing does not email, and a patient views a released report: no download [1.113.0], no print [1.115.0].
 *
 * Releasing used to email the patient automatically. Not every patient wants a medical report in
 * their inbox, so release now only authorises the report and puts it in the portal; a member of
 * staff emails it when the patient asks, from the panel after release or later from History.
 * And a patient's portal offers View and Print — the clinic sends a copy by email on request.
 *
 * Fixture addresses are never actually mailed (utils/fixtureRecipient.js), so these hold what is
 * OFFERED and what release SAYS it did, not what reached an inbox.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Release, then email only when asked', () => {
  let ctx;
  let lab, reception, cashier, client;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A walk-in WITH an email address, and a paid laboratory test waiting on the worklist. */
  const paidVisit = async (patientId) => {
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId, visitType: 'Walk in', notes: 'release email spec' },
    })).json()).data.visit;
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    await ctx.post(`${API}/tests/visit-tests`, { headers: auth(reception), data: { patientVisitId: visit.id, testIds: [labTest.id] } });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    const vt = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests[0];
    return { visit, visitTestId: vt.id };
  };

  const walkInWithEmail = async () => {
    const person = fixturePerson();
    const res = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...person, email: fixtureEmail(person),
        birthdate: '1980-06-06', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).data.patient;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [lab, reception, cashier, client] = await Promise.all(
      ['lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com', 'client@enlogada.com'].map(login)
    );
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('releasing does not email, says so, and leaves the send to a person', async () => {
    const patient = await walkInWithEmail();
    expect(patient.email, 'the fixture has an address').toBeTruthy();
    const { visitTestId } = await paidVisit(patient.id);

    await ctx.post(`${API}/results/${visitTestId}`, { headers: auth(lab), multipart: { file: reportPart('release email') } });
    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);
    const body = await released.json();
    expect(body.message).toMatch(/has not been emailed/i);
    expect(body.data.result.emailStatus, 'release no longer tries to send').toBeUndefined();
    expect(body.data.result.patientEmail, 'it says where it could be sent').toBe(patient.email);

    const row = ((await (await ctx.get(`${API}/results/released/Laboratory`, { headers: auth(lab), params: { days: 1 } })).json())
      .data.released || []).find((r) => r.visit_test_id === visitTestId);
    expect(row.emailed_at, 'nothing was recorded as sent').toBeNull();
  });

  test('the panel after release offers the email instead of sending it', async ({ page }) => {
    const patient = await walkInWithEmail();
    await paidVisit(patient.id);

    await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    const name = page.getByText(`${patient.first_name} ${patient.last_name}`);
    await expect(name).toBeVisible({ timeout: 15000 });
    await name.locator('xpath=ancestor::tr[1]').getByRole('button', { name: 'Attach Report' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'report.pdf', mimeType: 'application/pdf', buffer: pdfReport('report'),
    });
    await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
    await page.getByRole('button', { name: 'Authorize & Release' }).click();

    const offer = page.getByTestId('release-email');
    await expect(page.getByText('It has not been emailed.', { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(offer).toContainText(patient.email);
    await expect(offer.getByRole('button', { name: 'Email to patient' })).toBeVisible();
  });

  test('a patient views a released report, and is offered neither a download nor a print', async ({ page }) => {
    const profile = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0];
    const { visitTestId } = await paidVisit(profile.id);
    await ctx.post(`${API}/results/${visitTestId}`, { headers: auth(lab), multipart: { file: reportPart('portal view') } });
    expect((await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) })).status()).toBe(200);

    await signIn(page, 'client@enlogada.com');
    await openPortalTab(page, 'results');
    await page.getByRole('button', { name: 'View report' }).first().click({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Download' }), 'no download beside the report').toHaveCount(0);

    await page.getByRole('button', { name: 'View Report' }).first().click();
    const viewer = page.getByRole('dialog', { name: /./ }).last();
    // The report itself, or on a browser with no PDF viewer the one way to read it. [1.115.0]
    await expect(
      viewer.locator('#result-document-frame').or(viewer.getByRole('button', { name: 'Open in new tab' })).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(viewer, 'named as the copy it is').toContainText('Digital copy');
    await expect(viewer.getByRole('button', { name: 'Download' }), 'no download in the viewer').toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Print' }), 'no print in the viewer [1.115.0]').toHaveCount(0);
  });
});
