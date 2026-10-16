// @ts-check
import { test, expect, request } from 'playwright/test';
import { registerClient } from './helpers/accounts.js';
import { runScript } from './helpers/backendScript.js';

// Account lockout, and PHI read auditing.
//
// The lockout policy is deliberately forgiving, and that is the part worth pinning. A tight
// threshold turns the lockout into a denial of service against the clinic itself: anyone who can
// guess receptionist@enlogada.com could fail five logins at 08:00 and take the front desk offline
// during the morning rush, which is worse than the attack it prevents. So these assert both
// halves — that it eventually locks, and that it does NOT lock too early.
//
// The PHI audit tests pin the scope rather than the mechanism: reads of an identified patient are
// recorded, and the high-frequency screens (search, worklists) deliberately are not. Logging
// those would bury the entries an investigation needs under traffic that is just staff doing
// their job — the same fan-out mistake that took notification_reads to a quarter of a million rows.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'TestPass123!';

// Must match FAILED_LOGIN_THRESHOLD in authService.
const THRESHOLD = 10;

test.describe('Account lockout after repeated failures', () => {
  let apiContext;
  let email;

  const attempt = async (password) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    email = `lockout_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
    await registerClient(apiContext, {
      firstName: 'Perlita', lastName: 'Ilagan', email, password: PASSWORD, contactNumber: '09170000000',
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('mistyping short of the threshold never locks anyone out', async () => {
    for (let i = 0; i < THRESHOLD - 1; i += 1) {
      expect((await attempt('wrong-password')).status).toBe(401);
    }
    // The important half. A staff member who fumbles their password a few times across a shift
    // must still be able to work — and a correct sign-in wipes the slate.
    expect((await attempt(PASSWORD)).status, 'still usable one short of the threshold').toBe(200);
  });

  test('the counter resets on success, so failures never accumulate across sessions', async () => {
    for (let i = 0; i < THRESHOLD - 1; i += 1) await attempt('wrong-password');
    // If the previous test's failures had persisted, this would already be locked.
    expect((await attempt(PASSWORD)).status).toBe(200);
  });

  test('the account locks at the threshold, even with the right password', async () => {
    for (let i = 0; i < THRESHOLD; i += 1) await attempt('wrong-password');

    const locked = await attempt(PASSWORD);
    expect(locked.status, 'a correct password must not bypass the lock').toBe(423);
    expect(locked.body.message).toMatch(/locked/i);
    // Tells the user how long, rather than leaving them retrying and extending it.
    expect(locked.body.message).toMatch(/\d+ minute/);
  });

  test('a lock that has run out starts the count again, so one slip does not lock it for another fifteen minutes', async () => {
    // [1.85.0] The count used to carry on from where the lock left it. It still stood at the
    // threshold when the lock ran out, so the first wrong password afterwards locked the account
    // again, and the person most likely to type it is the one who has just waited.
    //
    // Locks the account itself rather than relying on the test above, so it also runs alone.
    for (let i = 0; i < THRESHOLD; i += 1) await attempt('wrong-password');
    expect((await attempt(PASSWORD)).status, 'locked before the lock is run out').toBe(423);

    runScript('e2eExpireLock.js', [`--email=${email}`], 'expire-lock');

    expect((await attempt('wrong-password')).status).toBe(401);
    expect((await attempt(PASSWORD)).status, 'one slip after a lock runs out must not lock it again').toBe(200);
  });
});

test.describe('PHI read auditing', () => {
  let apiContext;
  let reception, lab, admin;
  let patient;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const login = async (userEmail) => {
    const res = await apiContext.post(`${API}/auth/login`, {
      data: { email: userEmail, password: 'Password123!' },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    reception = await login('receptionist@enlogada.com');
    lab = await login('lab@enlogada.com');
    admin = await login('admin@enlogada.com');

    const found = await apiContext.get(`${API}/patients/search?q=ma`, { headers: auth(reception) });
    const patients = (await found.json()).data.patients;
    test.skip(!patients || patients.length === 0, 'no patient records to read');
    patient = patients[0];
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('reading an identified patient record is recorded against that patient', async () => {
    // High-water mark on the id rather than a timestamp window, and a page big enough to still
    // contain the new rows. Run alone this passed with limit=25; run inside the full suite, the
    // other specs' audit entries pushed these off the first page — a fragile test, not a
    // regression, but one that would have been read as the latter.
    const marker = await apiContext.get(`${API}/admin/activity?limit=1`, { headers: auth(admin) });
    const [latest] = (await marker.json()).data.entries || [];
    const before = latest ? latest.id : 0;

    await apiContext.get(`${API}/patients/${patient.id}`, { headers: auth(reception) });
    await apiContext.get(`${API}/results/history/${patient.id}`, { headers: auth(lab) });

    const activity = await apiContext.get(`${API}/admin/activity?limit=50`, { headers: auth(admin) });
    expect(activity.status()).toBe(200);
    const entries = (await activity.json()).data.entries || [];

    const recent = entries.filter((e) => e.id > before && String(e.action).startsWith('phi.read'));
    expect(recent.length, 'both reads must be recorded').toBeGreaterThanOrEqual(2);
    // Both the demographics read and the clinical-history read.
    expect(recent.some((e) => e.action === 'phi.read.patient_record')).toBeTruthy();
    expect(recent.some((e) => e.action === 'phi.read.result_history')).toBeTruthy();

    // Keyed on the patient, because that is the only question this table is ever asked during an
    // incident: "who accessed this person's data?"
    for (const entry of recent) {
      expect(entry.entity_type).toBe('patient');
      expect(String(entry.entity_id)).toBe(String(patient.id));
      // Named actor, not just an id — an audit trail nobody can read is not one.
      expect(entry.actor_name).toBeTruthy();
    }
  });

  test('searches and worklists are deliberately NOT logged', async () => {
    // A high-water mark on the id, not a timestamp window. The preceding test writes its entries
    // milliseconds earlier, so any wall-clock tolerance wide enough to be reliable also catches
    // them — which is exactly the false failure this replaced.
    const highWaterMark = async () => {
      const res = await apiContext.get(`${API}/admin/activity?limit=1`, { headers: auth(admin) });
      const [latest] = (await res.json()).data.entries || [];
      return latest ? latest.id : 0;
    };

    const before = await highWaterMark();

    await apiContext.get(`${API}/patients/search?q=ma`, { headers: auth(reception) });
    await apiContext.get(`${API}/results/pending/Laboratory`, { headers: auth(lab) });

    const activity = await apiContext.get(`${API}/admin/activity?limit=25`, { headers: auth(admin) });
    const added = ((await activity.json()).data.entries || []).filter((e) => e.id > before);

    // Staff refresh these constantly. Logging them would bury the entries that matter under
    // traffic that is just people doing their job — the fan-out mistake that took
    // notification_reads to a quarter of a million rows.
    expect(
      added.filter((e) => String(e.action).startsWith('phi.read')),
      'high-frequency screens must not generate audit entries'
    ).toHaveLength(0);
  });
});
