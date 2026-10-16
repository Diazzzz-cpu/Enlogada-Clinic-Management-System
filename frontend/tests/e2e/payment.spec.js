// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { openPortalTab } from './helpers/portal.js';

// Module 14 (Payment) coverage — the shared data/logic layer behind Module 8 (Cashier) and
// Client-side payment visibility. Three real gaps found on inspection, all fixed here (this
// module's own file, paymentService.js/paymentController.js/paymentRepository.js):
//
// 1. HMO coverage was a blanket 100% discount from the patient's billing *category* alone
//    (patient_type_name === 'HMO'), with no check against whether an HMO request was ever
//    actually approved — confirmed exploitable during Module 8. Fixed to check
//    hmo_request_tests.approval_status per test (Module 15's data, read-only here). Note this
//    is a genuinely separate field from hmo_requests.status (request-level) — a request can be
//    marked Approved while its individual linked tests remain Pending until explicitly
//    approved via PUT /hmo/request-test/:id.
// 2. No server-side idempotency guard or amount verification — confirmed live in Module 8 that
//    a second POST /payments for an already-paid visit was silently accepted, and the
//    client-submitted amount was trusted outright. Both are now enforced server-side.
// 3. "Client-side payment visibility" (named in this module's own MODULE_SCOPE.md text) did
//    not exist at all — no Client-accessible payment endpoint, no UI. Built GET
//    /payments/my-payments + a Payment History card on ClientDashboard.jsx.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };
const ADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

// Default Self Pay: a payment fixture carries no coverage and no referral, and 'Private' now
// means physician-referred, which would demand a doctor none of these tests are about.
async function registerClientWithPatient(apiContext, prefix, patientTypeName = 'Self Pay') {
  const email = uniqueName(prefix) + '@enlogada-e2e.test';
  const password = 'TestPass123!';
  const person = fixturePerson();
  // Through the real sign-up, emailed code and all. See helpers/accounts.js.
  const { token } = await registerClient(apiContext, { ...person, email, password, contactNumber: '' });

  const typesRes = await apiContext.get(`${API}/patients/types`, { headers: { Authorization: `Bearer ${token}` } });
  const patientType = (await typesRes.json()).data.patientTypes.find((t) => t.name === patientTypeName);

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientTypeId: patientType.id, ...person, birthdate: '1990-01-01', sex: 'Male', address: 'Bugo, Cagayan de Oro City', contactNumber: '', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  return { email, token, patient };
}

async function createVisitWithLabTests(apiContext, recToken, patientId, count = 2) {
  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const labTests = (await testsRes.json()).data.tests.filter((t) => t.category_name === 'Laboratory').slice(0, count);

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: labTests.map((t) => t.id) },
  });
  const visitTests = (await vtRes.json()).data.visitTests;

  return { visit, labTests, visitTests };
}

