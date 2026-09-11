import { fixturePerson, FIXTURE_CONTACT } from './people.js';

/**
 * Setting up a visit with a bill on it, and a patient's claim against that bill.
 *
 * Lifted out of `manual-payment.spec.js` when `proof-review.spec.js` needed the same scaffolding to
 * put a submission in front of the cashier's queue. [1.72.0] Two copies of the money path — create
 * a patient, bill them, upload a proof — is the kind of duplication that drifts silently: the copy
 * that is not being read stops matching the API it calls, and the spec relying on it starts
 * skipping instead of failing.
 *
 * Everything here creates rows scoped by the run window, which `purgeE2eData.js` removes at the end
 * of the run — including the payment_submissions attached to the visits.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
export const API = `${BACKEND_URL}/api`;

export const CREDS = {
  superadmin: { email: 'admin@enlogada.com', password: 'Password123!' },
  admin: { email: 'clinicadmin@enlogada.com', password: 'Password123!' },
  cashier: { email: 'cashier@enlogada.com', password: 'Password123!' },
  receptionist: { email: 'receptionist@enlogada.com', password: 'Password123!' },
};

/**
 * A 1x1 PNG. The smallest thing that is genuinely an image, so the mime check is exercised without
 * carrying a fixture file around.
 */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export async function loginAs(api, creds) {
  const res = await api.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

/** A walk-in carrying a real bill, so there is something to pay. */
export async function billedVisit(api, token) {
  const H = { Authorization: `Bearer ${token}` };
  const types = (await (await api.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
  const selfPay = types.find((t) => t.name === 'Self Pay');

  const patient = (await (await api.post(`${API}/patients`, {
    headers: H,
    data: {
      ...fixturePerson(), birthdate: '1990-01-01', sex: 'Female',
      address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      patientTypeId: selfPay.id,
    },
  })).json()).data.patient;

  const visit = (await (await api.post(`${API}/visits`, {
    headers: H, data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e manual payment' },
  })).json()).data.visit;

  const packages = (await (await api.get(`${API}/packages`)).json()).data.packages;
  await api.post(`${API}/tests/visit-tests`, {
    headers: H, data: { patientVisitId: visit.id, packageIds: [packages[0].id] },
  });

  const bill = (await (await api.get(`${API}/payments/bill/${visit.id}`, {
    headers: { Authorization: `Bearer ${await loginAs(api, CREDS.cashier)}` },
  })).json()).data.bill;

  return { visit, patient, total: Number(bill.totalAmount) };
}

export async function submitProof(api, token, visitId, { amount, reference, methodId }) {
  return api.post(`${API}/payment-submissions`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      patientVisitId: String(visitId),
      ...(methodId ? { paymentMethodId: String(methodId) } : {}),
      referenceNumber: reference,
      amountClaimed: String(amount),
      proof: { name: 'receipt.png', mimeType: 'image/png', buffer: PNG },
    },
  });
}

/** A published account to pay into, created once if the clinic has none. */
export async function ensureMethod(api, superToken) {
  const existing = (await (await api.get(`${API}/payment-methods`)).json()).data.methods;
  if (existing.length) return existing[0];

  const res = await api.post(`${API}/payment-methods`, {
    headers: { Authorization: `Bearer ${superToken}` },
    data: {
      kind: 'GCash', label: 'E2E GCash', accountName: 'Enlogada Clinic',
      accountNumber: '09000000000',
    },
  });
  return (await res.json()).data.method;
}
