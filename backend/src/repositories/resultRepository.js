const db = require('../config/database');
const { hmoEffectiveStatus } = require('../constants/hmoEffectiveStatus');

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
             -- The current version's attachment, so the entry dialog can tell a technician that a
             -- report is already on this ticket. [1.94.0] Without it the dialog can only see what
             -- is in its own form state, so re-opening a parked ticket showed an empty file input
             -- over a ticket that already had one, and a release from the row could not tell
             -- whether there was anything to release. is_critical rides along for the same reason:
             -- releasing from the row must not write a stale flag over a real one.
             tr.file_path, tr.file_original_name,
             (
               SELECT ${hmoEffectiveStatus('hr', 'hrt')}
               FROM hmo_request_tests hrt
               JOIN hmo_requests hr ON hr.id = hrt.hmo_request_id
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_approval_status
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      -- At most one row: uq_test_results_current_per_test is a partial unique index on
      -- visit_test_id WHERE is_current, so this cannot multiply the worklist.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
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
  async findReleasedByCategory(categoryName, { days = 90, delivery = null, search = null, limit = 200, offset = 0 } = {}) {
    // Half-open range on the raw column so idx_test_results_released_at applies — a ::date cast
    // here would put the planner straight back on a sequential scan. See [1.18.0].
    const windowClause =
      days > 0 ? `AND tr.released_at >= (CURRENT_DATE - $2::int * INTERVAL '1 day')` : '';

    /**
     * Reports the patient has not been told about. [1.59.0]
     *
     * This is the reader idx_test_results_undelivered exists for, and the reason the column was
     * worth adding at all: a technician can find every released report that never reached anyone
     * instead of scanning the list by eye. It matters most after a mail outage, when the failures
     * are a contiguous block nobody has any other way to identify.
     *
     * `sent` deliberately does NOT mean "has an address" — it means a send was recorded. A report
     * to a patient with an email that failed at release belongs in `unsent`, which is exactly the
     * pile someone needs to work through.
     */
    const deliveryClause =
      delivery === 'unsent' ? 'AND tr.emailed_at IS NULL'
        : delivery === 'sent' ? 'AND tr.emailed_at IS NOT NULL'
          : '';
    const params = [categoryName];
    if (days > 0) params.push(days);

    // [1.128.0] A search runs at the server once History pages there: filtering the page in hand
    // would only ever search ten rows. Patient name (either order), test, or queue ticket.
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      searchClause = `AND ((p.first_name || ' ' || p.last_name) ILIKE $${i}
                        OR (p.last_name || ' ' || p.first_name) ILIKE $${i}
                        OR t.name ILIKE $${i}
                        OR pv.queue_number ILIKE $${i})`;
    }
    params.push(limit, offset);

    const queryText = `
      SELECT vt.id as visit_test_id, vt.status as test_status,
             t.name as test_name, tc.name as category_name,
             pv.id as visit_id, pv.queue_number,
             -- The demographics a diagnostic report has to carry. [1.54.0] Age and sex decide the
             -- reference range a clinician reads the findings against, and the visit date is the
             -- date the examination was PERFORMED, which is not the date it was released. A report
             -- naming none of them is a page of findings that cannot be attributed to anyone.
             pv.created_at as visit_date,
             pv.referring_physician, pv.referring_physician_prc,
             p.id as patient_id, p.first_name, p.last_name, p.birthdate, p.sex,
             -- The report's "Patient Type" line, and the key its measurements hang from. [1.90.0]
             -- Without them the report opened from History printed a blank patient type and none
             -- of the values a laboratory or ultrasound form carries.
             pt.name as patient_type_name, tr.id as result_id,
             tr.findings, tr.remarks as result_remarks, tr.file_path, tr.file_original_name,
             tr.released_at,
             tr.version,
             -- Whether this report actually reached the patient. [1.59.0] Without it the history
             -- can say a result was released and cannot say whether anyone was told, which is
             -- the question the technician is asked when a patient rings up.
             tr.emailed_at, tr.emailed_to, tr.email_count,
             -- The address the report WOULD go to on a re-send, so the screen can offer the
             -- action honestly rather than discovering there is no email after the click.
             -- Resolved the same way the send resolves it — see findPatientEmailByVisitTestId.
             -- Two different answers here and there is a button that promises one address and
             -- uses another.
             COALESCE(NULLIF(p.email, ''), pu.email) as patient_email,
             u.first_name as released_by_first_name, u.last_name as released_by_last_name,
             -- Every row that matched, before LIMIT, so a paged screen can say how many there are.
             COUNT(*) OVER()::int AS total_count
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN patient_types pt ON pt.id = p.patient_type_id
      -- A walk-in has no account, so this is a LEFT join; p.email then supplies the address.
      LEFT JOIN users pu ON p.user_id = pu.id
      -- is_current: a test can now carry several versions, and joining them all would repeat
      -- the row once per amendment and show superseded findings alongside the live ones.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tc.name = $1
        AND vt.status = 'Completed'
        ${windowClause}
        ${deliveryClause}
        ${searchClause}
      ORDER BY tr.released_at DESC NULLS LAST, pv.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async createResult({ visitTestId, filePath, fileOriginalName, fileMimeType, fileSizeBytes, findings, remarks, releasedBy, amendmentReason }) {
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
           version, is_current, amendment_reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, TRUE, $10)
         RETURNING *`,
        [
          visitTestId, filePath || null, fileOriginalName || null,
          fileMimeType || null, fileSizeBytes || null, findings, remarks, releasedBy,
          previous ? previous.version + 1 : 1,
          // Only meaningful on an amendment; the first version has nothing to explain.
          previous ? (amendmentReason || null) : null,
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
             -- Which document each version carried. [1.94.0] The timeline rendered findings and
             -- nothing else, so once the report is a file every row in an amendment chain would
             -- have shown an empty expander — a history that cannot say what changed.
             tr.file_original_name, tr.file_path IS NOT NULL AS has_file,
             tr.amendment_reason,
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
   * A patient's FINAL results: each test's latest authorised report, newest visit first. [1.108.0]
   *
   * Patient Records reads this. The other history query lists every test ordered, pending ones
   * included, because the patient's portal shows a booking's progress; a records screen showing
   * "Pending" beside a name is showing work, not a record.
   *
   * The latest AUTHORISED version, not the current one: an amendment being written is current and
   * unreleased, and the record keeps the report that went out until its replacement is authorised.
   * LATERAL with LIMIT 1, so a test amended three times is still one row.
   *
   * @param {number|string} patientId
   * @param {string[]|null} allowedCategories - the caller's departments; null = all.
   */
  async findReleasedResultsByPatientId(patientId, allowedCategories = null) {
    const params = [patientId];
    let categoryFilter = '';
    if (allowedCategories) {
      params.push(allowedCategories);
      categoryFilter = `AND tc.name = ANY($${params.length}::text[])`;
    }
    const { rows } = await db.query(
      `SELECT vt.id AS visit_test_id, t.name AS test_name, tc.name AS category_name,
              pv.id AS visit_id, pv.created_at AS visit_date,
              fin.id AS result_id, fin.version, fin.authorised_at,
              (fin.file_path IS NOT NULL) AS has_file,
              fin.file_original_name, fin.file_mime_type,
              u.first_name AS released_by_first_name, u.last_name AS released_by_last_name
         FROM visit_tests vt
         JOIN tests t            ON t.id = vt.test_id
         JOIN test_categories tc ON tc.id = t.category_id
         JOIN patient_visits pv  ON pv.id = vt.patient_visit_id
         JOIN LATERAL (
              SELECT tr.id, tr.version, tr.authorised_at, tr.released_by,
                     tr.file_path, tr.file_original_name, tr.file_mime_type
                FROM test_results tr
               WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL
               ORDER BY tr.version DESC
               LIMIT 1
         ) fin ON TRUE
         LEFT JOIN users u ON u.id = fin.released_by
        WHERE pv.patient_id = $1
        ${categoryFilter}
        ORDER BY pv.created_at DESC, fin.authorised_at DESC`,
      params
    );
    return rows;
  }

  async findOwnershipInfoByVisitTestId(visitTestId) {
    const queryText = `
      -- patient id as well as user_id: the PHI read audit keys on the patient, since
      -- "who accessed this patient's data?" is the question an incident asks. The names are for
      -- the audit entry's sentence, so it reads as what happened. [1.108.0]
      SELECT tc.name as category_name, p.user_id as patient_user_id, p.id as patient_id,
             t.name AS test_name, p.first_name AS patient_first_name, p.last_name AS patient_last_name
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
  async markReleased(visitTestId, releasedBy, verificationCode) {
    const queryText = `
      UPDATE test_results
      SET released_by = $2,
          authorised_at = CURRENT_TIMESTAMP,
          -- [1.126.0] The version keeps the code it was first given: a copy carrying it may
          -- already be in someone's hands.
          verification_code = COALESCE(verification_code, $3)
      -- is_current: without it this would stamp the releasing user onto every superseded
      -- version too, rewriting the attribution of reports that were authorised by someone else
      -- at an earlier time — destroying the very history versioning was added to keep.
      WHERE visit_test_id = $1 AND is_current
      RETURNING *
    `;
    const result = await db.query(queryText, [visitTestId, releasedBy, verificationCode]);
    return result.rows[0];
  }

  /**
   * The newest version of this result that was actually AUTHORISED, file columns only.
   *
   * What a patient is entitled to, as distinct from what is current. [1.94.0] Two cases make the
   * difference matter, and both only became serious once the attached document became the whole
   * report rather than a supplement to typed findings:
   *
   *   - A result recorded but not yet released is `is_current`. Serving that to the patient hands
   *     them a draft clinical report nobody has authorised.
   *   - An amendment sets the visit back to 'Waiting for Release' and makes the UNRELEASED v2
   *     current. Reading `is_current` would both serve that draft and, if simply gated on
   *     release, take away the copy they were legitimately sent while the correction is written.
   *
   * Ordering by version rather than by authorised_at: version is the chain's own sequence, while
   * authorised_at is a wall-clock time that a backdating script or a clock change can reorder.
   */
  async findLatestAuthorisedByVisitTestId(visitTestId) {
    const { rows } = await db.query(
      `SELECT id, file_path, file_original_name, file_mime_type, version, authorised_at, verification_code
         FROM test_results
        WHERE visit_test_id = $1 AND authorised_at IS NOT NULL
        ORDER BY version DESC
        LIMIT 1`,
      [visitTestId]
    );
    return rows[0] || null;
  }

  /**
   * The released report a verification code was issued for, and what has happened to it since.
   * [1.126.0] Public: the caller is whoever holds the paper, so this selects only what the
   * verification page states — never findings, remarks or the file.
   *
   * `replaced_at` is the first LATER version that was authorised: the correction that replaced
   * this report. A later draft still being written does not count; until it is released, this
   * report is still the one the clinic stands behind.
   */
  async findByVerificationCode(code) {
    const { rows } = await db.query(
      `SELECT tr.id, tr.version, tr.authorised_at,
              t.name AS test_name, tc.name AS category_name,
              p.first_name, p.last_name,
              replaced.authorised_at AS replaced_at
         FROM test_results tr
         JOIN visit_tests vt     ON vt.id = tr.visit_test_id
         JOIN tests t            ON t.id = vt.test_id
         JOIN test_categories tc ON tc.id = t.category_id
         JOIN patient_visits pv  ON pv.id = vt.patient_visit_id
         JOIN patients p         ON p.id = pv.patient_id
         LEFT JOIN LATERAL (
           SELECT n.authorised_at
             FROM test_results n
            WHERE n.visit_test_id = tr.visit_test_id
              AND n.authorised_at IS NOT NULL
              AND n.version > tr.version
            ORDER BY n.version
            LIMIT 1
         ) replaced ON TRUE
        WHERE tr.verification_code = $1 AND tr.authorised_at IS NOT NULL`,
      [code]
    );
    return rows[0] || null;
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
             t.name AS test_name, tc.name AS category_name
      FROM test_results tr
      LEFT JOIN users u ON tr.released_by = u.id
      JOIN visit_tests vt        ON vt.id = tr.visit_test_id
      JOIN tests t               ON t.id = vt.test_id
      JOIN test_categories tc    ON tc.id = t.category_id
      JOIN patient_visits pv     ON pv.id = vt.patient_visit_id
      JOIN patients p            ON p.id = pv.patient_id
      LEFT JOIN patient_types pt ON pt.id = p.patient_type_id
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
             p.birthdate, p.sex, ptp.name AS patient_type_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON p.id = pv.patient_id
      LEFT JOIN patient_types ptp ON ptp.id = p.patient_type_id
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

  /**
   * Everything the released-result email needs: who to send it to, and what the report SAYS.
   * [1.61.0]
   *
   * It used to return the address and the test name alone, because the email only announced that
   * a result existed. Now that the report itself travels, the findings, the attachment and the
   * demographics come with it — age and sex band the reference range a clinician reads the
   * findings against, and the visit date is the date the examination was PERFORMED, which is not
   * the date it was released.
   *
   * Joined on `is_current`. Without it a test with an amendment returns one row per version and
   * the email could carry superseded findings beside live ones — the general rule CLAUDE.md sets
   * out for this table, with the sharpest possible consequence.
   */
  async findPatientEmailByVisitTestId(visitTestId) {
    const queryText = `
      -- The patient record's own address first, the owning ACCOUNT's second. [1.60.0]
      --
      -- The order matters because one account owns several patient profiles — a parent booking
      -- for dependents, which is why /patients/my-profiles is plural. The account address is the
      -- right default for a dependent, since the parent is who booked; but an address typed onto
      -- one patient's record is a deliberate statement about THAT patient and wins over an
      -- inherited one.
      SELECT COALESCE(NULLIF(p.email, ''), u.email) AS email,
             p.first_name, p.last_name, p.contact_number, p.birthdate, p.sex,
             t.name as test_name, tc.name as category_name,
             pv.created_at as visit_date, pv.queue_number,
             pv.referring_physician, pv.referring_physician_prc,
             tr.findings, tr.remarks, tr.released_at, tr.version,
             tr.file_path, tr.file_original_name, tr.file_mime_type, tr.file_size_bytes,
             tr.verification_code
      FROM visit_tests vt
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /**
   * Record that the CURRENT version of a report reached the patient. [1.59.0]
   *
   * Scoped to `is_current` for the reason CLAUDE.md gives about this table generally: without it
   * an UPDATE rewrites every superseded version too, so a v1 that genuinely was emailed and a v2
   * that was not would both claim the same delivery.
   *
   * Only ever called after a send actually succeeded — `emailed_at IS NULL` has to keep meaning
   * "never reached them", with no second reading.
   */
  async recordEmailDelivery(visitTestId, address) {
    const result = await db.query(
      `UPDATE test_results
          SET emailed_at = CURRENT_TIMESTAMP,
              emailed_to = $2,
              email_count = email_count + 1
        WHERE visit_test_id = $1 AND is_current
        RETURNING id, emailed_at, emailed_to, email_count`,
      [visitTestId, address]
    );
    return result.rows[0];
  }
}

module.exports = new ResultRepository();
