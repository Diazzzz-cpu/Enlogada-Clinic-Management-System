const env = require('../../config/environment');
const { toCentavos } = require('./discountStrategy');
const {
  NoDiscountStrategy,
  StatutoryVatExemptStrategy,
  StatutoryNonVatStrategy,
  CommercialStrategy,
} = require('./strategies');

/**
 * Picks the billing rule that applies, and runs it. [1.63.0]
 *
 * The public entry point for discount arithmetic. `discountService.computeBreakdown` delegates
 * here, so every caller — the cashier's terminal, the patient's own estimate, the BIR register —
 * goes through one resolution and cannot disagree about what a senior citizen pays.
 */

/**
 * Chooses the strategy for a given entitlement.
 *
 * Two facts decide it, in this order:
 *
 *   1. **Is there a discount at all?** A zero or absent rate short-circuits to the identity case
 *      before anything else is considered.
 *   2. **Is the entitlement STATUTORY, and is the clinic VAT-registered?** Both must be true for
 *      the VAT-extraction step. Statutory alone is not enough — a non-VAT clinic has no VAT in its
 *      prices to extract — and VAT-registration alone is not either, since a commercial promo is
 *      never VAT-exempt.
 *
 * `vatRegistered` and `vatRate` are injected rather than read from `env` inside the strategies, so
 * the rules can be exercised for both registration states in one process. That is what makes the
 * equivalence check in `scripts/verifyDiscountParity.js` possible without restarting the server
 * under a different configuration.
 *
 * @param {object} params
 * @param {number} params.percentage        Discount rate, 0-100.
 * @param {boolean} params.isStatutory      True for Senior Citizen / PWD; false for a promo rate.
 * @param {boolean} [params.vatRegistered]  Defaults to the clinic's configured registration.
 * @param {number} [params.vatRate]         Defaults to the configured VAT rate.
 * @returns {import('./discountStrategy').DiscountStrategy}
 */
function resolveStrategy({
  percentage,
  isStatutory,
  vatRegistered = env.CLINIC_VAT_REGISTERED,
  vatRate = env.VAT_RATE,
}) {
  const pct = Number(percentage) || 0;
  if (pct <= 0) return new NoDiscountStrategy({ percentage: 0 });

  if (isStatutory) {
    return vatRegistered
      ? new StatutoryVatExemptStrategy({ percentage: pct, vatRate })
      : new StatutoryNonVatStrategy({ percentage: pct });
  }

  return new CommercialStrategy({ percentage: pct });
}

/**
 * Breaks a visit's payable amount into VAT, discount and the balance due.
 *
 * The starting figure is the patient's own out-of-pocket amount — subtotal minus whatever the HMO
 * has actually approved — not the gross subtotal. A discount reduces what the *patient* pays;
 * applying it to amounts an insurer is settling would discount somebody else's money and
 * understate the receivable from the HMO.
 *
 * @param {object} params
 * @param {number|string} params.subtotal      Sum of `visit_tests.price_at_time`, VAT-inclusive.
 * @param {number|string} params.hmoCoverage   Approved HMO value, removed before discounting.
 * @param {number|string} params.percentage    Discount rate, 0-100.
 * @param {boolean} params.isStatutory         Whether this is an SC/PWD entitlement.
 * @param {boolean} [params.vatRegistered]     Override, for tests and parity checks.
 * @param {number} [params.vatRate]            Override, for tests and parity checks.
 * @returns {import('./discountStrategy').DiscountBreakdown}
 */
function computeBreakdown({ subtotal, hmoCoverage, percentage, isStatutory, vatRegistered, vatRate }) {
  // Floored at zero: an HMO approving more than the visit is worth must never produce a negative
  // bill that then reads as money owed TO the patient.
  const gross = toCentavos(Math.max(0, Number(subtotal) - Number(hmoCoverage)));

  const strategy = resolveStrategy({ percentage, isStatutory, vatRegistered, vatRate });
  return strategy.compute(gross);
}

/**
 * The rule that WOULD be applied, without running it — for audit lines and for explaining a bill.
 *
 * @param {object} params  Same shape as `resolveStrategy`.
 * @returns {{label: string, basis: string, percentage: number}}
 */
function describeStrategy(params) {
  const strategy = resolveStrategy(params);
  return { label: strategy.label, basis: strategy.basis, percentage: strategy.percentage };
}

module.exports = { resolveStrategy, computeBreakdown, describeStrategy, toCentavos };
