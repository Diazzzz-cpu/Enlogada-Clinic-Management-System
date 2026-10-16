/**
 * What it means for an appointment to occupy a slot. [1.35.0]
 *
 * Three separate queries answer "is this slot taken" — the availability grid, the booking-time
 * capacity check, and the reschedule-time capacity check. They agreed before only because all
 * three happened to spell `status <> 'Cancelled'` the same way. Adding a second term to two of
 * them and forgetting the third is how a patient is shown a free slot and then refused it, so the
 * term lives here and all three read it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────────────────────
 *
 * A booking occupies its slot when it is not cancelled AND its claim is still good. A claim is
 * good when `held_until IS NULL` — a permanent booking — or when the hold has not yet lapsed.
 *
 * Permanent (held_until NULL) covers everything except one case:
 *   - anything staff creates: the patient is standing at the desk
 *   - an HMO booking: it is settled at the clinic by design, so it cannot be conditional on an
 *     online payment that will never happen
 *   - any booking that has been paid: the hold is cleared on settlement
 *
 * Provisional (held_until set) is only a client's own self-pay booking that is waiting on an
 * online payment. That is the one case where nobody has committed anything yet.
 *
 * ── Why a read-time predicate and not a cleanup job ─────────────────────────────────────────
 *
 * A sweeper would reopen the slot at the next sweep rather than at the moment the hold ends, so
 * between the two the slot is still wrongly blocked — the original bug, just shorter. This term
 * makes the slot reopen exactly when the hold lapses, with nothing scheduled and nothing to fail.
 * The abandoned row stays as a record of the attempt.
 *
 * `CURRENT_TIMESTAMP` is evaluated by Postgres, never by JavaScript: the server's clock is the one
 * that decides, and it is the same clock `CURRENT_DATE` uses everywhere else in this codebase.
 */

/** The SQL term. Callers must alias `appointments` as shown, or use the bare-table form below. */
const OCCUPIES_SLOT = (alias = '') => {
  const col = alias ? `${alias}.` : '';
  return `${col}status <> 'Cancelled'
    AND (${col}held_until IS NULL OR ${col}held_until > CURRENT_TIMESTAMP)`;
};

/**
 * How long a client has to finish paying before the slot goes back on sale.
 *
 * Fifteen minutes: long enough to open a banking app, log in and authorise a transfer; short
 * enough that a slot somebody walked away from is offered again within the same visit to the
 * page. Refreshed every time checkout is reopened, so a patient who is actually paying never
 * loses their slot to the clock — only one who has stopped.
 */
const HOLD_MINUTES = 15;

/** `now + HOLD_MINUTES`, computed in SQL so the database's clock is the only one that counts. */
const HOLD_EXPIRY_SQL = `CURRENT_TIMESTAMP + INTERVAL '${HOLD_MINUTES} minutes'`;

/**
 * How long a patient has to pay for a booking made online, when the clinic is paid by GCash or
 * bank transfer and a cashier checks the proof. [1.123.0]
 *
 * The clinic's rule is payment first: an online booking is the patient's once it is paid. Before
 * this, a booking only expired through the PayMongo gateway's 15-minute hold, which is switched
 * off, so an unpaid booking held its slot for good. Longer than the gateway's, because the patient
 * leaves the page to pay in their banking app and then comes back to upload the proof; a proof that
 * arrives in time keeps the slot until a cashier checks it. BOOKING_PAYMENT_MINUTES overrides it.
 */
const PAY_WINDOW_MINUTES = (() => {
  const n = Number(process.env.BOOKING_PAYMENT_MINUTES);
  return Number.isFinite(n) && n >= 15 && n <= 1440 ? Math.round(n) : 60;
})();
const PAY_WINDOW_EXPIRY_SQL = `CURRENT_TIMESTAMP + INTERVAL '${PAY_WINDOW_MINUTES} minutes'`;

module.exports = { OCCUPIES_SLOT, HOLD_MINUTES, HOLD_EXPIRY_SQL, PAY_WINDOW_MINUTES, PAY_WINDOW_EXPIRY_SQL };