test.describe('HMO coverage requires real per-test approval (API)', () => {
  let apiContext;
  let recToken;
  let cashToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    cashToken = await loginAs(apiContext, CASHIER);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('an HMO-category patient with no approved request pays full price', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'HmoNoApproval', 'HMO');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);

    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;
    expect(parseFloat(bill.hmoCoverage)).toBe(0);
    expect(bill.totalAmount).toBe(bill.subtotal);
  });

  test('approving only one of two tests gives partial coverage, not blanket 100%', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'HmoPartial', 'HMO');
    const { visit, labTests, visitTests } = await createVisitWithLabTests(apiContext, recToken, patient.id, 2);

    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const hmoReqRes = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${recToken}` },
      // referringPhysician is mandatory on a claim since [1.23.0] — the LOA is issued against
      // the requesting doctor, and this fixture's visit is a Self Pay walk-in that names none.
      data: {
        hmoProviderId: providerId, approvalCode: 'LOA-TEST', visitTestIds: [visitTests[0].id],
        referringPhysician: 'Dr. E2E Referrer',
      },
    });
    const hmoRequestTestId = (await hmoReqRes.json()).data.request.tests[0].id;

    // hmo_requests.status (request-level) is separate from hmo_request_tests.approval_status
    // (per-test) — the latter must be explicitly approved for coverage to apply.
    // Phase 12: per-test HMO approval is Admin/SuperAdmin only — the front desk requests
    // coverage, it no longer self-certifies it (matches the flowchart's separate "Request
    // Approval for the Admin" step). Approving with recToken here now 403s.
    const adminToken = await loginAs(apiContext, ADMIN);
    await apiContext.put(`${API}/hmo/request-test/${hmoRequestTestId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { approvalStatus: 'Approved' },
    });

    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;
    const approvedPrice = parseFloat(labTests[0].price);
    expect(Math.abs(parseFloat(bill.hmoCoverage) - approvedPrice)).toBeLessThan(0.01);
    expect(parseFloat(bill.totalAmount)).toBeGreaterThan(0);
    expect(parseFloat(bill.totalAmount)).toBeLessThan(parseFloat(bill.subtotal));
  });

  test('a request-level approval alone (no per-test approval) still gives zero coverage', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'HmoReqOnly', 'HMO');
    const { visit, visitTests } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);

    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;
    await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${recToken}` },
      // referringPhysician is mandatory on a claim since [1.23.0] — the LOA is issued against
      // the requesting doctor, and this fixture's visit is a Self Pay walk-in that names none.
      data: {
        hmoProviderId: providerId, approvalCode: 'LOA-REQ-ONLY', visitTestIds: [visitTests[0].id],
        referringPhysician: 'Dr. E2E Referrer',
      },
    });

    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;
    expect(parseFloat(bill.hmoCoverage)).toBe(0);
  });
});

test.describe('Payment integrity guards (API)', () => {
  let apiContext;
  let recToken;
  let cashToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    cashToken = await loginAs(apiContext, CASHIER);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a duplicate payment for an already-paid visit is rejected with 409', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'DupPay');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);
    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;

    const firstPay = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    });
    expect(firstPay.status()).toBe(201);

    const secondPay = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    });
    expect(secondPay.status()).toBe(409);
  });

  test('a submitted amount lower than the authoritative bill is rejected with 400', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'Tamper');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);

    const res = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: 1 },
    });
    expect(res.status()).toBe(400);
  });

  test('a submitted amount higher than the authoritative bill is also rejected with 400', async () => {
    const { patient } = await registerClientWithPatient(apiContext, 'Overpay');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);

    const res = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: 999999 },
    });
    expect(res.status()).toBe(400);
  });

  test('billing a nonexistent visit returns 404, not a crash', async () => {
    const res = await apiContext.get(`${API}/payments/bill/999999999`, { headers: { Authorization: `Bearer ${cashToken}` } });
    expect(res.status()).toBe(404);
  });
});

test.describe('Client-side payment visibility (API)', () => {
  let apiContext;
  let recToken;
  let cashToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    cashToken = await loginAs(apiContext, CASHIER);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a client can see their own paid visit in payment history', async () => {
    const { token, patient } = await registerClientWithPatient(apiContext, 'PayVis');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);
    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'GCash', referenceNumber: 'GC-123', amount: bill.totalAmount },
    });

    const myPaymentsRes = await apiContext.get(`${API}/payments/my-payments`, { headers: { Authorization: `Bearer ${token}` } });
    expect(myPaymentsRes.status()).toBe(200);
    const payments = (await myPaymentsRes.json()).data.payments;
    expect(payments.length).toBe(1);
    expect(payments[0].payment_status).toBe('Paid');
    expect(payments[0].payment_method).toBe('GCash');
  });

  test('a client with no payments sees an empty list, never another client\'s data', async () => {
    const { token } = await registerClientWithPatient(apiContext, 'NoPayments');
    const res = await apiContext.get(`${API}/payments/my-payments`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    const payments = (await res.json()).data.payments;
    expect(payments).toEqual([]);
  });

  test('unauthenticated request to my-payments is rejected', async () => {
    const res = await apiContext.get(`${API}/payments/my-payments`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Payment — browser flow', () => {
  test('the Payment History card shows a real payment after checkout', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const cashToken = await loginAs(apiContext, CASHIER);
    const { email, patient } = await registerClientWithPatient(apiContext, 'UIPayHist');
    const { visit } = await createVisitWithLabTests(apiContext, recToken, patient.id, 1);
    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;
    await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    });
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 1: Payment History moved from an always-visible sidebar card into its own tab.
    await openPortalTab(page, 'payments');
    await expect(page.getByText('Payment History', { exact: true })).toBeVisible({ timeout: 10000 });

    // Scoped by test id, not by walking up to the nearest element with a `rounded-2xl` class.
    // The old selector meant a change to the panel's corner radius failed this spec, with a
    // message about a missing payment amount rather than about styling — see the note on the
    // panel in ClientDashboard.jsx.
    const paymentCard = page.getByTestId('payment-history');
    await expect(paymentCard.getByText(`₱${parseFloat(bill.totalAmount).toFixed(2)}`)).toBeVisible({ timeout: 10000 });
    await expect(paymentCard.getByText('Paid', { exact: true })).toBeVisible();

    // The receipt number opens the receipt. [1.80.0] It was printed as text, so the document an
    // HMO or an employer asks a patient to produce had no way to it from the list of what they
    // paid. Its own address, in a new tab; receipt-lookup.spec.js holds the ownership check.
    const receipt = paymentCard.getByRole('link', { name: /^RCT-/ });
    await expect(receipt).toHaveAttribute('href', /\?receipt=RCT-/);
    await expect(receipt).toHaveAttribute('target', '_blank');
  });
});
