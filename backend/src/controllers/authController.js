const authService = require('../services/authService');
const { validatePassword } = require('../validations/passwordPolicy');

class AuthController {
  /**
   * Starts a sign-up. The answer carries a ticket, never a token: nothing can sign in until the
   * code emailed to the address is entered. [1.73.0]
   */
  async register(req, res, next) {
    try {
      const { firstName, lastName, email, password, contactNumber } = req.body;

      // Simple validations
      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({
          status: 'error',
          message: 'First name, last name, email, and password are required fields.'
        });
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ status: 'error', message: passwordError });
      }

      const result = await authService.startSignup({
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });

      return res.status(201).json({
        status: 'success',
        message: `We sent a 6-digit code to ${result.email}. Enter it to finish creating your account.`,
        data: { verificationRequired: true, ...result }
      });
    } catch (err) {
      next(err);
    }
  }

  /** Finishes a sign-up with the emailed code, creates the account, and signs it in. */
  async verifyRegistration(req, res, next) {
    try {
      const { ticket, code } = req.body;
      if (!ticket || !code) {
        return res.status(400).json({ status: 'error', message: 'Enter the 6-digit code from the email.' });
      }

      const result = await authService.completeSignup({ ticket: String(ticket), code: String(code).trim() });

      return res.status(201).json({
        status: 'success',
        message: 'Your email is confirmed and your account is ready.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /** [1.136.0] Email this account a code that proves its address. */
  async startEmailCheck(req, res, next) {
    try {
      const data = await authService.startEmailCheck(req.user.userId);
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async confirmEmailCheck(req, res, next) {
    try {
      const { ticket, code } = req.body || {};
      const data = await authService.confirmEmailCheck(req.user.userId, {
        ticket: String(ticket ?? ''),
        code: String(code ?? '').trim(),
      });
      return res.status(200).json({ status: 'success', message: 'Your email address is confirmed.', data });
    } catch (err) {
      next(err);
    }
  }

  /** Sends a fresh code for a sign-up or a reset already under way. */
  async resendCode(req, res, next) {
    try {
      const { ticket } = req.body;
      if (!ticket) {
        return res.status(400).json({ status: 'error', message: 'Start again to get a new code.' });
      }

      const result = await authService.resendCode({ ticket: String(ticket) });

      return res.status(200).json({
        status: 'success',
        message: 'If a new code can be sent, it is on its way.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          status: 'error',
          message: 'Email and password are required fields.'
        });
      }

      const result = await authService.login({ email, password });

      return res.status(200).json({
        status: 'success',
        message: 'Login successful.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async getProfile(req, res, next) {
    try {
      // req.user is set by auth middleware
      const userId = req.user.userId;
      const user = await authService.getUserProfile(userId);

      return res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const { firstName, lastName, contactNumber } = req.body;

      if (!firstName || !String(firstName).trim() || !lastName || !String(lastName).trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'First name and last name are required fields.'
        });
      }

      const user = await authService.updateProfile(userId, { firstName, lastName, contactNumber });

      return res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully.',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req, res, next) {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          status: 'error',
          message: 'Current password and new password are required.'
        });
      }

      const changeError = validatePassword(newPassword);
      if (changeError) {
        return res.status(400).json({ status: 'error', message: changeError });
      }

      const result = await authService.changePassword(userId, currentPassword, newPassword);

      return res.status(200).json({
        status: 'success',
        message: result.message,
        // The caller's existing token was just revoked along with every other one issued before
        // the change. The client must swap to this or its very next request gets a 401.
        data: { token: result.token }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Step one of forgot-password: the same answer, with a ticket, for every address. [1.73.0]
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          status: 'error',
          message: 'Email is required.'
        });
      }

      const { message, ...data } = authService.requestPasswordReset(email);

      return res.status(200).json({ status: 'success', message, data });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Step two: the ticket, the emailed code and a new password. The password is judged first, so
   * a weak one never spends one of the code's tries.
   */
  async resetPassword(req, res, next) {
    try {
      const { ticket, code, newPassword } = req.body;

      if (!ticket || !code || !newPassword) {
        return res.status(400).json({
          status: 'error',
          message: 'The code from the email and a new password are required.'
        });
      }

      const resetError = validatePassword(newPassword);
      if (resetError) {
        return res.status(400).json({ status: 'error', message: resetError });
      }

      const result = await authService.resetPassword({
        ticket: String(ticket),
        code: String(code).trim(),
        newPassword
      });

      return res.status(200).json({
        status: 'success',
        message: result.message,
        data: { email: result.email }
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          message: 'An image file is required.'
        });
      }

      await authService.uploadAvatar(req.user.userId, req.file);

      return res.status(200).json({
        status: 'success',
        message: 'Profile photo updated.'
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteAvatar(req, res, next) {
    try {
      await authService.deleteAvatar(req.user.userId);

      return res.status(200).json({
        status: 'success',
        message: 'Profile photo removed.'
      });
    } catch (err) {
      next(err);
    }
  }

  async getAvatarFile(req, res, next) {
    try {
      const { absolutePath, mimeType } = await authService.getAvatarFile(req.user.userId);
      res.setHeader('Content-Type', mimeType);
      return res.sendFile(absolutePath);
    } catch (err) {
      next(err);
    }
  }

  async googleLogin(req, res, next) {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({
          status: 'error',
          message: 'Google idToken is required.'
        });
      }

      const result = await authService.googleLogin(idToken);

      return res.status(200).json({
        status: 'success',
        message: 'Google login successful.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
