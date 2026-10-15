// @ts-check
import { test, expect, request } from 'playwright/test';

// The HMO pre-authorisation decision: what was decided, by whom, and why. [1.27.0]
//
// `hmo_request_tests` recorded a decision as one word and nothing else. Three consequences, all
// of which land on the front desk rather than on the person who made the decision:
//
//   A rejection carried no reason. The cashier is the one who has to tell a patient that a test
//   they were assured was covered is now 1,500 pesos out of pocket, and the explanation lived
//   only in whatever the coordinator remembered. Days later, on a dispute, nobody could answer.
//
//   The decision named neither its author nor its time — alone among the money-moving actions in
//   this system. A payment names the cashier, a released result names the authoriser.
//
//   Any string was accepted and passed to the CHECK constraint, so 'Denied' — the word the
//   providers themselves use, and therefore the first one a caller reaches for — came back as an
//   unexplained 500.
//
// Plus the arithmetic the cashier could not see: a test whose claim is undecided is billed at
// full price, and a paid receipt is final [1.121.0]: taking payment now cannot be undone if the approval lands tomorrow.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('HMO decision trail', () => {
  let apiContext;
  let reception, cashier, admin;
  let visitId, requestId, labRow, ultrasoundRow;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const claimTests = async () => {
    const res = await apiContext.get(`${API}/hmo/request/${requestId}`, { headers: auth(admin) });
    const body = await res.json();
    return body?.data?.request?.tests || body?.data?.tests || [];
  };
  const bill = async () => {
    const res = await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) });
    return (await res.json()).data.bill;
  };
  const decide = async (id, data) =>
    apiContext.put(`${API}/hmo/request-test/${id}`, { headers: auth(admin), data });

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    reception = await login('receptionist@enlogada.com');
    cashier = await login('cashier@enlogada.com');
    admin = await login('admin@enlogada.com');

    const providers = (await (await apiContext.get(`${API}/hmo/providers`, { headers: auth(reception) })).json())
      .data.providers;
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const hmoType = types.find((t) => /hmo/i.test(t.name)) || types[0];

    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: hmoType.id, firstName: 'Rodrigo', lastName: 'Panganiban',
        birthdate: '1982-11-30', sex: 'Female',
      },
    })).json();

    // An HMO claim requires the referring physician — the LOA names them. See referralService.
    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: {
        patientId: patient.data.patient.id, visitType: 'Walk in',
        referringPhysician: 'Dr. E2E Referrer', referringPhysicianPrc: '9900001',
      },
    })).json();
    visitId = visit.data.visit.id;

    // Two tests from different categories, so one can be approved and the other refused — which
    // is the ordinary outcome, and the one that decides what the patient actually pays.
    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const pair = [
      tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0),
      tests.find((t) => t.category_name === 'Ultrasound' && parseFloat(t.price) > 0),
    ];
    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: pair.map((t) => t.id) },
    })).json();

    const claim = await apiContext.post(`${API}/hmo/request`, {
      headers: auth(reception),
      data: {
        patientVisitId: visitId, hmoProviderId: providers[0].id,
        memberNumber: `E2E-${Date.now()}`,
        visitTestIds: attached.data.visitTests.map((v) => v.id),
      },
    });
    expect(claim.status()).toBe(201);
    const claimBody = await claim.json();
    requestId = claimBody.data.request?.id || claimBody.data.hmoRequest?.id;

    const rows = await claimTests();
    labRow = rows.find((r) => r.category_name === 'Laboratory');
    ultrasoundRow = rows.find((r) => r.category_name === 'Ultrasound');
    expect(labRow && ultrasoundRow, 'the claim must carry both tests').toBeTruthy();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('an undecided claim is billed in full, and the bill says how much is riding on it', async () => {
    const b = await bill();
    expect(b.hmoPendingCount).toBe(2);
    // Nothing is covered until somebody decides, so the patient is charged the lot. The figure is
    // what makes that a choice the cashier can see rather than one the system makes silently.
    expect(parseFloat(b.hmoPendingAmount)).toBeCloseTo(parseFloat(b.subtotal), 2);
    expect(parseFloat(b.hmoCoverage)).toBe(0);
  });

  test('a decision word the system does not record is refused with a 400 that names the alternatives', async () => {
    // 'Denied' is what the providers say. It reached the CHECK constraint and came back a 500.
    const res = await decide(labRow.id, { approvalStatus: 'Denied' });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('Rejected');
  });

  test('a rejection without a reason is refused', async () => {
    const res = await decide(ultrasoundRow.id, { approvalStatus: 'Rejected' });
    expect(res.status()).toBe(400);
  });

  test('a decision on a test that is not on the claim is a 404, not a silent success', async () => {
    // This returned 200 with an undefined body — the caller was told the decision was recorded.
    const res = await decide(99999999, { approvalStatus: 'Approved' });
    expect(res.status()).toBe(404);
  });

  test('a rejection records why, who and when; an approval records no reason at all', async () => {
    expect((await decide(labRow.id, { approvalStatus: 'Approved' })).status()).toBe(200);
    expect((await decide(ultrasoundRow.id, {
      approvalStatus: 'Rejected',
      decisionReason: "Not covered under the member's plan.",
    })).status()).toBe(200);

    const rows = await claimTests();
    const refused = rows.find((r) => r.approval_status === 'Rejected');
    expect(refused.decision_reason).toContain("member's plan");
    expect(refused.decided_by_first_name, 'the decision must name its author').toBeTruthy();
    expect(refused.decided_at).toBeTruthy();

    // A reason on an approval would read as a caveat on cover the HMO did not attach.
    const approved = rows.find((r) => r.approval_status === 'Approved');
    expect(approved.decision_reason).toBeNull();
  });

  test('the cashier sees the refusal reason on the line it applies to', async () => {
    const b = await bill();
    const refusedLine = b.items.find((i) => i.hmoRejected);
    expect(refusedLine, 'the refused test must be identifiable on the bill').toBeTruthy();
    expect(refusedLine.hmoDecisionReason).toContain("member's plan");

    // And the approved one nets off, so the patient pays the difference and not the whole bill.
    expect(parseFloat(b.hmoCoverage)).toBeGreaterThan(0);
    expect(parseFloat(b.totalAmount)).toBeCloseTo(parseFloat(b.subtotal) - parseFloat(b.hmoCoverage), 2);

    // Everything is decided now, so the warning must go away — a caution that never clears is
    // one staff learn to read past.
    expect(b.hmoPendingCount).toBe(0);
  });
});
