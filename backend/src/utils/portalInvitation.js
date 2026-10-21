/**
 * The rules of a portal invitation, and of taking a record back out of an account. [1.136.0]
 *
 * Pure functions only — no database, no clock of their own — so every rule the clinic agreed is
 * unit-tested (tests/unit/portalInvitation.test.js). The service reads the rows and asks these.
 *
 * ── Who agrees ──────────────────────────────────────────────────────────────────────────────
 *
 * The age of 18 decides only who agrees for the PATIENT, never how old a helper or a family manager
 * is: nothing records a manager's age, and a grandchild of 15 setting up Lola's account is the
 * ordinary case. So:
 *
 *   patient under 18      their parent or guardian agrees (`guardian_of_minor`), and the address
 *                         is the patient's own or that parent's/guardian's
 *   patient 18 or over    their own address: nothing more to agree (`own_address`); the address
 *                         of a family member: the patient says yes themselves, at the counter or
 *                         by phone, or the family member is responsible for a patient who cannot
 *                         decide
 */

const INVITE_TTL_DAYS = 14;
const MAX_BIRTHDATE_ATTEMPTS = 3;
const RESEND_COOLDOWN_SECONDS = 60;
/** The first email and three more. */
const MAX_SENDS = 4;
/** For this long after an unlink, whoever unlinked may not send the record's next invitation. */
const TWO_PERSON_DAYS = 30;
const ADULT_AGE = 18;

/** What the address's owner is to the patient. Mirrors chk_patient_invitations_relationship. */
const RELATIONSHIPS = {
  self: 'The patient themselves',
  parent_guardian: 'Parent or guardian',
  child: 'Son or daughter',
  grandchild: 'Grandchild',
  spouse: 'Husband or wife',
  sibling: 'Brother or sister',
  other_family: 'Other family member',
  caregiver: 'Caregiver',
};

/** Who agreed, as the desk recorded it. Mirrors chk_patient_invitations_consent. */
const CONSENT_BASES = {
  own_address: "It is the patient's own address",
  patient_in_person: 'The patient agreed, here at the clinic',
  patient_by_phone: 'The patient agreed by phone',
  guardian_of_minor: 'Their parent or guardian agreed (patient under 18)',
  responsible_for_patient: 'The patient cannot decide; this family member is responsible for them',
};

const ADULT_FAMILY_CONSENT = ['patient_in_person', 'patient_by_phone', 'responsible_for_patient'];

