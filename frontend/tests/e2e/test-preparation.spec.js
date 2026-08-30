// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';

/**
 * Preparation is composed, not retyped. [1.54.0]
 *
 * `tests.preparation` was a free-text box, and free text drifts. Measured on the clinic's own
 * catalogue: 61 active services, 16 carrying preparation, and among those 16 only FOUR distinct
 * sentences — two of which say the same thing in different words:
 *
 *     "…an hour before your appointment and do not empty your bladder."  Chest Ultrasound, Thyroid
 *     "…an hour before and do not empty your bladder."     KUB, Lower Abdomen, Pelvic Ultrasound
 *
 * That is not untidiness. The booking wizard de-duplicates preparation by TEST ID, not by
 * sentence, so a patient booking a Pelvic Ultrasound and a Thyroid scan together is shown both
 * lines — one instruction, printed twice, worded differently, reading as two requirements.
 *
 * The column still stores a sentence, so nothing downstream changed: sendAppointmentReminders.js
 * carries this string, the confirmation email prints it, the wizard shows it.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

test.describe('Test preparation', () => {
  test('two tests needing the same thing say the same thing', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Services Catalog' }).first().click();
    await expect(page.getByText(/All Categories/i).first()).toBeVisible({ timeout: 20000 });

    // Open the first service for editing.
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await expect(dialog.getByText('Full bladder needed')).toBeVisible();

    // Ticking a requirement composes the wording — the editor is not asked to phrase it.
    const preview = dialog.getByText(/The patient will be told/i);
    await expect(preview).toBeVisible();

    await dialog.getByText('Full bladder needed').click();
    await expect(
      dialog.getByText(/do not empty your bladder/i),
      'ticking the requirement should compose its sentence'
    ).toBeVisible();

    // Fasting carries a value, because the number genuinely differs between tests.
    await dialog.getByText('Fasting required').click();
    await expect(dialog.getByText(/Nothing to eat or drink except water for \d+ hours/i)).toBeVisible();
  });

  test('an unrecognised instruction is never silently dropped', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Services Catalog' }).first().click();
    await expect(page.getByText(/All Categories/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Some preparation is genuinely specific. A form that cannot express it would push people
    // back to writing the whole thing by hand, which is what this replaces.
    const specific = 'Stop your metformin for 48 hours before the scan.';
    await dialog.getByPlaceholder(/metformin/i).fill(specific);

    // Scoped to the PREVIEW, not to the text anywhere in the dialog: the sentence is also in the
    // textarea the tester just typed it into, so a bare text match finds two and proves neither.
    await expect(
      dialog.locator('[data-testid="preparation-preview"]'),
      'free text must survive into what the patient is told'
    ).toContainText(specific);
  });

  test('the column still stores a plain sentence, so the reminder keeps working', async () => {
    // The composer produces TEXT. If it ever started storing structure, every downstream reader —
    // the day-before reminder, the confirmation email, the booking wizard — would render an object
    // and the patient would be told nothing at all.
    const ctx = await request.newContext();
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    await ctx.dispose();

    const prepared = tests.filter((t) => t.preparation);
    expect(prepared.length, 'some services should carry preparation').toBeGreaterThan(0);

    for (const t of prepared) {
      expect(typeof t.preparation, `${t.name}: preparation must be a string`).toBe('string');
      expect(t.preparation.trim().length).toBeGreaterThan(0);
    }
  });
});
