const db = require('../config/database');
const { hmoEffectiveStatus } = require('../constants/hmoEffectiveStatus');

/**
 * What a patient's record holds that is FINAL: tests with an authorised report. [1.108.0] And
 * [1.130.0] X-ray exams marked done, which issue no report here ([1.129.0]) and had dropped out of
 * the record altogether. Counted apart (`done_count`), so `released_count` still means reports.
 *
 * `authorised_at`, never `released_at`: released_at defaults to CURRENT_TIMESTAMP when a result is
 * SAVED, so `released_at IS NOT NULL` counted every draft as released. An amendment still being
 * written leaves its earlier authorised version standing, so it keeps counting. Confined to the
 * caller's departments when they are scoped, so the count matches the list it opens.
 */
function releasedColumns(deptRef) {
  const inDept = deptRef
    ? `JOIN tests t ON t.id = vt.test_id
          JOIN test_categories tc ON tc.id = t.category_id
          WHERE pv.patient_id = p.id AND tc.name = ANY(${deptRef}::text[])`
    : 'WHERE pv.patient_id = p.id';
  return `(
          SELECT COUNT(*) FROM visit_tests vt
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          ${inDept}
            AND EXISTS (SELECT 1 FROM test_results tr
                         WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL)
        ) as released_count,
        -- When the last report was authorised: a different day from the last visit, and the one
        -- that answers "have they had their results yet".
        (
          SELECT MAX(tr.authorised_at) FROM test_results tr
          JOIN visit_tests vt    ON vt.id = tr.visit_test_id
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          ${inDept}
        ) as last_released_at,
        -- Exams marked done with no report here (X-ray). One with an old released report is
        -- already counted above.
        (
          SELECT COUNT(*) FROM visit_tests vt
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          ${inDept}
            AND vt.performed_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM test_results tr
                             WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL)
        ) as done_count,
        (
          SELECT MAX(vt.performed_at) FROM visit_tests vt
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          ${inDept}
        ) as last_done_at`;
}

