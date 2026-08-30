const express = require('express');
const reportController = require('../controllers/reportController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Module 17 (Reporting): clinic-wide metrics for a given date range. Admin/SuperAdmin only,
// matching the convention already established for /rbac/matrix and /admin/*.
router.get('/summary', verifyToken, authorizeStaff, authorizePermissions('reports:view'), reportController.getSummary);

// Feature Gap Plan Phase D: per-staff workload for Reception (check-ins) and Diagnostic
// (results released) — previously only Cashier had this kind of throughput visibility.
router.get('/staff-workload', verifyToken, authorizeStaff, authorizePermissions('reports:view'), reportController.getStaffWorkload);

// HMO claim value per provider. `reports:view`, the same permission every other report answers
// to — a claim total is a report, not a claim decision, so it is deliberately NOT gated on
// hmo:approve: an Admin who may read the clinic's figures should not need approval rights to see
// what the HMO work is worth.
router.get('/hmo-claims', verifyToken, authorizeStaff, authorizePermissions('reports:view'), reportController.getHmoClaims);

// [1.22.0] Per-department operating metrics — sales by service, front-desk wait, per-modality
// turnaround. Every role had a KPI strip counting what was in front of it right now, and none of
// them measured how the department was actually performing.
//
// Deliberately NOT gated on `reports:view`, which is the only route here that is not. That
// permission means "see the clinic-wide roll-up" and only Admin/SuperAdmin hold it — requiring it
// would make this Admin-only and defeat the entire point, which is that a cashier can see their
// own sales and a modality its own turnaround.
//
// The route is not therefore ungated: each SLICE of the response is gated individually inside
// reportService (billing:read / visits:read / results:read), and a caller holding none of the
// three is refused outright rather than handed an empty object. So the response is the union of
// what you are already allowed to see, assembled in one request instead of three.
router.get('/operations', verifyToken, authorizeStaff, reportController.getOperations);

// [1.62.0] Turnaround against target, arrivals by hour, and the revenue trend's comparative
// overlay — the aggregations behind the analytics charts.
//
// Ungated at the route for the same reason /operations is, and NOT by oversight: each slice is
// gated individually inside reportService (results:read / visits:read / billing:read), and a
// caller holding none of them is refused outright. Requiring `reports:view` here would make the
// screen Admin-only and defeat the point — a modality is meant to be able to see its own
// turnaround against the clinic's target without being able to see the takings.
router.get('/analytics', verifyToken, authorizeStaff, reportController.getAnalytics);

module.exports = router;
