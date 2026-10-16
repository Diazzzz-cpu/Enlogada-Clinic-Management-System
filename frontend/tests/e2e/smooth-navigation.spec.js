// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * The sidebar stays put. [1.128.0]
 *
 * Every console drew its own sidebar, so a click from Today to Patient Records, the Desk, the till
 * or a worklist rebuilt the whole shell: the rail's scroll jumped to the top (taking the item just
 * clicked out from under the mouse), the counts beside each screen vanished and came back, and the
 * page slid up as if it had reloaded. Steven: "when i click the left navigation as an admin it
 * reload like move".
 *
 * App mounts one shell for the session now. These hold what that buys: the same rail element
 * across every console, its scroll where it was, a new screen opening at its top, and each
 * console's own rail action arriving and leaving with it.
 */

const rail = (page) => page.locator('aside').filter({ has: page.locator('[data-testid="nav-item"]') });
const clickNav = (page, id) => rail(page).locator(`[data-nav-id="${id}"]`).click();

test('the rail is one element across every console, and what was clicked stays under the mouse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await signIn(page, 'admin@enlogada.com');
  await expect(rail(page)).toBeVisible({ timeout: 20000 });

  await rail(page).evaluate((el) => el.setAttribute('data-probe', 'same-rail'));

  // Today -> Patient Records -> Desk -> Billing Queue -> a worklist -> Services Catalog -> Reports:
  // six different consoles, each of which used to bring its own shell.
  for (const id of ['patient-records', 'reception-queue', 'cashier-queue', 'lab-ops', 'services-cat', 'reports']) {
    // Bring the item into view first, as a person scrolls to it, so the reading below is the
    // rail's own doing and not the click's scroll-into-view.
    const item = rail(page).locator(`[data-nav-id="${id}"]`);
    await item.scrollIntoViewIfNeeded();
    const box = await item.boundingBox();
    const before = box.y;
    // A mouse click where the item is, as a person clicks: a locator click scrolls again first.
    await page.mouse.click(box.x + 24, box.y + box.height / 2);
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('aside[data-probe="same-rail"]'), `${id}: the rail was rebuilt`).toHaveCount(1);
    // Including when the screen brings or takes away a rail action above the list.
    await page.waitForTimeout(400);
    expect(Math.abs((await item.boundingBox()).y - before), `${id}: the item moved under the mouse`).toBeLessThan(1);
  }
});

test('a new screen opens at its top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await signIn(page, 'admin@enlogada.com');
  await clickNav(page, 'reports');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
  // Reports is long once its figures arrive; scroll it down.
  await expect.poll(async () => {
    await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    return main.evaluate((el) => el.scrollTop);
  }, { timeout: 20000 }).toBeGreaterThan(0);

  await clickNav(page, 'patient-records');
  await expect(rail(page).locator('[data-nav-id="patient-records"]')).toHaveAttribute('aria-current', 'page');
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
});

test("a console's rail action arrives and leaves with it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@enlogada.com');
  await expect(rail(page)).toBeVisible({ timeout: 20000 });

  // The Desk puts Register Walk-In in the rail [1.76.0]; Patient Records puts nothing there.
  await clickNav(page, 'reception-queue');
  await expect(rail(page).getByRole('button', { name: 'Register Walk-In' })).toBeVisible({ timeout: 20000 });

  await clickNav(page, 'patient-records');
  await expect(rail(page).getByRole('button', { name: 'Register Walk-In' })).toHaveCount(0);

  await clickNav(page, 'reception-queue');
  await expect(rail(page).getByRole('button', { name: 'Register Walk-In' })).toHaveCount(1);
});
