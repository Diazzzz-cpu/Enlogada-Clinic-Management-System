// @ts-check
import { test, expect, request } from 'playwright/test';

// Statutory discounts (Senior Citizen / PWD).
//
// RA 9994 and RA 10754 mandate 20% off medical and diagnostic services, itemised on the receipt,
// with the holder's ID recorded and a separate register kept for BIR. Before this the system had
// no discount concept at all, so the clinic could not lawfully bill a senior — and the practical
// consequence was worse than a missing feature: cashiers work around it by editing the catalogue
// price or taking the difference in cash, which destroys the receipt trail that every other
// control in this codebase depends on.
//
// These assert the parts that must not silently regress: the arithmetic, the ID requirement, who
// may grant one, and that what was deducted actually reaches the register.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

// Local date, matching the server. Deliberately NOT toISOString(), which is UTC and returns
// yesterday for the first eight hours of every Philippine day — the bug this would otherwise
// reproduce rather than catch.
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Statutory discounts (Senior Citizen / PWD)', () => {
  let apiContext;
  let cashier, reception, lab, admin;
  let visitId, senior, testPrice;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    cashier = await login('cashier@enlogada.com');
    reception = await login('receptionist@enlogada.com');
    lab = await login('lab@enlogada.com');
    admin = await login('admin@enlogada.com');

    const catalogue = await (await apiContext.get(`${API}/discounts`, { headers: auth(cashier) })).json();
    senior = catalogue.data.discounts.find((d) => d.name === 'Senior Citizen');

    // Own throwaway visit, so nothing here depends on demo data a purge may have removed.
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    // Self Pay: this spec is about statutory discounts, and the patient type is incidental to
    // that. 'Private' now means physician-referred and would demand a doctor the spec never sets.
    const priv = types.find((t) => /self.?pay/i.test(t.name)) || types[0];

    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: priv.id,
        firstName: 'Teresita',
        lastName: 'Salcedo',
        birthdate: '1950-01-01',
        sex: 'Female',
      },
    })).json();

    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e discount' },
    })).json();
    visitId = visit.data.visit.id;

    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const chosen = tests.find((t) => parseFloat(t.price) > 0);
    testPrice = parseFloat(chosen.price);
    await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: [chosen.id] },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('both statutory discounts are seeded and marked as such', async () => {
    const res = await apiContext.get(`${API}/discounts`, { headers: auth(cashier) });
    expect(res.status()).toBe(200);
    const discounts = (await res.json()).data.discounts;

    for (const required of ['Senior Citizen', 'PWD']) {
      const d = discounts.find((x) => x.name === required);
      expect(d, `${required} must exist in the discount catalogue`).toBeTruthy();
      expect(parseFloat(d.percentage)).toBe(20);
      expect(d.is_statutory).toBe(true);
      // Without the holder's ID on record a statutory discount is an unsupported deduction.
      expect(d.requires_id).toBe(true);
    }
  });

  test('a statutory discount is refused without the holder ID', async () => {
    const res = await apiContext.post(`${API}/discounts/visit/${visitId}`, {
      headers: auth(cashier),
      data: { discountTypeId: senior.id },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/ID number/i);
  });

  test('VAT comes off before the discount does, and the sale reconciles', async () => {
    const applied = await apiContext.post(`${API}/discounts/visit/${visitId}`, {
      headers: auth(cashier),
      data: { discountTypeId: senior.id, idNumber: 'OSCA-E2E-001' },
    });
    expect(applied.status()).toBe(200);

    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;

    // The order is fixed by RA 9994 / RA 10754, and which order applies depends on whether the
    // clinic is VAT-registered — so this reads the clinic's actual status rather than assuming
    // one. Asserting the VAT-registered arithmetic unconditionally is how this spec came to fail
    // the moment the clinic was correctly configured as NON-VAT: the code was right and the test
    // was wrong.
    //
    //   VAT-registered : strip the 12% first, then 20% off the VAT-exempt base -> 714.29/1,000
    //   non-VAT        : no VAT to strip, a plain 20% off the price            -> 800.00/1,000
    //
    // Enlogada is non-VAT ("Non VAT Reg. TIN" on its BIR-registered invoice booklet). Charging
    // the VAT-registered way would hand back 85.71 per 1,000 the clinic never collected VAT on.
    const identity = (await (await apiContext.get(`${API}/clinic`)).json()).data.clinic;
    const vatRegistered = identity.vatRegistered !== 'false';

    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const expectedVat = vatRegistered ? round2(testPrice - testPrice / 1.12) : 0;
    const expectedBase = round2(testPrice - expectedVat);
    const expectedDiscount = round2(expectedBase * 0.2);
    const expectedDue = round2(expectedBase - expectedDiscount);

    expect(bill.vatDeducted).toBe(expectedVat.toFixed(2));
    expect(bill.vatExemptSale).toBe(expectedBase.toFixed(2));
    expect(bill.discountAmount).toBe(expectedDiscount.toFixed(2));
    expect(bill.totalAmount).toBe(expectedDue.toFixed(2));

    // Every centavo has to be accounted for, or the receipt cannot be reconciled to the price the
    // patient was quoted — and processPayment rejects an amount off by more than a centavo.
    const reconciled = round2(
      parseFloat(bill.totalAmount) + parseFloat(bill.discountAmount) + parseFloat(bill.vatDeducted)
    );
    expect(reconciled).toBe(round2(testPrice));

    // On a VAT-registered clinic the flat calculation must NOT be what we charge; on a non-VAT
    // one it is exactly what we charge, and asserting otherwise would be asserting a bug.
    if (vatRegistered) {
      expect(bill.totalAmount).not.toBe(round2(testPrice * 0.8).toFixed(2));
    } else {
      expect(bill.totalAmount).toBe(round2(testPrice * 0.8).toFixed(2));
    }

    expect(bill.discount.name).toBe('Senior Citizen');
    expect(bill.discount.idNumber).toBe('OSCA-E2E-001');
    expect(bill.discount.isStatutory).toBe(true);
  });

  test('diagnostic staff cannot grant a discount; the front desk can', async () => {
    const asLab = await apiContext.post(`${API}/discounts/visit/${visitId}`, {
      headers: auth(lab),
      data: { discountTypeId: senior.id, idNumber: 'X' },
    });
    expect(asLab.status()).toBe(403);

    const asReception = await apiContext.post(`${API}/discounts/visit/${visitId}`, {
      headers: auth(reception),
      data: { discountTypeId: senior.id, idNumber: 'OSCA-E2E-001' },
    });
    expect(asReception.status()).toBe(200);
  });

  test('the undiscounted amount is rejected, and the discount lands on the receipt', async () => {
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;

    // The server recomputes the authoritative total, so the pre-discount figure cannot be charged
    // — by mistake or otherwise.
    const wrong = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.subtotal) },
    });
    expect(wrong.status()).toBe(400);

    const paid = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
    expect(paid.status()).toBe(201);
    const payment = (await paid.json()).data.payment;

    // Snapshotted onto the payment rather than referenced, so a reprint survives catalogue edits.
    expect(parseFloat(payment.discount_amount)).toBe(parseFloat(bill.discountAmount));
    expect(parseFloat(payment.vat_amount)).toBe(parseFloat(bill.vatDeducted));
    expect(payment.discount_type_name).toBe('Senior Citizen');
    expect(payment.discount_id_number).toBe('OSCA-E2E-001');
    // The receipt number carries the server's local date, not a UTC one.
    expect(payment.receipt_number).toContain(todayLocal().replace(/-/g, ''));
  });

  test('the discount cannot be changed once the visit is paid', async () => {
    const res = await apiContext.post(`${API}/discounts/visit/${visitId}`, {
      headers: auth(cashier),
      data: { discountTypeId: senior.id, idNumber: 'OSCA-CHANGED' },
    });
    expect(res.status()).toBe(409);
  });

  test('the BIR statutory register is admin-only and balances', async () => {
    const asCashier = await apiContext.get(`${API}/discounts/register`, { headers: auth(cashier) });
    expect(asCashier.status()).toBe(403);

    const today = todayLocal();
    const res = await apiContext.get(`${API}/discounts/register?startDate=${today}&endDate=${today}`, {
      headers: auth(admin),
    });
    expect(res.status()).toBe(200);
    const register = (await res.json()).data.register;

    const entry = register.entries.find((e) => e.discount_id_number === 'OSCA-E2E-001');
    expect(entry, 'the payment must appear in the statutory register').toBeTruthy();

    // The register reports the VAT-EXEMPT sale, which is what the 20% was taken off — not the
    // shelf price. Gross adds the VAT back so the row ties to what the patient was quoted.
    expect(
      (parseFloat(entry.vat_exempt_sale) - parseFloat(entry.discount_amount)).toFixed(2)
    ).toBe(parseFloat(entry.amount_paid).toFixed(2));
    expect(
      (parseFloat(entry.vat_exempt_sale) + parseFloat(entry.vat_amount)).toFixed(2)
    ).toBe(parseFloat(entry.gross_amount).toFixed(2));

    expect(parseFloat(register.summary.discountTotal)).toBeGreaterThan(0);
    expect(parseFloat(register.summary.vatExemptSalesTotal)).toBeGreaterThan(0);

    // A non-VAT clinic deducts no VAT, so a zero here is the CORRECT figure rather than a missing
    // one — the register still has to balance and still has to show the discount, which the two
    // assertions above check unconditionally.
    const identity = (await (await apiContext.get(`${API}/clinic`)).json()).data.clinic;
    if (identity.vatRegistered !== 'false') {
      expect(parseFloat(register.summary.vatTotal)).toBeGreaterThan(0);
    } else {
      expect(parseFloat(register.summary.vatTotal)).toBe(0);
    }
  });
});
