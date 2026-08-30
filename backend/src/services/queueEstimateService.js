const reportRepository = require('../repositories/reportRepository');
const logger = require('../config/logger');

/**
 * How long the patient in position N should expect to wait. [1.62.0]
 *
 * The clinic has counted queue tickets since [1.0.0] and has never been able to answer the one
 * question every person holding one asks. "You are number 12" is not an answer; "about twenty
 * minutes" is.
 *
 * ── The estimate is a SERVICE RATE times a queue length ─────────────────────────────────────
 *
 * `reportRepository.getMedianServiceMinutes` explains at length why the multiplier is the interval
 * between consecutive patients being served, and emphatically not the median WAIT that the
 * operations report shows. The short version: a wait already contains the queue, so multiplying by
 * queue length counts it twice and tells the fourth person in line they have four hours.
 *
 * ── It refuses to guess when it does not know ───────────────────────────────────────────────
 *
 * The measured rate comes from a percentile over recent settlements, and on a quiet clinic — or a
 * freshly reset database — there may be three or four usable samples behind it. A median of four
 * numbers is not a service rate, and publishing one to a waiting patient as "about 4 minutes"
 * is inventing precision the data cannot support.
 *
 * So below MIN_SAMPLE_SIZE the estimate falls back to a stated default and says so, in the payload,
 * via `basis`. A caller that wants to hedge the wording can; a caller that ignores it still gets a
 * sane number rather than a wild one. What must never happen is a confident figure derived from
 * nothing — that is the same failure as the dashboard reading "Today's Revenue ₱0.00" over a day
 * that took ₱8,344.
 *
 * ── Cached for a minute ─────────────────────────────────────────────────────────────────────
 *
 * The active queue POLLS. Recomputing a 30-day percentile on every poll from every open reception
 * terminal would put a windowed aggregate over the payments table into the hottest request path in
 * the app, to produce a number that moves by seconds from one minute to the next. The rate is
 * cached; the queue length behind it is always live, which is the half that actually changes.
 */

// Below this many observed gaps, the measured median is noise and the default is used instead.
const MIN_SAMPLE_SIZE = 10;

// The stand-in when there is not enough history. A round number on purpose: it is a stated
// assumption, not a measurement, and dressing it up as 5.7 would imply otherwise.
const DEFAULT_SERVICE_MINUTES = 6;

// How far back the rate is measured. Long enough to cover a quiet week, short enough that a
// change in how the clinic works reaches the estimate within a month.
const LOOKBACK_DAYS = 30;

const RATE_CACHE_MS = 60000;

// Nothing useful can be said about a wait longer than this, so it is reported as a ceiling rather
// than as a number. "About 3 hours" invites a patient to leave; "over 90 minutes" is the honest
// shape of the same fact and does not pretend to a precision the model does not have.
const MAX_REPORTABLE_MINUTES = 90;

let cache = { value: null, expiresAt: 0 };

class QueueEstimateService {
  /**
   * The current service rate, cached. Never throws: a failure here must not take out the queue
   * screen, which works perfectly well without an estimate and did so for sixty-one versions.
   */
  async getServiceRate() {
    const now = Date.now();
    if (cache.value && cache.expiresAt > now) return cache.value;

    let rate = { minutes: DEFAULT_SERVICE_MINUTES, sampleSize: 0, basis: 'default' };
    try {
      const row = await reportRepository.getMedianServiceMinutes(LOOKBACK_DAYS);
      const measured = Number(row?.median_minutes);
      const sampleSize = Number(row?.sample_size) || 0;
      if (sampleSize >= MIN_SAMPLE_SIZE && Number.isFinite(measured) && measured > 0) {
        rate = { minutes: measured, sampleSize, basis: 'measured' };
      } else {
        rate.sampleSize = sampleSize;
      }
    } catch (err) {
      logger.warn(`Queue service rate could not be measured (${err.message}); using the default.`);
    }

    cache = { value: rate, expiresAt: now + RATE_CACHE_MS };
    return rate;
  }

  /** Drops the cached rate. For tests and for the scripts that reset demo data underneath it. */
  resetCache() {
    cache = { value: null, expiresAt: 0 };
  }

  /**
   * Turns a queue position into an estimate.
   *
   * Rounded to the nearest five minutes, which is not cosmetic: "about 15 minutes" is a promise a
   * clinic can keep and "about 13 minutes" is one it cannot. The rounding communicates the
   * model's actual precision, and a patient reads a round number as an estimate and a precise one
   * as a commitment.
   *
   * Nobody is ever told zero. A patient at the front of the queue is next, not already finished,
   * so the floor is the service time itself — one patient still has to be dealt with, and that
   * patient is them.
   */
  estimateFor(patientsAhead, rate) {
    const ahead = Math.max(0, Number(patientsAhead) || 0);
    const perPatient = rate?.minutes || DEFAULT_SERVICE_MINUTES;

    const raw = (ahead + 1) * perPatient;
    const rounded = Math.max(5, Math.round(raw / 5) * 5);
    const capped = Math.min(rounded, MAX_REPORTABLE_MINUTES);

    return {
      patients_ahead: ahead,
      estimated_wait_minutes: capped,
      // True when the real estimate ran past the ceiling, so the UI can say "over 90 minutes"
      // rather than stating 90 as though it were the answer.
      estimate_is_capped: rounded > MAX_REPORTABLE_MINUTES,
      estimate_basis: rate?.basis || 'default',
    };
  }

  /**
   * Annotates rows that already carry `patients_ahead` from the queue window function.
   *
   * One rate fetch for the whole page, not one per row — the rate is a property of the clinic, not
   * of the patient, and fetching it per row would turn a polled list into N aggregate queries.
   *
   * A row already past the desk gets no estimate at all rather than a zero: 'Processing' means
   * billed and sent to a department, where this model — which measures the front desk — has
   * nothing to say. A zero would read as "no wait", which is a different and wrong claim.
   */
  async annotate(rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const rate = await this.getServiceRate();

    return rows.map((row) => {
      if (row.status !== 'Pending') {
        return { ...row, estimated_wait_minutes: null, estimate_basis: null };
      }
      return { ...row, ...this.estimateFor(row.patients_ahead, rate) };
    });
  }
}

module.exports = new QueueEstimateService();
module.exports.__constants = {
  MIN_SAMPLE_SIZE,
  DEFAULT_SERVICE_MINUTES,
  MAX_REPORTABLE_MINUTES,
  LOOKBACK_DAYS,
};
