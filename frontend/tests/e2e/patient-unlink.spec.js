// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { walkInWithVisit, invite, myInvitations, accept } from './helpers/invitations.js';

/**
 * Taking a record back out of a portal account. [1.136.0] Admin only.
 *
 * For a record in the wrong account: the wrong Maria Santos invited, a grown child who wants their
 * own account, a family member handing over. Nothing is deleted, the account loses the record on
 * its next request (no sign-out needed), and the record can be invited again, by someone other than
 * the Admin who unlinked it for the next 30 days: the two-person rule, which binds SuperAdmin too.
 * Urgent reasons go through with work still open; planned ones wait for it.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.describe('Unlinking a record from a portal account', () => {
  let ctx;
  let reception, cashier, lab, admin;

  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  /** A walk-in record, linked by invitation to a new patient account. */
  const linkedRecord = async (opts) => {
    const record = await walkInWithVisit(ctx, API, { reception, cashier, lab, ...opts });
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD, contactNumber: FIXTURE_CONTACT });
    expect((await invite(ctx, API, reception, record.patient.id, email)).status()).toBe(201);
    const [inv] = (await myInvitations(ctx, API, token)).invitations;
    expect((await accept(ctx, API, token, inv.id, record.birthdate)).status()).toBe(200);
    return { ...record, email, token };
  };
  const unlink = (token, patientId, data) => ctx.delete(`${API}/patients/${patientId}/account-link`, { headers: auth(token), data });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier, lab, admin] = await Promise.all(
      ['receptionist@enlogada.com', 'cashier@enlogada.com', 'lab@enlogada.com', 'clinicadmin@enlogada.com'].map(login)
    );
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('only Admin unlinks, and says why', async () => {
    const { patient } = await linkedRecord({ finish: true });
    const why = { reasonKind: 'patient_wants_own_account', note: 'Grown up, wants her own account', recordEmail: 'keep' };
    expect((await unlink(reception, patient.id, why)).status(), 'the desk').toBe(403);
    expect((await unlink(lab, patient.id, why)).status(), 'a department').toBe(403);
    expect((await unlink(cashier, patient.id, why)).status(), 'the till').toBe(403);
    expect((await unlink(admin, patient.id, { ...why, note: 'short' })).status(), 'a note of substance').toBe(400);
    expect((await unlink(admin, patient.id, { ...why, recordEmail: undefined })).status(), "the record's email is the account's: say what to do").toBe(400);
    const ok = await unlink(admin, patient.id, why);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('the old account loses the record at once, with the same token', async () => {
    const { patient, token } = await linkedRecord({ finish: true });
    expect((await ctx.get(`${API}/visits/patient/${patient.id}`, { headers: auth(token) })).status()).toBe(200);
    const pays = (await (await ctx.get(`${API}/payments/my-payments`, { headers: auth(token) })).json()).data.payments;
    const receipt = pays.find((p) => p.patient_id === patient.id)?.receipt_number;
    expect(receipt, 'a paid walk-in has a receipt in the portal').toBeTruthy();
    expect((await ctx.get(`${API}/payments/receipt/${receipt}`, { headers: auth(token) })).status()).toBe(200);
    expect((await unlink(admin, patient.id, {
      reasonKind: 'linked_in_error', note: 'Wrong patient invited at the desk', recordEmail: 'clear',
    })).status()).toBe(200);

    expect((await ctx.get(`${API}/visits/patient/${patient.id}`, { headers: auth(token) })).status()).toBe(403);
    expect((await ctx.get(`${API}/results/history/${patient.id}`, { headers: auth(token) })).status()).toBe(403);
    expect((await ctx.get(`${API}/payments/receipt/${receipt}`, { headers: auth(token) })).status(), 'nor its receipt').toBe(403);
    const profiles = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(token) })).json()).data.patients;
    expect(profiles.map((p) => p.id)).not.toContain(patient.id);
    const access = (await (await ctx.get(`${API}/patients/${patient.id}/portal-access`, { headers: auth(admin) })).json()).data;
    expect(access.state, 'a walk-in record again').toBe('none');
    expect(access.patient.email, 'cleared, as asked').toBeNull();
    const log = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(admin), params: { limit: 100 } })).json()).data;
    expect(log.entries.filter((e) => String(e.entity_id) === String(patient.id)).map((e) => e.action))
      .toContain('patient.account_unlinked');
  });

  test('a planned unlink waits for open work; an urgent one goes through and lists it', async () => {
    const { patient } = await linkedRecord({ pay: true });
    const planned = await unlink(admin, patient.id, {
      reasonKind: 'moving_to_another_manager', note: 'Her son is taking over', recordEmail: 'keep',
    });
    expect(planned.status()).toBe(409);
    expect((await planned.json()).message).toMatch(/still being worked on/);

    const keep = await unlink(admin, patient.id, { reasonKind: 'account_compromised', note: 'Someone else got into it', recordEmail: 'keep' });
    expect(keep.status(), 'an urgent reason may not keep the account address on the record').toBe(400);
    const urgent = await unlink(admin, patient.id, { reasonKind: 'account_compromised', note: 'Someone else got into it', recordEmail: 'clear' });
    expect(urgent.status(), await urgent.text()).toBe(200);
    expect((await urgent.json()).data.openWork).toEqual(expect.arrayContaining(['a visit still being worked on']));
  });

  test('two people: whoever unlinked does not send the next invitation', async () => {
    const { patient } = await linkedRecord({ finish: true });
    expect((await unlink(admin, patient.id, {
      reasonKind: 'moving_to_another_manager', note: 'Daughter moved abroad', recordEmail: 'keep',
    })).status()).toBe(200);
    const next = fixtureEmail(fixturePerson());
    const byAdmin = await invite(ctx, API, admin, patient.id, next);
    expect(byAdmin.status()).toBe(409);
    expect((await byAdmin.json()).message).toMatch(/another member of staff/);
    const byDesk = await invite(ctx, API, reception, patient.id, next);
    expect(byDesk.status(), await byDesk.text()).toBe(201);
  });

  test('the dialog shows what is open before anything is pressed', async ({ page }) => {
    const { person, patient } = await linkedRecord({ pay: true });
    await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Records');
    await page.getByLabel('Search patient records').fill(person.fullName);
    await page.keyboard.press('Enter');
    const row = page.locator(`[data-testid="patient-row"][data-patient-id="${patient.id}"]`);
    await row.getByTestId('patient-row-unlink').click({ timeout: 20000 });

    const dialog = page.getByTestId('unlink-dialog');
    await expect(dialog.getByTestId('unlink-open-work')).toContainText('still being worked on', { timeout: 15000 });
    await expect(dialog.getByLabel('Another family member is taking over'), 'a planned reason waits').toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Unlink record' })).toBeDisabled();
  });
});
