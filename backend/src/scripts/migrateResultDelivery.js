/**
 * [1.59.0] Recording that a report was actually sent to the patient.
 *
 * ── What existed, and what nobody could answer ──────────────────────────────────────────────
 *
 * Releasing a result has emailed the patient since [1.0.0]. `releaseResult` builds the message,
 * calls `sendEmail`, and returns an `emailStatus` the technician sees as a toast — and then the
 * toast fades and the fact is gone. Nothing was written down.
 *
 * So three ordinary questions had no answer anywhere in the system:
 *
 *   "was this patient ever emailed?"          the release wrote Completed and released_by, and
 *                                             nothing about delivery. A technician looking at a
 *                                             released result a week later cannot tell whether it
 *                                             reached the patient or fell into an SMTP failure.
 *
 *   "they say they never got it"              there was no way to send it again. Release is the
 *                                             only path that emails, it is one-shot, and it
 *                                             cannot be repeated without re-releasing a result
 *                                             that is already out.
 *
 *   "which address did it go to?"             a patient who has since corrected their email needs
 *                                             to know the old one was used.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────────────────────
 *
 * Three columns on `test_results`, not a new table. Delivery is an attribute of the report — the
 * same place `released_by` and `released_at` already live — and the rows are one-per-VERSION,
 * which turns out to be exactly right: an amendment creates a new row, so a v2 correctly starts
 * with `emailed_at` NULL. The patient has been sent v1 and has NOT been sent v2, and the schema
 * says so without anyone having to reason about it.
 *
 * `emailed_at` records the last SUCCESSFUL send and nothing else, so `emailed_at IS NULL` means
 * "this report has never reached the patient" with no second interpretation. A failed attempt is
 * reported to the technician at the time and recorded in `audit_log`; it must not set a column
 * whose whole value is being unambiguous.
 *
 *   node src/scripts/migrateResultDelivery.js
 *   node src/scripts/migrateResultDelivery.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMP');
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS emailed_to VARCHAR(255)');
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS email_count INT NOT NULL DEFAULT 0');

    // Deliberately no backfill. Every existing released result was emailed at release time by
    // the code that has always done it, but we have no record of WHICH succeeded — and writing
    // a plausible timestamp would be inventing delivery evidence for a medical report. NULL is
    // the honest answer: "this system does not know". Same reasoning as [1.32.0], which replaced
    // a fabricated refund date with the real one rather than keeping the guess.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_test_results_undelivered
        ON test_results (visit_test_id)
        WHERE is_current AND emailed_at IS NULL
    `);
  });

  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE is_current)::int AS current_results,
            COUNT(*) FILTER (WHERE is_current AND emailed_at IS NOT NULL)::int AS delivered
       FROM test_results`
  );
  console.log(`\n  test_results: ${rows[0].current_results} current, ${rows[0].delivered} with a recorded send.`);
  console.log('  Not backfilled on purpose — NULL means "unknown", not "never sent".\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query('DROP INDEX IF EXISTS idx_test_results_undelivered');
    await db.query('ALTER TABLE test_results DROP COLUMN IF EXISTS email_count');
    await db.query('ALTER TABLE test_results DROP COLUMN IF EXISTS emailed_to');
    await db.query('ALTER TABLE test_results DROP COLUMN IF EXISTS emailed_at');
  });
  console.log('\n  Rolled back. Delivery is no longer recorded.\n');
}

(async () => {
  try {
    if (process.argv.includes('--rollback')) await rollback();
    else await apply();
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
