const path = require('path');
const fs = require('fs');
const paymentSubmissionRepository = require('../repositories/paymentSubmissionRepository');
const paymentMethodRepository = require('../repositories/paymentMethodRepository');
const paymentRepository = require('../repositories/paymentRepository');
const paymentService = require('./paymentService');
const visitRepository = require('../repositories/visitRepository');
const patientRepository = require('../repositories/patientRepository');
const auditService = require('./auditService');
const logger = require('../config/logger');
const notificationService = require('./notificationService');
const { PAYMENT_UPLOAD_ROOT, discardPaymentFile } = require('../config/upload');
const { formatCurrency } = require('../utils/money');
const appointmentEmailService = require('./appointmentEmailService');

/**
 * Manual proof of payment: the patient pays into the clinic's own account and a cashier checks it.
 * See migrations.md [1.48.0].
 *
 * ── What this service is careful about ──────────────────────────────────────────────────────
 *
 * The claimed amount is never trusted. On approval the cashier's existing `processPayment` runs,
 * which recomputes the bill server-side and refuses anything that does not match it — so a patient
 * typing ₱50 for a ₱1,450 visit cannot produce a ₱50 payment even if a cashier clicks approve.
 * The claim is a prompt for a human to look at a screenshot, not an instruction to the ledger.
 *
 * Approval also goes through the SAME path a counter payment takes, which is what earns it a real
 * receipt number from `daily_counters`, the visit release, and the cash-up entry. A parallel
 * "verified payment" writer would have been a second way to take money, and the two would have
 * drifted the first time either changed.
 */
class PaymentSubmissionService {
  /** Ownership: a client may only act on a visit belonging to one of their own patient profiles. */
  async assertClientOwnsVisit(user, patientVisitId) {
    if (!user || !user.roles?.includes('Client')) return;
    const visit = await visitRepository.findVisitById(patientVisitId);
    if (!visit) {
      const error = new Error('Visit not found.');
      error.statusCode = 404;
      throw error;
    }
    const profiles = await patientRepository.findPatientsByUserId(user.userId);
    // Compared per patient, never by resolving a user to a single patient: one account owns
    // several profiles (a parent booking for dependents).
    const owns = profiles.some((p) => p.id === visit.patient_id);
    if (!owns) {
      // 404 rather than 403 — the same reason department scoping does it: a 403 confirms the
      // visit exists.
      const error = new Error('Visit not found.');
      error.statusCode = 404;
      throw error;
    }
  }

