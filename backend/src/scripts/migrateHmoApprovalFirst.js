/**
 * Payment first, for HMO bookings too. [1.132.0]
 *
 * Steven: an HMO booking is kept once its HMO approves it, as a self-pay one is once it is paid.
 * From now on an HMO booking holds its slot until its own start while the claim waits, and a
 * refused one gets the payment window (hmoService.settleBookingAfterDecision). Before, every HMO
 * booking took its slot for good. This brings the bookings already made under the new rule:
 *
 *   - a booking not yet checked in, not paid, with a claim still undecided: holds its slot until
 *     its own start (one whose start has passed is then released by the next sweep, and logged);
 *   - a booking not yet checked in, not paid, from today on, whose claim was refused in full:
 *     the payment window, from now.
 *
 * No email is sent from here. Data only, no schema change.
 *
 *   node src/scripts/migrateHmoApprovalFirst.js
 *   node src/scripts/migrateHmoApprovalFirst.js --rollback   (HMO bookings take their slot for good
 *                                                              again: their holds are cleared)
 */
require('dotenv').config();
const db = require('../config/database');
const logger = require('../config/logger');
const { hmoEffectiveStatus } = require('../constants/hmoEffectiveStatus');
const { HMO_HOLD_SQL, PAY_WINDOW_EXPIRY_SQL } = require('../constants/slotHold');

const CLAIM_LINES = `SELECT ${hmoEffectiveStatus('hr', 'hrt')} AS eff
                       FROM hmo_request_tests hrt
                       JOIN hmo_requests hr ON hr.id = hrt.hmo_request_id
                       JOIN visit_tests vt ON vt.id = hrt.visit_test_id
                      WHERE vt.patient_visit_id = a.patient_visit_id`;
const UNPAID = `NOT EXISTS (SELECT 1 FROM payments pay
                             WHERE pay.patient_visit_id = a.patient_visit_id AND pay.payment_status = 'Paid')`;

async function main() {
  if (process.argv.includes('--rollback')) {
    const { rowCount } = await db.query(
      `UPDATE appointments a SET held_until = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE a.held_until IS NOT NULL AND EXISTS (${CLAIM_LINES})`
    );
    logger.info(`[1.132.0] rollback: ${rowCount} HMO booking(s) take their slot for good again.`);
    return;
  }

  const { waiting, refused } = await db.withTransaction(async () => {
    const w = await db.query(
      `UPDATE appointments a SET held_until = ${HMO_HOLD_SQL('a.scheduled_date', 'a.scheduled_time')},
              updated_at = CURRENT_TIMESTAMP
        WHERE a.status = 'Pending' AND ${UNPAID}
          AND EXISTS (SELECT 1 FROM (${CLAIM_LINES}) l WHERE l.eff = 'Pending')
        RETURNING a.id`
    );
    const r = await db.query(
      `UPDATE appointments a SET held_until = ${PAY_WINDOW_EXPIRY_SQL}, updated_at = CURRENT_TIMESTAMP
        WHERE a.status = 'Pending' AND a.held_until IS NULL AND a.scheduled_date >= CURRENT_DATE AND ${UNPAID}
          AND EXISTS (SELECT 1 FROM (${CLAIM_LINES}) l)
          AND NOT EXISTS (SELECT 1 FROM (${CLAIM_LINES}) l WHERE l.eff <> 'Rejected')
        RETURNING a.id`
    );
    return { waiting: w.rowCount, refused: r.rowCount };
  });
  logger.info(`[1.132.0] ${waiting} HMO booking(s) now wait for their claim until their start; ${refused} refused one(s) given the payment window.`);
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    logger.error(`[1.132.0] Failed: ${err.message}`);
    process.exitCode = 1;
    await db.pool.end().catch(() => {});
  });
