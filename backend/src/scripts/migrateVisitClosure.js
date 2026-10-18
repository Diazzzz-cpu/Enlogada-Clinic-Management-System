/**
 * Why a visit was closed without being finished. [1.130.0]
 *
 * A walk-in nobody paid for, and a booking nobody came for, stayed 'Pending' forever: in no queue,
 * not payable at the till (its queue is today's), and read as waiting on Visit History. The
 * end-of-day close (jobs/dayCloseScheduler.js) closes them the day after, and these two columns
 * say why and when, so a cancelled visit is not a mystery on the patient's record.
 *
 *   node src/scripts/migrateVisitClosure.js
 *   node src/scripts/migrateVisitClosure.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) {
      await client.query('ALTER TABLE patient_visits DROP COLUMN IF EXISTS closed_reason');
      await client.query('ALTER TABLE patient_visits DROP COLUMN IF EXISTS closed_at');
      await client.query('COMMIT');
      logger.info('[1.130.0] - patient_visits.closed_reason / closed_at');
      return;
    }
    await client.query('ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(200)');
    await client.query('ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP');
    await client.query('COMMIT');
    logger.info('[1.130.0] + patient_visits.closed_reason / closed_at');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(`[1.130.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
