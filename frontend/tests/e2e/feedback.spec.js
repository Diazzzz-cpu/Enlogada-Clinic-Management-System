// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { reportPart } from './helpers/reportFile.js';
import { todayStr } from './helpers/dates.js';

/**
 * Patient feedback on a visit. [1.112.0]
 *
 * The clinic's paper form in the system: a patient answers in the portal once a visit's results
 * are released, reception types in a walk-in's paper form, and Admin reads the overview and
 * decides what is asked. The rules worth holding:
 *
 *   - a visit is rated once, and only once it is finished — one question is whether the RESULT
 *     came on time;
 *   - a patient rates only their own visit; a paper form names who typed it in;
 *   - an answered question keeps its wording, and can still be turned off;
 *   - a patient who asks for their name to be left off is left off.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Patient feedback', () => {
  let ctx;
  let client, admin, reception, cashier, lab;
  let questions;
  let ownVisit;     // the seeded client's own visit, finished
  let walkIn;       // a fixture walk-in's visit, finished
  let unfinished;   // the client's visit, paid but not released

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A visit with one laboratory test, paid, and released unless told not to. */
  const visitFor = async (patientId, { release = true } = {}) => {
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId, visitType: 'Walk in', notes: 'feedback spec' },
    })).json()).data.visit;
    const labTest = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .find((t) => t.category_name === 'Laboratory' && t.is_active);
    await ctx.post(`${API}/tests/visit-tests`, { headers: auth(reception), data: { patientVisitId: visit.id, testIds: [labTest.id] } });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    if (release) {
      const vt = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests[0];
      await ctx.post(`${API}/results/${vt.id}`, { headers: auth(lab), multipart: { file: reportPart('feedback') } });
      const rel = await ctx.post(`${API}/results/${vt.id}/release`, { headers: auth(lab) });
      expect(rel.status()).toBe(200);
    }
    return visit;
  };

  const overview = async () => {
    const res = await ctx.get(`${API}/feedback/overview`, { headers: auth(admin), params: { startDate: todayStr(), endDate: todayStr() } });
    expect(res.status()).toBe(200);
    return (await res.json()).data.report;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [client, admin, reception, cashier, lab] = await Promise.all([
      'client@enlogada.com', 'clinicadmin@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com', 'lab@enlogada.com',
    ].map(login));
    questions = (await (await ctx.get(`${API}/feedback/questions`, { headers: auth(client) })).json()).data.questions;
    expect(questions.length, 'the clinic form has questions').toBeGreaterThan(0);

    const profile = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0];
    ownVisit = await visitFor(profile.id);
    unfinished = await visitFor(profile.id, { release: false });

    const person = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(), birthdate: '1971-07-21', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    });
    walkIn = await visitFor((await person.json()).data.patient.id);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('a patient is asked about a finished visit, and only once', async () => {
    const pending = (await (await ctx.get(`${API}/feedback/mine/pending`, { headers: auth(client) })).json()).data.visits;
    expect(pending.map((v) => v.visit_id)).toContain(ownVisit.id);
    expect(pending.map((v) => v.visit_id), 'a visit still waiting on its result is not asked about').not.toContain(unfinished.id);

    const early = await ctx.post(`${API}/feedback/visits/${unfinished.id}`, {
      headers: auth(client), data: { answers: { [questions[0].id]: 3 } },
    });
    expect(early.status()).toBe(409);

    const before = await overview();
    const sent = await ctx.post(`${API}/feedback/visits/${ownVisit.id}`, {
      headers: auth(client),
      data: { answers: { [questions[0].id]: 3, [questions[1].id]: 1 }, comment: 'Dugay ang result.', language: 'ceb', nameHidden: true },
    });
    expect(sent.status(), await sent.text()).toBe(201);

    const again = await ctx.post(`${API}/feedback/visits/${ownVisit.id}`, {
      headers: auth(client), data: { answers: { [questions[0].id]: 2 } },
    });
    expect(again.status()).toBe(409);

    const after = await overview();
    expect(after.responses).toBe(before.responses + 1);
    expect(after.byChannel.portal).toBe(before.byChannel.portal + 1);
    const form = after.forms.find((f) => f.visit_id === ownVisit.id);
    expect(form.feedback_comment).toBe('Dugay ang result.');
    expect(form.patient_name, 'the patient asked for their name to be left off').toBeNull();
    expect(after.questions.find((q) => q.id === questions[1].id).poor).toBe(
      before.questions.find((q) => q.id === questions[1].id).poor + 1
    );

    const stillPending = (await (await ctx.get(`${API}/feedback/mine/pending`, { headers: auth(client) })).json()).data.visits;
    expect(stillPending.map((v) => v.visit_id)).not.toContain(ownVisit.id);
  });

  test("a patient cannot rate someone else's visit, nor use the desk's form", async () => {
    const theirs = await ctx.post(`${API}/feedback/visits/${walkIn.id}`, {
      headers: auth(client), data: { answers: { [questions[0].id]: 3 } },
    });
    expect(theirs.status()).toBe(404);
    const paper = await ctx.post(`${API}/feedback/visits/${walkIn.id}/paper`, {
      headers: auth(client), data: { answers: { [questions[0].id]: 3 } },
    });
    expect(paper.status()).toBe(403);
  });

  test('reception types in a paper form, with their name on it; the till cannot', async () => {
    const tillTry = await ctx.post(`${API}/feedback/visits/${walkIn.id}/paper`, {
      headers: auth(cashier), data: { answers: { [questions[0].id]: 3 } },
    });
    expect(tillTry.status()).toBe(403);

    const empty = await ctx.post(`${API}/feedback/visits/${walkIn.id}/paper`, { headers: auth(reception), data: { answers: {} } });
    expect(empty.status(), 'a blank form says nothing').toBe(400);

    const saved = await ctx.post(`${API}/feedback/visits/${walkIn.id}/paper`, {
      headers: auth(reception), data: { answers: { [questions[0].id]: 3 }, comment: 'Salamat kaayo!' },
    });
    expect(saved.status(), await saved.text()).toBe(201);

    const form = (await overview()).forms.find((f) => f.visit_id === walkIn.id);
    expect(form.feedback_channel).toBe('paper');
    expect(form.recorded_by_name).toBeTruthy();
    expect(form.patient_name).toBeTruthy();
  });

  test('an answered question keeps its wording, can be turned off, and the order takes every question', async () => {
    const created = await ctx.post(`${API}/feedback/questions`, {
      headers: auth(admin),
      data: { promptCeb: 'E2E Limpyo ba ang parking?', promptTl: 'E2E Malinis ba ang parking?', promptEn: 'E2E Was the parking clean?' },
    });
    expect(created.status()).toBe(201);
    const q = (await created.json()).data.question;

    // Unanswered: its wording may change. Missing a language is refused.
    expect((await ctx.put(`${API}/feedback/questions/${q.id}`, { headers: auth(admin), data: { promptEn: 'E2E Was the parking tidy?' } })).status()).toBe(200);
    expect((await ctx.post(`${API}/feedback/questions`, { headers: auth(admin), data: { promptCeb: 'E2E only one' } })).status()).toBe(400);

    // A partial order is refused; the full order round-trips.
    const all = (await (await ctx.get(`${API}/feedback/questions/manage`, { headers: auth(admin) })).json()).data.questions;
    expect((await ctx.put(`${API}/feedback/questions/order`, { headers: auth(admin), data: { ids: [all[0].id] } })).status()).toBe(400);
    const original = all.map((x) => x.id);
    const reversed = [...original].reverse();
    const reordered = (await (await ctx.put(`${API}/feedback/questions/order`, { headers: auth(admin), data: { ids: reversed } })).json()).data.questions;
    expect(reordered.map((x) => x.id)).toEqual(reversed);
    await ctx.put(`${API}/feedback/questions/order`, { headers: auth(admin), data: { ids: original } });

    // Answered (an answer to an existing question does it): wording locked, switch still works.
    const answered = questions[0];
    expect((await ctx.put(`${API}/feedback/questions/${answered.id}`, { headers: auth(admin), data: { promptEn: 'Changed' } })).status()).toBe(409);

    expect((await ctx.put(`${API}/feedback/questions/${q.id}`, { headers: auth(admin), data: { isActive: false } })).status()).toBe(200);
    const asked = (await (await ctx.get(`${API}/feedback/questions`, { headers: auth(client) })).json()).data.questions;
    expect(asked.map((x) => x.id), 'a question turned off is not asked').not.toContain(q.id);

    // Only someone holding feedback:manage decides what is asked.
    expect((await ctx.post(`${API}/feedback/questions`, {
      headers: auth(reception), data: { promptCeb: 'E2E x', promptTl: 'E2E x', promptEn: 'E2E x' },
    })).status()).toBe(403);
  });

  test('the portal invites a rating on Home, and sending it closes the invitation', async ({ page }) => {
    const visit = await visitFor((await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0].id);
    await signIn(page, 'client@enlogada.com');
    const need = page.locator(`[data-need="rate-${visit.id}"]`);
    await expect(need).toBeVisible({ timeout: 20000 });
    await need.getByRole('button', { name: 'Rate visit' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('feedback-question').first()).toBeVisible();
    await dialog.getByRole('radio', { name: 'English' }).click();
    await expect(dialog.getByRole('heading', { name: 'How was your visit?' })).toBeVisible();
    await dialog.getByTestId('feedback-question').first().getByRole('radio', { name: 'Good' }).click();
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(need).toHaveCount(0, { timeout: 10000 });
  });

  test('Admin reads the overview and manages the questions', async ({ page }) => {
    await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Feedback');
    await expect(page.getByTestId('feedback-overview')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('feedback-question-summary').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Questions' }).click();
    await expect(page.getByTestId('feedback-question-row').first()).toBeVisible();
  });

  test('the desk records a paper form from Visit History', async ({ page }) => {
    // A finished walk-in with no form yet, so the button has a row to sit on.
    const person = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(), birthdate: '1985-03-03', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    });
    const patient = (await person.json()).data.patient;
    await visitFor(patient.id);

    await signInTo(page, 'receptionist@enlogada.com', 'Visit History');
    const row = page.getByRole('row').filter({ hasText: `${patient.first_name} ${patient.last_name}` });
    await row.getByRole('button', { name: 'Record feedback' }).click({ timeout: 20000 });
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('feedback-question').first().getByRole('radio', { name: 'Maayo', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save Paper Form' }).click();
    await expect(row.getByTestId('feedback-in')).toBeVisible({ timeout: 10000 });
  });
});
