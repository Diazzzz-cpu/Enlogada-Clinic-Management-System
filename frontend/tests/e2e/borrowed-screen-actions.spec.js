// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * A borrowed screen must not offer actions the borrower cannot perform. [1.53.0]
 *
 * Access is permission-driven, so a screen is reachable by anyone holding the right permission
 * rather than by one named role. That is deliberate and it works — but it means a screen can be
 * legitimately VISIBLE to someone who holds only some of the permissions its controls need.
 *
 * The Active Queue is the case. A Cashier holds `visits:read`, so the queue is genuinely theirs
 * to look at: knowing who is waiting is half of running a till. They do not hold `visits:create`,
 * `tests:assign` or `hmo:request` — and the screen offered all three anyway. Measured, a Cashier
 * was shown "Register Walk-In" and "Attach Tests", and the API answers both with 403.
 *
 * CLAUDE.md states this rule about the sidebar: it must not advertise a screen the API will
 * refuse. This is the same failure one level down, inside a screen the sidebar was right to show.
 *
 * A control that cannot work is worse than a missing one. The person clicks it, gets an error
 * that reads like a fault in the system rather than a boundary, and learns to distrust the screen
 * — including the parts that do work.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

/** The permission each control's own endpoint demands. */
const QUEUE_ACTIONS = [
  { label: /Register Walk-In/, permission: 'visits:create' },
  { label: /Edit Tests/, permission: 'tests:assign' },
];

async function permissionsOf(ctx, email) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  return (await res.json()).data.user.permissions || [];
}

test.describe('Borrowed screens offer only what the borrower can do', () => {
  // A visit of this spec's own in today's queue. [1.74.0] Without one, the Cashier's "no Edit
  // Tests" passed over an empty table — true of any screen with no rows — and the Receptionist's
  // "keeps Edit Tests" failed whenever the spec ran before anything else had registered a patient
  // today, which is every run before the clinic opens.
  test.beforeAll(async () => {
    const ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'receptionist@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const H = { Authorization: `Bearer ${token}` };

    const types = (await (await ctx.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: H,
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1991-07-08', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    // [1.129.0] A visit is opened with its tests.
    const created = await ctx.post(`${API}/visits`, {
      headers: H, data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e borrowed queue', testIds: [labTest.id] },
    });
    expect(created.ok(), 'the queue needs a row for these checks to mean anything').toBeTruthy();
    await ctx.dispose();
  });

  test('the Cashier reads the queue but is offered no action it would be refused', async ({ page }) => {
    const ctx = await request.newContext();
    const held = await permissionsOf(ctx, 'cashier@enlogada.com');
    await ctx.dispose();

    // The premise, asserted rather than assumed: if the Cashier is ever granted these, this test
    // should start expecting the buttons instead of quietly passing for the wrong reason.
    expect(held, 'Cashier must still hold visits:read to reach this screen at all').toContain('visits:read');
    for (const { permission } of QUEUE_ACTIONS) {
      expect(held, `this test assumes Cashier lacks ${permission}`).not.toContain(permission);
    }

    await signIn(page, 'cashier@enlogada.com');
    await page.getByRole('button', { name: 'Desk', exact: true }).first().click();

    // The queue itself renders — the screen is legitimately theirs.
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 20000 });

    for (const { label, permission } of QUEUE_ACTIONS) {
      await expect(
        page.getByRole('button', { name: label }),
        `a Cashier lacks ${permission}, so this control must not be offered — clicking it is a 403`
      ).toHaveCount(0);
    }

    // The chip's explanation names who they actually are. [1.74.0] It said "You hold Admin
    // access" to everyone, including this Cashier, the person it most often appears for.
    await expect(page.locator('[title*="not Receptionist"]').first())
      .toHaveAttribute('title', /^Signed in as Cashier, not Receptionist\./);
  });

  test('the Receptionist, whose screen it is, keeps every action', async ({ page }) => {
    const ctx = await request.newContext();
    const held = await permissionsOf(ctx, 'receptionist@enlogada.com');
    await ctx.dispose();

    // The other half of the rule. Hiding a control from the person whose job it is would be a
    // worse bug than showing a dead one, and a gate is one typo away from doing exactly that.
    for (const { permission } of QUEUE_ACTIONS) {
      expect(held, `Receptionist must hold ${permission}`).toContain(permission);
    }

    await signIn(page, 'receptionist@enlogada.com');
    await page.getByRole('button', { name: 'Desk', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 20000 });

    for (const { label, permission } of QUEUE_ACTIONS) {
      await expect(
        page.getByRole('button', { name: label }).first(),
        `the Receptionist holds ${permission} and must still be offered this`
      ).toBeVisible();
    }
  });

  test('the actions the Cashier is not offered are the ones the API refuses', async () => {
    // Ties the UI gate to the server's actual answer. If someone widens the Cashier's permissions
    // later, the buttons appear AND these stop being 403 — the two move together or this fails.
    const ctx = await request.newContext();
    const token = (await (await ctx.post(`${API}/auth/login`, {
      data: { email: 'cashier@enlogada.com', password: PASSWORD },
    })).json()).data.token;
    const auth = { Authorization: `Bearer ${token}` };

    expect((await ctx.get(`${API}/visits/active`, { headers: auth })).status(),
      'the Cashier must be able to READ the queue').toBe(200);

    expect((await ctx.post(`${API}/visits`, {
      headers: auth, data: { patientId: 1, visitType: 'Walk in' },
    })).status(), 'visits:create').toBe(403);

    expect((await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth, data: { patientVisitId: 1, testIds: [1] },
    })).status(), 'tests:assign').toBe(403);

    await ctx.dispose();
  });
});

