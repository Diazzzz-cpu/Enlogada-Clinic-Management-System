const db = require('../config/database');
const env = require('../config/environment');
const logger = require('../config/logger');
const patientRepository = require('../repositories/patientRepository');
const patientInvitationRepository = require('../repositories/patientInvitationRepository');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');
const patientService = require('./patientService');
const accountEmailService = require('./accountEmailService');
const { normaliseAccountEmail, canonicalEmail } = require('../validations/email');
const {
  AppError, ConflictError, ForbiddenError, GoneError, NotFoundError,
  ServiceUnavailableError, UpstreamServiceError, ValidationError,
} = require('../errors');
const {
  INVITE_TTL_DAYS, MAX_BIRTHDATE_ATTEMPTS, RESEND_COOLDOWN_SECONDS, MAX_SENDS,
  RELATIONSHIPS, CONSENT_BASES, UNLINK_REASONS,
  validateInvite, isOpen, isMinor, acceptDecision, birthdateMatches, twoPersonBlocked, unlinkPolicy, shortName,
} = require('../utils/portalInvitation');

/**
 * Inviting a walk-in patient to the portal, accepting the record, and taking it back. [1.136.0]
 *
 * ── The shape ───────────────────────────────────────────────────────────────────────────────
 *
 * The desk sends an invitation to an address it has checked with the patient, recording whose
 * address it is and who agreed. The email carries no secret. Whoever holds that inbox creates an
 * account or signs in with it (the address is proven by the sign-up code, Google, or a fresh code
 * for an older account), sees "A record is waiting" in the portal, and accepts it with the record's
 * date of birth. Only then is `patients.user_id` set.
 *
 * It replaced [1.123.0]'s link-account, which joined a record to an account on the desk's word
 * alone: the account holder was never asked and the address never proven.
 *
 * ── Rules held here, whatever the screen does ───────────────────────────────────────────────
 *
 *   - A staff account never receives a record, and only a patient-only account accepts one.
 *   - Who agrees follows the patient's age: utils/portalInvitation.js validateInvite.
 *   - Two-person rule: for 30 days after an Admin unlinks a record, that Admin may not send its
 *     next invitation. No role is exempt, SuperAdmin included: the rule exists for the one person
 *     who can unlink, invite and read the birthdate.
 *   - A record's own address hears about an invitation sent anywhere else (no PHI), so a record
 *     cannot be quietly given to a different inbox.
 *   - Caps, in production: 5 invitation emails an address a day, 50 invitations a staff member a
 *     day (INVITE_DAILY_CAP). Off elsewhere, where the E2E suite invites on every run.
 */

