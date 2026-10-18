const db = require('../config/database');
const { inTodaysQueue } = require('../constants/queueMembership');

class VisitRepository {
  // `doctorRequest` is the multer file of the doctor's signed request [1.106.0], or null. Only
  // the stored name and the upload's metadata are kept; the file sits in uploads/doctor-requests.
  async createVisit(
    {
      patientId, visitType, notes, queueNumber, createdBy,
      referringPhysician = null, referringPhysicianPrc = null, doctorRequest = null,
    },
    client = db
  ) {
    const queryText = `
      INSERT INTO patient_visits (
        patient_id, visit_type, notes, queue_number, created_by,
        referring_physician, referring_physician_prc,
        doctor_request_file_path, doctor_request_original_name, doctor_request_mime_type,
        doctor_request_size_bytes, doctor_request_uploaded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const result = await client.query(queryText, [
      patientId, visitType, notes, queueNumber, createdBy,
      referringPhysician || null, referringPhysicianPrc || null,
      doctorRequest?.filename ?? null,
      doctorRequest?.originalname ?? null,
      doctorRequest?.mimetype ?? null,
      doctorRequest?.size ?? null,
      // Stamped like the HMO card's card_uploaded_at, which hmoRepository also sets from here.
      doctorRequest ? new Date() : null,
    ]);
    return result.rows[0];
  }

  /** The doctor's request on a visit, for the authorised read-back route. [1.106.0] */
  async findDoctorRequestByVisitId(id) {
    const result = await db.query(
      `SELECT id, patient_id, doctor_request_file_path, doctor_request_original_name,
              doctor_request_mime_type
         FROM patient_visits
        WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Records the requesting doctor on a visit that already exists.
   *
   * Needed because the two are not always captured together: reception logs an HMO claim against
   * a visit that may have been registered minutes earlier as a plain walk-in, and the claim is
   * what makes the referral mandatory. Without this the only way to satisfy the rule would be to
   * cancel the visit and re-register it.
   */
  async updateReferringPhysician(visitId, { referringPhysician, referringPhysicianPrc }) {
    const queryText = `
      UPDATE patient_visits
      SET referring_physician = $1,
          referring_physician_prc = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    const result = await db.query(queryText, [
      referringPhysician || null, referringPhysicianPrc || null, visitId,
    ]);
    return result.rows[0];
  }

  // search/status/limit/offset are all optional. Omitting limit preserves the original
  // "return everything matching" behavior for callers (e.g. Cashier's billing queue) that need
  // to see every unpaid visit at once, not just one page of it. Callers that do paginate
  // (Receptionist's queue table) get total/pendingCount/processingCount/walkinCount back too,
  // computed server-side, so pagination doesn't break their KPI header cards.
  /**
   * Unpaid visits whose time is up. [1.131.0]
   *
   * Steven's rule: nothing goes ahead unpaid, so an unpaid walk-in or booking is temporary, and
   * once its time is up it is REMOVED, never kept as "Cancelled" or "No Show". Its time is up when
   *   - a walk-in's day has ended and it was not paid;
   *   - a booking's day has passed and it was not paid. Staff and HMO bookings too: they hold a
   *     slot without paying first, but the patient still has to come and settle at the clinic;
   *   - a patient's own booking was not paid within its time to pay (its hold lapsed).
   * Never one still waiting on someone (an HMO decision, an online payment proof to check), and
   * never one that ever had a receipt issued, whatever became of it.
   */
  async findExpiredUnpaid() {
    const { rows } = await db.query(
      `SELECT pv.id, pv.queue_number, pv.created_at, pv.visit_type,
              p.first_name, p.last_name, COALESCE(u.email, p.email) AS email,
              a.id AS appointment_id, a.appointment_reference, a.scheduled_date, a.scheduled_time,
              CASE WHEN a.id IS NULL THEN 'day_ended'
                   WHEN a.scheduled_date < CURRENT_DATE THEN 'day_passed'
                   ELSE 'payment_window' END AS why,
              ARRAY(SELECT t.name FROM visit_tests vt JOIN tests t ON t.id = vt.test_id
                     WHERE vt.patient_visit_id = pv.id ORDER BY vt.id) AS test_names
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN appointments a ON a.patient_visit_id = pv.id
        WHERE pv.status = 'Pending'
          AND NOT EXISTS (SELECT 1 FROM payments pay
                           WHERE pay.patient_visit_id = pv.id
                             AND (pay.payment_status = 'Paid' OR pay.receipt_number IS NOT NULL))
          AND NOT EXISTS (SELECT 1 FROM payment_submissions s
                           WHERE s.patient_visit_id = pv.id AND s.status = 'Pending')
          AND NOT EXISTS (SELECT 1 FROM hmo_request_tests hrt
                            JOIN visit_tests vt ON vt.id = hrt.visit_test_id
                           WHERE vt.patient_visit_id = pv.id AND hrt.approval_status = 'Pending')
          AND (
                (a.id IS NULL AND pv.created_at < CURRENT_DATE)
             OR (a.id IS NOT NULL AND a.scheduled_date < CURRENT_DATE)
             OR (a.id IS NOT NULL AND a.status = 'Pending'
                 AND a.held_until IS NOT NULL AND a.held_until <= CURRENT_TIMESTAMP)
          )
        ORDER BY pv.id`
    );
    return rows;
  }

  /**
   * Deletes visits and everything hung on them, child to parent (several keys do not cascade).
   * For unpaid visits only: callers decide which. Returns the uploaded files the rows pointed at,
   * to be removed from disk once the transaction has committed. [1.131.0]
   */
  async removeVisits(visitIds) {
    if (!visitIds.length) return { files: [] };
    const v = [visitIds];
    const { rows: files } = await db.query(
      `SELECT 'doctor-requests' AS dir, doctor_request_file_path AS p FROM patient_visits
        WHERE id = ANY($1) AND doctor_request_file_path IS NOT NULL
       UNION ALL
       SELECT 'payments', proof_file_path FROM payment_submissions
        WHERE patient_visit_id = ANY($1) AND proof_file_path IS NOT NULL
       UNION ALL
       SELECT 'results', tr.file_path FROM test_results tr JOIN visit_tests vt ON vt.id = tr.visit_test_id
        WHERE vt.patient_visit_id = ANY($1) AND tr.file_path IS NOT NULL`,
      v
    );
    const { rows: claims } = await db.query(
      `SELECT DISTINCT hrt.hmo_request_id AS id FROM hmo_request_tests hrt
         JOIN visit_tests vt ON vt.id = hrt.visit_test_id WHERE vt.patient_visit_id = ANY($1)`,
      v
    );
    await db.query(
      'DELETE FROM hmo_request_tests WHERE visit_test_id IN (SELECT id FROM visit_tests WHERE patient_visit_id = ANY($1))', v
    );
    if (claims.length) {
      const { rows: cards } = await db.query(
        `DELETE FROM hmo_requests hr WHERE hr.id = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM hmo_request_tests hrt WHERE hrt.hmo_request_id = hr.id)
          RETURNING card_file_path AS p`,
        [claims.map((c) => c.id)]
      );
      for (const c of cards) if (c.p) files.push({ dir: 'hmo-cards', p: c.p });
    }
    await db.query('DELETE FROM test_results WHERE visit_test_id IN (SELECT id FROM visit_tests WHERE patient_visit_id = ANY($1))', v);
    await db.query('DELETE FROM payment_submissions WHERE patient_visit_id = ANY($1)', v);
    await db.query('DELETE FROM payments WHERE patient_visit_id = ANY($1)', v);
    await db.query('DELETE FROM visit_feedback_answers WHERE patient_visit_id = ANY($1)', v);
    await db.query('DELETE FROM visit_tests WHERE patient_visit_id = ANY($1)', v);
    await db.query('DELETE FROM appointments WHERE patient_visit_id = ANY($1)', v);
    await db.query('DELETE FROM patient_visits WHERE id = ANY($1)', v);
    return { files };
  }

  /**
   * Visits from an EARLIER day still with a department: paid, released, not finished. [1.130.0]
   *
   * Today's queue holds today's visits only, so a visit paid yesterday whose tests are still being
   * done was on no screen the front desk uses, and Patient Records was the only place it showed.
   * Oldest first, each with its tests and where each stands.
   */
  async findCarriedOver() {
    const { rows } = await db.query(
      `SELECT pv.id, pv.created_at, pv.queue_number, pv.visit_type, pv.status AS visit_status,
              p.id AS patient_id, p.first_name, p.last_name,
              (SELECT pt.name FROM patient_types pt WHERE pt.id = p.patient_type_id) AS patient_type_name,
              COALESCE((
                SELECT JSON_AGG(JSON_BUILD_OBJECT(
                         'id', vt.id, 'name', t.name, 'category', tc.name, 'status', vt.status,
                         'released_at', (SELECT MIN(tr.authorised_at) FROM test_results tr
                                          WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL),
                         'done_at', vt.performed_at
                       ) ORDER BY vt.id)
                  FROM visit_tests vt
                  JOIN tests t            ON t.id = vt.test_id
                  JOIN test_categories tc ON tc.id = t.category_id
                 WHERE vt.patient_visit_id = pv.id
              ), '[]') AS tests
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
        WHERE pv.status = 'Processing'
          AND pv.created_at < CURRENT_DATE
        ORDER BY pv.created_at ASC
        LIMIT 200`
    );
    return rows;
  }

  /**
   * PAID bookings whose day passed with nobody checked in. [1.130.0] A paid booking is moved, never
   * written off ([1.123.0]: no refunds), so the end-of-day close leaves it, and the desk is told to
   * move it here.
   */
  async findMissedPaidBookings() {
    const { rows } = await db.query(
      `SELECT a.id, a.appointment_reference, a.scheduled_date, a.scheduled_time, a.status,
              a.patient_visit_id, p.id AS patient_id, p.first_name, p.last_name,
              ARRAY(SELECT t.name FROM visit_tests vt JOIN tests t ON t.id = vt.test_id
                     WHERE vt.patient_visit_id = a.patient_visit_id ORDER BY vt.id) AS booked_test_names
         FROM appointments a
         JOIN patient_visits pv ON pv.id = a.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
        WHERE a.status = 'Pending'
          AND a.scheduled_date < CURRENT_DATE
          AND EXISTS (SELECT 1 FROM payments pay
                       WHERE pay.patient_visit_id = a.patient_visit_id AND pay.payment_status = 'Paid')
        ORDER BY a.scheduled_date, a.scheduled_time
        LIMIT 200`
    );
    return rows;
  }

  async findActiveVisits({ search, status, limit, offset } = {}) {
    // Who is in today's queue is one shared rule (constants/queueMembership.js): opened today,
    // Pending or Processing, and checked in if it came from a booking. [1.92.0] Its date test is a
    // half-open range, not a ::date cast; the cast kept idx_patient_visits_created from ever being
    // used, so the active queue sequentially scanned every visit ever recorded.
    const filters = [inTodaysQueue('pv')];
    const params = [];

    if (status && status !== 'All') {
      params.push(status);
      filters.push(`pv.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      // [1.123.0] The full name as well: the Desk's "Who's here?" sends what was typed, and
      // "Teresita Gatchalian" matched neither name alone, so the queue answered "nobody" for a
      // patient standing in it and the box offered them a second visit.
      filters.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx}
                     OR (p.first_name || ' ' || p.last_name) ILIKE $${idx} OR pv.queue_number ILIKE $${idx})`);
    }
    const whereClause = filters.join(' AND ');

    const summaryQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pv.status = 'Pending') as pending_count,
        COUNT(*) FILTER (WHERE pv.status = 'Processing') as processing_count,
        COUNT(*) FILTER (WHERE pv.visit_type = 'Walk in') as walkin_count
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      WHERE ${whereClause}
    `;
    const summaryRes = await db.query(summaryQuery, params);
    const summary = summaryRes.rows[0];

    // [1.62.0] Queue position and how many are still waiting IN FRONT of each visit.
    //
    // Computed in a CTE over the WHOLE active set — deliberately not inside the filtered query
    // below. Position is a fact about the queue, not about the search results: filtering to
    // "Dela Cruz" must not renumber that patient to #1, and paging to the second page must not
    // restart the count. Both would be the result of ranking after the WHERE clause, and both
    // would tell a patient something confidently false about where they stand.
    //
    // `patients_ahead` counts only 'Pending' predecessors. A 'Processing' visit has already been
    // billed and released to a department — that person is no longer between this patient and the
    // desk, and counting them would inflate every estimate by the whole morning's completed work.
    //
    // The frame `UNBOUNDED PRECEDING AND 1 PRECEDING` is what makes it "ahead of me" rather than
    // "including me": without the `1 PRECEDING` bound, a Pending patient counts themselves and
    // the person at the front of the queue is told one patient is ahead of them.
    let listQuery = `
      WITH queue AS (
        SELECT pv.id,
               ROW_NUMBER() OVER (ORDER BY pv.created_at, pv.id)::int AS queue_position,
               COALESCE(SUM(CASE WHEN pv.status = 'Pending' THEN 1 ELSE 0 END)
                        OVER (ORDER BY pv.created_at, pv.id
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::int AS patients_ahead
          FROM patient_visits pv
         WHERE ${inTodaysQueue('pv')}
      )
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name,
             u.first_name as created_by_first_name, u.last_name as created_by_last_name,
             pv.status as visit_status,
             q.queue_position, q.patients_ahead,
             -- [1.122.0] A paid visit cannot be cancelled; the Desk hides Cancel on it.
             EXISTS (
               SELECT 1 FROM payments pay
                WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN users u ON pv.created_by = u.id
      JOIN queue q ON q.id = pv.id
      WHERE ${whereClause}
      ORDER BY pv.created_at ASC
    `;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      listQuery += ` LIMIT $${listParams.length}`;
      if (offset != null) {
        listParams.push(offset);
        listQuery += ` OFFSET $${listParams.length}`;
      }
    }
    const result = await db.query(listQuery, listParams);
    const visits = result.rows;

    // Batch-fetch tests for every visit on this page in one query instead of one query per
    // visit — the previous per-visit loop here was a genuine N+1 (confirmed as the cause of a
    // multi-second load once the daily active-visit count grew large during the UI/UX audit).
    if (visits.length > 0) {
      const testsQuery = `
        SELECT vt.id, vt.patient_visit_id, vt.status as test_status, vt.price_at_time, t.name as test_name, tc.name as category_name
        FROM visit_tests vt
        JOIN tests t ON vt.test_id = t.id
        JOIN test_categories tc ON t.category_id = tc.id
        WHERE vt.patient_visit_id = ANY($1::int[])
      `;
      const testsRes = await db.query(testsQuery, [visits.map(v => v.id)]);
      const testsByVisit = {};
      for (const row of testsRes.rows) {
        if (!testsByVisit[row.patient_visit_id]) testsByVisit[row.patient_visit_id] = [];
        testsByVisit[row.patient_visit_id].push(row);
      }
      for (const visit of visits) {
        visit.tests = testsByVisit[visit.id] || [];
      }
    }

    return {
      visits,
      total: parseInt(summary.total, 10),
      pendingCount: parseInt(summary.pending_count, 10),
      processingCount: parseInt(summary.processing_count, 10),
      walkinCount: parseInt(summary.walkin_count, 10),
    };
  }

  // Any-status, date-ranged visit lookup for Receptionist's Visit History view — distinct from
  // findActiveVisits (today-only, Pending/Processing only). Defaults are applied by the service
  // layer, not here, matching paymentRepository.findTransactions' convention.
  // Paged at the database. [1.29.0] This returned every visit in the range and the screen sliced
  // fifteen out of it in JavaScript. Measured at 664 bytes a visit, so a year-wide range is a
  // 3.6 MB response to fill a fifteen-row table — down the wire, parsed, and held in memory, on
  // every page load and on a screen that polls. The row count comes back separately so the
  // pagination footer can still say how many there are without shipping them.
  async findVisitsByDateRange({ startDate, endDate, search, visitType, status, limit = null, offset = 0 }) {
    // COALESCE to CURRENT_DATE rather than defaulting in JavaScript: the server's local date is
    // what every other date filter in this file compares against, and a JS default would have to
    // agree with it — which is exactly the disagreement the toISOString bug was.
    const filters = [
      `pv.created_at >= COALESCE($1::date, CURRENT_DATE)`,
      `pv.created_at < (COALESCE($2::date, CURRENT_DATE) + 1)`,
    ];
    const params = [startDate, endDate];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx}
                     OR (p.first_name || ' ' || p.last_name) ILIKE $${idx} OR pv.queue_number ILIKE $${idx})`);
    }

    // Filtered in SQL, not in the page of rows already fetched. This list is paged at the
    // database, so narrowing it in JavaScript would filter 25 rows and then label the answer as
    // the whole range — the same mistake the money summary exists to avoid. The COUNT below runs
    // on the same WHERE, so the total the footer shows is the total that matches.
    if (visitType) {
      params.push(visitType);
      filters.push(`pv.visit_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`pv.status = $${params.length}`);
    }
    const whereClause = filters.join(' AND ');

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM patient_visits pv
         JOIN patients p ON pv.patient_id = p.id
        WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0].total;

    let listQuery = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name,
             pv.status as visit_status
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE ${whereClause}
      ORDER BY pv.created_at DESC
    `;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      listQuery += ` LIMIT $${listParams.length}`;
      listParams.push(offset);
      listQuery += ` OFFSET $${listParams.length}`;
    }
    const result = await db.query(listQuery, listParams);
    const visits = result.rows;

    if (visits.length > 0) {
      const testsQuery = `
        SELECT vt.id, vt.patient_visit_id, vt.status as test_status, t.name as test_name, tc.name as category_name
        FROM visit_tests vt
        JOIN tests t ON vt.test_id = t.id
        JOIN test_categories tc ON t.category_id = tc.id
        WHERE vt.patient_visit_id = ANY($1::int[])
      `;
      const testsRes = await db.query(testsQuery, [visits.map(v => v.id)]);
      const testsByVisit = {};
      for (const row of testsRes.rows) {
        if (!testsByVisit[row.patient_visit_id]) testsByVisit[row.patient_visit_id] = [];
        testsByVisit[row.patient_visit_id].push(row);
      }
      for (const visit of visits) {
        visit.tests = testsByVisit[visit.id] || [];
      }
    }

    return { visits, total };
  }

  async findVisitById(id) {
    const queryText = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE pv.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async updateVisitStatus(id, status) {
    const queryText = `
      UPDATE patient_visits
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, id]);
    return result.rows[0];
  }

  // A patient's visits, newest first: what Patient Records' file shows the front desk. [1.116.0]
  // Each carries the names of its tests (never a result) and whether it is in today's queue, by the
  // queue's own rule, so the file can say "already here" instead of offering a second visit.
  //
  // [1.130.0] And where each test stands, so the desk can answer "is my result ready?" without
  // reading it: its status, when its report was first released, or when its X-ray was marked
  // done. Dates and states only; what a report SAYS stays with whoever holds results:read.
  async findVisitsByPatientId(patientId) {
    const queryText = `
      SELECT pv.*, p.first_name, p.last_name,
             ARRAY(
               SELECT t.name
               FROM visit_tests vt
               JOIN tests t ON t.id = vt.test_id
               WHERE vt.patient_visit_id = pv.id
               ORDER BY vt.id
             ) AS test_names,
             COALESCE((
               SELECT JSON_AGG(JSON_BUILD_OBJECT(
                        'id', vt.id, 'name', t.name, 'category', tc.name, 'status', vt.status,
                        'released_at', (SELECT MIN(tr.authorised_at) FROM test_results tr
                                         WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL),
                        'done_at', vt.performed_at
                      ) ORDER BY vt.id)
                 FROM visit_tests vt
                 JOIN tests t            ON t.id = vt.test_id
                 JOIN test_categories tc ON tc.id = t.category_id
                WHERE vt.patient_visit_id = pv.id
             ), '[]') AS tests,
             EXISTS (
               SELECT 1 FROM payments pay
                WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             (${inTodaysQueue('pv')}) AS in_todays_queue
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      WHERE pv.patient_id = $1
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(queryText, [patientId]);
    return result.rows;
  }

  // Everything needed to decide whether a visit may be released to the modalities, in one
  // round trip. `is_paid` is the authoritative payment gate; `is_confirmed` is the staff gate
  // (an Appointment must have been checked in / QR-scanned by a receptionist, whereas a walk
  // in is confirmed by the act of being registered at the front desk).
  async findReleaseReadiness(visitId, client = db) {
    const queryText = `
      SELECT pv.id, pv.status, pv.visit_type, pv.queue_number, pv.patient_id,
             p.first_name, p.last_name,
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             CASE
               WHEN pv.visit_type = 'Walk in' THEN TRUE
               -- An 'Appointment'-type visit with no appointments row at all was created
               -- directly by staff (POST /visits accepts either visit_type), so there is no QR
               -- check-in to wait for. Without this branch such a visit could never satisfy the
               -- confirmation condition and would be stuck at 'Pending' forever, unreachable by
               -- any modality no matter how many times it was paid.
               WHEN NOT EXISTS (
                 SELECT 1 FROM appointments a WHERE a.patient_visit_id = pv.id
               ) THEN TRUE
               ELSE EXISTS (
                 SELECT 1 FROM appointments a
                 WHERE a.patient_visit_id = pv.id AND a.status = 'Confirmed'
               )
             END AS is_confirmed
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      WHERE pv.id = $1
    `;
    const result = await client.query(queryText, [visitId]);
    return result.rows[0];
  }

  // Releasing a visit to the modalities is two writes that must not be separable: the visit
  // becomes 'Processing' AND its not-yet-started tests become 'Processing' (which is what
  // actually makes them appear on a modality worklist). A half-applied release would either
  // strand a released visit with invisible tests or expose tests for an unreleased visit.
  //
  // The UPDATE ... WHERE status = 'Pending' is also the concurrency guard: two simultaneous
  // callers (e.g. the payment webhook and a receptionist check-in landing together) race on
  // this row, and only the one that actually flips it gets rows back. The loser returns
  // undefined and skips the duplicate notification.
  //
  // Goes through withTransaction rather than checking out its own client. That matters now that
  // paymentService.processPayment wraps the capture and this release together: a self-managed
  // client would open a SECOND, independent transaction that commits on its own, so a payment
  // that later rolled back would leave the visit already released to the modalities — a ticket
  // on a worklist with no payment behind it, which is the exact inverse of the bug the payment
  // transaction exists to prevent. Nested here, this joins the caller's transaction instead.
  /**
   * Hands a paid visit's tests to their departments.
   *
   * @param {number} visitId
   * @returns {Promise<Array>} The categories the work reached, so the caller can notify exactly
   *   those departments and no others.
   *
   * Moves `visit_tests` to 'Processing', which is what makes them visible on a modality worklist.
   * Called from inside the payment transaction: a released visit with no settled receipt is work
   * the clinic performed and cannot bill for.
   */
  async releaseVisitToModalities(visitId) {
    return await db.withTransaction(async () => {
      const visitRes = await db.query(
        `UPDATE patient_visits
         SET status = 'Processing', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'Pending'
         RETURNING *`,
        [visitId]
      );

      // Compare-and-swap. Zero rows means another caller already released this visit — the
      // payment webhook and a front-desk check-in landing together is the real case. Nothing was
      // written, so there is nothing to undo; returning undefined lets the loser skip the
      // duplicate notification. (This used to ROLLBACK here, which would now abort the caller's
      // transaction as well — a no-op release must not undo the payment that triggered it.)
      if (visitRes.rows.length === 0) return undefined;

      await db.query(
        `UPDATE visit_tests
         SET status = 'Processing', updated_at = CURRENT_TIMESTAMP
         WHERE patient_visit_id = $1 AND status IN ('Pending', 'Approved')`,
        [visitId]
      );

      return visitRes.rows[0];
    });
  }

  // Distinct test categories attached to a visit — used to route the "your department has a
  // new ticket" notification to only the modalities that actually have work on it.
  async findTestCategoriesForVisit(visitId) {
    const queryText = `
      SELECT DISTINCT tc.name AS category_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE vt.patient_visit_id = $1
    `;
    const result = await db.query(queryText, [visitId]);
    return result.rows.map((r) => r.category_name);
  }

  // True once no test on the visit is still outstanding — lets the last result release close
  // the visit out instead of leaving it in 'Processing' forever.
  async hasOutstandingTests(visitId) {
    const queryText = `
      SELECT 1 FROM visit_tests
      WHERE patient_visit_id = $1
        AND status NOT IN ('Completed', 'Cancelled')
      LIMIT 1
    `;
    const result = await db.query(queryText, [visitId]);
    return result.rows.length > 0;
  }

  /**
   * Issues the next queue number for today, atomically.
   *
   * This used to be `SELECT COUNT(*) … WHERE created_at::date = CURRENT_DATE` followed by a
   * separate INSERT of count+1, which fails in two ways that only appear once the clinic is
   * actually busy. Two receptionists registering at the same moment both read the same count and
   * both issue the same ticket. And because it counted rows rather than issuances, cancelling a
   * visit rewound the sequence and reissued a number already handed out.
   *
   * ON CONFLICT DO UPDATE takes a row lock on the day's counter, so concurrent callers serialise
   * and get distinct numbers from a single round trip. See migrateDataIntegrity.js [1.13.0]; a
   * unique index on (visit date, queue_number) backs the invariant at the schema level.
   */
  /**
   * A visit of this patient's already waiting in today's queue and not yet paid. [1.124.0]
   * The Desk refuses a second one on screen; this is the same rule for every caller.
   */
  async findUnpaidWaitingToday(patientId) {
    const { rows } = await db.query(
      `SELECT pv.id, pv.queue_number FROM patient_visits pv
        WHERE pv.patient_id = $1 AND ${inTodaysQueue('pv')} AND pv.status = 'Pending'
          AND NOT EXISTS (SELECT 1 FROM payments pay
                           WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid')
        ORDER BY pv.created_at LIMIT 1`,
      [patientId]
    );
    return rows[0];
  }

  async getNextQueueNumber(client = db) {
    const queryText = `
      INSERT INTO daily_counters (counter_date, counter_name, last_number)
      VALUES (CURRENT_DATE, 'queue', 1)
      ON CONFLICT (counter_date, counter_name)
      DO UPDATE SET last_number = daily_counters.last_number + 1
      RETURNING last_number
    `;
    const result = await client.query(queryText);
    return String(result.rows[0].last_number).padStart(4, '0');
  }

  /**
   * Puts a checked-in booking into today's queue. [1.92.0]
   *
   * Stamps the visit with the moment the patient arrived and gives it today's next ticket. A
   * booking holds no ticket until then (constants/queueMembership.js), and the time it was MADE
   * stays on the appointment row. Called inside the check-in's transaction: the row lock keeps two
   * check-ins from issuing two tickets, and only a Pending visit moves, so one already released,
   * finished or cancelled keeps what it has and no number is spent on it.
   *
   * @returns {Promise<object|null>} The visit with its new ticket, or null if it did not move.
   */
  async joinTodaysQueue(visitId) {
    const { rows } = await db.query('SELECT status FROM patient_visits WHERE id = $1 FOR UPDATE', [visitId]);
    if (rows[0]?.status !== 'Pending') return null;
    const queueNumber = await this.getNextQueueNumber();
    const result = await db.query(
      `UPDATE patient_visits
          SET created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, queue_number = $2
        WHERE id = $1
        RETURNING *`,
      [visitId, queueNumber]
    );
    return result.rows[0] || null;
  }

  /**
   * How busy the clinic is right now, as COUNTS ONLY. [1.63.0]
   *
   * Backs a public endpoint, so the shape of this query is the privacy control: it selects no
   * name, no id, no queue number and nothing joinable back to a person. Two integers and a
   * timestamp. Adding a column here is a decision about what the open internet can see, and the
   * comment is placed at the SELECT because that is where somebody would add one.
   *
   * `inTodaysQueue` is findActiveVisits' own rule [1.92.0], so the public number and the
   * receptionist's KPI card cannot disagree about what "in the clinic" means.
   *
   * Half-open range on the raw column, never `created_at::date` — a B-tree cannot serve a
   * predicate on an expression, and this endpoint is unauthenticated and therefore cacheable
   * traffic that anyone can generate.
   *
   * @returns {Promise<{waiting: number, in_progress: number}>}
   */
  async countActiveForPublicStatus() {
    const queryText = `
      SELECT COUNT(*) FILTER (WHERE pv.status = 'Pending')::int    AS waiting,
             COUNT(*) FILTER (WHERE pv.status = 'Processing')::int AS in_progress
        FROM patient_visits pv
       WHERE ${inTodaysQueue('pv')}
    `;
    const result = await db.query(queryText);
    return result.rows[0] || { waiting: 0, in_progress: 0 };
  }
}

module.exports = new VisitRepository();
