const verificationService = require('../services/verificationService');

/** GET /api/verify/:code — public; see verificationService. [1.126.0] */
class VerificationController {
  async verify(req, res, next) {
    try {
      const report = await verificationService.verify(req.params.code);
      return res.status(200).json({ status: 'success', data: { report } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new VerificationController();