/**
 * The same rule on the diagnostic screens. [1.74.0]
 *
 * An Admin holds `results:read`, so every department's HISTORY is legitimately theirs to read —
 * oversight is the job. They hold neither `results:write` nor `results:release`, and History
 * offered them Edit (an amendment, `results:write`) and Email (`results:release`) anyway: two
 * controls, two 403s. The worklist is gated on `results:write` in the sidebar already, so an Admin
 * is never offered it at all.
 *
 * `clinicadmin`, not `admin@`: that one is the SuperAdmin, who bypasses permissions and should see
 * everything. Two tickets for one patient, so each screen has a row of this spec's own to judge
 * rather than whatever the database happens to hold — an empty list would pass the negative checks
 * without testing anything.
 */
test.describe('An Admin reads the diagnostic screens without being offered what it cannot do', () => {
  const ADMIN = 'clinicadmin@enlogada.com';
  const person = fixturePerson();
  let ctx;
  let onWorklist;
  let released;

  const tokenOf = async (email) => (await (await ctx.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  })).json()).data.token;

  /** A paid walk-in with one laboratory test, which puts it on the Laboratory worklist. */
  const paidLabTicket = async (reception, patientId, labTestId) => {
    const H = { Authorization: `Bearer ${reception}` };
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: H, data: { patientId, visitType: 'Walk in', notes: 'e2e borrowed diagnostic screens', testIds: [labTestId] },
    })).json()).data.visit;
    const attached = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: H })).json()).data.visitTests;
    const paid = await payAndReleaseWalkIn(ctx, API, visit.id);
    expect(paid.status, 'the ticket must reach the lab').toBe(201);
    return attached[0].id;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    const reception = await tokenOf('receptionist@enlogada.com');
    const lab = await tokenOf('lab@enlogada.com');
    const H = { Authorization: `Bearer ${reception}` };

    const types = (await (await ctx.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: H,
      data: {
        patientTypeId: selfPay.id, firstName: person.firstName, lastName: person.lastName,
        birthdate: '1984-11-20', sex: 'Male', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;

    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);

    onWorklist = await paidLabTicket(reception, patient.id, labTest.id);
    released = await paidLabTicket(reception, patient.id, labTest.id);

    const L = { Authorization: `Bearer ${lab}` };
    expect((await ctx.post(`${API}/results/${released}`, {
      headers: L, multipart: { findings: 'Haemoglobin 13.4 g/dL. Within normal limits.', file: reportPart('borrowed') },
    })).status()).toBe(201);
    expect((await ctx.post(`${API}/results/${released}/release`, { headers: L })).status()).toBe(200);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  const openAndFind = async (page, nav) => {
    await page.getByRole('button', { name: nav, exact: true }).first().click();
    await page.getByPlaceholder(/search patient, test, queue/i).first().fill(person.lastName);
    const row = page.locator('tbody tr', { hasText: person.fullName });
    await expect(row).toBeVisible({ timeout: 20000 });
    return row;
  };

  test('the premise: an Admin reads results but can neither write nor release them', async () => {
    const held = await permissionsOf(ctx, ADMIN);
    expect(held).toContain('results:read');
    expect(held, 'this test assumes Admin lacks results:write').not.toContain('results:write');
    expect(held, 'this test assumes Admin lacks results:release').not.toContain('results:release');
  });

  test('an Admin opens the released report but is offered no Edit or Email', async ({ page }) => {
    await signIn(page, ADMIN);
    const row = await openAndFind(page, 'Laboratory History');

    // And the worklist, where recording happens, is not on offer in the first place.
    await expect(page.getByRole('button', { name: 'Laboratory Worklist', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /View Report/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /^(Email|Send again|Edit)$/ })).toHaveCount(0);
  });

  test('the lab technician, whose screens they are, keeps Attach Report and Edit', async ({ page }) => {
    await signIn(page, 'lab@enlogada.com');
    const ticket = await openAndFind(page, 'Laboratory Worklist');
    await expect(ticket.getByRole('button', { name: 'Attach Report' })).toBeVisible();

    const report = await openAndFind(page, 'Laboratory History');
    await expect(report.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  });

  test('the actions an Admin is not offered are the ones the API refuses', async () => {
    const H = { Authorization: `Bearer ${await tokenOf(ADMIN)}` };
    expect((await ctx.post(`${API}/results/${onWorklist}`, {
      headers: H, multipart: { findings: 'not theirs to write' },
    })).status(), 'results:write').toBe(403);
    expect((await ctx.post(`${API}/results/${released}/release`, { headers: H })).status(), 'results:release').toBe(403);
    expect((await ctx.post(`${API}/results/${released}/email`, { headers: H })).status(), 'results:release').toBe(403);
  });
});
