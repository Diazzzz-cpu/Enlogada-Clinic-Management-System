// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';

/**
 * "Who sees what" — SuperAdmin assigns access on the grid Steven chose. [1.78.0]
 *
 * He asked twice that the screen for assigning roles be the grid from the decisions page: a row for
 * each kind of information, a column for each kind of staff, a mark and a sentence in every cell.
 * It replaced 32 checkboxes named after permission strings.
 *
 * What these hold: the grid reads like the picture, a switch says in words what it will change and
 * nothing is saved until Save, Save really changes what the role may do, and the one decision that
 * belongs to SuperAdmin alone is not switchable here. Enforcement itself is rbac-enforcement.spec.js;
 * this is the screen that sets it.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Who sees what', () => {
  let ctx;
  let token;
  let receptionRoleId;
  let originalReceptionIds;

  const matrix = async () =>
    (await (await ctx.get(`${API}/rbac/matrix`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'admin@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const m = await matrix();
    const idOf = Object.fromEntries(m.permissions.map((p) => [p.name, p.id]));
    receptionRoleId = m.roles.find((r) => r.name === 'Receptionist').id;
    originalReceptionIds = (m.rolePermissions.Receptionist || []).map((name) => idOf[name]);
  });

  test.afterAll(async () => {
    // Always put the front desk back: a half-finished run must not leave reception able to see takings.
    if (receptionRoleId && originalReceptionIds) {
      await ctx.put(`${API}/rbac/roles/${receptionRoleId}/permissions`, {
        headers: { Authorization: `Bearer ${token}` }, data: { permissionIds: originalReceptionIds },
      });
    }
    await ctx?.dispose();
  });

  const openGrid = async (page) => {
    await signInTo(page, 'admin@enlogada.com', 'Super Admin');
    const grid = page.getByTestId('who-sees-what');
    await expect(grid).toBeVisible({ timeout: 20000 });
    return grid;
  };
  const openRow = (grid, area) => grid.locator(`[data-testid="who-row"][data-area="${area}"] button[aria-expanded]`).click();

  test('the grid reads like the picture: a row per kind of information, a column per kind of staff', async ({ page }) => {
    const grid = await openGrid(page);
    for (const column of ['Front desk', 'Cashier', 'Lab, X-Ray, Ultrasound', 'Admin']) {
      await expect(grid.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    const money = grid.locator('[data-testid="who-row"][data-area="money"]');
    await expect(money.locator('[data-column="till"]')).toContainText('take payments');
    await expect(money.locator('[data-column="desk"]')).toContainText("can't see takings");
    await expect(money.locator('[data-column="admin"]')).toContainText("can't take payments");
  });

  test('a switch says in words what it will change, and Save changes the role for real', async ({ page }) => {
    const grid = await openGrid(page);
    await openRow(grid, 'money');

    const takings = grid.getByRole('checkbox', { name: 'Front desk: See takings, bills and receipts' });
    await expect(takings).toHaveAttribute('aria-checked', 'false');
    await takings.click();
    await expect(takings).toHaveAttribute('aria-checked', 'true');

    const changes = page.getByTestId('who-changes');
    await expect(changes).toContainText('Front desk can now see takings, bills and receipts.');
    // Nothing has reached the server yet.
    expect((await matrix()).rolePermissions.Receptionist).not.toContain('billing:read');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(changes).toContainText('Saved', { timeout: 15000 });
    expect((await matrix()).rolePermissions.Receptionist).toContain('billing:read');
  });

  test('Discard puts every switch back and saves nothing, and a lone holder is warned about', async ({ page }) => {
    const grid = await openGrid(page);
    await openRow(grid, 'money');

    const takePayments = grid.getByRole('checkbox', { name: 'Cashier: Take payments and issue receipts' });
    await expect(takePayments).toHaveAttribute('aria-checked', 'true');
    await takePayments.click();

    const changes = page.getByTestId('who-changes');
    await expect(changes).toContainText('Cashier can no longer take payments and issue receipts.');
    // The cashier is the only role that takes money, so the screen says who would be left.
    await expect(changes).toContainText('only SuperAdmin could take payments and issue receipts');

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(takePayments).toHaveAttribute('aria-checked', 'true');
    await expect(changes).toContainText('No unsaved changes');
    expect((await matrix()).rolePermissions.Cashier).toContain('billing:process');
  });

  test('who sees what itself stays with SuperAdmin', async ({ page }) => {
    const grid = await openGrid(page);
    await openRow(grid, 'staff');
    const row = grid.locator('[data-testid="who-permission"][data-permission="rbac:manage"]');
    await expect(row).toContainText('SuperAdmin only');
    await expect(row.getByRole('checkbox')).toHaveCount(0);
  });

  test('the three departments move together, and can each have a column', async ({ page }) => {
    const grid = await openGrid(page);
    await openRow(grid, 'results');
    await expect(grid.getByRole('checkbox', { name: 'Lab, X-Ray, Ultrasound: Release a result to the patient' }))
      .toHaveAttribute('aria-checked', 'true');

    await grid.getByRole('button', { name: 'Each department' }).click();
    for (const column of ['Laboratory', 'X-Ray', 'Ultrasound']) {
      await expect(grid.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    await expect(grid.getByRole('checkbox', { name: 'X-Ray: Release a result to the patient' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  test('an exception for one person is still made under One person', async ({ page }) => {
    await openGrid(page);
    await page.getByRole('tab', { name: 'One person' }).click();
    await expect(page.getByLabel('Staff member')).toBeVisible();
    await expect(page.getByTestId('who-sees-what')).toHaveCount(0);
  });

  test('"Who sees what" is said once on the screen', async ({ page }) => {
    // The tab names the grid; the panel under it does not say it again.
    const grid = await openGrid(page);
    await expect(page.getByText('Who sees what', { exact: true })).toHaveCount(1);
    await expect(grid.getByRole('heading')).toHaveCount(0);
  });
});
