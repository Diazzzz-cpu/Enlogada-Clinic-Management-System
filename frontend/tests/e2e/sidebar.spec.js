// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * The sidebar earns its space. [1.76.0]
 *
 * Steven said the front desk's and the cashier's sidebar "looks lacking": built for Admin's twenty
 * screens, it gave a three-screen role a logo, a few links and an empty dark column. The "Useful"
 * rail he chose from the gallery keeps the same shell and adds what the people at those screens
 * look for: whether the clinic is open, the screen's most-used action, and the number waiting on
 * each screen. It also moves Patient Records out from under a "Management" heading that made the
 * front desk look as though it had been handed a management screen.
 *
 * What these hold is mostly the contract, not the paint: nav buttons keep their exact names with a
 * count beside them, a count is the number its screen shows, and an action is on screen once.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('The sidebar', () => {
  test('the front desk sees whether the clinic is open, and Patient Records under its own heading', async ({ page }) => {
    await signIn(page, 'receptionist@enlogada.com');
    const rail = page.getByRole('complementary');

    // Open or closed depends on the clock; that it says one of them does not.
    await expect(rail.getByText(/^(Open now|Closed now|Closed today)$/)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-nav-group="Front Desk"] [data-nav-id="patient-records"]')).toHaveCount(1);
    await expect(page.locator('[data-nav-group="Management"]')).toHaveCount(0);
  });

  test('an Admin keeps Patient Records under Management, with everything else it manages', async ({ page }) => {
    await signIn(page, 'clinicadmin@enlogada.com');
    await expect(page.locator('[data-nav-group="Management"] [data-nav-id="patient-records"]'))
      .toHaveCount(1, { timeout: 15000 });
  });

  test("Today carries no counts; the Desk's count is the number the Desk shows, and its button keeps its name", async ({ page }) => {
    // Something to count: a walk-in of our own in today's queue.
    const ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'receptionist@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const H = { Authorization: `Bearer ${token}` };
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: H,
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-04-02', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const visit = await ctx.post(`${API}/visits`, {
      headers: H, data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e sidebar count' },
    });
    expect(visit.status()).toBe(201);
    await ctx.dispose();

    // Sign-in lands on Today, which states these numbers itself, beside the button that deals with
    // each. The rail carries none of its own there: it would be the same fact twice. [1.83.0] The
    // walk-in above means the Desk has something to count, so a badge here would show.
    await signIn(page, 'receptionist@enlogada.com');
    await expect(page.getByTestId('today-needs')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-nav-count]'), 'no counts beside Today').toHaveCount(0);

    // The Desk's own screen shows it, and it is the number the Desk shows.
    await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
    const badge = page.locator('[data-nav-id="reception-queue"] [data-nav-count]');
    await expect(badge).toHaveText(/^\d+$/, { timeout: 15000 });

    const inQueue = page.getByLabel('Today at the desk').locator('b').first();
    await expect(inQueue).toHaveText(/^\d+$/, { timeout: 15000 });
    await expect(badge).toHaveText(await inQueue.innerText());

    // The count is aria-hidden: the button is still exactly "Desk".
    await expect(page.getByRole('button', { name: 'Desk', exact: true })).toBeVisible();
  });

  test('Register Walk-In is in the rail on a desk screen and in the page on a phone — once each', async ({ page }) => {
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    const register = page.getByRole('button', { name: 'Register Walk-In', exact: true });

    await expect(page.getByRole('complementary').getByRole('button', { name: 'Register Walk-In', exact: true }))
      .toBeVisible({ timeout: 15000 });
    await expect(register).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('main').getByRole('button', { name: 'Register Walk-In', exact: true })).toBeVisible();
    await expect(register).toHaveCount(1);
  });

  test('the cashier opens a receipt by its number from the rail', async ({ page }) => {
    await signInTo(page, 'cashier@enlogada.com', 'Billing Queue');
    await page.getByRole('complementary').getByRole('button', { name: 'Find a receipt' }).click({ timeout: 15000 });

    // The URL is the contract: the receipt page itself is covered by receipt-lookup.spec.js.
    await page.getByLabel('Receipt number').fill('rct-e2e-0001');
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Open receipt' }).click();
    await expect(await popup).toHaveURL(/[?&]receipt=RCT-E2E-0001$/);
  });
});
