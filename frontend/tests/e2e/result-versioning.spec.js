// @ts-check
import { test, expect, request } from 'playwright/test';
import { reportPart } from './helpers/reportFile.js';

// Result versioning and critical-value flagging.
//
// Two clinical-safety failures that shared one table:
//
//   Correcting a released result used to OVERWRITE it. test_results carried
//   UNIQUE(visit_test_id) and the write was an ON CONFLICT DO UPDATE, so a radiology report
//   already issued to a patient could be silently rewritten with nothing recording what it used
//   to say. The audit entry noted only that a correction happened.
//
//   A panic value released with the same silent "your results are ready" email as a routine CBC.
//
// The assertions below are the ones that must never regress: the original text survives, exactly
// one version is live, lists do not repeat a row per version, and a critical result escalates.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Result versioning and critical values', () => {
  let apiContext;
  let lab, reception, admin;
  let visitTestId;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  // Findings go up as multipart because the route carries multer for the optional file field.
  const record = async (token, fields) => {
    const res = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: auth(token),
      // A release needs its report document [1.94.0]; findings are no longer typed.
      // Overridable, so a spec that is specifically about a result WITHOUT one still can.
      multipart: {
        file: reportPart('versioning'),
        ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
      },
    });
    return { status: res.status(), body: await res.json() };
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    lab = await login('lab@enlogada.com');
    reception = await login('receptionist@enlogada.com');
    admin = await login('admin@enlogada.com');
    const cashier = await login('cashier@enlogada.com');

    // Builds its own ticket rather than borrowing one from the demo seed. These tests release and
    // amend whatever they touch, so reusing a seeded ticket would quietly consume the "paid,
    // released to Laboratory" demo stage on every run — the suite is supposed to leave the
    // demo dataset exactly as it found it.
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    // Self Pay: this spec is about amendment history; the type is incidental. 'Private' now
    // means physician-referred and would demand a doctor the spec never sets.
    const priv = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: priv.id, firstName: 'Clarita', lastName: 'Hidalgo',
        birthdate: '1985-06-15', sex: 'Male',
      },
    })).json();

    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e versioning' },
    })).json();
    const visitId = visit.data.visit.id;

    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: [labTest.id] },
    })).json();
    visitTestId = attached.data.visitTests[0].id;

    // Paying releases a walk-in straight to the modalities — that is the gate the worklist is
    // behind, and findings cannot be recorded until it opens.
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;
    const paid = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
    expect(paid.status(), 'the ticket must be released before findings can be recorded').toBe(201);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('an amendment supersedes rather than overwrites, and the original survives', async () => {
    const v1 = await record(lab, { findings: 'Haemoglobin 13.2 g/dL. Within normal limits.', remarks: 'Routine' });
    expect(v1.status).toBe(201);

    const v2 = await record(lab, {
      findings: 'Haemoglobin 8.1 g/dL. Low.',
      remarks: 'Repeat confirms',
      amendmentReason: 'Transcription error in original report',
    });
    expect(v2.status).toBe(201);
    expect(v2.body.data.result.version).toBe(v1.body.data.result.version + 1);

    const versions = (await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json())
      .data.versions;

    // The whole point: the superseded text is still readable.
    const original = versions.find((v) => v.version === v1.body.data.result.version);
    expect(original, 'the original version must still exist').toBeTruthy();
    expect(original.findings).toContain('13.2');
    expect(original.is_current).toBe(false);

    // And the chain is walkable forwards.
    expect(original.superseded_by).toBe(v2.body.data.result.id);
    expect(versions.find((v) => v.is_current).amendment_reason).toBe('Transcription error in original report');
  });

  test('exactly one version is live, and lists never repeat a row per version', async () => {
    const versions = (await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json())
      .data.versions;
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.filter((v) => v.is_current)).toHaveLength(1);

    // The live read returns the newest, not an arbitrary version.
    const current = (await (await apiContext.get(`${API}/results/${visitTestId}`, { headers: auth(lab) })).json())
      .data.result;
    expect(current.version).toBe(Math.max(...versions.map((v) => v.version)));

    // The regression that versioning most easily introduces: a LEFT JOIN without an is_current
    // filter repeats the ticket once per amendment and shows superseded findings as live.
    const released = (await (await apiContext.get(`${API}/results/released/Laboratory`, { headers: auth(lab) })).json())
      .data.released;
    expect(released.filter((r) => r.visit_test_id === visitTestId).length).toBeLessThanOrEqual(1);
  });

  test('a critical result escalates and can be acknowledged exactly once', async () => {
    const critical = await record(lab, {
      findings: 'Potassium 7.4 mmol/L. CRITICALLY HIGH.',
      remarks: 'Urgent',
      amendmentReason: 'Repeat sample confirms critical value',
      isCritical: 'true',
    });
    expect(critical.status).toBe(201);
    expect(critical.body.data.result.is_critical).toBe(true);

    const release = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(release.status()).toBe(200);
    expect((await release.json()).data.result.isCritical).toBe(true);

    // Reception is included on purpose: the front desk usually makes the call, and a callback
    // that cannot be recorded by whoever made it does not get recorded.
    const ack = await apiContext.post(`${API}/results/${visitTestId}/acknowledge-critical`, {
      headers: auth(reception),
      data: { note: 'Phoned patient 14:20, spoke to Dr Reyes' },
    });
    expect(ack.status()).toBe(200);

    // Acknowledging twice would make the callback record ambiguous about when contact happened.
    const again = await apiContext.post(`${API}/results/${visitTestId}/acknowledge-critical`, {
      headers: auth(reception),
      data: { note: 'duplicate' },
    });
    expect(again.status()).toBe(409);
  });

  test('the escalation reaches staff as a critical-severity notification', async () => {
    const res = await apiContext.get(`${API}/notifications`, { headers: auth(admin) });
    expect(res.status()).toBe(200);
    const notifications = (await res.json()).data.notifications;

    const alert = notifications.find((n) => /CRITICAL RESULT/i.test(n.title));
    expect(alert, 'a critical release must raise a notification').toBeTruthy();
    // Severity matters as much as the message: notification_events.type was CHECKed to
    // ('info','success','warning') and the service silently downgrades anything else, so this
    // escalation arrived looking exactly like "New Appointment Booked" until 'critical' existed.
    expect(alert.type).toBe('critical');
  });

  test('the amendment history is department-scoped like every other result read', async () => {
    // Xray staff have no business reading a Laboratory result's history.
    const xray = await login('xray@enlogada.com');
    const res = await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(xray) });
    expect(res.status()).toBe(403);
  });
});

