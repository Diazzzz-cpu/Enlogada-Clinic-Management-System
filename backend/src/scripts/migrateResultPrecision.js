/**
 * Additive migration [1.53.0] — two defects an architecture review found in [1.50.0]..[1.52.0].
 *
 * ── A suppressed TSH stored as zero ──────────────────────────────────────────────────────────
 *
 * `result_measurements.value_1` was `NUMERIC(7,2)`, sized when the only fields were ultrasound
 * measurements in centimetres. [1.52.0] then put laboratory analytes on the same column, and
 * Postgres ROUNDS rather than errors: a TSH of 0.004 mIU/L stores as 0.00, and 0.001 and 0.009
 * become the same number. The value that reads as "undetectable" is exactly the clinically
 * decisive one, and it is the one that was being destroyed silently.
 *
 * NUMERIC(10,4) covers every analyte the clinic records — four decimals for a suppressed TSH, and
 * room to the left for an EFW in grams — without approaching a precision nobody measures to.
 *
 * ── A unique constraint that did not constrain ───────────────────────────────────────────────
 *
 * `uq_signatory UNIQUE (category_id, full_name, role_caption)` was commented "Re-running the seed
 * must not duplicate them." In PostgreSQL NULLs are DISTINCT in a unique constraint, so two
 * identical GLOBAL signatories — the `category_id IS NULL` case, which is the one meaning "signs
 * every report" — were both accepted. The seed is idempotent today only because it does its own
 * SELECT first and every seeded row happens to carry a real category; the constraint was doing
 * none of the work it claimed. Duplicates would also collide on the React key that renders the
 * signature block.
 *
 * A partial unique index covers the NULL case without needing PG15's NULLS NOT DISTINCT.
 *
 * Reverse with:
 *   node src/scripts/migrateResultPrecision.js --rollback
 *
 * The rollback narrows the column back to NUMERIC(7,2) and REFUSES if any stored value would lose
 * precision by doing so — a rounded clinical value is worse than a failed migration.
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  for (const col of ['value_1', 'value_2', 'value_3']) {
    await client.query(`ALTER TABLE result_measurements ALTER COLUMN ${col} TYPE NUMERIC(10,4)`);
  }
  logger.info('  ~ result_measurements.value_1..3 -> NUMERIC(10,4)');

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_signatory_global
      ON clinic_signatories (full_name, role_caption)
      WHERE category_id IS NULL
  `);
  logger.info('  + uq_signatory_global (the NULL-category case the constraint missed)');
}

async function rollback(client) {
  const { rows } = await client.query(`
    SELECT COUNT(*)::int AS n FROM result_measurements
     WHERE (value_1 IS NOT NULL AND value_1 <> ROUND(value_1, 2))
        OR (value_2 IS NOT NULL AND value_2 <> ROUND(value_2, 2))
        OR (value_3 IS NOT NULL AND value_3 <> ROUND(value_3, 2))
  `).catch(() => ({ rows: [{ n: 0 }] }));

  if (rows[0].n > 0) {
    logger.error(`  ! ${rows[0].n} recorded value(s) carry more than two decimals.`);
    logger.error('    Narrowing the column would round them silently — which is the exact defect');
    logger.error('    this migration exists to fix. Correct or remove those rows first.');
    throw new Error('refusing to round recorded clinical values');
  }

  await client.query('DROP INDEX IF EXISTS uq_signatory_global');
  logger.info('  - uq_signatory_global');
  for (const col of ['value_1', 'value_2', 'value_3']) {
    await client.query(`ALTER TABLE result_measurements ALTER COLUMN ${col} TYPE NUMERIC(7,2)`);
  }
  logger.info('  ~ result_measurements.value_1..3 -> NUMERIC(7,2)');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.53.0] ${reversing ? 'Rolling back' : 'Applying'} result value precision…`);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.53.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();
  logger.info('[1.53.0] Done.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.53.0] Migration failed: ${err.message}`);
  process.exit(1);
});
