const express = require('express');
const patientController = require('../controllers/patientController');
const { verifyToken, authorizeStaff, authorizePermissions, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Who may touch a patient record directly.
//
// ── History, because it explains the shape ────────────────────────────────────────────────────
// These routes once carried verifyToken alone. The ownership check lives in the controller and
// reads `if (req.user.roles.includes('Client') && ...)`, so it was a no-op for every non-Client
// role — meaning any staff token, including the lowest-privilege diagnostic ones, could walk the
// integer id space with GET /api/patients/1,2,3… to dump the entire patient roster, and could PUT
// to rewrite another patient's name, birthdate and sex. Birthdate and sex are the fields
// diagnostic reference ranges key off, so that write was a clinical-safety issue, not merely a
// privacy one.
//
// The fix at the time was a role allow-list that excluded diagnostic staff outright. That was the
// right call *then*, because nothing confined what a diagnostic account could see once it was
// through the door — so the only safe answer was to keep it out. The cost was that a lab tech
// could read a result and had no way to look up the patient it belonged to.
//
// ── Why the allow-list is gone [1.21.0] ───────────────────────────────────────────────────────
// Containment now exists, and it is finer than a role list could ever be. Two independent guards,
// both in the service layer where they cannot be bypassed by reaching the same data another way:
//
//   Client  — patientController re-checks `patient.user_id === req.user.userId`.
//   Staff   — patientService confines to the caller's own departments unless they hold
//             `patients:read_all_departments`. A record outside them 404s: a 403 would confirm
//             the record exists, and "does this clinic have a patient called X" is precisely the
//             question the scoping refuses.
//
// So the permission decides *whether*, and those two guards decide *whose* — which is what lets
// the allow-list go without widening anything. Keeping it would have meant a SuperAdmin granting
// `patients:read` to a diagnostic account, watching it save, and finding the route still refuses:
// the exact failure the [1.20.0] work existed to remove.
//
// Note `patients:update` is still not in the MODALITY grant, so diagnostic staff cannot rewrite
// demographics today. That is now a matrix decision rather than a hardcoded one, and it is
// enforced by the same department scope if it is ever granted.

router.post('/', verifyToken, authorizePermissions('patients:create'), patientController.addProfile);
router.get('/my-profiles', verifyToken, patientController.getMyProfiles);
router.get('/types', verifyToken, patientController.getTypes);
// Staff lookup of existing patient records by name — must be registered before /:id so
// Express doesn't match "search" itself as an :id param.
router.get('/search', verifyToken, authorizeStaff, authorizePermissions('patients:read'), patientController.search);
router.get('/:id', verifyToken, authorizePermissions('patients:read'), patientController.getProfileById);
router.put('/:id', verifyToken, authorizePermissions('patients:update'), patientController.updateProfile);

// Archiving a record. [1.56.0] Admin and SuperAdmin only, by ROLE rather than by permission, and
// deliberately so: `patients:update` is held by Reception too, and correcting a misspelled surname
// is a different act from taking a record out of the roster the whole front desk searches.
//
// Nothing is deleted. The visits, bills and results stay exactly as they were — this only decides
// whether the record appears in the roster by default. Audited in patientService.setArchived.
// rbac-narrowing: reception holds `patients:update` to CORRECT a record and must not be able to
// archive one — retiring a patient's clinical history is an oversight decision. The role list
// is deliberately narrower than the permission's holders.
router.patch('/:id/archive', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), authorizePermissions('patients:update'), patientController.setArchived);

module.exports = router;
