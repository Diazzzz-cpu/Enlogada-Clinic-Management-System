const fs = require('fs');
const path = require('path');
const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');
const db = require('../config/database');
const { sendEmail } = require('../config/email');
const notificationService = require('./notificationService');
const { UPLOAD_ROOT } = require('../config/upload');
const auditService = require('./auditService');
const logger = require('../config/logger');
const { digitalCopy, digitalCopyName, isMarkable } = require('../utils/digitalCopy');
const { generateCode, formatCode, stampFor } = require('../utils/verificationCode');
const env = require('../config/environment');
const {
  escapeHtml, wrapEmail, reportTable, findingsBlock, resolveReportAttachment,
} = require('./resultEmailTemplate');
const {
  DIAGNOSTIC_CATEGORIES,
  issuesReports,
  categoryLabel,
  departmentsForUser,
  userCoversCategory
} = require('../constants/modality');

// resultController's routes authorize "is this caller some kind of diagnostic staff," not
// "does this visit_test's category match their department" — confirmed live that a Laboratory
// Staff account could call e.g. POST /results/:visitTestId/release on an Xray test with no
// pushback (escalated from Module 9, see TRACEABILITY.md). This closes that gap the same way
// Client ownership is enforced elsewhere in the app: a private guard inside the service layer,
// not just client-side UI routing. SuperAdmin/Admin bypass, matching the RBAC convention used
// everywhere else (they oversee all departments).
// [1.20.0] Reads the caller's *departments* rather than deriving them from role names here.
//
// Same answer for everyone who has not been given an exception — departmentsForUser starts from
// exactly this role mapping. The difference is that a SuperAdmin can now add a modality to one
// account (cover the X-Ray room for a week) without inventing a second role, and this guard
// honours it instead of contradicting it.
function assertStaffAllowedCategory(requestingUser, categoryName) {
  const departments = requestingUser.departments ?? departmentsForUser(requestingUser);
  if (userCoversCategory(departments, categoryName)) return;

  const error = new Error('You are not authorized to act on this test category.');
  error.statusCode = 403;
  throw error;
}

/**
 * The test categories this caller may see results for, or `null` for "no restriction".
 *
 * Unrestricted means something different for each role that gets it, and both are deliberate:
 * SuperAdmin/Admin oversee every department (the same bypass assertStaffAllowedCategory grants),
 * and a Client is restricted by *patient ownership* rather than by category — they are entitled to
 * all of their own results regardless of which department produced them, and that ownership check
 * runs in resultController before this is ever consulted.
 */
function visibleCategoriesFor(requestingUser) {
  const roles = requestingUser?.roles || [];
  if (roles.includes('Client')) return null;
  // departmentsForUser already returns null for SuperAdmin/Admin, and otherwise the union of the
  // account's role-implied and directly-granted modalities.
  return requestingUser?.departments ?? departmentsForUser(requestingUser);
}

// Category ownership is only half the question. The other half — added with the ticket-release
// gating work — is whether this ticket was ever released to the modalities at all. Filtering
// findPendingByCategory on the parent visit hides un-released tickets from the worklist UI, but
// hiding is not enforcing: a visit_test id is a small integer, and any diagnostic staff token
// could previously act on one that the receptionist/cashier had not yet handed over. Both
// checks run for every state-changing modality operation.
/**
 * May this member of staff LOOK at this visit_test? Department scope only. [1.26.0]
 *
 * Split out from assertStaffOwnsVisitTest, which additionally requires the visit to be
 * 'Processing'. That release-state condition is right for a write — a technician must not record
 * findings on a ticket the cashier has not released — and wrong for a read, because a visit turns
 * 'Completed' the moment its last result goes out. Both reads were using the write guard, so the
 * technician who produced a report could no longer open it or its version history the instant the
 * visit finished: exactly when somebody rings up to query the result.
 */
async function assertStaffMayReadVisitTest(requestingUser, visitTestId) {
  if (requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin')) {
    return;
  }
  const row = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
  if (!row) {
    const error = new Error('Visit test not found.');
    error.statusCode = 404;
    throw error;
  }
  assertStaffAllowedCategory(requestingUser, row.category_name);
}

