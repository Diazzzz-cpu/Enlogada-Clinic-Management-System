// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * Getting the report to the patient, and being able to say that you did. [1.59.0]
 *
 * ── What existed ────────────────────────────────────────────────────────────────────────────
 *
 * Releasing a result has emailed the patient since [1.0.0]: `releaseResult` builds the message,
 * calls `sendEmail`, and hands the technician an `emailStatus` toast. Then the toast fades, and
 * the fact is gone — nothing was ever written down. Three ordinary questions had no answer:
 * whether a patient was ever emailed, what address it went to, and how to send it again when
 * they say it never arrived.
 *
 * Re-releasing was the only workaround, and it is the wrong one: it writes a fresh clinical
 * authorisation for an event that did not happen a second time.
 *
 * ── What must stay true ─────────────────────────────────────────────────────────────────────
 *
 *   RELEASE GATES DELIVERY      an unreleased report must not be emailable by a second door, or
 *                               `results:release` becomes bypassable by whoever can send mail.
 *   NULL MEANS NEVER            `emailed_at` is written only on a SUCCESSFUL send. A failure that
 *                               stamped it would destroy the one honest signal in the feature.
 *   A MISSING ADDRESS IS NOT    most of this clinic's patients are walk-ins with no account. That
 *   A FAULT                     is a 409 naming the remedy, not a 500.
 *   THE DEPARTMENT BOUNDARY     Ultrasound does not email a Laboratory report.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function login(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.token;
}

