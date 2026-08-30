// Mirrors backend/src/controllers/patientController.js's authoritative required-field list
// (patientTypeId, firstName, lastName, birthdate, sex), which itself mirrors the NOT NULL
// columns on the `patients` table in database/schema.sql.
export function validatePatientProfile({ patientTypeId, firstName, lastName, birthdate, sex, email }) {
  if (
    !patientTypeId ||
    !String(firstName ?? '').trim() ||
    !String(lastName ?? '').trim() ||
    !birthdate ||
    !sex
  ) {
    return 'Patient type, first name, last name, birthdate, and sex are required.';
  }

  // Optional, and it stays optional — a patient entitled to their result is never turned away for
  // not having email. But when one IS given it is where a medical report will be sent, so a slip
  // at the counter is worth catching while the patient is still standing there.
  //
  // A MIRROR of normaliseEmail in backend/src/services/patientService.js, which is authoritative.
  // This exists to save a round-trip, not to be the check: the server refuses a bad address
  // whatever this file says.
  const trimmed = String(email ?? '').trim();
  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'That email address does not look right. Check it, or leave it blank.';
  }

  return null;
}
