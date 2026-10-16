// @ts-check
import { test, expect, request } from 'playwright/test';

// A diagnostic account sees the patients of its own department, and nobody else's.
//
// The roster search used to be unconditional: two characters and any staff token could page
// through every patient the clinic has ever registered. The name match WAS the access control,
// and a name match is not an access control. GET /patients/:id had the opposite problem — the
// role list excluded diagnostic staff outright, which was safe but meant a lab tech could read a
// result and had no way to look up whose it was.
//
// Both are now settled by the same rule: confine to the caller's departments unless they hold
// `patients:read_all_departments`. Front office holds it (their job is clinic-wide and neither
// role implies a modality); diagnostic roles do not; a SuperAdmin can grant it per account.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Patient records are confined to your department', () => {
  let ctx;
  let superAdmin, lab, xray, reception;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const search = async (token, q = 'an') => {
    const res = await ctx.get(`${API}/patients/search?q=${q}`, { headers: auth(token) });
    expect(res.status()).toBe(200);
    return (await res.json()).data;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    superAdmin = await login('admin@enlogada.com');
    lab = await login('lab@enlogada.com');
    xray = await login('xray@enlogada.com');
    reception = await login('receptionist@enlogada.com');
  });

  /**
   * Take the per-account exception back off the lab login.
   *
   * In an afterAll as well as inline, because an assertion that fails BETWEEN the grant and the
   * inline cleanup leaves the exception in place — and a widened lab account then fails the first
   * test in this file on the next run, which grants it again and strands it again. One
   * interrupted run turned into a permanently red spec that way, and the failure pointed at
   * scoping rather than at the residue causing it.
   *
   * A test that leaves authority behind is worse than one that fails: it changes what the next
   * run is testing.
   */
  const clearLabOverrides = async () => {
    const matrix = (await (await ctx.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    const labAccount = matrix.accounts.find((a) => a.email === 'lab@enlogada.com');
    if (!labAccount) return;
    await ctx.put(`${API}/rbac/users/${labAccount.id}/overrides`, {
      headers: auth(superAdmin), data: { overrides: [] },
    });
  };

  test.afterAll(async () => {
    await clearLabOverrides().catch(() => {});
    await ctx.dispose();
  });

  test('the search is scoped, and says which scope it applied', async () => {
    const asSuper = await search(superAdmin);
    const asLab = await search(lab);

    expect(asSuper.departmentScope, 'oversight is unrestricted').toBeNull();
    expect(asLab.departmentScope, 'a lab account is confined to its own room').toEqual(['Laboratory']);

    // Strictly fewer, measured on the SERVER-SIDE TOTAL rather than on the page in hand.
    //
    // `patients.length` is capped by the endpoint's LIMIT, so once the roster grew past a single
    // page the comparison became 20 < 20 and stopped discriminating — a scoped account and an
    // unrestricted one returned identically full pages. Measured on 2026-08-28: both pages 20,
    // while the totals were 27 against 54. Nothing in the application had changed; the data had.
    //
    // Asserting a specific count would break on every reseed, so the property is the inequality.
    expect(asLab.total, 'a scoped account matches strictly fewer records')
      .toBeLessThan(asSuper.total);

    // Not asserted as a set subset: both queries are LIMIT 20, so the unrestricted search returns
    // the first twenty alphabetically and a lab patient further down the alphabet legitimately is
    // not among them. That is a paging artefact, not a scoping failure — the first version of
    // this spec failed on exactly that. The real property is per-record, so check it that way:
    // everything the lab account can see, oversight can also open.
    for (const p of asLab.patients) {
      const res = await ctx.get(`${API}/patients/${p.id}`, { headers: auth(superAdmin) });
      expect(res.status(), `oversight should be able to open PT-${p.id}`).toBe(200);
    }
  });

  test('two departments see different patients', async () => {
    const labIds = new Set((await search(lab)).patients.map((p) => p.id));
    const xrayIds = (await search(xray)).patients.map((p) => p.id);
    // The seeded day gives each modality its own patients, so at least one must differ. If this
    // ever fails on a dataset where every patient had both, the scoping is still working — the
    // fixture just stopped being able to demonstrate it.
    expect(xrayIds.some((id) => !labIds.has(id)), 'X-Ray sees at least one patient Laboratory does not').toBeTruthy();
  });

  test('front office is not confined, because neither role implies a modality', async () => {
    const asReception = await search(reception);
    expect(asReception.departmentScope).toBeNull();
    expect(asReception.patients.length).toBeGreaterThan(0);
  });

  test('opening an out-of-department record 404s rather than 403s', async () => {
    const roster = (await search(superAdmin)).patients;
    const labIds = new Set((await search(lab)).patients.map((p) => p.id));
    const outside = roster.find((p) => !labIds.has(p.id));
    const inside = roster.find((p) => labIds.has(p.id));
    expect(outside, 'fixture must contain a patient outside Laboratory').toBeTruthy();

    const own = await ctx.get(`${API}/patients/${inside.id}`, { headers: auth(lab) });
    expect(own.status(), 'its own department opens normally').toBe(200);

    // 404 and not 403 on purpose: a 403 confirms the record exists, and "does this clinic have a
    // patient called X" is exactly the question the scoping is there to refuse.
    const other = await ctx.get(`${API}/patients/${outside.id}`, { headers: auth(lab) });
    expect(other.status()).toBe(404);
  });

  test('a SuperAdmin can widen one account without touching the role', async () => {
    const matrix = (await (await ctx.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    const permId = matrix.permissions.find((p) => p.name === 'patients:read_all_departments').id;
    const labAccount = matrix.accounts.find((a) => a.email === 'lab@enlogada.com');

    const before = await search(lab);
    expect(before.departmentScope).toEqual(['Laboratory']);

    const grant = await ctx.put(`${API}/rbac/users/${labAccount.id}/overrides`, {
      headers: auth(superAdmin),
      data: { overrides: [{ permissionId: permId, effect: 'grant', reason: 'Covering records desk' }] },
    });
    expect(grant.status()).toBe(200);

    // Same token — authority is read from the database on every request.
    const after = await search(lab);
    expect(after.departmentScope, 'granted the escape hatch, no longer confined').toBeNull();
    // The TOTAL again, for the reason given above: both pages come back full once the roster
    // outgrows one page, and a full page compared against a full page proves nothing.
    expect(after.total, 'widened, so more records match').toBeGreaterThan(before.total);

    // The X-Ray account is untouched: an exception is for one person, not their whole role.
    expect((await search(xray)).departmentScope).toEqual(['Xray']);

    await clearLabOverrides();
    expect((await search(lab)).departmentScope).toEqual(['Laboratory']);
  });
});