// Amending a result AFTER it has been released. [1.26.0]
//
// Versioning shipped in [1.15.0] and then could not be used for the case it exists for. Three
// faults compounded, each invisible from the screen:
//
//   The write guard required the visit to be 'Processing'. A visit turns 'Completed' the moment
//   its last result goes out, so amendment became impossible exactly when a correction is
//   normally discovered. The same guard sat on the two READ paths, so the technician who wrote a
//   report could no longer open it or its history once the visit closed.
//
//   The amendment reason was optional, and the audit entry recorded the absence as "no reason
//   given" against a corrected medical report.
//
//   Once amended, the ticket returned to 'Waiting for Release' while the visit stayed 'Completed'
//   — and the worklist filters on `pv.status = 'Processing'` while the Released tab filters on
//   `vt.status = 'Completed'`. The ticket appeared on neither. The correction was accepted, shown
//   as saved, and then reached nobody: the patient and the referring doctor kept the wrong report.
//
// This walks the whole loop, because the failure mode throughout is silence, not an error.
test.describe('Amending an already-released result', () => {
  let apiContext;
  let lab, reception, cashier;
  let visitId, visitTestId;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const record = async (fields) => {
    const res = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      // A release needs its report document [1.94.0]; findings are no longer typed.
      // Overridable, so a spec that is specifically about a result WITHOUT one still can.
      multipart: {
        file: reportPart('amendment'),
        ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
      },
    });
    return res.status();
  };
  const visitStatus = async () => {
    const res = await apiContext.get(`${API}/visits/${visitId}`, { headers: auth(reception) });
    return (await res.json()).data.visit.status;
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    lab = await login('lab@enlogada.com');
    reception = await login('receptionist@enlogada.com');
    cashier = await login('cashier@enlogada.com');

    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const selfPay = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: selfPay.id, firstName: 'Mariano', lastName: 'Escalona',
        birthdate: '1979-03-02', sex: 'Female',
      },
    })).json();
    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e amendment' },
    })).json();
    visitId = visit.data.visit.id;

    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: [labTest.id] },
    })).json();
    visitTestId = attached.data.visitTests[0].id;

    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('re-saving before release needs no reason — drafting is not amending', async () => {
    expect(await record({ findings: 'Potassium 7.4 mmol/L.', remarks: '' })).toBe(201);
    // Nobody outside the department has seen this yet. Demanding a justification for fixing your
    // own typo is friction that buys nothing, and fills the reason box with "typo".
    expect(await record({ findings: 'Potassium 4.1 mmol/L.', remarks: 'corrected before release' })).toBe(201);

    const released = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);
    expect(await visitStatus(), 'releasing the only test closes the visit').toBe('Completed');
  });

  test('the technician can still read the result and its history once the visit closes', async () => {
    // Both of these were 403 — the write guard was doing duty as the read guard, so the moment a
    // visit completed the author lost sight of their own report. Which is precisely when somebody
    // telephones to query it.
    const current = await apiContext.get(`${API}/results/${visitTestId}`, { headers: auth(lab) });
    expect(current.status()).toBe(200);
    const history = await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) });
    expect(history.status()).toBe(200);
  });

  test('a released result cannot be amended without a stated reason', async () => {
    expect(await record({ findings: 'Something else entirely.', remarks: '' })).toBe(400);
    expect(await visitStatus(), 'a refused amendment must not disturb the visit').toBe('Completed');
  });

  test('with a reason it is accepted, and the ticket goes back where staff will see it', async () => {
    expect(await record({
      findings: 'Potassium 4.1 mmol/L. Within normal limits.',
      remarks: '',
      amendmentReason: 'Transcription error against the analyser printout.',
    })).toBe(201);

    // The visit reopens, or the amendment reaches no screen at all.
    expect(await visitStatus()).toBe('Processing');

    const worklist = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: auth(lab) });
    expect(worklist.status()).toBe(200);
    const row = (await worklist.json()).data.pending.find((p) => p.visit_test_id === visitTestId);
    expect(row, 'the amended ticket must be back on the worklist to be re-released').toBeTruthy();
    expect(row.test_status).toBe('Waiting for Release');
  });

  test('re-releasing closes the visit again and every version is kept', async () => {
    const released = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(released.status()).toBe(200);
    expect(await visitStatus()).toBe('Completed');

    const history = await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json();
    // Three drafts/amendments: two before release, one after. None overwritten.
    expect(history.data.versions.length).toBe(3);
    const live = history.data.versions.filter((v) => v.is_current);
    expect(live.length, 'exactly one version is ever live').toBe(1);
    expect(live[0].findings).toContain('Within normal limits');
  });
});
