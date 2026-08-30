const patientService = require('../services/patientService');
const auditService = require('../services/auditService');

/**
 * A caller who may not see a record must not learn whether it exists. [1.29.0]
 *
 * `getPatientById` throws 404 when there is no such row, and the ownership check that follows
 * returns 403 when the row exists but belongs to somebody else. For a Client those two answers
 * are distinguishable, so a signed-in patient could walk the id space and count the 403s —
 * learning how many patients the clinic has and exactly which ids are real. That is the
 * reconnaissance step that turns any future ownership slip into a usable one.
 *
 * `/visits/:id` and `/payments/bill/:id` already answer 403 to both, so this brings the other two
 * into line with the pattern the codebase had already settled on rather than inventing one.
 *
 * Staff are deliberately unaffected: they are authorised to know a record does not exist, and a
 * receptionist typing a wrong id needs to be told that rather than accused of overreach.
 */
const PROFILE_FORBIDDEN = 'Access forbidden. This profile does not belong to your account.';

function denyWithoutDisclosing(err, requestingUser) {
  if (requestingUser?.roles?.includes('Client') && err?.statusCode === 404) {
    const masked = new Error(PROFILE_FORBIDDEN);
    masked.statusCode = 403;
    return masked;
  }
  return err;
}


/**
 * A birthdate is a calendar date, and only a calendar date. [1.24.0]
 *
 * `patients.birthdate` is a DATE, but the API serialises it to JSON as a UTC instant — a patient
 * born on 1990-01-01 in Philippine time comes back as "1989-12-31T16:00:00.000Z". Any caller that
 * does the obvious thing, reading a record and writing it back, therefore re-submits the previous
 * day, and the birthdate walks backwards once per save. Silently, with nothing to see.
 *
 * That is not a cosmetic bug. Diagnostic reference ranges are banded by age, so a birthdate that
 * drifts changes how every result on the file is interpreted, and the drift is invisible until
 * somebody notices a patient is a day younger than their own ID says.
 *
 * Refusing anything but YYYY-MM-DD makes the mistake loud at the first attempt rather than
 * gradual. Every legitimate caller already sends this shape — an `<input type="date">` produces
 * it, and so does the seed script — so nothing correct is being turned away.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const rejectBadBirthdate = (birthdate, res) => {
  if (DATE_ONLY.test(String(birthdate))) return false;
  res.status(400).json({
    status: 'error',
    message:
      'Birthdate must be a calendar date in YYYY-MM-DD form. A full timestamp is ambiguous ' +
      'across time zones and would shift the stored date.',
  });
  return true;
};

class PatientController {
  async addProfile(req, res, next) {
    try {
      const { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact, email } = req.body;
      const isClient = req.user?.roles?.includes('Client');
      const linkedUserId = isClient ? req.user.userId : null;

      // Validations
      if (!patientTypeId || !firstName || !lastName || !birthdate || !sex) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient type, first name, last name, birthdate, and sex are required.'
        });
      }
      if (rejectBadBirthdate(birthdate, res)) return undefined;

      const patient = await patientService.addPatientProfile(linkedUserId, {
        patientTypeId,
        firstName,
        lastName,
        birthdate,
        sex,
        address,
        contactNumber,
        emergencyContact,
        // Left undefined when the caller did not send it, which the service reads as "keep what
        // is there" rather than as "clear it".
        email
      });

      return res.status(201).json({
        status: 'success',
        message: 'Patient profile created successfully.',
        data: { patient }
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyProfiles(req, res, next) {
    try {
      const userId = req.user.userId;
      const patients = await patientService.getClientPatients(userId);

      return res.status(200).json({
        status: 'success',
        data: { patients }
      });
    } catch (err) {
      next(err);
    }
  }

  async getProfileById(req, res, next) {
    try {
      const { id } = req.params;
      let patient;
      try {
        patient = await patientService.getPatientById(id, req.user);
      } catch (err) {
        // A Client gets the same 403 whether the record is missing or simply not theirs.
        throw denyWithoutDisclosing(err, req.user);
      }

      // Security Check: If client, verify patient belongs to them
      if (req.user.roles.includes('Client') && patient.user_id !== req.user.userId) {
        return res.status(403).json({
          status: 'error',
          message: PROFILE_FORBIDDEN
        });
      }

      // Logged only for staff. A Client opening their own profile is not an access anyone will
      // ever investigate, and recording it would bury the entries that matter under routine
      // self-service traffic.
      if (!req.user.roles.includes('Client')) {
        await auditService.logPhiRead({
          actorId: req.user.userId,
          patientId: patient.id,
          resource: 'patient_record',
          description: `Viewed the record of ${patient.first_name} ${patient.last_name} (PT-${patient.id})`,
        });
      }

      return res.status(200).json({
        status: 'success',
        data: { patient }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { id } = req.params;
      const { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact, email } = req.body;

      if (!patientTypeId || !firstName || !lastName || !birthdate || !sex) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient type, first name, last name, birthdate, and sex are required.'
        });
      }
      if (rejectBadBirthdate(birthdate, res)) return undefined;

      // Check ownership if user is client. Same masking as the read path: a Client gets 403
      // whether the record is absent or simply somebody else's, so the pair cannot be used to
      // enumerate which ids are real.
      let patient;
      try {
        patient = await patientService.getPatientById(id, req.user);
      } catch (err) {
        throw denyWithoutDisclosing(err, req.user);
      }
      if (req.user.roles.includes('Client') && patient.user_id !== req.user.userId) {
        return res.status(403).json({
          status: 'error',
          message: PROFILE_FORBIDDEN
        });
      }

      const updated = await patientService.updatePatientProfile(id, {
        patientTypeId,
        firstName,
        lastName,
        birthdate,
        sex,
        address,
        contactNumber,
        emergencyContact,
        // Left undefined when the caller did not send it, which the service reads as "keep what
        // is there" rather than as "clear it".
        email
      }, req.user);

      return res.status(200).json({
        status: 'success',
        message: 'Patient profile updated successfully.',
        data: { patient: updated }
      });
    } catch (err) {
      next(err);
    }
  }

  async search(req, res, next) {
    try {
      const { q, from, to, page, limit, includeArchived, recordStatus } = req.query;

      // Only someone who can archive may look at what has been archived. Reading the archive is
      // reading records deliberately taken out of circulation, and the person who cannot put one
      // back has no reason to be shown it.
      const maySeeArchived = (req.user?.roles || []).some((r) => r === 'SuperAdmin' || r === 'Admin');

      const result = await patientService.searchPatients(q, req.user, {
        from, to, page, limit, recordStatus,
        includeArchived: maySeeArchived && String(includeArchived) === 'true',
      });

      // The UI says which departments a scoped result set was confined to, so a short list reads
      // as "your department" rather than "the clinic has no such patient".
      return res.status(200).json({
        status: 'success',
        data: {
          ...result,
          departmentScope: patientService.departmentScopeFor(req.user),
          canArchive: maySeeArchived,
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async setArchived(req, res, next) {
    try {
      const archived = req.body?.archived !== false;
      const patient = await patientService.setArchived(req.params.id, archived, req.user);
      return res.status(200).json({
        status: 'success',
        message: archived
          ? `${patient.first_name} ${patient.last_name} archived. Their visits, bills and results are unchanged.`
          : `${patient.first_name} ${patient.last_name} restored to the active roster.`,
        data: { patient },
      });
    } catch (err) {
      next(err);
    }
  }

  async getTypes(req, res, next) {
    try {
      const types = await patientService.getPatientTypes();
      return res.status(200).json({
        status: 'success',
        data: { patientTypes: types }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PatientController();
