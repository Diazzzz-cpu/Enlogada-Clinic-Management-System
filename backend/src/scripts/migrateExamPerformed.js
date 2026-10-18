/**
 * When an exam was done, and by whom, for a department that issues no report here. [1.129.0]
 *
 * The X-ray department gives its results through its own system, so an X-ray test is finished by
 * marking the exam DONE on the worklist rather than by releasing a report. Without a report there
 * was nothing to say when it was done or who did it, and so nothing to count it by: the reports
 * time and count every other department from the release of its report. These two columns are
 * that record: `performed_at` and `performed_by` on the visit test.
 *
 * Adds the columns, the foreign key to users, and two indexes (the reports filter on
 * performed_at; the foreign key gets its own, as every growing one does since [1.29.0]). Nothing
 * to backfill: a test finished before this was finished by releasing a report, which the reports
 * already read.
 *
 *   node src/scripts/migrateExamPerformed.js
 *   node src/scripts/migrateExamPerformed.js --rollback
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
      await client.query('DROP INDEX IF EXISTS idx_visit_tests_performed_at');
      await client.query('DROP INDEX IF EXISTS idx_visit_tests_performed_by');
      await client.query('ALTER TABLE visit_tests DROP CONSTRAINT IF EXISTS fk_visit_tests_performed_by');
      await client.query('ALTER TABLE visit_tests DROP COLUMN IF EXISTS performed_by');
      await client.query('ALTER TABLE visit_tests DROP COLUMN IF EXISTS performed_at');
      await client.query('COMMIT');
      logger.info('[1.129.0] - visit_tests.performed_at / performed_by');
      return;
    }

    await client.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS performed_at TIMESTAMP');
    await client.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS performed_by INT');
    const { rows } = await client.query(
      `SELECT 1 FROM pg_constraint
        WHERE conrelid = 'visit_tests'::regclass AND conname = 'fk_visit_tests_performed_by'`
    );
    if (rows.length === 0) {
      await client.query(`ALTER TABLE visit_tests ADD CONSTRAINT fk_visit_tests_performed_by
                            FOREIGN KEY (performed_by) REFERENCES users(id)`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_visit_tests_performed_at
                          ON visit_tests (performed_at) WHERE performed_at IS NOT NULL`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_visit_tests_performed_by ON visit_tests (performed_by)');

    await client.query('COMMIT');
    logger.info('[1.129.0] + visit_tests.performed_at / performed_by');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(`[1.129.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
