// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';

/**
 * My Account: who the account is beside what can be changed. [1.120.0]
 *
 * Nothing is saved here: the seeded accounts are shared by the whole suite, and changing one's
 * password would end the sessions other specs hold. These hold how the screen behaves.
 */

const STAFF = 'receptionist@enlogada.com';

test('staff: the profile card, Save only after a change, and the password helpers', async ({ page }) => {
  await signIn(page, STAFF);
  await page.getByRole('button', { name: 'My Account' }).first().click({ timeout: 20000 });
  await expect(page.getByRole('heading', { level: 1, name: 'My Account', exact: true })).toBeVisible();

  const card = page.getByTestId('profile-card');
  await expect(card).toContainText('Receptionist');
  await expect(card.getByRole('button', { name: /Upload photo|Change photo/ })).toBeVisible();

  // The sign-in email is said once on the screen, not in the card and the form both.
  await expect(page.getByText(STAFF, { exact: true })).toHaveCount(1);

  const save = page.getByRole('button', { name: 'Save Changes' });
  await expect(save, 'nothing to save yet').toBeDisabled();
  const contact = page.locator('#account-contact');
  const before = await contact.inputValue();
  await contact.fill(`${before}9`);
  await expect(save).toBeEnabled();
  await expect(page.getByText('You have unsaved changes.')).toBeVisible();
  await contact.fill(before);
  await expect(save, 'back to what is saved').toBeDisabled();

  const change = page.getByRole('button', { name: 'Change Password' });
  await expect(change).toBeDisabled();
  await page.locator('#account-current-password').fill('Password123!');
  await page.locator('#account-new-password').fill('Another-pass-2026');
  await expect(page.locator('#account-new-password-strength')).toHaveText(/Good|Strong|Fair/);
  await page.locator('#account-confirm-password').fill('Another-pass');
  await expect(page.locator('#account-confirm-password-match')).toHaveText("Doesn't match yet");
  await page.locator('#account-confirm-password').fill('Another-pass-2026');
  await expect(page.locator('#account-confirm-password-match')).toHaveText('Passwords match');
  await expect(change).toBeEnabled();
});

test('patient: the same parts in the portal', async ({ page }) => {
  await signIn(page, 'client@enlogada.com');
  await openPortalTab(page, 'home');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByTestId('account-menu').getByRole('button', { name: 'My Account' }).click();
  await expect(page.getByTestId('profile-card')).toContainText('Patient');
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Change Password' })).toBeDisabled();
});
