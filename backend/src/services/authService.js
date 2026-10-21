const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const userRepository = require('../repositories/userRepository');
const authCodeRepository = require('../repositories/authCodeRepository');
const db = require('../config/database');
const env = require('../config/environment');
const logger = require('../config/logger');
const { departmentsForUser } = require('../constants/modality');
const { AVATAR_UPLOAD_ROOT } = require('../config/upload');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const accountEmailService = require('./accountEmailService');
const { canonicalEmail, normaliseAccountEmail } = require('../validations/email');
const {
  AppError,
  ConflictError,
  ServiceUnavailableError,
  UpstreamServiceError,
  ValidationError,
} = require('../errors');
const {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_TICKET,
  MAX_CODES_PER_EMAIL_PER_HOUR,
  generateCode,
  generateTicket,
  hashTicket,
  createCodeHasher,
  isWellFormedCode,
  isWellFormedTicket,
} = require('../utils/authCodes');

// Lockout policy — deliberately forgiving, because the obvious design is dangerous here.
//
// A tight threshold turns the lockout into a denial of service against the clinic itself: anyone
// who can guess receptionist@enlogada.com could fail five logins at 08:00 and take the front desk
// offline during the morning rush, which is worse than the attack being prevented. Ten attempts
// per fifteen minutes per account still makes online password guessing impractical, while the
// worst case for a real staff member is a quarter of an hour rather than a phone call — and it
// expires on its own, with no one needed to clear it.
const FAILED_LOGIN_THRESHOLD = 10;
const LOCK_DURATION_MINUTES = 15;

// Keyed from JWT_SECRET, so a copy of the database alone cannot turn a stored code hash back into
// its six digits by trying all million. See utils/authCodes.js.
const { hashCode, codeMatches } = createCodeHasher(env.JWT_SECRET);

// Codes older than this are deleted whenever a new sign-up starts. See authCodeRepository.
const STALE_CODE_HOURS = 24;

// One answer for every way a reset code can fail. Answering "expired" for a ticket that matched
// nothing and "wrong, 4 tries left" for a real one would tell whoever asked for the reset whether
// the address has an account — the one thing POST /forgot-password is built never to reveal.
const RESET_CODE_REFUSED =
  'That code is wrong or has expired. Check the newest email from us, or send a new code.';

const SIGNUP_GONE = 'This sign-up has expired or is already finished. Start again, or sign in.';

const CODE_TIMING = {
  expiresInSeconds: CODE_TTL_MINUTES * 60,
  resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
};

/** The JWT and the user object every sign-in path returns. It was written out three times. */
function sessionFor(user) {
  const roles = (user.roles || []).filter((r) => r !== null);
  const permissions = (user.permissions || []).filter((p) => p !== null);
  // The token proves IDENTITY only — roles and permissions are re-read from the database on every
  // request, so a grant or a revoke takes effect immediately rather than at token expiry.
  const token = jwt.sign({ userId: user.id, roles, permissions }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
  return {
    token,
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      contactNumber: user.contact_number,
      roles,
      permissions,
      departments: departmentsForUser(user),
      hasAvatar: Boolean(user.avatar_path),
      // [1.136.0] Whether this account has proven its address, which accepting a record needs.
      emailVerified: Boolean(user.email_verified_at),
    },
  };
}

/**
 * A client account and its role, as one unit. Call inside db.withTransaction.
 *
 * These were two independent writes once. If the second failed, registration left behind a user
 * with valid credentials and no role at all: it can sign in, every console check finds an empty
 * role list, so it lands nowhere and shows nothing, and only an administrator can repair it.
 */
async function createClientAccount({ firstName, lastName, email, passwordHash, contactNumber }) {
  const created = await userRepository.createUser(firstName, lastName, email, passwordHash, contactNumber);
  const clientRoleId = await userRepository.findRoleIdByName('Client');
  if (!clientRoleId) {
    // Failing loudly rolls the account back, so a misconfigured RBAC seed surfaces here rather
    // than as a mysteriously empty account later.
    throw new Error('The Client role is missing. Run `node src/scripts/setupRbac.js` to seed roles.');
  }
  await userRepository.assignRoleToUser(created.id, clientRoleId);
  return created;
}

