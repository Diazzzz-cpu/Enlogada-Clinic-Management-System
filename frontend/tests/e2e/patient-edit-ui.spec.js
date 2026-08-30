// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';

// The correction dialog, driven through the browser.
//
// patient-edit.spec.js proves the rules; this proves somebody can reach them, and covers the two
// pieces of the design that are invisible to an API test: the warning that appears only when a
// clinical field is touched, and the fact that a diagnostic account is never offered the control
// at all.



async function searchPatients(page, term) {
  await page.getByText('Patient Records', { exact: true }).first().click();
  const search = page.getByPlaceholder(/search/i).first();
  await search.fill(term);
  await search.press('Enter');
  await expect(page.locator('[data-testid="patient-row"]').first()).toBeVisible({ timeout: 15000 });
}

test('reception corrects a record, and is warned when it matters', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signIn(page, 'receptionist@enlogada.com');
  await searchPatients(page, 'an');

  await page.locator('[data-testid="patient-row"]').first()
    .getByRole('button', { name: 'Correct' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Correct Patient Details')).toBeVisible();

  // Save is inert until something differs — a no-op write still lands in the audit log.
  const save = dialog.getByRole('button', { name: /save corrections/i });
  await expect(save).toBeDisabled();

  // Both values are made unique per run. Save is deliberately inert when nothing differs, so a
  // fixed value would leave the button disabled the second time this spec runs against the same
  // record — which looks like the button being broken rather than the guard working.
  const stamp = `${Date.now()}`.slice(-6);
  const newAddress = `Corrected Address ${stamp}, CDO`;

  // An administrative field changes nothing about how results are read, so no warning.
  await dialog.getByPlaceholder('Barangay, City, Province').fill(newAddress);
  await expect(save).toBeEnabled();
  await expect(dialog.getByText(/reference ranges are banded/i)).toHaveCount(0);

  // Touching the birthdate is different, and the dialog says so. Derived from the stamp, and
  // read back first so the "new" date is never the one already on the record.
  const dateInput = dialog.locator('input[type="date"]');
  const currentDob = await dateInput.inputValue();
  const year = 1960 + (Number(stamp) % 40);
  const newDob = `${year}-03-14` === currentDob ? `${year}-04-15` : `${year}-03-14`;

  await dateInput.fill(newDob);
  await expect(dialog.getByText(/reference ranges are banded by age and sex/i)).toBeVisible();
  await expect(dialog.getByText(/recorded against your account/i)).toBeVisible();

  await save.click();
  await expect(dialog).toBeHidden({ timeout: 10000 });

  // The list reflects the correction without needing another search. Re-opening the dialog is a
  // firmer check than reading a locale-formatted date out of the row.
  await page.locator('[data-testid="patient-row"]').first()
    .getByRole('button', { name: 'Correct' }).click();
  await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue(newDob);
  await expect(page.getByRole('dialog').getByPlaceholder('Barangay, City, Province'))
    .toHaveValue(newAddress);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('a diagnostic account is never offered the control', async ({ page }) => {
  // Lab staff hold patients:read and deliberately not patients:update. Hiding the button is not
  // the enforcement — the API refuses them either way — but a screen that offers a control the
  // server will reject is its own bug.
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signIn(page, 'lab@enlogada.com');
  await searchPatients(page, 'an');

  await expect(page.locator('[data-testid="patient-row"]').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct' })).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
