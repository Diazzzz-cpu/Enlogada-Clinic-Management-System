const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const db = require('../config/database');
const auditService = require('./auditService');
const { normaliseAccountEmail } = require('../validations/email');

// Module 12 (Admin Dashboard) manages the 5 operational staff roles only. Creating or managing
// Admin/SuperAdmin accounts is Module 13 (Super Admin Management)'s explicit responsibility —
// excluding them here prevents privilege escalation via this endpoint.
const MANAGEABLE_ROLES = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];

/**
 * Whether an Admin may manage this account.
 *
 * Asks whether EVERY role the target holds is operational — not whether *some* role is. The
 * original test was `.some()`, which passes an account holding both Receptionist and SuperAdmin
 * because it holds at least one manageable role. An Admin, who is explicitly barred from
 * /api/superadmin/*, could then call PATCH /api/admin/staff/:id/password against that account,
 * set a password they know, sign in as it, and inherit SuperAdmin — defeating the Module 12 /
 * Module 13 separation this file exists to enforce.
 *
 * Scoping this honestly: neither account-creation endpoint assigns more than one role, so the API
 * cannot produce such an account today and this is not currently exploitable. It becomes
 * exploitable with the first hand-inserted user_roles row — which is exactly what TEST_ACCOUNTS.md
 * tells operators to do to recreate the combined-role account.
 *
 * The empty-list check matters too: a roleless account must not be manageable by default.
 */
const isAdminManageable = (user) => {
  const roles = user.roles || [];
  return roles.length > 0 && roles.every((r) => MANAGEABLE_ROLES.includes(r));
};

/**
 * The roles a staff account is given, checked: at least one, each one of the five front-line
 * roles, no repeats. [1.129.0] Accepts `roles` (a list) or the older single `role`.
 */
function chooseRoles({ roles, role }) {
  const list = [...new Set((Array.isArray(roles) ? roles : role ? [role] : []).map((r) => String(r).trim()))];
  if (list.length === 0) {
    const error = new Error('Choose at least one role.');
    error.statusCode = 400;
    throw error;
  }
  const invalid = list.filter((r) => !MANAGEABLE_ROLES.includes(r));
  if (invalid.length > 0) {
    const error = new Error(`Invalid role${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}. Must be one of: ${MANAGEABLE_ROLES.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return list;
}

/** Each role's id, or a 500 naming the one the database has not been seeded with. */
async function roleIdsFor(roleNames) {
  const ids = [];
  for (const name of roleNames) {
    const id = await userRepository.findRoleIdByName(name);
    if (!id) {
      const error = new Error(`Role "${name}" is not seeded in the database.`);
      error.statusCode = 500;
      throw error;
    }
    ids.push(id);
  }
  return ids;
}

class AdminService {
  async getStaffAccounts() {
    return await userRepository.findStaffUsers(MANAGEABLE_ROLES);
  }

  /**
   * [1.129.0] One or more roles. A person who covers the front desk and the till holds both, and
   * gets what both allow, with nothing to set up by hand.
   */
  async createStaffAccount({ firstName, lastName, email, password, contactNumber, role, roles }) {
    const chosen = chooseRoles({ roles, role });

    // Stored lower-case, like every account address, so the capitals can never make a second one.
    const address = normaliseAccountEmail(email);
    const existingUser = await userRepository.findByEmail(address);
    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 400;
      throw error;
    }

    // Hashing stays outside the transaction — ~100ms of CPU should not hold a pooled connection.
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Account and role are created together. Previously the unseeded-role check threw *after* the
    // user row was already committed, so the very error meant to prevent a bad account was what
    // created one: a staff member with working credentials and no role, who logs in to an empty
    // console. Inside a transaction the same check now rolls the account back.
    const user = await db.withTransaction(async () => {
      const created = await userRepository.createUser(firstName, lastName, address, passwordHash, contactNumber);
      for (const roleId of await roleIdsFor(chosen)) {
        await userRepository.assignRoleToUser(created.id, roleId);
      }
      return created;
    });

    return { ...user, roles: chosen };
  }

  /**
   * Change what a staff member does. [1.129.0]
   *
   * There was no way to: Staff Accounts set one role at creation and never again, so "this cashier
   * also covers the desk" meant editing the database by hand. The account's access follows its
   * roles from the next request (`verifyToken` reads them every time), and the sidebar within a
   * minute (AuthContext re-reads /auth/me).
   *
   * Only the five front-line roles, and only on an account that holds nothing else
   * (`isAdminManageable`): an Admin cannot make anyone an Admin or a SuperAdmin here, or touch one.
   * Audited, with the roles before and after, because it changes what a person may do.
   */
  async updateStaffRoles(userId, { roles }, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }
    if (!isAdminManageable(user)) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }
    const chosen = chooseRoles({ roles });
    const before = [...(user.roles || [])].sort();
    const after = [...chosen].sort();
    if (before.join('|') === after.join('|')) return { ...user, roles: before };

    const roleIds = await roleIdsFor(chosen);
    await db.withTransaction(async () => {
      await userRepository.removeAllRoles(userId);
      for (const roleId of roleIds) {
        await userRepository.assignRoleToUser(userId, roleId, requestingUser?.userId ?? null);
      }
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'staff.roles_changed',
      entityType: 'user',
      entityId: userId,
      description: `Roles for ${user.first_name} ${user.last_name} (${user.email}): ${before.join(', ') || 'none'} → ${after.join(', ')}`,
    });

    return { ...user, roles: after };
  }

  async resetStaffPassword(userId, newPassword, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await userRepository.updatePasswordHash(userId, passwordHash);

    // Clear any failed-login lock at the same time. A staff member locked out at the front desk
    // has usually just had their identity verified in person by the administrator doing this —
    // making them additionally wait out the 15-minute window would be pointless, and the reason
    // they called for help in the first place.
    await userRepository.clearLoginFailures(userId);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'staff.password_reset',
      entityType: 'user',
      entityId: userId,
      description: `Reset password for ${user.first_name} ${user.last_name} (${user.email})`
    });
  }

  // UI/UX Modernization Phase 11: previously only status-toggle and password-reset existed —
  // there was no way to fix a staff member's own typo'd name/email/contact number after account
  // creation short of deactivating and recreating the whole account. Role is intentionally not a
  // parameter here — reassigning a role is a separate, more sensitive action.
  async updateStaffDetails(userId, { firstName, lastName, email, contactNumber }, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    const address = normaliseAccountEmail(email);
    if (address !== user.email) {
      const existing = await userRepository.findByEmail(address);
      if (existing && existing.id !== Number(userId)) {
        const error = new Error('Email is already registered to another account.');
        error.statusCode = 400;
        throw error;
      }
    }

    const updated = await userRepository.updateStaffDetails(userId, { firstName, lastName, email: address, contactNumber });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'staff.details_updated',
      entityType: 'user',
      entityId: userId,
      description: `Updated contact details for ${updated.first_name} ${updated.last_name} (${updated.email})`
    });

    return updated;
  }

  async updateStaffStatus(userId, status, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    const updated = await userRepository.updateUserStatus(userId, status);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: status ? 'staff.activated' : 'staff.deactivated',
      entityType: 'user',
      entityId: userId,
      description: `${status ? 'Activated' : 'Deactivated'} staff account ${user.first_name} ${user.last_name} (${user.email})`
    });

    return updated;
  }
}

module.exports = new AdminService();