/** A sign-up code that never left cannot be entered, so say so now rather than at the code screen. */
function assertDelivered(result) {
  if (result?.missing) {
    throw new ServiceUnavailableError(
      "The clinic can't send email right now, so a new account can't be confirmed. Please try again later, or ask at the front desk."
    );
  }
  if (result?.error) {
    throw new UpstreamServiceError("We couldn't send a code to that address. Check it and try again.");
  }
}

const triesLeft = (row) => {
  const left = MAX_ATTEMPTS - row.attempts;
  return left > 0
    ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
    : "That code isn't right, and that was the last try. Send a new code.";
};

/**
 * The work behind a forgot-password request, after the answer has already been decided.
 *
 * Only an active account gets a code, and only the newest code works: an older one sitting in an
 * inbox is one more thing to intercept.
 */
async function issueResetCode(address, ticket) {
  const user = await userRepository.findByEmail(address);
  if (!user || !user.status) return;

  const email = canonicalEmail(user.email);
  if ((await authCodeRepository.countIssuedSince('password_reset', email, 60)) >= MAX_CODES_PER_EMAIL_PER_HOUR) {
    logger.warn(`Password reset for user ${user.id} not sent: ${MAX_CODES_PER_EMAIL_PER_HOUR} codes already this hour.`);
    return;
  }

  const code = generateCode();
  await db.withTransaction(async () => {
    await authCodeRepository.consumeOpenForUser('password_reset', user.id);
    await authCodeRepository.create({
      purpose: 'password_reset',
      email,
      userId: user.id,
      ticketHash: hashTicket(ticket),
      codeHash: hashCode(code),
      ttlMinutes: CODE_TTL_MINUTES,
    });
  });

  reportUndelivered(user.id, await accountEmailService.sendResetCode({ to: user.email, firstName: user.first_name, code }));
}

function reportUndelivered(userId, result) {
  if (result?.error || result?.missing) {
    logger.warn(`Password email for user ${userId} was not delivered: ${result.error || result.missing.join(', ')}`);
  }
}

/** A resent reset code. Not awaited by the caller, for the reason requestPasswordReset gives. */
function sendResetCodeInBackground({ userId, email, code }) {
  userRepository
    .findById(userId)
    .then((user) => accountEmailService.sendResetCode({ to: user?.email || email, firstName: user?.first_name, code }))
    .then((result) => reportUndelivered(userId, result))
    .catch((err) => logger.error('Password reset code could not be resent', err));
}

function notifyPasswordChanged(userId) {
  userRepository
    .findById(userId)
    .then((user) => (user ? accountEmailService.sendPasswordChanged({ to: user.email, firstName: user.first_name }) : null))
    .then((result) => reportUndelivered(userId, result))
    .catch((err) => logger.error('Password-changed notice could not be sent', err));
}