class PatientRepository {
  async createPatient({ userId, patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact, email = null }) {
    const queryText = `
      INSERT INTO patients (user_id, patient_type_id, first_name, last_name, birthdate, sex, address, contact_number, emergency_contact, email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      userId || null,
      patientTypeId,
      firstName,
      lastName,
      birthdate,
      sex,
      address,
      contactNumber,
      emergencyContact,
      email
    ]);
    return result.rows[0];
  }

  /**
   * A record already on file for this name and birthdate, if any. [1.129.0] Names compared without
   * case or extra spaces; archived records are left out (they are not offered at the Desk).
   */
  async findSameNameAndBirthdate(firstName, lastName, birthdate) {
    const { rows } = await db.query(
      // birthdate as text: a DATE reaches the browser as a UTC timestamp, which in Philippine time
      // is the day before, and this one is shown to the desk as "born <date>".
      `SELECT p.id, p.first_name, p.last_name, p.birthdate::text AS birthdate, p.contact_number,
              pt.name AS patient_type_name
         FROM patients p
         LEFT JOIN patient_types pt ON pt.id = p.patient_type_id
        WHERE lower(regexp_replace(trim(p.first_name), '\\s+', ' ', 'g')) = lower($1)
          AND lower(regexp_replace(trim(p.last_name), '\\s+', ' ', 'g')) = lower($2)
          AND p.birthdate = $3::date
          AND p.archived_at IS NULL
        ORDER BY p.id
        LIMIT 1`,
      [firstName, lastName, birthdate]
    );
    return rows[0] || null;
  }

  /** The name of a patient type, or null when no such type exists. [1.129.0] */
  async findPatientTypeName(patientTypeId) {
    const { rows } = await db.query('SELECT name FROM patient_types WHERE id = $1', [patientTypeId]);
    return rows[0]?.name || null;
  }

  async findPatientsByUserId(userId) {
    const queryText = `
      SELECT p.*, pt.name as patient_type_name,
             -- A record the clinic put in this account by invitation, rather than a profile the
             -- account added itself. [1.136.0] Keyed on who accepted, so a record unlinked and
             -- accepted by another account is "from the clinic" only for the one holding it now.
             EXISTS (SELECT 1 FROM patient_invitations i
                      WHERE i.patient_id = p.id AND i.accepted_at IS NOT NULL
                        AND i.accepted_by = p.user_id) AS from_clinic
      FROM patients p
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE p.user_id = $1
      ORDER BY p.last_name, p.first_name
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  async findPatientById(id) {
    const queryText = `
      SELECT p.*, pt.name as patient_type_name
      FROM patients p
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE p.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  /**
   * What is still open for a patient, which archiving must not hide. [1.123.0]
   *   in_progress   a visit being worked on (Processing: paid, results not all released)
   *   unpaid_today  a walk-in opened today and not yet paid
   *   next_booking  the first booking from today on that still holds its slot
   * An unpaid walk-in left over from an earlier day is not counted: it would block archiving for
   * good, over a visit nobody is coming back to.
   */
  async findOpenWork(patientId) {
    const { rows } = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM patient_visits pv
                  WHERE pv.patient_id = $1 AND pv.status = 'Processing') AS in_progress,
         EXISTS (SELECT 1 FROM patient_visits pv
                  WHERE pv.patient_id = $1 AND pv.status = 'Pending'
                    AND pv.created_at >= CURRENT_DATE AND pv.created_at < CURRENT_DATE + 1
                    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_visit_id = pv.id)) AS unpaid_today,
         (SELECT TO_CHAR(MIN(a.scheduled_date), 'YYYY-MM-DD')
            FROM appointments a JOIN patient_visits pv ON pv.id = a.patient_visit_id
           WHERE pv.patient_id = $1 AND a.status IN ('Pending', 'Confirmed')
             AND a.scheduled_date >= CURRENT_DATE
             AND (a.held_until IS NULL OR a.held_until > CURRENT_TIMESTAMP)) AS next_booking,
         -- [1.136.0] Unlinking also asks after money and claims the account holder is part of:
         -- a proof of payment they sent that nobody has checked, and an HMO decision still owed.
         EXISTS (SELECT 1 FROM payment_submissions ps JOIN patient_visits pv ON pv.id = ps.patient_visit_id
                  WHERE pv.patient_id = $1 AND ps.status = 'Pending') AS pending_proof,
         EXISTS (SELECT 1 FROM hmo_request_tests hrt
                   JOIN visit_tests vt ON vt.id = hrt.visit_test_id
                   JOIN patient_visits pv ON pv.id = vt.patient_visit_id
                   JOIN hmo_requests hr ON hr.id = hrt.hmo_request_id
                  WHERE pv.patient_id = $1 AND ${hmoEffectiveStatus('hr', 'hrt')} = 'Pending') AS pending_hmo`,
      [patientId]
    );
    return rows[0];
  }

  /**
   * Connect a record to a patient's portal account. Only a record not yet connected. [1.123.0]
   * [1.136.0] With what the account holder is to the patient, from the accepted invitation.
   */
  async linkToUser(patientId, userId, relationship = null) {
    const { rows } = await db.query(
      `UPDATE patients SET user_id = $2, account_relationship = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id IS NULL AND archived_at IS NULL
        RETURNING *`,
      [patientId, userId, relationship]
    );
    return rows[0];
  }

  /**
   * Take a record out of the account holding it. [1.136.0] Only from the account the caller saw,
   * so an unlink can never undo a link made in the meantime. Stamps who and when, for the
   * two-person rule; `clearEmail` also removes the record's own address.
   */
  async unlinkFromUser(patientId, expectedUserId, { actorId, clearEmail = false }) {
    const { rows } = await db.query(
      `UPDATE patients
          SET user_id = NULL, account_relationship = NULL,
              account_unlinked_at = CURRENT_TIMESTAMP, account_unlinked_by = $3,
              email = CASE WHEN $4::boolean THEN NULL ELSE email END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [patientId, expectedUserId, actorId, clearEmail]
    );
    return rows[0];
  }

  /**
   * One patient record as the portal-access screen needs it: the birthdate as a calendar date
   * (never a UTC instant), and the account holding it, if any. [1.136.0]
   */
  async findForPortalAccess(patientId) {
    const { rows } = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.birthdate::text AS birthdate, p.email, p.user_id,
              p.archived_at, p.account_relationship, p.account_unlinked_at, p.account_unlinked_by,
              u.email AS account_email, u.first_name AS account_first_name, u.last_name AS account_last_name
         FROM patients p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = $1`,
      [patientId]
    );
    return rows[0] || null;
  }

