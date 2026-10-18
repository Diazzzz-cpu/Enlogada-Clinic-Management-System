const express = require('express');
const visitController = require('../controllers/visitController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Receptionist/Admin registers walk-in or appointment-based visits
// PUBLIC — how busy the clinic is right now, for the home page's live-queue dock. [1.63.0]
//
// Deliberately before the authenticated routes and deliberately ungated. It returns two counts and
// a wait estimate: no name, no queue number, no id, nothing joinable to a person. A waiting-room
// display carries the same information, and it is what a patient needs to decide whether to set
// off now.
//
// The privacy control is the SQL, not this line — visitRepository.countActiveForPublicStatus
// selects two integers and cannot be widened without someone deciding, at that SELECT, that the
// open internet may see more. Do not add a route here that returns rows.
router.get('/queue-status', visitController.getPublicQueueStatus);

// [1.129.0] A visit is opened WITH its tests, so starting one is also assigning them. A new patient
// registered in the same request needs patients:create as well, checked in visitService.
router.post('/', verifyToken, authorizeStaff, authorizePermissions('visits:create', 'tests:assign'), visitController.registerVisit);

// Active visits for front desk / cashier dashboard
router.get('/active', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getActiveVisits);
// [1.130.0] Visits from earlier days still with a department, which today's queue does not hold.
router.get('/carried-over', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getCarriedOver);

// UI/UX Phase 2: any-status, date-ranged visit history for Reception's Visit History view.
// Must be registered before '/:id' so 'history' isn't swallowed as an :id param.
router.get('/history', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getVisitsByDateRange);

// Get specific visit details
router.get('/:id', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getVisitById);

// The doctor's signed request a patient uploaded with their booking. [1.106.0] Client is named so
// a patient can see their own; the service checks that the visit is theirs.
router.get('/:id/doctor-request', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'), authorizePermissions('visits:read'), visitController.downloadDoctorRequest);

// Update visit status (Receptionist, Admin, Cashier)
router.put('/:id/status', verifyToken, authorizeStaff, authorizePermissions('visits:update'), visitController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('visits:update'), visitController.updateStatus);

// Visit history per patient (staff or client viewing own patient)
router.get('/patient/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'), authorizePermissions('visits:read'), visitController.getVisitHistory);

module.exports = router;
