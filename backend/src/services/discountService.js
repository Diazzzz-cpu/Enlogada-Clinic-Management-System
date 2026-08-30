const discountRepository = require('../repositories/discountRepository');
const visitRepository = require('../repositories/visitRepository');
const paymentRepository = require('../repositories/paymentRepository');
const auditService = require('./auditService');
// Aliased on import. A class method and a module function of the same name do not actually
// collide — a method name is not a lexical binding — but a reader has to know that to be sure
// which one `computeBreakdown(...)` calls inside the method body, and "you have to know a language
// subtlety to see that this is not infinite recursion" is not a property worth having in the file
// that decides what a senior citizen pays.
const {
  computeBreakdown: computeDiscountBreakdown,
  describeStrategy: describeDiscountStrategy,
  toCentavos,
} = require('./discount');
const { NotFoundError, ValidationError, ConflictError } = require('../errors');

class DiscountService {
  /**
   * The discount types the clinic offers.
   *
   * @param {object} [params]
   * @param {boolean} [params.includeInactive]  Staff screens need retired types so a historical
   *   visit can still name the discount it was given.
   * @returns {Promise<Array>}
   */
  async getCatalogue({ includeInactive = false } = {}) {
    return await discountRepository.findAll({ includeInactive });
  }

  /**
   * Breaks a visit's payable amount into VAT, discount and the balance due.
   *
   * The starting figure is the patient's own out-of-pocket amount — subtotal minus whatever the
   * HMO has actually approved — not the gross subtotal. A discount reduces what the *patient*
   * pays; applying it to amounts an insurer is settling would discount somebody else's money and
   * understate the receivable from the HMO.
   *
   * VAT, for a STATUTORY discount at a VAT-registered establishment:
   *
   *     VAT-inclusive price          1,000.00
   *     less 12% VAT                  -107.14    (price - price/1.12)
   *     ------------------------------------
   *     VAT-exempt sale                892.86
   *     less 20% discount             -178.57    (20% of the VAT-EXEMPT base, not of the price)
   *     ------------------------------------
   *     Amount due                     714.29
   *
   * The order is fixed by RA 9994 / RA 10754 and is not the intuitive one. A flat 20% off the
   * price gives 800.00, which overcharges the patient by 85.71 per 1,000 and understates the
   * deduction the clinic can claim; discounting first would also charge a VAT-exempt patient VAT
   * on part of the sale. `tests.price` is stored VAT-INCLUSIVE — it is the shelf price a patient
   * is quoted — so the VAT is extracted from it rather than added on top.
   *
   * Only statutory discounts are VAT-exempt. A promo or corporate rate is an ordinary discount on
   * a VAT-inclusive price, which is why `isStatutory` drives the branch and not the percentage.
   *
   * Each figure is rounded to centavos and the balance is derived from the rounded parts, so
   * `netDue + discountAmount + vatDeducted` always equals `gross` exactly. That matters because
   * processPayment rejects a submitted amount differing by more than a centavo — an arithmetic
   * disagreement here surfaces as a payment the cashier cannot complete.
   *
   * ── The rules themselves live in `./discount` [1.63.0] ──────────────────────────────────
   *
   * The whole calculation used to hang off one ternary here — `isStatutory &&
   * env.CLINIC_VAT_REGISTERED ? extractVat(gross) : 0` — which is the most consequential line of
   * arithmetic in the application and the least visible. It decides whether a senior citizen pays
   * ₱714.29 or ₱800.00 on a ₱1,000 service, and CLAUDE.md records that the clinic's registration
   * was believed to be the opposite of what it is for a full day.
   *
   * It is now four named strategies, each carrying the statute it implements, so the answer to
   * "why does a senior pay this?" is a class a panel can be pointed at. This method stays as the
   * service-layer entry point every caller already uses.
   *
   * Verified centavo-identical to the previous implementation across 16,320 field comparisons —
   * `node src/scripts/verifyDiscountParity.js`, which replays the old algorithm verbatim against
   * the new one over both VAT registration states.
   *
   * @param {object} params
   * @param {number|string} params.subtotal     Sum of `visit_tests.price_at_time`, VAT-inclusive.
   * @param {number|string} params.hmoCoverage  Approved HMO value, removed before discounting.
   * @param {number|string} params.percentage   Discount rate, 0-100.
   * @param {boolean} params.isStatutory        SC/PWD entitlement rather than a commercial rate.
   * @returns {{gross:number, vatDeducted:number, discountBase:number, discountAmount:number, netDue:number}}
   */
  // eslint-disable-next-line class-methods-use-this
  computeBreakdown({ subtotal, hmoCoverage, percentage, isStatutory }) {
    return computeDiscountBreakdown({ subtotal, hmoCoverage, percentage, isStatutory });
  }

  /**
   * Which rule WOULD apply, without computing an amount — for audit lines and bill explanations.
   *
   * @param {object} params
   * @param {number|string} params.percentage
   * @param {boolean} params.isStatutory
   * @returns {{label: string, basis: string, percentage: number}}
   */
  // eslint-disable-next-line class-methods-use-this
  describeStrategy({ percentage, isStatutory }) {
    return describeDiscountStrategy({ percentage, isStatutory });
  }

