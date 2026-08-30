const paymentSubmissionService = require('../services/paymentSubmissionService');
const receiptOcrService = require('../services/receiptOcrService');

class PaymentSubmissionController {
  /** A patient claiming they have paid: reference number, amount and a screenshot. */
  async submit(req, res, next) {
    try {
      const { patientVisitId, paymentMethodId, referenceNumber, amountClaimed } = req.body;

      if (!patientVisitId) {
        return res.status(400).json({ status: 'error', message: 'A booking is required.' });
      }

      const submission = await paymentSubmissionService.submit(
        {
          patientVisitId: parseInt(patientVisitId, 10),
          paymentMethodId: paymentMethodId ? parseInt(paymentMethodId, 10) : null,
          referenceNumber,
          amountClaimed,
        },
        req.file,
        req.user
      );

      return res.status(201).json({
        status: 'success',
        message: 'Payment sent for verification. Your booking pass appears once the cashier confirms it.',
        data: { submission }
      });
    } catch (err) {
      next(err);
    }
  }

  /** The cashier's review queue. */
  async getPending(req, res, next) {
    try {
      const submissions = await paymentSubmissionService.listPending();
      return res.status(200).json({ status: 'success', data: { submissions } });
    } catch (err) {
      next(err);
    }
  }

  /** Decisions already made, so a cashier can look back at one — including its screenshot. */
  async getReviewed(req, res, next) {
    try {
      const submissions = await paymentSubmissionService.listRecentlyReviewed();
      return res.status(200).json({ status: 'success', data: { submissions } });
    } catch (err) {
      next(err);
    }
  }

  /** What a patient has claimed for one booking, so they can see a rejection and its reason. */
  async getForVisit(req, res, next) {
    try {
      const submissions = await paymentSubmissionService.listForVisit(
        parseInt(req.params.visitId, 10), req.user
      );
      return res.status(200).json({ status: 'success', data: { submissions } });
    } catch (err) {
      next(err);
    }
  }

  async verify(req, res, next) {
    try {
      const { submission, payment } = await paymentSubmissionService.verify(req.params.id, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Payment verified — receipt ${payment.receipt_number} issued.`,
        data: { submission, payment }
      });
    } catch (err) {
      next(err);
    }
  }

  async reject(req, res, next) {
    try {
      const submission = await paymentSubmissionService.reject(
        req.params.id, req.body.reviewNote, req.user
      );
      return res.status(200).json({
        status: 'success',
        message: 'Payment rejected, with your reason recorded.',
        data: { submission }
      });
    } catch (err) {
      next(err);
    }
  }

  /** The screenshot. A patient's bank screen — authorised, ownership-checked, never static. */
  async getProof(req, res, next) {
    try {
      const { absolute, mimeType } = await paymentSubmissionService.getProofFile(req.params.id, req.user);
      res.type(mimeType || 'application/octet-stream');
      return res.sendFile(absolute);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /payments/scan-receipt — read a screenshot and SUGGEST what it says. [1.62.0]
   *
   * Creates nothing. It is a read against an image the caller is holding, plus one lookup for a
   * duplicate reference, and its entire output is a suggestion the person then edits or ignores.
   * The submit endpoint above is unchanged and remains the only way a claim is ever recorded.
   *
   * 200 even when nothing was recognised, and that is deliberate rather than sloppy: "I could not
   * read this image" is a successful answer to "what can you read here". A 4xx or 5xx would make
   * the frontend's error branch fire and would read to the patient as their upload having failed,
   * when in fact they simply have to type the reference in as they always did.
   */
  async scanReceipt(req, res, next) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ status: 'error', message: 'An image of the receipt is required.' });
      }

      const scan = await receiptOcrService.scan(req.file.buffer, req.file.originalname);

      return res.status(200).json({
        status: 'success',
        data: { scan },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PaymentSubmissionController();
