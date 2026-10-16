// @ts-check
import { test, expect, request } from 'playwright/test';
import { selfPayTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';

// Backend API-level authorization tests. These hit the Express API directly (no browser),
// exercising a real end-to-end workflow and regression-testing the five ownership/IDOR
// fixes made in the pre-implementation remediation pass (see database/migrations.md and
// backend/src/controllers/{resultController,visitController}.js).
//
// Test data is created dynamically per run (unique email per run) rather than relying on
// pre-existing seeded records, so this suite is deterministic and repeatable without manual
// DB setup beyond the standard migrateDb.js -> setupRbac.js -> seedUsers.js sequence.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN_EMAIL = 'admin@enlogada.com';
const SUPERADMIN_PASSWORD = 'Password123!';

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function registerAndLoginClient(apiContext, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';
  // `prefix` still names the EMAIL, which is where the uniqueness belongs — invisible on every
  // clinic screen. The person is a person. See tests/e2e/helpers/people.js.
  const person = fixturePerson();

  // Through the real sign-up, emailed code and all. See helpers/accounts.js.
  await registerClient(apiContext, { ...person, email, password, contactNumber: FIXTURE_CONTACT });

  const loginRes = await apiContext.post(`${API}/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const loginBody = await loginRes.json();
  const token = loginBody.data.token;

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      // Self Pay by name. Was `2` — 'Private' — which [1.23.0] turned into "a physician referred
      // them", so it began demanding a referring physician this fixture has no reason to carry.
      patientTypeId: await selfPayTypeId(apiContext, API, token),
      // The account holder is the patient here, so the same person, not a second invented one.
      ...person,
      birthdate: '1990-01-01',
      sex: 'Male',
      address: 'Bugo, Cagayan de Oro City',
      contactNumber: FIXTURE_CONTACT,
      emergencyContact: FIXTURE_CONTACT,
    },
  });
  expect(patientRes.ok()).toBeTruthy();
  const patientBody = await patientRes.json();
  const patientId = patientBody.data.patient.id;

  return { token, patientId };
}

test.describe('API authorization — ownership and role boundaries', () => {
  let apiContext;
  let clientA;
  let clientB;
  let superAdminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();

    clientA = await registerAndLoginClient(apiContext, 'ClientA');
    clientB = await registerAndLoginClient(apiContext, 'ClientB');

    const superAdminLogin = await apiContext.post(`${API}/auth/login`, {
      data: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
    });
    expect(superAdminLogin.ok()).toBeTruthy();
    superAdminToken = (await superAdminLogin.json()).data.token;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('unauthenticated request to a protected endpoint is rejected', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientA.patientId}`);
    expect(res.status()).toBe(401);
  });

  test('client can access their own patient result history', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientA.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('client CANNOT access another client\'s patient result history (IDOR regression)', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientB.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('client CANNOT access another client\'s visit history (IDOR regression)', async () => {
    const res = await apiContext.get(`${API}/visits/patient/${clientB.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('client cannot reach an admin-only endpoint', async () => {
    const res = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('SuperAdmin can reach the admin-only RBAC matrix endpoint', async () => {
    const res = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.roles)).toBeTruthy();
    expect(Array.isArray(body.data.permissions)).toBeTruthy();
  });

  test('nonexistent patient id returns a clean error, not a crash', async () => {
    const res = await apiContext.get(`${API}/results/history/999999999`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    // 403, not 404. [1.29.0] This used to assert 404 — and that was the leak: a Client could tell
    // "no such patient" from "not your patient" and enumerate the clinic's id space from it. A
    // caller who may not see the record does not get to learn whether it exists. Staff still get
    // a genuine 404, because they are entitled to know.
    expect(res.status()).toBe(403);
  });
});

// Separation of duties between Admin (clinic manager) and SuperAdmin.
//
// Admin reads everything and writes nothing inside a department. Both halves are asserted: a
// permission removed without checking the read still works is how oversight silently breaks, and
// these are the routes whose records carry the actor's name (a released result names its
// clinician, a receipt names its cashier). See backend/src/routes/resultRoutes.js for the
// reasoning and frontend/src/config/navigation.js for the matching sidebar boundary.
test.describe('Admin vs SuperAdmin — separation of duties', () => {
  let apiContext;
  let adminToken;
  let superAdminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    const login = async (email) => {
      const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: 'Password123!' } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data.token;
    };
    adminToken = await login('clinicadmin@enlogada.com');
    superAdminToken = await login(SUPERADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Admin cannot capture a payment, but SuperAdmin retains break-glass access', async () => {
    const body = { patientVisitId: 1, paymentMethod: 'Cash', amount: 1 };
    const asAdmin = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${adminToken}` }, data: body,
    });
    expect(asAdmin.status()).toBe(403);

    // Any non-403 proves the role gate let SuperAdmin through; the visit id is a placeholder, so
    // a validation error here is a pass, not a failure.
    const asSuper = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }, data: body,
    });
    expect(asSuper.status()).not.toBe(403);
  });

  test('Admin cannot author or release a clinical result', async () => {
    const upload = await apiContext.post(`${API}/results/1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { findings: 'should not be accepted', remarks: '' },
    });
    expect(upload.status()).toBe(403);

    const release = await apiContext.post(`${API}/results/1/release`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(release.status()).toBe(403);
  });

  test('Admin keeps the oversight reads that make the restriction workable', async () => {
    const pending = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(pending.status()).toBe(200);

    const transactions = await apiContext.get(`${API}/payments/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(transactions.status()).toBe(200);
  });

  test('editing role permissions stays SuperAdmin-only', async () => {
    const res = await apiContext.put(`${API}/rbac/roles/1/permissions`, {
      headers: { Authorization: `Bearer ${adminToken}` }, data: { permissionIds: [] },
    });
    expect(res.status()).toBe(403);
  });

  // READING the matrix is SuperAdmin's too, not only writing it. It enumerates every role, every
  // permission, and by omission exactly which ones the reader lacks — the reconnaissance half of
  // an escalation, and Admin is the role positioned to attempt one.
  test('reading the permission matrix stays SuperAdmin-only', async () => {
    const asAdmin = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(asAdmin.status(), 'Admin must not enumerate the permission matrix').toBe(403);

    const asSuper = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(asSuper.status()).toBe(200);
  });

  // Staff Accounts is built on this list. (Admin's old overview read it too, in one Promise.all with
  // the day's revenue; that overview became Admin's Today in [1.77.0], which does not.)
  test('Admin keeps the staff list its own screens are built on', async () => {
    const res = await apiContext.get(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);

    // And it exposes operational staff only — no Admin, no SuperAdmin. This is the list that
    // feeds deactivate and password-reset, so who appears on it IS the escalation boundary.
    const roles = new Set(
      ((await res.json()).data.staff || []).flatMap((u) => u.roles || [u.role]).filter(Boolean)
    );
    expect([...roles].sort(), 'an elevated account must never be listed as manageable staff')
      .not.toContain('SuperAdmin');
    expect([...roles]).not.toContain('Admin');
  });

  // "Can an Admin dethrone the SuperAdmin?" — the question worth asking of any two-tier admin
  // model, because staff:manage covers deactivation AND password reset. Either one alone is a
  // full takeover: lock the owner out, or set a password you know and sign in as them.
  test('Admin cannot deactivate, reset, or edit a SuperAdmin', async () => {
    const accounts = (await (await apiContext.get(`${API}/superadmin/accounts`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })).json()).data.accounts || [];
    const target = accounts.find((u) => (u.roles || []).includes('SuperAdmin'));
    expect(target, 'need a SuperAdmin account to aim at').toBeTruthy();

    const asAdmin = { Authorization: `Bearer ${adminToken}` };

    expect((await apiContext.patch(`${API}/admin/staff/${target.id}/status`, {
      headers: asAdmin, data: { status: false },
    })).status(), 'Admin must not be able to lock the SuperAdmin out').toBe(403);

    expect((await apiContext.patch(`${API}/admin/staff/${target.id}/password`, {
      headers: asAdmin, data: { newPassword: 'Hijacked123!' },
    })).status(), 'Admin must not be able to take the SuperAdmin account').toBe(403);

    // A COMPLETE body, so a rejection can only be the authorization guard. An incomplete one is
    // refused by controller validation first and would pass this test without proving anything.
    expect((await apiContext.patch(`${API}/admin/staff/${target.id}`, {
      headers: asAdmin,
      data: {
        firstName: 'Pwned', lastName: 'Owner',
        email: target.email, contactNumber: '09171234567',
      },
    })).status(), 'Admin must not be able to edit the SuperAdmin').toBe(403);

    // Nor promote anyone into the tier they cannot touch.
    expect((await apiContext.post(`${API}/admin/staff`, {
      headers: asAdmin,
      data: {
        firstName: 'Esc', lastName: 'Alate', email: `esc${Date.now()}@enlogada-e2e.test`,
        password: 'Password123!', role: 'Admin',
      },
    })).status(), 'Admin must not mint another elevated account').toBe(400);

    // And the elevated-account register itself stays closed.
    expect((await apiContext.get(`${API}/superadmin/accounts`, { headers: asAdmin })).status())
      .toBe(403);
  });
});