  /**
   * Records a statutory or commercial discount against a visit.
   *
   * @param {number} visitId
   * @param {object} params
   * @param {number} params.discountTypeId
   * @param {string} params.idNumber  The OSCA/PWD number. Mandatory where the type requires it:
   *   without it a statutory discount is an unsupported deduction, which is what an audit looks for.
   * @param {object} requestingUser  Audited — a deduction names who authorised it.
   * @returns {Promise<object>}
   * @throws {ConflictError} The visit is already paid. The receipt and the statutory register
   *   would otherwise disagree, and there is no re-bill path — a correction goes through a refund.
   */
  async applyToVisit(visitId, { discountTypeId, idNumber }, requestingUser) {
    const visit = await visitRepository.findVisitById(visitId);
    if (!visit) {
      throw new NotFoundError('Visit not found');
    }

    // Once money has changed hands the bill is settled. Changing the discount afterwards would
    // silently disagree with the receipt already issued and with the statutory register, and
    // there is no re-bill path to reconcile it — a correction has to go through the existing
    // refund flow instead.
    const alreadyPaid = await paymentRepository.hasPaidPayment(visitId);
    if (alreadyPaid) {
      throw new ConflictError(
        'This visit has already been paid. Refund the payment first if the discount needs to change.'
      );
    }

    const discount = await discountRepository.findById(discountTypeId);
    if (!discount) {
      throw new ValidationError('Unknown discount type.');
    }
    if (!discount.is_active) {
      throw new ValidationError(`The "${discount.name}" discount is not currently active.`);
    }

    // The ID number is the evidence that the entitlement was checked. Without it a statutory
    // discount is an unsupported deduction, which is precisely what an audit looks for.
    const trimmedId = (idNumber || '').trim();
    if (discount.requires_id && !trimmedId) {
      throw new ValidationError(
        `A ${discount.name} discount requires the holder's ID number (OSCA/PWD ID) to be recorded.`
      );
    }

    const applied = await discountRepository.applyToVisit(visitId, {
      discountTypeId,
      idNumber: trimmedId,
      grantedBy: requestingUser?.userId,
    });

    // Audit-logged like the other money-affecting actions (refunds, HMO approvals): a deduction
    // that reduces what the clinic collects should name who authorised it.
    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'discount.applied',
      entityType: 'patient_visit',
      entityId: visitId,
      description: `Applied ${discount.name} (${discount.percentage}%) to visit #${visitId}${
        trimmedId ? `, ID ${trimmedId}` : ''
      }`,
    });

    return applied;
  }

  async clearFromVisit(visitId, requestingUser) {
    const visit = await visitRepository.findVisitById(visitId);
    if (!visit) {
      throw new NotFoundError('Visit not found');
    }

    const alreadyPaid = await paymentRepository.hasPaidPayment(visitId);
    if (alreadyPaid) {
      throw new ConflictError(
        'This visit has already been paid. Refund the payment first if the discount needs to change.'
      );
    }

    const cleared = await discountRepository.clearFromVisit(visitId);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'discount.removed',
      entityType: 'patient_visit',
      entityId: visitId,
      description: `Removed the discount from visit #${visitId}`,
    });

    return cleared;
  }

  /**
   * The statutory discount register for a date range, plus its totals — the summary an accountant
   * files rather than a raw row dump.
   */
  async getStatutoryRegister({ startDate, endDate }) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await discountRepository.findStatutoryRegister({
      startDate: startDate || today,
      endDate: endDate || today,
    });

    // Reversals are shown but excluded from the totals: a refunded sale is not a discount the
    // clinic actually granted, and counting it would overstate the deduction claimed.
    const settled = rows.filter((r) => r.payment_status === 'Paid');
    const sum = (list, key) => list.reduce((acc, r) => acc + parseFloat(r[key] || 0), 0);

    const byType = {};
    for (const row of settled) {
      const key = row.discount_type_name;
      byType[key] = byType[key] || { discountType: key, count: 0, discountTotal: 0, grossTotal: 0 };
      byType[key].count += 1;
      byType[key].discountTotal = toCentavos(byType[key].discountTotal + parseFloat(row.discount_amount || 0));
      byType[key].grossTotal = toCentavos(byType[key].grossTotal + parseFloat(row.gross_amount || 0));
    }

    return {
      startDate: startDate || today,
      endDate: endDate || today,
      entries: rows,
      summary: {
        transactionCount: settled.length,
        reversedCount: rows.length - settled.length,
        grossTotal: toCentavos(sum(settled, 'gross_amount')).toFixed(2),
        // The two figures BIR actually asks for on a senior/PWD register: what the sale was
        // after VAT was removed, and how much VAT was therefore not collected.
        vatExemptSalesTotal: toCentavos(sum(settled, 'vat_exempt_sale')).toFixed(2),
        vatTotal: toCentavos(sum(settled, 'vat_amount')).toFixed(2),
        discountTotal: toCentavos(sum(settled, 'discount_amount')).toFixed(2),
        netTotal: toCentavos(sum(settled, 'amount_paid')).toFixed(2),
        byType: Object.values(byType).map((t) => ({
          ...t,
          discountTotal: t.discountTotal.toFixed(2),
          grossTotal: t.grossTotal.toFixed(2),
        })),
      },
    };
  }
}

module.exports = new DiscountService();
module.exports.toCentavos = toCentavos;
