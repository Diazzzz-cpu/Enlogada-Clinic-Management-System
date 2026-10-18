const appointmentService = require('../services/appointmentService');
const { formatTime12 } = require('../constants/clockFormat');
const { discardHmoCard } = require('../config/upload');
const { isStaffUser } = require('../constants/roles');
const { isNamed, assertDoctorRequestIfRequired } = require('../services/referralService');

class AppointmentController {
  async create(req, res, next) {
    try {
      const { patientId, scheduledDate, scheduledTime, notes, hmo } = req.body;
      const createdBy = req.user.userId;

      // Multer has already written any uploaded card and doctor's request by the time this runs,
      // so every rejection below has to drop them — otherwise a refused booking leaves an
      // unreferenced image on disk. Absent on a JSON (staff) booking, where multer finds no
      // multipart body.
      const { card = null, doctorRequest = null } = req.bookingFiles || {};
      const reject = (message) => {
        discardHmoCard(card, doctorRequest);
        return res.status(400).json({ status: 'error', message });
      };

      if (!patientId || !scheduledDate || !scheduledTime) {
        return reject('Patient ID, scheduled date, and scheduled time are required.');
      }

      // Under multipart every field arrives as a string, and an array only survives when the
      // client uses the testIds[] form. A single testIds[] entry still yields an array, so the
      // one-test case does not need special handling; a bare repeated testIds would, which is
      // why that form is not accepted.
      let testIds = req.body.testIds;
      if (typeof testIds === 'string') testIds = [testIds];

      // testIds and hmo are optional: Reception's flows and the seed script still post the
      // original body and attach tests separately. When present they are validated here so a
      // malformed value never reaches the transaction holding the slot lock.
      let normalisedTestIds = [];
      if (testIds !== undefined) {
        if (!Array.isArray(testIds)) {
          return reject('testIds must be an array.');
        }
        normalisedTestIds = [...new Set(testIds.map(Number))];
        if (normalisedTestIds.some((id) => !Number.isInteger(id) || id <= 0)) {
          return reject('testIds must be positive whole numbers.');
        }
        // Bounded so a hostile payload cannot hold the slot's advisory lock open.
        if (normalisedTestIds.length > 20) {
          return reject('A booking may include at most 20 tests.');
        }
      }

      // Packages, normalised exactly as testIds are and for the same reasons — multipart sends
      // strings, and a malformed value must be rejected before the transaction takes the slot lock.
      let packageIds = req.body.packageIds;
      if (typeof packageIds === 'string') packageIds = [packageIds];
      let normalisedPackageIds = [];
      if (packageIds !== undefined) {
        if (!Array.isArray(packageIds)) {
          return reject('packageIds must be an array.');
        }
        normalisedPackageIds = [...new Set(packageIds.map(Number))];
        if (normalisedPackageIds.some((id) => !Number.isInteger(id) || id <= 0)) {
          return reject('packageIds must be positive whole numbers.');
        }
        // A package expands into up to a dozen tests, so the ceiling is lower than the 20 for
        // loose tests — the bound exists to cap work done under the slot lock, not to count rows.
        if (normalisedPackageIds.length > 5) {
          return reject('A booking may include at most 5 packages.');
        }
      }

      let normalisedHmo = null;
      if (hmo !== undefined && hmo !== null) {
        const providerId = Number(hmo.providerId);
        // Rejected explicitly rather than coerced: the client's "Self-Pay / None" option carries
        // the string 'none', which used to arrive here as NaN and be stored as a null provider.
        if (!Number.isInteger(providerId) || providerId <= 0) {
          return reject('Select a valid HMO provider, or choose Self-Pay.');
        }
        if (!normalisedTestIds.length && !normalisedPackageIds.length) {
          return reject('An HMO claim needs at least one test or package on the booking.');
        }
        normalisedHmo = { providerId, approvalCode: hmo.approvalCode || null };
      }

      // Checked here as well as in hmoService so the rejection lands before the transaction and
      // its slot lock. hmoService is where the rule actually lives, because POST /hmo/request
      // reaches it too and a check only in this controller would leave that route open — which is
      // also why both must agree on what "staff" means, hence the shared predicate rather than a
      // second role list written out here.
      if (normalisedHmo && !isStaffUser(req.user) && !card) {
        return reject('Please attach a photo of your HMO card to claim HMO coverage.');
      }

      // [1.107.0] A patient's HMO booking carries the doctor's signed request; self-pay does not
      // have to. The same early exit; appointmentService holds the rule (referralService), and is
      // also where the Private patient type is known — this controller has not read the patient.
      try {
        assertDoctorRequestIfRequired({
          isStaff: isStaffUser(req.user),
          hasDoctorRequest: Boolean(doctorRequest),
          hasHmoClaim: Boolean(normalisedHmo),
        });
      } catch (err) {
        return reject(err.message);
      }

      // Same shape as the card check above, and for the same reason: refuse before the transaction
      // so a doomed booking never holds the slot's advisory lock. The authoritative rule is in
      // referralService, which hmoService also consults — this is the early exit, not the gate.
      // An uploaded doctor's request names the doctor, so it answers this too.
      const referral = {
        referringPhysician: req.body.referringPhysician,
        referringPhysicianPrc: req.body.referringPhysicianPrc,
      };
      if (normalisedHmo && !isNamed(referral.referringPhysician) && !doctorRequest) {
        return reject("Please give the referring physician's name — an HMO claim needs it for the LOA.");
      }

      const result = await appointmentService.createAppointment({
        patientId,
        scheduledDate,
        scheduledTime,
        notes,
        createdBy,
        requestingUser: req.user,
        testIds: normalisedTestIds,
        packageIds: normalisedPackageIds,
        hmo: normalisedHmo,
        hmoCardFile: card,
        doctorRequestFile: doctorRequest,
        referral
      });

      const { appointment, visitTests, hmoRequest, alreadyBooked } = result;

      // 200 rather than 201 when the booking already existed: the request was a retry, nothing
      // new was created, and the caller gets the original reference back so it can show the real
      // confirmation instead of an error about a slot the patient themselves took.
      return res.status(alreadyBooked ? 200 : 201).json({
        status: 'success',
        message: alreadyBooked
          ? `You already have this booking. Reference: ${appointment.appointment_reference}`
          : `Appointment created. Reference: ${appointment.appointment_reference}`,
        data: { appointment, visitTests, hmoRequest, alreadyBooked }
      });
    } catch (err) {
      // Deliberately NOT unlinking here. Once createAppointment has been entered it owns the
      // file: it discards on rollback and keeps it on commit, gated on its own `committed` flag.
      // Unlinking on any throw would delete the card of a booking that DID commit, the moment
      // anything is ever added after COMMIT — which is exactly the hazard that flag exists for.
      // Rejections before the service runs use reject(), which discards.
      next(err);
    }
  }

