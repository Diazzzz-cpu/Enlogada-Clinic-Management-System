/**
 * The two closed sets `patient_visits` is constrained to, named once. [1.58.0]
 *
 * These mirror `chk_visits_type` and `chk_visits_status` in database/schema.sql. They exist as
 * constants because a filter has to allow-list what it will pass to SQL, and the alternative —
 * an inline array at the one call site — is a second copy of a database constraint that nothing
 * keeps in step with it. `paymentMethods.js` and `moneyRange.js` exist for the same reason.
 *
 * If a value is added to either CHECK, add it here in the same commit.
 */
const VISIT_TYPES = ['Walk in', 'Appointment'];

const VISIT_STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];

module.exports = { VISIT_TYPES, VISIT_STATUSES };
