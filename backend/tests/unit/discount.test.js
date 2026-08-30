const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStrategy, computeBreakdown, describeStrategy } = require('../../src/services/discount');
const {
  NoDiscountStrategy,
  StatutoryVatExemptStrategy,
  StatutoryNonVatStrategy,
  CommercialStrategy,
} = require('../../src/services/discount/strategies');

/**
 * The clinic's discount arithmetic. [1.63.0]
 *
 * `verifyDiscountParity.js` already proves the refactor did not change any number, across 16,320
 * comparisons. That is a REGRESSION proof — it says the new code agrees with the old. It says
 * nothing about whether the old code was right.
 *
 * These tests are the other half: they assert the figures against the STATUTE and against the
 * clinic's own BIR-registered invoice, so a future change that breaks the law fails here even if
 * it is internally consistent. The two worked examples below are the ones that matter, and
 * migrations.md records the clinic's VAT registration being believed backwards for a full day.
 */

test('a Senior Citizen at a NON-VAT clinic pays 800.00 on a 1,000.00 service', () => {
  // Enlogada's actual case. The invoice reads "Non VAT Reg. TIN : 412-980-963-00000", so there is
  // no VAT in the price to extract and the 20% comes off the full amount.
  const result = computeBreakdown({
    subtotal: 1000, hmoCoverage: 0, percentage: 20, isStatutory: true,
    vatRegistered: false, vatRate: 0.12,
  });

  assert.equal(result.netDue, 800);
  assert.equal(result.vatDeducted, 0, 'a non-VAT clinic has no VAT to deduct');
  assert.equal(result.discountBase, 1000, 'the discount applies to the full price');
  assert.equal(result.discountAmount, 200);
});

test('a Senior Citizen at a VAT-REGISTERED clinic pays 714.29 — RA 9994 order', () => {
  // VAT out FIRST, then 20% of what remains. A flat 20% gives 800.00, which overcharges the
  // patient by 85.71 per 1,000 and understates the deduction the clinic may claim.
  const result = computeBreakdown({
    subtotal: 1000, hmoCoverage: 0, percentage: 20, isStatutory: true,
    vatRegistered: true, vatRate: 0.12,
  });

  assert.equal(result.vatDeducted, 107.14, '1000 - 1000/1.12');
  assert.equal(result.discountBase, 892.86, 'the VAT-exempt sale');
  assert.equal(result.discountAmount, 178.57, '20% of the VAT-exempt base, not of the price');
  assert.equal(result.netDue, 714.29);
});

test('the two treatments differ by exactly 85.71 per 1,000 — the error that shipped', () => {
  const opts = { subtotal: 1000, hmoCoverage: 0, percentage: 20, isStatutory: true, vatRate: 0.12 };
  const registered = computeBreakdown({ ...opts, vatRegistered: true }).netDue;
  const notRegistered = computeBreakdown({ ...opts, vatRegistered: false }).netDue;

  assert.equal(Number((notRegistered - registered).toFixed(2)), 85.71);
});

test('a commercial rate is NEVER VAT-exempt, whatever the percentage', () => {
  // 20% promo and a 20% statutory discount are the same number and different treatments. Reading
  // the RATE instead of the entitlement would grant a VAT exemption to a marketing campaign.
  const promo = computeBreakdown({
    subtotal: 1000, hmoCoverage: 0, percentage: 20, isStatutory: false,
    vatRegistered: true, vatRate: 0.12,
  });

  assert.equal(promo.vatDeducted, 0);
  assert.equal(promo.netDue, 800);
});

test('the strategy chosen is the one the entitlement implies', () => {
  const at = (percentage, isStatutory, vatRegistered) =>
    resolveStrategy({ percentage, isStatutory, vatRegistered, vatRate: 0.12 });

  assert.ok(at(0, true, false) instanceof NoDiscountStrategy, 'no rate means no discount');
  assert.ok(at(20, true, true) instanceof StatutoryVatExemptStrategy);
  assert.ok(at(20, true, false) instanceof StatutoryNonVatStrategy);
  assert.ok(at(10, false, true) instanceof CommercialStrategy);
  assert.ok(at(10, false, false) instanceof CommercialStrategy);
});

test('every rule names the basis it implements', () => {
  // The point of the refactor: "why does a senior pay this?" has an answer a panel can be shown.
  const statutory = describeStrategy({ percentage: 20, isStatutory: true });
  assert.match(statutory.basis, /RA 9994|RA 10754/);

  const commercial = describeStrategy({ percentage: 10, isStatutory: false });
  assert.match(commercial.basis, /not VAT-exempt/i);
});

test('the parts always reconstitute the whole, to the centavo', () => {
  // processPayment rejects a submitted amount differing by more than a centavo, so an arithmetic
  // disagreement here surfaces as a payment the cashier cannot complete.
  const awkward = [0.01, 33.33, 190, 949.99, 1450, 3333.33, 12345.67];

  for (const subtotal of awkward) {
    for (const percentage of [0, 5, 12, 20, 33.33, 100]) {
      for (const vatRegistered of [true, false]) {
        const r = computeBreakdown({
          subtotal, hmoCoverage: 0, percentage, isStatutory: true, vatRegistered, vatRate: 0.12,
        });
        const sum = Number((r.netDue + r.discountAmount + r.vatDeducted).toFixed(2));
        assert.equal(sum, r.gross, `${subtotal} @ ${percentage}% (vat=${vatRegistered})`);
      }
    }
  }
});

test('the discount applies to the PATIENT share, not to what the HMO settles', () => {
  // Discounting an insurer's money would understate the receivable from the HMO.
  const r = computeBreakdown({
    subtotal: 1450, hmoCoverage: 450, percentage: 20, isStatutory: true,
    vatRegistered: false, vatRate: 0.12,
  });

  assert.equal(r.gross, 1000, 'the patient owes 1450 - 450');
  assert.equal(r.netDue, 800);
});

test('an HMO approving more than the visit is worth never produces a negative bill', () => {
  const r = computeBreakdown({
    subtotal: 500, hmoCoverage: 900, percentage: 20, isStatutory: true,
    vatRegistered: false, vatRate: 0.12,
  });

  assert.equal(r.gross, 0);
  assert.equal(r.netDue, 0, 'never money owed TO the patient');
});

test('a zero rate is byte-identical to no discount at all', () => {
  // Reproduces the pre-refactor early return exactly: discountBase equals gross rather than being
  // recomputed, so the two cases are indistinguishable in the response.
  const zero = computeBreakdown({ subtotal: 950, hmoCoverage: 0, percentage: 0, isStatutory: true });
  assert.deepEqual(zero, {
    gross: 950, vatDeducted: 0, discountBase: 950, discountAmount: 0, netDue: 950,
  });
});
