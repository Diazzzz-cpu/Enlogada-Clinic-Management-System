const db = require('../config/database');

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

  async findPatientsByUserId(userId) {
    const queryText = `
      SELECT p.*, pt.name as patient_type_name
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
   */
  async findPatients({
    query = null,
    departments = null,
    from = null,
    to = null,
    includeArchived = false,
    recordStatus = null,
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

    if (scoped) {
      params.push(departments);
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

    /**
     * Whether the patient's record is FINISHED. [1.59.0]
     *
     * "Complete" means all three at once: they have been in, every test on every visit has been
     * seen through, and nothing is left unsettled. That is what somebody means when they sit down
     * to review records rather than to look a patient up.
     *
     * A filter and not the default, deliberately. This roster is also how the front desk finds a
     * patient to correct a misspelt surname, how a record gets archived, and how a technician
     * checks whose result they are holding — and every one of those has to reach the patient who
     * is in the building right now, mid-visit, with an unpaid bill. Defaulting to complete-only
     * would make the screen unable to find exactly the people the clinic is currently treating.
     *
     * Applied to the COUNT as well as the list, so the total describes what is being shown.
     */
    if (recordStatus === 'complete') {
      where.push(`(
              EXISTS (SELECT 1 FROM patient_visits pv
                        JOIN visit_tests vt ON vt.patient_visit_id = pv.id
                       WHERE pv.patient_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM patient_visits pv
                            JOIN visit_tests vt ON vt.patient_visit_id = pv.id
                           WHERE pv.patient_id = p.id
                             AND vt.status NOT IN ('Completed', 'Cancelled'))
          AND NOT EXISTS (SELECT 1 FROM patient_visits pv
                           WHERE pv.patient_id = p.id
                             AND pv.status <> 'Cancelled'
                             AND NOT EXISTS (SELECT 1 FROM payments pay
                                              WHERE pay.patient_visit_id = pv.id
                                                AND pay.payment_status = 'Paid'))
      )`);
    } else if (recordStatus === 'open') {
      // The complement, exactly — anything still owing work or money, plus a patient who has been
      // registered and not yet seen. Written as the negation of the clause above rather than as a
      // second set of conditions, so the two can never drift into overlapping or leaving a gap.
      where.push(`NOT (
              EXISTS (SELECT 1 FROM patient_visits pv
                        JOIN visit_tests vt ON vt.patient_visit_id = pv.id
                       WHERE pv.patient_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM patient_visits pv
                            JOIN visit_tests vt ON vt.patient_visit_id = pv.id
                           WHERE pv.patient_id = p.id
                             AND vt.status NOT IN ('Completed', 'Cancelled'))
          AND NOT EXISTS (SELECT 1 FROM patient_visits pv
                           WHERE pv.patient_id = p.id
                             AND pv.status <> 'Cancelled'
                             AND NOT EXISTS (SELECT 1 FROM payments pay
                                              WHERE pay.patient_visit_id = pv.id
                                                AND pay.payment_status = 'Paid'))
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
        -- What their record actually CONTAINS, which is the question a records screen is opened
        -- to answer. A visit count says they came; a released count says there is something to
        -- read. is_current so an amended report counts once rather than once per version.
        (
          SELECT COUNT(*) FROM visit_tests vt
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          WHERE pv.patient_id = p.id
        ) as test_count,
        (
          SELECT COUNT(*) FROM test_results tr
          JOIN visit_tests vt    ON vt.id = tr.visit_test_id
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          WHERE pv.patient_id = p.id AND tr.is_current AND tr.released_at IS NOT NULL
        ) as released_count,
        -- The date of the last report RELEASED, which is a different day from the last visit and
        -- the one that answers "have they had their results yet".
        (
          SELECT MAX(tr.released_at) FROM test_results tr
          JOIN visit_tests vt    ON vt.id = tr.visit_test_id
          JOIN patient_visits pv ON pv.id = vt.patient_visit_id
          WHERE pv.patient_id = p.id AND tr.is_current
        ) as last_released_at
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