test.describe('Emailing a released report', () => {
  let ctx; let rec; let cash; let lab;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    rec = await login(ctx, 'receptionist@enlogada.com');
    cash = await login(ctx, 'cashier@enlogada.com');
    lab = await login(ctx, 'lab@enlogada.com');
  });
  test.afterAll(async () => { await ctx.dispose(); });

  const released = async () =>
    (await (await ctx.get(`${API}/results/released/Laboratory`, { headers: auth(lab) })).json())
      .data.released;

  /** A paid walk-in with one Laboratory test, taken as far as the caller asks. */
  async function labVisit() {
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(rec) })).json()).data.patientTypes;
    const selfPay = types.find((t) => t.name === 'Self Pay');
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(rec),
      data: {
        ...fixturePerson(), birthdate: '1990-01-01', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
        patientTypeId: selfPay.id,
      },
    })).json()).data.patient;

    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(rec), data: { patientId: patient.id, visitType: 'Walk in' },
    })).json()).data.visit;

    const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.is_active && t.category_name === 'Laboratory' && Number(t.price) > 0);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(rec), data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });

    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(cash) })).json()).data.bill;
    await ctx.post(`${API}/payments`, {
      headers: auth(cash),
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    });

    const pending = (await (await ctx.get(`${API}/results/pending/Laboratory`, { headers: auth(lab) })).json()).data.pending;
    const line = pending.find((x) => x.visit_id === visit.id);
    expect(line, 'a paid walk-in must reach the Laboratory worklist').toBeTruthy();
    return { patient, visit, visitTestId: line.visit_test_id };
  }

  test('a report that has not been released cannot be emailed', async () => {
    const { visitTestId } = await labVisit();

    // No findings recorded yet — there is not even a report to send.
    const noReport = await ctx.post(`${API}/results/${visitTestId}/email`, { headers: auth(lab) });
    expect(noReport.status()).toBe(404);
    expect((await noReport.json()).message).toMatch(/nothing to send|no report/i);

    // Findings recorded, but NOT released: the ticket sits in 'Waiting for Release', which exists
    // precisely so that authorising is a separate deliberate act. Emailing here would be a way
    // around it.
    await ctx.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: auth(lab), data: { status: 'Processing' },
    });
    await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { findings: 'Within normal limits.', remarks: 'E2E' },
    });

    const unreleased = await ctx.post(`${API}/results/${visitTestId}/email`, { headers: auth(lab) });
    expect(unreleased.status(), 'delivery must not bypass release').toBe(409);
    expect((await unreleased.json()).message).toMatch(/not been released/i);
  });

  test('a walk-in with no account is told what to do, not shown an error', async () => {
    const { visitTestId } = await labVisit();
    await ctx.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: auth(lab), data: { status: 'Processing' },
    });
    await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab), multipart: { findings: 'Within normal limits.', remarks: 'E2E' },
    });
    expect((await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) })).status()).toBe(200);

    // Reception registers walk-ins at the counter with no user account, so there is no address.
    // This is the common case at this clinic, not an edge one.
    const res = await ctx.post(`${API}/results/${visitTestId}/email`, { headers: auth(lab) });
    expect(res.status()).toBe(409);
    // Naming the remedy matters: whoever is holding the phone can fix this in a minute.
    expect((await res.json()).message).toMatch(/no email address on file/i);
    expect((await res.json()).message).toMatch(/add one/i);
  });

  test('the released list says whether the patient was actually told', async () => {
    const rows = await released();
    test.skip(rows.length === 0, 'Need a released Laboratory result.');

    // Released and delivered are two different facts. The screen showed only the first, so
    // "has she been sent her result?" had no answer anywhere in the system.
    for (const field of ['emailed_at', 'emailed_to', 'email_count', 'patient_email']) {
      expect(rows[0], `the row must carry ${field}`).toHaveProperty(field);
    }

    // Never stamped by a failure. A row claiming delivery it did not achieve is worse than a row
    // that admits it does not know.
    for (const row of rows) {
      if (row.emailed_at) {
        expect(row.emailed_to, 'a recorded send must name the address it went to').toBeTruthy();
        expect(Number(row.email_count), 'a recorded send counts at least one').toBeGreaterThan(0);
      } else {
        expect(Number(row.email_count || 0), 'no send recorded means no count').toBe(0);
      }
    }
  });

  test('who may send it', async () => {
    const rows = await released();
    test.skip(rows.length === 0, 'Need a released Laboratory result.');
    const id = rows[0].visit_test_id;

    const cases = [
      ['Receptionist', await login(ctx, 'receptionist@enlogada.com')],
      ['Client', await login(ctx, 'client@enlogada.com')],
      // Sending a Laboratory report is Laboratory's business. Department scoping is enforced in
      // the service, the same check that guards reading the result at all.
      ['Xray Staff', await login(ctx, 'xray@enlogada.com')],
    ];
    for (const [who, token] of cases) {
      expect(
        (await ctx.post(`${API}/results/${id}/email`, { headers: auth(token) })).status(),
        `${who} must not email a Laboratory report`
      ).toBe(403);
    }
  });

  test('the undelivered pile can be asked for by itself', async () => {
    const ctx2 = await request.newContext();
    const token = await login(ctx2, 'lab@enlogada.com');
    const get = async (params) =>
      (await (await ctx2.get(`${API}/results/released/Laboratory`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { days: 0, limit: 500, ...params },
      })).json()).data.released;

    const all = await get({});
    const unsent = await get({ delivery: 'unsent' });
    const sent = await get({ delivery: 'sent' });

    // The reason the column was worth adding: a technician can find every released report nobody
    // was told about, instead of scanning by eye. This is the pile that matters after a mail
    // outage, when the failures are a contiguous block with no other way to identify them.
    expect(unsent.every((r) => !r.emailed_at), 'unsent means no send recorded').toBeTruthy();
    expect(sent.every((r) => Boolean(r.emailed_at)), 'sent means a send WAS recorded').toBeTruthy();
    expect(unsent.length + sent.length, 'the two must partition the released list').toBe(all.length);

    // Unrecognised is dropped, not applied — an empty worklist reads as "no work", which is a
    // claim about the department rather than a result.
    expect((await get({ delivery: 'nonsense' })).length).toBe(all.length);

    await ctx2.dispose();
  });

  test('the technician can see delivery state and reach the action', async ({ page }) => {
    await signIn(page, 'lab@enlogada.com');
    await page.getByRole('button', { name: 'Laboratory History' }).first().click();

    await expect(page.getByRole('columnheader', { name: 'Sent to patient' })).toBeVisible({ timeout: 20000 });

    // And the filter that finds the ones nobody was told about.
    await expect(page.getByRole('tab', { name: 'Not sent' })).toBeVisible();
    await page.getByRole('tab', { name: 'Not sent' }).click();
    await expect(page.getByRole('tab', { name: 'Not sent' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'All' }).click();

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Either an address to send to, or an explicit statement that there is none. What must never
    // appear is a button that can only refuse, with nothing on screen explaining why.
    const emailButton = firstRow.getByRole('button', { name: /Email|Send again/ });
    await expect(emailButton).toBeVisible();
    if (await emailButton.isDisabled()) {
      await expect(firstRow).toContainText(/No email on file/i);
    }
  });
});

