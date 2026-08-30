const db = require('../config/database');

/**
 * All SQL for manual proof-of-payment claims. See migrations.md [1.48.0].
 *
 * A submission is EVIDENCE, not money. `payments` remains the only table any peso figure is
 * aggregated from — see the migration's header for why this is deliberately not a payment row
 * with an 'Unverified' status.
 */
class PaymentSubmissionRepository {
  async create({ patientVisitId, paymentMethodId, referenceNumber, amountClaimed, submittedBy, proof }) {
    const result = await db.query(
      `INSERT INTO payment_submissions
         (patient_visit_id, payment_method_id, reference_number, amount_claimed, submitted_by,
          proof_file_path, proof_original_name, proof_mime_type, proof_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
       RETURNING *`,
      [patientVisitId, paymentMethodId || null, referenceNumber, amountClaimed, submittedBy || null,
        proof?.filePath || null, proof?.originalName || null, proof?.mimeType || null,
        proof?.sizeBytes || null]
    );
    return result.rows[0];
  }

  async findById(id) {
    const result = await db.query('SELECT * FROM payment_submissions WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * A submission with everything needed to write to the patient about it.
   *
   * The address comes from the account that OWNS the patient profile, not from `submitted_by` —
   * reception can file a claim on a patient's behalf, and mailing the receptionist that their
   * payment was rejected helps nobody.
   */
  async findByIdWithContact(id) {
    const result = await db.query(
      `SELECT ps.*, pm.label AS method_label, pm.kind AS method_kind,
              p.first_name, p.last_name,
              u.email AS patient_email,
              a.appointment_reference
         FROM payment_submissions ps
         JOIN patient_visits pv ON pv.id = ps.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
         LEFT JOIN users u      ON u.id = p.user_id
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
         LEFT JOIN appointments a     ON a.patient_visit_id = pv.id
        WHERE ps.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  /** The live claim on a visit, if there is one. At most one by uq_paysub_one_live_per_visit. */
  async findPendingForVisit(patientVisitId) {
    const result = await db.query(
      `SELECT * FROM payment_submissions WHERE patient_visit_id = $1 AND status = 'Pending'`,
      [patientVisitId]
    );
    return result.rows[0];
  }

  /** Everything a patient has claimed for one visit, newest first, so they can see a rejection. */
  async findAllForVisit(patientVisitId) {
    const result = await db.query(
      `SELECT ps.*, pm.label AS method_label, pm.kind AS method_kind
         FROM payment_submissions ps
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
        WHERE ps.patient_visit_id = $1
        ORDER BY ps.submitted_at DESC`,
      [patientVisitId]
    );
    return result.rows;
  }

  /**
   * The cashier's review queue — everything awaiting a decision, oldest first.
   *
   * Oldest first because it is a queue: the patient who has been waiting longest for their booking
   * pass is the one to deal with next. Carries enough patient and visit context that the cashier
   * does not have to open another screen to decide.
   */
  async findPending() {
    const result = await db.query(
      `SELECT ps.id, ps.patient_visit_id, ps.reference_number, ps.amount_claimed,
              ps.submitted_at, ps.status,
              (ps.proof_file_path IS NOT NULL) AS has_proof,
              -- What the visit actually owes, so the cashier can compare it with what the patient
              -- says they sent WITHOUT opening another screen.
              --
              -- This matters more than it looks. Approval bills the visit's real total, not the
              -- claimed figure — so approving a screenshot that says 50 on a 1450 visit records
              -- 1450 as received and the clinic is short 1400 with nothing on screen to say so.
              -- The cashier is the control, and a control needs both numbers side by side.
              (SELECT COALESCE(SUM(vt.price_at_time), 0)
                 FROM visit_tests vt
                WHERE vt.patient_visit_id = pv.id) AS amount_due,
              -- Has this reference been seen before? [1.63.0]
              --
              -- A reference number is the clinic's only handle on a transfer that happened inside
              -- GCash or a bank — money it can see the evidence of but not the ledger for. The
              -- same screenshot arriving twice, on two visits, is indistinguishable from two
              -- genuine payments unless somebody checks, and checking meant reading a number off
              -- an image and searching for it.
              --
              -- Counted here rather than fetched per row: the cashier's queue is the ONE screen
              -- where this matters, and a second request per submission to answer it would be an
              -- N+1 on a screen that polls.
              --
              -- Both tables, and the union is the point: a duplicate may be another pending claim
              -- OR a receipt already settled at the counter. Checking only submissions would miss
              -- the case that actually costs money.
              (
                SELECT COUNT(*)
                  FROM payment_submissions other
                 WHERE other.id <> ps.id
                   AND UPPER(TRIM(other.reference_number)) = UPPER(TRIM(ps.reference_number))
              ) + (
                SELECT COUNT(*)
                  FROM payments pay
                 WHERE pay.reference_number IS NOT NULL
                   AND UPPER(TRIM(pay.reference_number)) = UPPER(TRIM(ps.reference_number))
              ) AS duplicate_count,
              pm.label AS method_label, pm.kind AS method_kind,
              p.first_name, p.last_name,
              pv.queue_number, pv.visit_type,
              a.appointment_reference, a.scheduled_date, a.scheduled_time
         FROM payment_submissions ps
         JOIN patient_visits pv ON pv.id = ps.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
         LEFT JOIN appointments a     ON a.patient_visit_id = pv.id
        WHERE ps.status = 'Pending'
        ORDER BY ps.submitted_at ASC`
    );
    return result.rows;
  }

  /**
   * Decisions already made, newest first.
   *
   * A settled submission left the system entirely — verified or rejected, it dropped out of the
   * only screen that showed it. So a cashier asked "did we take that GCash payment yesterday?"
   * had nowhere to look, and could not re-open the screenshot behind a decision somebody else
   * made. The receipt exists in Transaction History, but the EVIDENCE for it did not.
   *
   * Bounded rather than paged: this answers "what happened recently", and anything older is a
   * question for the transaction history, which is built for it.
   */
  async findRecentlyReviewed(limit = 20) {
    const result = await db.query(
      `SELECT ps.id, ps.patient_visit_id, ps.reference_number, ps.amount_claimed,
              ps.status, ps.reviewed_at, ps.review_note,
              (ps.proof_file_path IS NOT NULL) AS has_proof,
              pm.label AS method_label, pm.kind AS method_kind,
              p.first_name, p.last_name,
              pay.receipt_number,
              reviewer.first_name AS reviewed_by_first_name,
              reviewer.last_name  AS reviewed_by_last_name
         FROM payment_submissions ps
         JOIN patient_visits pv ON pv.id = ps.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
         LEFT JOIN payments pay       ON pay.id = ps.payment_id
         LEFT JOIN users reviewer     ON reviewer.id = ps.reviewed_by
        WHERE ps.status <> 'Pending'
        ORDER BY ps.reviewed_at DESC NULLS LAST
        LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * Settle a claim.
   *
   * `WHERE status = 'Pending'` is the concurrency guard, not decoration: two cashiers opening the
   * queue together would otherwise both approve the same claim, and the second approval would try
   * to take the money twice. The second UPDATE matches nothing and the caller sees no row back.
   */
  async settle(id, { status, reviewedBy, reviewNote, paymentId }) {
    const result = await db.query(
      `UPDATE payment_submissions
          SET status = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
              review_note = $4, payment_id = $5
        WHERE id = $1 AND status = 'Pending'
      RETURNING *`,
      [id, status, reviewedBy, reviewNote || null, paymentId || null]
    );
    return result.rows[0];
  }

  /**
   * Has this reference number been seen before, in either table? [1.62.0]
   *
   * A reference number is the clinic's only handle on a transfer that happened inside GCash or a
   * bank — money it can see the evidence of but not the ledger for. The same screenshot arriving
   * twice, on two visits, is indistinguishable from two genuine payments unless somebody checks.
   *
   * BOTH tables, and the union is the point:
   *
   *   payment_submissions   a claim already queued, already verified, or already rejected
   *   payments              a receipt a cashier settled at the counter, reference typed in by hand
   *
   * Searching only submissions would miss the case that actually costs money — a patient whose
   * transfer was already accepted at the desk submitting it again online.
   *
   * A REJECTED submission still counts as a match and is reported as such. The caller decides what
   * to do about it: re-submitting a reference the clinic previously turned down is a legitimate
   * thing to do after a correction, and silently hiding it would leave the cashier deciding the
   * same evidence twice with no idea they had seen it before. What the answer must not do is
   * DECIDE — it is shown to a person.
   *
   * Trimmed and upper-cased on both sides: a reference read off a screenshot arrives with the
   * casing and spacing OCR happened to produce, and 'GC1234' typed by a cashier must match
   * 'gc1234 ' read from an image.
   */
  async findByReferenceNumber(referenceNumber) {
    const result = await db.query(
      `SELECT source, id, status, amount, reference_number, occurred_at, patient_visit_id
         FROM (
           SELECT 'submission'      AS source,
                  ps.id,
                  ps.status,
                  ps.amount_claimed AS amount,
                  ps.reference_number,
                  ps.submitted_at   AS occurred_at,
                  ps.patient_visit_id
             FROM payment_submissions ps
            WHERE UPPER(TRIM(ps.reference_number)) = UPPER(TRIM($1))
           UNION ALL
           SELECT 'payment'         AS source,
                  pay.id,
                  pay.payment_status AS status,
                  pay.amount,
                  pay.reference_number,
                  pay.paid_at        AS occurred_at,
                  pay.patient_visit_id
             FROM payments pay
            WHERE pay.reference_number IS NOT NULL
              AND UPPER(TRIM(pay.reference_number)) = UPPER(TRIM($1))
         ) matches
        -- The most recent match is the one a person needs to see first; an older duplicate of the
        -- same reference adds nothing to the decision.
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [referenceNumber]
    );
    return result.rows[0] || null;
  }
}

module.exports = new PaymentSubmissionRepository();
