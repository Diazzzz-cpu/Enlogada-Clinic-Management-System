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

// [1.131.0] No cancel route: an unpaid booking is released on its own when its time is up, and a
// paid one is moved, never cancelled (no refunds). appointmentService.updateStatus says the same.

// Move a booking to a different slot. Patient-reachable, so it keeps an explicit role list rather
// than authorizeStaff: a patient moves their own booking, staff move one on a patient's behalf.
//
router.put('/:id/reschedule', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), authorizePermissions('appointments:reschedule'), appointmentController.reschedule);

// Staff check a booking in ('Confirmed'), the one status set by hand. [1.131.0]
router.put('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);

module.exports = router;
