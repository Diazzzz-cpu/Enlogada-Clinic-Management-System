// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';

// A failed request must never render as an empty one. [1.28.0]
//
// empty-state.jsx was written for exactly this and says so in its own docstring: "A receptionist
// looking at an empty queue cannot tell 'nobody is waiting' from 'the request failed and nobody
// told you', and those call for opposite responses." Six screens then shipped without wiring the
// error branch, so a 500 fell through to the empty one and the app made confident false
// statements about the clinic's own data:
//
//   Staff Accounts      "No staff accounts yet — add the first Receptionist"   (there are six)
//   Reports / Today     "Today's Revenue PHP 0.00, +0% vs yesterday"           (it took 8,344.28)
//   Cashier Monitoring  "Collections in range PHP 0.00"                        (same)
//   Services Catalog    "No diagnostic services found"                         (there are fifteen)
//   Public services     "No Active Services"                                   (to a stranger)
//
// The money ones are the reason this is a spec and not a style note. A manager reading
// "PHP 0.00" concludes the clinic took nothing today; they do not conclude the server is down.
//
// Driven by route interception so it needs no broken backend and touches no data.

const PASSWORD = 'Password123!';

/** Sign in, THEN break the API — otherwise the login itself fails and nothing is tested. */
async function signInThenBreakApi(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForTimeout(2500);

  // Auth and the reference lookups stay up: killing those signs the user out, which would prove
  // nothing about how a screen reports its own failure.
  await page.route('**/api/**', (route) => {
    if (/\/api\/(auth|notifications|tests\/categories|patients\/types|discounts|clinic)/.test(route.request().url())) {
      return route.continue();
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
    });
  });
}

const ADMIN_SCREENS = [
  { nav: 'Staff Accounts', mustNotSay: /no staff accounts yet/i },
  { nav: 'Cashier Monitoring', mustNotSay: /₱0\.00/ },
  { nav: 'Services Catalog', mustNotSay: /no diagnostic services|no hmo providers yet/i },
  { nav: 'Appointments', mustNotSay: /no appointments booked/i },
  { nav: 'Service Requests', mustNotSay: /no hmo requests logged/i },
];

for (const { nav, mustNotSay } of ADMIN_SCREENS) {
  test(`${nav} reports a server failure instead of rendering as empty`, async ({ page }) => {
    await signInThenBreakApi(page, 'admin@enlogada.com');

    await page.getByRole('button', { name: nav, exact: true }).first().click();
    await page.waitForTimeout(2200);

    const body = await page.evaluate(() => document.body.innerText);

    // It must SAY something went wrong…
    expect(body, `${nav} failed silently`).toMatch(/could not|unavailable|failed|try again/i);
    // …and must not make the empty-state claim, or state a figure it does not have.
    expect(body, `${nav} still renders its empty state over a 500`).not.toMatch(mustNotSay);
  });
}

test("the Reports snapshot refuses to state a revenue figure it could not load", async ({ page }) => {
  await signInThenBreakApi(page, 'admin@enlogada.com');
  await page.getByRole('button', { name: 'Reports', exact: true }).first().click();
  await page.waitForTimeout(2200);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/unavailable|could not/i);
  // The specific falsehood: a peso total and a comparison against yesterday, both invented from
  // state that initialises to zero.
  expect(body, 'a revenue figure was shown for data that never arrived').not.toMatch(/₱0\.00/);
  expect(body).not.toMatch(/vs yesterday/i);
});

// The screens sign-in lands on. [1.74.0]
//
// Each role's first screen opens with counters that start at zero, and a failed load left them
// there: the till read "Collected Today ₱0.00" and "Nothing awaiting payment", the front desk
// "Active Queue Visits 0". The last
// is the most confident possible way to be wrong about a panic value.
//
// Reloaded after breaking the API, because a landing screen has already loaded once, successfully,
// by the time the route is intercepted. The nav click covers a role that lands somewhere else.
const LANDING_SCREENS = [
  {
    email: 'cashier@enlogada.com', screen: 'Billing Queue',
    mustSay: [/couldn.t load the billing queue/i, /collected today\s+—/i],
    mustNotSay: [/₱0\.00/, /nothing awaiting payment/i, /\b0 waiting\b/i],
  },
  {
    // The Desk since [1.75.0]: one line of counts, and today's bookings in the Who's here box.
    email: 'receptionist@enlogada.com', screen: 'Desk',
    mustSay: [/—\s+in the queue/i, /couldn.t load today's bookings/i],
    mustNotSay: [/(^|\s)0\s+in the queue/i, /showing 0 of 0/i, /nobody is waiting/i, /no bookings left to arrive/i],
  },
  {
    // "Couldn't check" and "Nothing outstanding" were the Critical Callbacks tile's two
    // captions, and that tile went with the callback feature in [1.95.0]. What this screen
    // still has to prove is the property the whole file is about: a failed count reads as a
    // dash, never as 0.
    email: 'lab@enlogada.com', screen: 'Laboratory Worklist',
    mustSay: [/awaiting exam\s+—/i],
    mustNotSay: [/awaiting exam\s+0\b/i, /nothing waiting in/i],
  },
];

for (const { email, screen, mustSay, mustNotSay } of LANDING_SCREENS) {
  test(`the ${screen} counters say they could not load, not zero`, async ({ page }) => {
    await signInThenBreakApi(page, email);
    await page.reload();
    await page.getByRole('button', { name: screen, exact: true }).first().click({ timeout: 20000 });
    await page.waitForTimeout(2200);

    const body = await page.evaluate(() => document.body.innerText);
    expect(body, `${screen} failed silently`).toMatch(/could not|couldn.t|unavailable|failed|try again/i);
    for (const pattern of mustSay) expect(body, `${screen} should say ${pattern}`).toMatch(pattern);
    for (const pattern of mustNotSay) expect(body, `${screen} stated ${pattern} over a 500`).not.toMatch(pattern);
  });
}

// The patient's own bookings. [1.80.0]
//
// useMyAppointments logged a failed load and carried on, so the Appointments tab told a patient
// holding a paid booking for tomorrow "No appointments booked yet." — the one sentence that sends
// them to book the slot they already have. Only this request is broken, so the rest of the portal
// loads and the failure has nowhere to hide.
test("a patient's Appointments say they could not load, not that none are booked", async ({ page }) => {
  await signIn(page, 'client@enlogada.com');
  await page.route('**/api/appointments/my-bookings**', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
  }));
  await page.reload();
  await openPortalTab(page, 'appointments');

  await expect(page.getByText(/couldn.t load your appointments/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/no appointments booked/i)).toHaveCount(0);
});