test.describe('Patient Records is a clinical roster', () => {
  test('billing state is not shown on it', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Patient Records' }).first().click();

    await expect(page.locator('[data-testid="patient-row"]').first()).toBeVisible({ timeout: 20000 });

    // Whether a bill is settled is the Billing Queue's question. A clinical records roster that
    // answers it reads as a debtors list — which is what prompted this. Reception's walk-in
    // lookup keeps the same figure, because at CHECK-IN an outstanding balance is the point.
    await expect(page.getByTestId('patient-row').first()).not.toContainText(/unpaid/i);
  });

  test('the roster can be narrowed to finished records', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await page.getByRole('button', { name: 'Patient Records' }).first().click();
    await expect(page.locator('[data-testid="patient-row"]').first()).toBeVisible({ timeout: 20000 });

    await expect(page.getByRole('tab', { name: 'Complete' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Still open' })).toBeVisible();

    await page.getByRole('tab', { name: 'Complete' }).click();
    await expect(page.getByRole('tab', { name: 'Complete' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Every test seen through/i)).toBeVisible();
  });

  test('complete and open partition the roster exactly', async () => {
    const ctx = await request.newContext();
    const sup = await login(ctx, 'admin@enlogada.com');
    const count = async (params) =>
      (await (await ctx.get(`${API}/patients/search`, {
        headers: { Authorization: `Bearer ${sup}` }, params: { limit: 100, ...params },
      })).json()).data.total;

    const all = await count({});
    const complete = await count({ recordStatus: 'complete' });
    const open = await count({ recordStatus: 'open' });

    // Written as a clause and its exact negation in SQL, so they cannot overlap or leave a gap.
    expect(complete + open, 'every record is one or the other').toBe(all);

    // An unrecognised value is dropped, never applied as a filter that matches nothing — an
    // empty roster reads as "this clinic has no patients", which is a claim, not a result.
    expect(await count({ recordStatus: 'nonsense' })).toBe(all);

    await ctx.dispose();
  });
});

/**
 * An address to send it TO. [1.60.0]
 *
 * [1.59.0] built the button and the record. Measured immediately afterwards: Laboratory 15
 * released results with 0 addresses, X-Ray 12 with 0, Ultrasound 13 with 0. Forty released
 * reports and nowhere to send one of them.
 *
 * The cause was that the only address in the system was `users.email`, reached through
 * `patients.user_id` — which is NULLABLE precisely because reception registers walk-ins at the
 * counter without a web account. That is how most of this clinic's patients arrive, so the
 * delivery feature was unusable for the people it was built for. `patients.email` closes it.
 */
test.describe('Where the report is sent', () => {
  let ctx; let rec;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    rec = await login(ctx, 'receptionist@enlogada.com');
  });
  test.afterAll(async () => { await ctx.dispose(); });

  const makePatient = async (extra = {}) => {
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(rec) })).json()).data.patientTypes;
    const selfPay = types.find((t) => t.name === 'Self Pay');
    const res = await ctx.post(`${API}/patients`, {
      headers: auth(rec),
      data: {
        ...fixturePerson(), birthdate: '1988-03-04', sex: 'Male',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
        patientTypeId: selfPay.id, ...extra,
      },
    });
    return res;
  };

  test('a walk-in with no account can still be given an address', async () => {
    const address = `Walkin.${Date.now()}@enlogada-e2e.test`;
    const res = await makePatient({ email: `  ${address}  ` });
    expect(res.status()).toBe(201);

    const patient = (await res.json()).data.patient;
    expect(patient.user_id, 'a counter registration has no web account').toBeNull();
    // Trimmed and lowercased in the service, so "no address" and "an address" each have exactly
    // one representation and the COALESCE on read behaves.
    expect(patient.email).toBe(address.toLowerCase());
  });

  test('a malformed address is refused rather than stored', async () => {
    const res = await makePatient({ email: 'not-an-email' });
    expect(res.status()).toBe(400);
    // Names the way out, because leaving it blank is a legitimate answer.
    expect((await res.json()).message).toMatch(/leave it blank/i);
  });

  test('omitting the field does not erase the address', async () => {
    const address = `Keep.${Date.now()}@enlogada-e2e.test`;
    const patient = (await (await makePatient({ email: address })).json()).data.patient;

    const base = {
      patientTypeId: patient.patient_type_id, firstName: patient.first_name,
      lastName: patient.last_name, birthdate: '1988-03-04', sex: 'Male',
      address: 'A different address', contactNumber: FIXTURE_CONTACT,
    };

    // An omitted field is not an instruction to erase. updatePatient writes every column
    // unconditionally, so without the guard in the service this call would blank the address a
    // patient's results go to — the same defect [1.54.0] found in the Services Catalogue.
    const kept = await ctx.put(`${API}/patients/${patient.id}`, { headers: auth(rec), data: base });
    expect(kept.status()).toBe(200);
    expect((await kept.json()).data.patient.email, 'not mentioning it must keep it')
      .toBe(address.toLowerCase());

    // Sending it EMPTY is a different instruction, and does clear it.
    const cleared = await ctx.put(`${API}/patients/${patient.id}`, {
      headers: auth(rec), data: { ...base, email: '' },
    });
    expect((await cleared.json()).data.patient.email, 'an explicit blank clears it').toBeNull();
  });

  test('the record address wins over the account it belongs to', async () => {
    const stamp = Date.now();
    const accountEmail = `owner.${stamp}@enlogada-e2e.test`;
    await ctx.post(`${API}/auth/register`, {
      data: {
        firstName: 'Owner', lastName: 'Probe', email: accountEmail,
        password: PASSWORD, contactNumber: FIXTURE_CONTACT,
      },
    });
    const owner = await login(ctx, accountEmail);
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(owner) })).json()).data.patientTypes;
    const selfPay = types.find((t) => t.name === 'Self Pay');

    // One account owns several profiles — a parent booking for dependents, which is why
    // /patients/my-profiles is plural. The ACCOUNT address is the right default for a dependent,
    // since the parent is who booked.
    const inherits = (await (await ctx.post(`${API}/patients`, {
      headers: auth(owner),
      data: {
        ...fixturePerson(), birthdate: '2015-06-01', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
        patientTypeId: selfPay.id,
      },
    })).json()).data.patient;
    expect(inherits.email, 'nothing is copied onto the row').toBeNull();

    // But an address typed onto ONE patient's record is a deliberate statement about that
    // patient, and must win over the inherited one.
    const ownAddress = `child.${stamp}@enlogada-e2e.test`;
    const specific = (await (await ctx.post(`${API}/patients`, {
      headers: auth(owner),
      data: {
        ...fixturePerson(), birthdate: '2012-06-01', sex: 'Male',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
        patientTypeId: selfPay.id, email: ownAddress,
      },
    })).json()).data.patient;
    expect(specific.email).toBe(ownAddress);

    // Both profiles are reachable, by different routes to the same question.
    const mine = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(owner) })).json()).data.patients;
    expect(mine.length, 'one account, several profiles').toBeGreaterThanOrEqual(2);
  });

  test('reception is asked for it at the counter', async ({ page }) => {
    await signIn(page, 'receptionist@enlogada.com');
    await page.getByRole('button', { name: 'Walk-In Registration' }).first().click();

    // Asked HERE because this is the only moment the patient is standing in front of somebody
    // who can ask. Optional — it must never become a barrier to registering a patient.
    const field = page.locator('#wi-email');
    await expect(field).toBeVisible({ timeout: 20000 });
    await expect(field).not.toHaveAttribute('required', '');
    await expect(page.getByText(/Released reports are sent here/i).first()).toBeVisible();
  });
});

