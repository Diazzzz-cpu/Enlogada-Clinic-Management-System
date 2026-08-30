const crypto = require('crypto');
const { OCCUPIES_SLOT, HOLD_EXPIRY_SQL } = require('../constants/slotHold');
const db = require('../config/database');

class AppointmentRepository {
  /**
   * `provisional` makes the booking HOLD its slot rather than take it. [1.35.0]
   *
   * Set only for a client's own self-pay booking, which is the one case where nobody has
   * committed anything yet — staff bookings and HMO bookings are permanent from the start. The
   * expiry is computed by Postgres, so the database's clock is the only one that decides when a
   * slot goes back on sale.
   */
  async createAppointment({ patientVisitId, scheduledDate, scheduledTime, notes, provisional = false }, client = db) {
    // Generate a unique appointment reference for QR code lookup
    const appointmentReference = 'APT-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    const queryText = `
      INSERT INTO appointments (patient_visit_id, appointment_reference, scheduled_date, scheduled_time, notes, held_until)
      VALUES ($1, $2, $3, $4, $5, ${provisional ? HOLD_EXPIRY_SQL : 'NULL'})
      RETURNING *
    `;
    const result = await client.query(queryText, [patientVisitId, appointmentReference, scheduledDate, scheduledTime, notes]);
    return result.rows[0];
  }

  /**
   * Makes a held booking permanent. Called when the money actually lands. [1.35.0]
   *
   * Unconditional on the hold still being alive, deliberately. If the patient took longer than
   * the hold and somebody else booked the slot in the meantime, the payment has still happened
   * and PayMongo has still taken the money — refusing to honour the booking does not give it
   * back. The same reasoning forceSettleGatewayPayment is built on. The caller notices the
   * overbooking and tells staff; it does not undo a paid appointment.
   */
  async confirmHold(patientVisitId, client = db) {
    const { rows } = await client.query(
      `UPDATE appointments SET held_until = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE patient_visit_id = $1 AND held_until IS NOT NULL
        RETURNING *`,
      [patientVisitId]
    );
    return rows[0];
  }

  /**
   * Pushes a live hold out by another window, because the patient is actively paying. [1.35.0]
   *
   * `held_until IS NOT NULL` keeps this from touching a permanent booking — reopening checkout on
   * an HMO or staff-created appointment must not turn it provisional. A hold that has already
   * lapsed is deliberately still extendable: the patient came back and is trying again, and if
   * the slot is meanwhile gone the capacity check will say so at the point it matters.
   */
  async extendHold(patientVisitId, client = db) {
    const { rows } = await client.query(
      `UPDATE appointments SET held_until = ${HOLD_EXPIRY_SQL}, updated_at = CURRENT_TIMESTAMP
        WHERE patient_visit_id = $1 AND held_until IS NOT NULL
        RETURNING *`,
      [patientVisitId]
    );
    return rows[0];
  }

  // `is_paid` rides along so the receptionist's QR-scan panel can show, before they check the
  // patient in, whether the online payment actually landed — check-in only releases the ticket
  // to the modality if it did.
  async findByReference(reference) {
    // UI/UX Modernization Phase 10: categories aggregates the visit's already-attached tests'
    // departments (Laboratory/Ultrasound/Xray/...), so Reception can tell the patient exactly
    // where to go right after check-in instead of just clearing the screen with no next step.
    // Empty for a walk-in visit checked in before any tests are attached — that path shows no
    // guidance message, per ReceptionistDashboard.jsx's own handling.
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name, p.contact_number, p.birthdate, p.sex,
             pt.name as patient_type_name,
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             -- The receipt for the money already taken, so the booking pass can carry it. [1.52.0]
             -- A patient who has paid holds two things that belong together: the pass they present
             -- and the receipt for what they paid. They lived on separate screens, so the patient
             -- had to go and find the second one.
             --
             -- 'Paid' only: a reversed receipt must not keep appearing on a live booking pass as
             -- though the money were still the clinic's. LIMIT 1 because a visit settled once has
             -- one receipt, and ordering by paid_at makes "the current one" deterministic rather
             -- than whatever the planner returned first.
             (
               SELECT pay.receipt_number
                 FROM payments pay
                WHERE pay.patient_visit_id = pv.id
                  AND pay.payment_status = 'Paid'
                  AND pay.receipt_number IS NOT NULL
                ORDER BY pay.paid_at DESC
                LIMIT 1
             ) AS receipt_number,
             COALESCE(ARRAY_AGG(DISTINCT tc.name) FILTER (WHERE tc.name IS NOT NULL), '{}') as categories
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN visit_tests vt ON vt.patient_visit_id = pv.id
      LEFT JOIN tests t ON vt.test_id = t.id
      LEFT JOIN test_categories tc ON t.category_id = tc.id
      WHERE a.appointment_reference = $1
      GROUP BY a.id, pv.id, pv.patient_id, pv.visit_type, pv.status, pv.queue_number, p.first_name, p.last_name, p.contact_number, p.birthdate, p.sex, pt.name
    `;
    const result = await db.query(queryText, [reference]);
    return result.rows[0];
  }