// Combined-role access. A user holding two operational roles must reach BOTH consoles: the
// sidebar and the router are driven by one registry now, but this is the case that regressed
// before (the sidebar offered Billing while the router kept returning the Front Desk console),
// so it is worth holding onto. Requires the multirole@enlogada.com account — see
// TEST_ACCOUNTS.md; the test skips rather than fails if it has not been created.
test.describe('Combined-role access', () => {
  test('a Receptionist+Cashier reaches both the Front Desk and Billing consoles', async ({ page }) => {
    const apiContext = await request.newContext();
    const login = await apiContext.post(`${API}/auth/login`, {
      data: { email: 'multirole@enlogada.com', password: 'Password123!' },
    });
    const exists = login.ok();
    await apiContext.dispose();
    test.skip(!exists, 'multirole@enlogada.com not seeded on this database');

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'multirole@enlogada.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.locator('button[type="submit"]').click();

    // Both departments offered in the sidebar...
    await expect(page.getByRole('button', { name: 'Desk', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Billing Queue', { exact: true })).toBeVisible();

    // ...and the advertised one actually opens, rather than leaving them on the first console
    // their role list happened to match.
    await page.getByText('Billing Queue', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Billing Queue', level: 1 })).toBeVisible({ timeout: 10000 });
  });
});

// Cross-role PHI boundaries.
//
// Every test here failed to exist while the corresponding hole was open, which is why the hole
// stayed open: the suite asserted plenty about RBAC and nothing about the two routes that leaked
// the most. Both were reachable with the LOWEST-privilege clinical token in the system.
//
//   GET/PUT /api/patients/:id  carried verifyToken alone. The ownership check in the controller
//   reads `if (req.user.roles.includes('Client') && ...)`, so it is a no-op for staff — any staff
//   token could walk the integer id space to read the whole patient roster, and PUT to rewrite
//   another patient's birthdate and sex (the fields diagnostic reference ranges key off).
//
//   GET /api/results/history/:patientId  applied no category filter, so Laboratory Staff read
//   every Xray, Ultrasound and 2D Echo finding in the clinic.
//
// Laboratory Staff is used as the probe throughout precisely because it is the least privileged
// clinical role — if it is refused, the narrower roles are too.
test.describe('Cross-role PHI boundaries', () => {
  let apiContext;
  let labToken;
  let receptionToken;
  let superAdminToken;

  const LAB_CATEGORIES = ['Laboratory'];

  // Patient ids are not stable across databases — the demo seed, the purge and each run's own
  // fixtures all move them — so anything id-specific is discovered rather than hardcoded.
  async function discoverPatientIds(token) {
    const ids = new Set();
    // The endpoint requires at least 2 characters, so these are common bigrams rather than single
    // letters — between them they match essentially any Filipino or English given/family name.
    for (const q of ['an', 'ar', 'el', 'ma', 'na', 'ra', 'os', 'le']) {
      const res = await apiContext.get(`${API}/patients/search?q=${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok()) continue;
      for (const p of (await res.json()).data.patients) ids.add(p.id);
    }
    return [...ids];
  }

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    const login = async (email) => {
      const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: 'Password123!' } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data.token;
    };
    labToken = await login('lab@enlogada.com');
    receptionToken = await login('receptionist@enlogada.com');
    superAdminToken = await login(SUPERADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('diagnostic staff cannot read a patient record outside their department', async () => {
    // Rewritten in [1.21.0], and the change of status code is the point.
    //
    // This used to assert 403 with the note "the record exists; the role is what is refused" —
    // the route excluded diagnostic staff by role, full stop. That was safe but blunt: a lab tech
    // could read a result and had no way to look up whose it was.
    //
    // Now the confinement is by department rather than by role, and an out-of-scope record
    // answers 404. Deliberately: a 403 confirms the record exists, and "does this clinic have a
    // patient with id N" is exactly the question the scoping refuses. Patient 1 predates the
    // seeded clinic day and has no Laboratory work, so it is out of scope either way.
    const res = await apiContext.get(`${API}/patients/1`, {
      headers: { Authorization: `Bearer ${labToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('diagnostic staff cannot rewrite a patient record', async () => {
    const res = await apiContext.put(`${API}/patients/1`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: {
        patientTypeId: 2,
        firstName: 'Soledad',
        lastName: 'Nakpil',
        birthdate: '1970-01-01',
        sex: 'Female',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('the front desk keeps the patient access it needs to do its job', async () => {
    // The negative tests above are only meaningful alongside this one: a gate that refuses
    // everyone is not a fix, it is an outage.
    const patientIds = await discoverPatientIds(receptionToken);
    test.skip(patientIds.length === 0, 'no patient records in this database to read');

    const res = await apiContext.get(`${API}/patients/${patientIds[0]}`, {
      headers: { Authorization: `Bearer ${receptionToken}` },
    });
    expect(res.status()).toBe(200);
  });

  test('diagnostic staff cannot cancel an appointment', async () => {
    // PUT /:id/cancel carried verifyToken alone while its sibling /:id/status was role-gated, so
    // any staff token could walk the id space and empty the appointment book — each cancellation
    // cascading to the linked visit.
    const res = await apiContext.put(`${API}/appointments/1/cancel`, {
      headers: { Authorization: `Bearer ${labToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('patient result history is scoped to the caller\'s own department', async () => {
    // Compare what SuperAdmin sees against what Laboratory sees, for every patient we can find.
    let sawForeignCategory = false;
    const patientIds = await discoverPatientIds(superAdminToken);

    for (const patientId of patientIds) {
      const [allRes, labRes] = await Promise.all([
        apiContext.get(`${API}/results/history/${patientId}`, {
          headers: { Authorization: `Bearer ${superAdminToken}` },
        }),
        apiContext.get(`${API}/results/history/${patientId}`, {
          headers: { Authorization: `Bearer ${labToken}` },
        }),
      ]);
      if (!allRes.ok() || !labRes.ok()) continue;

      const all = (await allRes.json()).data.results;
      const lab = (await labRes.json()).data.results;

      // The hard assertion: nothing outside Laboratory may ever appear in the Laboratory view.
      for (const row of lab) expect(LAB_CATEGORIES).toContain(row.category_name);
      expect(lab.length).toBeLessThanOrEqual(all.length);

      if (all.some((r) => !LAB_CATEGORIES.includes(r.category_name))) sawForeignCategory = true;
    }

    // Guards against the assertions above passing vacuously on a database with no cross-department
    // data to hide — if there was nothing to filter, this proved nothing.
    test.skip(!sawForeignCategory, 'no cross-department results in this database to filter');
    expect(sawForeignCategory).toBeTruthy();
  });
});

// A caller who may not see a record must not learn whether it exists. [1.29.0]
//
// The permission matrix is verified on every commit by verifyRbacWiring, which proves the ROUTES
// are gated. It says nothing about whether a caller who legitimately reaches a route is confined
// to their own rows, and nothing at all about what a REFUSAL discloses.
//
// Two routes answered 403 for "exists but not yours" and 404 for "no such record", so a signed-in
// patient could walk the id space, count the 403s, and learn how many patients the clinic has and
// exactly which ids are real. That is the reconnaissance step that turns any future ownership
// slip into a usable one. /visits/:id and /payments/bill/:id already answered 403 to both, so the
// fix brought two routes into line with the pattern the codebase had already settled on.
//
// The message is asserted as well as the status: two different wordings for the two cases is the
// same oracle one layer down.
test.describe('A refusal must not reveal whether the record exists', () => {
  const ABSENT_ID = 99999999;
  // Every seeded account shares this; SUPERADMIN_PASSWORD above is the same string under a
  // name that would read as a mistake here.
  const SEEDED_PASSWORD = SUPERADMIN_PASSWORD;

  test('a client cannot tell a stranger\'s record from one that does not exist', async ({ request: ctx }) => {
    const asClient = async () => {
      const res = await ctx.post(`${API}/auth/login`, { data: { email: 'client@enlogada.com', password: SEEDED_PASSWORD } });
      return (await res.json()).data.token;
    };
    const asReception = async () => {
      const res = await ctx.post(`${API}/auth/login`, { data: { email: 'receptionist@enlogada.com', password: SEEDED_PASSWORD } });
      return (await res.json()).data.token;
    };
    const client = await asClient();
    const reception = await asReception();
    const auth = (t) => ({ Authorization: `Bearer ${t}` });

    // A real patient that is emphatically not the client's — a walk-in with no web account.
    const types = (await (await ctx.get(`${API}/patients/types`, { headers: auth(reception) })).json()).data.patientTypes;
    const made = await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: types[0].id, firstName: 'Benigno', lastName: 'Quintos',
        birthdate: '1975-02-02', sex: 'Male',
      },
    })).json();
    const strangerId = made.data.patient.id;

    for (const path of ['/patients', '/results/history']) {
      const exists = await ctx.get(`${API}${path}/${strangerId}`, { headers: auth(client) });
      const absent = await ctx.get(`${API}${path}/${ABSENT_ID}`, { headers: auth(client) });
      expect(exists.status(), `${path} leaked existence by status`).toBe(absent.status());
      expect(exists.status()).toBe(403);
    }

    // The write path too, with a complete body so validation cannot be what answers.
    const body = {
      patientTypeId: types[0].id, firstName: 'Amihan', lastName: 'Zulueta',
      birthdate: '1990-01-01', sex: 'Female', contactNumber: '09999999999',
    };
    const putExists = await ctx.put(`${API}/patients/${strangerId}`, { headers: auth(client), data: body });
    const putAbsent = await ctx.put(`${API}/patients/${ABSENT_ID}`, { headers: auth(client), data: body });
    expect(putExists.status()).toBe(403);
    expect(putAbsent.status()).toBe(403);
    // Same wording, or the body becomes the oracle instead of the status line.
    expect((await putExists.json()).message).toBe((await putAbsent.json()).message);
  });
});
