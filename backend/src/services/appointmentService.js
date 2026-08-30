const db = require('../config/database');
const { formatTime12 } = require('../constants/clockFormat');
const { isStaffUser } = require('../constants/roles');
const paymentGatewayService = require('./paymentGatewayService');
const { OCCUPIES_SLOT } = require('../constants/slotHold');
const appointmentRepository = require('../repositories/appointmentRepository');
const patientRepository = require('../repositories/patientRepository');
const visitRepository = require('../repositories/visitRepository');
const scheduleRepository = require('../repositories/scheduleRepository');
const testRepository = require('../repositories/testRepository');
const patientService = require('./patientService');
const notificationService = require('./notificationService');
const queueEstimateService = require('./queueEstimateService');
const testService = require('./testService');
const packageService = require('./packageService');
const hmoService = require('./hmoService');
const { discardHmoCard } = require('../config/upload');
const visitService = require('./visitService');
const auditService = require('./auditService');
const appointmentEmailService = require('./appointmentEmailService');
const logger = require('../config/logger');
const { assertReferralIfRequired, normaliseReferral } = require('./referralService');

async function assertClientOwnsPatient(requestingUser, patientId) {
  if (!requestingUser?.roles?.includes('Client')) return; // staff roles are not ownership-restricted
  const patient = await patientService.getPatientById(patientId);
  if (patient.user_id !== requestingUser.userId) {
    const error = new Error('Access forbidden. This patient profile does not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Is this date/time a slot the clinic actually offers? Returns that day's operating hours, which
 * the caller needs anyway for the capacity ceiling.
 *
 * Shared by booking and rescheduling because the two must agree. A reschedule that skipped this
 * would let a patient move a booking to a Sunday, or to 19:00 — through a UI that never offered
 * either, but the API is reachable directly and the check is the only thing that makes the
 * availability screen more than a suggestion.
 */

async function assertSlotWithinOperatingHours(scheduledDate, scheduledTime) {
  const dayOfWeek = new Date(`${scheduledDate}T12:00:00Z`).getUTCDay();
  const hours = await scheduleRepository.findOperatingHoursForDay(dayOfWeek);

  if (!hours || !hours.is_open) {
    const error = new Error('The clinic is closed on the selected date.');
    error.statusCode = 409;
    throw error;
  }
  const requestedMinutes = timeToMinutes(scheduledTime);
  if (requestedMinutes < timeToMinutes(hours.open_time) || requestedMinutes >= timeToMinutes(hours.close_time)) {
    const error = new Error('The selected time is outside clinic operating hours.');
    error.statusCode = 409;
    throw error;
  }
  return hours;
}

// One message for both places a reschedule can be refused: the pre-check, and the losing side of
// the compare-and-swap in updateSchedule. A caller cannot tell — and should not need to — whether
// the check-in landed a moment before their request or a moment after it.
function refuseReschedule(status) {
  const error = new Error(
    status === 'Confirmed'
      ? 'This appointment has already been checked in and cannot be rescheduled.'
      : status
        ? `A ${String(status).toLowerCase()} appointment cannot be rescheduled.`
        : 'This appointment changed while you were rescheduling it. Please reload and try again.'
  );
  error.statusCode = 409;
  return error;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function todayLocalDateString() {
  return formatDateOnly(new Date());
}

/**
 * A booking may be for today or any day after it, never before. [1.33.0]
 *
 * The client's date picker has carried `min={todayStr()}` all along, but that is a hint to the
 * browser and nothing more: it does not survive a typed value in every browser, and it does not
 * exist at all for anything talking to the API directly. Nothing on the server ever compared the
 * requested date to today, so POST /appointments would happily create a real visit and a real
 * appointment row for last Tuesday — occupying a slot in a day that has already happened, on a
 * queue nobody will ever call.
 *
 * INCLUSIVE of today, deliberately. The elapsed part of today is already handled where it
 * belongs, in getAvailableSlots, which marks a time unavailable once it has passed. Rejecting
 * today outright here would refuse a walk-in booked for this afternoon.
 *
 * String comparison rather than Date arithmetic: both sides are YYYY-MM-DD, which sorts
 * lexicographically as it sorts chronologically, and it avoids constructing a Date from a bare
 * date string — which is parsed as UTC midnight and is a day out in Manila. Same reason
 * formatDateOnly exists.
 */
function assertNotInThePast(scheduledDate, verb = 'Book') {
  const today = todayLocalDateString();
  if (scheduledDate < today) {
    const error = new Error(
      `${verb} a date from today onwards. ${scheduledDate} has already passed.`
    );
    error.statusCode = 400;
    throw error;
  }
}

/**
 * A DATE column as the calendar date it actually is.
 *
 * node-pg parses DATE at LOCAL midnight, so toISOString() on it returns the previous day
 * everywhere east of UTC — in Philippine time, every date in the system, always. Local getters,
 * same rule as frontend/src/lib/date.js.
 */
function formatDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class AppointmentService {
  /**
   * Bookable times for one date, from the weekly pattern plus any override for that date.
   *
   * @param {string} date  'YYYY-MM-DD', the clinic's LOCAL date.
   * @returns {Promise<object>} Every slot in the day, each flagged available or not — not only the
   *   free ones, so the picker can show a taken slot as taken rather than omitting it.
   *
   * A per-date override wins over the weekday pattern, which is how a public holiday closes or a
   * Saturday runs shorter hours without anybody editing the weekly schedule.
   */
  async getAvailableSlots(date) {
    // A day that has already passed is closed, whatever the operating hours say. [1.33.0]
    //
    // Without this the grid came back fully open for any past date: `isPast` below is scoped to
    // today, so for an earlier day every slot reported available and the UI offered last Tuesday
    // as bookable. Answering here rather than only refusing at POST means the client never shows
    // a slot it would then reject — the screen and the API agree instead of arguing.
    //
    // Shaped as "not open" rather than as an error because that is what it is, and the caller
    // already renders that state. An error would turn a date-picker keystroke into a red toast.
    if (date < todayLocalDateString()) {
      return { date, isOpen: false, slots: [] };
    }

    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = await scheduleRepository.findOperatingHoursForDay(dayOfWeek);

    // ── What the clinic has said about THIS date, over the weekly pattern [1.57.0] ───────────
    //
    // The pattern cannot express "not this Thursday". Before overrides, a Holy Week closure or a
    // day with one sonographer instead of two had to be handled by telephoning every patient who
    // took a slot the clinic could not honour.
    //
    // Every field on an override is nullable and NULL means "keep the weekday's answer", so
    // closing a day is one row saying is_open=false and nothing else. `??` rather than `||`
    // throughout: a deliberate capacity of 0 is a real value and `||` would silently discard it
    // in favour of the weekday's.
    const override = await scheduleRepository.findOverrideForDate(date);

    const isOpen = override ? override.is_open : Boolean(hours?.is_open);
    if (!hours || !isOpen) {
      return {
        date,
        isOpen: false,
        slots: [],
        // Why, when the clinic has said. A closed day with no reason reads as a broken website;
        // "Closed — Holy Week" reads as a clinic that is shut.
        note: override?.note || null,
      };
    }

    const openMinutes = timeToMinutes(override?.open_time ?? hours.open_time);
    const closeMinutes = timeToMinutes(override?.close_time ?? hours.close_time);
    const interval = override?.slot_interval_minutes ?? hours.slot_interval_minutes;
    const maxConcurrent = override?.max_concurrent_bookings ?? hours.max_concurrent_bookings;

    const bookings = await scheduleRepository.countBookingsByTimeForDate(date);
    const bookedCounts = {};
    bookings.forEach(b => {
      bookedCounts[minutesToTime(timeToMinutes(b.scheduled_time))] = b.cnt;
    });

    const isToday = date === todayLocalDateString();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (let m = openMinutes; m < closeMinutes; m += interval) {
      const time = minutesToTime(m);
      const bookedCount = bookedCounts[time] || 0;
      const isPast = isToday && m <= nowMinutes;
      slots.push({ time, available: bookedCount < maxConcurrent && !isPast });
    }

    // `note` rides along on an OPEN day too: "Half day — staff training" is exactly the sort of
    // thing a patient should read before choosing a time, not after arriving.
    return { date, isOpen: true, slots, note: override?.note || null };
  }

  // Books an appointment and everything that belongs to it in ONE transaction.
  //
  // The tests and the optional HMO request used to be two further HTTP calls made by the browser
  // after this one had already committed. A failure in either left an appointment that existed
  // while the patient was told the booking failed -- and because a non-cancelled appointment
  // occupies its slot, that phantom then refused the patient's own retry as "no longer
  // available". Both now live inside this transaction, so a booking either exists completely or
  // not at all.
  async createAppointment({
    patientId, scheduledDate, scheduledTime, notes, createdBy, requestingUser,
    testIds = [], packageIds = [], hmo = null, hmoCardFile = null, referral = null
  }) {
    // db.withTransaction rather than a hand-managed db.pool.connect(). Everything underneath —
    // testService.attachTests, hmoService.createRequest and the auditService.log inside it — runs
    // on this one connection automatically, so nothing under the advisory lock can check out a
    // second connection while holding the first. With a bounded pool that is a deadlock: ten
    // concurrent bookings hold all ten connections, each waiting for one that will never come
    // free. It also removes the `committed` flag this used to need — the post-commit work below
    // is now structurally outside the transaction rather than inside its try.
    let outcome;
    try {
      // Inside the try, though it runs before the transaction: multer has already written the card
      // by the time this method is entered, so a 403 here would otherwise leave it on disk forever.
      await assertClientOwnsPatient(requestingUser, patientId);

      // The same rule the front desk applies when it registers a walk-in: a 'Private' patient is
      // by definition one a physician referred, so the booking has to say who. It was enforced at
      // the desk and on any HMO claim, but not on an online self-pay booking — so a patient could
      // book from home in a state reception would have refused at the counter.
      //
      // Still ahead of the transaction, so a booking that cannot succeed never takes the slot's
      // advisory lock, and inside the try so a rejection still discards the uploaded card.
      //
      // A staff caller reaches here without assertClientOwnsPatient having read anything, so an
      // unknown patientId would otherwise pass this assertion with an undefined type and fail
      // later as a foreign-key violation — a 500 where a 404 is the honest answer.
      const bookingPatient = await patientRepository.findPatientById(patientId);
      if (!bookingPatient) {
        const error = new Error('Patient not found');
        error.statusCode = 404;
        throw error;
      }
      assertReferralIfRequired({
        patientTypeName: bookingPatient.patient_type_name,
        hasHmoClaim: Boolean(hmo),
        referringPhysician: referral?.referringPhysician
      });

      // Cheapest guard first, and outside the transaction: a past date needs no advisory lock and
      // no capacity check to be refused. [1.33.0]
      assertNotInThePast(scheduledDate);

      outcome = await db.withTransaction(async () => {
        // 1. Validate the requested slot against clinic operating hours
        const hours = await assertSlotWithinOperatingHours(scheduledDate, scheduledTime);

        // 2. Serialize concurrent bookings for the same slot (no row exists yet to lock
        //    on an empty slot, so an advisory lock closes that race window).
        //    Everything from here to COMMIT runs while other bookings for this slot wait, so keep
        //    it short -- in particular, never put a file write or a network call in here.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

        // 3. Has this patient already booked this exact slot? Checked inside the lock, so it is
        //    race-free, and BEFORE the capacity check below -- which matters at the seeded
        //    max_concurrent_bookings of 1, where the patient's own booking would otherwise be the
        //    thing that makes the slot look full. Returning the existing booking is what makes a
        //    retry after a lost response safe: the patient re-enters the same patient, date and
        //    time, which is a natural idempotency key they regenerate for free.
        //
        //    Keyed on the patient, not the account: one account owns several profiles, so two
        //    dependents at the same time are two different patients and correctly both allowed.
        const existing = await appointmentRepository.findActiveByPatientAndSlot(
          { patientId, scheduledDate, scheduledTime }
        );
        if (existing) {
          let visitTests;
          if (packageIds.length) {
            await packageService.attachPackages(existing.patient_visit_id, packageIds);
          }
          if (testIds.length) {
            visitTests = await testService.attachTests(existing.patient_visit_id, testIds);
          } else {
            visitTests = await testRepository.findTestsByVisitId(existing.patient_visit_id);
          }

          return { appointment: existing, visitTests, hmoRequest: null, alreadyBooked: true };
        }

        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS cnt FROM appointments
            WHERE scheduled_date = $1 AND scheduled_time = $2 AND ${OCCUPIES_SLOT()}`,
          [scheduledDate, scheduledTime]
        );
        if (rows[0].cnt >= hours.max_concurrent_bookings) {
          const error = new Error('This time slot is no longer available. Please select a different time.');
          error.statusCode = 409;
          throw error;
        }

        // 4. Create the patient_visit record first (visit_type = 'Appointment')
        //
        // The referring physician goes on at creation rather than being written back afterwards
        // by hmoService: this path is minting the visit, so it can simply record it, and
        // assertVisitNamesReferrer then finds the visit already named one and has nothing to do.
        const queueNumber = await visitRepository.getNextQueueNumber();
        const visit = await visitRepository.createVisit({
          patientId,
          visitType: 'Appointment',
          notes,
          queueNumber,
          createdBy,
          ...normaliseReferral(referral || {})
        });

        // 5. Create the appointment record linked to the visit
        //
        // Provisional — a HOLD rather than a claim — only for a client's own self-pay booking.
        // [1.35.0] That is the single case where nobody has committed anything: the patient is at
        // home, the money has not moved, and until this change an abandoned checkout kept the slot
        // for good because capacity asked only whether the row existed.
        //
        // The three exclusions are each a case where the booking is already real:
        //   staff caller  — the patient is standing at the desk
        //   HMO claim     — settled at the clinic by design, so it must never be made conditional
        //                   on an online payment that is never going to happen
        //   no gateway    — with no online payment configured the instruction is "pay at the
        //                   counter", and a slot that expires while the patient travels to the
        //                   clinic would be a worse bug than the one being fixed
        const payingOnline = !isStaffUser(requestingUser)
          && !hmo
          && paymentGatewayService.isConfigured();

        const appointment = await appointmentRepository.createAppointment({
          patientVisitId: visit.id,
          scheduledDate,
          scheduledTime,
          notes,
          provisional: payingOnline
        });

        // 6. Attach the chosen tests, and the HMO claim if one was made. Order matters:
        //    hmo_request_tests references visit_tests.
        // Packages first: both writes are ON CONFLICT DO NOTHING against
        // uq_visit_tests_visit_test, so for a test that is both inside a bundle and picked
        // individually, whichever lands first sets the price. The package's allocated share is
        // the one that must survive, or the bundle quietly costs more than its fixed price.
        if (packageIds.length) {
          await packageService.attachPackages(visit.id, packageIds);
        }
        const visitTests = testIds.length
          ? await testService.attachTests(visit.id, testIds)
          : (packageIds.length ? await testRepository.findTestsByVisitId(visit.id) : []);

        let hmoRequest = null;
        if (hmo && visitTests.length) {
          hmoRequest = await hmoService.createRequest({
            hmoProviderId: hmo.providerId,
            approvalCode: hmo.approvalCode || null,
            visitTestIds: visitTests.map((vt) => vt.id),
            cardFile: hmoCardFile
          }, requestingUser, { ownershipAlreadyAsserted: true });
        }

        return {
          appointment: { ...appointment, queue_number: visit.queue_number },
          visitTests,
          hmoRequest,
          alreadyBooked: false,
          queueNumber: visit.queue_number
        };
      });
    } catch (err) {
      // Nothing committed, so nothing references the card and the bytes multer wrote are
      // unreachable. This is the ONLY place the card is discarded on failure: past this catch the
      // transaction has committed, and deleting the file would break a booking that exists.
      discardHmoCard(hmoCardFile);
      throw err;
    }

    // ── Committed from here. Nothing below may delete the card or fail the booking. ──────────
    if (outcome.alreadyBooked) {
      // A retry re-sends the card the original booking already carries, and this path files no
      // new claim for it to attach to. Drop the bytes rather than letting a re-submission swap
      // the evidence under a claim an Admin may already have reviewed.
      discardHmoCard(hmoCardFile);
      // No notification either: staff were already told about this booking when it was made.
      return outcome;
    }

    // Module 18 (Notification): Receptionist owns intake/check-in for a booked appointment;
    // Admin/SuperAdmin have standing oversight (matches the existing Appointments Oversight
    // page). Outside the transaction so a notification failure can never roll back a real
    // booking — and notifyRoles swallows its own errors, so it cannot fail the request either.
    await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
      title: 'New Appointment Booked',
      message: `Queue #${outcome.queueNumber} — ${scheduledDate} at ${formatTime12(scheduledTime)}`,
      type: 'info'
    });

    // And tell the patient. [1.24.0] Staff got a notification and the patient got nothing but a
    // confirmation screen that vanishes when the tab closes — taking the reference the front desk
    // asks for with it. The email also carries the preparation instructions, which is the part
    // that stops somebody arriving unable to be tested.
    await this.emailBookingConfirmation(outcome.appointment.id);

    return outcome;
  }

  /**
   * Looks up a booking by the reference its QR encodes. This is the check-in scan.
   *
   * @param {string} reference
   * @returns {Promise<object|null>}
   *
   * The QR carries this string and nothing else, precisely so a scan and a typed reference are the
   * same lookup — packing a second value into the code would stop check-in working.
   */
  async verifyByReference(reference) {
    const appointment = await appointmentRepository.findByReference(reference);
    if (!appointment) {
      const error = new Error('Appointment not found. Invalid reference code.');
      error.statusCode = 404;
      throw error;
    }
    return appointment;
  }

  /**
   * The patient's own bookings, each carrying a wait estimate when it is in today's queue.
   *
   * [1.62.0] The estimate is applied through the SAME `queueEstimateService` the staff queue uses,
   * with the same rate and the same rounding. Two independent calculations of "how long until I am
   * seen" would disagree within a minute of each other, and the patient would be looking at one
   * while the receptionist read the other — which is worse than neither screen having a number.
   */
  async getClientBookings(userId) {
    const bookings = await appointmentRepository.findByPatientUserId(userId);
    if (!bookings.length) return bookings;

    // One rate for the whole list. Rows with a null `patients_ahead` are not in today's queue and
    // are returned untouched, without an estimate.
    const rate = await queueEstimateService.getServiceRate();
    return bookings.map((booking) => (
      booking.patients_ahead === null || booking.patients_ahead === undefined
        ? booking
        : { ...booking, ...queueEstimateService.estimateFor(booking.patients_ahead, rate) }
    ));
  }

  async getAllAppointments({ status, dateFrom, dateTo, page, limit } = {}) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : null;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    const rows = await appointmentRepository.findAll({
      status,
      dateFrom,
      dateTo,
      limit: limitNum,
      offset: limitNum ? (pageNum - 1) * limitNum : 0,
    });

    if (!limitNum) return rows;
    return {
      appointments: Array.from(rows),
      total: rows.total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(rows.total / limitNum)),
    };
  }

  /**
   * Cancels a booking and frees its slot.
   *
   * @param {number} id
   * @param {object} requestingUser  A Client may cancel only their own. Ownership is checked per
   *   patient PROFILE, since one account may own several.
   * @returns {Promise<object>}
   */
  async cancelAppointment(id, requestingUser) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

    await assertClientOwnsPatient(requestingUser, appointment.patient_id);

    if (appointment.status === 'Cancelled') {
      const error = new Error('Appointment is already cancelled');
      error.statusCode = 400;
      throw error;
    }

    // Cancelling the appointment and cancelling its visit is one decision, so it is one write.
    // Split, a failure on the second left the appointment Cancelled while its visit stayed active
    // — a phantom booking that the patient believes is cancelled and that the front desk still
    // sees in the queue, still counts toward the slot capacity check in bookAppointment, and
    // still appears on the cashier's billing list.
    // Read before the cancel: the context query joins visit_tests, and the row is easier to read
    // while the booking is still live than to reason about afterwards.
    const ctx = await appointmentRepository.findEmailContextById(id).catch(() => null);

    const updated = await db.withTransaction(async () => {
      const result = await appointmentRepository.updateAppointmentStatus(id, 'Cancelled');
      await visitRepository.updateVisitStatus(appointment.patient_visit_id, 'Cancelled');
      return result;
    });

    // After the commit. A patient who cancels needs a record that it actually happened, and one
    // whose appointment was cancelled *for* them needs to find out some way other than turning up.
    try {
      if (ctx) {
        await appointmentEmailService.sendCancellationNotice({
          to: ctx.email,
          patientName: `${ctx.first_name} ${ctx.last_name}`,
          reference: ctx.appointment_reference,
          date: ctx.scheduled_date,
          time: ctx.scheduled_time,
        });
      }
    } catch (err) {
      logger.error(`Cancellation email failed for appointment ${id}: ${err.message}`);
    }

    return updated;
  }

  /**
   * Emails the patient their own booking. [1.24.0]
   *
   * Wrapped rather than inlined at each call site because all three appointment emails share the
   * same shape — read the context, skip quietly if there is nobody to write to, never let a mail
   * problem surface as a failed booking. Every caller is past its COMMIT.
   */
  async emailBookingConfirmation(appointmentId) {
    try {
      const ctx = await appointmentRepository.findEmailContextById(appointmentId);
      if (!ctx) return;
      await appointmentEmailService.sendBookingConfirmation({
        to: ctx.email,
        patientName: `${ctx.first_name} ${ctx.last_name}`,
        reference: ctx.appointment_reference,
        date: ctx.scheduled_date,
        time: ctx.scheduled_time,
        queueNumber: ctx.queue_number,
        tests: ctx.tests || [],
      });
    } catch (err) {
      // The booking is already committed and correct. An email problem is not the patient's
      // problem and must not be reported as one.
      logger.error(`Booking confirmation email failed for appointment ${appointmentId}: ${err.message}`);
    }
  }

  /**
   * Moves an existing booking to a different slot.
   *
   * Cancel-and-rebook was the only way to change a booking, and it is not equivalent: between the
   * two calls the patient holds nothing, and at the seeded capacity of one patient per slot
   * somebody else can take the replacement in the gap. The patient ends up with no appointment
   * having started with one, which is a worse outcome than being told the new time is unavailable.
   * Here the move either happens or the original stands.
   *
   * Only a Pending booking can move. 'Confirmed' is the receptionist's check-in — the patient is
   * at the desk, so a new date is not what anyone means — and Completed / No Show / Cancelled are
   * all finished.
   */
  async rescheduleAppointment(id, { scheduledDate, scheduledTime }, requestingUser) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

    await assertClientOwnsPatient(requestingUser, appointment.patient_id);

    if (appointment.status !== 'Pending') {
      throw refuseReschedule(appointment.status);
    }

    // Moving a booking backwards into the past is the same defect as creating one there, and this
    // is the only other writer of scheduled_date. Checked after the ownership and status guards
    // so a client learns "not yours" before "wrong date" — the weaker statement first. [1.33.0]
    assertNotInThePast(scheduledDate, 'Move it to');

    const previous = {
      date: formatDateOnly(appointment.scheduled_date),
      time: String(appointment.scheduled_time).slice(0, 5),
    };

    const updated = await db.withTransaction(async () => {
      const hours = await assertSlotWithinOperatingHours(scheduledDate, scheduledTime);

      // Same advisory lock as booking, on the same key, so a reschedule and a fresh booking
      // competing for the last place in a slot are serialised against each other rather than both
      // reading a stale count.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

      // Another of this patient's bookings already sitting in the target slot. Refused rather
      // than merged: two bookings becoming one silently loses whatever was attached to this one.
      const clash = await appointmentRepository.findActiveByPatientAndSlot({
        patientId: appointment.patient_id, scheduledDate, scheduledTime,
      });
      if (clash && clash.id !== appointment.id) {
        const error = new Error('This patient already has a booking at that time.');
        error.statusCode = 409;
        throw error;
      }

      // Excluding itself, so moving to a different date at the same time of day is not blocked
      // by its own row.
      const taken = await appointmentRepository.countActiveInSlot({
        scheduledDate, scheduledTime, excludeId: appointment.id,
      });
      if (taken >= hours.max_concurrent_bookings) {
        const error = new Error('This time slot is no longer available. Please select a different time.');
        error.statusCode = 409;
        throw error;
      }

      const moved = await appointmentRepository.updateSchedule(id, { scheduledDate, scheduledTime });

      // Compare-and-swap: no row means the status stopped being Pending between the read above and
      // this write — the receptionist checked the patient in at the desk while the move was in
      // flight. Checked before the audit entry on purpose: a log line attesting to a move that did
      // not happen is worse than no line, and throwing here rolls the transaction back before the
      // post-commit notification and reschedule email can go out.
      if (!moved) {
        const current = await appointmentRepository.findById(id);
        throw refuseReschedule(current?.status);
      }

      // Audited: a booking moving is a change to a commitment made to a patient, and when staff
      // do it on someone's behalf the record of who and when is the whole point. Low volume, so
      // none of the fan-out concern that keeps logPhiRead off worklists applies.
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'appointment.rescheduled',
        entityType: 'appointment',
        entityId: appointment.id,
        description:
          `${appointment.appointment_reference}: ${previous.date} ${previous.time} → ` +
          `${scheduledDate} ${String(scheduledTime).slice(0, 5)}`,
      });

      return moved;
    });

    // After the commit, and notifyRoles swallows its own errors, so a notification problem can
    // never report a completed move as failed.
    await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
      title: 'Appointment Rescheduled',
      message:
        `${appointment.first_name} ${appointment.last_name} — ${previous.date} ${previous.time} → ` +
        `${scheduledDate} ${String(scheduledTime).slice(0, 5)}`,
      type: 'info',
    });

    // The patient needs this one more than staff do, and especially when reception moved it on
    // their behalf over the phone — otherwise the only record of the new time is a conversation.
    try {
      const ctx = await appointmentRepository.findEmailContextById(id);
      if (ctx) {
        await appointmentEmailService.sendRescheduleNotice({
          to: ctx.email,
          patientName: `${ctx.first_name} ${ctx.last_name}`,
          reference: ctx.appointment_reference,
          from: previous,
          moved: { date: scheduledDate, time: scheduledTime },
          queueNumber: ctx.queue_number,
        });
      }
    } catch (err) {
      logger.error(`Reschedule email failed for appointment ${id}: ${err.message}`);
    }

    return { ...updated, queue_number: appointment.queue_number, previous };
  }

  async updateStatus(id, status) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }
    // Checking a patient in is only meaningful against the booking the receptionist just looked
    // at. Passing the status they read makes this a compare-and-swap against a reschedule landing
    // in the same instant — without it, a move that commits while this call waits on the row lock
    // would be confirmed on top of, leaving Confirmed against a date the patient was never told.
    // Other transitions stay unguarded: they are legitimate from more than one starting state.
    const updated = status === 'Confirmed'
      ? await appointmentRepository.updateAppointmentStatus(id, status, { expectedStatus: appointment.status })
      : await appointmentRepository.updateAppointmentStatus(id, status);

    if (!updated) {
      const error = new Error(
        'This appointment changed while you were checking it in. Please reload and try again.'
      );
      error.statusCode = 409;
      throw error;
    }

    // Confirming an appointment IS the receptionist's half of the release rule (the QR scan /
    // reference check-in at the front desk). If the booking was already paid online, this is
    // the moment the ticket reaches the modality; if it wasn't, releaseVisitIfReady reports
    // 'unpaid' and the visit correctly stays with the cashier. Reception no longer sets the
    // visit status itself — that call is the release rule's alone.
    if (status === 'Confirmed') {
      await visitService.releaseVisitIfReady(appointment.patient_visit_id);
    }

    return updated;
  }
}

module.exports = new AppointmentService();