// Today, where every member of staff lands since [1.77.0]. Its figures start empty and each of its
// lists could say "nothing"; over a 500 each has to say what it could not load instead, and "Needs
// you now" has to say what it could not check rather than that nothing needs anyone.
const TODAY_FAILURES = [
  {
    who: 'The front desk', email: 'receptionist@enlogada.com',
    mustSay: [/couldn.t check[^.]*the queue/i, /couldn.t load today's bookings/i, /with the cashier\s+—/i],
    mustNotSay: [/nothing needs you/i, /no bookings today/i],
  },
  {
    who: 'The cashier', email: 'cashier@enlogada.com',
    mustSay: [/couldn.t check who is waiting to pay/i, /couldn.t load today's takings/i],
    mustNotSay: [/nothing needs you/i, /₱0\.00/],
  },
  {
    who: 'The laboratory', email: 'lab@enlogada.com',
    mustSay: [/released today\s+—/i],
    mustNotSay: [/nothing needs you/i, /released today\s+0\b/i],
  },
  {
    who: 'The clinic', email: 'admin@enlogada.com',
    mustSay: [/revenue today\s+—/i, /couldn.t load the departments/i],
    mustNotSay: [/nothing needs you/i, /₱0\.00/],
  },
];

for (const { who, email, mustSay, mustNotSay } of TODAY_FAILURES) {
  test(`${who}'s Today says what it could not check, not that nothing needs them`, async ({ page }) => {
    await signInThenBreakApi(page, email);
    await page.reload();
    await expect(page.getByTestId('today-needs')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2200);

    const body = await page.evaluate(() => document.body.innerText);
    for (const pattern of mustSay) expect(body, `${who}'s Today should say ${pattern}`).toMatch(pattern);
    for (const pattern of mustNotSay) expect(body, `${who}'s Today stated ${pattern} over a 500`).not.toMatch(pattern);
  });
}

test('the public services page does not tell a stranger the clinic offers nothing', async ({ page }) => {
  // No sign-in: this is the one page with no account behind it, so nobody internal ever sees it
  // fail, and it is the page a prospective patient judges the clinic by.
  await page.route('**/api/tests**', (route) => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Services', exact: true }).first().click();
  await page.waitForTimeout(2500);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/unavailable/i);
  expect(body, 'told a prospective patient there are no services').not.toMatch(/No Active Services/i);
  // And still offers a way through, because somebody who cannot read the price list can ring up.
  expect(body).toMatch(/call us on/i);
});

// The fifth state: a filter matching nothing, which is NOT the same as nothing existing.
//
// "Nothing awaiting payment" while seven people are waiting and the search matched none of them
// is false, and it sends the cashier to ask Reception why the queue is empty instead of clearing
// their own filter. Every queue in the app has a search or a status chip, so every one of them
// can reach this state.
const NO_MATCH = 'zzzznomatchzzzz';

const FILTERED_QUEUES = [
  { email: 'cashier@enlogada.com', nav: 'Billing Queue', placeholder: /search ticket # or name/i,
    says: /no tickets match/i, mustNotSay: /nothing awaiting payment/i },
  // On the Desk the Who's here box is the queue's search. [1.75.0]
  { email: 'receptionist@enlogada.com', nav: 'Desk', placeholder: /name, queue # or reference/i,
    says: /no visits match/i, mustNotSay: /nobody is waiting/i },
  { email: 'lab@enlogada.com', nav: 'Laboratory Worklist', placeholder: /search patient, test, queue/i,
    says: /nothing matches/i, mustNotSay: /nothing waiting in/i },
  { email: 'admin@enlogada.com', nav: 'Staff Accounts', placeholder: /search name, email, or role/i,
    says: /no staff match/i, mustNotSay: /no staff accounts yet/i },
];

for (const { email, nav, placeholder, says, mustNotSay } of FILTERED_QUEUES) {
  test(`${nav} says "no match" rather than "empty" when a search filters everything out`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill(PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).last().click();
    await page.waitForTimeout(2500);

    const navButton = page.getByRole('button', { name: nav, exact: true }).first();
    if (await navButton.isVisible().catch(() => false)) {
      await navButton.click();
      await page.waitForTimeout(1500);
    }

    await page.getByPlaceholder(placeholder).first().fill(NO_MATCH);
    await page.waitForTimeout(1800);

    const body = await page.evaluate(() => document.body.innerText);
    expect(body, `${nav} did not distinguish a filtered-out list`).toMatch(says);
    expect(body, `${nav} claims to be empty while a filter is active`).not.toMatch(mustNotSay);
  });
}
