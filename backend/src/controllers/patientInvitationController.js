const patientInvitationService = require('../services/patientInvitationService');

/**
 * Portal invitations and unlinking. [1.136.0] Parsing and shaping only; every rule is in
 * patientInvitationService.
 */
const positiveId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const badId = (res) => res.status(400).json({ status: 'error', message: 'That id is not valid.' });

class PatientInvitationController {
  async getPortalAccess(req, res, next) {
    try {
      const id = positiveId(req.params.id);
      if (!id) return badId(res);
      const data = await patientInvitationService.getPortalAccess(id, req.user);
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async checkAddress(req, res, next) {
    try {
      if (!positiveId(req.params.id)) return badId(res);
      const data = await patientInvitationService.checkAddress(req.body?.email);
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async invite(req, res, next) {
    try {
      const id = positiveId(req.params.id);
      if (!id) return badId(res);
      const { email, relationship, recipientName, consentBasis, confirmed } = req.body || {};
      const data = await patientInvitationService.invite(id, { email, relationship, recipientName, consentBasis, confirmed }, req.user);
      return res.status(201).json({
        status: 'success',
        message: `Invitation sent to ${data.invitation.email}.`,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  async resend(req, res, next) {
    try {
      const id = positiveId(req.params.id);
      if (!id) return badId(res);
      const data = await patientInvitationService.resend(id, req.user);
      return res.status(200).json({ status: 'success', message: `Invitation sent to ${data.invitation.email} again.`, data });
    } catch (err) {
      next(err);
    }
  }

  async withdraw(req, res, next) {
    try {
      const id = positiveId(req.params.id);
      if (!id) return badId(res);
      const data = await patientInvitationService.withdraw(id, req.user);
      return res.status(200).json({ status: 'success', message: `Invitation to ${data.invitation.email} withdrawn.`, data });
    } catch (err) {
      next(err);
    }
  }

  async unlink(req, res, next) {
    try {
      const id = positiveId(req.params.id);
      if (!id) return badId(res);
      const { reasonKind, note, recordEmail } = req.body || {};
      const data = await patientInvitationService.unlink(id, { reasonKind, note, recordEmail }, req.user);
      return res.status(200).json({
        status: 'success',
        message: `${data.patient.first_name} ${data.patient.last_name}'s record is no longer in that portal account.`,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  async listMine(req, res, next) {
    try {
      const data = await patientInvitationService.listMine(req.user);
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async accept(req, res, next) {
    try {
      const id = positiveId(req.params.invitationId);
      if (!id) return badId(res);
      const { birthdate, keepBoth } = req.body || {};
      const data = await patientInvitationService.accept(id, { birthdate, keepBoth: keepBoth === true }, req.user);
      return res.status(200).json({ status: 'success', message: `${data.patientName}'s record is on your account.`, data });
    } catch (err) {
      next(err);
    }
  }

  async decline(req, res, next) {
    try {
      const id = positiveId(req.params.invitationId);
      if (!id) return badId(res);
      const data = await patientInvitationService.decline(id, req.user);
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PatientInvitationController();
