// @ts-check
import { expect } from 'playwright/test';
import { runScript } from './backendScript.js';
import { fixturePerson, FIXTURE_CONTACT } from './people.js';
import { patientTypeId } from './patients.js';
import { payAndReleaseWalkIn } from './ticketRelease.js';
import { reportPart } from './reportFile.js';
import { setAuthCode, TEST_CODE } from './accounts.js';

/**
 * Portal invitations, for specs. [1.136.0]
 *
 * An invitation carries no token, so nothing has to be read out of an email: the spec invites a
 * test address, signs up (or signs in) with it the normal way, and accepts the record with its date
 * of birth. Only what a run cannot wait for goes through backend/src/scripts/e2eInvitation.js.
 */

const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** A date of birth `years` ago today, YYYY-MM-DD from local getters, so a child stays a child. */
export function birthdateYearsAgo(years, extraDays = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - extraDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A walk-in patient with one visit. `pay` pays it (released to its department); `finish` also
 * releases a report on its one Laboratory test, so nothing is left open for the patient.
 */
export async function walkInWithVisit(ctx, API, { reception, cashier, lab, birthdate = '1951-04-12', pay = false, finish = false } = {}) {
  const person = fixturePerson();
  const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
  const labTest = tests.find((t) => t.category_name === 'Laboratory' && t.is_active !== false);
  const created = await ctx.post(`${API}/patients`, {
    headers: auth(reception),
    data: {
      patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
      ...person, birthdate, sex: 'Female', contactNumber: FIXTURE_CONTACT,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const patient = (await created.json()).data.patient;
  const visitRes = await ctx.post(`${API}/visits`, {
    headers: auth(reception),
    data: { patientId: patient.id, visitType: 'Walk in', testIds: [labTest.id] },
  });
  expect(visitRes.status(), await visitRes.text()).toBe(201);
  const visit = (await visitRes.json()).data.visit;

  if (pay || finish) await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
  if (finish) {
    const [vt] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    const saved = await ctx.post(`${API}/results/${vt.id}`, { headers: auth(lab), multipart: { file: reportPart('invitation') } });
    expect(saved.status(), await saved.text()).toBe(201);
    const released = await ctx.post(`${API}/results/${vt.id}/release`, { headers: auth(lab) });
    expect(released.status(), await released.text()).toBe(200);
  }
  return { person, patient, visit, birthdate };
}

/** POST an invitation. Defaults to the patient's own address. */
export function invite(ctx, API, token, patientId, email, over = {}) {
  return ctx.post(`${API}/patients/${patientId}/invitations`, {
    headers: auth(token),
    data: { email, relationship: 'self', consentBasis: 'own_address', confirmed: true, ...over },
  });
}

/** The invitations waiting for a signed-in patient account. */
export async function myInvitations(ctx, API, token) {
  const res = await ctx.get(`${API}/patients/invitations/mine`, { headers: auth(token) });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data;
}

/** Accept a record, as the patient does. Returns the response. */
export function accept(ctx, API, token, invitationId, birthdate, extra = {}) {
  return ctx.post(`${API}/patients/invitations/${invitationId}/accept`, {
    headers: auth(token), data: { birthdate, ...extra },
  });
}

/** Prove an account's address through the real endpoints, with a code the spec knows. */
export async function confirmEmail(ctx, API, token, email) {
  const started = await ctx.post(`${API}/auth/email-check`, { headers: auth(token) });
  expect(started.status(), await started.text()).toBe(200);
  setAuthCode(email, 'email_verify');
  const done = await ctx.post(`${API}/auth/email-check/confirm`, {
    headers: auth(token), data: { ticket: (await started.json()).data.ticket, code: TEST_CODE },
  });
  expect(done.status(), await done.text()).toBe(200);
}

/** --expire, --ready-to-resend, --unverify. See e2eInvitation.js. */
export function moveInvitation(email, ...flags) {
  runScript('e2eInvitation.js', [`--email=${email}`, ...flags.map((f) => `--${f}`)], 'invitation');
}
