const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const userRepository = require('../repositories/userRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const db = require('../config/database');
const env = require('../config/environment');
const { sendEmail } = require('../config/email');
const { departmentsForUser } = require("../constants/modality");
const { AVATAR_UPLOAD_ROOT } = require('../config/upload');
const auditService = require('./auditService');
const notificationService = require('./notificationService');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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

const hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

class AuthService {
  async registerClient({ firstName, lastName, email, password, contactNumber }) {
    // 1. Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 400;
      throw error;
    }

    // 2. Hash password. Deliberately outside the transaction below: bcrypt is ~100ms of CPU, and
    // holding a pooled database connection idle for that long under load starves other requests.
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create the account and grant its role as one unit.
    //
    // These were two independent writes. If the second failed — role table locked, connection
    // dropped, process restarted mid-request — registration left behind a user with valid
    // credentials and no role at all. That account can log in, and then every console check finds
    // an empty role list, so it lands nowhere and shows nothing. It is not self-repairing and the
    // patient cannot fix it; it needs an administrator to notice and assign the role by hand.
    const user = await db.withTransaction(async () => {
      const created = await userRepository.createUser(firstName, lastName, email, passwordHash, contactNumber);

      const clientRoleId = await userRepository.findRoleIdByName('Client');
      if (!clientRoleId) {
        // Previously this was `if (clientRoleId)` — a missing Client role silently produced the
        // roleless account described above. Failing loudly rolls the user back instead, so a
        // misconfigured RBAC seed surfaces as an error at registration rather than as a
        // mysteriously broken account later.
        throw new Error('The Client role is missing. Run `node src/scripts/setupRbac.js` to seed roles.');
      }
      await userRepository.assignRoleToUser(created.id, clientRoleId);
      return created;
    });

    return {
      ...user,
      roles: ['Client']
    };
  }

  /**
   * Signs a user in, or refuses in one of four distinguishable ways.
   *
   * @param {object} credentials
   * @param {string} credentials.email
   * @param {string} credentials.password
   * @returns {Promise<object>} A JWT and the user. The token proves IDENTITY only — roles and
   *   permissions are re-read from the database on every request, so a grant or a revoke takes
   *   effect immediately rather than at token expiry.
   * @throws {UnauthorizedError} Wrong credentials. Deliberately the same message for an unknown
   *   email and a wrong password, so the response cannot be used to enumerate accounts.
   * @throws {LockedError} Too many failed attempts (423).
   * @throws {ForbiddenError} The account has been deactivated.
   */
  async login({ email, password }) {
    // 1. Find user by email
    const user = await userRepository.findByEmail(email);
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

    // Filter out null values in array_agg if user has no role or is newly created
    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);

    // 3. Generate JWT Token
    const payload = {
      userId: user.id,
      roles: cleanRoles,
      permissions: cleanPermissions
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN
    });

    return {
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        contactNumber: user.contact_number,
        roles: cleanRoles,
        permissions: cleanPermissions,
        departments: departmentsForUser(user),
        hasAvatar: Boolean(user.avatar_path)
      }
    };
  }

  async forgotPassword(email) {
    // Always returns the same generic result regardless of whether the email is
    // registered — never confirm/deny account existence to an unauthenticated caller.
    const user = await userRepository.findByEmail(email);

    if (user && user.status) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      // Invalidate any previously requested, still-unused tokens for this user first. Atomic so a
      // failure cannot revoke the user's outstanding link without issuing the replacement, which
      // would leave them holding a dead link and no way to tell it had been superseded.
      await db.withTransaction(async () => {
        await passwordResetRepository.deleteAllForUser(user.id);
        await passwordResetRepository.createToken(user.id, tokenHash, expiresAt);
      });

      const frontendBaseUrl = env.FRONTEND_URL;
      const resetLink = `${frontendBaseUrl}/?reset_token=${rawToken}`;

      await sendEmail({
        to: user.email,
        subject: 'Reset your Enlogada Clinic password',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Hello ${user.first_name},</h2>
            <p>We received a request to reset your Enlogada Clinic account password.</p>
            <p><a href="${resetLink}">Click here to reset your password</a> (link expires in 1 hour).</p>
            <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>
            <br/>
            <p>Thank you,</p>
            <p><strong>Enlogada Ultrasound and Diagnostic Clinic</strong></p>
          </div>
        `
      });
    }

    return { message: 'If that email is registered, a password reset link has been sent.' };
  }

  /**
   * Completes a password reset and ends every older session.
   *
   * @param {string} rawToken  The token from the email. Only its HASH is stored, so a leaked
   *   database row cannot be replayed as a reset link.
   * @param {string} newPassword
   * @returns {Promise<object>}
   *
   * Stamps `password_changed_at`, which `verifyToken` compares against each JWT's `iat`. That is
   * what makes a reset the real answer to a stolen token: without it the attacker keeps their
   * session until it expires on its own.
   */
  async resetPassword(rawToken, newPassword) {
    const tokenHash = hashToken(rawToken);
    const tokenRecord = await passwordResetRepository.findValidByTokenHash(tokenHash);

    if (!tokenRecord) {
      const error = new Error('This password reset link is invalid or has expired. Please request a new one.');
      error.statusCode = 400;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Changing the password and burning the token must be one unit. Split, as they were, a
    // failure between them leaves the password changed and the reset link still valid — a
    // single-use credential that was never consumed, sitting in an inbox, reusable by anyone who
    // reads that mailbox later. The token is the weaker credential precisely because it is
    // delivered over email, so it must not outlive its one use.
    await db.withTransaction(async () => {
      await userRepository.updatePasswordHash(tokenRecord.user_id, passwordHash);
      await passwordResetRepository.markUsed(tokenRecord.id);
    });

    return { message: 'Your password has been reset. You can now log in with your new password.' };
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
    const token = jwt.sign(
      {
        userId: user.id,
        roles: (user.roles || []).filter((r) => r !== null),
        permissions: (user.permissions || []).filter((p) => p !== null)
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    return {
      message: 'Password changed successfully. Other devices have been signed out.',
      token
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
      hasAvatar: Boolean(user.avatar_path)
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

    // Check if user exists
    let user = await userRepository.findByEmail(email);

    if (!user) {
      // Create user with random password hash
      const crypto = require('crypto');
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      // Same atomicity requirement as registerClient: an account without its role is a broken
      // account. More so here, because this path auto-provisions on first sign-in with no human
      // in the loop to notice something went wrong.
      await db.withTransaction(async () => {
        const newUser = await userRepository.createUser(
          given_name || 'Google',
          family_name || 'User',
          email,
          passwordHash,
          ''
        );

        const clientRoleId = await userRepository.findRoleIdByName('Client');
        if (!clientRoleId) {
          throw new Error('The Client role is missing. Run `node src/scripts/setupRbac.js` to seed roles.');
        }
        await userRepository.assignRoleToUser(newUser.id, clientRoleId);
      });

      user = await userRepository.findByEmail(email);
    }

    if (!user.status) {
      const error = new Error('User account is deactivated');
      error.statusCode = 403;
      throw error;
    }

    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);

    const jwtPayload = {
      userId: user.id,
      roles: cleanRoles,
      permissions: cleanPermissions
    };

    const token = jwt.sign(jwtPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN
    });

    return {
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        contactNumber: user.contact_number,
        roles: cleanRoles,
        permissions: cleanPermissions,
        departments: departmentsForUser(user),
        hasAvatar: Boolean(user.avatar_path)
      }
    };
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
