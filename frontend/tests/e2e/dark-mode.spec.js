// @ts-check
import { test, expect } from 'playwright/test';

/**
 * Dark mode. [1.39.0]
 *
 * Three properties, and the first is the one that would reach a patient.
 *
 * A RECEIPT PRINTED IN DARK MODE MUST STILL BE BLACK ON WHITE. The print rules toggle
 * `visibility`, which does not touch `color`, and browsers drop background colours when printing
 * — so a naive dark theme sends near-white text to an 80mm thermal printer and the cashier hands
 * over a blank slip. The guarantee is structural: every dark selector lives inside `@media
 * screen`, so print can never match one. This asserts the outcome rather than the mechanism,
 * because a future `dark:` class added to a printable component would defeat the mechanism
 * without touching it.
 *
 * THE CHOICE MUST SURVIVE A RELOAD, and reach the page before React does — index.html stamps the
 * attribute during head parse precisely so a dark-mode user does not get a white flash for the
 * length of the auth round trip.
 *
 * AND IT MUST BE REACHABLE FROM EVERY SHELL. This app has three and no router; a toggle in one
 * leaves whole roles without it.
 */

const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };

/**
 * Presses the theme control until it reports the preference asked for.
 *
 * The control cycles rather than offering three targets, so a spec that clicked a fixed number of
 * times would be encoding the cycle order — and would fail the day someone reorders it for a
 * reason that has nothing to do with what these tests assert. It reads `data-preference` off the
 * button instead, which is the state, not the route to it.
 */
async function setTheme(page, want) {
  const toggle = page.getByTestId('theme-toggle').first();
  for (let i = 0; i < 4; i += 1) {
    if (await toggle.getAttribute('data-preference') === want) return;
    await toggle.click();
    await page.waitForTimeout(120);
  }
  throw new Error(`theme control never reached '${want}'`);
}

// [1.139.0] On SCREEN too. A receipt and a report are paper, white in both themes, so their ink
// must stay dark: the ramp it draws with was remapped light, and the receipt's patient, number,
// services and amount read as near-white on white. `.paper` puts the light ramp back.
test('paper on screen keeps dark ink in dark mode; the rest of the page does not', async ({ page }) => {
  await page.goto('/');
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colours = await page.evaluate(() => {
    const paper = document.createElement('div');
    paper.className = 'paper bg-white';
    paper.innerHTML = '<p class="text-slate-900" id="on-paper">RCT-1</p><p class="text-slate-500" id="on-paper-muted">Cashier</p>';
    const off = document.createElement('p');
    off.className = 'text-slate-900';
    off.id = 'off-paper';
    document.body.append(paper, off);
    const lum = (id) => {
      const [r, g, b] = getComputedStyle(document.getElementById(id)).color.match(/\d+(\.\d+)?/g).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    return { onPaper: lum('on-paper'), muted: lum('on-paper-muted'), offPaper: lum('off-paper') };
  });
  expect(colours.onPaper, 'the receipt text is dark on its white paper').toBeLessThan(0.2);
  expect(colours.muted, 'and its muted captions are still mid-grey, not near-white').toBeLessThan(0.55);
  expect(colours.offPaper, 'off paper, the same class is light, as dark mode should be').toBeGreaterThan(0.8);
});

test('a receipt printed in dark mode is still black on white', async ({ page }) => {
  await page.goto('/');
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Stand in a print area rather than driving a real checkout: this is a CSS guarantee, and
  // tying it to a payment would make it fail for reasons that are not about printing.
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'print-area';
    el.id = 'print-probe';
    el.innerHTML = '<p class="text-slate-900" id="print-probe-text">TOTAL 800.00</p>';
    document.body.appendChild(el);
  });

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    background: getComputedStyle(document.getElementById('print-probe')).backgroundColor,
    color: getComputedStyle(document.getElementById('print-probe-text')).color,
    stillDark: document.documentElement.getAttribute('data-theme'),
  }));
  await page.emulateMedia({ media: 'screen' });

  // The page is still in dark mode — this is not the theme being switched off, it is print
  // refusing to see it.
  expect(printed.stillDark).toBe('dark');
  expect(printed.background, 'a printed receipt must have a white ground').toBe('rgb(255, 255, 255)');
  expect(printed.color, 'and dark ink, or the slip comes out blank').toBe('rgb(15, 23, 42)');
});

test('the choice survives a reload, and applies before React mounts', async ({ page }) => {
  await page.goto('/');
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  // Asserted without waiting for the app: the inline script in index.html sets this during head
  // parse, so it is true before anything renders. That is what prevents the white flash.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await setTheme(page, 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the toggle is reachable from the public site and from a staff console', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByTestId('theme-toggle'), 'public header').toHaveCount(1);

  await page.getByText('Sign In', { exact: true }).first().click();
  await expect(page.getByTestId('theme-toggle'), 'sign-in shares the public header').toHaveCount(1);

  await page.fill('input[type="email"]', CASHIER.email);
  await page.fill('input[type="password"]', CASHIER.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/billing|terminal|queue/i).first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId('theme-toggle'), 'staff console top bar').toHaveCount(1);
});