/** May they WRITE to it? Department scope, plus the ticket-release gate. */
async function assertStaffOwnsVisitTest(requestingUser, visitTestId) {
  if (requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin')) {
    return;
  }
  const row = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
  if (!row) {
    const error = new Error('Visit test not found.');
    error.statusCode = 404;
    throw error;
  }
  assertStaffAllowedCategory(requestingUser, row.category_name);

  // 'Completed' is allowed as well as 'Processing'. A visit completes when its last result is
  // released, and refusing writes from that moment made amending a released result impossible —
  // which is the one thing result versioning [1.15.0] exists for, since a correction is nearly
  // always discovered after the report has gone out. The alternative was somebody editing the
  // database by hand, which keeps no history at all.
  if (row.visit_status !== 'Processing' && row.visit_status !== 'Completed') {
    const error = new Error(
      'This ticket has not been released to your department yet. It is still with the front desk or cashier.'
    );
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Refuses report work on a department whose results are given outside this system. [1.129.0]
 * Upload, release and email all ask; X-ray's exam is marked done on its worklist instead.
 */
async function assertDepartmentIssuesReports(visitTestId) {
  const row = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
  if (row && !issuesReports(row.category_name)) {
    const error = new Error(
      `${categoryLabel(row.category_name)} results are given by the ${categoryLabel(row.category_name)} department's own system, so nothing is uploaded, released or sent here. Mark the exam done on the worklist instead.`
    );
    error.statusCode = 409;
    throw error;
  }
}

class ResultService {
  /**
   * The worklist for one modality: tickets released to it and not yet reported.
   *
   * @param {string} categoryName  'Laboratory' | 'Xray' | 'Ultrasound'.
   * @param {object} requestingUser  Checked against `departments` — a lab account asking for
   *   X-Ray's worklist is refused, not merely shown an empty one.
   * @returns {Promise<Array>} Only tickets the cashier has RELEASED. An unpaid visit's tests are
   *   invisible here, which is the ticket-release gate.
   */
  async getPendingByCategory(categoryName, requestingUser) {
    // The list is DIAGNOSTIC_CATEGORIES in constants/modality.js rather than a literal here, so
    // adding or retiring a department changes one file. It used to carry '2D Echo' as a fourth
    // entry — its own test_categories row that MODULE_SCOPE.md assigned to the Ultrasound role —
    // until [1.50.0] removed that category entirely.
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findPendingByCategory(categoryName);
  }

  /**
   * @param {{days?: string|number, limit?: string|number, offset?: string|number}} options
   *   Query-string values, so everything is parsed and clamped here rather than trusted.
   */
  async getReleasedByCategory(categoryName, requestingUser, options = {}) {
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);

    // Clamped, not merely defaulted: `limit` reaches this straight from the query string, and the
    // rows it controls carry full clinical narrative in unbounded TEXT columns. An unclamped
    // limit would let any authenticated staff member pull the department's entire result history
    // in one request — the exact unbounded response this window exists to prevent.
    // Allow-listed. Anything unrecognised is dropped rather than passed to SQL, where it could
    // only match nothing — and an empty worklist reads as "no work", which is a claim.
    const delivery = ['sent', 'unsent'].includes(options.delivery) ? options.delivery : null;
    const search = String(options.search || '').trim().slice(0, 100) || null;

    // Paged at the server when a page is asked for. [1.128.0] History fetched the last 90 days,
    // up to 200 reports, and paged those in the browser: a laboratory releasing more than that
    // lost its older reports from History without a word, and the footer's "total" was only what
    // had been fetched. A paged request reaches every report the department ever released (no
    // window unless `days` asks for one), ten at a time, with the true total and a search that
    // runs across all of it. Without `page` this answers exactly as before.
    if (options.page !== undefined) {
      const page = Math.max(parseInt(options.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 50);
      const days = Math.min(Math.max(parseInt(options.days, 10) || 0, 0), 3650);
      const rows = await resultRepository.findReleasedByCategory(categoryName, {
        days, delivery, search, limit, offset: (page - 1) * limit,
      });
      const total = rows[0]?.total_count ?? 0;
      return { released: rows, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
    }

    const days = Math.min(Math.max(parseInt(options.days, 10) || 90, 0), 3650);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(options.offset, 10) || 0, 0);
    const rows = await resultRepository.findReleasedByCategory(categoryName, { days, delivery, search, limit, offset });
    return { released: rows };
  }

  /**
   * Mark an exam DONE, in a department whose results are given outside this system. [1.129.0]
   *
   * This route used to let a department set its ticket to 'Waiting for Release' or 'Completed',
   * and Admin/SuperAdmin to set ANY status. No screen used it, and it was a way round the whole
   * process: a laboratory test "Completed" with no report released, or an unpaid test pushed to
   * 'Processing' onto a worklist. Now it does one thing: a paid X-ray exam ('Processing') becomes
   * 'Completed', recording when and by whom, and the visit completes when nothing else is left —
   * as releasing a report does in the other departments. A test whose department issues reports
   * here is finished by releasing its report, and nothing else.
   *
   * @param {number} visitTestId
   * @param {string} status  must be 'Completed'
   * @param {object} requestingUser
   */
  async updateTestStatus(visitTestId, status, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    const state = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
    if (!state) {
      const error = new Error('Test not found on any visit.');
      error.statusCode = 404;
      throw error;
    }
    if (status !== 'Completed' || issuesReports(state.category_name)) {
      const error = new Error(issuesReports(state.category_name)
        ? `${categoryLabel(state.category_name)} tests are finished by releasing their report, not by setting their status.`
        : 'An exam here can only be marked done.');
      error.statusCode = 403;
      throw error;
    }
    if (state.test_status === 'Completed') {
      const error = new Error('This exam is already marked done.');
      error.statusCode = 409;
      throw error;
    }

    const done = await db.withTransaction(async () => {
      const row = await testRepository.markPerformed(visitTestId, requestingUser.userId);
      if (!row) return null;
      if (!(await visitRepository.hasOutstandingTests(state.visit_id))) {
        await visitRepository.updateVisitStatus(state.visit_id, 'Completed');
      }
      return row;
    });
    if (!done) {
      const error = new Error('This exam is not with the department yet: it has not been paid for, or it was cancelled.');
      error.statusCode = 409;
      throw error;
    }
    return done;
  }

  async uploadResult(
    { visitTestId, file, findings, remarks, releasedBy, amendmentReason },
    requestingUser
  ) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    await assertDepartmentIssuesReports(visitTestId);

    // Fetched once, up front: doubles as (a) the file-preservation source when no new file is
    // attached, and (b) the correction signal below — a result already existing before this call
    // means this is an edit, not a first-time release.
    const existing = await resultRepository.findResultByVisitTestId(visitTestId);
    const isCorrection = !!existing;

    // A reason is required once the report has actually gone out — and only then. [1.26.0]
    //
    // The distinction is 'Completed' vs 'Waiting for Release'. Before release the findings have
    // been seen by nobody outside the department, so re-saving is drafting: demanding a
    // justification for fixing your own typo is friction that buys nothing, and the reason box
    // fills up with "typo" until it means nothing. After release a clinician may have acted on
    // the old version, so "why did this change?" is the question the amendment history exists to
    // answer — and it was optional, with the audit entry reduced to writing "no reason given"
    // against a corrected medical report.
    const releaseState = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
    const releasedAlready = isCorrection && releaseState?.test_status === 'Completed';

    if (releasedAlready && String(amendmentReason || '').trim().length < 4) {
      const error = new Error(
        'This result has already been released to the patient. Say why it is being amended — ' +
          'the reason is kept with both versions, so anyone who acted on the earlier report can see what changed.'
      );
      error.statusCode = 400;
      throw error;
    }

    let filePath = null, fileOriginalName = null, fileMimeType = null, fileSizeBytes = null;

    if (file) {
      filePath = path.relative(UPLOAD_ROOT, file.path);
      fileOriginalName = file.originalname;
      fileMimeType = file.mimetype;
      fileSizeBytes = file.size;
    } else if (existing) {
      // Phase C: this call now also handles correcting an already-released result (editing
      // findings/remarks without re-attaching a file) — without this, re-submitting would
      // silently wipe a previously uploaded file's metadata, since createResult's upsert
      // otherwise overwrites every column unconditionally.
      filePath = existing.file_path;
      fileOriginalName = existing.file_original_name;
      fileMimeType = existing.file_mime_type;
      fileSizeBytes = existing.file_size_bytes;
    }

    // Recording the findings and moving the ticket are one event.
    //
    // The status update used to run first, on its own, before createResult. If createResult then
    // failed, the ticket sat in 'Waiting for Release' — which the front desk reads as "findings
    // recorded, awaiting authorisation" — with no findings anywhere behind it. Releasing it then
    // fails with "No result found for this visit test", and nothing on any screen explains why a
    // ticket that says it is ready cannot be released.
    const result = await db.withTransaction(async () => {
      // Recording findings is not the same event as releasing them. The ticket parks in
      // 'Waiting for Release' — visible as such to the front desk — until releaseResult below
      // authorises it and notifies the patient.
      await testRepository.updateVisitTestStatus(visitTestId, 'Waiting for Release');

      // Amending a released result has to reopen the visit, or the amendment goes nowhere. [1.26.0]
      //
      // The visit closes when its last result is released. Amending afterwards puts the ticket
      // back to 'Waiting for Release', but the modality worklist filters on
      // `pv.status = 'Processing'` and the Released tab filters on `vt.status = 'Completed'` — so
      // the amended ticket showed on neither. The technician saved the correction, saw it accepted,
      // and it then existed only in the version history: never re-released, so the patient and the
      // referring doctor kept the wrong report. Reopening puts it back where somebody will see it,
      // and releaseResult closes the visit again once it goes out.
      if (releasedAlready) {
        await visitRepository.updateVisitStatus(releaseState.visit_id, 'Processing');
      }

      const created = await resultRepository.createResult({
        visitTestId,
        filePath,
        fileOriginalName,
        fileMimeType,
        fileSizeBytes,
        findings,
        remarks,
        releasedBy,
        amendmentReason,
      });

      // Phase D: only a correction is audit-worthy here — the first-time release of every result
      // would make the log mostly noise from routine work, not the "something changed after the
      // fact" signal an audit trail is for.
      //
      // Inside the transaction on purpose: an audit entry describing a correction that was then
      // rolled back is worse than no entry, because the log is the artifact whose whole value is
      // being trustworthy.
      if (isCorrection) {
        // Names the versions involved and the stated reason. The old entry said only "Corrected
        // findings for visit test #N" — true, and useless: it could not tell you what changed,
        // and the previous text no longer existed anywhere to compare against. Now the superseded
        // version is still on the table, so the log points at both ends of the change.
        await auditService.log({
          actorId: requestingUser?.userId,
          action: 'result.amended',
          entityType: 'test_result',
          entityId: created.id,
          description:
            `Amended visit test #${visitTestId}: version ${existing.version} superseded by ` +
            `version ${created.version}` +
            (amendmentReason ? ` — ${amendmentReason}` : ' — no reason given')
        });
      }

      return created;
    });

    return result;
  }

  // Phase B: streams the physical file back for a result — never through a public static path,
  // since these are PHI. Ownership mirrors the two checks already used elsewhere in this file/
  // resultController: staff must own the test's category (assertStaffOwnsVisitTest, SuperAdmin/
  // Admin bypass); a Client must own the patient the test belongs to (getPatientHistory's check).
  /**
   * Streams a report file back, after checking who is asking.
   *
   * @param {number} visitTestId
   * @param {object} requestingUser  Staff pass on department scope; a Client passes on OWNERSHIP.
   * @returns {Promise<{path:string, originalName:string, mimeType:string}>}
   *
   * The stored filename is server-generated hex and is never derived from the uploader's, so the
   * path cannot be steered by a request value. The original name is carried separately, for the
   * download header only.
   */
  async getResultFile(visitTestId, requestingUser, { authorisedOnly = false } = {}) {
    const ownership = await resultRepository.findOwnershipInfoByVisitTestId(visitTestId);
    if (!ownership) {
      const error = new Error('Visit test not found.');
      error.statusCode = 404;
      throw error;
    }

    const isClient = requestingUser.roles.includes('Client');

    if (isClient) {
      if (ownership.patient_user_id !== requestingUser.userId) {
        const error = new Error('Access forbidden. This result does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    } else {
      assertStaffAllowedCategory(requestingUser, ownership.category_name);
    }

    // A patient gets the last version that was AUTHORISED; staff get the current one. [1.94.0]
    //
    // This route checked ownership and department and then streamed whatever was current. That
    // was survivable while the file supplemented typed findings and the portal simply did not
    // offer a button for an unreleased result — but hiding a control is not enforcing a rule, and
    // the file is now the entire report.
    //
    // Two things were wrong at once. A result recorded and not yet released is current, so a
    // patient could fetch a draft clinical report nobody had authorised. And an amendment makes
    // the unreleased v2 current while reopening the visit, which both served that draft AND —
    // because the portal gates its buttons on the visit being Completed — took away the copy the
    // patient had already legitimately been sent, for as long as the correction took to write.
    //
    // Reading the latest authorised version answers both: the draft is unreachable, and the
    // superseded-but-released copy stays readable until its replacement is authorised.
    //
    // Gated on authorised_at and never released_at: released_at defaults to CURRENT_TIMESTAMP at
    // insert, so it is never null and would gate nothing.
    //
    // Staff may ask for the same copy with `authorisedOnly` [1.108.0]: Patient Records opens the
    // record, and the record is the report that went out, not an amendment still being written.
    const result = isClient || authorisedOnly
      ? await resultRepository.findLatestAuthorisedByVisitTestId(visitTestId)
      : await resultRepository.findResultByVisitTestId(visitTestId);

    if (!result || !result.file_path) {
      const error = new Error('No uploaded file exists for this result.');
      error.statusCode = 404;
      throw error;
    }

    const absolutePath = path.join(UPLOAD_ROOT, result.file_path);
    if (!fs.existsSync(absolutePath)) {
      const error = new Error('The file for this result could not be found on the server.');
      error.statusCode = 404;
      throw error;
    }

    // A patient receives the DIGITAL COPY, never the original. [1.114.0] The original — the one the
    // clinic prints and seals — stays on the staff side; what a patient can open, print or keep is
    // marked on every page, so it cannot be passed off as the clinic's document. A report that
    // cannot be marked is refused, never handed over unmarked.
    if (isClient) {
      const refuse = (message) => {
        const error = new Error(message);
        error.statusCode = 409;
        return error;
      };
      if (!isMarkable(result.file_mime_type)) {
        throw refuse('This report is a Word document or spreadsheet, so it is given out at the clinic. Please visit the clinic and ask for it.');
      }
      let buffer;
      try {
        buffer = await digitalCopy(await fs.promises.readFile(absolutePath), result.file_mime_type, {
          verification: stampFor(result.verification_code, env.FRONTEND_URL),
        });
      } catch (err) {
        logger.error(`Could not mark ${result.file_path} as a digital copy for the portal:`, err);
        throw refuse('This report could not be prepared for viewing online. Please visit the clinic and ask for it.');
      }
      return {
        buffer,
        originalName: digitalCopyName(result.file_original_name),
        mimeType: 'application/pdf',
        patientId: ownership.patient_id,
        testName: ownership.test_name,
        patientName: `${ownership.patient_first_name} ${ownership.patient_last_name}`,
      };
    }

    return {
      absolutePath,
      originalName: result.file_original_name || 'result',
      mimeType: result.file_mime_type || 'application/octet-stream',
      // Returned so the controller can audit the access against the patient rather than only
      // against the visit_test row, in a sentence naming the test and the patient.
      patientId: ownership.patient_id,
      testName: ownership.test_name,
      patientName: `${ownership.patient_first_name} ${ownership.patient_last_name}`,
    };
  }

  /**
   * What a staff member is about to print or download, for the audit entry. [1.108.0]
   *
   * Viewing a report fetches the file, and that fetch was always logged. Printing it or saving it
   * happens in the browser on the copy already fetched, so the server never heard of either: a
   * report could leave the building on paper with nothing to say who sent it. The browser reports
   * it here first. It cannot prove the page came out of the printer — a cancelled print dialog
   * still counts — which is the honest limit of logging something a browser does.
   *
   * Same department check as opening the file: nobody may log a copy of a report they may not read.
   */
  async describeReportCopy(visitTestId, kind, requestingUser) {
    if (!['print', 'download'].includes(kind)) {
      const error = new Error("kind must be 'print' or 'download'.");
      error.statusCode = 400;
      throw error;
    }
    const ownership = await resultRepository.findOwnershipInfoByVisitTestId(visitTestId);
    if (!ownership) {
      const error = new Error('Visit test not found.');
      error.statusCode = 404;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, ownership.category_name);
    return {
      patientId: ownership.patient_id,
      testName: ownership.test_name,
      patientName: `${ownership.patient_first_name} ${ownership.patient_last_name}`,
    };
  }

  /**
   * Send the patient their report, and WRITE DOWN that it went. [1.59.0]
   *
   * Called only when a member of staff chooses to send it [1.113.0]: releasing no longer emails.
   * The wording still follows the version, so an amended report goes out as the replacement.
   *
   * Recording happens only on success. `emailed_at IS NULL` has to keep meaning "this report has
   * never reached the patient", with no second reading — a failed attempt that stamped the column
   * would turn the one honest signal in the feature into a lie.
   *
   * `sendEmail` never throws: it swallows SMTP failures and returns {error}/{skipped}, so the
   * return value is the only way to know. Discarding it is how this used to report "patient
   * notified" over an unconfigured mail server.
   */
  async deliverResultEmail({ patientInfo, isAmendment, visitTestId }) {
    if (!patientInfo || !patientInfo.email) return 'no_email';

    const patientName = `${patientInfo.first_name} ${patientInfo.last_name}`;

    // ── The report itself ──────────────────────────────────────────────────────────────────
    //
    // Attached when the department uploaded a document, and set out in the body either way. Both,
    // not one or the other: an attachment a patient cannot open on their phone is no report at
    // all, and a body with no document is not what a referring physician will accept.
    const attachment = await resolveReportAttachment(patientInfo);

    const subject = isAmendment
      ? `Updated ${patientInfo.test_name} result - ${env.CLINIC_NAME}`
      : `Your ${patientInfo.test_name} Results Are Ready - ${env.CLINIC_NAME}`;

    const amendmentBanner = isAmendment
      ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fffbeb;border-left:3px solid #d97706;
                  border-radius:6px;color:#78350f;">
           <strong>This report replaces the one issued earlier.</strong> Please use this version and
           discard any earlier copy.
         </p>`
      : '';

    // "Set out below" is only true when something is actually set out below. [1.94.0] Once the
    // report is an attached document rather than typed findings, that sentence and findingsBlock's
    // wording both have to follow what the email really contains.
    const hasWrittenFindings = Boolean(
      (patientInfo.findings || '').trim() || (patientInfo.remarks || '').trim()
    );

    const emailResult = await sendEmail({
      to: patientInfo.email,
      subject,
      html: wrapEmail(`
        <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;">Hello ${escapeHtml(patientName)},</h2>
        ${amendmentBanner}
        <p>Your <strong>${escapeHtml(patientInfo.test_name)}</strong> report is ready.${
          hasWrittenFindings
            ? ` It is set out below.${attachment ? ' A copy is attached to this email as well.' : ''}`
            : attachment ? ' It is attached to this email.' : ''
        }</p>
        ${reportTable(patientInfo)}
        ${findingsBlock(patientInfo, { attached: Boolean(attachment) })}
        ${attachment ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #64748b;
                    border-radius:6px;color:#334155;">
             The attached report is a <strong>digital copy</strong>, marked DIGITAL COPY on every page.
             The original, with the clinic's official seal, is kept at the clinic: please visit and ask
             for it if you need it.
           </p>` : ''}
        ${patientInfo.verification_code ? `<p style="margin:12px 0 0;color:#334155;">
             Verification code <strong style="font-family:monospace;">${formatCode(patientInfo.verification_code)}</strong>.
             Anyone you show this report to can check it is genuine on
             <a href="${escapeHtml(stampFor(patientInfo.verification_code, env.FRONTEND_URL).url)}" style="color:#0a71a9;">the clinic's verification page</a>.
           </p>` : ''}
        <p style="margin:20px 0 0;font-size:13px;color:#475569;">
          These findings are for your doctor to interpret. If anything here is unclear, or if you
          feel unwell, please contact the clinic on ${escapeHtml(env.CLINIC_PHONE)}.
        </p>
      `),
      attachments: attachment ? [attachment] : undefined,
    });

    if (emailResult?.error || emailResult?.skipped) return 'failed';

    await resultRepository.recordEmailDelivery(visitTestId, patientInfo.email);
    return 'sent';
  }

  /**
   * Send a released report to the patient by email, when somebody chooses to. [1.59.0] [1.113.0]
   *
   * The ONLY way a report is emailed. Releasing used to email the patient automatically; not every
   * patient wants a medical report in their inbox, so release now only authorises the report and
   * puts it in the portal, and a member of staff sends it when the patient asks — from the release
   * confirmation, or later from the department's History, as many times as needed.
   *
   * Refuses on anything not yet released. A report that has not been authorised must not be
   * emailable by another door — that would make `results:release` bypassable by whoever can send
   * an email, and the whole point of 'Waiting for Release' is that authorisation is a separate,
   * deliberate act.
   */
  async emailResult({ visitTestId }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    await assertDepartmentIssuesReports(visitTestId);

    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('There is no report for this test yet, so there is nothing to send.');
      error.statusCode = 404;
      throw error;
    }
    if (!result.released_at || !result.authorised_at) {
      const error = new Error(
        'This report has not been released yet. Release it from the worklist first, then send it.'
      );
      error.statusCode = 409;
      throw error;
    }

    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    if (!patientInfo || !patientInfo.email) {
      // A walk-in registered at the counter often has no account and therefore no address. Naming
      // the remedy matters: whoever is holding the phone can fix this in a minute from Patient
      // Records, and "no email on file" alone does not tell them that.
      const error = new Error(
        'This patient has no email address on file. Add one to their record first, then send it again.'
      );
      error.statusCode = 409;
      throw error;
    }

    // A report is emailed only as a marked digital copy. [1.114.0] One that cannot be marked is not
    // sent at all, and whoever pressed Send is told why and what to do instead.
    let emailStatus;
    try {
      emailStatus = await this.deliverResultEmail({
        patientInfo,
        isAmendment: (result.version || 1) > 1,
        visitTestId,
      });
    } catch (err) {
      if (err.code !== 'NOT_MARKABLE' && err.code !== 'MARK_FAILED') throw err;
      const error = new Error(err.code === 'NOT_MARKABLE'
        ? 'This report is a Word document or spreadsheet, which cannot be marked DIGITAL COPY, so it is not emailed. Attach it as a PDF to send it, or give the patient the original at the clinic.'
        : 'This report could not be prepared as a digital copy, so nothing was sent. Give the patient the original at the clinic.');
      error.statusCode = 409;
      throw error;
    }

    if (emailStatus !== 'sent') {
      const error = new Error(
        'The email could not be sent. The clinic mail account may be unreachable — telephone the patient if this one is urgent.'
      );
      error.statusCode = 502;
      throw error;
    }

    // Audited: a person deciding to put a medical report in front of a patient, and "who sent
    // this, and when" is the question asked afterwards.
    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'result.emailed',
      entityType: 'test_results',
      entityId: result.id,
      description: `${patientInfo.test_name} for ${patientInfo.first_name} ${patientInfo.last_name} emailed to ${patientInfo.email}`,
    });

    const fresh = await resultRepository.findResultByVisitTestId(visitTestId);
    return { emailedTo: patientInfo.email, emailedAt: fresh?.emailed_at, emailCount: fresh?.email_count };
  }

  /**
   * Releases a report to the patient — the clinical act this whole module builds up to.
   *
   * @param {object} params
   * @param {number} params.visitTestId
   * @param {number} params.releasedBy  Recorded separately from `recorded_by`: the clinician who
   *   authorises release is not always the one who typed the findings.
   * @param {object} requestingUser  Needs `results:release` AND cover for the department.
   * @returns {Promise<object>}
   *
   * Completing the last outstanding test also completes the VISIT, so the two writes share a
   * transaction.
   *
   * It does NOT email the patient. [1.113.0] Releasing authorises the report and puts it in the
   * patient's portal; emailing it is a separate choice (`emailResult`), because not every patient
   * wants their result sent to them.
   */
  async releaseResult({ visitTestId, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    await assertDepartmentIssuesReports(visitTestId);

    // Fetch result to confirm it exists
    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('No result found for this visit test. Attach the report first.');
      error.statusCode = 400;
      throw error;
    }

    // The report document is what is being authorised. [1.94.0]
    //
    // Findings are no longer typed — the clinic attaches the report it already produces — so a
    // release with no file would send a patient an email about a result that contains nothing,
    // and leave a 'Completed' ticket whose record is empty. The browser disables the release
    // button for the same reason; this is the rule rather than the courtesy.
    //
    // On RELEASE and not on recording, deliberately: parking a ticket in 'Waiting for Release'
    // while the report is being produced is what that state has always been for, and demanding
    // the document to save it would remove a step the department actually uses.
    //
    // Reads the stored result rather than the request, so an amendment that carries no new upload
    // passes on the file it inherited. Checking the upload instead would make every correction
    // impossible.
    if (env.RESULTS_REQUIRE_FILE && !result.file_path) {
      const error = new Error(
        'Attach the report file before releasing this result. The report is what the patient receives.'
      );
      error.statusCode = 400;
      throw error;
    }

    // Releasing is the step that completes the ticket. Reading the visit id before the update
    // (rather than after) keeps the "was this the last test?" check below working even if the
    // row shape changes later.
    const releaseState = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);

    // Releasing a result is three writes that describe one clinical event, so they commit or fail
    // together. Two of the three failure modes are silent and permanent:
    //
    //   - ticket marked Completed but released_by never written: the audit trail cannot say who
    //     authorised releasing a medical result, which is the one question it exists to answer.
    //   - both written but the visit never closed: the visit sits in Processing forever, inflating
    //     the front desk queue and the cashier's billing list with work that is actually finished.
    //
    // The transaction also serialises two staff releasing the same result at once — the second
    // waits for the first's row lock rather than interleaving with it.
    let released;
    await db.withTransaction(async () => {
      await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

      // Persist WHO authorised this. `releasedBy` was already being passed in from the controller
      // and then dropped on the floor, so released_by kept whatever the findings-upload path wrote
      // — i.e. the author, not the authoriser. Whenever those are two different people, which is
      // the entire reason 'Waiting for Release' exists as a separate state, the record named the
      // wrong one.
      // [1.126.0] Issued here, at the moment the version becomes the clinic's word, and printed on
      // every copy the patient receives. 50 random bits against the UNIQUE constraint: a clash is a
      // one-in-a-trillion 409, not something worth a retry loop.
      released = await resultRepository.markReleased(visitTestId, releasedBy, generateCode());

      // Once nothing on the visit is outstanding, the visit itself is done — otherwise it would
      // sit in 'Processing' forever, permanently inflating the front desk's active queue and the
      // cashier's billing list.
      if (releaseState && !(await visitRepository.hasOutstandingTests(releaseState.visit_id))) {
        await visitRepository.updateVisitStatus(releaseState.visit_id, 'Completed');
      }
    });

    // Who and what, for the staff notification below. `result` was read before the release, so
    // this is the version being authorised.
    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    const isAmendment = (result.version || 1) > 1;

    // Module 18 (Notification): Admin/SuperAdmin oversight of diagnostic throughput, matching
    // the existing Reports/oversight theme — not the releasing staff member themselves, who is
    // the actor here, not a recipient.
    // Receptionist is included alongside the Admin/SuperAdmin oversight audience: the front
    // desk owns the queue board, and a ticket finishing at a modality is exactly the kind of
    // modality-side change that has to reflect back to reception.
    if (patientInfo) {
      const patientName = `${patientInfo.first_name} ${patientInfo.last_name}`;

      await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
        title: isAmendment ? 'Result Amended and Re-released' : 'Result Released',
        message: `${patientInfo.test_name} for ${patientName}`,
        type: isAmendment ? 'info' : 'success'
      });
    }

    // Whether there is an address to send it to, so the screen can offer the email or say why not.
    return {
      ...result,
      isAmendment,
      patientEmail: patientInfo?.email || null,
      hasPortalAccount: Boolean(patientInfo?.has_portal_account),
      verificationCode: released?.verification_code ? formatCode(released.verification_code) : null,
    };
  }

  // Lets the modality re-open a ticket that is already 'Waiting for Release' and edit the
  // findings it recorded earlier, instead of overwriting them with a blank form.
  /**
   * The CURRENT version of one report.
   *
   * @param {number} visitTestId
   * @param {object} requestingUser
   * @returns {Promise<object|null>} Filtered on `is_current`. Superseded versions are reachable
   *   only through `getVersionHistory`, which is the single intentional reader of them — a query
   *   here that dropped `is_current` would show withdrawn findings beside live ones.
   */
  async getResultByVisitTestId(visitTestId, requestingUser) {
    await assertStaffMayReadVisitTest(requestingUser, visitTestId);
    return await resultRepository.findResultByVisitTestId(visitTestId);
  }

  /**
   * The amendment history for a test — every version, newest first.
   *
   * Keeping superseded versions is only half the fix; they have to be readable, or the table is
   * just accumulating rows nobody can see. Ownership is checked the same way as every other
   * result read, since a superseded version is every bit as much PHI as the current one.
   */
  async getVersionHistory(visitTestId, requestingUser) {
    await assertStaffMayReadVisitTest(requestingUser, visitTestId);
    return await resultRepository.findVersionHistoryByVisitTestId(visitTestId);
  }

  /**
   * A patient's full diagnostic history, scoped to what the caller is allowed to see.
   *
   * This method used to take only `patientId` and pass it straight through — the one method in
   * this service with no authorization argument at all. The controller checks Client ownership,
   * but that branch is skipped for every staff role, so a Laboratory Staff token calling
   * GET /api/results/history/1,2,3… received every result for every patient across Xray,
   * Ultrasound and 2D Echo, findings text included. That is exactly the department separation
   * assertStaffAllowedCategory was written to enforce on the other routes; this one was missed.
   *
   * The filter is applied in SQL rather than after the fetch, so rows the caller may not see are
   * never loaded and never cross the wire.
   */
  async getPatientHistory(patientId, requestingUser, { releasedOnly = false } = {}) {
    // [1.108.0] Patient Records asks for the final record only: authorised reports, no pending
    // work. The portal keeps the whole list, because a patient follows their booking's progress.
    if (releasedOnly) {
      return resultRepository.findReleasedResultsByPatientId(patientId, visibleCategoriesFor(requestingUser));
    }
    // A patient reads only what was authorised. [1.136.0] Staff keep the current version: the
    // department is still writing it.
    return await resultRepository.findResultsByPatientId(
      patientId,
      visibleCategoriesFor(requestingUser),
      { authorisedOnly: (requestingUser?.roles || []).includes('Client') }
    );
  }

}

module.exports = new ResultService();
