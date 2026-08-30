const fs = require('fs');
const path = require('path');
const hmoRepository = require('../repositories/hmoRepository');
const db = require('../config/database');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { HMO_CARD_UPLOAD_ROOT } = require('../config/upload');
const { CLIENT_ROLE, isStaffUser } = require('../constants/roles');
const visitRepository = require('../repositories/visitRepository');
const { assertReferralIfRequired, normaliseReferral, isNamed } = require('./referralService');

// The decisions an HMO claim's individual test can carry, mirroring chk_hmo_request_tests_status.
// Kept here so a bad value is refused with a 400 that names the alternatives, rather than passed
// through to Postgres and returned as an unexplained 500 — 'Denied' is the word the providers
// themselves use, so it is the value a caller reaches for first, and it is not this one.
const HMO_TEST_DECISIONS = ['Pending', 'Approved', 'Rejected'];

/**
 * A claim is decided once. [1.28.0]
 *
 * Without this, approving an already-rejected claim silently overwrote the refusal and its
 * reason — the one record of why the patient was charged — and re-approving an approved one
 * reissued the notification, so the cashier got told twice about a claim they had already
 * settled. Re-deciding is a real need, but it is a reversal, and a reversal should be a
 * deliberate act with its own trail rather than a second click that looks like the first.
 */
function assertUndecided(request) {
  if (request.status === 'Pending') return;
  const error = new Error(
    `This claim was already ${request.status.toLowerCase()}. Reopen it before recording a different decision.`
  );
  error.statusCode = 409;
  throw error;
}

/**
 * Tell the counter a claim has been decided. [1.28.0]
 *
 * This is the step the workflow was missing. Reception raises the claim, an Admin decides it,
 * and the cashier bills what is left — but nothing connected the second step to the third. The
 * patient sat in the lobby while the cashier reloaded the bill on a hunch, or charged them in
 * full because nothing said otherwise and the approval landed an hour later.
 *
 * Cashier and Receptionist both: the cashier collects, and the receptionist is the one standing
 * with the patient explaining the wait. Admins are deliberately not notified — they are the ones
 * who just did it.
 *
 * Named for the patient rather than the claim id, because "Maria Santos — MediCard approved" is
 * actionable at a counter and "HMO request #482 approved" is a lookup somebody has to go and do.
 *
 * notifyRoles swallows its own errors, so a notification problem can never fail a decision that
 * has already been written.
 */
async function handOffToCashier(request, { type, title, detail }) {
  const patient = [request.patient_first_name, request.patient_last_name].filter(Boolean).join(' ');
  await notificationService.notifyRoles(['Cashier', 'Receptionist'], {
    title,
    type,
    message: patient ? `${patient} — ${detail}` : detail,
  });
}

