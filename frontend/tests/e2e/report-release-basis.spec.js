// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { reportPart } from './helpers/reportFile.js';
import { todayStr } from './helpers/dates.js';

/**
 * "Released" in a report means AUTHORISED, and a test counts once. [1.110.0]
 *
 * Three reports — the Departments throughput, Analytics' turnaround against target and Staff
 * Workload — read `released_at` as the release. It is stamped when a result is SAVED, so a draft
 * nobody had authorised was counted, and every report was timed from when it was typed. They now
 * count a test at its FIRST authorised version: a draft adds nothing, a release adds one, and a
 * correction released later adds an amendment rather than a second patient.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Reports count a release once it is authorised', () => {
  let ctx;
  let admin, lab, reception, cashier;
  let visitTestId;
  const range = () => ({ startDate: todayStr(), endDate: todayStr() });

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** The three figures, for Laboratory, today. */
  const figures = async () => {
    // Each report answers inside its own envelope key: `report`, except Staff Workload's `workload`.
    const get = async (path, key) => {
      const res = await ctx.get(`${API}/reports/${path}`, { headers: auth(admin), params: range() });
      expect(res.status(), path).toBe(200);
      return (await res.json()).data[key];
    };
    const ops = await get('operations', 'report');
    const analytics = await get('analytics', 'report');
    const workload = await get('staff-workload', 'workload');
    const lab = (rows) => (rows || []).find((r) => r.category_name === 'Laboratory') || {};
    const throughput = lab(ops.diagnostics?.byCategory);
    return {
      released: Number(throughput.released || 0),
      amended: Number(throughput.amended || 0),
      turnaround: Number(lab(analytics.turnaroundSla).released || 0),
      workload: (workload.diagnosticWorkload || [])
        .filter((r) => r.category_name === 'Laboratory')
        .reduce((sum, r) => sum + Number(r.result_count), 0),
    };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [admin, lab, reception, cashier] = await Promise.all(
      ['clinicadmin@enlogada.com', 'lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com'].map(login)
    );
    const created = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(), birthdate: '1979-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    });
    const patient = (await created.json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId: patient.id, visitType: 'Walk in', notes: 'report basis spec' },
    })).json()).data.visit;
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception), data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    visitTestId = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests[0].id;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('a draft adds nothing, a release adds one, a correction adds an amendment', async () => {
    const before = await figures();

    const saved = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab), multipart: { file: reportPart('basis draft') },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    expect(await figures(), 'a saved draft is not a release').toEqual(before);

    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);
    const afterRelease = await figures();
    expect(afterRelease.released).toBe(before.released + 1);
    expect(afterRelease.turnaround).toBe(before.turnaround + 1);
    expect(afterRelease.workload).toBe(before.workload + 1);

    const amended = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { file: reportPart('basis correction'), amendmentReason: 'Corrected against the analyser printout' },
    });
    expect(amended.status(), await amended.text()).toBe(201);
    const reReleased = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(reReleased.status()).toBe(200);

    const afterCorrection = await figures();
    expect(afterCorrection.released, 'the same patient, not a second one').toBe(afterRelease.released);
    expect(afterCorrection.turnaround).toBe(afterRelease.turnaround);
    expect(afterCorrection.amended).toBe(afterRelease.amended + 1);
    expect(afterCorrection.workload, 'the same person releasing their own correction').toBe(afterRelease.workload);
  });
});
