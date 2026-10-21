const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INVITE_TTL_DAYS,
  ageOn,
  isMinor,
  validateInvite,
  isOpen,
  acceptDecision,
  birthdateMatches,
  twoPersonBlocked,
  unlinkPolicy,
  shortName,
} = require('../../src/utils/portalInvitation');

/**
 * The rules the clinic agreed for portal invitations and unlinking. [1.136.0]
 *
 * Who agrees is decided by the PATIENT's age alone: a parent or guardian for a patient under 18,
 * the patient themselves from 18. The age of whoever helps or manages the account is never asked.
 */

const TODAY = '2026-10-21';
const ADULT = '1948-03-03';
const CHILD = '2025-12-01';
const invite = (over) => validateInvite({
  relationship: 'self', consentBasis: 'own_address', confirmed: true,
  patientBirthdate: ADULT, today: TODAY, ...over,
});

test('age counts whole years, and turning 18 on the day counts', () => {
  assert.equal(ageOn('2008-10-21', TODAY), 18);
  assert.equal(ageOn('2008-10-22', TODAY), 17);
  assert.equal(isMinor('2008-10-22', TODAY), true);
  assert.equal(isMinor('2008-10-21', TODAY), false);
  assert.equal(ageOn('not a date', TODAY), null);
});

test("an adult's own address needs nothing more agreed", () => {
  assert.equal(invite(), null);
  assert.match(invite({ consentBasis: 'patient_in_person' }), /own address needs nothing more/);
});

