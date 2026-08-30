const reportRepository = require('../repositories/reportRepository');
const { departmentsForUser } = require('../constants/modality');

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turnaround targets, in minutes from payment to released report. [1.62.0]
 *
 * ── These are DEFAULTS, and the clinic has not agreed them ──────────────────────────────────
 *
 * Stated plainly because a target rendered as a line on a chart looks like a commitment somebody
 * made, and nobody here has. They are starting values chosen to be plausible for a walk-in
 * diagnostic clinic — X-Ray fastest because the image is read on the spot, Laboratory slowest
 * because an analyser run has its own clock — and they are here so the chart has a reference line
 * at all, not because they are the right numbers.
 *
 * ── There is no default, and that is the point [1.63.0] ────────────────────────────────────
 *
 * This shipped with `{ Laboratory: 60, Ultrasound: 45, Xray: 30 }` — plausible figures I chose so
 * the chart would have a reference line. On the clinic's own data those render as Ultrasound
 * hitting 7.7% and X-Ray 8.3%, drawn as a benchmark, on a screen an administrator reads as fact.
 *
 * Nobody at the clinic agreed them. A target line is a promise, and inventing one so a chart looks
 * finished is the same error as printing a made-up TIN on a receipt to make it look official —
 * `lib/clinic.js` refuses to do that for exactly this reason, and the refusal is what makes the
 * real value get set.
 *
 * So the default is EMPTY. With nothing configured the chart reports measured medians and a p90
 * and draws no benchmark, which is the truthful state: the clinic is measured and not yet judged.
 * Setting `TURNAROUND_TARGETS=Laboratory:60,Ultrasound:45,Xray:30` turns the benchmark on, and the
 * act of setting it is the clinic deciding what it is promising.
 *
 * A department missing from the map gets a NULL target and a NULL rate — measured, not judged
 * against a promise nobody made. That path already existed; it is now simply the default one.
 */
const DEFAULT_TURNAROUND_TARGETS = {};

function parseTargets(raw) {
  if (!raw) return DEFAULT_TURNAROUND_TARGETS;
  const parsed = {};
  for (const pair of String(raw).split(',')) {
    const [name, minutes] = pair.split(':').map((s) => (s || '').trim());
    const value = Number(minutes);
    if (name && Number.isFinite(value) && value > 0) parsed[name] = value;
  }
  // An unparseable setting yields no targets rather than a guess. With the default now empty,
  // "could not read the setting" and "nothing configured" land in the same honest place: measured,
  // unjudged, and visibly missing a benchmark somebody has to supply.
  return parsed;
}

const TURNAROUND_TARGET_MINUTES = parseTargets(process.env.TURNAROUND_TARGETS);

/**
 * The equal-length period immediately before this one, for the trend overlay.
 *
 * Calendar arithmetic done entirely in UTC — `Date.UTC` in, `getUTC*` out. That is not the
 * timezone bug CLAUDE.md warns about; it is the fix for it. The hazard there is mixing bases:
 * parsing 'YYYY-MM-DD' (which JavaScript reads as UTC midnight) and then reading it back with
 * LOCAL getters, which in PHT lands on the previous day. Staying in one basis for both halves
 * makes the result a pure day count, independent of where the server sits.
 *
 * Inclusive on both ends, matching how every range in this file is queried: 2026-08-01..08-07 is
 * seven days, and its predecessor is 2026-07-25..07-31.
 */
function previousPeriod(startDate, endDate) {
  const DAY_MS = 86400000;
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fromUtc = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const start = toUtc(startDate);
  const end = toUtc(endDate);
  const lengthDays = Math.round((end - start) / DAY_MS) + 1;

  return {
    startDate: fromUtc(start - lengthDays * DAY_MS),
    endDate: fromUtc(start - DAY_MS),
  };
}

