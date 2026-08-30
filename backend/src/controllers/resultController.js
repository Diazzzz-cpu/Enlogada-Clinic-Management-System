const fs = require('fs');
const resultService = require('../services/resultService');
const patientService = require('../services/patientService');
const auditService = require('../services/auditService');
const logger = require('../config/logger');

class ResultController {
  async getPending(req, res, next) {
    try {
      const { category } = req.params;
      const pending = await resultService.getPendingByCategory(category, req.user);
      return res.status(200).json({
        status: 'success',
        data: { pending }
      });
    } catch (err) {
      next(err);
    }
  }

  async getReleased(req, res, next) {
    try {
      const { category } = req.params;
      // days/limit/offset are optional; the service clamps them. Defaults to the last 90 days,
      // which is what the screen actually shows — this list used to return every completed test
      // in the clinic's history, findings text included, on every load.
      const { days, limit, offset, delivery } = req.query;
      const released = await resultService.getReleasedByCategory(category, req.user, {
        days,
        delivery,
        limit,
        offset
      });
      return res.status(200).json({
        status: 'success',
        data: { released }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateTestStatus(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'Status is required.'
        });
      }

      const updated = await resultService.updateTestStatus(visitTestId, status, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Test status updated to ${status}.`,
        data: { visitTest: updated }
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { findings, remarks, amendmentReason, isCritical } = req.body;
      const releasedBy = req.user.userId;

      // Same multipart problem as `isCritical` below, one step worse: an object cannot survive
      // form-data at all, so the client sends it as a JSON string. Parsed here rather than in the
      // service, because a malformed body is a request problem and the service should never have
      // to know how it arrived. A bad string is refused rather than treated as "no measurements",
      // which would silently save a report with an empty Measurements block.
      let measurements;
      if (req.body.measurements !== undefined) {
        if (typeof req.body.measurements === 'string') {
          try {
            measurements = JSON.parse(req.body.measurements);
          } catch {
            const error = new Error('measurements must be valid JSON.');
            error.statusCode = 400;
            throw error;
          }
        } else {
          measurements = req.body.measurements;
        }
        if (measurements !== null && (typeof measurements !== 'object' || Array.isArray(measurements))) {
          const error = new Error('measurements must be an object keyed by field code.');
          error.statusCode = 400;
          throw error;
        }
      }

      const result = await resultService.uploadResult({
        visitTestId,
        file: req.file,
        findings,
        remarks,
        releasedBy,
        amendmentReason,
        // Arrives as a string over multipart/form-data, where every field is text — a bare
        // truthiness check would make the string "false" mean true.
        isCritical: isCritical === true || isCritical === 'true',
        measurements
      }, req.user);

      return res.status(201).json({
        status: 'success',
        message: 'Result uploaded successfully.',
        data: { result }
      });
    } catch (err) {
      // multer runs as route middleware, so by the time this handler executes the file is
      // already on disk — including for requests that are about to be refused. Without this,
      // every rejected upload (wrong department, ticket not released yet, a validation failure,
      // a rolled-back transaction) left a PHI-bearing file on the clinic's disk with no database
      // row pointing at it and nothing that would ever delete it. Unlinking here keeps that set
      // empty rather than letting it grow with every mis-click.
      if (req.file?.path) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) {
            // Reported, never thrown: failing to tidy up must not replace the real error the
            // caller needs to see.
            logger.warn(`Could not remove orphaned upload ${req.file.path}: ${unlinkErr.message}`);
          }
        });
      }
      next(err);
    }
  }

  async getVersionHistory(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const versions = await resultService.getVersionHistory(visitTestId, req.user);
      return res.status(200).json({ status: 'success', data: { versions } });
    } catch (err) {
      next(err);
    }
  }

  async getOutstandingCriticals(req, res, next) {
    try {
      const outstanding = await resultService.getOutstandingCriticals();
      return res.status(200).json({
        status: 'success',
        data: { outstanding, count: outstanding.length },
      });
    } catch (err) {
      next(err);
    }
  }

  async acknowledgeCritical(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { note } = req.body;
      const result = await resultService.acknowledgeCritical(visitTestId, { note }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Critical result acknowledged. The callback has been recorded.',
        data: { result },
      });
    } catch (err) {
      next(err);
    }
  }

  async downloadResultFile(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { absolutePath, originalName, mimeType, patientId } = await resultService.getResultFile(visitTestId, req.user);

      // Downloading the report itself is the most concrete PHI access there is — the file leaves
      // the building. Logged before the stream starts, so a failed send still leaves a record of
      // the attempt. Client self-access is not logged (see patientController).
      if (!req.user.roles.includes('Client')) {
        await auditService.logPhiRead({
          actorId: req.user.userId,
          patientId,
          resource: 'result_file',
          description: `Downloaded the report file for visit test #${visitTestId}`,
        });
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '')}"`);
      return res.sendFile(absolutePath);
    } catch (err) {
      next(err);
    }
  }

  async releaseResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const releasedBy = req.user.userId;

      const result = await resultService.releaseResult({ visitTestId, releasedBy }, req.user);
      const message = result.emailStatus === 'sent'
        ? 'Result released and patient notified via email.'
        : result.emailStatus === 'failed'
        ? 'Result released — email notification failed, patient was not notified.'
        : 'Result released. No email on file, so the patient was not notified.';

      return res.status(200).json({
        status: 'success',
        message,
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * The field set for a test, so the entry form knows what to render.
   *
   * Returns `{ fieldSet: null }` rather than 404 for a test that has none: "this modality records
   * free text" is a normal answer, not a missing resource, and a 404 would have the dialog show an
   * error branch on every Laboratory ticket.
   */
  async getFieldSet(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const fieldSet = await resultService.getFieldSetForVisitTest(visitTestId, req.user);
      return res.status(200).json({ status: 'success', data: { fieldSet: fieldSet || null } });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Send a released report to the patient again. [1.59.0]
   *
   * Separate from release on purpose: releasing is a clinical authorisation that happens once,
   * and re-sending is a delivery problem that can happen any number of times. Folding the second
   * into the first would mean re-authorising a result to fix an email bounce.
   */
  async emailResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const sent = await resultService.emailResult({ visitTestId }, req.user);

      return res.status(200).json({
        status: 'success',
        // Names the address. A patient who has changed their email needs whoever is on the phone
        // to be able to say where it actually went.
        message: `Report sent to ${sent.emailedTo}.`,
        data: { delivery: sent },
      });
    } catch (err) {
      next(err);
    }
  }

  async getResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const result = await resultService.getResultByVisitTestId(visitTestId, req.user);
      return res.status(200).json({
        status: 'success',
        data: { result: result || null }
      });
    } catch (err) {
      next(err);
    }
  }

  async getPatientHistory(req, res, next) {
    try {
      const { patientId } = req.params;

      // Security Check: If client, verify patient belongs to them.
      //
      // The 404 that getPatientById throws for an unknown id is converted to the same 403 a
      // Client gets for somebody else's record. Otherwise the pair is an existence oracle: walk
      // the id space, count the 403s, and you know how many patients the clinic has and which
      // ids are real. Staff still get a genuine 404 — they are entitled to know. [1.29.0]
      if (req.user.roles.includes('Client')) {
        const forbidden = {
          status: 'error',
          message: 'Access forbidden. This patient record does not belong to your account.'
        };
        let patient;
        try {
          patient = await patientService.getPatientById(patientId);
        } catch (err) {
          if (err?.statusCode === 404) return res.status(403).json(forbidden);
          throw err;
        }
        if (patient.user_id !== req.user.userId) {
          return res.status(403).json(forbidden);
        }
      }

      // requestingUser drives the department scoping in the service — a diagnostic role sees only
      // its own categories here, matching every other result route.
      const results = await resultService.getPatientHistory(patientId, req.user);

      // Clinical findings are the most sensitive thing this system holds, so a staff member
      // pulling one patient's whole diagnostic history is exactly the access a breach
      // investigation asks about. Client self-access is not logged — see patientController.
      if (!req.user.roles.includes('Client')) {
        await auditService.logPhiRead({
          actorId: req.user.userId,
          patientId,
          resource: 'result_history',
          description: `Viewed the diagnostic history of patient PT-${patientId} (${results.length} result(s))`,
        });
      }
      return res.status(200).json({
        status: 'success',
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ResultController();
