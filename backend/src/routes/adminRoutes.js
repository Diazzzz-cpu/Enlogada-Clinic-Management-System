const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Module 12 (Admin Dashboard): staff account management, scoped to the 5 operational roles
// only. Admin/SuperAdmin account management is Module 13's responsibility.
router.get('/staff', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.getStaff);
router.post('/staff', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.createStaff);
router.patch('/staff/:id/status', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.updateStaffStatus);
// [1.129.0] One or more of the five front-line roles. Audited.
router.put('/staff/:id/roles', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.updateStaffRoles);

// UI/UX Modernization Phase 11: edits an existing staff member's own name/email/contact number
// (never role — that stays a separate, more sensitive surface). Previously the only recourse
// for a typo'd account was deactivating and recreating it from scratch.
router.patch('/staff/:id', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.updateStaffDetails);

// Feature Gap Plan Phase A: Admin sets a temporary password for a locked-out staff member —
// previously the only recourse was deactivating and recreating the account.
router.patch('/staff/:id/password', verifyToken, authorizeStaff, authorizePermissions('staff:manage'), adminController.resetStaffPassword);

// Feature Gap Plan Phase D: recent activity across the sensitive actions this session's phases
// added logging for (payments, staff accounts, HMO providers, result corrections).
router.get('/activity', verifyToken, authorizeStaff, authorizePermissions('audit:view'), adminController.getActivity);

module.exports = router;