test("an adult's record at a family member's address needs the patient's own yes", () => {
  const family = { relationship: 'child', recipientName: 'Ana Dela Cruz' };
  assert.equal(invite({ ...family, consentBasis: 'patient_in_person' }), null);
  assert.equal(invite({ ...family, consentBasis: 'patient_by_phone' }), null);
  assert.equal(invite({ ...family, consentBasis: 'responsible_for_patient' }), null);
  // A family member's word alone is not the patient's: there is no "own address" for someone else.
  assert.match(invite({ ...family, consentBasis: 'own_address' }), /patient's own yes/);
  assert.match(invite({ relationship: 'child', consentBasis: 'patient_in_person' }), /name of the person/);
});

test('a guardian agrees only for a patient under 18', () => {
  assert.match(
    invite({ relationship: 'parent_guardian', recipientName: 'Ana', consentBasis: 'guardian_of_minor' }),
    /18 or over, so they agree for themselves/
  );
  assert.equal(
    invite({ relationship: 'parent_guardian', recipientName: 'Ana', consentBasis: 'guardian_of_minor', patientBirthdate: CHILD }),
    null
  );
  // A minor's own address is allowed, with the guardian agreeing.
  assert.equal(invite({ consentBasis: 'guardian_of_minor', patientBirthdate: CHILD }), null);
  assert.match(invite({ patientBirthdate: CHILD }), /parent or guardian agrees/);
  assert.match(
    invite({ relationship: 'spouse', recipientName: 'X', consentBasis: 'guardian_of_minor', patientBirthdate: CHILD }),
    /own address or their parent's or guardian's/
  );
});

test('nothing is sent without the read-back tick', () => {
  assert.match(invite({ confirmed: false }), /confirm they agreed/);
  assert.match(invite({ confirmed: 'yes' }), /confirm they agreed/);
  assert.match(invite({ relationship: 'cousin' }), /whose address/);
});

const NOW = new Date('2026-10-21T10:00:00+08:00');
const later = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();
const openInvite = {
  email: 'ana@example.com', expires_at: later(INVITE_TTL_DAYS), birthdate_attempts: 0,
  consent_basis: 'patient_in_person',
};
const account = { email: 'ana@example.com', status: true, roles: ['Client'], email_verified_at: later(-1) };
const record = { user_id: null, archived_at: null, birthdate: ADULT };
const decide = (over = {}) => acceptDecision({
  invitation: { ...openInvite, ...over.invitation },
  account: { ...account, ...over.account },
  patient: { ...record, ...over.patient },
  now: NOW,
  today: TODAY,
});

test('an open invitation, to a verified patient account at its address, may be accepted', () => {
  assert.deepEqual(decide(), { ok: true });
  assert.equal(isOpen(openInvite, NOW), true);
});

test('an ended, expired or locked invitation cannot be accepted', () => {
  assert.equal(decide({ invitation: { accepted_at: later(-1) } }).status, 410);
  assert.equal(decide({ invitation: { revoked_at: later(-1) } }).status, 410);
  assert.equal(decide({ invitation: { expires_at: later(-0.01) } }).status, 410);
  assert.equal(isOpen({ ...openInvite, expires_at: later(-0.01) }, NOW), false);
  assert.match(decide({ invitation: { birthdate_attempts: 3 } }).message, /locked/);
});

test('only the patient account at the invited, proven address may accept', () => {
  assert.equal(decide({ account: { email: 'other@example.com' } }).status, 403);
  assert.equal(decide({ account: { email: 'ANA@example.com' } }).ok, true);
  assert.equal(decide({ account: { roles: ['Client', 'Receptionist'] } }).status, 403);
  assert.equal(decide({ account: { status: false } }).status, 403);
  assert.match(decide({ account: { email_verified_at: null } }).message, /Confirm your email/);
});

test('a record already linked or archived is not offered, and a child who turned 18 agrees again', () => {
  assert.equal(decide({ patient: { user_id: 7 } }).status, 409);
  assert.equal(decide({ patient: { archived_at: later(-1) } }).status, 410);
  const minorInvite = { consent_basis: 'guardian_of_minor' };
  assert.equal(decide({ invitation: minorInvite, patient: { birthdate: CHILD } }).ok, true);
  assert.match(
    decide({ invitation: minorInvite, patient: { birthdate: '2008-10-21' } }).message,
    /turned 18/
  );
});

test('a date of birth matches only as the same calendar date', () => {
  assert.equal(birthdateMatches('1948-03-03', '1948-03-03'), true);
  assert.equal(birthdateMatches('1948-3-3', '1948-03-03'), false);
  assert.equal(birthdateMatches('', '1948-03-03'), false);
});

test('whoever unlinked may not send the next invitation for 30 days; anyone else may', () => {
  const unlinkedAt = later(-10);
  assert.equal(twoPersonBlocked({ unlinkedAt, unlinkedBy: 4, actorId: 4, now: NOW }), true);
  assert.equal(twoPersonBlocked({ unlinkedAt, unlinkedBy: 4, actorId: 9, now: NOW }), false);
  assert.equal(twoPersonBlocked({ unlinkedAt: later(-31), unlinkedBy: 4, actorId: 4, now: NOW }), false);
  assert.equal(twoPersonBlocked({ unlinkedAt: null, unlinkedBy: null, actorId: 4, now: NOW }), false);
});

test('an urgent unlink goes through with work still open; a planned one waits for it', () => {
  const note = 'Wrong Maria Santos was invited';
  const openWork = ['a booking on 30 Oct 2026'];
  assert.deepEqual(unlinkPolicy({ reasonKind: 'linked_in_error', note, openWork }), { ok: true });
  assert.deepEqual(unlinkPolicy({ reasonKind: 'consent_withdrawn', note, openWork }), { ok: true });
  const planned = unlinkPolicy({ reasonKind: 'moving_to_another_manager', note, openWork });
  assert.equal(planned.status, 409);
  assert.match(planned.message, /30 Oct 2026/);
  assert.deepEqual(unlinkPolicy({ reasonKind: 'moving_to_another_manager', note }), { ok: true });
});

test('an unlink names its reason and, when the record emails that account, what to do with it', () => {
  assert.equal(unlinkPolicy({ reasonKind: 'nope', note: 'long enough note' }).status, 400);
  assert.equal(unlinkPolicy({ reasonKind: 'other', note: 'short' }).status, 400);
  const base = { note: 'Daughter moved abroad', recordEmailIsAccount: true };
  assert.equal(unlinkPolicy({ ...base, reasonKind: 'moving_to_another_manager' }).status, 400);
  assert.equal(unlinkPolicy({ ...base, reasonKind: 'moving_to_another_manager', recordEmail: 'keep' }).ok, true);
  assert.equal(unlinkPolicy({ ...base, reasonKind: 'linked_in_error', recordEmail: 'keep' }).status, 400);
  assert.equal(unlinkPolicy({ ...base, reasonKind: 'linked_in_error', recordEmail: 'clear' }).ok, true);
});

test('a waiting record is named by first name and last initial only', () => {
  assert.equal(shortName('Maria', 'dela Cruz'), 'Maria D.');
  assert.equal(shortName('Maria', ''), 'Maria');
});
