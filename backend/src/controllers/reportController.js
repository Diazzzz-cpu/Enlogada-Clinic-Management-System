const reportService = require('../services/reportService');
const reportExport = require('../services/export/reportExportFactory');
const reportCsv = require('../utils/reportCsv');

/**
 * Reports, in whichever format the caller asked for. [1.62.0 export, 1.63.0 factory]
 *
 * ── The controller no longer knows about formats ────────────────────────────────────────────
 *
 * Each handler now does exactly what a controller should: read the request, call one service, hand
 * the result to something that shapes a response. The `if (wantsCsv(req))` branch that appeared
 * five times — with the filename, the CSV renderer and the JSON envelope repeated alongside it —
 * is one call to `reportExport.respond`.
 *
 * ── Three properties this preserves, and they are the important part ────────────────────────
 *
 *   1. **The JSON path is untouched.** Anything that is not `format=csv` — a missing parameter, an
 *      empty one, `format=json`, a typo — returns byte-identical responses. Every dashboard and
 *      most of the E2E suite reads these endpoints without a format.
 *
 *   2. **An export can never see figures the JSON could not.** The service runs FIRST and in full;
 *      the serializer is chosen afterwards and never receives `req.user`. So the operations
 *      report's per-slice permission gating applies identically to both formats, and a Laboratory
 *      account's CSV omits Takings rather than zeroing it.
 *
 *   3. **Validation precedes any header.** A bad date range throws inside the service, before
 *      `Content-Disposition` is written — a response that has begun as a file download cannot then
 *      become an error page.
 */
class ReportController {
  /**
   * GET /reports/summary — revenue trend, service volume, visit status, payment-method split.
   *
   * @param {import('express').Request} req  `startDate`, `endDate` (YYYY-MM-DD); optional `format`.
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getSummary(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getSummaryReport(startDate, endDate);

      return reportExport.respond(req, res, report, {
        name: 'clinic-summary',
        startDate,
        endDate,
        toCsv: reportCsv.summaryCsv,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /reports/hmo-claims — claim value per provider.
   *
   * The response carries its own `note` stating that an approved claim is a receivable and not
   * counter takings, and `reportCsv.hmoClaimsCsv` writes that note into the file's header block:
   * the caveat has to survive being copied out of either format.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getHmoClaims(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getHmoClaims(startDate, endDate);

      return reportExport.respond(req, res, report, {
        name: 'hmo-claims',
        startDate,
        endDate,
        toCsv: reportCsv.hmoClaimsCsv,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /reports/operations — per-department operating metrics for a date range.
   *
   * Gated on staff membership at the route, but the SLICES it returns are decided inside the
   * service by the caller's own permissions: a diagnostic account gets its turnaround figures and
   * no revenue. `req.user` is passed rather than filtered here so that decision sits next to the
   * queries it governs, and a caller holding none of the covered permissions is refused outright
   * rather than handed an empty object.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getOperations(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getOperationsReport(startDate, endDate, req.user);

      return reportExport.respond(req, res, report, {
        name: 'operations',
        startDate,
        endDate,
        toCsv: reportCsv.operationsCsv,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /reports/staff-workload — check-ins per reception staff, reports released per clinician.
   *
   * Note the envelope key: this endpoint answers with `data: { workload }`, not `data: { report }`.
   * That asymmetry predates the export factory, the frontend reads it and the suite asserts it, so
   * it is declared explicitly here rather than quietly normalised.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getStaffWorkload(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const workload = await reportService.getStaffWorkload(startDate, endDate);

      return reportExport.respond(req, res, workload, {
        name: 'staff-workload',
        startDate,
        endDate,
        key: 'workload',
        toCsv: reportCsv.staffWorkloadCsv,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /reports/analytics — turnaround against target, arrivals by hour, period-over-period revenue.
   *
   * Separate from `/operations` rather than folded into it because the two answer different
   * questions and are read on different screens — and because folding them in would make every
   * existing caller of `/operations` pay for two more aggregate queries it does not render.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @returns {Promise<void>}
   */
  async getAnalytics(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getAnalytics(startDate, endDate, req.user);

      return reportExport.respond(req, res, report, {
        name: 'clinic-analytics',
        startDate,
        endDate,
        toCsv: reportCsv.analyticsCsv,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ReportController();