const PER_ADDRESS_DAILY = 5;
const isProduction = () => env.NODE_ENV === 'production';
const staffDailyCap = () => {
  const n = Number(process.env.INVITE_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 50;
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "4 Nov 2026", in Philippine time, for an email. */
const readableDate = (value) => new Date(value).toLocaleDateString('en-PH', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila',
});

const fullName = (p) => `${p.first_name} ${p.last_name}`;
const isPatientOnly = (account) => {
  const roles = account?.roles || [];
  return roles.includes('Client') && roles.every((r) => r === 'Client');
};
const fail = (Err, message, details) => {
  const error = new Err(message);
  if (details) error.details = details;
  return error;
};

/** A background send, after the commit. It must never reject: server.js exits on one. */
const sendLater = (promise, what) => {
  Promise.resolve(promise)
    .then((result) => {
      if (result?.error) logger.warn(`${what} could not be sent: ${result.error}`);
    })
    .catch((err) => logger.error(`${what} could not be sent`, err));
};

/** What is still open for a patient, as sentences the dialog and the refusal both use. */
async function openWorkFor(patientId) {
  const w = await patientRepository.findOpenWork(patientId);
  const items = [];
  if (w.in_progress) items.push('a visit still being worked on');
  if (w.unpaid_today) items.push('an unpaid visit at the Desk today');
  if (w.next_booking) items.push(`a booking on ${readableDate(`${w.next_booking}T00:00:00+08:00`)}`);
  if (w.pending_proof) items.push('an online payment waiting to be checked');
  if (w.pending_hmo) items.push('an HMO decision still to come');
  return items;
}

/** The invitation as the staff screen shows it: no hashes, nothing it does not need. */
function staffInvitation(inv) {
  if (!inv) return null;
  return {
    id: inv.id,
    email: inv.email,
    relationship: inv.relationship,
    relationshipLabel: RELATIONSHIPS[inv.relationship],
    recipientName: inv.recipient_name,
    consentBasis: inv.consent_basis,
    consentLabel: CONSENT_BASES[inv.consent_basis],
    sentAt: inv.created_at,
    lastSentAt: inv.last_sent_at,
    sends: inv.sends,
    expiresAt: inv.expires_at,
    acceptedAt: inv.accepted_at,
    revokedAt: inv.revoked_at,
    revokedReason: inv.revoked_reason,
    invitedBy: [inv.invited_by_first_name, inv.invited_by_last_name].filter(Boolean).join(' ') || null,
  };
}

/**
 * The one word the staff dialog draws itself from. Derived from the record and its latest
 * invitation, so the screen never has to guess which buttons will be refused.
 */
function stateFor(patient, latest, now) {
  if (patient.user_id) return 'linked';
  if (patient.archived_at) return 'archived';
  if (!latest) return 'none';
  if (!latest.accepted_at && !latest.revoked_at) return isOpen(latest, now) ? 'pending' : 'expired';
  if (latest.revoked_at) {
    // How the last one ended, where that is worth saying. Superseded, linked and unlinked
    // invitations are not the latest word on anything, so the record simply has none open.
    if (['declined', 'birthdate_locked', 'not_delivered', 'withdrawn'].includes(latest.revoked_reason)) {
      return latest.revoked_reason;
    }
  }
  return 'none';
}

class PatientInvitationService {
  // ── Staff ────────────────────────────────────────────────────────────────────────────────

  /** Everything the Portal access and Unlink dialogs need for one record. */
  async getPortalAccess(patientId, requestingUser) {
    // The department scope first [1.136.0, security review]: a laboratory account holds
    // patients:read for its own patients only, and this screen names the account and its address.
    // getPatientById answers 404 outside the caller's departments, as every record read does.
    await patientService.getPatientById(patientId, requestingUser);
    const patient = await patientRepository.findForPortalAccess(patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    const latest = await patientInvitationRepository.findLatestForPatient(patientId);
    const now = new Date();
    const state = stateFor(patient, latest, now);
    const pending = state === 'pending' || state === 'expired';

    return {
      state,
      patient: {
        id: patient.id,
        name: fullName(patient),
        email: patient.email || null,
        archived: Boolean(patient.archived_at),
        // Decides who agrees for them: a parent or guardian under 18, the patient from 18.
        isMinor: isMinor(patient.birthdate, localToday()),
      },
      account: patient.user_id
        ? {
            email: patient.account_email,
            name: [patient.account_first_name, patient.account_last_name].filter(Boolean).join(' '),
            relationship: patient.account_relationship,
            relationshipLabel: RELATIONSHIPS[patient.account_relationship] || null,
            recordEmailIsAccount: Boolean(patient.email)
              && canonicalEmail(patient.email) === canonicalEmail(patient.account_email),
          }
        : null,
      invitation: staffInvitation(latest),
      canResend: pending && latest.sends < MAX_SENDS && Number(latest.resend_wait) === 0,
      resendAfterSeconds: pending ? Number(latest.resend_wait) || 0 : 0,
      sendsLeft: pending ? Math.max(0, MAX_SENDS - latest.sends) : null,
      // The two-person rule, said before anyone presses Send.
      blockedForYou: twoPersonBlocked({
        unlinkedAt: patient.account_unlinked_at,
        unlinkedBy: patient.account_unlinked_by,
        actorId: requestingUser?.userId,
        now,
      }),
      // Only worth reading for a record somebody might unlink.
      openWork: patient.user_id ? await openWorkFor(patientId) : [],
    };
  }

  /**
   * What the desk should know about an address before sending to it: whether an account uses it,
   * whether that is a staff account, and how many profiles it already holds. [1.136.0] The count
   * is what lets the dialog ask "is it really the patient's own?" of a family manager's inbox.
   */
  async checkAddress(email) {
    const address = normaliseAccountEmail(email);
    const account = await userRepository.findByEmail(address);
    return {
      email: address,
      accountExists: Boolean(account),
      staffAccount: Boolean(account) && !isPatientOnly(account),
      profilesOnAddress: account && isPatientOnly(account)
        ? await patientRepository.countProfilesForAccountEmail(address)
        : 0,
    };
  }

  async invite(patientId, { email, relationship, recipientName, consentBasis, confirmed }, requestingUser) {
    const address = normaliseAccountEmail(email);
    const patient = await patientRepository.findForPortalAccess(patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    if (patient.archived_at) throw new ConflictError('This record is archived. Restore it before inviting anyone to it.');
    if (patient.user_id) throw new ConflictError('This record is already in a portal account.');

    const today = localToday();
    const invalid = validateInvite({ relationship, recipientName, consentBasis, confirmed, patientBirthdate: patient.birthdate, today });
    if (invalid) throw new ValidationError(invalid);

    const account = await userRepository.findByEmail(address);
    if (account && !isPatientOnly(account)) {
      throw new ConflictError('That address belongs to a staff account. Use an address of the patient or their family.');
    }

    const now = new Date();
    if (twoPersonBlocked({
      unlinkedAt: patient.account_unlinked_at, unlinkedBy: patient.account_unlinked_by, actorId: requestingUser.userId, now,
    })) {
      throw new ConflictError('You unlinked this record recently, so another member of staff sends its next invitation.');
    }

    if (isProduction()) {
      if ((await patientInvitationRepository.countSendsToEmailSince(address, 24)) >= PER_ADDRESS_DAILY) {
        throw new AppError('That address has had several invitations today. Try again tomorrow.', 429);
      }
      const cap = staffDailyCap();
      if ((await patientInvitationRepository.countSentByToday(requestingUser.userId)) >= cap) {
        logger.warn(`Invitation cap reached by user ${requestingUser.userId} (${cap} today)`);
        throw new AppError(`You have sent ${cap} invitations today, the most one person can. Ask an Admin if more are needed.`, 429);
      }
    }

    const recordEmail = patient.email ? canonicalEmail(patient.email) : null;
    const addressDiffers = Boolean(recordEmail) && recordEmail !== address;

    const { invitation, superseded } = await db.withTransaction(async () => {
      const replaced = await patientInvitationRepository.revokeOpenForPatient(patientId, { actorId: requestingUser.userId, reason: 'superseded' });
      const created = await patientInvitationRepository.create({
        patientId,
        email: address,
        relationship,
        recipientName: relationship === 'self' ? null : String(recipientName).trim(),
        consentBasis,
        invitedBy: requestingUser.userId,
        ttlDays: INVITE_TTL_DAYS,
        addressDiffersFromRecord: addressDiffers,
      });
      return { invitation: created, superseded: replaced };
    });

    // Awaited: the dialog says whether it went. A row whose email never left is ended, so the
    // record does not show an invitation nobody received.
    const sent = await accountEmailService.sendPatientInvitation({
      to: address,
      patientName: shortName(patient.first_name, patient.last_name),
      forSelf: relationship === 'self',
      relationshipLabel: relationship === 'self' ? null : RELATIONSHIPS[relationship],
      expiresOn: readableDate(invitation.expires_at),
    });
    if (sent?.missing || sent?.error) {
      // Undone as a unit: the new one ended, and the one it replaced (which still reached its
      // inbox) open again, so a failed resend to a corrected address leaves the patient no worse.
      await db.withTransaction(async () => {
        await patientInvitationRepository.revoke(invitation.id, { reason: 'not_delivered' });
        await patientInvitationRepository.reopen(superseded.map((row) => row.id));
      });
      throw sent.missing
        ? new ServiceUnavailableError("The clinic can't send email right now, so the invitation was not sent. Try again later.")
        : new UpstreamServiceError("The invitation email could not be sent. Check the address and try again.");
    }
    if (addressDiffers) {
      sendLater(accountEmailService.sendRecordAccessNotice({ to: recordEmail, accepted: false }), 'Record access notice');
    }
    // Only now that it went: a record with no address of its own takes this one, so its results can
    // be emailed too. Never before the send, or a mistyped address that bounced would stay on file.
    const recordEmailSet = !recordEmail && await patientRepository.setEmailIfEmpty(patientId, address);

    await auditService.log({
      actorId: requestingUser.userId,
      action: 'patient.invite_sent',
      entityType: 'patient',
      entityId: Number(patientId),
      description:
        `Invited ${address} (${relationship === 'self' ? 'the patient' : `${String(recipientName).trim()}, ${RELATIONSHIPS[relationship].toLowerCase()}`}) `
        + `to see the record of ${fullName(patient)} (PT-${patientId}). Agreed: ${CONSENT_BASES[consentBasis]}. `
        + `Works until ${readableDate(invitation.expires_at)}.`
        + (addressDiffers ? ` The record's own address (${recordEmail}) was told.` : '')
        + (recordEmailSet ? ` The record had no email, and now has ${address}.` : ''),
    });

    return {
      invitation: staffInvitation(invitation),
      delivery: sent?.testRecipient ? 'suppressed' : 'sent',
    };
  }

  async resend(patientId, requestingUser) {
    const patient = await patientRepository.findForPortalAccess(patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    if (patient.user_id) throw new ConflictError('This record is already in a portal account.');
    if (twoPersonBlocked({
      unlinkedAt: patient.account_unlinked_at, unlinkedBy: patient.account_unlinked_by, actorId: requestingUser.userId, now: new Date(),
    })) {
      throw new ConflictError('You unlinked this record recently, so another member of staff sends its next invitation.');
    }
    const latest = await patientInvitationRepository.findLatestForPatient(patientId);
    if (!latest || latest.accepted_at || latest.revoked_at) throw new NotFoundError('There is no invitation waiting to send again.');
    // A parent's or guardian's yes covers a child only: one who has turned 18 agrees again.
    if (latest.consent_basis === 'guardian_of_minor' && !isMinor(patient.birthdate, localToday())) {
      throw new ConflictError('This patient is 18 now and agrees for themselves. Send a new invitation.');
    }
    if (isProduction() && (await patientInvitationRepository.countSendsToEmailSince(latest.email, 24)) >= PER_ADDRESS_DAILY) {
      throw new AppError('That address has had several invitations today. Try again tomorrow.', 429);
    }

    const resent = await patientInvitationRepository.recordResend(latest.id, {
      cooldownSeconds: RESEND_COOLDOWN_SECONDS, maxSends: MAX_SENDS, ttlDays: INVITE_TTL_DAYS,
    });
    if (!resent) {
      throw latest.sends >= MAX_SENDS
        ? new ConflictError('This invitation has been sent as many times as it can be. Withdraw it and send a new one.')
        : new ConflictError('It was sent a moment ago. Wait a minute before sending it again.');
    }

    const sent = await accountEmailService.sendPatientInvitation({
      to: resent.email,
      patientName: shortName(patient.first_name, patient.last_name),
      forSelf: resent.relationship === 'self',
      relationshipLabel: resent.relationship === 'self' ? null : RELATIONSHIPS[resent.relationship],
      expiresOn: readableDate(resent.expires_at),
    });
    if (sent?.missing) throw new ServiceUnavailableError("The clinic can't send email right now. Try again later.");
    if (sent?.error) throw new UpstreamServiceError('The invitation email could not be sent. Try again.');

    await auditService.log({
      actorId: requestingUser.userId,
      action: 'patient.invite_resent',
      entityType: 'patient',
      entityId: Number(patientId),
      description: `Sent the invitation for ${fullName(patient)} (PT-${patientId}) to ${resent.email} again (email ${resent.sends} of ${MAX_SENDS}). Works until ${readableDate(resent.expires_at)}.`,
    });
    return { invitation: staffInvitation(resent), delivery: sent?.testRecipient ? 'suppressed' : 'sent' };
  }

  async withdraw(patientId, requestingUser) {
    const patient = await patientRepository.findForPortalAccess(patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    const ended = await patientInvitationRepository.revokeOpenForPatient(patientId, {
      actorId: requestingUser.userId, reason: 'withdrawn',
    });
    if (ended.length === 0) throw new NotFoundError('There is no invitation waiting to withdraw.');
    await auditService.log({
      actorId: requestingUser.userId,
      action: 'patient.invite_withdrawn',
      entityType: 'patient',
      entityId: Number(patientId),
      description: `Withdrew the invitation to ${ended[0].email} for ${fullName(patient)} (PT-${patientId})`,
    });
    return { invitation: staffInvitation(ended[0]) };
  }

  /**
   * Take a record out of the account holding it. [1.136.0] Admin only (patients:unlink).
   *
   * Urgent reasons go through with work still open, which is returned for the desk to deal with:
   * a stranger reading someone's results cannot wait for next week's booking. Planned ones wait.
   * Nothing is deleted. The old account is told, with no name and no reason.
   */
  async unlink(patientId, { reasonKind, note, recordEmail }, requestingUser) {
    const patient = await patientRepository.findForPortalAccess(patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    if (!patient.user_id) throw new ConflictError('This record is not in a portal account.');
    if (String(patient.user_id) === String(requestingUser.userId)) {
      throw new ForbiddenError('A record in your own account is unlinked by another member of staff.');
    }

    const openWork = await openWorkFor(patientId);
    const recordEmailIsAccount = Boolean(patient.email)
      && canonicalEmail(patient.email) === canonicalEmail(patient.account_email);
    const policy = unlinkPolicy({ reasonKind, note, openWork, recordEmailIsAccount, recordEmail });
    if (!policy.ok) throw new AppError(policy.message, policy.status);

    const clearEmail = recordEmailIsAccount && recordEmail === 'clear';
    const updated = await db.withTransaction(async () => {
      const row = await patientRepository.unlinkFromUser(patientId, patient.user_id, {
        actorId: requestingUser.userId, clearEmail,
      });
      if (!row) throw new ConflictError('This record changed a moment ago. Refresh and try again.');
      await patientInvitationRepository.revokeOpenForPatient(patientId, { actorId: requestingUser.userId, reason: 'unlinked' });
      return row;
    });

    await auditService.log({
      actorId: requestingUser.userId,
      action: 'patient.account_unlinked',
      entityType: 'patient',
      entityId: Number(patientId),
      description:
        `Took the record of ${fullName(patient)} (PT-${patientId}) out of the portal account ${patient.account_email}. `
        + `Reason: ${UNLINK_REASONS[reasonKind].label}. "${String(note).trim()}". `
        + `Record email: ${recordEmailIsAccount ? (clearEmail ? 'cleared' : 'kept') : 'unchanged'}.`
        + (openWork.length ? ` Still open: ${openWork.join('; ')}.` : ''),
    });

    sendLater(
      accountEmailService.sendRecordUnlinked({ to: patient.account_email, firstName: patient.account_first_name }),
      'Record unlinked notice'
    );

    return { patient: updated, openWork };
  }

  // ── The patient's own ───────────────────────────────────────────────────────────────────

  /**
   * Records waiting for this account. Named only once the account has proven its address: until
   * then, someone who registered an address they do not own would learn whose record is waiting.
   */
  async listMine(requestingUser) {
    const account = await userRepository.findById(requestingUser.userId);
    if (!account || !isPatientOnly(account)) return { invitations: [], needsEmailCheck: false, count: 0 };
    const open = await patientInvitationRepository.findOpenForEmail(account.email);
    if (!account.email_verified_at) {
      return { invitations: [], needsEmailCheck: open.length > 0, count: open.length };
    }
    return {
      needsEmailCheck: false,
      count: open.length,
      invitations: open.map((i) => ({
        id: i.id,
        patientName: shortName(i.first_name, i.last_name),
        forSelf: i.relationship === 'self',
        relationship: i.relationship,
        relationshipLabel: RELATIONSHIPS[i.relationship],
        expiresAt: i.expires_at,
        triesLeft: Math.max(0, MAX_BIRTHDATE_ATTEMPTS - i.birthdate_attempts),
      })),
    };
  }

  async accept(invitationId, { birthdate, keepBoth = false }, requestingUser) {
    const invitation = await patientInvitationRepository.findById(invitationId);
    const account = await userRepository.findById(requestingUser.userId);
    // Somebody else's invitation answers exactly as a missing one does.
    if (!invitation || !account || canonicalEmail(invitation.email) !== canonicalEmail(account.email)) {
      throw new NotFoundError('There is no invitation like that for your account.');
    }
    const patient = await patientRepository.findForPortalAccess(invitation.patient_id);
    const decision = acceptDecision({ invitation, account, patient, now: new Date(), today: localToday() });
    if (!decision.ok) throw new AppError(decision.message, decision.status);

    // Spent before the comparison, outside the transaction, so a wrong date keeps its count.
    const spent = await patientInvitationRepository.spendBirthdateAttempt(invitation.id, MAX_BIRTHDATE_ATTEMPTS);
    if (!spent) throw new GoneError('This invitation has ended. Ask the clinic for a new one.');
    if (!birthdateMatches(birthdate, patient.birthdate)) {
      const left = MAX_BIRTHDATE_ATTEMPTS - spent.birthdate_attempts;
      if (left > 0) {
        throw new ValidationError(`That date doesn't match the clinic's record. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
      }
      await patientInvitationRepository.revoke(invitation.id, { reason: 'birthdate_locked' });
      await auditService.log({
        actorId: requestingUser.userId,
        action: 'patient.invite_locked',
        entityType: 'patient',
        entityId: Number(patient.id),
        description: `The invitation to ${invitation.email} for PT-${patient.id} was locked after ${MAX_BIRTHDATE_ATTEMPTS} wrong dates of birth`,
      });
      throw new GoneError("That date doesn't match either, so this invitation is locked. Ask the clinic for a new one.");
    }

    // Two profiles of one person in one account split their history. Said, not refused.
    if (!keepBoth) {
      const same = await patientRepository.findSameNameAndBirthdateForUser(
        account.id, patient.first_name, patient.last_name, patient.birthdate
      );
      if (same) {
        // The date was right: this try is not spent, or a manager on their last try who is told
        // about the duplicate could never press "Add as a separate profile".
        await patientInvitationRepository.refundBirthdateAttempt(invitation.id);
        throw fail(ConflictError, `You already have a profile for ${fullName(same)}. The clinic's record has their visits with us; adding it puts both in your account.`, {
          possibleDuplicate: { id: same.id, name: fullName(same) },
        });
      }
    }

    await db.withTransaction(async () => {
      if (!(await patientInvitationRepository.markAccepted(invitation.id, account.id))) {
        throw new GoneError('This invitation has ended. Ask the clinic for a new one.');
      }
      if (!(await patientRepository.linkToUser(patient.id, account.id, invitation.relationship))) {
        throw new ConflictError('This record is already in a portal account.');
      }
    });

    await auditService.log({
      actorId: account.id,
      action: 'patient.invite_accepted',
      entityType: 'patient',
      entityId: Number(patient.id),
      description: `${account.email} accepted the record of ${fullName(patient)} (PT-${patient.id}) as ${RELATIONSHIPS[invitation.relationship].toLowerCase()}; the date of birth matched`,
    });
    await auditService.log({
      actorId: account.id,
      action: 'patient.account_linked',
      entityType: 'patients',
      entityId: Number(patient.id),
      description: `${fullName(patient)} (PT-${patient.id}) linked to the portal account ${account.email} by invitation`,
    });

    sendLater(accountEmailService.sendRecordLinked({ to: account.email, firstName: account.first_name }), 'Record linked notice');
    if (invitation.address_differs_from_record && patient.email && canonicalEmail(patient.email) !== canonicalEmail(account.email)) {
      sendLater(accountEmailService.sendRecordAccessNotice({ to: patient.email, accepted: true }), 'Record access notice');
    }

    return { patientId: patient.id, patientName: shortName(patient.first_name, patient.last_name) };
  }

  async decline(invitationId, requestingUser) {
    const invitation = await patientInvitationRepository.findById(invitationId);
    const account = await userRepository.findById(requestingUser.userId);
    if (!invitation || !account || canonicalEmail(invitation.email) !== canonicalEmail(account.email)) {
      throw new NotFoundError('There is no invitation like that for your account.');
    }
    // As strict as accepting: an account that never proved this address must not be able to end
    // the real patient's invitation.
    if (!isPatientOnly(account) || !account.status) throw new ForbiddenError('Only a patient account can answer an invitation.');
    if (!account.email_verified_at) throw new ConflictError('Confirm your email address first.');
    const ended = await patientInvitationRepository.revoke(invitation.id, { actorId: account.id, reason: 'declined' });
    if (!ended) throw new GoneError('This invitation has already ended.');
    await auditService.log({
      actorId: account.id,
      action: 'patient.invite_declined',
      entityType: 'patient',
      entityId: Number(invitation.patient_id),
      description: `${account.email} said the record PT-${invitation.patient_id} is not someone they know`,
    });
    return { declined: true };
  }
}

module.exports = new PatientInvitationService();
