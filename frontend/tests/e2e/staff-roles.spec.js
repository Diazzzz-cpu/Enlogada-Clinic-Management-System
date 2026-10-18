// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';

/**
 * A member of staff can hold more than one role, and gets what each allows. [1.129.0]
 *
 * Access always followed the roles an account holds: the permissions are the union of its roles'
 * templates, read again on every request. What was missing was any way to give someone a second
 * role. Staff Accounts set ONE at creation and never again, so "this cashier also covers the desk"
 * meant editing the database by hand, and a person in that position looked like a cashier who
 * could not register a walk-in. Now an account is created with one or more roles, and its roles
 * can be changed afterwards, audited, from the same screen.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Staff roles', () => {
  let ctx;
  let admin, superAdmin, reception;
  let account;
  const person = fixturePerson();
  const email = fixtureEmail(person); // once: each call stamps a new address

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const permissionsOf = async (token) =>
    (await (await ctx.get(`${API}/auth/me`, { headers: auth(token) })).json()).data.user.permissions;
  const setRoles = (token, id, roles) => ctx.put(`${API}/admin/staff/${id}/roles`, { headers: auth(token), data: { roles } });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [admin, superAdmin, reception] = await Promise.all(
      ['clinicadmin@enlogada.com', 'admin@enlogada.com', 'receptionist@enlogada.com'].map(login)
    );

    const created = await ctx.post(`${API}/admin/staff`, {
      headers: auth(admin),
      data: {
        firstName: person.firstName, lastName: person.lastName, email,
        password: PASSWORD, contactNumber: FIXTURE_CONTACT, roles: ['Cashier', 'Receptionist'],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    account = (await created.json()).data.staff || (await created.json()).data.user;
    expect([...account.roles].sort()).toEqual(['Cashier', 'Receptionist']);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('two roles give what both allow: the desk and the till', async () => {
    const token = await login(email);
    const permissions = await permissionsOf(token);
    for (const p of ['visits:create', 'tests:assign', 'billing:process']) expect(permissions).toContain(p);

    // And it works, not only reads right: this account registers a walk-in.
    const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory');
    const walkIn = fixturePerson();
    const visit = await ctx.post(`${API}/visits`, {
      headers: auth(token),
      data: {
        patient: {
          patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
          firstName: walkIn.firstName, lastName: walkIn.lastName,
          birthdate: '1993-03-23', sex: 'Male', contactNumber: FIXTURE_CONTACT,
        },
        visitType: 'Walk in', testIds: [labTest.id],
      },
    });
    expect(visit.status(), await visit.text()).toBe(201);
  });

  test('changing the roles changes the access on the next request, and is recorded', async () => {
    const token = await login(email);

    const changed = await setRoles(admin, account.id, ['Cashier']);
    expect(changed.status(), await changed.text()).toBe(200);
    // The same session: access is read from the roles on every request, not baked into a token.
    expect(await permissionsOf(token)).not.toContain('visits:create');
    expect((await ctx.post(`${API}/visits`, {
      headers: auth(token), data: { patientId: 1, visitType: 'Walk in', testIds: [1] },
    })).status(), 'no longer the desk').toBe(403);

    const log = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(superAdmin), params: { limit: 50 } })).json()).data.entries;
    const entry = log.find((e) => e.action === 'staff.roles_changed' && String(e.entity_id) === String(account.id));
    expect(entry, 'the change is in the Activity Log').toBeTruthy();
    expect(entry.description).toMatch(/Cashier, Receptionist → Cashier/);

    expect((await setRoles(admin, account.id, ['Cashier', 'Receptionist'])).status()).toBe(200);
    expect(await permissionsOf(token)).toContain('visits:create');
  });

  test('only the front-line roles, only on front-line accounts, only by whoever manages staff', async () => {
    expect((await setRoles(admin, account.id, ['Admin'])).status(), 'making someone an Admin').toBe(400);
    expect((await setRoles(admin, account.id, [])).status(), 'no role at all').toBe(400);
    expect((await setRoles(reception, account.id, ['Cashier'])).status(), 'a receptionist').toBe(403);

    const staffList = (await (await ctx.get(`${API}/admin/staff`, { headers: auth(admin) })).json()).data.staff;
    expect(staffList.some((s) => (s.roles || []).includes('Admin')), 'Admins are not on this list').toBeFalsy();
    const clinicAdmin = (await (await ctx.get(`${API}/auth/me`, { headers: auth(admin) })).json()).data.user;
    expect((await setRoles(admin, clinicAdmin.id, ['Cashier'])).status(), 'an Admin account').toBe(403);
  });

  // [1.129.0] One request now registers the patient, opens the visit and attaches its tests, so it
  // answers to all three permissions those steps always needed, whichever one a person was given.
  test('starting a visit asks for every permission it uses, and the Desk offers only what it may', async ({ page }) => {
    const matrix = (await (await ctx.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    const permissionId = (name) => matrix.permissions.find((p) => p.name === name).id;
    const setOverrides = async (overrides) => expect((await ctx.put(`${API}/rbac/users/${account.id}/overrides`, {
      headers: auth(superAdmin), data: { overrides },
    })).status()).toBe(200);

    const token = await login(email);
    const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory');
    const typeId = await patientTypeId(ctx, API, token, 'Self Pay');
    const someone = () => {
      const p = fixturePerson();
      return { patientTypeId: typeId, firstName: p.firstName, lastName: p.lastName, birthdate: '1984-10-04', sex: 'Female', contactNumber: FIXTURE_CONTACT };
    };
    const onFile = (await (await ctx.post(`${API}/patients`, { headers: auth(token), data: someone() })).json()).data.patient;

    try {
      // May start visits, may not register people.
      await setOverrides([{ permissionId: permissionId('patients:create'), effect: 'revoke' }]);
      const newOne = await ctx.post(`${API}/visits`, {
        headers: auth(token), data: { patient: someone(), visitType: 'Walk in', testIds: [labTest.id] },
      });
      expect(newOne.status(), 'a new patient, without patients:create').toBe(403);
      const known = await ctx.post(`${API}/visits`, {
        headers: auth(token), data: { patientId: onFile.id, visitType: 'Walk in', testIds: [labTest.id] },
      });
      expect(known.status(), 'a record on file').toBe(201);

      // The Desk: Start visit on a record, no Register Walk-In.
      await signInTo(page, email, 'Desk');
      await expect(page.getByRole('searchbox', { name: "Who's here?" })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('button', { name: 'Register Walk-In', exact: true })).toHaveCount(0);

      // Without tests:assign there is no visit to open at all: every visit carries tests.
      await setOverrides([{ permissionId: permissionId('tests:assign'), effect: 'revoke' }]);
      expect((await ctx.post(`${API}/visits`, {
        headers: auth(token), data: { patientId: onFile.id, visitType: 'Walk in', testIds: [labTest.id] },
      })).status(), 'without tests:assign').toBe(403);
    } finally {
      await setOverrides([]);
    }
  });

  test('Staff Accounts changes them from the row', async ({ page }) => {
    await signInTo(page, 'clinicadmin@enlogada.com', 'Staff Accounts');
    await page.getByPlaceholder('Search name, email, or role…').fill(email);
    const row = page.locator('tbody tr', { hasText: email });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: 'Roles' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Change roles' })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Cashier' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Receptionist' })).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Receptionist' }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Laboratory Staff' }).check();
    await dialog.getByRole('button', { name: 'Save roles' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(`${person.firstName} ${person.lastName} is now Cashier and Laboratory Staff`)).toBeVisible();

    const fresh = (await (await ctx.get(`${API}/admin/staff`, { headers: auth(admin) })).json()).data.staff
      .find((s) => s.id === account.id);
    expect([...fresh.roles].sort()).toEqual(['Cashier', 'Laboratory Staff']);
  });
});
