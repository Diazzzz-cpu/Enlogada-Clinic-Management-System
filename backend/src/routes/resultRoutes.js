const express = require('express');
const resultController = require('../controllers/resultController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');
const { uploadResultFileMiddleware } = require('../config/upload');

const router = express.Router();

// Role split on this router is deliberate and asymmetric: Admin READS everything here, but does
// not WRITE. A test_result records the clinician who authored and released it, so an Admin
// entering findings or releasing a result puts the clinic manager's name on a clinical record
// they did not produce — and that same role administers staff accounts and the audit log.
// SuperAdmin keeps the write routes as break-glass for an unstaffed department.
// The sidebar reflects the same boundary; see frontend/src/config/navigation.js.

// Department staff views pending tests by category (Laboratory, Xray, Ultrasound)
router.get('/pending/:category', verifyToken, authorizeStaff, authorizePermissions('results:read'), resultController.getPending);

// UI/UX Phase 1: department staff review results they've already released, by category
router.get('/released/:category', verifyToken, authorizeStaff, authorizePermissions('results:read'), resultController.getReleased);

// Department staff updates a visit_test status (Processing, Completed, etc.)
router.put('/test-status/:visitTestId', verifyToken, authorizeStaff, authorizePermissions('results:write'), resultController.updateTestStatus);
router.patch('/test-status/:visitTestId', verifyToken, authorizeStaff, authorizePermissions('results:write'), resultController.updateTestStatus);

// Department staff uploads findings for a visit_test — multipart/form-data with an optional
// 'file' field (Feature Gap Plan Phase B); findings/remarks still arrive as regular text fields.
router.post('/:visitTestId', verifyToken, authorizeStaff, authorizePermissions('results:write'), uploadResultFileMiddleware, resultController.uploadResult);

// Download the uploaded result file — authenticated, ownership-checked inside the service (staff
// department match or Client-owns-this-patient), never a public static path (PHI).
router.get('/:visitTestId/file', verifyToken, resultController.downloadResultFile);

// Department staff releases result and triggers email notification
router.post('/:visitTestId/release', verifyToken, authorizeStaff, authorizePermissions('results:release'), resultController.releaseResult);

// Re-send a released report to the patient. Gated on `results:release` rather than a permission
// of its own: whoever may authorise a report reaching a patient may put it in front of them
// again, and a separate `results:email` would be held by nobody until somebody remembered to
// grant it — leaving the clinic with no way to answer "I never got it". The service refuses
// anything not already released, so this cannot become a side door around authorisation.
router.post('/:visitTestId/email', verifyToken, authorizeStaff, authorizePermissions('results:release'), resultController.emailResult);

// View patient result history (staff or client viewing own patient)
router.get('/history/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff', 'Client'), authorizePermissions('results:read'), resultController.getPatientHistory);

// The amendment history for a test — every version, newest first. Read-only, and gated like the
// other result reads: a superseded version is every bit as much PHI as the current one. Admin is
// included because reviewing what a report used to say is oversight, not clinical authorship.
router.get('/:visitTestId/versions', verifyToken, authorizeStaff, authorizePermissions('results:read'), resultController.getVersionHistory);

// Record that a critical result was actually communicated — the callback log.
//
// Deliberately wider than the other write routes here: Receptionist is included because the front
// desk is usually who makes the call, and a callback that cannot be recorded by the person who
// made it does not get recorded at all. Admin is included for the same reason — this records a
// communication, not a clinical finding, so it does not put a manager's name on a diagnosis.
router.post('/:visitTestId/acknowledge-critical', verifyToken, authorizeStaff, authorizePermissions('results:acknowledge_critical'), resultController.acknowledgeCritical);

// Every released critical result still awaiting that call. [1.26.0]
//
// Until now the only sign of a panic value was a badge on one department's worklist row, so
// nothing anywhere answered "is there a patient we still have to telephone?" — the escalation
// depended on the technician who flagged it staying at that screen, and one flagged near the end
// of a shift had nobody watching it. Same permission as recording the callback, and deliberately
// NOT department-scoped: a potassium of 7.4 belongs to whoever can act on it, not to the room
// that produced it. Declared above the '/:visitTestId' routes so 'critical' is not swallowed as
// an id.
router.get('/critical/outstanding', verifyToken, authorizeStaff, authorizePermissions('results:acknowledge_critical'), resultController.getOutstandingCriticals);

// Fetch the recorded result for one visit_test, so staff can edit findings already saved
// against a 'Waiting for Release' ticket. Registered last: a bare '/:visitTestId' would
// otherwise shadow nothing here (every route above has two segments), but keeping catch-all
// shapes at the bottom is the convention this codebase already follows in visitRoutes.
// The shape a result should be recorded in. Two path segments, so it cannot be swallowed by
// the single-segment '/:visitTestId' below whatever order they are declared in.
router.get('/field-set/:visitTestId', verifyToken, authorizeStaff, authorizePermissions('results:read'), resultController.getFieldSet);

router.get('/:visitTestId', verifyToken, authorizeStaff, authorizePermissions('results:read'), resultController.getResult);

module.exports = router;
