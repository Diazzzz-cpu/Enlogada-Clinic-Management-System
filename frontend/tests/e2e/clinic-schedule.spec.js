// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { nthWorkingDay } from './helpers/dates.js';

/**
 * The clinic's diary: its hours, its capacity, and closing one specific date. [1.57.0]
 *
 * `clinic_operating_hours` had been read by booking since the first release and written by nothing
 * — no route, no screen. So the clinic could not close for a holiday, could not shorten a day, and
 * could not say "one sonographer today, half the ultrasound slots". The booking grid went on
 * offering slots the clinic could not honour, and somebody telephoned every patient who took one.
 *
 * Four properties, and each has failed in a way worth naming:
 *
 *   A CLOSURE REACHES THE PATIENT   the whole point. An override the availability endpoint ignores
 *                                   is a setting that lies to the administrator who set it.
 *   CAPACITY 0 IS A REAL VALUE      `??` not `||`. With `||` a deliberate "open, taking no online
 *                                   bookings" silently falls back to the weekday's number.
 *   THE DATE IS THE DATE            a DATE column arrives as a JS Date at local midnight, and
 *                                   toISOString() then names the day before in PHT. Measured:
 *                                   closing 2026-11-24 reported "2026-11-23 is now closed".
 *   AN OVERRIDE IS NOT THE PATTERN  closing next Thursday must not close every Thursday.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

test.describe('Clinic schedule', () => {
  let ctx; let sup;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  // Each test takes its own date. They share one database and one worker, and two tests
  // overriding the same date would silently overwrite each other through the ON CONFLICT.
  const DATES = {
    closure: nthWorkingDay(120),
    capacity: nthWorkingDay(127),
    hours: nthWorkingDay(134),
    pattern: nthWorkingDay(141),
    ui: nthWorkingDay(148),
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    sup = await login(ctx, 'admin@enlogada.com');
  });

  test.afterAll(async () => {
    // Leave the diary as we found it, or the next run books against a closed clinic.
    for (const date of Object.values(DATES)) {
      await ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(sup) });
    }
    await ctx.dispose();
  });

  const availability = async (date, token) =>
    (await (await ctx.get(`${API}/appointments/availability`, {
      headers: token ? auth(token) : undefined, params: { date },
    })).json()).data;

  test('closing a date reaches the patient, with the reason', async () => {
    const date = DATES.closure;
    const client = await login(ctx, 'client@enlogada.com');

    const before = await availability(date, client);
    expect(before.isOpen, 'pick a date the clinic is normally open on').toBeTruthy();
    expect(before.slots.length).toBeGreaterThan(0);

    const res = await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup),
      data: { date, isOpen: false, note: 'Holy Week' },
    });
    expect(res.status()).toBe(200);

    // The date in the confirmation is the date that was sent. This was off by one.
    const body = await res.json();
    expect(body.message, 'the reply must name the date the administrator chose').toContain(date);
    expect(body.data.override.override_date).toBe(date);

    const after = await availability(date, client);
    expect(after.isOpen, 'a closed date must be closed to the patient').toBeFalsy();
    expect(after.slots).toHaveLength(0);
    // Without the reason the patient reads a bare "closed" as a broken website.
    expect(after.note).toBe('Holy Week');
  });

  test('a capacity of zero is a real value, not a missing one', async () => {
    const date = DATES.capacity;
    const client = await login(ctx, 'client@enlogada.com');

    await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup),
      data: { date, isOpen: true, maxConcurrentBookings: 0, note: 'Walk-ins only today' },
    });

    const day = await availability(date, client);
    // Open — the grid still renders, and the note explains it.
    expect(day.isOpen).toBeTruthy();
    expect(day.slots.length, 'the day is open, so the slots exist').toBeGreaterThan(0);
    // But nothing is bookable. With `||` instead of `??` this reads as the weekday's capacity and
    // every slot comes back free, which is the opposite of what was asked for.
    expect(day.slots.filter((s) => s.available), 'zero capacity means nothing is free').toHaveLength(0);
    expect(day.note).toBe('Walk-ins only today');
  });

  test('shortened hours shrink the grid without touching the weekday', async () => {
    const date = DATES.hours;
    const client = await login(ctx, 'client@enlogada.com');

    const full = await availability(date, client);
    await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup),
      data: { date, isOpen: true, openTime: '08:00', closeTime: '10:00', note: 'Half day' },
    });

    const short = await availability(date, client);
    expect(short.slots.length).toBeGreaterThan(0);
    expect(short.slots.length, 'a two-hour window holds fewer slots than a full day')
      .toBeLessThan(full.slots.length);

    // Half a range is not a schedule — the builder would take the other half from the weekday and
    // produce a window nobody chose.
    expect((await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup), data: { date, isOpen: true, openTime: '09:00' },
    })).status(), 'one time without the other must be refused').toBe(400);

    expect((await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup), data: { date, isOpen: true, openTime: '17:00', closeTime: '08:00' },
    })).status(), 'closing before opening must be refused').toBe(400);
  });

  test('an override is not the pattern — and removing it restores the day', async () => {
    const date = DATES.pattern;
    const client = await login(ctx, 'client@enlogada.com');
    const sameWeekdayNextWeek = (() => {
      const d = new Date(`${date}T00:00:00`);
      d.setDate(d.getDate() + 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const normal = await availability(date, client);
    await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(sup), data: { date, isOpen: false, note: 'Staff training' },
    });

    // The same weekday, seven days later, is untouched. This is the mistake the two-layer design
    // exists to prevent: closing one Thursday by editing the Thursday row closes every Thursday.
    const nextWeek = await availability(sameWeekdayNextWeek, client);
    expect(nextWeek.isOpen, 'closing one date must not close its weekday').toBeTruthy();
    expect(nextWeek.slots.length).toBeGreaterThan(0);

    expect((await ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(sup) })).status()).toBe(200);

    const restored = await availability(date, client);
    expect(restored.isOpen).toBeTruthy();
    expect(restored.slots.length).toBe(normal.slots.length);

    // Removing one that is not there is a 404, not a silent success.
    expect((await ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(sup) })).status()).toBe(404);
  });

  test('who may read it, and who may change it', async () => {
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const lab = await login(ctx, 'lab@enlogada.com');
    const client = await login(ctx, 'client@enlogada.com');
    const date = DATES.ui;

    // Reception is asked "are we open on the 30th?" all day. Making them guess because the answer
    // lives behind an admin screen is how a patient gets told the wrong thing.
    for (const [who, token] of [['Receptionist', rec], ['Laboratory', lab]]) {
      expect((await ctx.get(`${API}/schedule/week`, { headers: auth(token) })).status(),
        `${who} must be able to read the schedule`).toBe(200);
      expect((await ctx.put(`${API}/schedule/overrides`, {
        headers: auth(token), data: { date, isOpen: false },
      })).status(), `${who} must not change when the clinic opens`).toBe(403);
    }

    // A patient reads the published diary, not the operational one. Capacity is not in it.
    expect((await ctx.get(`${API}/schedule/week`, { headers: auth(client) })).status()).toBe(403);

    const pub = await ctx.get(`${API}/schedule/public`);
    expect(pub.status(), 'the booking calendar must reach this while signed out').toBe(200);
    const data = (await pub.json()).data;
    expect(data.week).toHaveLength(7);
    expect(JSON.stringify(data), 'capacity is operational, not published')
      .not.toMatch(/maxConcurrent|max_concurrent/);
  });

  test('the screen edits the week and sets a date aside', async ({ page }) => {
    const date = DATES.ui;
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Clinic Schedule' }).first().click();

    // Seven weekdays, each with its own row.
    await expect(page.locator('[data-testid="schedule-day-1"]')).toBeVisible({ timeout: 20000 });
    for (let d = 0; d < 7; d += 1) {
      await expect(page.locator(`[data-testid="schedule-day-${d}"]`)).toBeVisible();
    }

    // Save is inert until something changes — the row would otherwise offer to write back exactly
    // what it read, which is an audit entry recording nothing.
    const monday = page.locator('[data-testid="schedule-day-1"]');
    await expect(monday.getByRole('button', { name: 'Save' })).toBeDisabled();
    await monday.getByLabel('Monday bookings per slot').fill('2');
    await expect(monday.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Set a date aside from the screen, and see it listed with its reason.
    await page.locator('#override-date').fill(date);
    await page.locator('#override-note').fill('Barangay fiesta');
    await page.getByRole('button', { name: 'Save date' }).click();

    const row = page.locator(`[data-testid="schedule-override-${date}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('Closed');
    await expect(row, 'the reason is what the patient will read').toContainText('Barangay fiesta');
  });
});
