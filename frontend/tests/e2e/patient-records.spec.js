// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * The patient roster: browse it, filter it, archive from it. [1.56.0]
 *
 * The screen was search-first with a bare `LIMIT 20` and no offset, so it opened on "search for a
 * patient to begin" and the 21st match was unreachable by any means. For a clinic of any age that
 * is most of the roster, and there was no way to simply LOOK at the records — which is what
 * somebody sitting down to review them wants.
 *
 * ── Archive is not delete, and that is the property worth guarding ──────────────────────────
 *
 * A patient row is the parent of their visits, their bills and their results. Deleting one would
 * either fail on the foreign keys or take a clinical and financial history with it, and a receipt
 * already issued must stay explicable. Archiving sets a nullable timestamp: the record leaves the
 * roster the front desk searches and nothing else changes.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

const roster = async (ctx, token, params = {}) => {
  const res = await ctx.get(`${API}/patients/search`, {
    headers: { Authorization: `Bearer ${token}` }, params,
  });
  expect(res.status()).toBe(200);
  return (await res.json()).data;
};

test.describe('Patient records', () => {
  test('opens on the roster, paged at the server', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');

    // No query at all. This used to be a 400.
    const first = await roster(ctx, sup, { page: 1, limit: 5 });
    expect(first.total, 'browsing must return the whole roster count').toBeGreaterThan(0);
    expect(first.patients.length).toBeLessThanOrEqual(5);

    if (first.total > 5) {
      const second = await roster(ctx, sup, { page: 2, limit: 5 });
      expect(second.page).toBe(2);
      expect(
        second.patients[0].id,
        'page 2 must be different rows — the old form could not reach them at all'
      ).not.toBe(first.patients[0].id);
    }

    // The tracking columns the table reads. A visit count says they came; a released count says
    // there is something to read, and they are different questions.
    const row = first.patients[0];
    for (const field of ['visit_count', 'test_count', 'released_count', 'last_visit_at', 'last_released_at']) {
      expect(row, `the row must carry ${field}`).toHaveProperty(field);
    }

    await ctx.dispose();
  });

  test('a one-character query is refused, a blank one browses', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');

    // A single letter matches most of a roster — a scan wearing a search box.
    const short = await ctx.get(`${API}/patients/search`, {
      headers: { Authorization: `Bearer ${sup}` }, params: { q: 'a' },
    });
    expect(short.status()).toBe(400);

    const blank = await roster(ctx, sup, { q: '' });
    expect(blank.total).toBeGreaterThan(0);

    await ctx.dispose();
  });

  test('the date filter matches on when they were last SEEN', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');

    const all = await roster(ctx, sup, { limit: 100 });
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dated = await roster(ctx, sup, { from: iso, to: iso, limit: 100 });

    expect(dated.total, 'a one-day window cannot exceed the whole roster').toBeLessThanOrEqual(all.total);

    // Half a range is a filter the reader did not intend.
    const half = await ctx.get(`${API}/patients/search`, {
      headers: { Authorization: `Bearer ${sup}` }, params: { from: iso },
    });
    expect(half.status(), 'one date without the other must be refused').toBe(400);

    await ctx.dispose();
  });

  test('archiving hides a record without destroying anything', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');
    const auth = { Authorization: `Bearer ${sup}` };

    const before = await roster(ctx, sup, { limit: 100 });
    const victim = before.patients[0];

    const archived = await ctx.patch(`${API}/patients/${victim.id}/archive`, {
      headers: auth, data: { archived: true },
    });
    expect(archived.status()).toBe(200);

    const after = await roster(ctx, sup, { limit: 100 });
    expect(after.patients.some((p) => p.id === victim.id), 'archived records leave the roster').toBeFalsy();
    expect(after.total).toBe(before.total - 1);

    // Nothing was destroyed — the record is still there when asked for.
    const withArchived = await roster(ctx, sup, { limit: 100, includeArchived: 'true' });
    const found = withArchived.patients.find((p) => p.id === victim.id);
    expect(found, 'the record still exists').toBeTruthy();
    expect(found.archived_at).toBeTruthy();
    expect(
      Number(found.visit_count),
      'its visits are untouched — archive is not delete'
    ).toBe(Number(victim.visit_count));

    // Put it back, so this test leaves the roster as it found it.
    expect((await ctx.patch(`${API}/patients/${victim.id}/archive`, {
      headers: auth, data: { archived: false },
    })).status()).toBe(200);
    const restored = await roster(ctx, sup, { limit: 100 });
    expect(restored.patients.some((p) => p.id === victim.id)).toBeTruthy();

    await ctx.dispose();
  });

  test('only Admin and SuperAdmin may archive, or see what is archived', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');
    const rec = await login(ctx, 'receptionist@enlogada.com');
    const lab = await login(ctx, 'lab@enlogada.com');

    const target = (await roster(ctx, sup, { limit: 1 })).patients[0];

    // Deliberately gated by ROLE, not by patients:update — Reception holds that permission, and
    // correcting a misspelt surname is a different act from taking a record out of the roster.
    for (const [who, token] of [['Receptionist', rec], ['Laboratory', lab]]) {
      expect((await ctx.patch(`${API}/patients/${target.id}/archive`, {
        headers: { Authorization: `Bearer ${token}` }, data: { archived: true },
      })).status(), `${who} must not archive a record`).toBe(403);
    }

    // And asking to see archived records does not make them visible to someone who cannot restore
    // one — reading the archive is reading records deliberately taken out of circulation.
    const recView = await roster(ctx, rec, { limit: 100, includeArchived: 'true' });
    expect(recView.canArchive).toBeFalsy();
    expect(recView.patients.every((p) => !p.archived_at)).toBeTruthy();

    await ctx.dispose();
  });

  test('the screen opens on records rather than on a prompt', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Patient Records' }).first().click();

    // It used to render "Search for a patient to begin" and nothing else.
    await expect(page.locator('[data-testid="patient-row"]').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Most recently seen first/i)).toBeVisible();
    await expect(page.getByText('Show archived')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' }).first()).toBeVisible();
  });
});
