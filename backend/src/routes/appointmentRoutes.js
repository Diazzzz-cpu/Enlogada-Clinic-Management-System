const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');
const { uploadBookingFilesMiddleware } = require('../config/upload');

const router = express.Router();

// Client or Receptionist creates an appointment.
//
// uploadBookingFilesMiddleware (the HMO card and, since [1.106.0], the doctor's signed request)
// sits after verifyToken so an unauthenticated or deactivated caller can never cause a disk
// write, and so the filename can be seeded on the uploading user. It engages only for multipart
// bodies -- multer returns next() immediately for anything else -- so a staff booking can still
// arrive as JSON. A patient's cannot: it must carry the doctor's request.
router.post('/', verifyToken, uploadBookingFilesMiddleware, appointmentController.create);

// Client views their own bookings
router.get('/my-bookings', verifyToken, appointmentController.getMyBookings);

// Admin/SuperAdmin oversight — list all appointments, optionally filtered
router.get('/', verifyToken, authorizeStaff, authorizePermissions('appointments:read'), appointmentController.getAll);

// Client or Receptionist retrieves bookable time slots for a given date
router.get('/availability', verifyToken, appointmentController.getAvailability);

// Receptionist verifies appointment by reference (QR scan or manual entry)
router.get('/verify/:reference', verifyToken, authorizeStaff, authorizePermissions('appointments:read'), appointmentController.verifyReference);

// Client cancels their own appointment; front office cancels on a patient's behalf.
//
// This carried verifyToken alone while its sibling /:id/status — a less destructive operation on
// the same resource — was role-gated. The service's assertClientOwnsPatient returns immediately
// for any non-Client role, so that asymmetry meant a Laboratory, Xray, Ultrasound or Cashier
// token could walk PUT /api/appointments/1/cancel … /N/cancel and empty the appointment book,
// cascading each cancellation to the linked visit.
router.put('/:id/cancel', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), authorizePermissions('appointments:cancel'), appointmentController.cancel);

// Move a booking to a different slot. Patient-reachable, so it keeps an explicit role list rather
// than authorizeStaff — same rule as /cancel above.
//
// Its own permission rather than reusing appointments:cancel. They are different decisions and a
// clinic may well want one without the other: reception rescheduling freely while patients are
// asked to phone in, or the reverse. Reusing the cancel grant would make that undecidable.
router.put('/:id/reschedule', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), authorizePermissions('appointments:reschedule'), appointmentController.reschedule);

// Staff updates appointment status (Confirmed, Completed, No Show)
router.put('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);

module.exports = router;