class AuthService {
  /**
   * Starts a sign-up and emails the 6-digit code. No account exists yet. [1.73.0]
   *
   * The account is created only when the code is entered (completeSignup). Until then this is a
   * row in `auth_codes`, not in `users`, so nothing half-made exists for anyone to take over: if a
   * stranger starts a sign-up with your address, there is no account under it, and the day you
   * sign in with Google — which links by email — you land in an account of your own, not theirs.
   *
   * @returns {Promise<{ticket: string, email: string, expiresInSeconds: number, resendAfterSeconds: number}>}
   *   `ticket` is for the browser that asked: finishing needs it AND the code from the email.
   * @throws {ConflictError} An account already uses the address (409).
   * @throws {ServiceUnavailableError} Email is not configured, so the code could not be sent (503).
   */
  async startSignup({ firstName, lastName, email, password, contactNumber }) {
    const address = normaliseAccountEmail(email);
    const first = String(firstName ?? '').trim();
    const last = String(lastName ?? '').trim();
    const contact = String(contactNumber ?? '').trim();
    if (!first || !last) throw new ValidationError('First name and last name are required fields.');
    // The columns' own limits, checked here so an overlong value is a sentence rather than a 500.
    if (first.length > 100 || last.length > 100) throw new ValidationError('A name can be at most 100 characters.');
    if (contact.length > 20) throw new ValidationError('That contact number is too long.');

    // Says the account exists. The lockout message already does too (see login), and a person who
    // forgot they signed up is far better told to sign in than sent a code that cannot help them.
    if (await userRepository.findByEmail(address)) {
      throw new ConflictError('An account already uses this email. Sign in, or reset your password if you have forgotten it.');
    }
    if ((await authCodeRepository.countIssuedSince('signup', address, 60)) >= MAX_CODES_PER_EMAIL_PER_HOUR) {
      throw new AppError('Several sign-ups were started for this email in the last hour. Please wait a while, then try again.', 429);
    }

    // Outside any transaction: bcrypt is ~100ms of CPU and must not hold a pooled connection.
    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const ticket = generateTicket();
    const code = generateCode();

    await authCodeRepository.pruneOlderThan(STALE_CODE_HOURS);
    const pending = await authCodeRepository.create({
      purpose: 'signup',
      email: address,
      ticketHash: hashTicket(ticket),
      codeHash: hashCode(code),
      firstName: first,
      lastName: last,
      contactNumber: contact,
      passwordHash,
      ttlMinutes: CODE_TTL_MINUTES,
    });

    const sent = await accountEmailService.sendSignupCode({ to: address, firstName: first, code });
    try {
      assertDelivered(sent);
    } catch (err) {
      await authCodeRepository.deleteById(pending.id);
      throw err;
    }

    return { ticket, email: address, ...CODE_TIMING };
  }

  /**
   * Finishes a sign-up: the right code for this ticket creates the account and signs it in.
   *
   * @returns {Promise<{token: string, user: object}>}
   * @throws {ValidationError} Wrong, expired, used up, or no such sign-up (400 — never 401, which
   *   the browser treats as "you have been signed out").
   */
  async completeSignup({ ticket, code }) {
    if (!isWellFormedCode(code)) throw new ValidationError('Enter the 6-digit code from the email.');
    const ticketHash = isWellFormedTicket(ticket) ? hashTicket(ticket) : null;
    const row = ticketHash ? await authCodeRepository.findByTicketHash(ticketHash, RESEND_COOLDOWN_SECONDS) : null;

    if (!row || row.purpose !== 'signup' || row.consumed_at) throw new ValidationError(SIGNUP_GONE);
    if (row.expired) throw new ValidationError('This code has expired. Send a new one.');
    if (row.attempts >= MAX_ATTEMPTS) throw new ValidationError('Too many wrong codes. Send a new one.');

    // The guess is spent before the code is compared, in one statement, so two requests racing
    // cannot both get a free try.
    const claimed = await authCodeRepository.claimAttempt(ticketHash, 'signup', MAX_ATTEMPTS);
    if (!claimed) throw new ValidationError('Too many wrong codes. Send a new one.');
    if (!codeMatches(code, claimed.code_hash)) throw new ValidationError(triesLeft(claimed));

    let created;
    try {
      created = await db.withTransaction(async () => {
        if (!(await authCodeRepository.consume(claimed.id))) {
          throw new ConflictError('This code has already been used. Sign in instead.');
        }
        // Something else may have made the account in the last ten minutes: Google sign-in, or a
        // second tab finishing first.
        if (await userRepository.findByEmail(claimed.email)) {
          throw new ConflictError('An account already uses this email. Sign in instead.');
        }
        const account = await createClientAccount({
          firstName: claimed.first_name,
          lastName: claimed.last_name,
          email: claimed.email,
          passwordHash: claimed.password_hash,
          contactNumber: claimed.contact_number,
        });
        await authCodeRepository.consumeOpenForEmail('signup', claimed.email);
        // The code just proved the address. [1.136.0]
        await userRepository.markEmailVerified(account.id);
        return account;
      });
    } catch (err) {
      // Two sign-ups for one address finishing in the same instant: the unique index decides.
      if (err.code === '23505') throw new ConflictError('An account already uses this email. Sign in instead.');
      throw err;
    }

    await auditService.log({
      actorId: created.id,
      action: 'auth.account_created',
      entityType: 'user',
      entityId: created.id,
      description: `Created an account for ${created.email}, confirmed with an emailed code`,
    });

    return sessionFor(await userRepository.findByEmail(created.email));
  }

