const db = require('../config/database');

/**
 * Join condition for a role grant that is in force *right now*.
 *
 * user_roles has carried starts_at and expires_at since the original schema, and nothing read
 * either one — the join checked only is_active. So a deliberately time-bounded grant ("give the
 * locum Xray Staff until the 30th") never actually ended: the role kept coming back from these
 * queries, kept landing in req.user.roles, and kept being honoured by authorizeRoles, forever.
 *
 * That is the worst shape for an access control to have. A column that looks like it enforces
 * something and does not is more dangerous than no column at all, because whoever set the expiry
 * date reasonably believes access is bounded and stops thinking about it.
 *
 * This is also the one revocation path that the per-request authorization work did not already
 * cover: that change made role *removal* take effect immediately, while expiry-based revocation
 * still silently never fired.
 */
const ACTIVE_ROLE_GRANT = `
  ur.is_active = TRUE
  AND (ur.starts_at  IS NULL OR ur.starts_at  <= NOW())
  AND (ur.expires_at IS NULL OR ur.expires_at >  NOW())
`;

/**
 * What an account may actually do, and whose data it may touch. [1.20.0]
 *
 * Three sources, resolved here rather than in the service layer, so that every path that loads a
 * user — login, /auth/me, the per-request authority lookup in middlewares/auth.js — gets the same
 * answer. A second resolution written somewhere else is a second answer waiting to disagree.
 *
 *   permissions = (union of the account's active role permissions)
 *                 + rows in user_permissions with effect='grant'
 *                 - rows in user_permissions with effect='revoke'
 *
 * Revoke wins over grant by construction: it is applied last, as a set difference. That is the
 * safe precedence — if the two ever disagree about the same permission (they cannot, the table is
 * unique on (user_id, permission_id), but if the constraint were ever dropped) the outcome is
 * less access rather than more.
 *
 *   departments  = the modalities implied by the account's roles
 *                 + rows in user_departments
 *
 * `roles` deliberately stays a plain list of role names. It is the structural boundary — staff
 * versus patient — and nothing here can widen it.
 */
const EFFECTIVE_PERMISSIONS = `
  COALESCE((
    SELECT ARRAY_AGG(DISTINCT name) FROM (
      SELECT p.name
        FROM user_roles ur2
        JOIN roles r2             ON r2.id = ur2.role_id
        JOIN role_permissions rp2 ON rp2.role_id = r2.id
        JOIN permissions p        ON p.id = rp2.permission_id
       WHERE ur2.user_id = u.id
         AND ur2.is_active = TRUE
         AND (ur2.starts_at  IS NULL OR ur2.starts_at  <= NOW())
         AND (ur2.expires_at IS NULL OR ur2.expires_at >  NOW())
      UNION
      SELECT p.name
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = u.id AND up.effect = 'grant'
      EXCEPT
      SELECT p.name
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = u.id AND up.effect = 'revoke'
    ) AS effective(name)
  ), '{}') AS permissions
`;

// Extra modalities granted directly to this account. The role-derived ones are added in the
// service layer from constants/modality.js, which is where that mapping already lives — keeping
// it out of SQL means the two cannot drift.
const GRANTED_DEPARTMENTS = `
  COALESCE((
    SELECT ARRAY_AGG(tc.name ORDER BY tc.name)
      FROM user_departments ud
      JOIN test_categories tc ON tc.id = ud.category_id
     WHERE ud.user_id = u.id
  ), '{}') AS granted_departments
`;

const ACTIVE_ROLE_NAMES = `
  COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
`;

class UserRepository {
  async findByEmail(email) {
    const queryText = `
      SELECT u.*,
             ${ACTIVE_ROLE_NAMES},
             ${EFFECTIVE_PERMISSIONS},
             ${GRANTED_DEPARTMENTS}
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ${ACTIVE_ROLE_GRANT}
      LEFT JOIN roles r ON ur.role_id = r.id
      -- Whatever capitals the address was typed with. Served by uq_users_email_lower. [1.73.0]
      WHERE LOWER(u.email) = LOWER($1)
      GROUP BY u.id
    `;
    const result = await db.query(queryText, [email]);
    return result.rows[0];
  }

