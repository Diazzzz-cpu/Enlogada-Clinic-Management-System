// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { reportPart } from './helpers/reportFile.js';
import {
  walkInWithVisit, invite, myInvitations, accept, confirmEmail, moveInvitation,
} from './helpers/invitations.js';

/**
 * A walk-in patient is invited to the portal, and their record is waiting when they sign up. [1.136.0]
 *
 * The desk sends an invitation to an address it checked with the patient; the email carries no
 * secret. Whoever signs up (or signs in) with that address sees "A record is waiting" and accepts it
 * with the record's date of birth. It replaced [1.123.0]'s direct link, which joined a record to an
 * account on the desk's word alone. Each visit then says how it came about: a walk-in at the clinic
 * is never shown as something the patient booked online.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.describe('Portal invitations', () => {
  let ctx;
  let reception, cashier, lab, admin;

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A patient account at a fresh test address, signed up through the real endpoints. */
  const newAccount = async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD, contactNumber: FIXTURE_CONTACT });
    return { person, email, token };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier, lab, admin] = await Promise.all(
      ['receptionist@enlogada.com', 'cashier@enlogada.com', 'lab@enlogada.com', 'clinicadmin@enlogada.com'].map(login)
    );
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('the desk invites; the departments and patients cannot, and nothing secret comes back', async () => {
    const { patient } = await walkInWithVisit(ctx, API, { reception });
    const email = fixtureEmail(fixturePerson());

    expect((await invite(ctx, API, lab, patient.id, email)).status(), 'a department').toBe(403);
    const { token: client } = await newAccount();
    expect((await invite(ctx, API, client, patient.id, email)).status(), 'a patient').toBe(403);

    const sent = await invite(ctx, API, reception, patient.id, email);
    expect(sent.status(), await sent.text()).toBe(201);
    const body = await sent.text();
    expect(body, 'no token or link in the reply').not.toMatch(/token|ticket|https?:\/\//i);

    const access = (await (await ctx.get(`${API}/patients/${patient.id}/portal-access`, { headers: auth(reception) })).json()).data;
    expect(access.state).toBe('pending');
    expect(access.patient.email, 'a record with no address takes this one').toBe(email);
  });

  test('who agrees follows the patient: their own address, or their yes for a family address', async () => {
    const { patient } = await walkInWithVisit(ctx, API, { reception });
    const email = fixtureEmail(fixturePerson());
    const refused = async (over, why) => {
      const res = await invite(ctx, API, reception, patient.id, email, over);
      expect(res.status(), why).toBe(400);
    };
    await refused({ confirmed: false }, 'no read-back, no send');
    await refused({ consentBasis: 'patient_in_person' }, "the patient's own address needs nothing more");
    await refused({ relationship: 'child', consentBasis: 'own_address', recipientName: 'Ana' }, "another person's address is not the patient's own");
    await refused({ relationship: 'parent_guardian', recipientName: 'Ana', consentBasis: 'guardian_of_minor' }, 'a guardian agrees only for a child');
    await refused({ relationship: 'child', consentBasis: 'patient_by_phone' }, 'a family address names its owner');

    expect((await invite(ctx, API, reception, patient.id, 'cashier@enlogada.com')).status(), 'never a staff account').toBe(409);
    const ok = await invite(ctx, API, reception, patient.id, email, {
      relationship: 'child', recipientName: 'Ana Reyes', consentBasis: 'patient_by_phone',
    });
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test('the record waits for the invited address, and is accepted with its date of birth', async () => {
    const { patient, birthdate } = await walkInWithVisit(ctx, API, { reception, cashier, pay: true });
    const { email, token } = await newAccount();
    const other = await newAccount();
    expect((await invite(ctx, API, reception, patient.id, email)).status()).toBe(201);

    expect((await myInvitations(ctx, API, other.token)).invitations, 'nothing for another address').toHaveLength(0);
    const [waiting] = (await myInvitations(ctx, API, token)).invitations;
    expect(waiting.patientName, 'first name and last initial only').toBe(`${patient.first_name} ${patient.last_name[0]}.`);

    expect((await accept(ctx, API, other.token, waiting.id, birthdate)).status(), "someone else's invitation").toBe(404);
    const wrong = await accept(ctx, API, token, waiting.id, '1951-04-13');
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).message).toMatch(/2 tries left/);

    const ok = await accept(ctx, API, token, waiting.id, birthdate);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await accept(ctx, API, token, waiting.id, birthdate)).status(), 'accepted once').toBe(410);

    const profiles = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(token) })).json()).data.patients;
    const linked = profiles.find((p) => p.id === patient.id);
    expect(linked?.from_clinic, 'marked as from the clinic').toBe(true);

    // The whole history, each part saying it was a walk-in.
    const visits = (await (await ctx.get(`${API}/visits/patient/${patient.id}`, { headers: auth(token) })).json()).data.visits;
    expect(visits[0].came_in_as).toBe('walk_in');
    expect(Object.keys(visits[0]), 'the portal projection: no staff notes or file paths').not.toContain('notes');
    const pays = (await (await ctx.get(`${API}/payments/my-payments`, { headers: auth(token) })).json()).data.payments;
    expect(pays.find((p) => p.patient_id === patient.id)?.came_in_as).toBe('walk_in');
  });

  test('an expired, withdrawn or locked invitation cannot be accepted', async () => {
    const { patient, birthdate } = await walkInWithVisit(ctx, API, { reception });
    const { email, token } = await newAccount();
    await invite(ctx, API, reception, patient.id, email);
    moveInvitation(email, 'expire');
    expect((await myInvitations(ctx, API, token)).invitations, 'an expired one is not offered').toHaveLength(0);
    expect((await (await ctx.get(`${API}/patients/${patient.id}/portal-access`, { headers: auth(reception) })).json()).data.state).toBe('expired');

    // A new invitation supersedes it; withdrawn, it is gone from the portal.
    expect((await invite(ctx, API, reception, patient.id, email)).status()).toBe(201);
    const [fresh] = (await myInvitations(ctx, API, token)).invitations;
    expect((await ctx.delete(`${API}/patients/${patient.id}/invitations/open`, { headers: auth(reception) })).status()).toBe(200);
    expect((await accept(ctx, API, token, fresh.id, birthdate)).status()).toBe(410);

    // Three wrong dates lock it, and the desk sees why.
    await invite(ctx, API, reception, patient.id, email);
    const [third] = (await myInvitations(ctx, API, token)).invitations;
    for (let i = 0; i < 2; i += 1) expect((await accept(ctx, API, token, third.id, '2000-01-01')).status()).toBe(400);
    const locked = await accept(ctx, API, token, third.id, '2000-01-01');
    expect(locked.status()).toBe(410);
    expect((await (await ctx.get(`${API}/patients/${patient.id}/portal-access`, { headers: auth(reception) })).json()).data.state)
      .toBe('birthdate_locked');
  });

  test('an account that never proved its address confirms it before the record is named', async () => {
    const { patient, birthdate } = await walkInWithVisit(ctx, API, { reception });
    const { email, token } = await newAccount();
    moveInvitation(email, 'unverify');
    await invite(ctx, API, reception, patient.id, email);

    const before = await myInvitations(ctx, API, token);
    expect(before).toMatchObject({ needsEmailCheck: true, count: 1, invitations: [] });

    await confirmEmail(ctx, API, token, email);
    const [waiting] = (await myInvitations(ctx, API, token)).invitations;
    expect((await accept(ctx, API, token, waiting.id, birthdate)).status()).toBe(200);
  });

  test('a resend waits out its minute, and the desk can withdraw', async () => {
    const { patient } = await walkInWithVisit(ctx, API, { reception });
    const email = fixtureEmail(fixturePerson());
    await invite(ctx, API, reception, patient.id, email);
    expect((await ctx.post(`${API}/patients/${patient.id}/invitations/resend`, { headers: auth(reception) })).status()).toBe(409);
    moveInvitation(email, 'ready-to-resend');
    expect((await ctx.post(`${API}/patients/${patient.id}/invitations/resend`, { headers: auth(reception) })).status()).toBe(200);
    const log = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(admin), params: { limit: 100 } })).json()).data;
    const actions = log.entries.filter((e) => String(e.entity_id) === String(patient.id)).map((e) => e.action);
    expect(actions, 'sent and sent again, in the Activity Log').toEqual(expect.arrayContaining(['patient.invite_sent', 'patient.invite_resent']));
  });

  test('a report not yet released is never sent to the patient, not even its file or findings', async () => {
    // [1.136.0] step 0: the history joined the CURRENT version, so a draft reached the portal.
    const { patient, visit, birthdate } = await walkInWithVisit(ctx, API, { reception, cashier, pay: true });
    const [vt] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    const saved = await ctx.post(`${API}/results/${vt.id}`, { headers: auth(lab), multipart: { file: reportPart('draft') } });
    expect(saved.status(), await saved.text()).toBe(201);

    const { email, token } = await newAccount();
    await invite(ctx, API, reception, patient.id, email);
    const [waiting] = (await myInvitations(ctx, API, token)).invitations;
    expect((await accept(ctx, API, token, waiting.id, birthdate)).status()).toBe(200);

    const rows = (await (await ctx.get(`${API}/results/history/${patient.id}`, { headers: auth(token) })).json()).data.results;
    const row = rows.find((r) => r.visit_test_id === vt.id);
    expect(row, 'the test is listed, with its progress').toBeTruthy();
    expect(row.file_path, 'no draft file').toBeNull();
    expect(row.findings ?? null, 'no draft findings').toBeNull();
  });

  test('a record already in an account, or archived, is not invited; archiving withdraws one', async () => {
    const admin2 = admin;
    // A record with no visits can be archived.
    const person = fixturePerson();
    const created = await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: { patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'), ...person, birthdate: '1970-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    });
    const bare = (await created.json()).data.patient;
    const email = fixtureEmail(fixturePerson());
    expect((await invite(ctx, API, reception, bare.id, email)).status()).toBe(201);
    expect((await ctx.patch(`${API}/patients/${bare.id}/archive`, { headers: auth(admin2), data: { archived: true } })).status()).toBe(200);
    const access = (await (await ctx.get(`${API}/patients/${bare.id}/portal-access`, { headers: auth(reception) })).json()).data;
    expect(access.state).toBe('archived');
    expect(access.invitation.revokedReason, 'archiving withdrew it').toBe('archived');
    expect((await invite(ctx, API, reception, bare.id, email)).status(), 'archived: refused').toBe(409);

    // The departments see only their own patients' portal access: this one never had lab work.
    expect((await ctx.get(`${API}/patients/${bare.id}/portal-access`, { headers: auth(lab) })).status()).toBe(404);

    const linked = await walkInWithVisit(ctx, API, { reception });
    const acct = await newAccount();
    await invite(ctx, API, reception, linked.patient.id, acct.email);
    const [inv] = (await myInvitations(ctx, API, acct.token)).invitations;
    expect((await accept(ctx, API, acct.token, inv.id, linked.birthdate)).status()).toBe(200);
    expect((await invite(ctx, API, reception, linked.patient.id, fixtureEmail(fixturePerson()))).status(), 'already linked').toBe(409);
  });

  test('"Not someone I know" ends the invitation, and the desk sees it was declined', async () => {
    const { patient } = await walkInWithVisit(ctx, API, { reception });
    const { email, token } = await newAccount();
    await invite(ctx, API, reception, patient.id, email);
    const [waiting] = (await myInvitations(ctx, API, token)).invitations;
    expect((await ctx.post(`${API}/patients/invitations/${waiting.id}/decline`, { headers: auth(token) })).status()).toBe(200);
    expect((await myInvitations(ctx, API, token)).invitations).toHaveLength(0);
    expect((await (await ctx.get(`${API}/patients/${patient.id}/portal-access`, { headers: auth(reception) })).json()).data.state)
      .toBe('declined');
  });

  test('the desk sends it from Patient Records, reading the address back first', async ({ page }) => {
    const { person, patient } = await walkInWithVisit(ctx, API, { reception });
    const email = fixtureEmail(fixturePerson());

    await signInTo(page, 'receptionist@enlogada.com', 'Patient Records');
    await page.getByLabel('Search patient records').fill(person.fullName);
    await page.keyboard.press('Enter');
    const row = page.locator(`[data-testid="patient-row"][data-patient-id="${patient.id}"]`);
    await row.getByTestId('patient-row-invite').click({ timeout: 20000 });

    const dialog = page.getByTestId('portal-access');
    await expect(dialog).toHaveAttribute('data-state', 'none');
    await dialog.getByLabel('Email address').fill(email);
    const send = dialog.getByRole('button', { name: 'Send invitation' });
    await expect(send, 'nothing goes until they said yes').toBeDisabled();
    await expect(dialog.getByTestId('portal-access-readback')).toContainText(email);
    await dialog.getByTestId('portal-access-agreed').check();
    await send.click();
    await expect(dialog).toHaveAttribute('data-state', 'pending', { timeout: 15000 });
    await expect(dialog.getByTestId('portal-access-pending')).toContainText(email);
  });

  test('the patient finds the record waiting, adds it, and sees the walk-in as a walk-in', async ({ page }) => {
    const { patient, birthdate } = await walkInWithVisit(ctx, API, { reception, cashier, pay: true });
    const { email } = await newAccount();
    await invite(ctx, API, reception, patient.id, email);

    await signIn(page, email, PASSWORD);
    const need = page.locator('[data-testid="portal-need"][data-need^="record-"]');
    await expect(need).toContainText(`A record is waiting: ${patient.first_name}`, { timeout: 20000 });
    await need.getByRole('button', { name: 'Review' }).click();

    const dialog = page.getByTestId('accept-record');
    await dialog.locator('#accept-birthdate').fill(birthdate);
    await dialog.getByRole('button', { name: 'Add to my account' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });

    await openPortalTab(page, 'appointments');
    const visit = page.getByTestId('walk-in-visit').first();
    await expect(visit).toBeVisible({ timeout: 15000 });
    await expect(visit.getByTestId('visit-origin')).toHaveAttribute('data-origin', 'walk_in');
    await expect(visit).toContainText('Walk-in at the clinic');
    await expect(page.getByTestId('appointment-card').filter({ hasText: 'Walk-in at the clinic' }), 'never a booking card').toHaveCount(0);

    await openPortalTab(page, 'payments');
    await expect(page.getByTestId('payment-history').getByTestId('visit-origin').first()).toHaveAttribute('data-origin', 'walk_in');
  });
});