  /**
   * A fresh code for a sign-up or a reset already under way: after 60 seconds, at most three
   * times per ticket.
   *
   * For a reset, every refusal looks like success — an unknown ticket, the cooldown and the send
   * limit all answer the same — so a stranger holding a ticket learns nothing about the address.
   */
  async resendCode({ ticket }) {
    const generic = { ...CODE_TIMING };
    if (!isWellFormedTicket(ticket)) return generic;

    const row = await authCodeRepository.findByTicketHash(hashTicket(ticket), RESEND_COOLDOWN_SECONDS);
    const isSignup = row?.purpose === 'signup';

    if (!row || row.consumed_at) {
      if (isSignup) throw new ValidationError(SIGNUP_GONE);
      return generic;
    }
    if (row.resend_wait > 0) return { ...CODE_TIMING, resendAfterSeconds: row.resend_wait };
    if (row.sends >= MAX_SENDS_PER_TICKET) {
      if (isSignup) {
        throw new AppError('That is the most codes one sign-up can send. Please start again in a few minutes.', 429);
      }
      return generic;
    }

    const code = generateCode();
    const reissued = await authCodeRepository.reissue(row.id, hashCode(code), {
      ttlMinutes: CODE_TTL_MINUTES,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      maxSends: MAX_SENDS_PER_TICKET,
    });
    // Lost a race with another resend on the same ticket; that one sent the code.
    if (!reissued) return generic;

    if (isSignup) {
      assertDelivered(await accountEmailService.sendSignupCode({ to: row.email, firstName: row.first_name, code }));
    } else if (row.purpose === 'email_verify') {
      const account = await userRepository.findById(row.user_id);
      assertDelivered(await accountEmailService.sendEmailCheckCode({ to: row.email, firstName: account?.first_name, code }));
    } else {
      sendResetCodeInBackground({ userId: row.user_id, email: row.email, code });
    }
    return generic;
  }

