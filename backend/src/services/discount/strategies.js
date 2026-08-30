const { DiscountStrategy } = require('./discountStrategy');

/**
 * The four rules the clinic actually bills under. [1.63.0]
 *
 * Two of them — `StatutoryNonVatStrategy` and `CommercialStrategy` — compute the identical
 * arithmetic today, and they are still separate classes on purpose. They are the same number for
 * different reasons: one is a statutory entitlement the clinic must grant and can deduct against
 * its own taxes, the other is a commercial choice it may withdraw tomorrow. They are reported
 * separately on the BIR register, they answer to different permissions, and if Enlogada ever
 * registers for VAT only one of them changes. Collapsing them because the maths matches today is
 * how the distinction gets lost exactly when it starts to matter.
 */

/**
 * No discount — the identity case.
 *
 * Reproduces the previous method's early return for `percentage <= 0` exactly: `discountBase`
 * equals `gross` rather than being recomputed, so a zero-rate discount and no discount at all are
 * byte-identical in the response.
 */
class NoDiscountStrategy extends DiscountStrategy {
  get label() { return 'No discount'; }

  get basis() { return 'No entitlement recorded'; }

  /**
   * @param {number} gross
   * @returns {import('./discountStrategy').DiscountBreakdown}
   */
  compute(gross) {
    return { gross, vatDeducted: 0, discountBase: gross, discountAmount: 0, netDue: gross };
  }
}

/**
 * Senior Citizen / PWD at a **VAT-registered** establishment — RA 9994 / RA 10754.
 *
 * ── The order is fixed by statute and is not the intuitive one ──────────────────────────────
 *
 *     VAT-inclusive price          1,000.00
 *     less 12% VAT                  -107.14    (price - price / 1.12)
 *     ------------------------------------
 *     VAT-exempt sale                892.86
 *     less 20% discount             -178.57    (20% of the VAT-EXEMPT base, not of the price)
 *     ------------------------------------
 *     Amount due                     714.29
 *
 * A flat 20% off the shelf price gives 800.00 — it overcharges the patient by ₱85.71 per ₱1,000
 * and understates the deduction the clinic may claim. Discounting first would additionally charge
 * a VAT-exempt patient VAT on part of the sale.
 *
 * `tests.price` is stored VAT-INCLUSIVE — it is the price a patient is quoted — so VAT is
 * *extracted* from it rather than added on top.
 *
 * **This is NOT Enlogada's current case.** The clinic is non-VAT registered; see
 * `StatutoryNonVatStrategy`. This class exists because the registration is a configuration value
 * that can change, and because getting it wrong in the other direction is a VAT exemption claimed
 * by an establishment not registered for VAT.
 */
class StatutoryVatExemptStrategy extends DiscountStrategy {
  /**
   * @param {object} params
   * @param {number} params.percentage  Statutory rate, 20 for both SC and PWD.
   * @param {number} params.vatRate     e.g. 0.12.
   */
  constructor({ percentage, vatRate }) {
    super({ percentage });
    this.vatRate = Number(vatRate) || 0;
  }

  get label() { return 'Statutory (VAT-exempt)'; }

  get basis() { return 'RA 9994 (Senior Citizen) / RA 10754 (PWD), VAT-registered establishment'; }

  /**
   * Extracts the VAT already contained in a VAT-inclusive price.
   *
   * `gross - gross / (1 + rate)`, never `gross * rate` — the latter computes VAT to ADD to a
   * net price and over-deducts by the VAT on the VAT.
   *
   * @param {number} gross
   * @returns {number}
   */
  vatToDeduct(gross) {
    return gross - gross / (1 + this.vatRate);
  }
}

/**
 * Senior Citizen / PWD at a **non-VAT-registered** establishment — Enlogada's actual case.
 *
 * The clinic's BIR-registered service invoice reads *"Non VAT Reg. TIN : 412-980-963-00000"* and
 * *"THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES"*, so `CLINIC_VAT_REGISTERED=false`.
 *
 * There is no VAT in the price to extract, so the 20% comes off the full amount: **₱800.00** on a
 * ₱1,000 service, not ₱714.29. The VAT-extraction step in RA 9994 exists only for establishments
 * that charge VAT; applying it here would strip 12% the clinic never collected and claim an
 * exemption it is not registered for.
 *
 * Inherits the default `vatToDeduct` of zero. The class earns its place by NAMING that zero —
 * "no VAT to remove, because none was charged" is a statement a panel can check, where an
 * unexplained `0` is not.
 */
class StatutoryNonVatStrategy extends DiscountStrategy {
  get label() { return 'Statutory (non-VAT clinic)'; }

  get basis() { return 'RA 9994 / RA 10754, non-VAT-registered establishment — no VAT to extract'; }
}

/**
 * A promo or corporate rate — an ordinary discount, at any registration status.
 *
 * Deliberately never VAT-exempt. Only a *statutory* entitlement carries the VAT step; a commercial
 * rate is a reduction in price and nothing more. That is why `isStatutory` drives the branch and
 * not the percentage — a 20% promo and a 20% senior discount are the same number and different
 * treatments, and reading the rate instead of the entitlement would silently grant a VAT exemption
 * to a marketing campaign.
 */
class CommercialStrategy extends DiscountStrategy {
  get label() { return 'Commercial'; }

  get basis() { return 'Clinic promotional or corporate rate — not VAT-exempt'; }
}

module.exports = {
  NoDiscountStrategy,
  StatutoryVatExemptStrategy,
  StatutoryNonVatStrategy,
  CommercialStrategy,
};
