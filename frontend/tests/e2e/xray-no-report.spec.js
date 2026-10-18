// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { reportPart } from './helpers/reportFile.js';
import { todayStr } from './helpers/dates.js';
import { openPortalTab } from './helpers/portal.js';

/**
 * X-ray issues no report here. [1.129.0]
 *
 * The clinic's X-ray department gives its results through its own system, so nothing is uploaded,
 * released or emailed for an X-ray in this one. It still queues and bills here, and the clinic
 * still counts its X-ray patients, so the worklist marks an exam DONE instead: the test completes,
 * the visit completes with it, and the reports count it as the department's work for that day.
 *
 * The refusals are on the server, not only on the screen. A hidden button that the API still
 * honours is a report sent to a patient that the department never meant to send.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('X-ray: marked done, never reported here', () => {
  let ctx;
  let reception, cashier, xray, lab, admin, client;
  let xrayTest, labTest;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A paid walk-in carrying `testIds`, so its tests are on their departments' worklists. */
  const paidVisit = async (testIds, patientId = null) => {
    let person = null;
    if (!patientId) {
      person = fixturePerson();
      patientId = (await (await ctx.post(`${API}/patients`, {
        headers: auth(reception),
        data: {
          patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
          ...person, birthdate: '1982-08-08', sex: 'Male', contactNumber: FIXTURE_CONTACT,
        },
      })).json()).data.patient.id;
    }
    const created = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId, visitType: 'Walk in', notes: 'xray spec', testIds },
    });
    expect(created.status(), await created.text()).toBe(201);
    const visit = (await created.json()).data.visit;
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    const lineFor = (testId) => lines.find((l) => l.test_id === testId).id;
    return { person, visit, lineFor };
  };

  const markDone = (token, visitTestId) => ctx.patch(`${API}/results/test-status/${visitTestId}`, {
    headers: auth(token), data: { status: 'Completed' },
  });
  const visitStatus = async (visitId) =>
    (await (await ctx.get(`${API}/visits/${visitId}`, { headers: auth(reception) })).json()).data.visit.status;

  /** X-ray's figures for today: the operations report, Today's turnaround table, and Staff Workload. */
  const xrayFigures = async () => {
    const get = async (path, key) => {
      const res = await ctx.get(`${API}/reports/${path}`, {
        headers: auth(admin), params: { startDate: todayStr(), endDate: todayStr() },
      });
      expect(res.status(), path).toBe(200);
      return (await res.json()).data[key];
    };
    const ops = await get('operations', 'report');
    const analytics = await get('analytics', 'report');
    const workload = await get('staff-workload', 'workload');
    const xr = (rows) => (rows || []).find((r) => r.category_name === 'Xray') || {};
    return {
      done: Number(xr(ops.diagnostics?.byCategory).released || 0),
      turnaround: Number(xr(analytics.turnaroundSla).released || 0),
      workload: (workload.diagnosticWorkload || [])
        .filter((r) => r.category_name === 'Xray')
        .reduce((sum, r) => sum + Number(r.result_count), 0),
    };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier, xray, lab, admin, client] = await Promise.all([
      'receptionist@enlogada.com', 'cashier@enlogada.com', 'xray@enlogada.com',
      'lab@enlogada.com', 'admin@enlogada.com', 'client@enlogada.com',
    ].map(login));
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    xrayTest = tests.find((t) => t.is_active && t.category_name === 'Xray' && Number(t.price) > 0);
    labTest = tests.find((t) => t.is_active && t.category_name === 'Laboratory' && Number(t.price) > 0);
    expect(xrayTest, 'need an active X-ray service').toBeTruthy();
    expect(labTest, 'need an active laboratory service').toBeTruthy();
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('nothing is uploaded, released or emailed for an X-ray; the exam is marked done', async () => {
    const { visit, lineFor } = await paidVisit([xrayTest.id]);
    const line = lineFor(xrayTest.id);

    const upload = await ctx.post(`${API}/results/${line}`, { headers: auth(xray), multipart: { file: reportPart('xray') } });
    expect(upload.status(), 'an upload').toBe(409);
    expect((await upload.json()).message).toMatch(/X-ray department's own system/i);
    expect((await ctx.post(`${API}/results/${line}/release`, { headers: auth(xray) })).status(), 'a release').toBe(409);
    expect((await ctx.post(`${API}/results/${line}/email`, { headers: auth(xray) })).status(), 'an email').toBe(409);

    const before = await xrayFigures();
    const done = await markDone(xray, line);
    expect(done.status(), await done.text()).toBe(200);
    expect(await visitStatus(visit.id), 'its only test done, the visit is over').toBe('Completed');

    // Once. A second "done" is a mistake, not more work.
    expect((await markDone(xray, line)).status()).toBe(409);

    // Counted as the department's work for today, in each report that counts it.
    const after = await xrayFigures();
    expect(after.done, 'Departments: X-ray done today').toBe(before.done + 1);
    expect(after.turnaround, "Today's department table").toBe(before.turnaround + 1);
    expect(after.workload, 'Staff Workload').toBe(before.workload + 1);

    // And on the department's History, with who did it.
    const history = (await (await ctx.get(`${API}/results/released/Xray`, {
      headers: auth(xray), params: { days: 0, limit: 50 },
    })).json()).data.released;
    const row = history.find((r) => r.visit_test_id === line);
    expect(row, 'a done exam is on X-ray History').toBeTruthy();
    expect(row.performed_at).toBeTruthy();
    expect(row.performed_by_first_name).toBeTruthy();
  });

  test('a visit with X-ray and laboratory work ends when both are finished', async () => {
    const { visit, lineFor } = await paidVisit([xrayTest.id, labTest.id]);
    expect((await markDone(xray, lineFor(xrayTest.id))).status()).toBe(200);
    expect(await visitStatus(visit.id), 'the laboratory test is still out').not.toBe('Completed');

    const labLine = lineFor(labTest.id);
    await ctx.post(`${API}/results/${labLine}`, { headers: auth(lab), multipart: { file: reportPart('lab') } });
    expect((await ctx.post(`${API}/results/${labLine}/release`, { headers: auth(lab) })).status()).toBe(200);
    expect(await visitStatus(visit.id)).toBe('Completed');
  });

  // [1.130.0] Patient Records is the final record, and an X-ray done is final with no report. It
  // listed released reports only, so X-rays dropped out of every patient's record.
  test('Patient Records keeps an X-ray done in the final record, and nothing pending', async ({ page }) => {
    const { person, visit, lineFor } = await paidVisit([xrayTest.id, labTest.id]);
    const patientId = visit.patient_id;
    const records = async () => (await (await ctx.get(`${API}/results/history/${patientId}`, {
      headers: auth(admin), params: { released: 'true' },
    })).json()).data.results;

    expect(await records(), 'nothing is final yet').toHaveLength(0);
    expect((await markDone(xray, lineFor(xrayTest.id))).status()).toBe(200);

    const rows = await records();
    expect(rows.map((r) => r.visit_test_id), 'the X-ray, and not the laboratory test still waiting')
      .toEqual([lineFor(xrayTest.id)]);
    expect(rows[0].result_id).toBeNull();
    expect(rows[0].performed_at).toBeTruthy();

    const roster = (await (await ctx.get(`${API}/patients/search`, {
      headers: auth(admin), params: { q: person.fullName, limit: 50 },
    })).json()).data.patients.find((p) => p.id === patientId);
    expect(Number(roster.done_count)).toBe(1);
    expect(Number(roster.released_count), 'released still means reports').toBe(0);

    await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Records');
    await page.getByLabel('Search patient records').fill(person.fullName);
    await page.getByRole('button', { name: 'Apply' }).click();
    const row = page.locator(`[data-testid="patient-row"][data-patient-id="${patientId}"]`);
    await expect(row).toContainText('1 X-ray done', { timeout: 20000 });
    await row.getByTestId('patient-records-toggle').click();
    const done = page.getByTestId('patient-results').locator('[data-final="done"]');
    await expect(done).toContainText(xrayTest.name);
    await expect(done).toContainText('Result given by the X-Ray department');
    await expect(page.getByTestId('patient-results')).not.toContainText(labTest.name);
  });

  test('a department that issues reports is finished by its report, not by a status', async () => {
    const { lineFor } = await paidVisit([labTest.id]);
    const res = await markDone(lab, lineFor(labTest.id));
    expect(res.status(), 'Completed by hand on a laboratory test').toBe(403);
    expect((await res.json()).message).toMatch(/releasing their report/i);
  });

  test('the X-ray worklist marks an exam done, and the patient is told where the result comes from', async ({ page }) => {
    // The seeded client's own profile, so the portal half can be checked on the same visit.
    const profile = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0];
    const { visit, lineFor } = await paidVisit([xrayTest.id], profile.id);
    const line = lineFor(xrayTest.id);
    const fullName = `${profile.first_name} ${profile.last_name}`;

    await signInTo(page, 'xray@enlogada.com', 'X-Ray Worklist');
    await page.getByPlaceholder('Search patient, test, queue...').fill(profile.last_name);
    const row = page.locator('tbody tr', { hasText: fullName }).filter({ hasText: xrayTest.name }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    // No report to attach or release here: the one action is Mark done.
    await expect(row.getByRole('button', { name: /Attach Report|Edit Report|Release/ })).toHaveCount(0);
    await row.getByRole('button', { name: 'Mark done' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Mark this exam done?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Mark done' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });

    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    expect(lines.find((l) => l.id === line)?.status, 'marked done from the screen').toBe('Completed');

    // The patient's portal: no "not released yet" that would wait forever, and no report to open.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signIn(page, 'client@enlogada.com');
    await openPortalTab(page, 'results');
    const item = page.locator('li', { hasText: `REQ-${line}` });
    await expect(item).toBeVisible({ timeout: 20000 });
    await expect(item).toContainText(/Done\. Your X-Ray result is given by the X-Ray department/i);
    await expect(item.getByRole('button', { name: 'View report' })).toHaveCount(0);
  });
});