// Mirrors testService.js's assertClientOwnsVisit, which exists for the same reason: that endpoint
// also authorizes the Client role for self-service booking and originally trusted whatever ids the
// caller sent. This endpoint opened to Clients when online booking needed it, and without this a
// client could attach an HMO claim to a stranger's tests — a claim against someone else's bill,
// filed under their own provider and LOA code.
//
// Validation is all-or-nothing and runs before any write. Filtering the caller's ids down to the
// ones they own would silently under-claim: a three-test claim quietly becoming a two-test claim
// bills the patient out of pocket for the third with nothing on screen to explain it.
async function assertClientOwnsVisitTests(requestingUser, visitTestIds) {
  const uniqueIds = [...new Set(visitTestIds)];
  const rows = await hmoRepository.findOwnershipInfoByVisitTestIds(uniqueIds);

  if (rows.length !== uniqueIds.length) {
    const error = new Error('One or more of these tests do not exist.');
    error.statusCode = 404;
    throw error;
  }

  // An HMO request is one approval covering one visit. The schema cannot express that —
  // hmo_requests has no patient_visit_id, reaching a visit only transitively through
  // hmo_request_tests — so this is the only place the rule can be enforced. Applies to staff
  // callers too: it is a data-integrity rule, not an authorization one.
  if (new Set(rows.map((r) => r.visit_id)).size > 1) {
    const error = new Error('An HMO request must cover tests from a single visit.');
    error.statusCode = 400;
    throw error;
  }

  // Deliberately "does not hold Client", matching assertClientOwnsPatient and assertClientOwnsVisit
  // byte for byte, rather than the isStaffUser() test resolveCardEvidence uses below. The two ask
  // different questions: "may you claim for this patient" is about being a patient-only account,
  // while "must you photograph the card" is about standing at a desk holding one. They differ only
  // for an account holding Client *and* a staff role, and widening an ownership check to cover a
  // shape that does not exist yet is not something to do in passing.
  if (!requestingUser?.roles?.includes(CLIENT_ROLE)) return; // staff roles are not ownership-restricted

  // patients.user_id is null for a walk-in registered at the front desk with no web account, so
  // this comparison denies rather than matches — which is the correct outcome for a Client.
  const ownsEvery = rows.every((r) => r.patient_user_id === requestingUser.userId);
  if (!ownsEvery) {
    const error = new Error('Access forbidden. One or more of these tests do not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

// Every HMO claim must carry evidence, and what counts as evidence depends on who is filing it.
//
// A client booking online is not in the building, so the photo of their card is the only thing
// the clinic can look at before approving coverage. A receptionist filing the same claim has the
// physical card in their hand — a photo would add nothing their own eyes did not already verify,
// and demanding one mid-queue would slow a working desk to fix a problem it does not have. They
// are exempt from uploading, not from accountability: their user id is recorded as the verifier.
//
// Either way the claim is reviewable, and chk_hmo_request_card_evidence enforces that at the
// database, covering routes and scripts that do not exist yet.
function resolveCardEvidence(requestingUser, cardFile) {
  // Keyed on HOLDING a staff role, not on the absence of Client. Combined-role accounts are a
  // supported thing here, and a receptionist who is also a patient of the clinic is ordinary —
  // testing for Client would refuse her the desk exemption while she is standing at the desk
  // holding the card.
  //
  // Uses the system's one definition of staff rather than a local allow-list of role names. A
  // list of ['SuperAdmin','Admin','Receptionist','Cashier'] would have quietly disagreed with the
  // permission matrix [1.20.0]: since `hmo:request` can be delegated to any staff account, a lab
  // tech granted it would have reached this route and then been told to photograph a card they
  // were holding, with no way to complete the claim.
  const isStaff = isStaffUser(requestingUser);

  if (cardFile) {
    return {
      filePath: cardFile.filename,
      originalName: cardFile.originalname,
      mimeType: cardFile.mimetype,
      sizeBytes: cardFile.size,
      // Staff who do attach a photo are still recorded as having seen the card in person.
      verifiedBy: isStaff ? (requestingUser?.userId ?? null) : null
    };
  }

  if (!isStaff) {
    const error = new Error('Please attach a photo of your HMO card to claim HMO coverage.');
    error.statusCode = 400;
    throw error;
  }

  // Staff, no photo: the attestation IS the evidence, so an unidentifiable caller cannot
  // produce a valid claim. Fails here with a readable message rather than as a 23514 further in.
  if (!requestingUser?.userId) {
    const error = new Error('Cannot record who confirmed this HMO card.');
    error.statusCode = 400;
    throw error;
  }
  return { verifiedBy: requestingUser.userId };
}

class HmoService {
  /**
   * Makes sure the visit behind a claim names the doctor who requested the tests, recording one
   * from the caller if the visit does not have it yet.
   *
   * Runs inside the caller's transaction, so a claim and the referral it depends on either both
   * land or neither does. A claim that committed while the physician write failed would sit in
   * Admin's review queue looking complete and be refused by the HMO weeks later.
   */
  async assertVisitNamesReferrer(visitTestIds, referral) {
    const visitId = await hmoRepository.findVisitIdByVisitTestIds(visitTestIds);
    if (!visitId) return; // ownership/existence is assertClientOwnsVisitTests's job, not this one

    const visit = await visitRepository.findVisitById(visitId);
    const supplied = normaliseReferral(referral || {});
    const already = isNamed(visit?.referring_physician);

    assertReferralIfRequired({
      patientTypeName: visit?.patient_type_name,
      hasHmoClaim: true,
      referringPhysician: already ? visit.referring_physician : supplied.referringPhysician,
    });

    // Only written when the visit had none. A claim filed later must not quietly rewrite the
    // physician already recorded against the visit — that name may already be on a released
    // report, and two documents naming different doctors for one episode is worse than either.
    if (!already && supplied.referringPhysician) {
      await visitRepository.updateReferringPhysician(visitId, supplied);
    }
  }

  /**
   * Files an HMO claim: the request row, the tests it covers, and the evidence behind it.
   *
   * A request and the tests it covers are one submission to the HMO. Without a transaction, a
   * failure partway through the loop left a request covering only the tests linked so far — and
   * nothing anywhere says how many it was meant to cover, so the shortfall is invisible. The
   * patient is then billed out-of-pocket for tests the HMO had in fact approved, which is a
   * billing dispute discovered weeks later rather than an error caught at the desk.
   *
   * `ownershipAlreadyAsserted` is set only by the booking flow, which minted these visit_tests
   * itself from a patient whose ownership it asserted before opening the transaction. Re-checking
   * there would be a redundant query issued while the slot's advisory lock is held.
   */
  async createRequest(
    { hmoProviderId, approvalCode, memberNumber = null, visitTestIds, cardFile = null, referral = null },
    requestingUser,
    { ownershipAlreadyAsserted = false } = {}
  ) {
    if (!ownershipAlreadyAsserted) {
      await assertClientOwnsVisitTests(requestingUser, visitTestIds);
    }

    const card = resolveCardEvidence(requestingUser, cardFile);

    // Joins the caller's transaction when there is one (the booking flow), and opens its own when
    // there is not (POST /hmo/request) — see db.withTransaction's nesting rule.
    return await db.withTransaction(async () => {
      // The referring physician, checked here rather than only in the booking controller — for
      // the same reason the card rule lives in this service. POST /hmo/request reaches this too,
      // and reception filing a claim at the desk against a walk-in registered ten minutes ago is
      // the ordinary case: the visit exists and has no physician on it yet, because nothing
      // required one until the claim was made.
      await this.assertVisitNamesReferrer(visitTestIds, referral);

      const request = await hmoRepository.createRequestWithTests({
        hmoProviderId,
        approvalCode,
        // Trimmed to null rather than stored as ''. An empty string reads as "we recorded a
        // member number and it is blank", which is a different and untrue statement from "no
        // number was given".
        memberNumber: String(memberNumber || '').trim() || null,
        visitTestIds: [...new Set(visitTestIds)],
        card
      });

      // Approving coverage is already audited; the evidence the approval rests on should be too.
      // Inside the transaction for the same reason resultService audits an amendment inside its
      // own: an entry attesting to evidence for a claim that was then rolled back is worse than
      // no entry, because the log's whole value is being trustworthy.
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'hmo_request.evidence_recorded',
        entityType: 'hmo_request',
        entityId: request.id,
        description: card.filePath
          ? 'HMO card image attached to the claim'
          : 'Physical HMO card confirmed at the desk'
      });

      return request;
    });
  }

  // Streams the card image back. Never a static path: an HMO card carries a name, a member
  // number and often a photo. Mirrors resultService.getResultFile, including the deliberate
  // handling of a row that says a file exists when the disk disagrees.
  /**
   * Streams the HMO card image back, ownership-checked.
   *
   * @param {number} requestId
   * @param {object} requestingUser  Staff on `hmo:read`; a Client only for their own claim.
   * @returns {Promise<object>} The stored path, original name and mime type.
   *
   * A card carries a member number, a name and usually a photograph, so it is never served
   * statically and `pruneHmoCards.js` ages it out — it is insurance evidence, not a medical record.
   */
  async getCardFile(requestId, requestingUser) {
    const row = await hmoRepository.findCardByRequestId(requestId);
    if (!row) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    if (requestingUser?.roles?.includes(CLIENT_ROLE)) {
      // Exactly one owner, and it has to be them. A claim spanning two patients — impossible for
      // anything filed since the single-visit rule, but not for older rows — belongs to neither
      // of them as far as this route is concerned.
      const owners = row.patient_user_ids || [];
      if (owners.length !== 1 || owners[0] !== requestingUser.userId) {
        const error = new Error('Access forbidden. This HMO request does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    }

    if (row.card_purged_at) {
      const error = new Error('This card image was removed under the clinic\'s retention policy.');
      error.statusCode = 410;
      throw error;
    }

    if (!row.card_file_path) {
      const error = new Error('No card image was attached to this request. It was confirmed in person at the desk.');
      error.statusCode = 404;
      throw error;
    }

    const absolutePath = path.join(HMO_CARD_UPLOAD_ROOT, row.card_file_path);
    if (!fs.existsSync(absolutePath)) {
      const error = new Error('The card image could not be found on the server.');
      error.statusCode = 404;
      throw error;
    }

    return {
      absolutePath,
      originalName: row.card_original_name || 'hmo-card',
      mimeType: row.card_mime_type || 'application/octet-stream'
    };
  }

  // UI/UX Modernization Phase 12: now Admin/SuperAdmin-only (see hmoRoutes.js) — audit-logged
  // like this app's other sensitive actions (payment refunds, staff account changes), since
  // approving HMO coverage is exactly the kind of decision that should leave a trace of who
  // signed off and when.
  /**
   * Approves a whole HMO claim.
   *
   * @param {number} id
   * @param {object} params
   * @param {string} params.approvalCode  The insurer's own authorisation number — the evidence
   *   the clinic bills against later, outside this system.
   * @param {object} requestingUser  Needs `hmo:approve`; recorded as the decider.
   * @returns {Promise<object>}
   *
   * Sets `hmo_requests.status` only. The per-test column is decided separately and BOTH decide the
   * money — an HMO routinely clears a claim while refusing one line on it, so a report reading
   * either column alone misstates what is billable.
   */
  async approveRequest(id, { approvalCode }, requestingUser) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }
    assertUndecided(request);

    const approved = await hmoRepository.approveRequest(id, {
      approvalCode,
      decidedBy: requestingUser?.userId ?? null,
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'hmo_request.approved',
      entityType: 'hmo_request',
      entityId: id,
      description: `Approved HMO request for ${request.provider_name} (code: ${approvalCode})`
    });

    await handOffToCashier(request, {
      type: 'success',
      title: 'HMO claim approved',
      detail: `${request.provider_name} approved the claim (code ${approvalCode}). The bill is ready to settle.`,
    });

    return approved;
  }

  /**
   * Turn a whole claim down. [1.28.0]
   *
   * The workflow the clinic runs is: reception raises the claim, an Admin or SuperAdmin decides
   * it, the cashier bills what is left. Only the first and third steps existed. `hmo:approve` is
   * held by Admin and SuperAdmin alone — that part was already right — but the route could only
   * ever say yes, so a claim the provider refused had two outcomes available in practice: approve
   * it anyway, or leave it Pending forever at the top of a worklist that filters on Pending.
   *
   * The reason is required for the same purpose as the per-test one in [1.27.0]: the cashier is
   * the person who has to tell the patient why they are paying, and it is the only field that
   * answers them.
   */
  async rejectRequest(id, { decisionReason }, requestingUser) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }
    assertUndecided(request);

    const reason = String(decisionReason || '').trim();
    if (reason.length < 4) {
      const error = new Error(
        'Say why the claim was turned down. The cashier has to explain the full charge to the ' +
          'patient, who was expecting their HMO to cover it.'
      );
      error.statusCode = 400;
      throw error;
    }

    const rejected = await hmoRepository.rejectRequest(id, {
      decisionReason: reason,
      decidedBy: requestingUser?.userId ?? null,
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'hmo_request.rejected',
      entityType: 'hmo_request',
      entityId: id,
      description: `Rejected HMO request for ${request.provider_name} — ${reason}`
    });

    await handOffToCashier(request, {
      type: 'warning',
      title: 'HMO claim turned down',
      detail: `${request.provider_name} refused the claim — ${reason}. The patient pays in full.`,
    });

    return rejected;
  }

  async updateRequestStatus(id, status) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    return await hmoRepository.updateRequestStatus(id, status);
  }

  async getRequestDetails(id) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    const tests = await hmoRepository.findTestsByRequestId(id);
    return { ...request, tests };
  }

  /**
   * Record the HMO's decision on one test of a claim. [1.27.0]
   *
   * Three things this did not do. It accepted any string and let the CHECK constraint refuse it,
   * so a caller sending 'Denied' — the word the HMOs themselves use — got a 500 with no hint that
   * the vocabulary here is 'Rejected'. It recorded neither who decided nor when, alone among the
   * money-moving actions in this system. And it took a rejection with no reason, which is the
   * only field the front desk actually needs: an approval explains itself, a rejection is a
   * conversation at the counter about 1,500 pesos the patient was not expecting to pay.
   */
  async updateTestApproval(hmoRequestTestId, approvalStatus, requestingUser, decisionReason = null) {
    if (!HMO_TEST_DECISIONS.includes(approvalStatus)) {
      const error = new Error(
        `'${approvalStatus}' is not a decision this system records. Use one of: ${HMO_TEST_DECISIONS.join(', ')}.`
      );
      error.statusCode = 400;
      throw error;
    }

    const reason = String(decisionReason || '').trim();
    if (approvalStatus === 'Rejected' && reason.length < 4) {
      const error = new Error(
        'Say why the HMO refused this test. The cashier has to explain the charge to the patient, ' +
          'and the patient may query it days later.'
      );
      error.statusCode = 400;
      throw error;
    }

    const updated = await hmoRepository.updateTestApprovalStatus(hmoRequestTestId, approvalStatus, {
      // A reason on an approval would read as a caveat on cover the HMO did not attach; the field
      // is cleared so the column holds refusals only, which is what anyone reading it expects.
      decisionReason: approvalStatus === 'Rejected' ? reason : null,
      decidedBy: requestingUser?.userId ?? null,
    });

    if (!updated) {
      const error = new Error('That test is not on this claim.');
      error.statusCode = 404;
      throw error;
    }

    await auditService.log({
      actorId: requestingUser?.userId,
      action: approvalStatus === 'Approved' ? 'hmo_request_test.approved' : 'hmo_request_test.rejected',
      entityType: 'hmo_request_test',
      entityId: hmoRequestTestId,
      description:
        `Set test approval status to ${approvalStatus} for HMO request test #${hmoRequestTestId}` +
        (approvalStatus === 'Rejected' ? ` — ${reason}` : '')
    });

    return updated;
  }

  async getAllRequests({ status, page, limit } = {}) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : null;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    const rows = await hmoRepository.findAllRequests({
      status,
      limit: limitNum,
      offset: limitNum ? (pageNum - 1) * limitNum : 0,
    });

    if (!limitNum) return rows;
    return {
      requests: Array.from(rows),
      total: rows.total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(rows.total / limitNum)),
    };
  }

  async getProviders() {
    return await hmoRepository.findAllProviders();
  }

  async createProvider(name, requestingUser) {
    if (!name || !name.trim()) {
      const error = new Error('Provider name is required.');
      error.statusCode = 400;
      throw error;
    }

    try {
      const provider = await hmoRepository.createProvider(name.trim());
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'hmo_provider.created',
        entityType: 'hmo_provider',
        entityId: provider.id,
        description: `Added HMO provider "${provider.name}"`
      });
      return provider;
    } catch (err) {
      if (err.code === '23505') {
        const error = new Error(`An HMO provider named "${name.trim()}" already exists.`);
        error.statusCode = 409;
        throw error;
      }
      throw err;
    }
  }

  async updateProvider(id, { name, isActive }, requestingUser) {
    const provider = await hmoRepository.findProviderById(id);
    if (!provider) {
      const error = new Error('HMO provider not found');
      error.statusCode = 404;
      throw error;
    }

    try {
      const updated = await hmoRepository.updateProvider(id, {
        name: name ? name.trim() : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : undefined
      });

      const changeDescription = typeof isActive === 'boolean' && isActive !== provider.is_active
        ? `${isActive ? 'Activated' : 'Deactivated'} HMO provider "${provider.name}"`
        : `Renamed HMO provider "${provider.name}" to "${updated.name}"`;
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'hmo_provider.updated',
        entityType: 'hmo_provider',
        entityId: id,
        description: changeDescription
      });

      return updated;
    } catch (err) {
      if (err.code === '23505') {
        const error = new Error(`An HMO provider named "${name.trim()}" already exists.`);
        error.statusCode = 409;
        throw error;
      }
      throw err;
    }
  }
}

module.exports = new HmoService();
