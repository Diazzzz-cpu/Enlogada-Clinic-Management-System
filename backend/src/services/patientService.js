const patientRepository = require('../repositories/patientRepository');
const auditService = require('./auditService');

/**
 * Which columns an edit may touch, and what to call them in the log.
 *
 * birthdate and sex lead deliberately: they are the two that change how a result is read, not just
 * how the patient is contacted.
 */
const AUDITED_FIELDS = [
  ['birthdate', 'Birthdate'],
  ['sex', 'Sex'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['patient_type_id', 'Patient type'],
  ['contact_number', 'Contact number'],
  ['address', 'Address'],
  ['emergency_contact', 'Emergency contact'],
  // Audited like any other contact detail, and for a sharper reason than most: this is where a
  // medical report gets sent. A wrong address here delivers someone's results to a stranger, and
  // "what did it say before?" is the first question asked afterwards.
  ['email', 'Email'],
];

/** A DATE comes back as a Date object; everything else is a string or null. Compare as text. */
const asText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value);
};

/** "Birthdate 1990-01-01 → 1990-02-01" for each field that actually moved. */
function describeChanges(before, after) {
  const changes = [];
  for (const [column, label] of AUDITED_FIELDS) {
    const from = asText(before?.[column]);
    const to = asText(after?.[column]);
    if (from !== to) changes.push(`${label} ${from || '(blank)'} → ${to || '(blank)'}`);
  }
  return changes;
}

/**
 * Which departments confine this caller's view of the roster, or `null` for no confinement.
 * [1.21.0]
 *
 * Expressed as a permission rather than a role check, because the clinic needs to be able to say
 * "this one lab tech also covers reception on Saturdays" without inventing a role — and because a
 * hardcoded `roles.includes('Admin')` exemption is exactly the kind of rule that made the
 * permission matrix advisory in the first place.
 *
 * A Client is not confined here at all: their view is bounded by patient *ownership*, checked in
 * patientController before this is ever consulted, and they are entitled to all of their own
 * records regardless of which room produced them.
 */
function departmentScopeFor(requestingUser) {
  const roles = requestingUser?.roles || [];
  if (roles.includes('Client')) return null;
  if ((requestingUser?.permissions || []).includes('patients:read_all_departments')) return null;
  // `departments` is null for SuperAdmin/Admin, so this is null for them too.
  return requestingUser?.departments ?? null;
}

/**
 * An address a result can actually be sent to, or null. [1.60.0]
 *
 * Deliberately permissive about what an address may look like and strict about it being present:
 * the check exists to catch a slip at the counter (a missing @, a trailing comma from a form),
 * not to adjudicate RFC 5322. Rejecting an unusual but valid address would turn "we can email
 * your results" into "we cannot", which is the worse failure.
 *
 * Blank normalises to NULL rather than '', so "no address" has exactly one representation and
 * the COALESCE in resultRepository behaves. NULLIF there covers the rows that predate this.
 */
function normaliseEmail(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const error = new Error('That email address does not look right. Check it, or leave it blank.');
    error.statusCode = 400;
    throw error;
  }
  return trimmed;
}

class PatientService {
  async addPatientProfile(userId, patientData) {
    return await patientRepository.createPatient({
      userId,
      ...patientData,
      email: normaliseEmail(patientData.email),
    });
  }

  async getClientPatients(userId) {
    return await patientRepository.findPatientsByUserId(userId);
  }

  /**
   * `requestingUser` is optional so the internal callers that already know what they are doing
   * (the visit flow, the booking wizard) are unaffected. Passed from the controller for the two
   * routes a human hits, which are the ones that need confining.
   */
  async getPatientById(id, requestingUser) {
    const patient = await patientRepository.findPatientById(id);
    if (!patient) {
      const error = new Error('Patient profile not found');
      error.statusCode = 404;
      throw error;
    }

    const scope = requestingUser ? departmentScopeFor(requestingUser) : null;
    if (scope) {
      const covered = await patientRepository.patientHasWorkInDepartments(patient.id, scope);
      if (!covered) {
        // 404, not 403. A 403 confirms the record exists, which is itself a disclosure — "does
        // this clinic have a patient called X" is the question the scoping is there to refuse.
        // Same reasoning the search uses by simply not returning the row.
        const error = new Error('Patient profile not found');
        error.statusCode = 404;
        throw error;
      }
    }

    return patient;
  }