/** Unlink reasons. Urgent ones go through even with work open; planned ones wait for it. */
const UNLINK_REASONS = {
  linked_in_error: { label: 'Linked to the wrong account by mistake', urgent: true },
  account_compromised: { label: 'Someone else has got into the account', urgent: true },
  consent_withdrawn: { label: 'The patient no longer agrees to this account seeing their record', urgent: true },
  moving_to_another_manager: { label: 'Another family member is taking over', urgent: false },
  patient_wants_own_account: { label: 'The patient wants their own account', urgent: false },
  other: { label: 'Something else', urgent: false },
};
/** Urgent reasons that also forbid keeping the old account's address on the record. */
const MUST_CLEAR_EMAIL = ['linked_in_error', 'account_compromised'];
const MIN_NOTE_LENGTH = 10;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole years from `birthdate` to `today`, both 'YYYY-MM-DD'. */
function ageOn(birthdate, today) {
  if (!DATE_ONLY.test(String(birthdate)) || !DATE_ONLY.test(String(today))) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

const isMinor = (birthdate, today) => {
  const age = ageOn(birthdate, today);
  return age !== null && age < ADULT_AGE;
};

/**
 * What is wrong with an invitation the desk is about to send, as one sentence, or null.
 *
 * @param {object} input
 * @param {string} input.relationship
 * @param {string} [input.recipientName]
 * @param {string} input.consentBasis
 * @param {boolean} input.confirmed   the desk's tick: the address was read back and agreed to
 * @param {string} input.patientBirthdate  'YYYY-MM-DD'
 * @param {string} input.today             'YYYY-MM-DD'
 */
function validateInvite({ relationship, recipientName, consentBasis, confirmed, patientBirthdate, today }) {
  if (!RELATIONSHIPS[relationship]) return 'Choose whose address this is.';
  if (!CONSENT_BASES[consentBasis]) return 'Choose who agreed to this.';
  if (confirmed !== true) return 'Read the address back and confirm they agreed before sending.';

  const name = String(recipientName ?? '').trim();
  if (relationship !== 'self' && !name) return 'Give the name of the person whose address this is.';
  if (name.length > 150) return 'That name is too long.';

  if (isMinor(patientBirthdate, today)) {
    if (consentBasis !== 'guardian_of_minor') {
      return 'This patient is under 18, so their parent or guardian agrees for them.';
    }
    if (relationship !== 'self' && relationship !== 'parent_guardian') {
      return "A patient under 18 is invited at their own address or their parent's or guardian's.";
    }
    return null;
  }

  if (consentBasis === 'guardian_of_minor') {
    return 'This patient is 18 or over, so they agree for themselves.';
  }
  if (relationship === 'self' && consentBasis !== 'own_address') {
    return "The patient's own address needs nothing more agreed.";
  }
  if (relationship !== 'self' && !ADULT_FAMILY_CONSENT.includes(consentBasis)) {
    return "Another person's address needs the patient's own yes, in person or by phone.";
  }
  return null;
}

/** An invitation still waiting: not accepted, not revoked, not expired. */
function isOpen(invitation, now) {
  if (!invitation || invitation.accepted_at || invitation.revoked_at) return false;
  return new Date(invitation.expires_at).getTime() > now.getTime();
}

/**
 * Whether this account may accept this invitation, before its birthdate is checked.
 *
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
function acceptDecision({ invitation, account, patient, now, today }) {
  const refuse = (status, message) => ({ ok: false, status, message });
  if (!invitation || invitation.accepted_at || invitation.revoked_at) {
    return refuse(410, 'This invitation has ended. Ask the clinic for a new one.');
  }
  if (new Date(invitation.expires_at).getTime() <= now.getTime()) {
    return refuse(410, 'This invitation has run out. Ask the clinic for a new one.');
  }
  const roles = account?.roles || [];
  if (!account || !account.status || !roles.includes('Client') || roles.some((r) => r !== 'Client')) {
    return refuse(403, 'Only a patient account can accept a record.');
  }
  if (String(account.email).toLowerCase() !== String(invitation.email).toLowerCase()) {
    return refuse(403, 'This invitation is for another address.');
  }
  if (!account.email_verified_at) {
    return refuse(409, 'Confirm your email address first.');
  }
  if (!patient || patient.archived_at) {
    return refuse(410, 'This record is no longer available. Ask the clinic.');
  }
  if (patient.user_id) {
    return refuse(409, 'This record is already in a portal account.');
  }
  if (invitation.consent_basis === 'guardian_of_minor' && !isMinor(patient.birthdate, today)) {
    return refuse(410, 'This patient has turned 18 since the invitation was sent, so they agree for themselves now. Ask the clinic for a new invitation.');
  }
  if (invitation.birthdate_attempts >= MAX_BIRTHDATE_ATTEMPTS) {
    return refuse(410, 'This invitation is locked after too many wrong dates of birth. Ask the clinic for a new one.');
  }
  return { ok: true };
}

/** The date of birth as typed against the record's, both 'YYYY-MM-DD'. */
const birthdateMatches = (given, stored) => DATE_ONLY.test(String(given)) && String(given) === String(stored);

/** True when the two-person rule stops `actorId` from inviting this record now. */
function twoPersonBlocked({ unlinkedAt, unlinkedBy, actorId, now }) {
  if (!unlinkedAt || unlinkedBy == null) return false;
  if (String(unlinkedBy) !== String(actorId)) return false;
  const age = now.getTime() - new Date(unlinkedAt).getTime();
  return age < TWO_PERSON_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Whether an unlink may go ahead, as the service will be asked it.
 *
 * @param {object} input
 * @param {string} input.reasonKind
 * @param {string} input.note
 * @param {string[]} input.openWork       sentences: what is still open for this patient
 * @param {boolean} input.recordEmailIsAccount  the record's own address is the old account's
 * @param {string} [input.recordEmail]    'clear' | 'keep', required when the above is true
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
function unlinkPolicy({ reasonKind, note, openWork = [], recordEmailIsAccount = false, recordEmail }) {
  const refuse = (status, message) => ({ ok: false, status, message });
  const reason = UNLINK_REASONS[reasonKind];
  if (!reason) return refuse(400, 'Choose why the record is being unlinked.');
  if (String(note ?? '').trim().length < MIN_NOTE_LENGTH) {
    return refuse(400, `Say what happened, in at least ${MIN_NOTE_LENGTH} characters.`);
  }
  if (String(note).length > 500) return refuse(400, 'Keep the note under 500 characters.');
  if (!reason.urgent && openWork.length > 0) {
    return refuse(409, `Finish or move what is still open first: ${openWork.join('; ')}.`);
  }
  if (recordEmailIsAccount) {
    if (recordEmail !== 'clear' && recordEmail !== 'keep') {
      return refuse(400, "The record's email is the account's address. Choose whether to clear it or keep it.");
    }
    if (recordEmail === 'keep' && MUST_CLEAR_EMAIL.includes(reasonKind)) {
      return refuse(400, "Clear the record's email: results sent there would still reach the account being removed.");
    }
  }
  return { ok: true };
}

/** "Maria D." — enough for a household to know whose record it is, and no more. */
function shortName(firstName, lastName) {
  const first = String(firstName || '').trim();
  const initial = String(lastName || '').trim().charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

module.exports = {
  INVITE_TTL_DAYS,
  MAX_BIRTHDATE_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS,
  TWO_PERSON_DAYS,
  ADULT_AGE,
  RELATIONSHIPS,
  CONSENT_BASES,
  UNLINK_REASONS,
  MIN_NOTE_LENGTH,
  ageOn,
  isMinor,
  validateInvite,
  isOpen,
  acceptDecision,
  birthdateMatches,
  twoPersonBlocked,
  unlinkPolicy,
  shortName,
};
