// @ts-check
import { test, expect, request } from 'playwright/test';

// The three-step workflow the clinic actually runs: reception raises the claim, an Admin or
// SuperAdmin decides it, the cashier bills what is left. [1.28.0]
//
// Only the first and third steps existed. `hmo:approve` was already Admin/SuperAdmin-only — that
// part was right — but the route could only ever say YES. `chk_hmo_status` has allowed 'Rejected'
// since [1.0.0] and nothing could set it, so a claim the provider turned down had two outcomes
// available in practice: approve it anyway, or leave it Pending forever at the top of a worklist
// that filters on Pending, being reopened by every coordinator who scanned it.
//
// And nothing connected step two to step three. The cashier was never told a decision had
// happened, so the patient sat in the lobby while the cashier reloaded the bill on a hunch — or
// charged them in full because nothing said otherwise and the approval landed an hour later.

// Named like a person, because this row sits in the Active Queue and the billing queue while
// the suite runs — see tests/e2e/helpers/people.js.
const PATIENT_SURNAME = 'Gatchalian';

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('HMO claim handoff', () => {
  let apiContext;
  let reception, cashier, admin, lab;
  let providerId, hmoTypeId, labTestId;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  // Each test builds its own claim: these decide claims, and a decided claim cannot be redecided,
  // so sharing one between tests would make them order-dependent.
  const makeClaim = async ({ memberNumber = null } = {}) => {
    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: hmoTypeId, firstName: 'Fernando', lastName: PATIENT_SURNAME,
        birthdate: '1981-07-04', sex: 'Male',
      },
    })).json();
    // An HMO claim needs the referring physician — the LOA is issued against them.
    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: {
        patientId: patient.data.patient.id, visitType: 'Walk in',
        referringPhysician: 'Dr. E2E Referrer', referringPhysicianPrc: '9900002',
      },
    })).json();
    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.data.visit.id, testIds: [labTestId] },
    })).json();
    const claim = await apiContext.post(`${API}/hmo/request`, {
      headers: auth(reception),
      data: {
        hmoProviderId: providerId,
        memberNumber,
        visitTestIds: attached.data.visitTests.map((v) => v.id),
      },
    });
    expect(claim.status()).toBe(201);
    const body = await claim.json();
    return { id: body.data.request?.id || body.data.hmoRequest?.id, visitId: visit.data.visit.id };
  };

  const notificationsFor = async (token) =>
    (await (await apiContext.get(`${API}/notifications`, { headers: auth(token) })).json())
      .data.notifications;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    reception = await login('receptionist@enlogada.com');
    cashier = await login('cashier@enlogada.com');
    admin = await login('admin@enlogada.com');
    lab = await login('lab@enlogada.com');

    providerId = (await (await apiContext.get(`${API}/hmo/providers`, { headers: auth(reception) })).json())
      .data.providers[0].id;
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    hmoTypeId = (types.find((t) => /hmo/i.test(t.name)) || types[0]).id;
    labTestId = (await (await apiContext.get(`${API}/tests`)).json()).data.tests
      .find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0).id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('only Admin and SuperAdmin may decide a claim', async () => {
    const claim = await makeClaim();
    // Reception raises claims and must not clear them — that separation is the whole point of
    // hmo:approve being held by two roles and not four.
    for (const [who, token] of [['reception', reception], ['cashier', cashier], ['lab', lab]]) {
      const res = await apiContext.put(`${API}/hmo/request/${claim.id}/reject`, {
        headers: auth(token), data: { decisionReason: 'should never be recorded' },
      });
      expect(res.status(), `${who} must not be able to decide a claim`).toBe(403);
    }
  });

  test('a claim cannot be turned down without a reason', async () => {
    const claim = await makeClaim();
    const res = await apiContext.put(`${API}/hmo/request/${claim.id}/reject`, {
      headers: auth(admin), data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('a refusal records the reason and its author, and reaches the cashier', async () => {
    const claim = await makeClaim();
    const res = await apiContext.put(`${API}/hmo/request/${claim.id}/reject`, {
      headers: auth(admin), data: { decisionReason: "Member's policy lapsed on 01 Aug." },
    });
    expect(res.status()).toBe(200);

    const detail = (await (await apiContext.get(`${API}/hmo/request/${claim.id}`, { headers: auth(admin) })).json())
      .data.request;
    expect(detail.status).toBe('Rejected');
    expect(detail.decision_reason).toContain('policy lapsed');
    expect(detail.decided_by_first_name, 'the decision must name its author').toBeTruthy();

    // The handoff. Without it the cashier learns nothing and the patient waits.
    const alert = (await notificationsFor(cashier)).find((n) => /turned down/i.test(n.title));
    expect(alert, 'the cashier must be told the claim was refused').toBeTruthy();
    expect(alert.message, 'and told who it is about').toContain(PATIENT_SURNAME);
    expect(alert.type).toBe('warning');
  });

  test('an approval reaches the cashier too, as good news rather than a warning', async () => {
    const claim = await makeClaim();
    const res = await apiContext.put(`${API}/hmo/request/${claim.id}/approve`, {
      headers: auth(admin), data: { approvalCode: 'LOA-E2E-0001' },
    });
    expect(res.status()).toBe(200);

    const alert = (await notificationsFor(cashier)).find((n) => /claim approved/i.test(n.title));
    expect(alert).toBeTruthy();
    expect(alert.type).toBe('success');
    expect(alert.message).toContain('LOA-E2E-0001');
  });

  test('a decided claim is not decided again', async () => {
    const claim = await makeClaim();
    expect((await apiContext.put(`${API}/hmo/request/${claim.id}/approve`, {
      headers: auth(admin), data: { approvalCode: 'LOA-E2E-0002' },
    })).status()).toBe(200);

    // Re-approving would have reissued the notification; rejecting would have silently
    // overwritten the approval, and the reason column with it.
    const again = await apiContext.put(`${API}/hmo/request/${claim.id}/reject`, {
      headers: auth(admin), data: { decisionReason: 'changed our mind' },
    });
    expect(again.status()).toBe(409);
  });

  test('the approval worklist says who each claim is for, and keeps the member number', async () => {
    const memberNumber = `E2E-MBR-${Date.now()}`;
    const claim = await makeClaim({ memberNumber });

    const rows = (await (await apiContext.get(`${API}/hmo/requests`, {
      headers: auth(admin), params: { status: 'Pending' },
    })).json()).data.requests;
    const row = rows.find((r) => r.id === claim.id);

    // Every one of these was absent. The worklist carried provider, date and a count, so several
    // claims from one provider on one day rendered as identical rows and the only way to learn
    // whose insurance you were approving was to open each in turn.
    expect(row.patient_last_name).toBe(PATIENT_SURNAME);
    expect(row.queue_number).toBeTruthy();
    // memberNumber was accepted by the API and written nowhere — the number lived only inside the
    // card photo, which pruneHmoCards deletes after 180 days.
    expect(row.member_number).toBe(memberNumber);
    // Refusals are counted as well as approvals: "1 / 2" could not distinguish a half-decided
    // claim from one whose other half was turned down.
    expect(row).toHaveProperty('rejected_test_count');
  });
});
