/**
 * When a visit must name the doctor who requested the test. [1.23.0]
 *
 * One module because three places ask the question — reception registering a walk-in, a client
 * booking online with HMO coverage, and reception logging an HMO claim against a visit that
 * already exists — and three copies of a rule is how the desk ends up enforcing something the
 * booking form does not, or the reverse. Same reasoning as `isStaffUser` in constants/roles.js.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────────────────────
 * Required when the visit carries an HMO claim: the LOA process runs through the referring
 * physician, and a claim that cannot name one is difficult to reimburse. The clinic is left
 * chasing a doctor's details weeks later, against a patient who has long since gone home.
 *
 * Required for the 'Private' patient type, because at this clinic that type *means* "referred by
 * a private physician" — as opposed to a walk-in. A Private visit with no referring physician is
 * not a gap in the record, it is a record that contradicts itself.
 *
 * Not required for Self Pay. That leaves one case knowingly unenforced — a self-paying walk-in
 * can be given an X-ray with no requesting physician on file, and diagnostic radiography is
 * normally performed on a licensed physician's request regardless of who is paying. If the
 * clinic's licensing says otherwise, the fix is a `requires_referral` flag per test_categories
 * row rather than anything payer-shaped, because the requirement would then be about the
 * modality. Written down in migrations.md [1.23.0] so it stays a decision somebody can revisit.
 */

/** The patient type that means "a physician sent them", as opposed to a walk-in. */
const REFERRED_PATIENT_TYPE = 'Private';

/**
 * Does this visit need a referring physician on it?
 *
 * @param {object} opts
 * @param {string} [opts.patientTypeName] - patient_types.name for the visit's patient.
 * @param {boolean} [opts.hasHmoClaim]    - whether an HMO claim is being filed for it.
 * @returns {{ required: boolean, because: string|null }}
 */
function referralRequirement({ patientTypeName = null, hasHmoClaim = false } = {}) {
  if (hasHmoClaim) {
    return { required: true, because: 'an HMO claim needs the referring physician for the LOA' };
  }
  if (patientTypeName === REFERRED_PATIENT_TYPE) {
    return { required: true, because: `a ${REFERRED_PATIENT_TYPE} patient is one a physician referred` };
  }
  return { required: false, because: null };
}

/** A name with something in it. Whitespace is not a doctor. */
const isNamed = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Throws a 400 when the rule applies and no physician was given.
 *
 * The message says which rule fired, because "referring physician is required" on a form that did
 * not ask for one a moment ago is the kind of error people work around rather than fix.
 *
 * A doctor's signed request on file satisfies it. [1.106.0] It names the doctor, in the doctor's
 * own hand, which is better evidence than the name typed from it — so a patient booking online
 * uploads the paper instead of transcribing it.
 */
function assertReferralIfRequired({ patientTypeName, hasHmoClaim, referringPhysician, hasDoctorRequest = false }) {
  const { required, because } = referralRequirement({ patientTypeName, hasHmoClaim });
  if (required && !isNamed(referringPhysician) && !hasDoctorRequest) {
    const error = new Error(`Please give the referring physician's name — ${because}.`);
    error.statusCode = 400;
    throw error;
  }
}

/**
 * When a patient's own booking must carry the doctor's signed request. [1.107.0]
 *
 * Exactly when `referralRequirement` says the visit must name its referring physician: an HMO
 * claim, whose LOA is issued against that paper, or a Private patient, which means "a physician
 * referred them". The patient no longer types the doctor's name [1.106.0], so on those bookings
 * the paper is the only way they can satisfy the rule, and one predicate keeps the two from
 * drifting apart.
 *
 * Optional for self-pay. [1.107.0] [1.106.0] asked for it on every booking, but a
 * patient paying for their own test is not asked for paperwork the clinic does not need to bill
 * it. A self-pay patient may still attach it, and reception reads it at check-in.
 *
 * Staff are exempt, as for the HMO card: at the desk the patient hands the paper over in person.
 */
function assertDoctorRequestIfRequired({ isStaff, hasDoctorRequest, hasHmoClaim = false, patientTypeName = null }) {
  if (isStaff || hasDoctorRequest) return;
  const { required, because } = referralRequirement({ patientTypeName, hasHmoClaim });
  if (required) {
    const error = new Error(`Please upload your doctor's signed request — ${because}.`);
    error.statusCode = 400;
    throw error;
  }
}

/** Trims a submitted pair down to what should be stored, or nulls. */
function normaliseReferral({ referringPhysician, referringPhysicianPrc } = {}) {
  return {
    referringPhysician: isNamed(referringPhysician) ? referringPhysician.trim().slice(0, 150) : null,
    // A licence number without a name is not evidence of anything, so it is dropped with the name.
    referringPhysicianPrc: isNamed(referringPhysician) && isNamed(referringPhysicianPrc)
      ? referringPhysicianPrc.trim().slice(0, 50)
      : null,
  };
}

module.exports = {
  REFERRED_PATIENT_TYPE,
  referralRequirement,
  assertReferralIfRequired,
  assertDoctorRequestIfRequired,
  normaliseReferral,
  isNamed,
};
