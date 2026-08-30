const visitRepository = require('../repositories/visitRepository');
const { VISIT_TYPES, VISIT_STATUSES } = require('../constants/visits');
const notificationService = require('./notificationService');
const patientRepository = require('../repositories/patientRepository');
const { assertReferralIfRequired, normaliseReferral } = require('./referralService');
const { staffRolesForCategories } = require('../constants/modality');
const queueEstimateService = require('./queueEstimateService');

const VALID_VISIT_STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];

// Why a visit could not be released, in a form the caller can turn into a message. Kept as
// codes rather than prose so the payment path, the check-in path and the manual-status path
// can each phrase the same condition in terms their own user understands.
const RELEASE_BLOCKED = {
  UNPAID: 'unpaid',
  UNCONFIRMED: 'unconfirmed',
  ALREADY_RELEASED: 'already_released',
  NOT_RELEASABLE: 'not_releasable'
};

class VisitService {
  /**
   * Opens a visit and issues its queue ticket.
   *
   * @param {object} params
   * @param {number} params.patientId
   * @param {string} params.visitType  'Walk in' | 'Appointment' (`chk_visits_type`).
   * @param {string} [params.notes]
   * @param {number} params.createdBy   Whoever opened it — a receptionist, or the patient
   *   themselves when booking online. Reports that count staff throughput must exclude the latter.
   * @param {string} [params.referringPhysician]
   * @param {string} [params.referringPhysicianPrc]
   * @returns {Promise<object>} The visit, carrying its `queue_number`.
   *
   * The ticket comes from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, not
   * from `COUNT(*) + 1`: counting races between two receptionists and rewinds when a visit is
   * cancelled, handing a number to two different patients.
   */
  async registerVisit({ patientId, visitType, notes, createdBy, referringPhysician, referringPhysicianPrc }) {
    const referral = normaliseReferral({ referringPhysician, referringPhysicianPrc });

    // A 'Private' patient is by definition one a physician referred, so the record has to say who.
    // Checked before the queue number is drawn: daily_counters hands out a number that is never
    // reused, so failing after it has been taken burns a ticket number the patient never saw.
    //
    // Straight to the repository rather than through patientService.getPatientById — this wants
    // the patient's type, not a department-scoped read, and calling the scoped helper with no
    // requesting user would look like the scoping had been considered and waived.
    const patient = await patientRepository.findPatientById(patientId);
    assertReferralIfRequired({
      patientTypeName: patient?.patient_type_name,
      hasHmoClaim: false,
      referringPhysician: referral.referringPhysician,
    });

    // Generate daily queue number
    const queueNumber = await visitRepository.getNextQueueNumber();

    const visit = await visitRepository.createVisit({
      patientId,
      visitType,
      notes,
      queueNumber,
      createdBy,
      ...referral
    });

    return visit;
  }