  /** Profiles an account already holds with this name and birthdate. Same normalising as below. */
  async findSameNameAndBirthdateForUser(userId, firstName, lastName, birthdate) {
    const { rows } = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.birthdate::text AS birthdate
         FROM patients p
        WHERE p.user_id = $1
          AND lower(regexp_replace(trim(p.first_name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
          AND lower(regexp_replace(trim(p.last_name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($3), '\\s+', ' ', 'g'))
          AND p.birthdate = $4::date
        ORDER BY p.id
        LIMIT 1`,
      [userId, firstName, lastName, birthdate]
    );
    return rows[0] || null;
  }

  /** Give a record with no address of its own this one. Never overwrites one already on file. */
  async setEmailIfEmpty(patientId, email) {
    const { rowCount } = await db.query(
      `UPDATE patients SET email = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND (email IS NULL OR email = '')`,
      [patientId, email]
    );
    return rowCount === 1;
  }

  /** How many profiles the account at this address holds, for the desk's "is it really theirs?". */
  async countProfilesForAccountEmail(email) {
    const { rows } = await db.query(
      `SELECT COUNT(p.id)::int AS n
         FROM users u JOIN patients p ON p.user_id = u.id
        WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );
    return rows[0].n;
  }

  async updatePatient(id, { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact, email = null }) {
    const queryText = `
      UPDATE patients
      SET patient_type_id = $1, first_name = $2, last_name = $3, birthdate = $4, sex = $5, address = $6, contact_number = $7, emergency_contact = $8, email = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientTypeId,
      firstName,
      lastName,
      birthdate,
      sex,
      address,
      contactNumber,
      emergencyContact,
      email,
      id
    ]);
    return result.rows[0];
  }

  // Feature Gap Plan Phase D: Reception's walk-in lookup previously showed name/type/demographics
  // only — zero visit history or financial context, so a returning patient's unpaid balance from
  // a prior visit was invisible at check-in. unpaid_visit_count treats a visit as unpaid when it
  // isn't Cancelled and has no 'Paid' payment row, rather than reproducing getBillingSummary's
  // full per-test HMO-aware total here just to flag "does this patient owe anything."
  /**
   * Roster search, optionally confined to the caller's own departments. [1.21.0]
   *
   * `departments` is `null` for anyone holding `patients:read_all_departments` — Reception, the
   * Cashier, Admin, SuperAdmin, or an individual granted it — and an array of category names for
   * everyone else. An array means: only patients who have actually had work in one of those
   * departments.
   *
   * Before this the search was unconditional, so any diagnostic account could type two letters
   * and page through the entire patient roster of a clinic they see one room of. The name match
   * was already the whole of the access control, and a name match is not an access control.
   *
   * The department predicate is an EXISTS rather than a JOIN so a patient with six lab tests
   * still comes back once; a JOIN here would multiply the row by their test count and the LIMIT
   * would then cut the result set at an arbitrary point mid-patient.
   */
  /**
   * The patient roster: browse it, search it, filter it by when they were last here. [1.56.0]
   *
   * `query` is OPTIONAL now. It used to be required, so the screen opened on "search for a patient
   * to begin" and there was no way to simply look at the records — which is what somebody sitting
   * down to review them actually wants. With no query this returns the most recently seen
   * patients, which is the useful default: a clinic's live roster is the people who have been in.
   *
   * Paged at the SERVER. The old form had a bare LIMIT 20 with no offset and no total, so the 21st
   * match was unreachable by any means — for a clinic of any age that is most of the roster.
   *
   * ── The counts, and why they are subqueries ─────────────────────────────────────────────────
   *
   * Every aggregate is a correlated subquery rather than a JOIN, for the reason the original
   * comment gives and which still applies: a JOIN multiplies the patient row by their visit or
   * test count, and the LIMIT then cuts the page at an arbitrary point mid-patient. One row per
   * patient is the whole contract of this query.
   *
   * `archived_at IS NULL` unless asked otherwise. Archiving exists to take a record out of the
   * roster the front desk searches all day; a filter that ignored it would defeat the feature.
   *
   * `includeResults` is false for a caller who may not read results [1.108.0] — the front desk and
   * the till recognise a returning patient by who they are and when they were last here, and are
   * not sent even a count of what their reports say. The columns are left out of the SELECT rather
   * than nulled, so a screen cannot mistake "not yours to see" for "none".
   */
  async findPatients({
    query = null,
    departments = null,
    from = null,
    to = null,
    includeArchived = false,
    includeResults = true,
    limit = 20,
    offset = 0,
  } = {}) {
    const scoped = Array.isArray(departments);
    const params = [];
    const where = [];

    if (query) {
      params.push(`%${query}%`);
      const n = params.length;
      where.push(`(
             (p.first_name || ' ' || p.last_name) ILIKE $${n}
          OR p.first_name ILIKE $${n}
          OR p.last_name ILIKE $${n}
          OR p.contact_number ILIKE $${n}
      )`);
    }

    // The department filter's placeholder, reused by the result counts below so a technician's
    // count is of THEIR department's reports — the same set their records list opens. [1.108.0]
    let deptRef = null;
    if (scoped) {
      params.push(departments);
      deptRef = `$${params.length}`;
      where.push(`EXISTS (
              SELECT 1
                FROM patient_visits pv
                JOIN visit_tests vt     ON vt.patient_visit_id = pv.id
                JOIN tests t            ON t.id = vt.test_id
                JOIN test_categories tc ON tc.id = t.category_id
               WHERE pv.patient_id = p.id
                 AND tc.name = ANY($${params.length}::text[])
            )`);
    }

    // Half-open range on the raw column, never `created_at::date` — a B-tree cannot serve a
    // predicate on an expression. See CLAUDE.md. Filters on WHEN THEY WERE LAST HERE, because
    // "show me this month's patients" means their visits, not the day the record was typed.
    if (from && to) {
      params.push(from, to);
      const a = params.length - 1;
      where.push(`EXISTS (
              SELECT 1 FROM patient_visits pv
               WHERE pv.patient_id = p.id
                 AND pv.created_at >= $${a}::date AND pv.created_at < ($${a + 1}::date + 1)
            )`);
    }

    if (!includeArchived) where.push('p.archived_at IS NULL');

    const whereText = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM patients p ${whereText}`,
      params
    );

    params.push(limit, offset);
    const queryText = `
      SELECT p.*, pt.name as patient_type_name,
        archiver.first_name AS archived_by_first_name,
        archiver.last_name  AS archived_by_last_name,
        (SELECT COUNT(*) FROM patient_visits pv WHERE pv.patient_id = p.id) as visit_count,
        (SELECT MAX(pv.created_at) FROM patient_visits pv WHERE pv.patient_id = p.id) as last_visit_at,
        (
          SELECT COUNT(*) FROM patient_visits pv
          WHERE pv.patient_id = p.id AND pv.status != 'Cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM payments pay
              WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
            )
        ) as unpaid_visit_count,
        (
          SELECT COUNT(*) FROM visit_tests vt
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          WHERE pv.patient_id = p.id
        ) as test_count${includeResults ? `,
        ${releasedColumns(deptRef)}` : ''}
      FROM patients p
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN users archiver ON archiver.id = p.archived_by
      ${whereText}
      -- Most recently seen first when browsing: a roster is read newest-first, and a patient with
      -- no visits yet sorts last rather than disappearing.
      ORDER BY last_visit_at DESC NULLS LAST, p.last_name, p.first_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const result = await db.query(queryText, params);
    return { patients: result.rows, total: countResult.rows[0].total };
  }

  /**
   * Archive or restore one record. [1.56.0]
   *
   * One method for both directions: they are the same edit to the same pair of columns, and
   * splitting them invites the two halves to disagree about what "archived" means.
   */
  async setPatientArchived(patientId, { archived, actorId }) {
    const result = await db.query(
      `UPDATE patients
          SET archived_at = ${archived ? 'CURRENT_TIMESTAMP' : 'NULL'},
              archived_by = ${archived ? '$2' : 'NULL'},
              updated_at  = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      archived ? [patientId, actorId] : [patientId]
    );
    return result.rows[0];
  }

  /** Whether this patient has had any work in one of `departments`. Used to gate opening a record. */
  async patientHasWorkInDepartments(patientId, departments) {
    const result = await db.query(
      `SELECT EXISTS (
         SELECT 1
           FROM patient_visits pv
           JOIN visit_tests vt     ON vt.patient_visit_id = pv.id
           JOIN tests t            ON t.id = vt.test_id
           JOIN test_categories tc ON tc.id = t.category_id
          WHERE pv.patient_id = $1
            AND tc.name = ANY($2::text[])
       ) AS covered`,
      [patientId, departments]
    );
    return result.rows[0].covered;
  }

  async findPatientTypes() {
    const queryText = 'SELECT id, name FROM patient_types ORDER BY id';
    const result = await db.query(queryText);
    return result.rows;
  }
}

module.exports = new PatientRepository();
