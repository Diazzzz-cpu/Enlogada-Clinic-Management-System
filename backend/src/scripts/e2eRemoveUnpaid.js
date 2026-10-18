/**
 * Removes one unpaid booking or visit now, as the server does once its time is up. [1.131.0]
 *
 * Nothing is cancelled any more: an unpaid booking or walk-in is temporary and is removed when its
 * time is up (unpaidExpiryService). A spec that made one cannot wait for that, and must free the
 * slot or the patient for the specs after it, so it removes its own here.
 *
 * REFUSES TO RUN IN PRODUCTION, and refuses anything that was ever paid or had a receipt issued:
 * that is the books, and no script removes it.
 *
 *   node src/scripts/e2eRemoveUnpaid.js --appointment=123
 *   node src/scripts/e2eRemoveUnpaid.js --visit=456
 */
require('dotenv').config();
const db = require('../config/database');
const visitRepository = require('../repositories/visitRepository');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('remove-unpaid refused: NODE_ENV=production');
    process.exit(1);
  }
  const appointmentId = arg('appointment');
  let visitId = arg('visit');
  if (appointmentId) {
    const { rows } = await db.query('SELECT patient_visit_id FROM appointments WHERE id = $1', [appointmentId]);
    if (!rows.length) {
      console.log(`appointment ${appointmentId} is already gone`);
      process.exit(0);
    }
    visitId = rows[0].patient_visit_id;
  }
  if (!Number.isInteger(visitId) || visitId <= 0) {
    console.error('remove-unpaid refused: --appointment=<id> or --visit=<id> is required');
    process.exit(1);
  }
  const { rows: paid } = await db.query(
    `SELECT 1 FROM payments WHERE patient_visit_id = $1
        AND (payment_status IN ('Paid', 'Refunded') OR receipt_number IS NOT NULL)`,
    [visitId]
  );
  if (paid.length) {
    console.error(`remove-unpaid refused: visit ${visitId} was paid; a paid visit is never removed`);
    process.exit(1);
  }
  await db.withTransaction(() => visitRepository.removeVisits([visitId]));
  console.log(`removed visit ${visitId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`remove-unpaid failed: ${err.message}`);
  process.exit(1);
});
