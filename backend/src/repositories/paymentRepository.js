const db = require('../config/database');
const {
  ISSUED_IN_RANGE, REVERSED_IN_RANGE, ISSUED_RECEIPT_CLAUSE
} = require('../constants/moneyRange');
// The payment vocabulary and the cash-up buckets built from it. [1.33.0]
const {
  CASH_METHOD, BANK_METHOD, EWALLET_METHODS, sqlList
} = require('../constants/paymentMethods');

// A row that represents a receipt the clinic actually handed to a patient — settled, or settled
// and later reversed. Written once and shared by the log and its summary so the two can never
// disagree about which rows they are describing, which is the failure this pair exists to avoid.
// See the note in findTransactions for why both halves are needed.
//
// Now shared with reportRepository too, for the same reason one step out: the operations report
// counted reversals without it and only escaped counting abandoned checkout sessions as refunds
// by also omitting 'Cancelled'. Two mistakes cancelling is not a rule holding.
const ISSUED_RECEIPT = `WHERE ${ISSUED_RECEIPT_CLAUSE}`;

class PaymentRepository {
  /**
   * The discount fields are a snapshot, not a reference.
   *
   * A receipt is a historical record: it must keep saying what it said even if the discount
   * catalogue is renamed, re-rated or deactivated afterwards. Same reasoning as
   * visit_tests.price_at_time. It is also what the statutory register reads, so the register
   * reflects what was actually deducted from money that actually changed hands.
   */
  async createPayment({
    patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount,
    discountAmount = 0, discountTypeName = null, discountIdNumber = null, vatAmount = 0
  }) {
    const queryText = `
      INSERT INTO payments (
        patient_visit_id, processed_by, payment_method, reference_number, receipt_number, amount,
        discount_amount, discount_type_name, discount_id_number, vat_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount,
      discountAmount, discountTypeName, discountIdNumber, vatAmount
    ]);
    return result.rows[0];
  }

  async findPaymentsByVisitId(patientVisitId) {
    const queryText = `
      SELECT pay.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      WHERE pay.patient_visit_id = $1
      ORDER BY pay.paid_at DESC
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  // Paged at the database. [1.29.0] This returned every settled payment in the range and the
  // screen sliced fifteen out of it. Measured at 570 bytes a payment, a year-wide range is a
  // 2.0 MB response — and this is the money screen, read on every cashier dashboard load and by
  // Admin's monitoring view. `limit` is optional so the callers that legitimately need the whole
  // set (today's collections total, the metric strip) are unchanged.
  async findTransactions({ startDate, endDate, method = null, search = null, limit = null, offset = 0 }) {
    // The FROM/JOIN chain is shared by the list and the count, so the two can never disagree
    // about which rows they are talking about. Written out rather than derived from the list
    // query by a regex: that would break silently the next time somebody edits the SELECT list.
    const fromClause = `
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
    `;
    let whereText = '';
    const params = [];

    // Receipts that were actually issued — which is what this log is, and what the screen above
    // it says it is: "refunds and cancellations are recorded against the original receipt".
    //
    // This used to read `payment_status = 'Paid'`, and so a refunded receipt DISAPPEARED from the
    // cashier's log the moment it was reversed. For a daily cash-up that is backwards: the
    // receipt a cashier most needs to account for is the one they had to reverse, and the drawer
    // is short by an amount with nothing on screen to explain it.
    //
    // Two conditions, and both are load-bearing:
    //
    //   payment_status IN (…)     keeps 'Pending' and 'Failed' out. An online checkout inserts a
    //                             'Pending' row the moment the patient is redirected, and that is
    //                             not money until the signed webhook says so. It also leads the
    //                             (payment_status, paid_at) index, so the range below still scans.
    //
    //   receipt_number IS NOT NULL  is what separates the two meanings of 'Cancelled'. A patient
    //                             who opens a second checkout gets their first session cancelled
    //                             by cancelPendingGatewayPayments — money never taken, and it must
    //                             never appear here as a receipt. A *paid* receipt voided by staff
    //                             is a real reversal and must. The receipt number is the
    //                             difference: it is assigned on settlement and never before, so a
    //                             row that has one was, at some point, money.
    //
    // paid_at cannot make that distinction — it is DEFAULT CURRENT_TIMESTAMP, so an abandoned
    // gateway session carries one too.
    //
    // The range matches on EITHER date. [1.30.0] A receipt paid on the 19th and reversed on the
    // 20th belongs in both days' logs, for different reasons: on the 19th it is a receipt that
    // was issued, and on the 20th it is the reversal the cashier processed and has to account
    // for. Matching only paid_at left the summary's `reversed` figure with no row behind it on
    // the day it was reported.
    //
    // Money totals do NOT come from this list any more; see findTransactionSummary. Widening a
    // list that ten client-side reduce() calls were summing is exactly how a refund would have
    // started counting as revenue.
    // Half-open range rather than a ::date cast: a B-tree index cannot serve a predicate on an
    // expression, so the cast turned every transaction lookup into a sequential scan of payments
    // — the table that grows fastest and is read on every cashier dashboard load.
    //
    // Built from the same fragments as the summary's WHERE, so the log and the money can never
    // describe different rows — which is the one invariant cashup-reversals.spec.js exists to
    // hold. The `refunded_at IS NOT NULL` in REVERSED_IN_RANGE is redundant against a range test
    // that a NULL fails anyway, and is kept because sharing one definition is worth more than
    // shaving a term off a predicate.
    const hasDates = Boolean(startDate && endDate);
    if (hasDates) params.push(startDate, endDate);
    whereText = `${ISSUED_RECEIPT} AND (
        (${ISSUED_IN_RANGE(hasDates)})
        OR (${REVERSED_IN_RANGE(hasDates)})
      )`;

    // The optional method filter. [1.33.0] Parameterised rather than interpolated even though the
    // service has already checked it against COUNTER_METHODS: a validated value that reaches SQL
    // by concatenation is one refactor away from an unvalidated one.
    if (method) {
      params.push(method);
      whereText += ` AND pay.payment_method = $${params.length}`;
    }

    // Finding one receipt again, months later. [1.52.0]
    //
    // A cashier asked for "the receipt for Dela Cruz" has three things they might be holding: the
    // receipt number off the printed slip, the patient's name, or the GCash reference the patient
    // read out over the phone. All three search the same box, because making them choose the right
    // field first is how a lookup fails for someone who has the right information.
    //
    // ILIKE with a leading wildcard cannot use a B-tree index, and that is accepted deliberately
    // here: this runs only when a human types in the search box, always inside a date range that
    // has already narrowed the scan, and never on the dashboard's own load. The alternative —
    // anchoring the pattern — would stop 'Cruz' finding 'Dela Cruz', which is the search people
    // actually perform.
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      whereText += ` AND (
        pay.receipt_number ILIKE $${n}
        OR pay.reference_number ILIKE $${n}
        OR p.first_name ILIKE $${n}
        OR p.last_name ILIKE $${n}
        OR (p.first_name || ' ' || p.last_name) ILIKE $${n}
      )`;
    }

    // The row's own answer to "did this one contribute to the collected figure". [1.30.0]
    //
    // The list matches on EITHER date, so it contains rows that are here only because they were
    // REVERSED in range — a receipt taken last week and refunded today. A client reducing the
    // list cannot tell those apart without re-deriving the range predicate, and re-deriving it
    // from `payment_status` is now wrong in both directions: a reversed receipt still counts if
    // it was taken in range, and a prior-week receipt does not count even though it is listed.
    //
    // Cashier Monitoring's per-cashier breakdown and the Reports method breakdown both reduce
    // this list and both render inside the same grid as the collected total they should sum to.
    // Answering from the same predicate that computed the total makes them reconcile by
    // construction rather than by coincidence.
    const selectList = `
      SELECT pay.*,
             (${ISSUED_IN_RANGE(hasDates)}) AS counted_in_collected,
             u.first_name as processed_by_first_name, u.last_name as processed_by_last_name,
             p.first_name as patient_first_name, p.last_name as patient_last_name,
             pv.queue_number
    `;

    const countRes = await db.query(`SELECT COUNT(*)::int AS total ${fromClause} ${whereText}`, params);
    const total = countRes.rows[0].total;

    let listQuery = `${selectList} ${fromClause} ${whereText} ORDER BY pay.paid_at DESC`;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      listQuery += ` LIMIT $${listParams.length}`;
      listParams.push(offset);
      listQuery += ` OFFSET $${listParams.length}`;
    }
    const result = await db.query(listQuery, listParams);
    // An array with a `total` on it: every existing caller keeps treating this as the list it
    // always was, and the paged callers read the count without a second round trip.
    return Object.assign(result.rows, { total });
  }

  /**
   * The money figures for the same range, aggregated in SQL over SETTLED rows only.
   *
   * Every screen that shows a peso total used to compute it in the browser, by reduce()-ing the
   * transaction list — ten such reductions across the cashier dashboard, cashier monitoring, the
   * admin dashboard and the reports overview. That worked only because the list was, by
   * accident, exclusively 'Paid' rows. It made the list's WHERE clause silently load-bearing for
   * every revenue figure in the app: the moment the log correctly began showing a reversal, all
   * ten would have counted the refunded amount as income.
   *
   * So the log and the money are two different questions and get two different queries. The log
   * shows what happened; this counts what the drawer should hold.
   *
   * FILTER rather than separate round trips, matching reportRepository.getOperationsReport —
   * one pass over one index range, and `refunded` is reported beside `collected` rather than
   * being netted off it. A cash-up needs both numbers: netting hides that a reversal happened.
   */
  async findTransactionSummary({ startDate, endDate, method = null }) {
    const params = [];
    const hasDates = Boolean(startDate && endDate);
    if (hasDates) params.push(startDate, endDate);

    // Applied to the same rows the list sees, so a filtered screen's totals describe exactly the
    // rows under them. Note what this means for the method tiles: filter to Cash and `ewallet`
    // and `bank` correctly become zero, because the clinic took nothing by those methods among
    // the rows being shown. The three still sum to `collected`. [1.33.0]
    let methodText = '';
    if (method) {
      params.push(method);
      methodText = ` AND pay.payment_method = $${params.length}`;
    }

    // Money IN during the range, and money BACK during the range — two different dates, which is
    // the whole point of refunded_at existing. [1.30.0]
    //
    // `issued` deliberately does NOT test payment_status: a receipt issued on the 19th was money
    // on the 19th whatever happens to it afterwards. Filtering it out once reversed restated a
    // closed day, so the printed cash-up sheet and the screen disagreed with no way to tell which
    // was right. A receipt paid and refunded on the same day now reads as 550 in and 550 out
    // rather than as nothing having happened, which is what the drawer actually did.
    //
    // These moved to constants/moneyRange.js unchanged. reportRepository was left on the old
    // `payment_status = 'Paid'` basis, so the operations report's Takings panel disagreed with
    // this summary about the same day — and still restated closed days, on the half that gets
    // printed. Two copies of a rule this subtle drift; one cannot.
    const issued = ISSUED_IN_RANGE(hasDates);
    const reversed = REVERSED_IN_RANGE(hasDates);

    const queryText = `
      SELECT
        COALESCE(SUM(pay.amount) FILTER (WHERE ${issued}), 0)::numeric(12,2)
          AS collected,
        COUNT(*) FILTER (WHERE ${issued})::int
          AS receipts,
        COALESCE(SUM(pay.amount) FILTER (
          WHERE ${issued} AND pay.payment_method = '${CASH_METHOD}'), 0)::numeric(12,2)
          AS cash,
        COALESCE(SUM(pay.amount) FILTER (
          WHERE ${issued} AND pay.payment_method IN (${sqlList(EWALLET_METHODS)})), 0)::numeric(12,2)
          AS ewallet,
        -- Bank transfer is neither cash nor e-wallet, and without it the method figures do not
        -- reconcile to the collected figure — a 200.00 transfer once appeared in no tile at all,
        -- which is exactly the money a cashier stops to hunt for. Named rather than lumped into
        -- an "other": chk_payment_method enumerates the whole vocabulary, and Cash + e-wallet +
        -- Bank partitions it with no remainder, so these three ARE the total. Built from
        -- constants/paymentMethods.js [1.33.0], which asserts that partition holds rather than
        -- leaving it as a comment that a fourth method would silently falsify.
        COALESCE(SUM(pay.amount) FILTER (
          WHERE ${issued} AND pay.payment_method = '${BANK_METHOD}'), 0)::numeric(12,2)
          AS bank,
        COALESCE(SUM(pay.discount_amount) FILTER (WHERE ${issued}), 0)::numeric(12,2)
          AS discounts,
        -- Reported beside the collections figure, never subtracted from it. Netting hides that a
        -- reversal happened, and a drawer short by a refund needs the refund named.
        COALESCE(SUM(pay.amount) FILTER (WHERE ${reversed}), 0)::numeric(12,2)
          AS reversed,
        COUNT(*) FILTER (WHERE ${reversed})::int
          AS reversals
      FROM payments pay
      ${ISSUED_RECEIPT}
        AND ((${issued}) OR (${reversed}))${methodText}
    `;
    const result = await db.query(queryText, params);
    return result.rows[0];
  }

  async getBillingSummary(patientVisitId) {
    const visitQuery = `
      SELECT pv.id, p.first_name, p.last_name, pt.name as patient_type_name,
             -- Printed on the receipt: the ticket number is what the patient was called by, and
             -- the thing that ties the paper in their hand back to the queue slip.
             pv.queue_number,
             pv.discount_id_number,
             dt.id   as discount_type_id,
             dt.name as discount_name,
             dt.percentage as discount_percentage,
             dt.is_statutory as discount_is_statutory
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN discount_types dt ON pv.discount_type_id = dt.id
      WHERE pv.id = $1
    `;
    const visitResult = await db.query(visitQuery, [patientVisitId]);

    // Correlated subquery (not a LEFT JOIN) for hmo_approval_status. uq_hmo_one_live_claim_per_test
    // [1.31.0] now allows at most one LIVE claim per test, but a refused claim and its retry can
    // coexist — that is the point of the constraint being partial — so a test can still match more
    // than one hmo_request_tests row and a JOIN would duplicate the line item, silently inflating
    // the bill subtotal. The subquery guarantees exactly one row per test, taking the most recent
    // linked request, which is the live one whenever a rejected predecessor exists.
    const itemsQuery = `
      SELECT vt.id as visit_test_id, vt.price_at_time, vt.status,
             t.name as test_name, tc.name as category_name,
             -- The bundle a line came from, so the cashier and the receipt can say "Package A"
             -- once instead of listing six components at prices that look arbitrary alone.
             -- ₱226.96 for a CBC invites a question at the counter that nobody can answer.
             vt.package_id, tp.code as package_code, tp.name as package_name,
             tp.price as package_price,
             (
               SELECT hrt.approval_status
               FROM hmo_request_tests hrt
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_approval_status,
             -- Why the HMO refused, carried onto the bill because that is where the question gets
             -- asked. [1.27.0] The patient is told at the counter that a test they expected to be
             -- covered is not, and the cashier is the one who has to say why. Same subquery shape,
             -- and deliberately a second one rather than a lateral join: the cost is a second index
             -- lookup on a handful of rows, and it keeps the "exactly one row per test" guarantee
             -- above impossible to break by accident.
             (
               SELECT hrt.decision_reason
               FROM hmo_request_tests hrt
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_decision_reason
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      LEFT JOIN test_packages tp ON tp.id = vt.package_id
      WHERE vt.patient_visit_id = $1
      -- Package lines group together and lead, because that is how the patient bought them.
      ORDER BY tp.code NULLS LAST, tc.name, t.name
    `;
    const itemsResult = await db.query(itemsQuery, [patientVisitId]);

    return {
      visitInfo: visitResult.rows[0],
      items: itemsResult.rows
    };
  }

  // Module 14's "Client-side payment visibility" — aggregates across all of the client's own
  // patient profiles/dependents, matching the same pattern already used by
  // appointmentRepository.findByPatientUserId and patientRepository.findPatientsByUserId.
  async findPaymentsByPatientUserId(userId) {
    const queryText = `
      SELECT pay.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
             pv.queue_number, pv.visit_type
      FROM payments pay
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE p.user_id = $1
      ORDER BY pay.paid_at DESC
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  async findById(id) {
    const queryText = `
      SELECT pay.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      WHERE pay.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  /**
   * One receipt by its number. [1.52.0]
   *
   * Carries the patient and the cashier alongside the payment, because a printed receipt names
   * both and a second round trip for each would make a print page load in three requests.
   *
   * `receipt_number` has a unique index (migrateDataIntegrity.js), so this can never return two.
   */
  async findByReceiptNumber(receiptNumber) {
    const queryText = `
      SELECT pay.*,
             u.first_name AS processed_by_first_name,
             u.last_name  AS processed_by_last_name,
             p.first_name AS patient_first_name,
             p.last_name  AS patient_last_name,
             pv.queue_number,
             pv.visit_type
        FROM payments pay
        LEFT JOIN users u        ON u.id = pay.processed_by
        JOIN patient_visits pv   ON pv.id = pay.patient_visit_id
        JOIN patients p          ON p.id = pv.patient_id
       WHERE pay.receipt_number = $1
    `;
    const result = await db.query(queryText, [receiptNumber]);
    return result.rows[0];
  }

  async updatePaymentStatus(id, status, reason) {
    const queryText = `
      UPDATE payments
      SET payment_status = $1::varchar,
          refund_reason = $2,
          -- Stamped only on the way INTO a reversal, and only once. [1.30.0] Without this the
          -- cash-up had nothing to bucket a refund by except paid_at — the day the money came
          -- in — so reversing an older receipt restated a day that was already closed.
          -- $1 is cast everywhere it appears. Without the casts Postgres has to deduce one type
          -- for a parameter used both as a varchar assignment and as the left side of an IN, and
          -- refuses: "inconsistent types deduced for parameter $1" — a 500 on every reversal.
          refunded_at = CASE
            WHEN $1::varchar IN ('Refunded', 'Cancelled') AND refunded_at IS NULL THEN CURRENT_TIMESTAMP
            WHEN $1::varchar IN ('Refunded', 'Cancelled') THEN refunded_at
            ELSE NULL
          END
      WHERE id = $3
      RETURNING *
    `;
    const result = await db.query(queryText, [status, reason || null, id]);
    return result.rows[0];
  }

  async hasPaidPayment(patientVisitId) {
    const queryText = `
      SELECT 1 FROM payments
      WHERE patient_visit_id = $1 AND payment_status = 'Paid'
      LIMIT 1
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows.length > 0;
  }

  // --- Online payment gateway (GCash / Maya via PayMongo hosted checkout) -----------------

  // Inserted as 'Pending' when the patient is redirected to the provider. Deliberately NOT
  // 'Paid': the browser coming back to our success_url proves nothing (it is a plain URL the
  // patient can visit directly), so only the signed webhook may settle this row.
  async createPendingGatewayPayment({ patientVisitId, processedBy, paymentMethod, amount, gatewayProvider, gatewaySessionId }) {
    const queryText = `
      INSERT INTO payments (
        patient_visit_id, processed_by, payment_method, amount,
        payment_status, gateway_provider, gateway_session_id
      )
      VALUES ($1, $2, $3, $4, 'Pending', $5, $6)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientVisitId, processedBy, paymentMethod, amount, gatewayProvider, gatewaySessionId
    ]);
    return result.rows[0];
  }

  async findByGatewaySessionId(gatewaySessionId) {
    const queryText = `
      SELECT pay.*, p.first_name, p.last_name
      FROM payments pay
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE pay.gateway_session_id = $1
    `;
    const result = await db.query(queryText, [gatewaySessionId]);
    return result.rows[0];
  }

  // The webhook settlement. `WHERE payment_status = 'Pending'` makes this idempotent: PayMongo
  // retries webhook deliveries, and a redelivery of an already-settled session must not issue
  // a second receipt number or re-trigger the ticket release. A no-op returns undefined.
  async markGatewayPaymentPaid(gatewaySessionId, { gatewayPaymentId, receiptNumber }) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Paid',
          gateway_payment_id = $2,
          receipt_number = $3,
          paid_at = CURRENT_TIMESTAMP
      WHERE gateway_session_id = $1 AND payment_status = 'Pending'
      RETURNING *
    `;
    const result = await db.query(queryText, [gatewaySessionId, gatewayPaymentId, receiptNumber]);
    return result.rows[0];
  }

  /**
   * Settles a gateway payment whose row is NOT 'Pending' — the money moved anyway.
   *
   * The normal path is markGatewayPaymentPaid, whose `payment_status = 'Pending'` predicate makes
   * webhook redelivery idempotent. This is the recovery path for the case that predicate cannot
   * distinguish: a session we marked 'Cancelled' (because the patient opened a second checkout)
   * that the patient then went back and completed. PayMongo took the money; refusing to record it
   * does not give it back.
   *
   * Excludes 'Paid' so it can never overwrite a settled row, and the caller must handle a 23505
   * from uq_payments_one_paid_per_visit — that means the visit was *also* paid another way, which
   * is a genuine double charge needing a refund, not a row this method should quietly create.
   */
  async forceSettleGatewayPayment(gatewaySessionId, { gatewayPaymentId, receiptNumber }) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Paid',
          gateway_payment_id = $2,
          receipt_number = $3,
          paid_at = CURRENT_TIMESTAMP,
          -- The row being resurrected is 'Cancelled' and may carry a reversal date. It is money
          -- again, and the reversed figure keys on refunded_at IS NOT NULL WITHOUT testing
          -- payment_status [1.30.0] — so leaving it set reports this receipt as money handed
          -- back, on a day it was actually taken, for as long as the row exists.
          refunded_at = NULL
      WHERE gateway_session_id = $1 AND payment_status <> 'Paid'
      RETURNING *
    `;
    const result = await db.query(queryText, [gatewaySessionId, gatewayPaymentId, receiptNumber]);
    return result.rows[0];
  }

  async cancelPendingGatewayPayments(patientVisitId) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Cancelled'
      WHERE patient_visit_id = $1
        AND payment_status = 'Pending'
        AND gateway_session_id IS NOT NULL
      RETURNING *
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  async findPendingGatewayPaymentForVisit(patientVisitId) {
    const queryText = `
      SELECT * FROM payments
      WHERE patient_visit_id = $1
        AND payment_status = 'Pending'
        AND gateway_session_id IS NOT NULL
      ORDER BY paid_at DESC
      LIMIT 1
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows[0];
  }

  /**
   * Issues the next receipt number for today, atomically.
   *
   * This was `SELECT COUNT(*) … WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE`
   * followed by a separate INSERT of count+1, which produced duplicate official receipt numbers
   * two different ways:
   *
   *   - Concurrently: two cashiers settling in the same moment both read 5 and both mint
   *     RCT-YYYYMMDD-0006. Two patients leave holding the same receipt number, and the drawer can
   *     no longer be reconciled against the system.
   *   - With no concurrency at all: refunding a payment drops it out of the 'Paid' count, so the
   *     very next sale that day reuses a receipt number that has already been printed and handed
   *     to a patient.
   *
   * The counter fixes both. It counts issuances rather than surviving rows, so a refund cannot
   * rewind it, and ON CONFLICT DO UPDATE takes a row lock so concurrent callers serialise. A
   * unique index on receipt_number backs it at the schema level — see migrateDataIntegrity.js.
   */
  async getNextReceiptNumber() {
    // Both halves of the receipt number come from the same row, in one statement.
    //
    // The date used to be formatted in JavaScript as `new Date().toISOString()`, which is UTC,
    // while the counter came from Postgres CURRENT_DATE, which is the server's local date. In
    // Philippine time (UTC+8) those disagree for the first eight hours of every day: a payment
    // taken at 01:00 on the 15th was stamped RCT-20260814-…, dated to the previous day, while its
    // sequence number came from the 15th's counter. Receipts issued in that window sort and
    // reconcile against the wrong day, and the same stamp reappears the following morning —
    // exactly the collision the unique index now rejects, turning a silent mis-dating into a
    // failed payment.
    //
    // Deriving both from counter_date makes disagreement impossible by construction.
    const queryText = `
      INSERT INTO daily_counters (counter_date, counter_name, last_number)
      VALUES (CURRENT_DATE, 'receipt', 1)
      ON CONFLICT (counter_date, counter_name)
      DO UPDATE SET last_number = daily_counters.last_number + 1
      RETURNING last_number, to_char(counter_date, 'YYYYMMDD') AS date_key
    `;
    const result = await db.query(queryText);
    const { last_number, date_key } = result.rows[0];
    return `RCT-${date_key}-${String(last_number).padStart(4, '0')}`;
  }
}

module.exports = new PaymentRepository();
