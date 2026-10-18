// @ts-check
import { test, expect, request } from 'playwright/test';
import { pdfReport } from './helpers/reportFile.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

/**
 * Who may open a result's report file, and WHEN. [1.94.0]
 *
 * `GET /results/:visitTestId/file` checked two things: that a Client owns the visit, and that a
 * staff member belongs to the department. It never checked that the result had been released, and
 * it served whichever version was `is_current`.
 *
 * That was survivable while the file merely supplemented typed findings — the portal does not draw
 * a button for an unreleased result, so nobody arrived at it by accident. It stopped being
 * survivable when the attached document became the whole report, because hiding a control is not
 * enforcing a rule; this codebase says so in `resultService`'s own comments about borrowed screens.
 *
 * Two distinct failures lived in that one missing check, and they pull in opposite directions:
 *
 *   1. A result recorded and not yet authorised IS current. A patient could fetch a draft
 *      clinical report that no clinician had signed off.
 *   2. An amendment reopens the visit and makes the UNRELEASED v2 current. So a naive "must be
 *      released" gate would have taken away the copy the patient had already been sent, for as
 *      long as the correction took to write — punishing them for the clinic's correction.
 *
 * The answer to both is the same: a patient is served the newest AUTHORISED version, never the
 * current one. Staff keep seeing the current version, because reviewing the draft is their job.
 *
 * These drive the API rather than the browser deliberately. The defect was never visible in the
 * UI — the portal's buttons were already gated correctly — so a browser test would have passed
 * against the bug.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

const CLIENT = { email: 'client@enlogada.com', password: PASSWORD };
const LAB = { email: 'lab@enlogada.com', password: PASSWORD };
const RECEPTION = { email: 'receptionist@enlogada.com', password: PASSWORD };
const CASHIER = { email: 'cashier@enlogada.com', password: PASSWORD };

test.describe('Who may open a result file', () => {
  let ctx;
  let client, lab, reception, cashier;
  let visitTestId;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const login = async (creds) => {
    const res = await ctx.post(`${API}/auth/login`, { data: creds });
    expect(res.ok(), `sign-in for ${creds.email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** The report as the patient would ask for it. */
  const asPatient = () => ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(client) });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [client, lab, reception, cashier] = await Promise.all(
      [CLIENT, LAB, RECEPTION, CASHIER].map(login)
    );

    // The seeded client's own patient record, so the visit genuinely belongs to them — ownership
    // is half of what this route decides, and a walk-in with no account could not exercise it.
    const profiles = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json())
      .data.patients || [];
    expect(profiles.length, 'the seeded client needs at least one patient profile').toBeGreaterThan(0);
    const patientId = profiles[0].id;

    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    expect(labTest, 'need an active laboratory test').toBeTruthy();

    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId, visitType: 'Walk in', notes: 'E2E result file access', testIds: [labTest.id] },
    })).json()).data.visit;

    // Payment is what releases the ticket to the department worklist.
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);

    const visitTests = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, {
      headers: auth(reception),
    })).json()).data.visitTests || [];
    visitTestId = visitTests[0].id;

    // Recorded WITH a report, and deliberately NOT released.
    const recorded = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: {
        findings: 'E2E draft — must not reach the patient before release.',
        file: {
          name: 'draft-report.pdf',
          mimeType: 'application/pdf',
          buffer: pdfReport('draft report'),
        },
      },
    });
    expect(recorded.status(), 'recording a result parks it, it does not release it').toBe(201);
  });

  test.afterAll(async () => { await ctx.dispose(); });

  test('a patient cannot open a report that has not been authorised', async () => {
    const res = await asPatient();
    expect(
      res.status(),
      'an unreleased report is a draft no clinician has signed — it is not the patient\'s to read'
    ).toBe(404);
  });

  test('the department CAN open it, because reviewing the draft is the job', async () => {
    const res = await ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(lab) });
    expect(res.status(), 'staff read the current version, released or not').toBe(200);
  });

  test('once authorised, the patient gets it', async () => {
    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);

    const res = await asPatient();
    expect(res.status(), 'a released report belongs to the patient').toBe(200);
    expect(res.headers()['content-type']).toContain('pdf');
  });

  test('an amendment in progress does not take the released copy away', async () => {
    // Re-recording an already-released result supersedes it: v2 becomes current and UNRELEASED,
    // and the visit reopens. Reading `is_current` here would serve the patient a draft; gating
    // naively on release would serve them nothing at all. Both are wrong — they are still
    // entitled to the version that was authorised and sent to them.
    const amended = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: {
        findings: 'E2E corrected draft — not yet authorised.',
        amendmentReason: 'E2E correction in progress',
        file: {
          name: 'corrected-report.pdf',
          mimeType: 'application/pdf',
          buffer: pdfReport('corrected report'),
        },
      },
    });
    expect(amended.status(), 'an amendment needs its reason and is accepted with one').toBe(201);

    const res = await asPatient();
    expect(res.status(), 'the copy they were sent stays readable while it is being corrected').toBe(200);

    // And it is the OLD document, not the unauthorised correction — as a digital copy. [1.114.0]
    const disposition = res.headers()['content-disposition'] || '';
    expect(
      disposition,
      'the patient must be served the version that was authorised, not the draft replacing it'
    ).toContain('draft-report (Digital Copy).pdf');
  });

  test('and they get the correction once THAT is authorised', async () => {
    const released = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);

    const res = await asPatient();
    expect(res.status()).toBe(200);
    expect(
      res.headers()['content-disposition'] || '',
      'the newest authorised version is the one they get'
    ).toContain('corrected-report (Digital Copy).pdf');
  });
});
