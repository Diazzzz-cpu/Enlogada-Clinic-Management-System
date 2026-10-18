const adminService = require('../services/adminService');
const auditService = require('../services/auditService');

class AdminController {
  async getActivity(req, res, next) {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 25;
      // Migration archives are left out unless asked for. [1.111.0] See auditRepository.
      const includeArchives = req.query.archives === 'true';
      const activity = await auditService.getRecentActivity({ page, limit, includeArchives });
      return res.status(200).json({
        status: 'success',
        data: activity
      });
    } catch (err) {
      next(err);
    }
  }

  async getStaff(req, res, next) {
    try {
      const staff = await adminService.getStaffAccounts();
      return res.status(200).json({
        status: 'success',
        data: { staff }
      });
    } catch (err) {
      next(err);
    }
  }

  async createStaff(req, res, next) {
    try {
      const { firstName, lastName, email, password, contactNumber, role, roles } = req.body;

      // One role (`role`) or several (`roles`). [1.129.0]
      const hasRole = Boolean(role) || (Array.isArray(roles) && roles.length > 0);
      if (!firstName || !lastName || !email || !password || !hasRole) {
        return res.status(400).json({
          status: 'error',
          message: 'First name, last name, email, password, and role are required fields.'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          status: 'error',
          message: 'Password must be at least 8 characters.'
        });
      }

      const staffAccount = await adminService.createStaffAccount({
        firstName, lastName, email, password, contactNumber, role, roles
      });

      return res.status(201).json({
        status: 'success',
        message: 'Staff account created successfully.',
        data: { staff: staffAccount }
      });
    } catch (err) {
      next(err);
    }
  }

  /** PUT /admin/staff/:id/roles: what a staff member does, changed. [1.129.0] */
  async updateStaffRoles(req, res, next) {
    try {
      const staff = await adminService.updateStaffRoles(req.params.id, { roles: req.body?.roles }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Roles updated.',
        data: { staff },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStaffDetails(req, res, next) {
    try {
      const { id } = req.params;
      const { firstName, lastName, email, contactNumber } = req.body;

      if (!firstName || !String(firstName).trim() || !lastName || !String(lastName).trim() || !email || !String(email).trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'First name, last name, and email are required fields.'
        });
      }

      const staffAccount = await adminService.updateStaffDetails(id, { firstName, lastName, email, contactNumber }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Staff account details updated.',
        data: { staff: staffAccount }
      });
    } catch (err) {
      next(err);
    }
  }

  async resetStaffPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          status: 'error',
          message: 'A new password of at least 8 characters is required.'
        });
      }

      await adminService.resetStaffPassword(id, newPassword, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Staff account password reset successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStaffStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (typeof status !== 'boolean') {
        return res.status(400).json({
          status: 'error',
          message: 'A boolean status is required.'
        });
      }

      const staffAccount = await adminService.updateStaffStatus(id, status, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Staff account ${status ? 'activated' : 'deactivated'}.`,
        data: { staff: staffAccount }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminController();
