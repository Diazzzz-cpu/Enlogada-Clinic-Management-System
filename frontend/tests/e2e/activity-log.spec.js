// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';

/**
 * The Activity Log is activity, and a migration's archive is shown on request. [1.111.0]
 *
 * Removing the typed result forms wrote 33 archive entries into audit_log in one go — every typed
 * value and every signatory, kept because the tables holding them were dropped. They buried a
 * morning's refunds and corrections. They are hidden from the feed by default and reachable with
 * "Show archived records"; never deleted, because on the clinic's database they are the only copy.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const ARCHIVE_ACTIONS = ['result.measurements_archived', 'clinic.signatory_archived', 'result.critical_flag_retired'];

test('archive entries are left out of the feed unless asked for, and both counts add up', async () => {
  const ctx = await request.newContext();
  const login = await ctx.post(`${API}/auth/login`, { data: { email: 'admin@enlogada.com', password: 'Password123!' } });
  const headers = { Authorization: `Bearer ${(await login.json()).data.token}` };

  const feed = (await (await ctx.get(`${API}/admin/activity`, { headers, params: { limit: 100 } })).json()).data;
  expect(feed.entries.some((e) => ARCHIVE_ACTIONS.includes(e.action)), 'an archive entry in the default feed').toBe(false);

  const all = (await (await ctx.get(`${API}/admin/activity`, { headers, params: { limit: 100, archives: 'true' } })).json()).data;
  expect(all.total).toBeGreaterThanOrEqual(feed.total);
  await ctx.dispose();
});

test('the screen offers the archive behind one switch', async ({ page }) => {
  await signInTo(page, 'admin@enlogada.com', 'Activity Log');
  const toggle = page.getByLabel('Show archived records');
  await expect(toggle).toBeVisible({ timeout: 20000 });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/result measurements archived/i)).toHaveCount(0);
  await toggle.check();
  await expect(toggle).toBeChecked();
});