function assertValidRange(startDate, endDate) {
  if (!startDate || !endDate) {
    const error = new Error('startDate and endDate are both required (YYYY-MM-DD).');
    error.statusCode = 400;
    throw error;
  }
  if (!DATE_FORMAT.test(startDate) || !DATE_FORMAT.test(endDate)) {
    const error = new Error('startDate and endDate must be in YYYY-MM-DD format.');
    error.statusCode = 400;
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error('startDate must not be after endDate.');
    error.statusCode = 400;
    throw error;
  }
}

class ReportService {
  async getSummaryReport(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const [revenueTrend, serviceVolume, visitStatusBreakdown, paymentMethodBreakdown] = await Promise.all([
      reportRepository.getRevenueTrend(startDate, endDate),
      reportRepository.getServiceVolume(startDate, endDate),
      reportRepository.getVisitStatusBreakdown(startDate, endDate),
      reportRepository.getPaymentMethodBreakdown(startDate, endDate)
    ]);

    return { revenueTrend, serviceVolume, visitStatusBreakdown, paymentMethodBreakdown };
  }

  /**
   * HMO claim value per provider for a date range.
   *
   * Returns the providers plus a `totals` row the caller does not have to re-derive, and a
   * `note` naming the one thing a reader can get wrong: `approved` is billable to the insurer,
   * not money the clinic holds. The figure travels with its own caveat because a number this
   * shape WILL be copied into a summary, and the caveat has to survive the copy.
   */
  async getHmoClaims(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const providers = await reportRepository.getHmoClaimTotals(startDate, endDate);

    const sum = (key) => providers.reduce((n, p) => n + Number(p[key] || 0), 0);
    const totals = {
      testsClaimed: providers.reduce((n, p) => n + Number(p.tests_claimed || 0), 0),
      visits: providers.reduce((n, p) => n + Number(p.visits || 0), 0),
      approved: Number(sum('approved').toFixed(2)),
      refused: Number(sum('refused').toFixed(2)),
      pending: Number(sum('pending').toFixed(2)),
      collected: Number(sum('collected').toFixed(2)),
    };

    return {
      providers,
      totals,
      note: 'Approved is billable to the insurer and is not part of counter takings.',
    };
  }

  async getStaffWorkload(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const [receptionWorkload, diagnosticWorkload] = await Promise.all([
      reportRepository.getReceptionWorkload(startDate, endDate),
      reportRepository.getDiagnosticWorkload(startDate, endDate)
    ]);

    return { receptionWorkload, diagnosticWorkload };
  }

  /**
   * Per-department operating metrics, in one call. [1.22.0]
   *
   * Each role has had a KPI strip counting what is in front of it right now — the cashier's
   * collections today, the receptionist's queue length — and none of them measured how the
   * department is *performing*. There was no answer anywhere to "which service earns the most",
   * "how long does a patient wait to be billed", or "is X-Ray slower this week than last".
   *
   * One endpoint rather than three, because the Admin dashboard needs all of it at once and the
   * per-role screens each take the slice they own. Three endpoints would mean the roll-up firing
   * three requests to build one page, and three chances for the numbers on it to come from
   * different moments.
   *
   * The caller's permissions decide which slices come back. That is not cosmetic: `billing` here
   * is the day's takings, and a diagnostic account holding `results:read` but not `billing:read`
   * should not receive the clinic's revenue merely because it asked for its own turnaround
   * figures. Absent rather than zeroed — a zero would read as "no money taken today".
   */
  async getOperationsReport(startDate, endDate, requestingUser) {
    assertValidRange(startDate, endDate);

    const permissions = requestingUser?.permissions || [];
    const isSuperAdmin = (requestingUser?.roles || []).includes('SuperAdmin');
    const may = (permission) => isSuperAdmin || permissions.includes(permission);

    // Holding none of the three is a refusal, not an empty report. This route carries no
    // authorizePermissions of its own precisely because the slices are the gate — so the gate has
    // to be able to say no, or the route would be reachable by any staff account for nothing.
    if (!may('billing:read') && !may('visits:read') && !may('results:read')) {
      const error = new Error('Access forbidden. You hold no permission that this report covers.');
      error.statusCode = 403;
      throw error;
    }

    const report = { startDate, endDate };

    const work = [];
    if (may('billing:read')) {
      work.push(
        Promise.all([
          reportRepository.getBillingTotals(startDate, endDate),
          reportRepository.getSalesByService(startDate, endDate),
          reportRepository.getPaymentMethodBreakdown(startDate, endDate),
        ]).then(([totals, byService, byMethod]) => {
          report.billing = { totals, byService, byMethod };
        })
      );
    }
    if (may('visits:read')) {
      work.push(
        reportRepository.getReceptionThroughput(startDate, endDate).then((throughput) => {
          report.reception = throughput;
        })
      );
    }
    if (may('results:read')) {
      // Department-scoped for the same reason the patient roster is [1.21.0]: a lab account has
      // no business reading X-Ray's throughput. `null` from departmentsForUser means unrestricted
      // (oversight), and is deliberately not the same as an empty list.
      const departments = departmentsForUser(requestingUser);
      work.push(
        Promise.all([
          reportRepository.getDiagnosticThroughput(startDate, endDate),
          reportRepository.getOutstandingWork(),
        ]).then(([byCategory, outstanding]) => {
          const visible = (rows) =>
            departments === null ? rows : rows.filter((r) => departments.includes(r.category_name));
          report.diagnostics = {
            byCategory: visible(byCategory),
            outstanding: visible(outstanding),
            scope: departments,
          };
        })
      );
    }

    await Promise.all(work);
    return report;
  }

