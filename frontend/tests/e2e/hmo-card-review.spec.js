// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { selfPayProfile } from './helpers/patients.js';

// The two screens the HMO card feature added, driven through the browser rather than the API.
//
// Both are inside dialogs, which is why the API tests in booking-atomicity.spec.js do not reach
// them: the card upload lives in step 2 of the client's booking wizard, and the preview lives in
// the Admin's claim review. A card that uploads correctly and is then rendered as a broken image
// on the one screen where somebody approves coverage is a working feature that fails at its job.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

// 1x1 PNG, so the server's MIME filter sees a genuine image.
const CARD_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

// Same shape as laboratory.spec.js — the login form has no <label for>, so it is addressed by
// input type rather than by accessible name.

test.describe('HMO card evidence (UI)', () => {
  test('the booking wizard asks a client for a card photo only when they claim HMO', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await signIn(page, 'client@enlogada.com');

    await page.getByRole('button', { name: 'Book Schedule' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Step 1 -> step 2. The card field belongs to the HMO branch of step 2, so getting there is
    // the whole point of walking the wizard rather than asserting on a rendered fragment.
    await dialog.getByRole('button', { name: /next: hmo/i }).click();

    // Self-Pay is the default: no card field, because there is no claim to evidence.
    await expect(dialog.getByText(/photo of your hmo card/i)).toHaveCount(0);

    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option').nth(1).click(); // first real provider, after "Self-Pay / None"

    await expect(dialog.getByText(/photo of your hmo card/i)).toBeVisible();
    await expect(dialog.getByText(/claiming hmo coverage requires a photo/i)).toBeVisible();

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  // The booking wizard's date/slot control was extracted so the reschedule dialog could reuse it.
  // That refactor is invisible to the API tests, so this walks the wizard far enough to prove the
  // shared component still fetches availability and still gates step 2 behind a chosen slot.
  test('the shared slot picker still drives the booking wizard', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await signIn(page, 'client@enlogada.com');
    await page.getByRole('button', { name: 'Book Schedule' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const when = new Date();
    when.setDate(when.getDate() + 120);
    // Saturday too, not just Sunday: the clinic is open 08:00-17:00 on weekdays but only
    // 08:00-12:00 on a Saturday, so a booking spec that lands there has 8 slots instead of 18
    // and starts failing on the day of the week rather than on anything in the app.
    while (when.getDay() === 0 || when.getDay() === 6) when.setDate(when.getDate() + 1);
    const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;

    await dialog.locator('input[type="date"]').fill(date);

    // Slots are fetched by the component itself now, not by the page.
    // Slot buttons carry a data-testid holding the 24-hour value; the visible label is a
    // 12-hour clock. Matching the testid keeps this about "a slot button exists". [1.36.0]
    const slot = dialog.locator('[data-testid^="slot-"]').first();
    await expect(slot).toBeVisible({ timeout: 10000 });
    await slot.click();

    await dialog.getByRole('button', { name: /next: hmo/i }).click();
    await expect(dialog.getByText(/hmo provider/i).first()).toBeVisible();

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('the Admin claim review renders the card image behind the claim', async ({ page }) => {
    // Seeded through the API: driving the client's file picker as well as the Admin's review in
    // one test would be testing the browser, not the feature.
    const ctx = await request.newContext();
    const token = async (email) => {
      const r = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
      return (await r.json()).data.token;
    };
    const clientToken = await token('client@enlogada.com');
    const auth = { Authorization: `Bearer ${clientToken}` };

    const patientId = selfPayProfile(
      (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth })).json()).data.patients
    ).id;
    const testId = (await (await ctx.get(`${API}/tests`)).json()).data.tests[0].id;
    const providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth })).json())
      .data.providers[0].id;

    // Far out, and offset per run, so this never collides with another spec's slot or its own
    // previous run — a repeat of the same patient/date/time returns the existing booking.
    const when = new Date();
    when.setDate(when.getDate() + 500 + (Date.now() % 40));
    while (when.getDay() === 0 || when.getDay() === 6) when.setDate(when.getDate() + 1);
    const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
    const slots = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth })).json())
      .data.slots.filter((s) => s.available);
    test.skip(!slots.length, 'No available slot to book.');

    const form = new FormData();
    form.append('patientId', String(patientId));
    form.append('scheduledDate', date);
    form.append('scheduledTime', slots[0].time);
    form.append('testIds[]', String(testId));
    form.append('hmo[providerId]', String(providerId));
    form.append('referringPhysician', 'Dr. E2E Referrer'); // mandatory on a claim since [1.23.0]
    form.append('hmoCard', new Blob([CARD_PNG], { type: 'image/png' }), 'card.png');

    const booked = await ctx.post(`${API}/appointments`, { headers: auth, multipart: form });
    expect(booked.status()).toBe(201);
    const claim = (await booked.json()).data.hmoRequest;
    expect(claim.card_file_path).toBeTruthy();
    await ctx.dispose();

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, 'admin@enlogada.com');

    await page.getByText('Service Requests', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Service & HMO Requests' })).toBeVisible();

    // The claim just filed is the newest, and the list is ORDER BY request_date DESC — so the
    // first Review button opens it. The row itself carries no id to match on.
    await page.getByRole('button', { name: 'Review' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('HMO Card')).toBeVisible();

    // The assertion that matters: an <img> that actually decoded. A broken image is still an
    // <img> in the DOM, so visibility alone would pass on the bug this guards.
    const img = dialog.getByAltText(/hmo card/i);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
