// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * Choosing what to book, from the patient's side. [1.54.0]
 *
 * The portal's booking dialog carried its OWN test list — 65 services in a 176px scroll box,
 * ungrouped and unsearchable — while reception used the shared `TestPicker`. Two lists for one
 * job, and they had drifted: the portal's never offered PACKAGES at all.
 *
 * That is not a cosmetic gap. The clinic sells five fixed-price bundles precisely because they
 * cost less than buying the same work test by test. Reception could sell one; a patient booking
 * online could not buy one. The cheaper option existed and was reachable only by telephone.
 *
 * Both screens share one control now, so the lists cannot drift again, and the picker collapses
 * by department instead of asking a patient to scroll past every blood test to reach an X-ray.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

/** Heights of every disclosure in the dialog — 0 when collapsed, its content height when open. */
const disclosureHeights = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] .disclosure')].map((d) => ({
      open: d.dataset.open === 'true',
      height: Math.round(d.getBoundingClientRect().height),
    }))
  );

async function openBooking(page) {
  await signIn(page, 'client@enlogada.com');
  await page.getByRole('button', { name: 'Book Schedule' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder(/filter tests/i)).toBeVisible({ timeout: 15000 });
  return dialog;
}

test.describe('Booking: choosing what to book', () => {
  test('one department is open and the rest are clipped away', async ({ page }) => {
    const dialog = await openBooking(page);

    // Exactly one open, deliberately. Everything collapsed is right for browsing and wrong for
    // working — reception attaches tests dozens of times a day and should not have to click a
    // header to see a single checkbox. Everything OPEN is the 65-row scroll box this replaced.
    const rows = await disclosureHeights(page);
    expect(rows.length, 'the picker should render collapsible sections').toBeGreaterThan(1);

    const open = rows.filter((d) => d.open);
    expect(open.length, 'exactly one section should start open').toBe(1);
    expect(open[0].height, 'the open section must actually show its tests').toBeGreaterThan(100);

    // Collapsed means CLIPPED, not merely styled. `display` is untouched and the rows are still in
    // the DOM, so only a measured height proves they are not occupying the picker.
    expect(
      rows.filter((d) => !d.open).every((d) => d.height === 0),
      'every other section must be clipped to zero'
    ).toBeTruthy();

    // And a closed DEPARTMENT opens on demand. Scoped by name rather than by position: the
    // package rows carry `aria-expanded` too, for their own "what's included" control, so
    // `button[aria-expanded="false"]` first-match is a package and not a department at all.
    const closedDept = dialog
      .locator('button[aria-expanded="false"]')
      .filter({ hasText: /Laboratory|Ultrasound|X-?ray|ECG/i })
      .first();
    await expect(closedDept, 'there should be a second department to open').toBeVisible();
    await closedDept.click();

    await expect
      .poll(async () => (await disclosureHeights(page)).filter((d) => d.open).length, { timeout: 5000 })
      .toBe(2);
  });

  test('searching opens every section, so a match is never hidden behind a collapsed header', async ({ page }) => {
    const dialog = await openBooking(page);
    await dialog.getByPlaceholder(/filter tests/i).fill('blood');

    // A filter that leaves its own matches collapsed reads as "no results" — the search would be
    // lying about the catalogue. The headers are disabled while searching for the same reason:
    // nothing should be closeable back over a result.
    await expect
      .poll(async () => {
        const rows = await disclosureHeights(page);
        return rows.length > 0 && rows.filter((d) => d.open).every((d) => d.height > 0);
      }, { timeout: 5000 })
      .toBeTruthy();

    await expect(dialog.getByText(/Blood Typing/i).first()).toBeVisible();
  });

  test('a patient is offered the clinic\'s package deals', async ({ page }) => {
    const ctx = await request.newContext();
    const active = (await (await ctx.get(`${API}/packages`)).json()).data.packages;
    await ctx.dispose();
    test.skip(active.length === 0, 'Need at least one active package — run seedRealCatalogue.js.');

    const dialog = await openBooking(page);
    await expect(dialog.getByText(/Package deals/i)).toBeVisible();

    for (const p of active) {
      await expect(
        dialog.getByText(p.name, { exact: false }).first(),
        `${p.name} must be offered to the patient, not only to reception`
      ).toBeVisible();
    }

    // Compact by default: the components are one click away, not printed inline. Five bundles of
    // six-to-nine tests each filled the picker before the individual list even began.
    const first = active[0];
    const details = dialog.getByRole('button', { name: new RegExp(`What is included in ${first.name}`, 'i') });
    await expect(details).toBeVisible();
  });

  test('a package booked from the portal bills its fixed price', async ({ page }) => {
    const ctx = await request.newContext();
    const active = (await (await ctx.get(`${API}/packages`)).json()).data.packages;
    test.skip(active.length === 0, 'Need an active package.');
    const pkg = active[0];
    await ctx.dispose();

    const dialog = await openBooking(page);

    // A far-out weekday, so this never competes for a slot another spec claimed.
    const d = new Date();
    d.setDate(d.getDate() + 200 + (Date.now() % 30));
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    await dialog.locator('#slotpicker-label').fill(date);
    // The first BOOKABLE slot, not the first slot. [1.62.0]
    //
    // This took the first `[data-testid^="slot-"]` and clicked it. On a day whose 08:00 had
    // already been taken — by an earlier spec in the same run, or by a previous run, since this
    // date is quasi-random and nothing claims it — that button renders disabled, and Playwright
    // retried the click for the full timeout before failing with "element is not enabled".
    //
    // Observed exactly once in a full-suite run and not reproducible afterwards, because
    // `Date.now() % 30` had moved the date on by the time it was re-run. That is the signature
    // CLAUDE.md warns about under "A booking spec must claim its own slot": a booking test that
    // does not own its slot fails intermittently and blames whatever changed most recently.
    const slot = dialog.locator('[data-testid^="slot-"]:not([disabled])').first();
    await expect(slot).toBeVisible({ timeout: 15000 });
    await slot.click();

    // The package's own checkbox, addressed through its row rather than by position.
    await dialog.getByRole('checkbox').first().check();

    await dialog.getByRole('button', { name: /2\. HMO/i }).click();
    const submit = dialog.getByRole('button', { name: /submit schedule request/i });
    await expect(submit).toBeVisible({ timeout: 10000 });
    await submit.click();

    await expect(dialog.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });

    // The confirmation quotes the amount owed. A package bills its FIXED price — that is the whole
    // reason it exists — so the figure must be the package's, never the sum of its parts.
    const owed = dialog.locator('[data-testid="booking-awaiting-payment"]');
    await expect(owed).toBeVisible();
    const shown = await dialog.innerText();
    const fixed = Number(pkg.price).toLocaleString('en-US', { minimumFractionDigits: 2 });
    expect(shown, `the booking should be billed at the package price ${fixed}`).toContain(fixed);
  });
});