  /**
   * Clinic analytics for the BI dashboard: turnaround against target, and arrivals by hour.
   * [1.62.0]
   *
   * Gated the same way `getOperationsReport` is, and for the same reason: this route carries no
   * `authorizePermissions` of its own, so the SLICES are the gate, and a caller holding neither
   * permission is REFUSED rather than handed an empty object. An empty analytics payload reads as
   * "the clinic did nothing this period", which is a different and much worse statement than
   * "you may not see this".
   *
   * Turnaround is department-scoped for the reason the patient roster is: a lab account has no
   * business reading X-Ray's performance. `departmentsForUser` returning `null` means oversight
   * and is deliberately not the same as an empty list.
   */
  async getAnalytics(startDate, endDate, requestingUser) {
    assertValidRange(startDate, endDate);

    const permissions = requestingUser?.permissions || [];
    const isSuperAdmin = (requestingUser?.roles || []).includes('SuperAdmin');
    const may = (permission) => isSuperAdmin || permissions.includes(permission);

    if (!may('results:read') && !may('visits:read')) {
      const error = new Error('Access forbidden. You hold no permission that this report covers.');
      error.statusCode = 403;
      throw error;
    }

    const report = { startDate, endDate, targets: TURNAROUND_TARGET_MINUTES };
    const work = [];

    if (may('results:read')) {
      const departments = departmentsForUser(requestingUser);
      work.push(
        reportRepository
          .getDepartmentTurnaroundPerformance(startDate, endDate, TURNAROUND_TARGET_MINUTES)
          .then((rows) => {
            report.turnaroundSla =
              departments === null ? rows : rows.filter((r) => departments.includes(r.category_name));
          })
      );
    }

    if (may('visits:read')) {
      work.push(
        reportRepository.getHourlyPatientArrivals(startDate, endDate).then((rows) => {
          report.hourlyArrivals = rows;
        })
      );
    }

    // The comparative overlay on the revenue trend. Money, so it answers to `billing:read` and
    // not to either of the two above — a technician reading their own turnaround figures does not
    // thereby get the clinic's takings.
    if (may('billing:read')) {
      const previous = previousPeriod(startDate, endDate);
      work.push(
        Promise.all([
          reportRepository.getRevenueTrend(startDate, endDate),
          reportRepository.getRevenueTrend(previous.startDate, previous.endDate),
        ]).then(([current, prior]) => {
          report.revenueComparison = {
            current,
            previous: prior,
            previousRange: previous,
          };
        })
      );
    }

    await Promise.all(work);
    return report;
  }
}

module.exports = new ReportService();
