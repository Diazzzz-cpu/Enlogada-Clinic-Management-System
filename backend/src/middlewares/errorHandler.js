const logger = require('../config/logger');
const { normalizeError, isOperationalError } = require('../errors');

/**
 * The one place an error becomes an HTTP response. [1.63.0]
 *
 * ── The response envelope is UNCHANGED, deliberately ────────────────────────────────────────
 *
 * `{ status, statusCode, message }` plus `stack` in development is what 295 E2E specs assert and
 * what every screen's error branch reads. Nothing below alters it. What changed is how the two
 * decisions inside are *made*, because both were being made by coincidence:
 *
 *   1. Whether the message is safe to show. This was `statusCode === 500 ? redact : show`, which
 *      happens to be right today only because every non-500 in the codebase is a message written
 *      for a user. It is now driven by `expose` on the error itself — so a future 500-class error
 *      that genuinely wants to say something, or a 4xx that must not, is decided at the throw
 *      site by the person who knows, rather than by a number comparison here.
 *
 *   2. What gets logged, and how loudly. Everything went to `logger.error`, so a patient mistyping
 *      a reference and getting a 404 produced the same log line as a null dereference. On a system
 *      that audits PHI reads and runs for months, that is how a real fault gets lost: the error log
 *      fills with routine 4xx and stops being read. A 4xx is now a warning with no stack — it is
 *      the caller's problem and we know exactly what happened — and only a 5xx carries a trace.
 *
 * ── Why the legacy idiom still works ────────────────────────────────────────────────────────
 *
 * 173 service call sites still throw `Object.assign(new Error(msg), { statusCode })` rather than
 * one of the classes in `../errors`. `isOperationalError` returns true for anything carrying a
 * numeric `statusCode`, so those are treated exactly as the classes are. Migration is therefore
 * optional and incremental, and nothing has to change for this handler to be correct.
 *
 * @param {Error} err   Whatever was thrown. Not required to be an Error — see `normalizeError`.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next  Unused; Express identifies an error handler by arity.
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  // A `catch` can receive a string, a rejected non-Error, or a raw pg error object. Narrowing here
  // means everything below has one shape to reason about.
  const error = normalizeError(err);

  const statusCode = error.statusCode || 500;
  const isDevelopment = req.app.get('env') === 'development';
  const operational = isOperationalError(error);

  // An anticipated refusal is not a fault. Logging it at `error` is what buries the real ones.
  if (statusCode >= 500) {
    logger.error(error);
  } else {
    logger.warn(`${statusCode} ${req.method} ${req.originalUrl} — ${error.message}`);
  }

  // `expose` is set by the error classes (true for 4xx, false for 5xx) and absent on the legacy
  // shape, where `operational` stands in for it. The fallback reproduces the previous rule exactly,
  // so a legacy 4xx still shows its message and a bare Error still does not.
  const mayShowMessage = error.expose ?? (operational && statusCode < 500);
  const message = error.message || 'Internal Server Error';

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: isDevelopment || mayShowMessage ? message : 'Something went wrong',
    ...(isDevelopment && { stack: error.stack })
  });
};
