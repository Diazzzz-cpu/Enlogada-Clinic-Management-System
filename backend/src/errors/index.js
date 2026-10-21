/**
 * The clinic's domain error vocabulary. [1.63.0]
 *
 * ── What this replaces, and why the replacement had to be shape-compatible ──────────────────
 *
 * 173 call sites across the service layer say the same four lines:
 *
 *     const error = new Error('Visit not found');
 *     error.statusCode = 404;
 *     throw error;
 *
 * That works, and it is why these classes are deliberately *additive* rather than a rewrite of the
 * transport contract. Each one sets exactly `message` and `statusCode` — the two fields
 * `errorHandler.js` has always read — so a route that throws `new NotFoundError('Visit not found')`
 * produces a byte-identical HTTP response to the four lines above. That property is what lets the
 * two idioms coexist while call sites migrate, with 295 E2E specs asserting the old responses
 * throughout.
 *
 * What the classes add over the ad-hoc shape:
 *
 *   1. The status code stops being a number somebody types. `error.statusCode = 403` on a
 *      not-found path is a plausible typo that no test would catch and no reader would question;
 *      `new NotFoundError(...)` cannot be wrong about its own status.
 *   2. `isOperational` separates "the caller did something we anticipated" from "we have a bug".
 *      The handler needs that distinction to decide what may safely be shown to a patient.
 *   3. A service can be tested for the KIND of failure — `expect(fn).rejects.toThrow(ConflictError)`
 *      — rather than for an English sentence that legitimately gets reworded.
 *
 * ── Why not subclass per feature ────────────────────────────────────────────────────────────
 *
 * The hierarchy is intentionally shallow and organised by HTTP meaning, not by domain. A
 * `VisitNotFoundError extends NotFoundError` buys nothing here: nothing catches errors by type to
 * branch on them — they travel to one handler — so a deeper tree would be ceremony that still
 * ends up rendering the same 404. Depth is worth paying for when something catches; nothing does.
 */

/**
 * Base class for every error this application raises on purpose.
 *
 * @param {string} message  Shown to the caller verbatim for any 4xx. Write it for the person who
 *                          will read it on screen — a receptionist or a patient — not for a log.
 * @param {number} statusCode  HTTP status. Subclasses fix this; pass it only for the base class.
 * @param {object} [options]
 * @param {boolean} [options.expose] Force whether the message may be shown in production.
 *                                   Defaults to true for 4xx, false for 5xx.
 */
class AppError extends Error {
  constructor(message, statusCode, { expose } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;

    /**
     * True when this error describes something the caller can understand and act on, rather than
     * a defect on our side. Drives whether the message survives into a production response.
     */
    this.isOperational = true;

    /**
     * Whether `message` is safe to show a user in production. A 4xx exists to tell the caller what
     * to do differently, so it is; a 5xx message is for us and may name internals, so it is not.
     */
    this.expose = expose ?? statusCode < 500;

    // Omit this constructor from the stack, so the trace starts at the throw site — the line a
    // reader actually wants — rather than at this file.
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 — the request is malformed or self-contradictory. Fix the input and retry. */
class ValidationError extends AppError {
  constructor(message = 'The request could not be understood.') {
    super(message, 400);
  }
}

/** 401 — not signed in, or the session is no longer valid. */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super(message, 401);
  }
}

/**
 * 403 — signed in, and not permitted.
 *
 * Deliberately distinct from `UnauthorizedError`, despite the HTTP names being the wrong way round
 * by convention: 401 means "we do not know who you are", 403 means "we do, and the answer is no".
 * Conflating them makes a permission problem look like a login problem, and sends the person to
 * sign in again to fix something signing in cannot fix.
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden.') {
    super(message, 403);
  }
}

/** 404 — the thing addressed does not exist, or is not visible to this caller. */
class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(message, 404);
  }
}

/**
 * 409 — the request is well-formed but the current state refuses it.
 *
 * The clinic's most common 409s are all "this has already happened": a visit already paid, a
 * second settled payment on one visit, a live HMO claim already raised for a test. The message
 * should name the remedy, not just the refusal — "Refund the payment first if the discount needs
 * to change" tells the cashier what to do; "Conflict" does not.
 */
