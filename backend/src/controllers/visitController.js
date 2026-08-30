const visitService = require('../services/visitService');
const patientService = require('../services/patientService');

class VisitController {
  async registerVisit(req, res, next) {
    try {
      const { patientId, visitType, notes, referringPhysician, referringPhysicianPrc } = req.body;
      const createdBy = req.user.userId;

      if (!patientId || !visitType) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient ID and visit type are required.'
        });
      }

      const visit = await visitService.registerVisit({
        patientId,
        visitType,
        notes,
        createdBy,
        // Optional here; visitService decides whether this patient's type makes it mandatory.
        referringPhysician,
        referringPhysicianPrc
      });

      return res.status(201).json({
        status: 'success',
        message: `Visit registered. Queue number: ${visit.queue_number}`,
        data: { visit }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /visits/queue-status — how busy the clinic is, for the public site. [1.63.0]
   *
   * Unauthenticated by design and aggregate-only: two counts and an estimate, with nothing that
   * identifies a patient. See visitService.getPublicQueueStatus for why that is publishable and
   * where the line is.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getPublicQueueStatus(req, res, next) {
    try {
      const status = await visitService.getPublicQueueStatus();
      return res.status(200).json({ status: 'success', data: { queue: status } });
    } catch (err) {
      next(err);
    }
  }

  async getActiveVisits(req, res, next) {
    try {
      const { search, status, page, limit } = req.query;
      const data = await visitService.getActiveVisits({ search, status, page, limit });
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitsByDateRange(req, res, next) {
    try {
      const { startDate, endDate, search, visitType, status, page, limit } = req.query;
      const result = await visitService.getVisitHistoryByDateRange({
        startDate, endDate, search, visitType, status, page, limit,
      });
      return res.status(200).json({
        status: 'success',
        // `visits` stays the key it always was so nothing that reads it has to change; the paging
        // fields ride alongside and are simply absent when the caller did not ask for a page.
        data: {
          visits: result.visits,
          total: result.total,
          ...(result.page ? { page: result.page, limit: result.limit, totalPages: result.totalPages } : {}),
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitById(req, res, next) {
    try {
      const { id } = req.params;
      const visit = await visitService.getVisitById(id);
      return res.status(200).json({
        status: 'success',
        data: { visit }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'Status is required.'
        });
      }

      const visit = await visitService.updateStatus(id, status, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Visit status updated to ${status}.`,
        data: { visit }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitHistory(req, res, next) {
    try {
      const { patientId } = req.params;

      // Security Check: If client, verify patient belongs to them
      if (req.user.roles.includes('Client')) {
        const patient = await patientService.getPatientById(patientId);
        if (patient.user_id !== req.user.userId) {
          return res.status(403).json({
            status: 'error',
            message: 'Access forbidden. This patient record does not belong to your account.'
          });
        }
      }

      const visits = await visitService.getVisitHistory(patientId);
      return res.status(200).json({
        status: 'success',
        data: { visits }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new VisitController();
