const express = require('express');
const paymentController = require('../controllers/paymentController');
const paymentGatewayController = require('../controllers/paymentGatewayController');
const paymentSubmissionController = require('../controllers/paymentSubmissionController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');
const { uploadReceiptScanMiddleware } = require('../config/upload');

const router = express.Router();

// Get billing summary for a visit
router.get('/bill/:visitId', verifyToken, authorizeStaff, authorizePermissions('billing:read'), paymentController.getBill);

// Client-side payment visibility — self-scoped via req.user.userId, no role restriction beyond
// being logged in (matches /patients/my-profiles, /appointments/my-bookings).
router.get('/my-payments', verifyToken, paymentController.getMyPayments);

// Process a payment.
//
// Capture is Cashier work (SuperAdmin retains it as break-glass). The receipt names whoever took
// the money, so an Admin capturing payment misattributes the transaction — and Admin is the role
// that reviews cash-ups via Cashier Monitoring, which stops meaning anything if the reviewer can
// also be the one taking payments. Refund/cancel below deliberately KEEPS Admin: reversing a
// transaction is a manager decision, and auditService already records who authorised it.
router.post('/', verifyToken, authorizeStaff, authorizePermissions('billing:process'), paymentController.processPayment);

// View transactions (with optional date range filters)
router.get('/transactions', verifyToken, authorizeStaff, authorizePermissions('billing:read'), paymentController.getTransactions);

// Refund or void a paid payment (Feature Gap Plan Phase A) — Cashier scope matches processPayment
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('billing:refund'), paymentController.updateStatus);

// View payments for a specific visit
// One receipt by number, viewable and printable.
//
// Authorization is in paymentService.getReceipt, not here, because the two callers need DIFFERENT
// questions answered: staff are judged on `billing:read` (Cashier, Admin, SuperAdmin — looking up
// a receipt is not taking money, so deliberately not billing:process), and a Client is judged on
// whether the receipt is THEIRS. One middleware can only ask one of those. Same shape as the
// ownership scoping in resultService and hmoService.
//
// This is why the route carries no authorizePermissions call: verifyRbacWiring.js only checks
// routes that name one, and a permission here would be the wrong gate for half the callers.
router.get('/receipt/:receiptNumber', verifyToken, paymentController.getReceipt);

router.get('/visit/:visitId', verifyToken, authorizeStaff, authorizePermissions('billing:read'), paymentController.getVisitPayments);

// --- Receipt scanning (OCR assist for manual proof of payment) -----------------------------

// [1.62.0] Read a GCash/bank screenshot and suggest the reference number and amount, plus whether
// that reference has been submitted or settled before.
//
// Mounted here rather than under /payment-submissions because it belongs to no submission — it
// runs BEFORE one exists, on an image the caller is still deciding whether to send. The handler
// lives in paymentSubmissionController because that is the domain it serves; a route file's
// address and a controller's subject are allowed to differ, and forcing them to agree here would
// mean a scan endpoint sitting under a resource it does not touch.
//
// Gated on `billing:submit_proof` — the same permission as submitting the proof itself, and
// deliberately not a new one. Scanning is strictly weaker than submitting: it writes nothing and
// reveals nothing the caller does not already hold in their hand. A separate permission would
// have to be granted alongside the first every time, and the first omission produces a patient
// who may upload a receipt but not have it read.
//
// The role list matches POST /payment-submissions exactly, for the same reason it exists there:
// 'Client' is on it, so it must be stated rather than left to authorizeStaff.
router.post(
  '/scan-receipt',
  verifyToken,
  authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'),
  authorizePermissions('billing:submit_proof'),
  uploadReceiptScanMiddleware,
  paymentSubmissionController.scanReceipt
);

// --- Online payment gateway (GCash / Maya) ------------------------------------------------

// Is online payment configured on this deployment? Any logged-in user may ask; the client UI
// hides the online-payment option entirely when this reports unavailable.
router.get('/gateway/status', verifyToken, paymentGatewayController.getStatus);

// Start an online payment and get the provider's hosted checkout URL. Self-scoped: the service
// verifies the caller owns the visit's patient before creating anything — but that ownership
// check only applies to the 'Client' role, so the role restriction below is still required:
// without it, any other authenticated role (which the service does not ownership-check at all)
// could open a real PayMongo checkout session against an arbitrary visit.
router.post('/gateway/checkout', verifyToken, authorizeRoles('Client', 'SuperAdmin', 'Admin'), paymentGatewayController.createCheckout);

// Provider callback. NOT verifyToken-gated — the caller is PayMongo, not a user. The HMAC
// signature over the raw body is the authentication (see paymentGatewayService).
router.post('/gateway/webhook', paymentGatewayController.handleWebhook);

module.exports = router;
