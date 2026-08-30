const paymentRepository = require('../repositories/paymentRepository');
const { formatCurrency } = require('../utils/money');
const discountService = require('./discountService');
const db = require('../config/database');
const notificationService = require('./notificationService');
const visitService = require('./visitService');
const visitRepository = require('../repositories/visitRepository');
const patientRepository = require('../repositories/patientRepository');
const auditService = require('./auditService');
const logger = require('../config/logger');

// Feature Gap Plan Phase A: payment_status's CHECK constraint has allowed 'Refunded'/'Cancelled'
// since the schema baseline, but no endpoint ever set them — a duplicate or disputed charge had
// no reversal path anywhere in the app.
const REVERSIBLE_TARGET_STATUSES = ['Refunded', 'Cancelled'];

// The methods this clinic records, for validating a filter against. [1.33.0]
const { COUNTER_METHODS } = require('../constants/paymentMethods');

class PaymentService {
  /**
   * What a visit owes right now — the authoritative figure, recomputed on every call.
   *
   * @param {number} visitId
   * @returns {Promise<{subtotal:number, hmoCoverage:number, discount:object, netDue:number,
   *   tests:Array}>} Never a stored total: the bill is derived from `visit_tests.price_at_time`
   *   plus the live HMO and discount state, so a test added or a discount granted between the
   *   cashier opening the screen and pressing pay cannot leave a stale amount on it.
   */
  async getBillingSummary(visitId) {
    const { visitInfo, items } = await paymentRepository.getBillingSummary(visitId);
    if (!visitInfo) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);
    // HMO coverage is earned per test, from an actually-approved hmo_request_tests row (Module
    // 15's data) — not assumed wholesale from the patient's billing category. A patient
    // registered under the "HMO" patient_type with no approved request for a given test pays
    // for that test in full; a patient with only some tests approved gets partial coverage.
    const hmoCoverage = items
      .filter((item) => item.hmo_approval_status === 'Approved')
      .reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);

    // Statutory (Senior Citizen / PWD) and commercial discounts, applied to the patient's own
    // out-of-pocket amount rather than the gross subtotal. For a statutory discount at a
    // VAT-registered clinic the 12% VAT comes off before the 20% does — see
    // discountService.computeBreakdown for why that order is not optional.
    const breakdown = discountService.computeBreakdown({
      subtotal,
      hmoCoverage,
      percentage: visitInfo.discount_percentage,
      isStatutory: visitInfo.discount_is_statutory,
    });
    const { vatDeducted, discountAmount, netDue: totalAmount } = breakdown;

    const formattedItems = items.map(item => ({
      id: item.visit_test_id,
      name: item.test_name,
      category: item.category_name,
      price: parseFloat(item.price_at_time).toFixed(2),
      status: item.status,
      hmoApproved: item.hmo_approval_status === 'Approved',
      // Only meaningful on a refusal, and null everywhere else — including on claims decided
      // before [1.27.0], which have no honest answer to give.
      hmoRejected: item.hmo_approval_status === 'Rejected',
      hmoDecisionReason: item.hmo_decision_reason || null,
      // The bundle this line belongs to, so the terminal and the receipt can group it. [1.45.0]
      // Null for a test picked on its own, which is most of them.
      packageId: item.package_id || null,
      packageCode: item.package_code || null,
      packageName: item.package_name || null,
      packagePrice: item.package_price || null
    }));

    // Tests on this visit whose HMO claim has not been decided yet. [1.27.0]
    //
    // Charged at full price here, because an undecided claim covers nothing — which is arithmetic
    // the cashier cannot see. The patient hands over the full amount for a test their HMO is
    // about to cover, the approval lands the next day, and the clinic now owes a refund: a second
    // counter visit, a reversal against the cashier's account, and a patient who was charged for
    // something they had been told was covered.
    //
    // Reported, not blocked. Some providers take days to answer and the patient cannot be kept
    // waiting at the counter for one — so this is the cashier's decision to make, and all the
    // system owes them is the fact that it is a decision at all.
    const undecided = items.filter((item) => item.hmo_approval_status === 'Pending');
    const hmoPendingAmount = undecided.reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);

    return {
      visitId,
      patientName: `${visitInfo.first_name} ${visitInfo.last_name}`,
      // The ticket the patient was called by. On the printed receipt it is what ties the piece of
      // paper back to the queue slip they were holding, which is how a counter dispute actually
      // gets resolved — the receipt number means nothing to them, the ticket number does.
      queueNumber: visitInfo.queue_number,
      patientType: visitInfo.patient_type_name,
      items: formattedItems,
      subtotal: subtotal.toFixed(2),
      hmoCoverage: hmoCoverage.toFixed(2),
      // How much of this bill is riding on a claim nobody has answered yet.
      hmoPendingCount: undecided.length,
      hmoPendingAmount: hmoPendingAmount.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      // Zero unless a statutory discount applies at a VAT-registered clinic. The receipt has to
      // show it as its own line — BIR requires a VAT-exempt sale to be presented that way, and a
      // patient comparing the shelf price to what they paid needs the difference explained.
      vatDeducted: vatDeducted.toFixed(2),
      vatExemptSale: breakdown.discountBase.toFixed(2),
      // Null when no discount is claimed. The cashier's screen and the receipt both need the
      // name, rate and ID number, not just the peso figure — a statutory deduction has to be
      // itemised and attributable, not folded silently into the total.
      discount: visitInfo.discount_type_id
        ? {
            id: visitInfo.discount_type_id,
            name: visitInfo.discount_name,
            percentage: parseFloat(visitInfo.discount_percentage).toFixed(2),
            isStatutory: visitInfo.discount_is_statutory,
            idNumber: visitInfo.discount_id_number,
          }
        : null,
      totalAmount: totalAmount.toFixed(2)
    };
  }

  /**
   * Takes a payment: issues a receipt number, settles the visit and releases it to the modalities.
   *
   * @param {object} params
   * @param {number} params.patientVisitId
   * @param {number} params.processedBy      The cashier's user id — named on the receipt.
   * @param {string} params.paymentMethod    'Cash' | 'GCash' | 'Bank'; `chk_payment_method` is the
   *   backstop, and the vocabulary lives in `constants/paymentMethods.js`.
   * @param {string} [params.referenceNumber] The transfer reference, for the two online methods.
   * @param {number} params.amount           Rejected if it differs from the recomputed bill by
   *   more than ₱0.01 — the client's figure is never trusted as the amount charged.
   * @returns {Promise<object>} The settled `payments` row, carrying its receipt number.
   *
   * ── Concurrency guards, and both are load-bearing ────────────────────────────────────────
   *
   * The receipt number comes from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`,
   * never from `COUNT(*) + 1`. Counting rows is not a sequence: it races under two cashiers and it
   * REWINDS when a receipt is refunded, reissuing a number already handed to a patient.
   *
   * `uq_payments_one_paid_per_visit` allows exactly one settled row per visit, so a double-submit
   * is refused by the database rather than by a check that can be outrun.
   *
   * The whole thing runs inside `withTransaction`, so the receipt, the visit status and the
   * modality release commit together or not at all — a released visit with no receipt is work the
   * clinic cannot bill for.
   */
  async processPayment({ patientVisitId, processedBy, paymentMethod, referenceNumber, amount }) {
    // Recompute the authoritative bill server-side — also serves as the visit-exists check —
    // rather than trusting the client-submitted amount outright.
    const bill = await this.getBillingSummary(patientVisitId);

    const alreadyPaid = await paymentRepository.hasPaidPayment(patientVisitId);
    if (alreadyPaid) {
      const error = new Error('This visit has already been paid. Refresh the billing queue.');
      error.statusCode = 409;
      throw error;
    }

    const authoritativeTotal = parseFloat(bill.totalAmount);
    const submittedAmount = parseFloat(amount);
    if (isNaN(submittedAmount) || Math.abs(submittedAmount - authoritativeTotal) > 0.01) {
      const error = new Error(`Submitted amount (₱${amount}) does not match the billed total (₱${authoritativeTotal.toFixed(2)}).`);
      error.statusCode = 400;
      throw error;
    }

    // Taking the money and releasing the visit is one event, so it commits as one.
    //
    // These were four independent auto-committed writes. Dying anywhere in the middle — deploy,
    // process restart, OOM — left the clinic in a state no screen can explain and no user can
    // repair:
    //
    //   payment written, visit not released:  the patient has paid, but the visit is still
    //     'Pending' and its tests are still 'Pending', and every modality worklist filters on
    //     pv.status = 'Processing'. The ticket is invisible to every department. The cashier
    //     cannot retake the payment either — hasPaidPayment now returns true, so the retry is
    //     rejected with "already been paid". The patient waits for an exam nobody can see.
    //
    //   payment written, stale gateway row not cancelled: an abandoned GCash session stays
    //     'Pending' against a settled visit and keeps being offered back to the patient.
    //
    // releaseVisitIfReady is included deliberately: it is the step that makes the payment
    // *mean* something operationally, and it is internally atomic already, so joining this
    // transaction just extends the same guarantee across the pair.
    const receiptNumber = await paymentRepository.getNextReceiptNumber();

    const payment = await db.withTransaction(async () => {
      const created = await paymentRepository.createPayment({
        patientVisitId,
        processedBy,
        paymentMethod,
        referenceNumber,
        receiptNumber,
        amount: authoritativeTotal,
        // Snapshotted from the bill just computed, so the receipt and the statutory register
        // record what was actually deducted rather than re-deriving it later from a catalogue
        // that may since have changed.
        discountAmount: parseFloat(bill.discountAmount || 0),
        discountTypeName: bill.discount?.name || null,
        discountIdNumber: bill.discount?.idNumber || null,
        // With this stored, the whole sale reconciles from the payment row alone:
        //   amount + discount_amount + vat_amount = the original VAT-inclusive price.
        vatAmount: parseFloat(bill.vatDeducted || 0)
      });

      // A counter payment supersedes any online checkout the patient started but never finished
      // for this visit — otherwise an abandoned GCash/Maya session would linger as a 'Pending'
      // payment row against an already-settled visit.
      await paymentRepository.cancelPendingGatewayPayments(patientVisitId);

      // Payment is one of the two release conditions. Attempting the release here — server-side,
      // in the same call that took the money — replaces the CashierDashboard's separate follow-up
      // PATCH, where a network blip between the two requests stranded a fully paid visit at
      // 'Pending' with no ticket ever reaching a modality. A walk-in releases immediately; an
      // appointment still waits for its QR check-in, and this is a no-op until then.
      await visitService.releaseVisitIfReady(patientVisitId);

      return created;
    });

    // Module 18 (Notification): Admin/SuperAdmin financial oversight, matching Reports/Cashier
    // Monitoring — not the processing Cashier themselves, who already sees this live in their
    // own receipt flow.
    await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
      title: 'Payment Confirmed',
      message: `Receipt #${receiptNumber} — ${bill.patientName}, ${formatCurrency(authoritativeTotal)}`,
      type: 'success'
    });

    return payment;
  }

  /**
   * Reverses a settled receipt — a refund or a staff void.
   *
   * @param {number} paymentId
   * @param {object} params
   * @param {string} params.status  'Refunded' or 'Cancelled'.
   * @param {string} params.reason  Required. A reversal with no stated reason leaves the cash-up
   *   short with nothing to explain it.
   * @param {object} requestingUser  Audited; a reversal names who authorised it.
   * @returns {Promise<object>} The updated row.
   *
   * Stamps `refunded_at` rather than mutating `paid_at`. That is the whole of [1.30.0]: takings are
   * bucketed by when money was TAKEN and reversals by when it was HANDED BACK, so reversing an old
   * receipt can never restate a day that has already been printed and filed.
   */
  async updatePaymentStatus(paymentId, { status, reason }, requestingUser) {
    if (!REVERSIBLE_TARGET_STATUSES.includes(status)) {
      const error = new Error(`Status must be one of: ${REVERSIBLE_TARGET_STATUSES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    // A reversal must say why. [1.26.0]
    //
    // `reason` was optional, so money could leave the till with the audit entry recording who and
    // how much and nothing at all about why. That is the one field that makes the entry worth
    // keeping: "Cashier refunded ₱1,200" answers nothing when somebody asks about it in three
    // months, and the person who could have answered has gone home. Required, and required to be
    // more than a keystroke.
    if (!reason || String(reason).trim().length < 4) {
      const error = new Error(
        `Give a reason for the ${status.toLowerCase()} — it is recorded against your account and is what explains this to anyone reviewing the day's takings.`
      );
      error.statusCode = 400;
      throw error;
    }

    const payment = await paymentRepository.findById(paymentId);
    if (!payment) {
      const error = new Error('Payment not found');
      error.statusCode = 404;
      throw error;
    }
    if (payment.payment_status !== 'Paid') {
      const error = new Error(`Only a 'Paid' payment can be ${status.toLowerCase()}. This payment is currently '${payment.payment_status}'.`);
      error.statusCode = 409;
      throw error;
    }

    const updated = await paymentRepository.updatePaymentStatus(paymentId, status, reason);

    // Take the visit back off the modality worklists. [1.26.0]
    //
    // Payment is half of the release rule, so reversing it removes the precondition — and until
    // now nothing acted on that. A refunded visit stayed 'Processing' with its tickets in front
    // of the department, which carried on and did the work: the clinic paying twice, once in
    // reagents and time and once in the refund, with nothing on any screen connecting the two.
    //
    // Work already performed is left alone. A test that has reached 'Waiting for Release' or
    // 'Completed' has been done, and a refund is a commercial decision rather than a reason to
    // pretend an assay never ran.
    let recall = { testsRecalled: 0, workAlreadyDone: false };
    try {
      recall = await visitRepository.recallVisitFromModalities(payment.patient_visit_id);
    } catch (err) {
      // The reversal itself is committed and correct; failing here must not undo it. Logged loudly
      // because it leaves a ticket on a worklist that should not be there.
      logger.error(`Refund recall failed for visit ${payment.patient_visit_id}: ${err.message}`);
    }

    await notificationService.notifyRoles(['Admin', 'SuperAdmin', 'Receptionist'], {
      title: `Payment ${status}`,
      message:
        `Receipt #${payment.receipt_number} — ₱${parseFloat(payment.amount).toFixed(2)}: ${reason}` +
        (recall.workAlreadyDone
          ? ' — work already performed, tickets left with the department.'
          : recall.testsRecalled
            ? ` — ${recall.testsRecalled} ticket(s) pulled back off the worklist.`
            : ''),
      type: 'warning'
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: `payment.${status.toLowerCase()}`,
      entityType: 'payment',
      entityId: paymentId,
      description: `Marked payment ${payment.receipt_number || `#${paymentId}`} (₱${parseFloat(payment.amount).toFixed(2)}) as ${status}${reason ? ` — ${reason}` : ''}`
    });

    return updated;
  }

  // `limit` is optional and absent by default, so the callers that need the whole set — the
  // cashier's own daily collections total, the metric strip, the sales-by-service report — keep
  // getting it. Only the screens that show a page ask for one.
  //
  // `summary` accompanies the list on every call, paged or not, and is the ONLY place a peso
  // total should come from. Screens used to reduce() the list instead, which quietly required
  // the list to contain settled rows exclusively — so the log could not show a reversal without
  // that reversal being counted as income on four different screens. It is also simply correct
  // on a paged call, where reducing the rows in hand totals one page and labels it the day.
  /**
   * `method` filters BOTH the list and the summary, deliberately. [1.33.0]
   *
   * Filtering only the rows would have been a one-line change on the client, and wrong: Cashier
   * Monitoring renders per-cashier totals reduced from this list inside the same grid as
   * `summary.collected`, which is aggregated in SQL over the whole range. A client-side filter
   * moves one and not the other, so the per-cashier cards would show Cash-only takings beside a
   * card showing every method — a contradiction inches apart. lib/collections.js records that
   * this exact class of mismatch has already shipped on this screen once.
   *
   * Rejected rather than ignored when unrecognised. Silently returning everything for a method
   * that does not exist reads, on a money screen, as "the clinic took nothing by that method".
   */
  async getTransactions({ startDate, endDate, page, limit, method, search }) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : null;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    if (method && !COUNTER_METHODS.includes(method)) {
      const error = new Error(
        `Unknown payment method '${method}'. This clinic records: ${COUNTER_METHODS.join(', ')}.`
      );
      error.statusCode = 400;
      throw error;
    }

    const [rows, summary] = await Promise.all([
      paymentRepository.findTransactions({
        startDate,
        endDate,
        method,
        // Trimmed to null rather than passed through: an empty box must not become `%%`, which
        // matches every row while looking to the reader like an active filter.
        search: (search || '').trim() || null,
        limit: limitNum,
        offset: limitNum ? (pageNum - 1) * limitNum : 0,
      }),
      // Deliberately NOT filtered by `search`. The summary is the day's cash position, and a
      // cashier typing a patient's name to find one receipt has not changed what the drawer took.
      // Narrowing it would make the totals move as somebody searched — the fastest way to make a
      // money figure untrustworthy.
      paymentRepository.findTransactionSummary({ startDate, endDate, method }),
    ]);

    // Unpaged callers are handed the array they have always been handed, with the figures
    // riding along as properties — same trick as `total`, so no existing consumer changes shape.
    if (!limitNum) return Object.assign(rows, { summary });
    return {
      transactions: Array.from(rows),
      summary,
      total: rows.total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(rows.total / limitNum)),
    };
  }

  /**
   * One receipt, by its number, with the itemised bill it was issued for. [1.52.0]
   *
   * The receipt already existed as a printable document, but only ever as a dialog inside the
   * cashier's own console, reachable from the day's transaction list. There was no way to answer
   * "find me receipt RCT-20260826-0406" — a question the clinic gets weeks later, from a patient
   * holding a printed slip and asking for a copy for reimbursement.
   *
   * Returns the payment and the bill together, because a receipt is not one row: the payment
   * carries the money and the frozen discount, and the bill carries the lines that explain it.
   * Fetching them as one call is what lets a standalone print page render in a single load.
   */
  async getReceipt(receiptNumber, requestingUser) {
    const payment = await paymentRepository.findByReceiptNumber(receiptNumber);
    if (!payment) {
      const error = new Error('No receipt with that number.');
      error.statusCode = 404;
      throw error;
    }

    // ── Who may read one receipt ───────────────────────────────────────────────────────────────
    //
    // Staff who hold billing:read — Cashier, Admin, SuperAdmin — may read any receipt: answering
    // "send me a copy of RCT-…" is the job. A CLIENT may read exactly their own, and a patient
    // being able to print the receipt for the money they paid is not a privilege, it is the point
    // of issuing one; they need it for HMO reimbursement and for their own records.
    //
    // Authorized HERE rather than by route middleware because the two callers need different
    // questions answered — a permission for staff, ownership for a patient — and a single
    // middleware can only ask one of them. Same shape as resultService's department scoping.
    //
    // The 404 above fires BEFORE this check, which is deliberate and safe: receipt numbers are
    // sequential per day, so confirming existence to a signed-in patient leaks nothing they could
    // not already infer from their own receipt. What must not leak is the CONTENT, and that is
    // what the ownership test below protects.
    const roles = requestingUser?.roles || [];
    if (roles.includes('Client')) {
      const visit = await visitRepository.findVisitById(payment.patient_visit_id);
      const patient = visit ? await patientRepository.findPatientById(visit.patient_id) : null;
      if (!patient || patient.user_id !== requestingUser.userId) {
        const error = new Error('This receipt does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    } else if (!(requestingUser?.permissions || []).includes('billing:read') && !roles.includes('SuperAdmin')) {
      const error = new Error('You do not have permission to read receipts.');
      error.statusCode = 403;
      throw error;
    }

    // The same GET /payments/bill/:visitId the till and the reprint both read, so a receipt opened
    // months later itemises exactly as it did at the counter — price_at_time, not today's prices.
    const bill = await this.getBillingSummary(payment.patient_visit_id);
    return { payment, bill };
  }

  /**
   * Every payment row against a visit, settled or not.
   *
   * @param {number} visitId
   * @returns {Promise<Array>} Includes reversed and abandoned-gateway rows — this is the LOG.
   *   Never sum it for a money figure; the aggregates come from SQL over settled rows.
   */
  async getPaymentsForVisit(visitId) {
    return await paymentRepository.findPaymentsByVisitId(visitId);
  }

  /**
   * A patient's own payment history, across every profile their account owns.
   *
   * @param {number} userId  The account, not a patient — one account may own several profiles.
   * @returns {Promise<Array>} Scoped by `patients.user_id`, which is the ownership boundary.
   */
  async getPaymentsForClient(userId) {
    return await paymentRepository.findPaymentsByPatientUserId(userId);
  }
}

module.exports = new PaymentService();