  // Backs the duplicate guard in appointmentService. Keyed on the patient rather than the user
  // account, because one account owns several profiles and booking two dependents into the same
  // slot is legitimate. appointments has no patient_id of its own, so it reaches one through the
  // visit -- which is also why this rule cannot be a UNIQUE constraint.
  async findActiveByPatientAndSlot({ patientId, scheduledDate, scheduledTime }, client = db) {
    const queryText = `
      SELECT a.*, pv.queue_number
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      WHERE pv.patient_id = $1
        AND a.scheduled_date = $2
        AND a.scheduled_time = $3
        AND a.status <> 'Cancelled'
      LIMIT 1
    `;
    const result = await client.query(queryText, [patientId, scheduledDate, scheduledTime]);
    return result.rows[0];
  }

  async findById(id) {
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status,
             p.first_name, p.last_name
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE a.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  // `is_paid` drives the client's booking pass: the QR code the receptionist scans is only issued
  // once payment has actually settled, so an unpaid booking shows how to pay instead of a
  // scannable pass. [1.48.0] restored that rule after a spell where the pass was shown unpaid —
  // which was correct while the clinic could only take money at the counter, and stopped being so
  // once a patient could settle from home. The reference is still printed as text either way, so
  // the counter path never depended on the QR.
  async findByPatientUserId(userId) {
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name,
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             -- The receipt for money already taken, so the pass and the receipt travel together.
             -- [1.52.0] A patient who has paid holds two things that belong side by side: the pass
             -- they present at the desk, and proof of what they paid. They lived on separate
             -- screens, so the patient had to go and find the second one — usually at the moment
             -- an HMO or an employer asked them for it.
             --
             -- 'Paid' only: a reversed receipt must not keep riding on a live pass as though the
             -- money were still the clinic's. LIMIT 1 with an explicit ORDER BY because "the
             -- current receipt" must be deterministic, not whatever the planner returned first.
             (
               SELECT pay.receipt_number
                 FROM payments pay
                WHERE pay.patient_visit_id = pv.id
                  AND pay.payment_status = 'Paid'
                  AND pay.receipt_number IS NOT NULL
                ORDER BY pay.paid_at DESC
                LIMIT 1
             ) AS receipt_number,
             -- What this booking costs, so the patient paying from home is told a FIGURE rather
             -- than "the amount due". [1.48.0] They are about to type it into a banking app, and
             -- a number they have to go and find somewhere else is a number they will get wrong.
             --
             -- Summed from price_at_time, the same column every other total in the app reads, so
             -- a package's allocated shares add up here exactly as they do on the cashier's bill.
             (
               SELECT COALESCE(SUM(vt.price_at_time), 0)
               FROM visit_tests vt
               WHERE vt.patient_visit_id = pv.id
             ) AS amount_due,
             -- What the patient has to do before this appointment. [1.24.0] put these in the
             -- booking wizard and the confirmation email, and then the patient's own list of
             -- bookings — the screen they open the day before to check the time — could not show
             -- them. A correlated subquery rather than a join, so one row per booking survives
             -- however many tests it carries.
             (
               SELECT COALESCE(
                 ARRAY_AGG(t.preparation ORDER BY t.name) FILTER (WHERE t.preparation IS NOT NULL),
                 '{}'
               )
               FROM visit_tests vt
               JOIN tests t ON vt.test_id = t.id
               WHERE vt.patient_visit_id = pv.id
             ) AS preparation_notes,
             -- How many people are still waiting in front of this patient, RIGHT NOW. [1.62.0]
             --
             -- The service layer turns this into a time; the count is done here because it is a
             -- fact about today's queue that only SQL can answer, and answering it in JavaScript
             -- would mean shipping the whole active queue to the portal to count it — the entire
             -- day's patient list, to a patient, which is a PHI leak rather than a performance
             -- problem.
             --
             -- NULL unless this booking is itself in today's queue and still Pending. A booking
             -- for next Tuesday has no position, and a patient already billed is past the desk;
             -- in both cases there is no wait to state, and stating zero would be a claim rather
             -- than an absence.
             CASE
               WHEN pv.status = 'Pending'
                    AND pv.created_at >= CURRENT_DATE
                    AND pv.created_at < (CURRENT_DATE + 1)
               THEN (
                 SELECT COUNT(*)::int
                   FROM patient_visits ahead
                  WHERE ahead.status = 'Pending'
                    AND ahead.created_at >= CURRENT_DATE
                    AND ahead.created_at < (CURRENT_DATE + 1)
                    -- Strictly earlier, with id breaking a tie the same way the staff queue's
                    -- window function does, so the two screens agree on who is in front of whom.
                    AND (ahead.created_at, ahead.id) < (pv.created_at, pv.id)
               )
               ELSE NULL
             END AS patients_ahead
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE p.user_id = $1
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  // Paged at the database. [1.29.0] Same shape as visits/history and payments/transactions:
  // this returned every appointment ever booked and the screen showed fifteen. `limit` is
  // optional so any caller that genuinely wants the whole set is unaffected.
  async findAll({ status, dateFrom, dateTo, limit = null, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`a.scheduled_date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`a.scheduled_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Shared by the list and the count, so the two can never disagree about which rows they mean.
    const fromClause = `
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      ${whereClause}
    `;

    const countRes = await db.query(`SELECT COUNT(*)::int AS total ${fromClause}`, params);
    const total = countRes.rows[0].total;

    let queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name
      ${fromClause}
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      queryText += ` LIMIT $${listParams.length}`;
      listParams.push(offset);
      queryText += ` OFFSET $${listParams.length}`;
    }
    const result = await db.query(queryText, listParams);
    return Object.assign(result.rows, { total });
  }

  // `expectedStatus` makes this the other half of updateSchedule's compare-and-swap. Guarding
  // only the reschedule side narrowed the race without closing it: the mover takes the row lock
  // and commits a new date, the check-in blocks on that lock, then unblocks and re-evaluates
  // `WHERE id = $2` against the new row — which still matches, because nothing constrains what
  // the row looked like when the caller decided to write. It sets Confirmed on a booking for next
  // month, which is exactly the state the reschedule guard exists to prevent.
  //
  // Optional, because the other transitions are legitimate from several starting states: a visit
  // can be cancelled whether or not it was confirmed, and Completed / No Show follow a check-in.
  // Only the caller knows which state it read.
  async updateAppointmentStatus(id, status, { expectedStatus = null } = {}) {
    const queryText = expectedStatus
      ? `UPDATE appointments
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = $3
         RETURNING *`
      : `UPDATE appointments
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`;
    const params = expectedStatus ? [status, id, expectedStatus] : [status, id];
    const result = await db.query(queryText, params);
    return result.rows[0];
  }

  /**
   * Everything an appointment email needs, in one read. [1.24.0]
   *
   * The patient's address, their name, and the tests with their preparation instructions —
   * because the instruction is the part of the email that stops a wasted trip, and it is per
   * test rather than per booking.
   *
   * `u.email` is LEFT JOINed: a walk-in registered at the desk has no user account, so this
   * returns a row with a null email rather than no row at all. The caller treats that as "no
   * email to send", which is different from "this booking does not exist".
   */
  async findEmailContextById(appointmentId) {
    const queryText = `
      SELECT a.appointment_reference, a.scheduled_date, a.scheduled_time,
             pv.queue_number,
             p.first_name, p.last_name,
             u.email,
             COALESCE(
               ARRAY_AGG(
                 JSON_BUILD_OBJECT('test_name', t.name, 'preparation', t.preparation)
                 ORDER BY t.name
               ) FILTER (WHERE t.id IS NOT NULL),
               '{}'
             ) AS tests
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN visit_tests vt ON vt.patient_visit_id = pv.id
      LEFT JOIN tests t ON vt.test_id = t.id
      WHERE a.id = $1
      GROUP BY a.id, pv.queue_number, p.first_name, p.last_name, u.email
    `;
    const result = await db.query(queryText, [appointmentId]);
    return result.rows[0];
  }

  // Moves a booking to a different slot.
  //
  // appointment_reference is deliberately NOT reissued. The patient is holding that code — on a
  // screenshot, in an email, as the QR on their booking pass — and a reschedule is the same
  // booking on a different day, not a new one. Reissuing would silently invalidate the pass they
  // will present at the desk.
  //
  // The old slot is released by this same UPDATE: capacity is counted from these two columns, so
  // there is no second write that could fail and leave the booking occupying two slots.
  // `status = 'Pending'` is a compare-and-swap, not a redundant re-check of the service's guard.
  // The service reads the row outside any transaction, and the advisory lock it then takes is
  // keyed on the DESTINATION slot — so it serialises against competing bookings and against
  // nothing at all that a check-in does. Without this predicate, a receptionist checking the
  // patient in while a move is in flight had that check-in silently replaced with a future date,
  // leaving status 'Confirmed' against a booking for next month. Zero rows means the status
  // stopped being Pending; same idiom as visitRepository.releaseVisitToModalities.
  //
  // reminder_sent_at is cleared because the reminder that was sent described the old date. The
  // sweep only considers rows where it is NULL, so a booking reminded for tomorrow and then moved
  // was never reminded again — the exact no-show the reminder exists to prevent. Cleared
  // unconditionally: a move that keeps the date and changes only the time still needs a new one.
  async updateSchedule(id, { scheduledDate, scheduledTime }) {
    const queryText = `
      UPDATE appointments
      SET scheduled_date = $1,
          scheduled_time = $2,
          reminder_sent_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND status = 'Pending'
      RETURNING *
    `;
    const result = await db.query(queryText, [scheduledDate, scheduledTime, id]);
    return result.rows[0];
  }

  // How full a slot is, ignoring one appointment.
  //
  // The exclusion is what makes a reschedule work at the seeded capacity of 1. Without it a
  // booking moved from 09:00 to 09:00 — which the UI allows, because the patient may be changing
  // only the date — counts itself and is refused as full, and the patient is told their own
  // booking is in the way.
  async countActiveInSlot({ scheduledDate, scheduledTime, excludeId = null }) {
    const queryText = `
      SELECT COUNT(*)::int AS cnt
      FROM appointments
      WHERE scheduled_date = $1
        AND scheduled_time = $2
        AND ${OCCUPIES_SLOT()}
        AND ($3::int IS NULL OR id <> $3)
    `;
    const result = await db.query(queryText, [scheduledDate, scheduledTime, excludeId]);
    return result.rows[0].cnt;
  }
}

module.exports = new AppointmentRepository();
