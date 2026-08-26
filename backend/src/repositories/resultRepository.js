const db = require('../config/database');

class ResultRepository {
  // The modality worklist gate. This query previously filtered on vt.status alone and never
  // looked at the parent visit at all, so a ticket appeared here the instant a client picked
  // tests during online booking — before the receptionist confirmed anything, before payment,
  // and for cancelled visits too. `pv.status = 'Processing'` is the whole gate: a visit only
  // reaches that state through visitService.releaseVisitIfReady (paid + staff-confirmed).
  //
  // vt.status is correspondingly narrowed to the two states a released ticket can be in.
  // 'Pending'/'Approved' tests are by definition not released and belong to the front desk
  // and cashier only.
  /**
   * Critical results that have been released and not yet called back. [1.26.0]
   *
   * A panic value is the most time-critical thing this system holds, and the only place it
   * appeared was a badge on one department's worklist row. Nothing anywhere answered "is there a
   * patient we still have to telephone?" — so the escalation depended on the technician who
   * flagged it staying at that screen, and a critical result flagged at the end of a shift had
   * nobody watching it at all.
   *
   * Not department-scoped: whoever is free calls the patient, and a potassium of 7.4 is not the
   * Laboratory's problem to solve alone. Ordered oldest first, because that is the order they
   * become dangerous in, and it carries the contact number so the person acting on it does not
   * have to go and look it up.
   */
  async findOutstandingCriticals() {
    const queryText = `
      SELECT tr.id AS result_id, tr.visit_test_id, tr.findings, tr.released_at,
             t.name AS test_name, tc.name AS category_name,
             p.id AS patient_id, p.first_name, p.last_name, p.contact_number,
             pv.id AS visit_id, pv.queue_number,
             u.first_name AS released_by_first_name, u.last_name AS released_by_last_name
      FROM test_results tr
      JOIN visit_tests vt ON tr.visit_test_id = vt.id
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tr.is_current
        AND tr.is_critical
        AND tr.critical_acknowledged_at IS NULL
        AND tr.released_at IS NOT NULL
      ORDER BY tr.released_at ASC
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  async findPendingByCategory(categoryName) {
    const queryText = `
      SELECT vt.id as visit_test_id, vt.status as test_status, vt.price_at_time, vt.remarks,
             t.name as test_name, tc.name as category_name,
             pv.id as visit_id, pv.queue_number, pv.visit_type,
             -- How long this patient has been in the building. The worklist previously showed no
             -- waiting time at all, so a ticket could sit in a department indefinitely with
             -- nothing on screen saying so; the billing queue had this and the modalities did not.
             pv.created_at as visit_created_at,
             -- Who asked for the test. A diagnostic report goes back to this doctor, so the
             -- worklist and the report both need to be able to name them. [1.23.0]
             pv.referring_physician, pv.referring_physician_prc,
             p.id as patient_id, p.first_name, p.last_name, p.birthdate, p.sex,
             (
               SELECT hrt.approval_status
               FROM hmo_request_tests hrt
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_approval_status
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE tc.name = $1
        AND pv.status = 'Processing'
        AND vt.status IN ('Processing', 'Waiting for Release')
      ORDER BY pv.created_at ASC
    `;
    const result = await db.query(queryText, [categoryName]);
    return result.rows;
  }

  // Parent-visit release state for a single visit_test — backs the service-layer guard that
  // stops a modality acting on a ticket that was never released to them, independently of
  // whether the UI ever showed it.
  async findVisitReleaseStateByVisitTestId(visitTestId) {
    const queryText = `
      SELECT pv.id as visit_id, pv.status as visit_status, tc.name as category_name,
             vt.status as test_status
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  // UI/UX Phase 1: diagnostic staff previously had no way to review results they'd already
  // released from this app at all — the pending-worklist endpoint above only ever returns
  // Pending/Approved/Processing tests. Mirrors findPendingByCategory's shape/filtering exactly,
  // just against 'Completed' status and joined to the actual result content.
  /**
   * Released results for a department, newest first — bounded.
   *
   * This had no LIMIT and no date bound, and it selects `tr.findings` and `tr.remarks`, which are
   * unbounded TEXT. It backs the "Released" tab, which is hit on every visit to that screen. At a
   * modest 30 laboratory tests a day over 250 working days that is 7,500 rows of full clinical
   * narrative in one JSON response after a year, and 22,500 after three — for a screen that shows
   * ten at a time. The sort had no supporting index either, so it was a full scan plus an
   * external sort, every load, degrading continuously and silently.
   *
   * The window is a *default*, not a cap the caller cannot lift: a technician looking for a
   * result from four months ago passes a wider range, and the hard `LIMIT` is what keeps any
   * single response bounded regardless. Both halves matter — a date window alone still returns
   * everything inside a wide range.
   *
   * @param {string} categoryName
   * @param {{days?: number, limit?: number, offset?: number}} options
   */
  async findReleasedByCategory(categoryName, { days = 90, limit = 200, offset = 0 } = {}) {
    // Half-open range on the raw column so idx_test_results_released_at applies — a ::date cast
    // here would put the planner straight back on a sequential scan. See [1.18.0].
    const windowClause =
      days > 0 ? `AND tr.released_at >= (CURRENT_DATE - $2::int * INTERVAL '1 day')` : '';
    const params = [categoryName];
    if (days > 0) params.push(days);
    params.push(limit, offset);

    const queryText = `
      SELECT vt.id as visit_test_id, vt.status as test_status,
             t.name as test_name, tc.name as category_name,
             pv.id as visit_id, pv.queue_number,
             p.id as patient_id, p.first_name, p.last_name,
             tr.findings, tr.remarks as result_remarks, tr.file_path, tr.released_at,
             tr.version, tr.is_critical, tr.critical_acknowledged_at,
             u.first_name as released_by_first_name, u.last_name as released_by_last_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      -- is_current: a test can now carry several versions, and joining them all would repeat
      -- the row once per amendment and show superseded findings alongside the live ones.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tc.name = $1
        AND vt.status = 'Completed'
        ${windowClause}
      ORDER BY tr.released_at DESC NULLS LAST, pv.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async createResult({ visitTestId, filePath, fileOriginalName, fileMimeType, fileSizeBytes, findings, remarks, releasedBy, amendmentReason, isCritical }) {
    // Writes a NEW VERSION rather than overwriting the previous one.
    //
    // This used to be `ON CONFLICT (visit_test_id) DO UPDATE`, which overwrote findings, remarks
    // and file metadata in place. A radiology report already issued to a patient could therefore
    // be silently rewritten, with nothing anywhere recording what it originally said — and the
    // audit entry noted only *that* a correction happened, never what changed. For a diagnostic
    // report that is indefensible: the patient may have acted on the first version, and a
    // referring physician certainly may have.
    //
    // Each save supersedes the current row and inserts the next version, so the chain is walkable
    // in both directions (superseded_by forwards, version backwards). The partial unique index
    // uq_test_results_current_per_test keeps "exactly one current result per test" true, which is
    // the invariant the old UNIQUE was really protecting — so every reader that expects a single
    // row still gets one, as long as it filters on is_current. They all do.
    //
    // Runs inside a transaction because superseding and inserting must not come apart: a failure
    // between them would leave a test with NO current result, which reads as "findings never
    // recorded" and is worse than either version winning.
    //
    // Phase B: file_path/file_original_name/file_mime_type/file_size_bytes back a real uploaded
    // file, streamed through an authenticated, ownership-checked route. [1.31.0] The legacy URL
    // column that used to sit beside them is gone — superseded when result files stopped being
    // served statically, and populated in no row anywhere by the time it was removed.
    return await db.withTransaction(async () => {
      const previous = (
        await db.query(
          `SELECT id, version FROM test_results
           WHERE visit_test_id = $1 AND is_current
           FOR UPDATE`,
          [visitTestId]
        )
      ).rows[0];

      if (previous) {
        await db.query(
          `UPDATE test_results SET is_current = FALSE WHERE id = $1`,
          [previous.id]
        );
      }

      const inserted = await db.query(
        `INSERT INTO test_results (
           visit_test_id, file_path, file_original_name, file_mime_type, file_size_bytes,
           findings, remarks, released_by, recorded_by,
           version, is_current, amendment_reason, is_critical
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, TRUE, $10, $11)
         RETURNING *`,
        [
          visitTestId, filePath || null, fileOriginalName || null,
          fileMimeType || null, fileSizeBytes || null, findings, remarks, releasedBy,
          previous ? previous.version + 1 : 1,
          // Only meaningful on an amendment; the first version has nothing to explain.
          previous ? (amendmentReason || null) : null,
          Boolean(isCritical),
        ]
      );
      const current = inserted.rows[0];

      // Point the old version at its replacement, so the history reads forwards as well as
      // backwards. Done after the insert because it needs the new row's id.
      if (previous) {
        await db.query(`UPDATE test_results SET superseded_by = $2 WHERE id = $1`, [
          previous.id,
          current.id,
        ]);
      }

      return current;
    });
  }

  /**
   * Every version of a test's result, newest first — the amendment history.
   *
   * Exists so a corrected report can be read alongside what it replaced. Without it the version
   * rows would be written and never surfaced, which is the same as not keeping them.
   */
  async findVersionHistoryByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tr.id, tr.version, tr.is_current, tr.findings, tr.remarks,
             tr.amendment_reason, tr.is_critical,
             tr.released_at, tr.authorised_at, tr.superseded_by,
             rec.first_name AS recorded_by_first_name, rec.last_name AS recorded_by_last_name,
             rel.first_name AS released_by_first_name,  rel.last_name AS released_by_last_name
      FROM test_results tr
      LEFT JOIN users rec ON tr.recorded_by = rec.id
      LEFT JOIN users rel ON tr.released_by = rel.id
      WHERE tr.visit_test_id = $1
      ORDER BY tr.version DESC
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows;
  }

  /**
   * Records that a critical result was actually communicated to someone.
   *
   * The flag is the cheap half. What matters medico-legally is the evidence that a human picked
   * up a phone and told a named person at a recorded time, which is what this stores.
   */
  async acknowledgeCritical(visitTestId, { acknowledgedBy, note }) {
    const queryText = `
      UPDATE test_results
      SET critical_acknowledged_at = CURRENT_TIMESTAMP,
          critical_acknowledged_by = $2,
          critical_acknowledgement_note = $3
      WHERE visit_test_id = $1 AND is_current AND is_critical
      RETURNING *
    `;
    const result = await db.query(queryText, [visitTestId, acknowledgedBy, note || null]);
    return result.rows[0];
  }

  // Phase B: single query backing the download route's ownership check — needs both the
  // patient's user_id (Client-ownership check) and the test's category (staff-department check),
  // matching the two branches assertStaffOwnsVisitTest/getPatientHistory already use elsewhere.
  async findOwnershipInfoByVisitTestId(visitTestId) {
    const queryText = `
      -- patient id as well as user_id: the PHI read audit keys on the patient, since
      -- "who accessed this patient's data?" is the question an incident asks.
      SELECT tc.name as category_name, p.user_id as patient_user_id, p.id as patient_id
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /**
   * Records WHO authorised the release, at the moment they authorise it.
   *
   * This step existed in the service and the controller — releaseResult() was handed the
   * releasing user's id — but nothing ever persisted it. The ticket flipped to 'Completed' and
   * the actor was dropped, leaving released_by holding whoever had typed the findings.
   */
  async markReleased(visitTestId, releasedBy) {
    const queryText = `
      UPDATE test_results
      SET released_by = $2,
          authorised_at = CURRENT_TIMESTAMP
      -- is_current: without it this would stamp the releasing user onto every superseded
      -- version too, rewriting the attribution of reports that were authorised by someone else
      -- at an earlier time — destroying the very history versioning was added to keep.
      WHERE visit_test_id = $1 AND is_current
      RETURNING *
    `;
    const result = await db.query(queryText, [visitTestId, releasedBy]);
    return result.rows[0];
  }

  async findResultByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tr.*, u.first_name as released_by_first_name, u.last_name as released_by_last_name,
             -- Everything the printed form's header block asks for. [1.52.0] The clinic's own
             -- sheet prints Name / Birthday / Sex on the left and Date / Patient Type / Physician
             -- on the right, and a report that leaves half of them blank is not their document.
             -- Aliased. A bare first_name on a result row used to mean the releasing user; since
             -- [1.52.0] widened this query it means the patient, and every caller spreading the
             -- result inherits that silently. Naming it removes the trap. [1.53.0]
             p.first_name AS patient_first_name, p.last_name AS patient_last_name,
             p.first_name, p.last_name, p.birthdate, p.sex,
             pt.name AS patient_type_name,
             pv.created_at AS visit_date, pv.referring_physician, pv.referring_physician_prc,
             t.name AS test_name, tc.name AS category_name,
             -- The discipline heading the form prints above its panel, e.g. CLINICAL MICROSCOPY.
             fs.discipline
      FROM test_results tr
      LEFT JOIN users u ON tr.released_by = u.id
      JOIN visit_tests vt        ON vt.id = tr.visit_test_id
      JOIN tests t               ON t.id = vt.test_id
      JOIN test_categories tc    ON tc.id = t.category_id
      JOIN patient_visits pv     ON pv.id = vt.patient_visit_id
      JOIN patients p            ON p.id = pv.patient_id
      LEFT JOIN patient_types pt ON pt.id = p.patient_type_id
      -- A test with no field set has no discipline; LEFT so the row survives either way.
      LEFT JOIN result_field_set_tests fst ON fst.test_id = vt.test_id
      LEFT JOIN result_field_sets fs       ON fs.id = fst.field_set_id AND fs.is_active = TRUE
      -- The live version. Callers here mean "the result", not "some past draft of it";
      -- findVersionHistoryByVisitTestId is the way to reach superseded versions.
      WHERE tr.visit_test_id = $1 AND tr.is_current
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /**
   * @param {number|string} patientId
   * @param {string[]|null} allowedCategories - restrict to these test categories; null = all.
   *   Applied in SQL so results the caller may not see are never read, rather than fetched and
   *   filtered afterwards.
   */
  async findResultsByPatientId(patientId, allowedCategories = null) {
    const params = [patientId];
    let categoryFilter = '';
    if (allowedCategories) {
      // An empty array is meaningful: a role mapped to no categories sees nothing, rather than
      // falling through to everything. `= ANY('{}')` is false for every row, which is correct.
      params.push(allowedCategories);
      categoryFilter = `AND tc.name = ANY($${params.length}::text[])`;
    }

    const queryText = `
      SELECT vt.id as visit_test_id, vt.price_at_time, vt.status as test_status,
             t.name as test_name, tc.name as category_name,
             pv.created_at as visit_date, pv.queue_number,
             -- The report names the doctor who asked for the test, because it is a document
             -- addressed to them as much as to the patient. [1.23.0]
             pv.referring_physician, pv.referring_physician_prc,
             tr.id as result_id, tr.findings, tr.remarks as result_remarks,
             tr.file_path, tr.file_original_name, tr.released_at,
             u.first_name as released_by_first_name, u.last_name as released_by_last_name,
             -- The printed header block. [1.53.0] The patient's copy and the clinic's copy are the
             -- same document by requirement, and this query fed the patient's — so without these
             -- their copy printed Birthday, Sex and Patient Type blank and carried no title at all,
             -- while the clinic's showed all four.
             p.birthdate, p.sex, ptp.name AS patient_type_name, fs.discipline
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON p.id = pv.patient_id
      LEFT JOIN patient_types ptp ON ptp.id = p.patient_type_id
      -- 1:1 by uq_fst_test, so neither join can multiply a row. is_active matches
      -- findFieldSetForVisitTest: a deactivated set must stop printing its heading too.
      LEFT JOIN result_field_set_tests fst ON fst.test_id = vt.test_id
      LEFT JOIN result_field_sets fs ON fs.id = fst.field_set_id AND fs.is_active = TRUE
      -- is_current: a test can now carry several versions, and joining them all would repeat
      -- the row once per amendment and show superseded findings alongside the live ones.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE pv.patient_id = $1
      ${categoryFilter}
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async findPatientEmailByVisitTestId(visitTestId) {
    const queryText = `
      -- contact_number is here for the critical-result callback: the staff member who has to
      -- telephone the patient should not have to go and look it up while a panic value is
      -- sitting unactioned. Recipients of that notification (Receptionist/Admin/SuperAdmin) are
      -- already entitled to patient contact details.
      SELECT u.email, p.first_name, p.last_name, p.contact_number, t.name as test_name
      FROM visit_tests vt
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      JOIN tests t ON vt.test_id = t.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }
}

module.exports = new ResultRepository();
