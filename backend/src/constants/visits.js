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

/**
 * How a visit came about, as the patient is told it. [1.136.0]
 *
 *   walk_in   registered at the Desk, with no booking
 *   online    booked by the patient (or their family) in the portal
 *   clinic    booked by a member of staff
 *
 * `booked_online` is stored when the booking is made rather than worked out later: comparing
 * `created_by` with the record's owner flips a past "Booked online" to "Booked by the clinic" the
 * moment a record is unlinked or moved to another account, and a staff member's roles change.
 * Mirrored by frontend/src/lib/visitOrigin.js for the labels.
 */
const CAME_IN_AS = (pv) => `CASE WHEN ${pv}.visit_type = 'Walk in' THEN 'walk_in'
            WHEN ${pv}.booked_online THEN 'online'
            ELSE 'clinic' END`;

module.exports = { VISIT_TYPES, VISIT_STATUSES, CAME_IN_AS };
