// @ts-check
import { test, expect } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';

// The patient journey on a phone. [1.26.0]
//
// Staff sit at desks; patients do not. Online booking, the QR pass presented at the counter and
// the released report are all things somebody does on a 390px screen, and none of it had ever
// been checked at that width — every existing browser spec runs at the default desktop viewport.
//
// The two failure modes worth guarding are the ones that make an app unusable rather than ugly:
// a page that scrolls sideways, and a control that cannot be reached at all.

const PHONE = { width: 390, height: 844 }; // iPhone 14 / 15, the common floor

/** Sign in the way somebody on a phone has to: through the hamburger. */

test.use({ viewport: PHONE });

test('a patient can sign in and reach their bookings on a phone', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signInOnPhone(page, 'client@enlogada.com');

  // Every tab has to be reachable, not merely present. A tab strip that overflows its container
  // silently drops the last items off the right edge.
  for (const tab of ['Diagnostic Results', 'Appointments', 'Payments', 'Profile']) {
    const trigger = page.getByRole('tab', { name: tab });
    await expect(trigger, `${tab} tab should exist`).toHaveCount(1);
    await trigger.click();
    await page.waitForTimeout(600);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('no screen in the patient journey scrolls sideways on a phone', async ({ page }) => {
  test.setTimeout(90000);
  await signInOnPhone(page, 'client@enlogada.com');

  const overflowOf = () => page.evaluate(() => {
    const d = document.documentElement;
    // scrollbar-gutter makes clientWidth exceed scrollWidth, which reads as negative overflow.
    // Only a positive difference is a page the user has to drag sideways.
    return Math.max(0, d.scrollWidth - d.clientWidth);
  });

  for (const tab of ['Diagnostic Results', 'Appointments', 'Payments', 'Profile']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(700);
    expect(await overflowOf(), `${tab} overflows horizontally`).toBe(0);
  }

  // And the booking dialog, which is the densest thing a patient opens.
  await page.getByRole('button', { name: 'Book Schedule' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await overflowOf(), 'the booking dialog overflows horizontally').toBe(0);

  // The date popover, which is the widest fixed-size thing in that dialog. [1.34.0]
  //
  // The app's own calendar replaced the browser's picker, and a browser picker could never
  // overflow the page because the browser drew it outside the document. Ours cannot borrow that
  // guarantee: it is an absolutely-positioned element in the layout, 280px wide, inside a dialog
  // on a 390px screen. Right-aligned for exactly this reason, and asserted here rather than
  // reasoned about — a control that pushes the page sideways is one of the two failure modes
  // this file exists to catch.
  await page.getByRole('button', { name: 'Open calendar' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await overflowOf(), 'the date popover overflows horizontally').toBe(0);

  // And it must close again without taking the booking dialog with it — the popover and the
  // dialog both listen for Escape, and the inner one has to win.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeHidden();
  await expect(page.getByRole('dialog').first()).toBeVisible();
});

// The staff worklists at phone width. [1.29.0]
//
// Measured at 390px, these were six and seven columns wide inside a 346px scroller — the
// reception queue was 1070px of table, so five of its seven columns could only be reached by
// dragging sideways, on the screen the front desk works from all day. Scrolling inside the panel
// keeps the PAGE from overflowing, which is the rule the layout notes actually state, and does
// nothing at all for the person trying to read a row.
//
// `<Table stack>` turns a row into a card below `sm`. This asserts the outcome — no sideways drag
// — rather than the mechanism, and checks the desk view is untouched, because the failure mode of
// a responsive rule is breaking the width it was not written for.
const STAFF_TABLES = [
  { email: 'receptionist@enlogada.com', nav: 'Active Queue' },
  { email: 'receptionist@enlogada.com', nav: 'Visit History' },
  { email: 'cashier@enlogada.com', nav: 'Transaction History' },
  { email: 'lab@enlogada.com', nav: 'Laboratory Worklist' },
  { email: 'admin@enlogada.com', nav: 'Staff Accounts' },
  { email: 'admin@enlogada.com', nav: 'Cashier Monitoring' },
];

const signIn = async (page, email) => {
  await page.goto('/');
  const burger = page.getByRole('button', { name: /menu|navigation/i }).first();
  if (await burger.isVisible().catch(() => false)) await burger.click();
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill('Password123!');
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForTimeout(2600);
};

const openNav = async (page, nav) => {
  const burger = page.getByRole('button', { name: /menu|navigation/i }).first();
  if (await burger.isVisible().catch(() => false)) { await burger.click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: nav, exact: true }).first().click();
  await page.waitForTimeout(2200);
};

for (const { email, nav } of STAFF_TABLES) {
  test(`${nav} needs no sideways dragging on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, email);
    await openNav(page, nav);

    const overflow = await page.evaluate(() => {
      const t = document.querySelector('table');
      if (!t) return null;
      return Math.round(t.scrollWidth - t.parentElement.clientWidth);
    });
    // null means the screen renders no table at this width, which is also fine.
    if (overflow !== null) {
      expect(overflow, `${nav} still drags ${overflow}px sideways`).toBeLessThanOrEqual(2);
    }
    // And the page itself must not scroll sideways either.
    const pageOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(2);
  });
}

test('the desk view still renders a real table, not a stack of cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'cashier@enlogada.com');
  await openNav(page, 'Transaction History');

  // The header is visible at desk width — it is only clipped when stacked.
  const headerVisible = await page.evaluate(() => {
    const thead = document.querySelector('table thead');
    if (!thead) return false;
    return thead.getBoundingClientRect().height > 4;
  });
  expect(headerVisible, 'the column header vanished at desk width').toBe(true);
});