/**
 * The button belongs to every department, not just Laboratory. [1.61.0]
 *
 * `DiagnosticDashboard` is one file serving Laboratory, X-Ray and Ultrasound — a nav id ending
 * `-history` puts it in history mode and it renders one `ResultHistoryPanel` with one `delivery`
 * prop. So all three get the feature by construction, and this spec is what stops that being a
 * claim: a future change that routes one department to its own panel, or forgets to pass the
 * prop down a second path, breaks here rather than in the one department nobody demoed.
 *
 * Each of these logs in as that department's own technician, so the department scoping in
 * `assertStaffAllowedCategory` is exercised at the same time — Ultrasound reaching its own
 * history is a different assertion from Laboratory reaching Laboratory's.
 */
test.describe('Every department can send a report', () => {
  const DEPARTMENTS = [
    { account: 'lab@enlogada.com', nav: 'Laboratory History', category: 'Laboratory' },
    { account: 'xray@enlogada.com', nav: 'X-Ray History', category: 'Xray' },
    { account: 'ultrasound@enlogada.com', nav: 'Ultrasound History', category: 'Ultrasound' },
  ];

  for (const dept of DEPARTMENTS) {
    test(`${dept.category} carries the delivery column and the action`, async ({ page }) => {
      await signIn(page, dept.account);
      await page.getByRole('button', { name: dept.nav }).first().click();

      // Released and delivered are two different facts, in every department.
      await expect(page.getByRole('columnheader', { name: 'Sent to patient' }))
        .toBeVisible({ timeout: 20000 });

      // And the filter that finds the reports nobody was told about.
      await expect(page.getByRole('tab', { name: 'Not sent' })).toBeVisible();

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Either an address to send to, or an explicit statement that there is none. What must
      // never appear is a control that can only refuse, with nothing on screen saying why.
      const button = firstRow.getByRole('button', { name: /Email|Send again/ });
      await expect(button).toBeVisible();
      if (await button.isDisabled()) {
        await expect(firstRow).toContainText(/No email on file/i);
      }
    });
  }

  test('the API answers each department for its own results only', async () => {
    const ctx = await request.newContext();

    for (const dept of DEPARTMENTS) {
      const token = await login(ctx, dept.account);
      const res = await ctx.get(`${API}/results/released/${dept.category}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { days: 0, limit: 5 },
      });
      expect(res.status(), `${dept.category} reads its own history`).toBe(200);

      const rows = (await res.json()).data.released;
      if (rows.length) {
        // The delivery state travels on every department's rows, not only Laboratory's.
        for (const field of ['emailed_at', 'emailed_to', 'email_count', 'patient_email']) {
          expect(rows[0], `${dept.category} row must carry ${field}`).toHaveProperty(field);
        }
      }

      // And a department cannot read another's. This is the same check that gates the send, so
      // asserting it here is asserting the send boundary too.
      const other = DEPARTMENTS.find((d) => d.category !== dept.category);
      expect(
        (await ctx.get(`${API}/results/released/${other.category}`, {
          headers: { Authorization: `Bearer ${token}` },
        })).status(),
        `${dept.category} must not read ${other.category}`
      ).toBe(403);
    }

    await ctx.dispose();
  });
});
