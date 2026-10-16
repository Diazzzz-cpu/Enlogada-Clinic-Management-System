/**
 * A verification code on every released report. [1.126.0]
 *
 * Adds `test_results.verification_code`, gives one to every version already AUTHORISED (so a
 * report released before today can be checked as well as one released after), then adds the
 * UNIQUE and CHECK constraints. Codes come from utils/verificationCode.js, the same generator the
 * release path uses, never from SQL: one rule for what a code looks like.
 *
 * Safe to re-run: the column and constraints are IF NOT EXISTS, and the backfill touches only
 * authorised versions that still have no code, so a code already printed on a patient's copy is
 * never replaced.
 *
 *   node src/scripts/migrateReportVerification.js
 *   node src/scripts/migrateReportVerification.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');
const { generateCode } = require('../utils/verificationCode');

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) {
      await client.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS chk_results_verification_code');
      await client.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS uq_test_results_verification_code');
      await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS verification_code');
      await client.query('COMMIT');
      logger.info('[1.126.0] - test_results.verification_code');
      return;
    }

    await client.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10)');

    const { rows } = await client.query(
      `SELECT id FROM test_results
        WHERE authorised_at IS NOT NULL AND verification_code IS NULL
        ORDER BY id`
    );
    const issued = new Set();
    for (const { id } of rows) {
      let code = generateCode();
      while (issued.has(code)) code = generateCode();
      issued.add(code);
      await client.query('UPDATE test_results SET verification_code = $2 WHERE id = $1', [id, code]);
    }

    const { rows: existing } = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'test_results'::regclass
          AND conname IN ('uq_test_results_verification_code', 'chk_results_verification_code')`
    );
    const has = new Set(existing.map((r) => r.conname));
    if (!has.has('uq_test_results_verification_code')) {
      await client.query(`ALTER TABLE test_results
                            ADD CONSTRAINT uq_test_results_verification_code UNIQUE (verification_code)`);
    }
    if (!has.has('chk_results_verification_code')) {
      await client.query(`ALTER TABLE test_results ADD CONSTRAINT chk_results_verification_code CHECK (
                            verification_code IS NULL
                            OR (authorised_at IS NOT NULL AND verification_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'))`);
    }

    await client.query('COMMIT');
    logger.info(`[1.126.0] + test_results.verification_code (${rows.length} released report version(s) given a code)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(`[1.126.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
