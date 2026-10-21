// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { walkInWithVisit, invite, myInvitations, accept, birthdateYearsAgo } from './helpers/invitations.js';

/**
 * A family on one account: the person who manages it accepts an elderly parent's and a baby's
 * records, each sent to their address. [1.136.0]
 *
 * In this clinic one account holder routinely manages profiles for relatives who do not use the
 * portal themselves. Who agrees to that follows the PATIENT's age, never the manager's: a parent or
 * guardian for a child under 18, and an adult's own yes (here, or by phone) for an adult. The
 * manager's age is never asked.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.describe('A family manager accepts their relatives\' records', () => {
  // One family, built up test by test: a failure must not restart it with a new manager.
  test.describe.configure({ mode: 'serial' });
  let ctx;
  let reception;
  let manager;
  let lola;
  let baby;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const res = await ctx.post(`${API}/auth/login`, { data: { email: 'receptionist@enlogada.com', password: PASSWORD } });
    reception = (await res.json()).data.token;

    const person = fixturePerson();
    manager = { ...person, email: fixtureEmail(person) };
    manager.token = (await registerClient(ctx, { ...person, email: manager.email, password: PASSWORD, contactNumber: FIXTURE_CONTACT })).token;

    lola = await walkInWithVisit(ctx, API, { reception, birthdate: '1948-03-03' });
    // Two different first names: the portal names a waiting record "Maria D.", and the fixture pool
    // can hand out the same first name twice.
    do {
      baby = await walkInWithVisit(ctx, API, { reception, birthdate: birthdateYearsAgo(0, 120) });
    } while (baby.patient.first_name === lola.patient.first_name);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  test("a child's record goes to a parent or guardian, who agrees for them", async () => {
    const refused = await invite(ctx, API, reception, baby.patient.id, manager.email, {
      relationship: 'parent_guardian', recipientName: manager.firstName, consentBasis: 'patient_in_person',
    });
    expect(refused.status(), 'a baby does not agree for themselves').toBe(400);
    const notGuardian = await invite(ctx, API, reception, baby.patient.id, manager.email, {
      relationship: 'sibling', recipientName: manager.firstName, consentBasis: 'guardian_of_minor',
    });
    expect(notGuardian.status(), "a child's record goes to their parent or guardian").toBe(400);

    const ok = await invite(ctx, API, reception, baby.patient.id, manager.email, {
      relationship: 'parent_guardian', recipientName: `${manager.firstName} ${manager.lastName}`, consentBasis: 'guardian_of_minor',
    });
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test("an elderly parent's record goes to the manager with her own yes", async () => {
    const ok = await invite(ctx, API, reception, lola.patient.id, manager.email, {
      relationship: 'child', recipientName: `${manager.firstName} ${manager.lastName}`, consentBasis: 'patient_in_person',
    });
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test('both wait in one account, and each is accepted on its own', async () => {
    const { invitations } = await myInvitations(ctx, API, manager.token);
    const names = invitations.map((i) => i.patientName);
    expect(names).toEqual(expect.arrayContaining([
      `${lola.patient.first_name} ${lola.patient.last_name[0]}.`,
      `${baby.patient.first_name} ${baby.patient.last_name[0]}.`,
    ]));
    for (const { patient, birthdate } of [lola, baby]) {
      const inv = invitations.find((i) => i.patientName.startsWith(`${patient.first_name} `));
      const ok = await accept(ctx, API, manager.token, inv.id, birthdate);
      expect(ok.status(), await ok.text()).toBe(200);
    }
    const profiles = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(manager.token) })).json()).data.patients;
    expect(profiles.find((p) => p.id === lola.patient.id)?.account_relationship).toBe('child');
    expect(profiles.find((p) => p.id === baby.patient.id)?.account_relationship).toBe('parent_guardian');
  });

  test('a profile the manager already typed in for the same person is said, and can be kept', async () => {
    const auntie = await walkInWithVisit(ctx, API, { reception, birthdate: '1960-06-06' });
    // The manager added her by hand before the clinic's record reached them.
    const added = await ctx.post(`${API}/patients`, {
      headers: auth(manager.token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, manager.token, 'Self Pay'),
        firstName: auntie.patient.first_name, lastName: auntie.patient.last_name,
        birthdate: '1960-06-06', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    });
    expect(added.status(), await added.text()).toBe(201);
    await invite(ctx, API, reception, auntie.patient.id, manager.email, {
      relationship: 'other_family', recipientName: manager.firstName, consentBasis: 'patient_by_phone',
    });
    const inv = (await myInvitations(ctx, API, manager.token)).invitations.find((i) => i.patientName.startsWith(`${auntie.patient.first_name} `));

    const warned = await accept(ctx, API, manager.token, inv.id, '1960-06-06');
    expect(warned.status()).toBe(409);
    expect((await warned.json()).details?.possibleDuplicate, 'names the profile already on the account').toBeTruthy();
    const kept = await accept(ctx, API, manager.token, inv.id, '1960-06-06', { keepBoth: true });
    expect(kept.status(), await kept.text()).toBe(200);
  });

  test('the family list says which records came from the clinic', async ({ page }) => {
    await signIn(page, manager.email, PASSWORD);
    await openPortalTab(page, 'profile');
    const family = page.getByTestId('portal-family');
    await expect(family).toContainText(lola.patient.first_name, { timeout: 20000 });
    await expect(family.getByTestId('family-from-clinic').first()).toBeVisible();
  });
});
