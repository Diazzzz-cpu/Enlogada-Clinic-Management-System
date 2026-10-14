// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson } from './helpers/people.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * Patient Records holds the FINAL record, and only for those who may read it. [1.108.0]
 *
 * The screen listed every test a patient had ever been given, "Pending" ones included, in a dialog
 * behind a button the front desk could press and get a 403 from. Now:
 *
 *   - a record is an AUTHORISED report. A result saved and not yet released is a draft; the old
 *     roster counted drafts as released, because it read `released_at`, which is stamped at save;
 *   - the front desk and the till see who a patient is and when they were here, and are sent no
 *     result counts at all;
 *   - opening a record, printing a report and saving one are each written to the Activity Log.
 *
 * One patient, two laboratory tests: one released, one recorded and waiting for release.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Patient Records: final results only', () => {
  let ctx;
  let admin, superAdmin, reception, cashier, lab, xray;
  let patient;
  let released, draft;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const records = (token) => ctx.get(`${API}/results/history/${patient.id}`, {
    headers: auth(token), params: { released: 'true' },
  });
  const rosterRow = async (token) => {
    const res = await ctx.get(`${API}/patients/search`, {
      headers: auth(token), params: { q: patient.last_name, limit: 50 },
    });
    expect(res.status()).toBe(200);
    return (await res.json()).data.patients.find((p) => p.id === patient.id);
  };
  const activitySince = async (before) => {
    const res = await ctx.get(`${API}/admin/activity?limit=50`, { headers: auth(superAdmin) });
    return ((await res.json()).data.entries || []).filter((e) => e.id > before);
  };
  const latestActivityId = async () => {
    const res = await ctx.get(`${API}/admin/activity?limit=1`, { headers: auth(superAdmin) });
    const [latest] = (await res.json()).data.entries || [];
    return latest ? latest.id : 0;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [admin, superAdmin, reception, cashier, lab, xray] = await Promise.all([
      'clinicadmin@enlogada.com', 'admin@enlogada.com', 'receptionist@enlogada.com',
      'cashier@enlogada.com', 'lab@enlogada.com', 'xray@enlogada.com',
    ].map(login));

    const created = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(),
        birthdate: '1988-05-14', sex: 'Female', contactNumber: '09000000000',
      },
    });
    expect(created.status()).toBe(201);
    patient = (await created.json()).data.patient;

    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: 'Patient records spec' },
    })).json()).data.visit;
    const labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active)
      .slice(0, 2);
    expect(labTests.length, 'need two active laboratory tests').toBe(2);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: labTests.map((t) => t.id) },
    });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);

    const visitTests = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests;
    [released, draft] = visitTests;

    // Both recorded with a report; only the first is released.
    for (const vt of [released, draft]) {
      const saved = await ctx.post(`${API}/results/${vt.id}`, {
        headers: auth(lab), multipart: { file: reportPart(`records ${vt.id}`) },
      });
      expect(saved.status(), await saved.text()).toBe(201);
    }
    const rel = await ctx.post(`${API}/results/${released.id}/release`, { headers: auth(lab) });
    expect(rel.status()).toBe(200);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('the record lists the released result and not the one still waiting', async () => {
    const res = await records(admin);
    expect(res.status()).toBe(200);
    const rows = (await res.json()).data.results;
    expect(rows.map((r) => r.visit_test_id)).toEqual([released.id]);
    expect(rows[0].authorised_at).toBeTruthy();
    expect(rows[0].has_file).toBe(true);

    // The portal's history is untouched: a patient follows both tests' progress.
    const all = (await (await ctx.get(`${API}/results/history/${patient.id}`, { headers: auth(admin) })).json()).data.results;
    expect(all.map((r) => r.visit_test_id).sort()).toEqual([released.id, draft.id].sort());
  });

  test('the roster counts a draft as nothing, because released_at is stamped at save', async () => {
    const row = await rosterRow(admin);
    expect(row, 'the fixture patient is on the roster').toBeTruthy();
    expect(Number(row.released_count)).toBe(1);
    expect(row.last_released_at).toBeTruthy();
  });

  test('the front desk and the till see who the patient is, and no results', async () => {
    for (const [who, token] of [['reception', reception], ['cashier', cashier]]) {
      const row = await rosterRow(token);
      expect(row, `${who} finds the patient`).toBeTruthy();
      expect(row.visit_count, `${who} sees how often they came`).toBeDefined();
      expect(row, `${who} is sent no result count`).not.toHaveProperty('released_count');
      expect(row, `${who} is sent no report date`).not.toHaveProperty('last_released_at');
      expect((await records(token)).status(), `${who} cannot open results`).toBe(403);
      const copy = await ctx.post(`${API}/results/${released.id}/copies`, { headers: auth(token), data: { kind: 'print' } });
      expect(copy.status(), `${who} cannot log a copy of a report`).toBe(403);
    }
  });

  test("a department reads only its own department's results", async () => {
    const rows = (await (await records(xray)).json()).data.results;
    expect(rows, 'X-ray holds none of these laboratory results').toHaveLength(0);
  });

  test('opening, printing and saving a report are each in the Activity Log', async () => {
    const before = await latestActivityId();

    const opened = await ctx.get(`${API}/results/${released.id}/file`, {
      headers: auth(admin), params: { version: 'authorised' },
    });
    expect(opened.status()).toBe(200);
    for (const kind of ['print', 'download']) {
      const res = await ctx.post(`${API}/results/${released.id}/copies`, { headers: auth(admin), data: { kind } });
      expect(res.status(), kind).toBe(204);
    }
    const bogus = await ctx.post(`${API}/results/${released.id}/copies`, { headers: auth(admin), data: { kind: 'fax' } });
    expect(bogus.status()).toBe(400);

    const mine = (await activitySince(before)).filter((e) => String(e.entity_id) === String(patient.id));
    const byAction = Object.fromEntries(mine.map((e) => [e.action, e]));
    expect(Object.keys(byAction)).toEqual(expect.arrayContaining([
      'phi.read.result_file', 'phi.read.result_print', 'phi.read.result_download',
    ]));
    expect(byAction['phi.read.result_file'].description).toMatch(/^Opened the /);
    expect(byAction['phi.read.result_print'].description).toMatch(/^Printed the /);
    expect(byAction['phi.read.result_print'].description).toContain(patient.last_name);
    expect(byAction['phi.read.result_download'].description).toMatch(/^Downloaded the /);
  });

  test('Admin opens a name and sees the released result with View and Print', async ({ page }) => {
    await signIn(page, 'clinicadmin@enlogada.com');
    await page.getByRole('button', { name: 'Patient Records' }).first().click();
    await page.getByLabel('Search patient records').fill(patient.last_name);
    await page.getByRole('button', { name: 'Apply' }).click();

    const row = page.locator(`[data-testid="patient-row"][data-patient-id="${patient.id}"]`);
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toContainText('1 released');

    await row.getByTestId('patient-records-toggle').click();
    const results = page.getByTestId('patient-results');
    await expect(results.getByTestId('patient-result')).toHaveCount(1);
    await expect(results).toContainText(released.test_name);
    await expect(results).not.toContainText(draft.test_name);
    await expect(results.getByRole('button', { name: 'View' })).toBeVisible();
    await expect(results.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.getByText(/Pending|Waiting for Release/)).toHaveCount(0);
  });

  test('the front desk gets the roster without a Results column or a dropdown', async ({ page }) => {
    await signIn(page, 'receptionist@enlogada.com');
    await page.getByRole('button', { name: 'Patient Records' }).first().click();
    await expect(page.getByTestId('patient-row').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('columnheader', { name: 'Visits' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Results' })).toHaveCount(0);
    await expect(page.getByTestId('patient-records-toggle')).toHaveCount(0);
  });
});