class ConflictError extends AppError {
  constructor(message = 'That conflicts with the current state of this record.') {
    super(message, 409);
  }
}

/** 410 — it existed and is deliberately gone. Distinct from 404: do not retry. */
class GoneError extends AppError {
  constructor(message = 'This is no longer available.') {
    super(message, 410);
  }
}

/** 423 — temporarily locked, e.g. an account after repeated failed sign-ins. */
class LockedError extends AppError {
  constructor(message = 'This account is temporarily locked.') {
    super(message, 423);
  }
}

/**
 * 502 — an upstream service the clinic depends on failed or answered unusably.
 *
 * Kept separate from a 500 because the two call for different responses: a 500 is ours to fix, a
 * 502 means the clinic should carry on at the counter while somebody checks the provider. The
 * payment gateway raises this.
 */
class UpstreamServiceError extends AppError {
  constructor(message = 'An external service did not respond correctly.') {
    super(message, 502, { expose: true });
  }
}

/**
 * 503 — a capability exists in the code but is not configured on this deployment.
 *
 * The online payment gateway is the live example: with no API key it is dormant, and the honest
 * answer is "not available here, pay at the counter" rather than a 500 implying breakage.
 */
class ServiceUnavailableError extends AppError {
  constructor(message = 'This service is not currently available.') {
    super(message, 503, { expose: true });
  }
}

/**
 * Narrows an unknown thrown value to something the error handler can render.
 *
 * A `catch` block can receive anything — a string, a rejected non-Error, a Postgres error object.
 * This gives the handler one shape to reason about without it having to guess.
 *
 * @param {unknown} err  Whatever was thrown.
 * @returns {AppError|Error}  The value unchanged if it is already an Error; otherwise wrapped.
 */
function normalizeError(err) {
  const fromDb = fromDatabaseError(err);
  if (fromDb) return fromDb;
  if (err instanceof Error) return err;
  return new AppError(typeof err === 'string' ? err : 'An unexpected error occurred.', 500);
}

/**
 * The rule a named constraint enforces, in words a person at the counter can act on. [1.124.0]
 * A constraint absent from this list still gets the generic sentence for its error class.
 */
const CONSTRAINT_MESSAGES = {
  uq_payments_one_paid_per_visit: 'This visit has already been paid.',
  uq_paysub_one_live_per_visit: 'A payment for this visit is already waiting to be checked.',
  uq_hmo_one_live_claim_per_test: 'That test already has an HMO claim open.',
  uq_hmo_request_visit_test: 'That test is already on this HMO claim.',
  uq_users_email_lower: 'That email address is already used by another account.',
  users_email_key: 'That email address is already used by another account.',
  uq_visit_tests_visit_test: 'That test is already on this visit.',
  uq_tests_category_name: 'A service with that name already exists in this department.',
  test_packages_code_key: 'A package with that code already exists.',
  hmo_providers_name_key: 'An HMO provider with that name already exists.',
  discount_types_name_key: 'A discount with that name already exists.',
  uq_package_items: 'A package cannot list the same test twice.',
  chk_patients_sex: 'Sex must be Male or Female.',
  chk_payment_method: 'Payment method must be Cash, GCash or Bank.',
  chk_payment_methods_kind: 'The account type must be Cash, GCash or Bank.',
  chk_payment_amount: 'An amount cannot be negative.',
  chk_tests_price: 'A price cannot be negative.',
  chk_test_packages_price: 'A price cannot be negative.',
  chk_visit_tests_price: 'A price cannot be negative.',
  chk_feedback_answers_rating: 'Each answer must be one of the three on the form.',
  chk_visits_status: 'That is not a visit status.',
  chk_visit_tests_status: 'That is not a test status.',
  chk_appointments_status: 'That is not a booking status.',
  chk_visits_type: 'A visit is either a walk-in or an appointment.',
  chk_operating_hours_times: 'Closing time must be after opening time.',
  chk_schedule_override_times: 'Give both an opening and a closing time, closing after opening.',
  chk_schedule_override_interval: 'Slots must be between 5 and 240 minutes long.',
  chk_schedule_override_capacity: 'Capacity cannot be negative.',
  chk_discount_percentage: 'A discount must be between 0 and 100 percent.',
  uq_test_results_verification_code: 'That verification code is already in use. Release the report again.',
  chk_results_verification_code: 'Only a released report carries a verification code.',
  // [1.136.0] Portal invitations.
  uq_patient_invitations_open: 'This patient already has an invitation waiting. Send it again, or withdraw it first.',
  chk_patient_invitations_email: 'The invitation address must be in lower case.',
  chk_patient_invitations_relationship: 'Choose whose address this is.',
  chk_patient_invitations_consent: 'Choose who agreed to this.',
  chk_patient_invitations_consent_shape: "Who agreed doesn't fit whose address this is.",
  chk_patient_invitations_recipient: "Give the name of the person whose address this is.",
  chk_patient_invitations_closed: 'This invitation has already ended.',
  chk_patient_invitations_revoked: 'An ended invitation needs a reason.',
  chk_patient_invitations_reason: 'That is not a reason an invitation can end for.',
  chk_patients_account_relationship: 'Choose what the account holder is to this patient.',
  chk_visits_booked_online: 'Only a booking can be marked as booked online.',
};