  async findById(id) {
    const queryText = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.contact_number, u.status, u.created_at,
             u.avatar_path, u.password_changed_at, u.email_verified_at,
             ${ACTIVE_ROLE_NAMES},
             ${EFFECTIVE_PERMISSIONS},
             ${GRANTED_DEPARTMENTS}
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ${ACTIVE_ROLE_GRANT}
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1
      GROUP BY u.id
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async createUser(firstName, lastName, email, passwordHash, contactNumber) {
    const queryText = `
      INSERT INTO users (first_name, last_name, email, password_hash, contact_number)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, email, passwordHash, contactNumber]);
    return result.rows[0];
  }

  /**
   * Sets a new password and stamps when it changed.
   *
   * password_changed_at is what makes a password change actually end existing sessions —
   * verifyToken rejects any token issued before it. Every path that changes a password goes
   * through here (self-service change, emailed reset, and an administrator resetting a staff
   * member's password), so revocation cannot be forgotten by one of them.
   */
  async updatePasswordHash(userId, passwordHash) {
    const queryText = `
      UPDATE users
      SET password_hash = $1,
          password_changed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, email
    `;
    const result = await db.query(queryText, [passwordHash, userId]);
    return result.rows[0];
  }

  /**
   * Records a failed sign-in and locks the account once the threshold is reached.
   *
   * One statement rather than read-then-write: two attempts landing together would otherwise both
   * read the same count and both write count+1, so the counter under-counts exactly when it is
   * being attacked. The CASE decides the lock inside the same UPDATE that increments.
   *
   * A lock that has run out starts the count again. [1.85.0] It used to carry on from where the
   * lock left it, so the count still stood at the threshold when the fifteen minutes ended, and
   * the first slip after waiting them out locked the account for another fifteen. The person most
   * likely to make that slip is the one who has just waited. `locked_until <= CURRENT_TIMESTAMP`
   * is NULL rather than true for an account that was never locked, so it counts as before.
   *
   * Every SET expression reads the row as it stood before this UPDATE, which is why the lock test
   * repeats the "has it run out" check instead of reading the new count back.
   *
   * Returns the resulting state so the caller can log a lockout without a second query.
   */
  async registerFailedLogin(userId, { threshold, lockMinutes }) {
    const queryText = `
      UPDATE users
      SET failed_login_count = CASE
            WHEN locked_until <= CURRENT_TIMESTAMP THEN 1
            ELSE failed_login_count + 1
          END,
          last_failed_login_at = CURRENT_TIMESTAMP,
          locked_until = CASE
            WHEN (CASE WHEN locked_until <= CURRENT_TIMESTAMP THEN 1 ELSE failed_login_count + 1 END) >= $2
              THEN CURRENT_TIMESTAMP + ($3 || ' minutes')::interval
            WHEN locked_until <= CURRENT_TIMESTAMP THEN NULL
            ELSE locked_until
          END
      WHERE id = $1
      RETURNING failed_login_count, locked_until
    `;
    const result = await db.query(queryText, [userId, threshold, String(lockMinutes)]);
    return result.rows[0];
  }

  /**
   * Clears the failure counter and any lock. Called on a successful sign-in, and when an
   * administrator resets a password — a staff member locked out at the front desk should not have
   * to wait out the window once someone has verified who they are.
   *
   * The WHERE guard keeps this from writing on every single successful login, which would
   * otherwise make each sign-in a write to the users table for no reason.
   */
  async clearLoginFailures(userId) {
    const queryText = `
      UPDATE users
      SET failed_login_count = 0, locked_until = NULL
      WHERE id = $1 AND (failed_login_count > 0 OR locked_until IS NOT NULL)
    `;
    await db.query(queryText, [userId]);
  }

  async updateContactInfo(userId, firstName, lastName, contactNumber) {
    const queryText = `
      UPDATE users
      SET first_name = $1, last_name = $2, contact_number = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, contactNumber, userId]);
    return result.rows[0];
  }

  // UI/UX Modernization Phase 11: unlike updateContactInfo (self-service, email deliberately
  // excluded — "your email is your login and cannot be changed here"), this is Admin editing
  // someone else's staff record, where correcting a typo'd email at creation time is legitimate.
  // Role is never touched here — reassigning a role is a separate, more sensitive surface.
  async updateStaffDetails(userId, { firstName, lastName, email, contactNumber }) {
    const queryText = `
      UPDATE users
      SET first_name = $1, last_name = $2, email = $3, contact_number = $4, updated_at = CURRENT_TIMESTAMP,
          -- A new address has proven nothing yet. [1.136.0]
          email_verified_at = CASE WHEN LOWER(email) = LOWER($3) THEN email_verified_at END
      WHERE id = $5
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, email, contactNumber, userId]);
    return result.rows[0];
  }

  /**
   * The account has just proven it receives mail at its address: an emailed code, or Google.
   * [1.136.0] Kept from the first time, so it says when the address was first proven.
   */
  async markEmailVerified(userId) {
    await db.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = $1',
      [userId]
    );
  }

  async findPasswordHashById(userId) {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.password_hash;
  }

  async findStaffUsers(roleNames) {
    const queryText = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.contact_number, u.status, u.created_at,
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id AND ur.is_active = TRUE
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = ANY($1::text[])
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `;
    const result = await db.query(queryText, [roleNames]);
    return result.rows;
  }

  async updateUserStatus(userId, status) {
    const queryText = `
      UPDATE users
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, first_name, last_name, email, status
    `;
    const result = await db.query(queryText, [status, userId]);
    return result.rows[0];
  }

  async findRoleIdByName(roleName) {
    const queryText = 'SELECT id FROM roles WHERE name = $1';
    const result = await db.query(queryText, [roleName]);
    return result.rows[0]?.id;
  }

  /** Every role an account holds, removed: the first half of replacing them. [1.129.0] */
  async removeAllRoles(userId) {
    await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  }

  async assignRoleToUser(userId, roleId, assignedBy = null) {
    const queryText = `
      INSERT INTO user_roles (user_id, role_id, assigned_by)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, role_id
    `;
    const result = await db.query(queryText, [userId, roleId, assignedBy]);
    return result.rows[0];
  }

  // Returns the *previous* avatar_path (before overwrite) so the service can delete the stale
  // file from disk — a replace, not an append, since only one avatar exists per user at a time.
  async replaceAvatar(userId, avatarPath, avatarMimeType) {
    const queryText = `
      WITH old AS (SELECT avatar_path FROM users WHERE id = $3)
      UPDATE users
      SET avatar_path = $1, avatar_mime_type = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING (SELECT avatar_path FROM old) AS previous_avatar_path
    `;
    const result = await db.query(queryText, [avatarPath, avatarMimeType, userId]);
    return result.rows[0]?.previous_avatar_path;
  }

  async clearAvatar(userId) {
    // RETURNING reflects the row *after* the update, so avatar_path would already be NULL by
    // then — the old-value CTE (same trick as replaceAvatar above) is what actually captures
    // the path to delete from disk.
    const queryText = `
      WITH old AS (SELECT avatar_path FROM users WHERE id = $1)
      UPDATE users
      SET avatar_path = NULL, avatar_mime_type = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING (SELECT avatar_path FROM old) AS previous_avatar_path
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows[0]?.previous_avatar_path;
  }

  async findAvatarById(userId) {
    const result = await db.query('SELECT avatar_path, avatar_mime_type FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }
}

module.exports = new UserRepository();
