// @ts-check
import { test, expect, request } from 'playwright/test';

// The amendment chain, made visible. [1.63.0]
//
// [1.15.0] made results versioned — an amendment supersedes rather than overwrites — and shipped
// `GET /results/:visitTestId/versions` returning the whole chain with its reasons and clinicians.
// Nothing on the frontend ever called it. The history was recorded, queryable and invisible, so
// "this says something different from the copy I have" could only be answered from the database.
//
// What these guard is the pair of properties that make a superseded clinical value safe to show
// at all: it is unmistakably marked as withdrawn, and it never reaches the printed copy.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Result version history', () => {
  let ctx;
  let token;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const res = await ctx.post(`${API}/auth/login`, {
      data: { email: 'lab@enlogada.com', password: PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    token = (await res.json()).data.token;
  });

  test.afterAll(async () => { await ctx.dispose(); });

  /** The first released Laboratory result carrying more than one version, or null. */
  const findAmended = async () => {
    const res = await ctx.get(`${API}/results/released/Laboratory`, { headers: auth() });
    const rows = (await res.json()).data.released || [];
    return rows.find((r) => Number(r.version || 1) > 1) || null;
  };

  test('the chain comes back newest-first with exactly one current version', async () => {
    const amended = await findAmended();
    test.skip(!amended, 'Need an amended result — seedDemoScenario creates one.');

    const res = await ctx.get(`${API}/results/${amended.visit_test_id}/versions`, { headers: auth() });
    expect(res.status()).toBe(200);

    const { versions } = (await res.json()).data;
    expect(versions.length).toBeGreaterThan(1);

    // Newest first, so the live report leads. The UI trusts this order for its rail.
    const numbers = versions.map((v) => Number(v.version));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

    // Exactly one current. Two would mean a `WHERE ... is_current` read could return either, which
    // is the invariant the whole versioning design rests on.
    expect(versions.filter((v) => v.is_current)).toHaveLength(1);
    expect(versions[0].is_current, 'the newest version is the current one').toBeTruthy();

    // The superseded rows still carry their findings — that is the point of keeping them.
    expect(versions.some((v) => !v.is_current && v.findings)).toBeTruthy();
  });

  test('an amendment records WHY it was made', async () => {
    const amended = await findAmended();
    test.skip(!amended, 'Need an amended result.');

    const res = await ctx.get(`${API}/results/${amended.visit_test_id}/versions`, { headers: auth() });
    const { versions } = (await res.json()).data;

    // The reason sits on the version that INTRODUCED the change, not on the one replaced — a
    // reason is given when an amendment is made. So the original has none and at least one of the
    // later versions must.
    const withReason = versions.filter((v) => (v.amendment_reason || '').trim());
    expect(withReason.length, 'an amended report must say why').toBeGreaterThan(0);

    const original = versions.find((v) => Number(v.version) === 1);
    if (original) expect((original.amendment_reason || '').trim()).toBe('');
  });

  test('the history requires results:read — a patient cannot walk the chain', async () => {
    const amended = await findAmended();
    test.skip(!amended, 'Need an amended result.');

    const clientLogin = await ctx.post(`${API}/auth/login`, {
      data: { email: 'client@enlogada.com', password: PASSWORD },
    });
    const clientToken = (await clientLogin.json()).data.token;

    // authorizeStaff — a superseded finding is exactly the thing a patient must not be handed
    // unsupervised, and no permission tick crosses that line.
    const res = await ctx.get(`${API}/results/${amended.visit_test_id}/versions`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('the timeline renders, marks the withdrawn value, and stays off the printed copy', async ({ page }) => {
    const amended = await findAmended();
    test.skip(!amended, 'Need an amended result.');

    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('token', t), token);
    await page.goto('/');

    await page.getByText('Laboratory History').first().click();

    const row = page.locator('tr', { hasText: 'Amended' }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.getByRole('button').first().click();

    const timeline = page.getByRole('heading', { name: /Amendment history/i });
    await expect(timeline).toBeVisible({ timeout: 15000 });

    // The live version is labelled, and the older ones are labelled as withdrawn.
    await expect(page.getByText('Current', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Superseded', { exact: true }).first()).toBeVisible();

    // A superseded value is behind one click, and carries its own warning when opened — a reader
    // who scrolled straight to it must know what they are looking at.
    await page.getByRole('button', { name: /Show what it said/i }).last().click();
    await expect(page.getByText(/Superseded — do not act on this/i)).toBeVisible();

    // ── The property that matters most ──────────────────────────────────────────────────────
    // The handed-over copy is the CURRENT report. Printing a withdrawn value beside it is how
    // somebody acts on a figure that was retracted, so the whole timeline is `no-print`.
    const printsTimeline = await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')]
        .find((el) => /Amendment history/i.test(el.textContent || ''));
      return section ? section.classList.contains('no-print') : null;
    });
    expect(printsTimeline, 'the amendment history must never reach the printer').toBe(true);
  });
});
