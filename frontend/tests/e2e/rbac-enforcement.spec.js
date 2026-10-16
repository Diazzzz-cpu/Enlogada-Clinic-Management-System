// @ts-check
import { test, expect, request } from 'playwright/test';

// The role-permission matrix actually governs access.
//
// It used to carry an "advisory only — not yet enforced" banner, because authorizePermissions was
// wired to zero routes: a SuperAdmin could untick `billing:process` for Cashier, watch it save,
// and reasonably conclude access had been removed while cashiers kept taking payments.
//
// Two things make it real, and both are asserted here. Permissions now gate the API, and Admin no
// longer bypasses them — while Admin bypassed, unticking anything for Admin was a no-op, which is
// why Admin and SuperAdmin felt like the same role.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Role-permission matrix is enforced', () => {
  let apiContext;
  let superAdmin, admin, cashier;
  let cashierRoleId, permissionIds, originalCashierIds;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const setCashierPermissions = async (ids) => {
    const res = await apiContext.put(`${API}/rbac/roles/${cashierRoleId}/permissions`, {
      headers: auth(superAdmin), data: { permissionIds: ids },
    });
    expect(res.status()).toBe(200);
  };
  const permissionsOf = async (token) =>
    (await (await apiContext.get(`${API}/auth/me`, { headers: auth(token) })).json()).data.user.permissions;

  // The matrix now carries the staff roster and the department list too, so the per-account half
  // of the screen has something to edit. Re-read rather than cached: these assertions are about
  // a change taking effect, so reading a snapshot taken before it would prove nothing.
  const matrixData = async () =>
    (await (await apiContext.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
  const accounts = async () => (await matrixData()).accounts;
  const categories = async () => (await matrixData()).categories;

  const setOverrides = async (userId, overrides) => {
    const res = await apiContext.put(`${API}/rbac/users/${userId}/overrides`, {
      headers: auth(superAdmin), data: { overrides },
    });
    expect(res.status()).toBe(200);
  };
  const setDepartments = async (userId, categoryIds) => {
    const res = await apiContext.put(`${API}/rbac/users/${userId}/departments`, {
      headers: auth(superAdmin), data: { categoryIds },
    });
    expect(res.status()).toBe(200);
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    superAdmin = await login('admin@enlogada.com');
    admin = await login('clinicadmin@enlogada.com');
    cashier = await login('cashier@enlogada.com');

    const matrix = (await (await apiContext.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    cashierRoleId = matrix.roles.find((r) => r.name === 'Cashier').id;
    permissionIds = Object.fromEntries(matrix.permissions.map((p) => [p.name, p.id]));
    originalCashierIds = (matrix.rolePermissions.Cashier || []).map((n) => permissionIds[n]);
  });

  test.afterAll(async () => {
    // Always put the matrix back — a half-finished run must not leave the demo cashier unable to
    // take payments.
    if (cashierRoleId && originalCashierIds) await setCashierPermissions(originalCashierIds);
    await apiContext.dispose();
  });

  test('revoking a permission stops the endpoint behind it, on the same token', async () => {
    // Before: authorization passes, so this fails on the nonexistent visit instead — anything
    // other than 403 proves the permission gate let it through.
    const before = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(before.status(), 'cashier should get past authorization before the change').not.toBe(403);

    await setCashierPermissions(originalCashierIds.filter((id) => id !== permissionIds['billing:process']));

    // No re-login: authority is read from the database on every request.
    const after = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(after.status(), 'the revoked permission must now refuse the request').toBe(403);
  });

  test('the revocation is granular — neighbouring permissions still work', async () => {
    // billing:read was not touched, so the transaction log must stay reachable. A change that
    // takes out the whole module would be a blunt instrument, not delegation.
    const res = await apiContext.get(`${API}/payments/transactions`, { headers: auth(cashier) });
    expect(res.status()).toBe(200);
  });

  test('the change reaches the user without a re-login, which is what drives the sidebar', async () => {
    // The sidebar hides any destination whose permission the user lacks (canSee in
    // config/navigation.js), and it reads exactly this list — so asserting the list is asserting
    // the navigation, without needing a browser.
    const perms = await permissionsOf(cashier);
    expect(perms).not.toContain('billing:process'); // Billing Queue hidden
    expect(perms).toContain('billing:read');        // Transaction History still shown

    await setCashierPermissions(originalCashierIds);
    expect(await permissionsOf(cashier)).toContain('billing:process');
  });

  test('Admin is subject to the matrix; SuperAdmin bypasses it', async () => {
    // The separation the whole exercise was about. Admin holds neither rbac:manage nor
    // billing:process, and no longer bypasses the check that enforces them.
    const adminPerms = await permissionsOf(admin);
    expect(adminPerms).not.toContain('rbac:manage');
    expect(adminPerms).not.toContain('billing:process');

    const adminEdits = await apiContext.put(`${API}/rbac/roles/${cashierRoleId}/permissions`, {
      headers: auth(admin), data: { permissionIds: originalCashierIds },
    });
    expect(adminEdits.status(), 'only SuperAdmin decides who may do what').toBe(403);

    const adminPays = await apiContext.post(`${API}/payments`, {
      headers: auth(admin), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(adminPays.status(), 'the reviewer of the cash-up must not also be the transactor').toBe(403);

    // ...while keeping the oversight reads that make the restriction workable.
    const oversight = await apiContext.get(`${API}/reports/summary?startDate=2026-01-01&endDate=2030-01-01`, {
      headers: auth(admin),
    });
    expect(oversight.status()).toBe(200);
  });

  test('a permission cannot cross the staff/patient boundary', async () => {
    // The one line a tick can never move. Client holds `results:read` — legitimately, for their
    // own results — and still cannot open a departmental worklist, because authorizeStaff refuses
    // before the permission is ever consulted.
    //
    // Narrowed in [1.20.0] from "a permission cannot widen a role" to this. It used to be true of
    // every role pair: a lab account could not be given billing access however the matrix was
    // configured, which made the matrix a liar. Staff-to-staff crossing is now exactly what the
    // matrix is for. Staff-to-patient is not.
    const clientToken = await login('client@enlogada.com');
    const perms = await permissionsOf(clientToken);
    expect(perms, 'the client legitimately holds this, for their own records').toContain('results:read');

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: auth(clientToken) });
    expect(res.status(), 'holding the permission is not enough — this is a staff screen').toBe(403);
  });

  test('an exception for one account grants access without touching anyone else', async () => {
    // The case the user hit: tick a cashier permission for a lab account and expect it to work.
    // It silently did nothing, because the route and the sidebar both carried a hardcoded role
    // list a permission could not widen.
    const lab = await login('lab@enlogada.com');
    const labAccount = (await accounts()).find((a) => a.email === 'lab@enlogada.com');

    const before = await apiContext.post(`${API}/payments`, {
      headers: auth(lab), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(before.status(), 'the lab role does not include billing').toBe(403);

    await setOverrides(labAccount.id, [{ permissionId: permissionIds['billing:process'], effect: 'grant' }]);

    // Same token. Authority is read from the database on every request.
    const after = await apiContext.post(`${API}/payments`, {
      headers: auth(lab), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(after.status(), 'authorized now — 404 is the nonexistent visit, not the gate').not.toBe(403);

    // The role template is untouched, so the other diagnostic accounts are unaffected.
    const xray = await login('xray@enlogada.com');
    const neighbour = await apiContext.post(`${API}/payments`, {
      headers: auth(xray), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(neighbour.status(), 'an exception is for one person, not their whole role').toBe(403);

    await setOverrides(labAccount.id, []);
    expect(await permissionsOf(lab)).not.toContain('billing:process');
  });

  test('a revoke beats the role template, and department access is its own axis', async () => {
    const lab = await login('lab@enlogada.com');
    const labAccount = (await accounts()).find((a) => a.email === 'lab@enlogada.com');

    // Revoke something the Laboratory Staff role does grant.
    await setOverrides(labAccount.id, [{ permissionId: permissionIds['results:release'], effect: 'revoke' }]);
    expect(await permissionsOf(lab), 'revoke wins over the role').not.toContain('results:release');
    await setOverrides(labAccount.id, []);
    expect(await permissionsOf(lab), 'clearing the exception restores the role default').toContain('results:release');

    // Departments are separate: holding results:read is not enough to open another room's work.
    const wrongRoom = await apiContext.get(`${API}/results/pending/Xray`, { headers: auth(lab) });
    expect(wrongRoom.status(), 'a lab account does not cover X-Ray').toBe(403);

    const xrayCategory = (await categories()).find((c) => c.name === 'Xray');
    await setDepartments(labAccount.id, [xrayCategory.id]);
    const covered = await apiContext.get(`${API}/results/pending/Xray`, { headers: auth(lab) });
    expect(covered.status(), 'granted the department, the same account may now cover it').toBe(200);

    await setDepartments(labAccount.id, []);
    const revoked = await apiContext.get(`${API}/results/pending/Xray`, { headers: auth(lab) });
    expect(revoked.status()).toBe(403);
  });
});
