// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * What actually comes out of the printer. [1.52.0]
 *
 * The receipt looked perfect on screen and printed the clinic's name followed by a blank sheet,
 * then a second blank sheet. Nothing in the suite could see it, because everything the suite
 * asserted was true: the document rendered, the values were right, the dialog opened. The defect
 * lived entirely in `@media print`, which no test had ever evaluated.
 *
 * Measured, the receipt was being laid out inside the DIALOG rather than on the page:
 *
 *   position: fixed    a fixed element is a containing block for absolutely-positioned
 *                      descendants, so `.print-area { top: 0 }` resolved against the dialog
 *   max-height: 648px  clipped a 644px receipt to a box whose own height measured 56px
 *   overflow-y: auto   scrolling means nothing on paper; it just hides the remainder
 *
 * Undoing those moved it to top:720, left:-635 — off the page and below the fold, because
 * `visibility: hidden` KEEPS layout: the whole application still occupied the first sheet and the
 * receipt was queued up after it. That second wrong answer is why printing is now done by
 * lib/printArea.js, which copies the element to a child of <body> and `display: none`s everything
 * else — no containing block to resolve against, no layout left to push it down.
 *
 * This test evaluates the print stylesheet, which is the only way any of that is visible.
 */

const PHRASE_AT_THE_BOTTOM = /Printed/i;

/** Reproduce exactly what printElement does, without opening a real print dialog. */
async function isolateForPrint(page) {
  await page.evaluate(() => {
    const target = document.querySelector('.print-area');
    if (!target) throw new Error('no .print-area to print');
    document.getElementById('print-root')?.remove();
    const host = document.createElement('div');
    host.id = 'print-root';
    host.appendChild(target.cloneNode(true));
    document.body.appendChild(host);
    document.body.classList.add('printing-isolated', 'printing-receipt');
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
}

async function measure(page) {
  return page.evaluate(() => {
    const pa = document.querySelector('#print-root .print-area');
    const r = pa.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      docHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      otherVisible: [...document.body.children]
        .filter((el) => el.id !== 'print-root' && getComputedStyle(el).display !== 'none').length,
      text: pa.innerText.replace(/\s+/g, ' '),
    };
  });
}

/** The three properties that were each individually wrong at some point. */
function assertPrintable(m, where) {
  expect(m.top, `${where}: the receipt must start at the top of the page, not inside a dialog`).toBe(0);

  expect(
    m.otherVisible,
    `${where}: nothing but the receipt may occupy the printed page — display:none, not visibility:hidden, or the app keeps its layout and pushes the receipt onto a second sheet`
  ).toBe(0);

  // The whole document, not just the header. This is the assertion that would have caught the
  // original bug: the clinic name printed and everything under it was clipped away.
  expect(m.text, `${where}: the receipt must print in full, not just its letterhead`)
    .toMatch(PHRASE_AT_THE_BOTTOM);
  expect(m.height, `${where}: a clipped receipt measures far shorter than it renders`).toBeGreaterThan(300);
}

test.describe('Receipt printing', () => {
  test('printing from the cashier dialog puts the whole receipt on the page', async ({ page }) => {
    await signIn(page, 'cashier@enlogada.com');
    await page.getByRole('button', { name: 'Transaction History' }).first().click();

    const reprint = page.getByRole('button', { name: 'Reprint' }).first();
    await expect(reprint).toBeVisible({ timeout: 20000 });
    await reprint.click();
    await expect(page.locator('.print-area')).toBeVisible({ timeout: 15000 });

    await isolateForPrint(page);
    const m = await measure(page);
    assertPrintable(m, 'dialog');

    // One sheet. The original defect spilled onto a second, blank one.
    expect(m.docHeight, 'the receipt should not overflow onto a second sheet')
      .toBeLessThanOrEqual(Math.max(m.viewport, m.height + 80));
  });

  test('printing from the standalone receipt page works the same way', async ({ page }) => {
    await signIn(page, 'cashier@enlogada.com');

    // Reach a real receipt number through the log, so this never hard-codes one.
    await page.getByRole('button', { name: 'Transaction History' }).first().click();
    const open = page.getByRole('button', { name: 'Open' }).first();
    await expect(open).toBeVisible({ timeout: 20000 });
    const number = await page.locator('td, [data-label="Receipt #"]')
      .filter({ hasText: /^RCT-/ }).first().innerText();

    await page.goto(`/?receipt=${encodeURIComponent(number.trim())}`);
    await expect(page.locator('.print-area')).toBeVisible({ timeout: 20000 });

    await isolateForPrint(page);
    assertPrintable(await measure(page), 'standalone page');
  });
});