/**
 * A Postgres error, turned into the refusal it really is. [1.124.0]
 *
 * Input the routes never checked (an id of "abc", a date of 2026-02-30, a second payment racing
 * the first) reached the database, which refused it correctly, and the refusal surfaced as a 500
 * with the database's own wording ("invalid input syntax for type integer"). A probe of every
 * route found about 1,400 of these. The database is right to refuse; this makes the answer say so
 * as the client's mistake (400/404/409) in plain words, for every route at once. Errors that are
 * not about the data sent (a lost connection, a syntax error in our own SQL) stay 500.
 *
 * @param {unknown} err
 * @returns {AppError|null}
 */
function fromDatabaseError(err) {
  if (!err || typeof err !== 'object' || typeof err.code !== 'string' || !('severity' in err)) return null;
  const known = err.constraint && CONSTRAINT_MESSAGES[err.constraint];
  switch (err.code) {
    case '22P02': // invalid_text_representation: "abc" where a number belongs
    case '22003': // numeric_value_out_of_range
      return new ValidationError(known || 'A number or ID in the request is not valid.');
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_value_out_of_range: 2026-02-30
      return new ValidationError('A date or time in the request is not valid.');
    case '2201W': // invalid_row_count_in_limit_clause
    case '2201X': // invalid_row_count_in_result_offset_clause
      return new ValidationError('The page or page size is not valid.');
    case '22001': // string_data_right_truncation
      return new ValidationError('Some of the text is too long.');
    case '22021': // character_not_in_repertoire (a NUL byte)
      return new ValidationError('Some of the text contains characters that cannot be stored.');
    case '23502': // not_null_violation
      return new ValidationError(known || 'Something required is missing.');
    case '23514': // check_violation
      return new ValidationError(known || 'One of the values is not allowed.');
    case '23505': // unique_violation: usually two people doing the same thing at once
      return new ConflictError(known || 'That already exists, or was just done by someone else.');
    case '23503': // foreign_key_violation
      return /still referenced/.test(err.detail || '')
        ? new ConflictError('This is still in use, so it cannot be removed.')
        : new NotFoundError('Something the request refers to does not exist.');
    default:
      return null;
  }
}

/**
 * Whether an error was raised deliberately by this application.
 *
 * Anything carrying a `statusCode` counts — which deliberately includes the 173 legacy
 * `error.statusCode = 404` sites, so they are treated exactly as the classes are and nothing has
 * to be migrated for the handler to behave correctly.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isOperationalError(err) {
  if (err instanceof AppError) return err.isOperational;
  return Boolean(err && typeof err.statusCode === 'number');
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  GoneError,
  LockedError,
  UpstreamServiceError,
  ServiceUnavailableError,
  normalizeError,
  fromDatabaseError,
  isOperationalError,
};