  async getAvailability(req, res, next) {
    try {
      const { date } = req.query;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          status: 'error',
          message: 'A valid date (YYYY-MM-DD) query parameter is required.'
        });
      }

      const availability = await appointmentService.getAvailableSlots(date);
      return res.status(200).json({
        status: 'success',
        data: availability
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyReference(req, res, next) {
    try {
      const { reference } = req.params;
      const appointment = await appointmentService.verifyByReference(reference);

      return res.status(200).json({
        status: 'success',
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }

  async getAll(req, res, next) {
    try {
      const { status, dateFrom, dateTo, page, limit } = req.query;
      const result = await appointmentService.getAllAppointments({ status, dateFrom, dateTo, page, limit });
      return res.status(200).json({
        status: 'success',
        data: Array.isArray(result)
          ? { appointments: result, total: result.total ?? result.length }
          : result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyBookings(req, res, next) {
    try {
      const userId = req.user.userId;
      const bookings = await appointmentService.getClientBookings(userId);

      return res.status(200).json({
        status: 'success',
        data: { bookings }
      });
    } catch (err) {
      next(err);
    }
  }

  async reschedule(req, res, next) {
    try {
      const { id } = req.params;
      const { scheduledDate, scheduledTime, reason } = req.body;

      if (!scheduledDate || !scheduledTime) {
        return res.status(400).json({
          status: 'error',
          message: 'A new date and time are both required.'
        });
      }
      // Shape-checked here so a malformed value is refused before the service opens a transaction
      // and takes the slot's advisory lock. YYYY-MM-DD and HH:MM (seconds optional, since a
      // scheduled_time read back from Postgres carries them).
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(scheduledTime)) {
        return res.status(400).json({
          status: 'error',
          message: 'Date must be YYYY-MM-DD and time HH:MM.'
        });
      }

      const appointment = await appointmentService.rescheduleAppointment(
        id,
        { scheduledDate, scheduledTime: scheduledTime.slice(0, 5), reason },
        req.user
      );

      return res.status(200).json({
        status: 'success',
        message: `Appointment moved to ${scheduledDate} at ${formatTime12(scheduledTime)}.`,
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'Status is required.'
        });
      }

      const appointment = await appointmentService.updateStatus(id, status);
      return res.status(200).json({
        status: 'success',
        message: `Appointment status updated to ${status}.`,
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AppointmentController();