  async getActiveVisits({ search, status, page, limit } = {}) {
    const opts = {};
    if (search) opts.search = search;
    if (status) opts.status = status;

    let pageNum, limitNum;
    if (limit != null) {
      limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
      pageNum = Math.max(parseInt(page, 10) || 1, 1);
      opts.limit = limitNum;
      opts.offset = (pageNum - 1) * limitNum;
    }

    const result = await visitRepository.findActiveVisits(opts);

    // [1.62.0] "You are number 12" is not an answer to the question every person holding a ticket
    // is actually asking. The repository supplies the queue position; the estimate is added here
    // because it depends on a clinic-wide service rate that has nothing to do with this query.
    //
    // Additive only — `visits` keeps every field it had, so nothing that reads this response has
    // to change, and a screen that ignores the new fields behaves exactly as it did.
    const visits = await queueEstimateService.annotate(result.visits);

    if (limitNum) {
      return { ...result, visits, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(result.total / limitNum)) };
    }
    return { ...result, visits };
  }

  // The date default is derived in SQL, not here. [1.29.0]
  //
  // This read `new Date().toISOString().slice(0, 10)`, which is the UTC date — so between
  // midnight and 08:00 Philippine time it is YESTERDAY, silently, with no error. Opening Visit
  // History early in the morning showed the previous day's visits and called them today's.
  // CLAUDE.md records this bug shipping twice already (four dashboard helpers, and the receipt
  // number generator); this was the third place. `null` reaches the repository, which falls back
  // to CURRENT_DATE — the database's own local date, which is what every other date filter here
  // compares against.
  async getVisitHistoryByDateRange({ startDate, endDate, search, visitType, status, page, limit }) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : null;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    // Allow-listed rather than passed through. Both columns are constrained in the database, so
    // an unknown value could only ever return nothing — and an empty screen is indistinguishable
    // from a quiet day, which is how a typo in a query string becomes "the clinic saw nobody".
    // Anything unrecognised is dropped, so the filter is simply not applied.
    const type = VISIT_TYPES.includes(visitType) ? visitType : null;
    const visitStatus = VISIT_STATUSES.includes(status) ? status : null;

    const result = await visitRepository.findVisitsByDateRange({
      startDate: startDate || null,
      endDate: endDate || null,
      search,
      visitType: type,
      status: visitStatus,
      limit: limitNum,
      offset: limitNum ? (pageNum - 1) * limitNum : 0,
    });

    if (!limitNum) return result;
    return { ...result, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(result.total / limitNum)) };
  }

  /**
   * One visit, with its attached tests.
   *
   * @param {number} id
   * @returns {Promise<object|null>}
   */
  async getVisitById(id) {
    const visit = await visitRepository.findVisitById(id);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }
    return visit;
  }

  /**
   * THE release rule. A visit becomes 'Processing' — which is the single thing that makes its
   * tickets visible to the Ultrasound/X-Ray/Laboratory worklists — only when BOTH hold:
   *
   *   1. the visit has a 'Paid' payment (online via GCash/Maya, or recorded at the counter),
   *   2. staff have confirmed it: an Appointment must have been QR-scanned/checked in by a
   *      receptionist; a walk-in is confirmed by having been registered at the front desk.
   *
   * Whichever condition is satisfied last triggers the release, so both real-world routes
   * converge here:
   *
   *   Online   : book -> pay (GCash/Maya) -> receptionist scans QR  -> released
   *   Walk-in  : register at desk -> cashier confirms payment       -> released
   *
   * Idempotent and safe to call speculatively from either path — it reports what happened
   * rather than throwing, because "not ready yet" is a normal outcome, not an error.
   */
  async releaseVisitIfReady(visitId) {
    const readiness = await visitRepository.findReleaseReadiness(visitId);
    if (!readiness) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    if (readiness.status === 'Processing') {
      return { released: false, reason: RELEASE_BLOCKED.ALREADY_RELEASED, visit: readiness };
    }
    if (readiness.status !== 'Pending') {
      return { released: false, reason: RELEASE_BLOCKED.NOT_RELEASABLE, visit: readiness };
    }
    if (!readiness.is_paid) {
      return { released: false, reason: RELEASE_BLOCKED.UNPAID, visit: readiness };
    }
    if (!readiness.is_confirmed) {
      return { released: false, reason: RELEASE_BLOCKED.UNCONFIRMED, visit: readiness };
    }

    const visit = await visitRepository.releaseVisitToModalities(visitId);
    if (!visit) {
      // Lost the race to a concurrent caller, which has already sent the notification.
      return { released: false, reason: RELEASE_BLOCKED.ALREADY_RELEASED, visit: readiness };
    }

    await this.notifyModalitiesOfRelease(visitId, readiness);
    return { released: true, visit };
  }

  // "The ticket pops up for the appointed modality" — routed by the categories actually
  // attached to this visit, so an Ultrasound department isn't paged about a blood test.
  // Receptionist is included because the front desk owns the queue board and needs to see the
  // ticket move off their side. Fire-and-forget, like every other notifyRoles call.
  async notifyModalitiesOfRelease(visitId, visitInfo) {
    const categories = await visitRepository.findTestCategoriesForVisit(visitId);
    const modalityRoles = staffRolesForCategories(categories);
    if (modalityRoles.length === 0) return;

    await notificationService.notifyRoles([...modalityRoles, 'Receptionist'], {
      title: 'Ticket Released to Your Department',
      message: `Queue #${visitInfo.queue_number} — ${visitInfo.first_name} ${visitInfo.last_name} (${categories.join(', ')})`,
      type: 'info'
    });
  }

  /**
   * Changes a visit's status, refusing the transitions that would break billing or release.
   *
   * @param {number} id
   * @param {string} status  One of `VISIT_STATUSES`.
   * @param {object} requestingUser
   * @returns {Promise<object>}
   *
   * A receptionist cannot set 'Processing' to push an unpaid visit onto a worklist — release is
   * the payment's job, and allowing it here would be a way round the ticket-release gate.
   */
  async updateStatus(id, status, requestingUser) {
    if (!VALID_VISIT_STATUSES.includes(status)) {
      const error = new Error(`Invalid visit status. Must be one of: ${VALID_VISIT_STATUSES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const visit = await visitRepository.findVisitById(id);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    // 'Processing' is not a status anyone gets to set by hand — it means "released to the
    // modalities", and that decision belongs to the release rule alone. Without this guard the
    // gate is only a UI convention: any receptionist token could PATCH an unpaid, unconfirmed
    // visit straight onto the Ultrasound worklist. SuperAdmin/Admin may still force it,
    // matching the RBAC bypass convention used throughout this codebase.
    const isPrivileged = requestingUser?.roles?.some((r) => r === 'SuperAdmin' || r === 'Admin');
    if (status === 'Processing') {
      if (!isPrivileged) {
        const outcome = await this.releaseVisitIfReady(id);
        if (outcome.released) return outcome.visit;
        if (outcome.reason === RELEASE_BLOCKED.ALREADY_RELEASED) return visit;

        const error = new Error(
          outcome.reason === RELEASE_BLOCKED.UNPAID
            ? 'This visit cannot be sent to the modalities until payment is confirmed.'
            : outcome.reason === RELEASE_BLOCKED.UNCONFIRMED
              ? 'This appointment must be checked in at the front desk before it can be sent to the modalities.'
              : `A ${visit.status} visit cannot be sent to the modalities.`
        );
        error.statusCode = 409;
        throw error;
      }

      // Privileged override: still perform the real release (the same atomic write that flips
      // visit_tests from Pending/Approved to Processing), just without the payment/confirmation
      // gate. A bare `updateVisitStatus` here would only flip patient_visits.status, leaving
      // every visit_test behind at 'Pending'/'Approved' — invisible to findPendingByCategory's
      // `vt.status IN ('Processing', 'Waiting for Release')` filter — so the override would look
      // like it worked while no ticket actually reached any modality worklist.
      if (visit.status === 'Pending') {
        const released = await visitRepository.releaseVisitToModalities(id);
        if (released) {
          await this.notifyModalitiesOfRelease(id, visit);
          return released;
        }
      }
    }

    return await visitRepository.updateVisitStatus(id, status);
  }

  /**
   * Every visit for one patient, newest first.
   *
   * @param {number} patientId  A patient profile, not an account — an account may own several.
   * @returns {Promise<Array>}
   */
  async getVisitHistory(patientId) {
    return await visitRepository.findVisitsByPatientId(patientId);
  }

  /**
   * "How busy is the clinic right now?" — for the public site. [1.63.0]
   *
   * ── Why this is safe to publish ─────────────────────────────────────────────────────────
   *
   * It is a count and an estimate. No name, no queue number, no id, nothing joinable to a person
   * — the repository query selects two integers, deliberately. A clinic waiting-room display and
   * a restaurant's "20 minute wait" sign carry the same information, and it is the information a
   * patient needs to decide whether to set off now or after lunch.
   *
   * That reasoning does NOT extend to anything richer. A public endpoint that named who was
   * waiting, or how long a specific ticket had been there, would be a PHI leak wearing a
   * convenience feature's clothes.
   *
   * ── It reuses the same estimator the queue screens use ──────────────────────────────────
   *
   * Not a second calculation. A patient who reads "about 25 minutes" on the public page and is
   * then told something different at the desk has been misled by the clinic twice in ten minutes,
   * and the fix for that is one estimator rather than two that agree today.
   *
   * @returns {Promise<{waiting:number, inProgress:number, estimatedWaitMinutes:number|null,
   *                    estimateIsCapped:boolean, estimateBasis:string, asOf:string}>}
   */
  async getPublicQueueStatus() {
    const counts = await visitRepository.countActiveForPublicStatus();
    const waiting = Number(counts.waiting) || 0;

    // A patient arriving now joins the BACK of the queue, so everyone currently waiting is ahead
    // of them. Passing `waiting` rather than `waiting - 1` is the whole difference between "how
    // long have these people waited" and "how long would I wait".
    const rate = await queueEstimateService.getServiceRate();
    const estimate = queueEstimateService.estimateFor(waiting, rate);

    return {
      waiting,
      inProgress: Number(counts.in_progress) || 0,
      estimatedWaitMinutes: estimate.estimated_wait_minutes,
      estimateIsCapped: estimate.estimate_is_capped,
      estimateBasis: estimate.estimate_basis,
      asOf: new Date().toISOString(),
    };
  }
}

module.exports = new VisitService();
module.exports.RELEASE_BLOCKED = RELEASE_BLOCKED;
