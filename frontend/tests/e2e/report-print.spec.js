// @ts-check
import { test, expect } from 'playwright/test';
import { signInTo } from './helpers/auth.js';

/**
 * Every report prints as a document, never a blank sheet. [1.117.0]
 *
 * A print happens in `@media print`, which no other spec evaluates, so a print that comes out
 * blank passes every on-screen assertion. Patient Feedback's did exactly that: it printed an
 * element that was not a print area, and the print stylesheet hid all of it.
 *
 * So each test presses Print with the page under PRINT media and the browser's print dialog
 * replaced by a probe, and reads the sheet at the moment it would have printed: the document is
 * there and visible, it is the only thing on the page, it is on the A4 report page, and it says
 * which clinic, which report, which period and who prepared it.
 */

const ADMIN = 'clinicadmin@enlogada.com';

/** Press Print under print media and report what would have reached the paper. */
async function printAndRead(page) {
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({ timeout: 20000 });
  await page.evaluate(() => {
    window.__printed = null;
    window.print = () => {
      const doc = document.querySelector('#print-root .report-doc');
      const title = doc?.querySelector('.report-doc__title');
      window.__printed = {
        text: doc?.textContent || '',
        a4: document.body.classList.contains('printing-document'),
        // The foot of every page, written into @page while it prints. [1.118.0]
        footer: document.getElementById('report-page-footer')?.textContent || '',
        visible: Boolean(title) && getComputedStyle(title).visibility === 'visible' && getComputedStyle(doc).display !== 'none',
        height: doc ? doc.getBoundingClientRect().height : 0,
        // Everything else in <body> must be gone from the sheet, not merely invisible.
        others: [...document.body.children]
          .filter((el) => el.id !== 'print-root' && !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName))
          .filter((el) => getComputedStyle(el).display !== 'none').length,
      };
    };
  });
  // A click under print media has to be a DOM click: the print stylesheet hides the button itself.
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Print' && !b.disabled).click();
  });
  await page.emulateMedia({ media: 'screen' });
  const printed = await page.evaluate(() => window.__printed);
  expect(printed, 'Print reached the print dialog').toBeTruthy();
  // And the app came back: an abandoned print must never leave the interface hidden.
  expect(await page.evaluate(() => document.body.classList.contains('printing-document'))).toBe(false);
  expect(await page.evaluate(() => Boolean(document.getElementById('report-page-footer'))), 'the footer rule is removed').toBe(false);
  return printed;
}

function expectADocument(printed, title, sections) {
  expect(printed.visible, 'the sheet is visible under print media, not a blank page').toBe(true);
  expect(printed.height, 'the sheet has content').toBeGreaterThan(200);
  expect(printed.others, 'nothing of the app prints beside it').toBe(0);
  expect(printed.a4, 'it prints on the A4 report page').toBe(true);
  expect(printed.text).toContain('Enlogada Ultrasound & Diagnostic Clinic');
  expect(printed.text).toContain(title);
  expect(printed.text).toMatch(/Period.*\d{4}/);
  expect(printed.text).toContain('Prepared by');
  expect(printed.text).toContain('Noted by');
  // The clinic's proprietor notes every report. [1.118.0]
  expect(printed.text).toContain('Jesie B. Enlogada');
  expect(printed.text).toContain('Proprietor');
  // Every page names the clinic, the report and that it is confidential, beside its page number.
  expect(printed.footer).toContain('Enlogada Ultrasound & Diagnostic Clinic');
  expect(printed.footer).toContain(title);
  expect(printed.footer).toContain('Confidential');
  for (const section of sections) expect(printed.text, section).toContain(section);
}

test.describe('Printing a report', () => {
  for (const [tab, title, sections] of [
    ['Departments', 'Departments Report', ['Takings', 'Sales by service', 'Front desk', 'Turnaround by department']],
    ['Trends', 'Trends Report', ['Takings by day', 'Tests by department', 'Visits by status', 'Payments by method', 'Arrivals by hour']],
    ['HMO Claims', 'HMO Claims Report', ['Summary', 'By provider', 'money still owed to the clinic']],
    ['Staff Workload', 'Staff Workload Report', ['visits opened', 'reports released']],
  ]) {
    test(`${tab} prints as a titled document`, async ({ page }) => {
      await signInTo(page, ADMIN, 'Reports');
      await page.getByRole('tab', { name: tab }).click();
      expectADocument(await printAndRead(page), title, sections);
    });
  }

  test('Patient Feedback prints, and is not a blank sheet', async ({ page }) => {
    await signInTo(page, ADMIN, 'Patient Feedback');
    expectADocument(await printAndRead(page), 'Patient Feedback Report', ['Summary', 'By question', 'Forms']);
  });
});
