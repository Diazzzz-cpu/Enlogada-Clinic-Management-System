/**
 * Moves an E2E visit's date, so a spec can test what happens to a visit an earlier day left open.
 * [1.130.0] The end-of-day close acts only on visits from before today, which no API can make.
 *
 * REFUSES TO RUN IN PRODUCTION, and refuses any visit whose patient is not a test fixture (the
 * reserved number 09000000000 every fixture is registered with, tests/e2e/helpers/people.js).
 * A negative --days moves it forward again, which a spec does before it ends so the teardown's
 * run-window purge still finds the row.
 *
 *   node src/scripts/e2eBackdateVisit.js --visit=123 --days=1
 *   node src/scripts/e2eBackdateVisit.js --visit=123 --days=-1
 */
require('dotenv').config();
const db = require('../config/database');

const FIXTURE_CONTACT = '09000000000';
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('backdate-visit refused: NODE_ENV=production');
    process.exit(1);
  }
  const visitId = Number(arg('visit'));
  const days = Number(arg('days') || 1);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    console.error('backdate-visit refused: --visit=<id> is required');
    process.exit(1);
  }
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 30) {
    console.error('backdate-visit refused: --days must be a whole number from -30 to 30, not 0');
    process.exit(1);
  }
  const { rows } = await db.query(
    `UPDATE patient_visits pv
        SET created_at = pv.created_at - ($2 || ' days')::interval
       FROM patients p
      WHERE pv.id = $1 AND p.id = pv.patient_id AND p.contact_number = $3
      RETURNING pv.id, pv.created_at`,
    [visitId, days, FIXTURE_CONTACT]
  );
  if (rows.length === 0) {
    console.error(`backdate-visit refused: visit ${visitId} is not a test fixture's`);
    process.exit(1);
  }
  console.log(`moved visit ${rows[0].id} to ${rows[0].created_at.toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`backdate-visit failed: ${err.message}`);
  process.exit(1);
});
