/**
 * Index the moment a report is released. [1.110.0]
 *
 * Every report that counts or times a release now filters on `test_results.authorised_at`, the
 * column that means "released". They read `released_at` before, which is stamped when a result is
 * SAVED — drafts counted as released, and turnaround was timed from when a report was typed.
 * `idx_test_results_released_at` served the old predicate; this serves the new one, so a date
 * range on the reports screen stays an index range scan rather than a read of every result.
 *
 * Partial on `authorised_at IS NOT NULL`: a draft has none, and nothing ever asks for a range of
 * NULLs.
 *
 *   node src/scripts/migrateAuthorisedIndex.js
 *   node src/scripts/migrateAuthorisedIndex.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    if (reversing) {
      await client.query('DROP INDEX IF EXISTS idx_test_results_authorised_at');
      logger.info('[1.110.0] - idx_test_results_authorised_at');
    } else {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_test_results_authorised_at
                            ON test_results (authorised_at) WHERE authorised_at IS NOT NULL`);
      logger.info('[1.110.0] + idx_test_results_authorised_at');
    }
  } catch (err) {
    logger.error(`[1.110.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