  /**
   * Signs a user in, or refuses in one of four distinguishable ways.
   *
   * @param {object} credentials
   * @param {string} credentials.email
   * @param {string} credentials.password
   * @returns {Promise<object>} A JWT and the user.
   * @throws {UnauthorizedError} Wrong credentials. Deliberately the same message for an unknown
   *   email and a wrong password, so the response cannot be used to enumerate accounts.
   * @throws {LockedError} Too many failed attempts (423).
   * @throws {ForbiddenError} The account has been deactivated.
   */
  async login({ email, password }) {
    // 1. Find user by email, whatever capitals it was typed with.
    const user = await userRepository.findByEmail(canonicalEmail(email));
    if (!user || !user.status) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // 2. Refuse while locked, before spending a bcrypt comparison on it.
    //
    // This message names the lockout rather than returning the generic "invalid email or
    // password", which does confirm the account exists. That is a deliberate trade: the
    // credential rate limiter already bounds enumeration, and the alternative is a staff member
    // whose password is correct being told it is wrong, retrying, extending their own lock, and
    // escalating to whoever maintains this system. Operational clarity wins for a clinic that
    // cannot pause the morning queue over a login message.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.max(
        1,
        Math.ceil((new Date(user.locked_until) - Date.now()) / 60000)
      );
      const error = new Error(
        `Too many failed sign-in attempts. This account is locked for another ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`
      );
      error.statusCode = 423; // Locked
      throw error;
    }

    // 3. Check password match
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      // Counted per account, which is what the IP-keyed rate limiter cannot do: an attacker
      // spreading attempts across addresses still runs into this.
      const state = await userRepository.registerFailedLogin(user.id, {
        threshold: FAILED_LOGIN_THRESHOLD,
        lockMinutes: LOCK_DURATION_MINUTES,
      });

      if (state?.locked_until && new Date(state.locked_until) > new Date()) {
        // Worth an audit entry and an alert: a genuine lockout is either an attack in progress or
        // a staff member about to be blocked from working, and both want someone to know.
        await auditService.log({
          actorId: user.id,
          action: 'auth.account_locked',
          entityType: 'user',
          entityId: user.id,
          description: `Locked after ${state.failed_login_count} consecutive failed sign-in attempts`,
        });
        await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
          title: 'Account locked after failed sign-ins',
          message: `${user.email} — ${state.failed_login_count} consecutive failures. Unlocks automatically in ${LOCK_DURATION_MINUTES} minutes.`,
          type: 'warning',
        });
      }

      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // A correct password clears the slate, so ordinary mistyping across a week never accumulates
    // into a lockout.
    await userRepository.clearLoginFailures(user.id);

    return sessionFor(user);
  }

  /**
   * The first step of forgot-password. The same answer, in the same time, for every address. [1.73.0]
   *
   * The work is started and deliberately NOT awaited: the answer is decided before anything is
   * looked up, so a real account and an unknown address take the same time to answer. The link
   * flow this replaced waited for a database write and an SMTP round trip for a real account only,
   * which could be timed from outside.
   *
   * @returns {{ticket: string, message: string, expiresInSeconds: number, resendAfterSeconds: number}}
   *   A ticket is returned for every address, real or not, and looks the same either way.
   */
  requestPasswordReset(email) {
    const ticket = generateTicket();
    issueResetCode(canonicalEmail(email), ticket).catch((err) =>
      logger.error('Password reset code could not be issued', err)
    );
    return { ticket, ...CODE_TIMING, message: 'If an account uses that email, we have sent it a 6-digit code.' };
  }

  /**
   * Completes a password reset with the emailed code, and ends every other session. [1.73.0]
   *
   * Stamps `password_changed_at`, which `verifyToken` compares against each JWT's `iat`. That is
   * what makes a reset the real answer to a stolen token: without it the attacker keeps their
   * session until it expires on its own. Also clears a sign-in lock — proving the inbox is proving
   * who you are, and a lock that outlives that only makes the person wait out a window meant for
   * somebody guessing.
   *
   * The new password is checked by the controller BEFORE this runs, so a weak one never spends one
   * of the code's five tries.
   */
  async resetPassword({ ticket, code, newPassword }) {
    if (!isWellFormedCode(code)) throw new ValidationError('Enter the 6-digit code from the email.');
    const claimed = isWellFormedTicket(ticket)
      ? await authCodeRepository.claimAttempt(hashTicket(ticket), 'password_reset', MAX_ATTEMPTS)
      : null;
    if (!claimed || !codeMatches(code, claimed.code_hash)) throw new ValidationError(RESET_CODE_REFUSED);

    const passwordHash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));

    // The code is burned and the password changed as one unit: split, a failure between them would
    // leave a single-use credential unconsumed in an inbox after it had done its job. And `consume`
    // succeeds for exactly one caller, so two requests carrying the same code cannot both reset —
    // the link flow looked its token up and marked it used in two statements, and both could.
    const account = await db.withTransaction(async () => {
      if (!(await authCodeRepository.consume(claimed.id))) throw new ValidationError(RESET_CODE_REFUSED);
      const updated = await userRepository.updatePasswordHash(claimed.user_id, passwordHash);
      await userRepository.clearLoginFailures(claimed.user_id);
      await authCodeRepository.consumeOpenForUser('password_reset', claimed.user_id);
      // A code from the inbox proves the address as surely as a sign-up code. [1.136.0]
      await userRepository.markEmailVerified(claimed.user_id);
      return updated;
    });

    await auditService.log({
      actorId: claimed.user_id,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: claimed.user_id,
      description: 'Reset their password with an emailed code; every other session was signed out',
    });

    // After the commit, and not awaited: the change has happened whether or not the notice arrives.
    notifyPasswordChanged(claimed.user_id);

    return {
      email: account?.email,
      message: 'Your password has been changed, and every other session has been signed out. Sign in with your new password.',
    };
  }

  /**
   * An existing account proves its address, before it may accept a patient record. [1.136.0]
   *
   * Accounts made before [1.73.0], or by a seed, never proved theirs, and a patient record holds
   * results. The same ticket-and-code pair as a sign-up, sent to the account's own address and
   * bound to the account: finishing needs this account's session as well as the code.
   */
  async startEmailCheck(userId) {
    const account = await userRepository.findById(userId);
    if (!account) throw new ValidationError('Account not found.');
    if (account.email_verified_at) return { alreadyVerified: true };
    const address = canonicalEmail(account.email);
    if ((await authCodeRepository.countIssuedSince('email_verify', address, 60)) >= MAX_CODES_PER_EMAIL_PER_HOUR) {
      throw new AppError('Several codes were sent to this address in the last hour. Please wait a while, then try again.', 429);
    }
    const ticket = generateTicket();
    const code = generateCode();
    const pending = await authCodeRepository.create({
      purpose: 'email_verify',
      email: address,
      userId: account.id,
      ticketHash: hashTicket(ticket),
      codeHash: hashCode(code),
      ttlMinutes: CODE_TTL_MINUTES,
    });
    const sent = await accountEmailService.sendEmailCheckCode({ to: address, firstName: account.first_name, code });
    try {
      assertDelivered(sent);
    } catch (err) {
      await authCodeRepository.deleteById(pending.id);
      throw err;
    }
    return { ticket, email: address, ...CODE_TIMING };
  }

  async confirmEmailCheck(userId, { ticket, code }) {
    if (!isWellFormedCode(code)) throw new ValidationError('Enter the 6-digit code from the email.');
    const account = await userRepository.findById(userId);
    if (!account) throw new ValidationError('Account not found.');
    if (account.email_verified_at) return { verified: true };

    const claimed = isWellFormedTicket(ticket)
      ? await authCodeRepository.claimAttempt(hashTicket(ticket), 'email_verify', MAX_ATTEMPTS)
      : null;
    // Bound to this account AND its current address: a code sent before the address changed, or
    // to somebody else's check, proves nothing here.
    if (!claimed || String(claimed.user_id) !== String(userId) || claimed.email !== canonicalEmail(account.email)) {
      throw new ValidationError('That code has expired or is not for this account. Send a new one.');
    }
    if (!codeMatches(code, claimed.code_hash)) throw new ValidationError(triesLeft(claimed));

    await db.withTransaction(async () => {
      if (!(await authCodeRepository.consume(claimed.id))) {
        throw new ValidationError('That code has already been used.');
      }
      await userRepository.markEmailVerified(userId);
      await authCodeRepository.consumeOpenForUser('email_verify', userId);
    });
    await auditService.log({
      actorId: userId,
      action: 'auth.email_verified',
      entityType: 'user',
      entityId: userId,
      description: `Confirmed the address ${account.email} with an emailed code`,
    });
    return { verified: true };
  }

  async updateProfile(userId, { firstName, lastName, contactNumber }) {
    await userRepository.updateContactInfo(userId, firstName, lastName, contactNumber);
    return this.getUserProfile(userId);
  }

  /**
   * Changes a signed-in user's own password.
   *
   * @param {number} userId
   * @param {string} currentPassword  Re-checked even though the caller is authenticated — it is
   *   the control against somebody walking up to an unlocked terminal.
   * @param {string} newPassword
   * @returns {Promise<object>} Includes a fresh token: stamping `password_changed_at` invalidates
   *   every existing session, including the caller's own.
   */
  async changePassword(userId, currentPassword, newPassword) {
    const passwordHash = await userRepository.findPasswordHashById(userId);
    if (!passwordHash) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const isMatch = await bcrypt.compare(currentPassword, passwordHash);
    if (!isMatch) {
      const error = new Error('Current password is incorrect.');
      error.statusCode = 400;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    await userRepository.updatePasswordHash(userId, newHash);

    // Changing a password now revokes every token issued before it (see verifyToken), which
    // includes the one this very request arrived with. Handing back a replacement is what keeps
    // that from logging people out of their own password change — the revocation is aimed at a
    // stolen token on some other device, not at the person doing the changing.
    const user = await userRepository.findById(userId);

    return {
      message: 'Password changed successfully. Other devices have been signed out.',
      token: sessionFor(user).token
    };
  }

  async getUserProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Filter out null from array_agg
    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      contactNumber: user.contact_number,
      roles: cleanRoles,
      permissions: cleanPermissions,
      departments: departmentsForUser(user),
      hasAvatar: Boolean(user.avatar_path),
      emailVerified: Boolean(user.email_verified_at),
    };
  }

  async googleLogin(idToken) {
    if (!env.GOOGLE_CLIENT_ID) {
      const error = new Error('Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID in backend/.env');
      error.statusCode = 400;
      throw error;
    }

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
    } catch {
      const error = new Error('Invalid Google authentication token');
      error.statusCode = 401;
      throw error;
    }

    const payload = ticket.getPayload();
    const { email, email_verified, given_name, family_name } = payload;

    // This flow provisions an account keyed on nothing but the email in the token, so an
    // unverified address would let a Google account claim an email it never proved it owns —
    // and, if that email already belongs to a staff member here, sign in as them.
    if (!email || !email_verified) {
      const error = new Error('Your Google account has no verified email address, so it cannot be used to sign in.');
      error.statusCode = 401;
      throw error;
    }

    // Google has verified the address, which is why this path needs no emailed code. [1.73.0]
    const address = canonicalEmail(email);
    let user = await userRepository.findByEmail(address);

    if (!user) {
      // A random password nobody knows. The person signs in with Google, or sets one through
      // forgot-password.
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      // Same atomicity requirement as a sign-up: an account without its role is a broken account.
      // More so here, because this path auto-provisions on first sign-in with no human in the loop
      // to notice something went wrong.
      await db.withTransaction(async () => {
        await createClientAccount({
          firstName: given_name || 'Google',
          lastName: family_name || 'User',
          email: address,
          passwordHash,
          contactNumber: '',
        });
      });

      user = await userRepository.findByEmail(address);
    }

    if (!user.status) {
      const error = new Error('User account is deactivated');
      error.statusCode = 403;
      throw error;
    }

    // Google verified the address (email_verified above). [1.136.0]
    if (!user.email_verified_at) {
      await userRepository.markEmailVerified(user.id);
      user = await userRepository.findByEmail(address);
    }

    return sessionFor(user);
  }

  // UI/UX Modernization Phase 8: self-service profile photo. Replacing an existing avatar
  // deletes the previous file from disk — best-effort, a cleanup failure shouldn't fail the
  // request since the DB row (the source of truth for what's "current") already updated.
  async uploadAvatar(userId, file) {
    const previousPath = await userRepository.replaceAvatar(userId, file.filename, file.mimetype);
    if (previousPath) {
      fs.unlink(path.join(AVATAR_UPLOAD_ROOT, previousPath), () => {});
    }
  }

  async deleteAvatar(userId) {
    const previousPath = await userRepository.clearAvatar(userId);
    if (previousPath) {
      fs.unlink(path.join(AVATAR_UPLOAD_ROOT, previousPath), () => {});
    }
  }

  async getAvatarFile(userId) {
    const row = await userRepository.findAvatarById(userId);
    if (!row || !row.avatar_path) {
      const error = new Error('No avatar uploaded.');
      error.statusCode = 404;
      throw error;
    }

    const absolutePath = path.join(AVATAR_UPLOAD_ROOT, row.avatar_path);
    if (!fs.existsSync(absolutePath)) {
      const error = new Error('The avatar file could not be found on the server.');
      error.statusCode = 404;
      throw error;
    }

    return { absolutePath, mimeType: row.avatar_mime_type || 'image/jpeg' };
  }
}

module.exports = new AuthService();
