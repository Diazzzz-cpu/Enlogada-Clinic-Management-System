/**
 * The shape every discount rule takes. [1.63.0]
 *
 * ── Why a strategy at all ───────────────────────────────────────────────────────────────────
 *
 * `discountService.computeBreakdown` decided the whole thing on one inline condition:
 *
 *     const vatDeducted = isStatutory && env.CLINIC_VAT_REGISTERED ? extractVat(gross) : 0;
 *
 * That line is correct, and it is the single most consequential line of arithmetic in the
 * application — it is the difference between billing a senior citizen ₱714.29 and ₱800.00 on a
 * ₱1,000 service. CLAUDE.md records that the clinic's VAT registration was believed to be the
 * opposite of what it is for a day, and that the fix was this one branch.
 *
 * A ternary is a poor home for a rule of that weight. It cannot be named, cannot be pointed at in
 * a defence, cannot be tested in isolation, and gives a reader no clue that the two sides come
 * from two different pieces of legislation. Splitting it into named strategies means the answer to
 * "why does a senior pay this?" is a class with the statute in its docblock, rather than a
 * condition halfway down a method.
 *
 * ── Template Method, not four copies ────────────────────────────────────────────────────────
 *
 * The ORDER of operations is identical for every rule and is the part that must never vary:
 * extract VAT (if any), then apply the percentage to what remains, then round each figure to
 * centavos and derive the balance from the rounded parts. Only *how much VAT comes off* differs.
 *
 * So the order lives here once, as a template method, and a subclass supplies the single varying
 * step. Four independent `compute()` implementations would let one of them drift into discounting
 * before extracting — which is the exact error RA 9994 is written to prevent, and which no test
 * would catch unless somebody thought to write it.
 *
 * ── Rounding is part of the contract ────────────────────────────────────────────────────────
 *
 * Every figure is rounded to centavos and `netDue` is derived from the ROUNDED parts, so
 * `netDue + discountAmount + vatDeducted === gross` exactly. `paymentService.processPayment`
 * rejects a submitted amount differing by more than ₱0.01, so an arithmetic disagreement here
 * does not surface as a rounding oddity — it surfaces as a payment the cashier cannot complete.
 */

/**
 * Rounds to centavos, half-up.
 *
 * Money is `NUMERIC(10,2)` in Postgres, so a computed figure has to land on a real centavo before
 * it is stored or compared. `Number.EPSILON` is added before rounding because binary floating
 * point puts values like 178.565 fractionally below the midpoint, which would round the wrong way.
 *
 * @param {number|string} value  A peso amount.
 * @returns {number} The amount rounded to two decimal places.
 */
const toCentavos = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * @typedef {object} DiscountBreakdown
 * @property {number} gross           The patient's own share before any deduction.
 * @property {number} vatDeducted     VAT removed from `gross`. Non-zero only for a statutory
 *                                    discount at a VAT-registered establishment.
 * @property {number} discountBase    What the percentage is actually applied to.
 * @property {number} discountAmount  The peso value of the discount.
 * @property {number} netDue          What the patient pays. `gross - vatDeducted - discountAmount`.
 */

class DiscountStrategy {
  /**
   * @param {object} params
   * @param {number} params.percentage  The discount rate, 0-100.
   */
  constructor({ percentage }) {
    this.percentage = Number(percentage) || 0;
  }

  /**
   * A short name for this rule, for logs, audit entries and a defence.
   * @returns {string}
   */
  // eslint-disable-next-line class-methods-use-this
  get label() {
    return 'Discount';
  }

  /**
   * The legal or commercial basis, so the reason travels with the code.
   * @returns {string}
   */
  // eslint-disable-next-line class-methods-use-this
  get basis() {
    return 'Clinic policy';
  }

  /**
   * How much VAT comes off before the percentage is applied — the ONE step that varies.
   *
   * Default is none, which is correct for every rule except a statutory discount granted by a
   * VAT-registered establishment. A subclass that needs VAT removed overrides this and nothing
   * else, so it cannot accidentally change the order of operations.
   *
   * @param {number} _gross  The patient's share, VAT-inclusive.
   * @returns {number} Peso amount of VAT to remove. Rounded by the caller.
   */
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  vatToDeduct(_gross) {
    return 0;
  }

  /**
   * The fixed order of operations. Subclasses supply `vatToDeduct`; none of them override this.
   *
   * @param {number} gross  The patient's own share, after any HMO coverage is removed.
   * @returns {DiscountBreakdown}
   */
  compute(gross) {
    const vatDeducted = toCentavos(this.vatToDeduct(gross));
    const discountBase = toCentavos(gross - vatDeducted);
    const discountAmount = toCentavos((discountBase * this.percentage) / 100);
    const netDue = toCentavos(discountBase - discountAmount);

    return { gross, vatDeducted, discountBase, discountAmount, netDue };
  }
}

module.exports = { DiscountStrategy, toCentavos };