  /**
   * Records a patient's claim that they have paid, with their screenshot as evidence.
   *
   * @param {object} params
   * @param {number} params.patientVisitId
   * @param {number} [params.paymentMethodId]
   * @param {string} params.referenceNumber  The clinic's only handle on a transfer that happened
   *   inside GCash or a bank.
   * @param {number} params.amountClaimed    EVIDENCE, never the amount charged — approval bills
   *   the recomputed total.
   * @param {object} file  The uploaded proof.
   * @param {object} user  A Client may submit only against their own visit.
   * @returns {Promise<object>} The 'Pending' submission. No money moves here.
   *
   * `uq_paysub_one_live_per_visit` allows one Pending claim per visit, so two cashiers cannot be
   * handed the same money twice. It is partial, so a rejected claim never blocks a second attempt.
   */
  async submit({ patientVisitId, paymentMethodId, referenceNumber, amountClaimed }, file, user) {
    if (!referenceNumber?.trim()) {
      discardPaymentFile(file);
      const error = new Error('The transaction reference number is required — it is what the cashier checks against.');
      error.statusCode = 400;
      throw error;
    }
    if (!file) {
      discardPaymentFile(file);
      const error = new Error('A screenshot or photo of the transaction is required.');
      error.statusCode = 400;
      throw error;
    }

    try {
      await this.assertClientOwnsVisit(user, patientVisitId);

      // Already settled? Nothing to claim against. Checked before the unique index so the patient
      // gets a sentence rather than a constraint violation.
      if (await paymentRepository.hasPaidPayment(patientVisitId)) {
        const error = new Error('This visit is already paid.');
        error.statusCode = 409;
        throw error;
      }
      const live = await paymentSubmissionRepository.findPendingForVisit(patientVisitId);
      if (live) {
        const error = new Error('A payment for this booking is already awaiting review.');
        error.statusCode = 409;
        throw error;
      }

      const submission = await paymentSubmissionRepository.create({
        patientVisitId,
        paymentMethodId,
        referenceNumber: referenceNumber.trim(),
        amountClaimed: Number(amountClaimed) || 0,
        submittedBy: user?.userId,
        proof: {
          filePath: path.basename(file.path),
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
      });

      // The cashier is told, because nothing else would tell them: a patient paying from home
      // produces no queue ticket and no one at the counter. Without this the claim sits unseen
      // until somebody happens to open the review screen.
      await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
        title: 'Proof of payment to review',
        message: `Ref ${submission.reference_number} — ${formatCurrency(submission.amount_claimed)} awaiting verification`,
        type: 'info',
      }).catch(() => { /* a notification failure must never lose the claim */ });

      return submission;
    } catch (err) {
      // The row did not land, so the file it pointed at must not survive either.
      discardPaymentFile(file);
      throw err;
    }
  }

  async listPending() {
    return await paymentSubmissionRepository.findPending();
  }

  async listRecentlyReviewed() {
    return await paymentSubmissionRepository.findRecentlyReviewed();
  }

  async listForVisit(patientVisitId, user) {
    await this.assertClientOwnsVisit(user, patientVisitId);
    return await paymentSubmissionRepository.findAllForVisit(patientVisitId);
  }

  /**
   * Approve a claim: take the payment for real.
   *
   * The amount comes from the BILL, not from the claim. `processPayment` recomputes it and refuses
   * a mismatch, so this cannot be used to settle a visit for whatever the patient typed.
   */
  /**
   * Turns a patient's claim into money, through the SAME writer the counter uses.
   *
   * @param {number} id
   * @param {object} actor  The cashier. Needs `billing:process`.
   * @returns {Promise<object>} The settled payment, with its receipt number.
   *
   * Calls `paymentService.processPayment`, deliberately — it earns a real receipt number, the
   * visit release and the cash-up entry, and there is never a parallel money writer. The amount is
   * the recomputed bill, NOT `amount_claimed`.
   */
  async verify(id, actor) {
    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission) {
      const error = new Error('Payment submission not found.');
      error.statusCode = 404;
      throw error;
    }
    if (submission.status !== 'Pending') {
      const error = new Error(`This submission was already ${submission.status.toLowerCase()}.`);
      error.statusCode = 409;
      throw error;
    }

    const method = submission.payment_method_id
      ? await paymentMethodRepository.findById(submission.payment_method_id)
      : null;

    // ── A submission left Pending on a visit that IS paid ──────────────────────────────────────
    //
    // Taking the money and marking the submission are two writes and cannot be one: processPayment
    // owns its own transaction, commits, and issues a receipt number from daily_counters. If the
    // settle below fails after that commit — a dropped connection, a restart — the money is banked
    // and the submission is still Pending.
    //
    // Nothing was lost when that happened, but nothing could fix it either. The row stayed in the
    // cashier's queue forever, and every retry called processPayment, which correctly refused with
    // "This visit has already been paid" — an error about the VISIT, on a screen about a
    // SUBMISSION, with no action that would clear it.
    //
    // So reconcile instead of re-charging: adopt the payment that already exists and close the
    // submission against it. This is the only branch that may settle without taking money, and it
    // is safe precisely because it takes none — hasPaidPayment is the same guard processPayment
    // would have used to refuse.
    const existing = (await paymentRepository.findPaymentsByVisitId(submission.patient_visit_id))
      .find((p) => p.payment_status === 'Paid');
    if (existing) {
      const reconciled = await paymentSubmissionRepository.settle(id, {
        status: 'Verified',
        reviewedBy: actor.userId,
        reviewNote: null,
        paymentId: existing.id,
      });
      if (reconciled) {
        await auditService.log({
          actorId: actor.userId,
          action: 'payment_submission.reconciled',
          entityType: 'payment_submission',
          entityId: reconciled.id,
          // Named distinctly from a normal verification: no money moved here, and a cash-up that
          // cannot tell the two apart is a cash-up that cannot be checked.
          description: `Ref ${reconciled.reference_number} matched to existing receipt ${existing.receipt_number} — no new payment taken`,
        });
        this.notifyPatient(reconciled.id, { verified: true, payment: existing }).catch(() => {});
        return { submission: reconciled, payment: existing, reconciled: true };
      }
    }

    // The authoritative figure, recomputed from the visit.
    const bill = await paymentService.getBillingSummary(submission.patient_visit_id);

    const payment = await paymentService.processPayment({
      patientVisitId: submission.patient_visit_id,
      processedBy: actor.userId,
      // The cash-up bucket, which is exactly why payment_methods.kind is constrained to the three
      // values `payments` accepts. A method that was since retired still settles correctly.
      paymentMethod: method?.kind || 'GCash',
      referenceNumber: submission.reference_number,
      amount: bill.totalAmount,
    });

    const settled = await paymentSubmissionRepository.settle(id, {
      status: 'Verified',
      reviewedBy: actor.userId,
      reviewNote: null,
      paymentId: payment.id,
    });
    if (!settled) {
      // Another cashier settled it between the read and the write. The payment above already
      // happened, so this is reported rather than silently swallowed.
      const error = new Error('Another cashier reviewed this submission first. Check the visit before retrying.');
      error.statusCode = 409;
      throw error;
    }

    await auditService.log({
      actorId: actor.userId,
      action: 'payment_submission.verified',
      entityType: 'payment_submission',
      entityId: settled.id,
      description: `Ref ${settled.reference_number} verified — receipt ${payment.receipt_number}`,
    });

    // Told, rather than left to notice. The patient portal has no notification bell, so email is
    // the only channel that reaches them — and they are waiting on something only the clinic can
    // do, which is exactly the situation where silence gets read as "it did not work".
    //
    // After the settle, never inside it, and never awaited in a way that can fail the approval:
    // the money is taken and the receipt exists by this point, so an SMTP problem must not turn a
    // completed payment into an error the cashier has to interpret.
    await this.notifyPatient(settled.id, { verified: true, payment }).catch(() => {});

    return { submission: settled, payment };
  }

  /** Turn a claim down. A reason is required — the patient will ask. */
  async reject(id, reviewNote, actor) {
    if (!reviewNote?.trim()) {
      const error = new Error('Say why it was rejected — the patient is told this, and will ask.');
      error.statusCode = 400;
      throw error;
    }

    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission) {
      const error = new Error('Payment submission not found.');
      error.statusCode = 404;
      throw error;
    }
    if (submission.status !== 'Pending') {
      const error = new Error(`This submission was already ${submission.status.toLowerCase()}.`);
      error.statusCode = 409;
      throw error;
    }

    const settled = await paymentSubmissionRepository.settle(id, {
      status: 'Rejected',
      reviewedBy: actor.userId,
      reviewNote: reviewNote.trim(),
      paymentId: null,
    });
    if (!settled) {
      const error = new Error('Another cashier reviewed this submission first.');
      error.statusCode = 409;
      throw error;
    }

    await auditService.log({
      actorId: actor.userId,
      action: 'payment_submission.rejected',
      entityType: 'payment_submission',
      entityId: settled.id,
      description: `Ref ${settled.reference_number} rejected — ${settled.review_note}`,
    });

    // The reason is the whole point of requiring one. Sending it is what stops the patient
    // refreshing the portal, guessing, and eventually ringing the clinic.
    await this.notifyPatient(settled.id, { verified: false }).catch(() => {});

    return settled;
  }

  /**
   * Write to the patient about a decision on their payment.
   *
   * Never throws. Every caller invokes it after the decision has committed, so a missing SMTP
   * config or a bounced address must not surface as a failure on a payment that already happened
   * — `sendEmail` already swallows transport errors, and this adds the same guarantee around the
   * lookup.
   */
  async notifyPatient(submissionId, { verified, payment }) {
    try {
      const s = await paymentSubmissionRepository.findByIdWithContact(submissionId);
      if (!s || !s.patient_email) return { skipped: true };

      const patientName = `${s.first_name} ${s.last_name}`;
      if (verified) {
        return await appointmentEmailService.sendPaymentVerified({
          to: s.patient_email,
          patientName,
          reference: s.appointment_reference,
          receiptNumber: payment?.receipt_number,
          amount: formatCurrency(payment?.amount),
        });
      }
      return await appointmentEmailService.sendPaymentRejected({
        to: s.patient_email,
        patientName,
        reference: s.appointment_reference,
        reason: s.review_note,
      });
    } catch (err) {
      // Logged rather than raised: the decision stands either way, and losing the email must not
      // make a settled payment look broken.
      logger.error('Failed to email the patient about their payment decision:', err);
      return { error: err.message };
    }
  }

  /**
   * The uploaded screenshot, for the authorised read-back route.
   *
   * This is a patient's bank or e-wallet screen: it carries their name, their balance in some
   * apps, and their transaction history. Streamed through an authenticated, ownership-checked
   * route for the same reason HMO cards are, and never served statically.
   */
  async getProofFile(id, user) {
    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission || !submission.proof_file_path) {
      const error = new Error('No proof of payment on this submission.');
      error.statusCode = 404;
      throw error;
    }
    // Staff who may read billing see any; a client sees only their own.
    await this.assertClientOwnsVisit(user, submission.patient_visit_id);

    const absolute = path.join(PAYMENT_UPLOAD_ROOT, path.basename(submission.proof_file_path));
    if (!fs.existsSync(absolute)) {
      const error = new Error('The proof file is missing from storage.');
      error.statusCode = 404;
      throw error;
    }
    return { absolute, mimeType: submission.proof_mime_type };
  }
}

module.exports = new PaymentSubmissionService();
