// @ts-check
import { expect } from 'playwright/test';
import { DOCTOR_REQUEST_PNG } from './booking.js';

/**
 * The patient portal's tabs and its booking button, named in one place. [1.80.0]
 *
 * Fifteen lines across nine specs clicked a portal tab or "Book Schedule" by its words, so the
 * redesign's renames — "Diagnostic Results" to "Results", "Book Schedule" to "Book a visit", and a
 * Home tab first — would have had to be found in nine files. A spec asks for a tab by what it IS;
 * this file says what it is called. src/components/portal/portalTabs.js holds the same words for
 * the app.
 */
export const PORTAL_TABS = {
  home: 'Home',
  appointments: 'Appointments',
  results: 'Results',
  payments: 'Payments',
  profile: 'Profile',
};

export const BOOK_BUTTON = 'Book a visit';

/** Open a portal tab by what it is: `openPortalTab(page, 'appointments')`. */
export async function openPortalTab(page, key) {
  const name = PORTAL_TABS[key];
  if (!name) throw new Error(`No portal tab "${key}". Known: ${Object.keys(PORTAL_TABS).join(', ')}`);
  await page.getByRole('tab', { name, exact: true }).click({ timeout: 20000 });
}

/**
 * Open the booking dialog, and hand it back once it is on screen.
 *
 * "Book a visit" is on Home and on Appointments. [1.81.0] From any other tab this goes Home first,
 * the way a patient would; the old hero put the button above every tab, and a spec that walked the
 * tabs first found no button on the last one.
 */
export async function openBooking(page) {
  const book = page.getByRole('button', { name: BOOK_BUTTON });
  if (!(await book.first().isVisible())) await openPortalTab(page, 'home');
  await book.first().click({ timeout: 20000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * The booking wizard's second step, by its pill. It was "2. HMO / Payment Note", then "2. Doctor's
 * Request & HMO" [1.106.0], and is "2. HMO & Doctor's Notes" since [1.107.0] put who pays first.
 */
export const BOOKING_STEP_TWO = /^2\. HMO & Doctor's Notes/i;

/**
 * Go to step 2 and attach the doctor's signed request. [1.106.0] Required on an HMO booking and
 * optional for self-pay [1.107.0]; a spec that attaches it either way still books.
 *
 * The pill rather than the Next button: the pill is always in view, while Next sits below a
 * catalogue of 60-odd tests. Waits for the preview, because the dialog prepares the image before
 * it will send it, and a submit made before that is refused for a missing file.
 */
export async function attachDoctorRequest(dialog) {
  await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
  await dialog.getByLabel(/doctor's request/i).setInputFiles({
    name: 'doctor-request.png',
    mimeType: 'image/png',
    buffer: DOCTOR_REQUEST_PNG,
  });
  await expect(dialog.getByAltText("The doctor's request you attached")).toBeVisible({ timeout: 10000 });
}
