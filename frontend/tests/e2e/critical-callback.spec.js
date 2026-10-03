// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * A critical result's phone call can be RECORDED, from the screen that counts it. [1.74.0]
 *
 * The callback log has existed at the API since [1.15.0] — `POST /results/:id/acknowledge-critical`,
 * audited, 409 on a second attempt — and the Critical Callbacks tile has counted the calls still
 * owed since [1.28.0]. The dialog behind the tile told staff to "record the call". Nothing on
 * screen called the route, so the list only ever grew: a call that was made could not be written
 * down, and one that was never made looked exactly like it.
 *
 * result-versioning.spec.js covers the route itself. This covers the half that was missing: a
 * technician doing it from the worklist, with the note they typed reaching the record.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const NOTE = 'Spoke to the patient, advised to go to the ER now';

test.describe('Recording a critical-result callback', () => {
  let ctx;
  let lab;
  let reception;
  let visitTestId;
  const person = fixturePerson();

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    lab = await login('lab@enlogada.com');
    reception = await login('receptionist@enlogada.com');

    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1979-03-02', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;

    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e critical callback' },
    })).json()).data.visit;

    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    const attached = await (await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: [labTest.id] },
    })).json();
    visitTestId = attached.data.visitTests[0].id;

    const paid = await payAndReleaseWalkIn(ctx, API, visit.id);
    expect(paid.status, 'the ticket must reach the lab before findings can be recorded').toBe(201);

    // Findings flagged critical, then released: the state the tile counts.
    const recorded = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { findings: 'Potassium 7.2 mmol/L. CRITICALLY HIGH.', remarks: 'Repeat sample confirms', isCritical: 'true', file: reportPart('critical') },
    });
    expect(recorded.status()).toBe(201);
    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('the lab records the call from the worklist, and it leaves the list', async ({ page }) => {
    await signIn(page, 'lab@enlogada.com');
    await page.getByRole('button', { name: 'Laboratory Worklist', exact: true }).first().click();
    await page.getByRole('button', { name: /Critical Callbacks/ }).click({ timeout: 20000 });

    const row = page.locator(`[data-testid="critical-callback"][data-visit-test-id="${visitTestId}"]`);
    await expect(row).toContainText(person.fullName, { timeout: 20000 });

    await row.getByRole('textbox').fill(NOTE);
    await row.getByRole('button', { name: 'Record the call' }).click();

    // Named, because the list can hold several patients and "Saved" would not say whose call it was.
    await expect(page.getByText(`Call recorded for ${person.fullName}`)).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('the call is on record with its note, and cannot be recorded twice', async () => {
    const outstanding = (await (await ctx.get(`${API}/results/critical/outstanding`, { headers: auth(lab) })).json())
      .data.outstanding;
    expect(outstanding.some((c) => c.visit_test_id === visitTestId), 'still listed as owed').toBe(false);

    const result = (await (await ctx.get(`${API}/results/${visitTestId}`, { headers: auth(lab) })).json()).data.result;
    expect(result.critical_acknowledged_at, 'no time recorded for the call').toBeTruthy();
    expect(result.critical_acknowledgement_note).toBe(NOTE);

    // Reception holds the same permission; a second record would make it ambiguous when contact
    // actually happened.
    const again = await ctx.post(`${API}/results/${visitTestId}/acknowledge-critical`, {
      headers: auth(reception),
      data: { note: 'duplicate' },
    });
    expect(again.status()).toBe(409);
  });
});