  /**
   * The department scope applies to writes as well as reads, and this is the more important of
   * the two: birthdate and sex are the fields diagnostic reference ranges key off, so editing
   * another department's patient is a clinical-safety question, not only a privacy one.
   *
   * Reusing getPatientById means the read guard and the write guard cannot drift apart — a second
   * copy of the same check is a second thing to forget when the rule changes.
   */
  async updatePatientProfile(id, patientData, requestingUser) {
    const before = await this.getPatientById(id, requestingUser);

    // An omitted field is not an instruction to erase. `updatePatient` writes every column
    // unconditionally, so a caller sending only the fields it cares about would blank the rest —
    // the same defect [1.54.0] found in the Services Catalogue, where a status toggle deleted a
    // test's preparation. Here it would silently discard the address a patient's results go to.
    const email = patientData.email === undefined
      ? (before.email ?? null)
      : normaliseEmail(patientData.email);

    const updated = await patientRepository.updatePatient(id, { ...patientData, email });

    // Audited with a field-level diff, not a bare "patient updated". [1.24.0]
    //
    // Two of these fields are clinical inputs rather than contact details: diagnostic reference
    // ranges are banded by age and by sex, so correcting a birthdate silently re-interprets every
    // result already on that patient's file. "Someone edited this record" does not answer the
    // question that gets asked afterwards, which is always what it said before.
    //
    // Only what actually changed is recorded. Saving a form without touching it is not an event,
    // and logging it anyway is the fan-out mistake that buried notification_reads.
    const changes = describeChanges(before, updated);
    if (changes.length > 0) {
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'patient.updated',
        entityType: 'patient',
        entityId: Number(id),
        description: `${before.first_name} ${before.last_name} (PT-${id}): ${changes.join('; ')}`,
      });
    }

    return updated;
  }

  /**
   * The roster, browsed or searched. [1.56.0]
   *
   * A query is no longer required. It used to be, so the screen opened on "search for a patient
   * to begin" and there was no way to simply LOOK at the records — which is what somebody sitting
   * down to review them wants. Two characters is still the floor when a query IS given, because a
   * single letter matches most of a roster and is a scan wearing a search box.
   */
  async searchPatients(query, requestingUser, { from, to, includeArchived, recordStatus, page, limit } = {}) {
    const trimmed = (query || '').trim();
    if (trimmed && trimmed.length < 2) {
      const error = new Error('Search for at least 2 characters, or clear the box to browse.');
      error.statusCode = 400;
      throw error;
    }

    if ((from && !to) || (to && !from)) {
      const error = new Error('Give both a start and an end date, or neither.');
      error.statusCode = 400;
      throw error;
    }

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);

    // Archived records are hidden from everyone by default and revealed only on request. Whether
    // the CALLER may reveal them is the route's business, not this method's.
    const { patients, total } = await patientRepository.findPatients({
      query: trimmed || null,
      departments: departmentScopeFor(requestingUser),
      from: from || null,
      to: to || null,
      // Allow-listed. An unrecognised value must not reach SQL as a filter that matches nothing
      // — an empty roster reads as "this clinic has no patients", which is a claim, not a result.
      recordStatus: ['complete', 'open'].includes(recordStatus) ? recordStatus : null,
      includeArchived: Boolean(includeArchived),
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    return {
      patients,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    };
  }

  /**
   * Archive a record, or put it back. [1.56.0]
   *
   * Deliberately NOT a delete, and the service refuses to pretend otherwise: nothing is removed,
   * the visits and bills and results all stay, and the record is simply out of the roster the
   * front desk searches. Audited, because hiding somebody's medical record is an editorial act
   * and "who did this" is the first question asked when a record cannot be found.
   */
  async setArchived(patientId, archived, requestingUser) {
    const before = await patientRepository.findPatientById(patientId);
    if (!before) {
      const error = new Error('Patient not found');
      error.statusCode = 404;
      throw error;
    }

    if (Boolean(before.archived_at) === Boolean(archived)) {
      // Not an error — the caller and the record already agree. Returning the row keeps a
      // double-click idempotent rather than turning it into a failure the reader has to read.
      return before;
    }

    const updated = await patientRepository.setPatientArchived(patientId, {
      archived: Boolean(archived),
      actorId: requestingUser?.userId ?? null,
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: archived ? 'patient.archived' : 'patient.restored',
      entityType: 'patient',
      entityId: Number(patientId),
      description: `${before.first_name} ${before.last_name} (PT-${patientId}) ${archived ? 'archived — hidden from the active roster' : 'restored to the active roster'}`,
    });

    return updated;
  }

  /** What the caller is allowed to see, so the UI can say so rather than looking broken. */
  departmentScopeFor(requestingUser) {
    return departmentScopeFor(requestingUser);
  }

  async getPatientTypes() {
    return await patientRepository.findPatientTypes();
  }
}

module.exports = new PatientService();
