/**
 * Take the critical-value workflow out of the database. [1.98.0]
 *
 * The clinic does not call panic values back. A reference range is printed on their own result
 * forms and the referring physician reads the report; deciding that a figure is an emergency, and
 * telephoning somebody about it, is not work this clinic performs or is answerable for. So the
 * flag, the outstanding-criticals list and the recorded callback are gone from the system rather
 * than left on screen as a feature nobody uses — a Critical Callbacks tile counting zero, with a
 * dialog behind it, claims the clinic watches for something it does not.
 *
 * Four columns go: is_critical, critical_acknowledged_at, critical_acknowledged_by and
 * critical_acknowledgement_note, with the FK and index that served them.
 *
 * THE FLAG IS COPIED INTO audit_log BEFORE IT IS DROPPED. A flag set on a released report is a
 * clinical statement somebody made about a real patient, and `--rollback` can restore the shape
 * of these columns but never their values. So every flagged row is written out as an audit entry
 * naming the result, its version, when it was released and whether a callback had been recorded,
 * which is where this app keeps everything else that must outlive the row it describes.
 *
 * `--rollback` re-creates the columns, the FK and the index, empty, and says so.
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

async function apply(client) {
  const { rows: flagged } = await client.query(`
    SELECT tr.id, tr.visit_test_id, tr.version, tr.released_at,
           tr.critical_acknowledged_at, tr.critical_acknowledgement_note,
           u.first_name || ' ' || u.last_name AS acknowledged_by_name
      FROM test_results tr
      LEFT JOIN users u ON u.id = tr.critical_acknowledged_by
     WHERE tr.is_critical
     ORDER BY tr.id
  `);

  for (const row of flagged) {
    const callback = row.critical_acknowledged_at
      ? `callback recorded ${row.critical_acknowledged_at.toISOString()} by ${row.acknowledged_by_name || 'an unnamed account'}` +
        (row.critical_acknowledgement_note ? ` — "${row.critical_acknowledgement_note}"` : '')
      : 'no callback was ever recorded';
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, description)
       VALUES (NULL, $1, $2, $3, $4, $5)`,
      [
        'System (migration 1.98.0)',
        'result.critical_flag_retired',
        'test_result',
        row.id,
        `Result #${row.id} (visit test #${row.visit_test_id}, version ${row.version}, released ` +
          `${row.released_at ? row.released_at.toISOString() : 'unknown'}) was flagged CRITICAL; ` +
          `${callback}. The critical-value workflow was withdrawn in [1.98.0] and the flag ` +
          'columns dropped, so this entry is the only remaining record of it.'
      ]
    );
  }
  logger.info(`  ~ ${flagged.length} flagged result(s) written to audit_log before the drop`);

  await client.query('DROP INDEX IF EXISTS idx_test_results_critical_ack_by');
  await client.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS fk_results_critical_ack_by');
  await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS critical_acknowledgement_note');
  await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS critical_acknowledged_by');
  await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS critical_acknowledged_at');
  await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS is_critical');
  logger.info('  - test_results.is_critical, .critical_acknowledged_at, .critical_acknowledged_by, .critical_acknowledgement_note');
  logger.info('  - fk_results_critical_ack_by, idx_test_results_critical_ack_by');

  // The permission goes with the routes it gated. Dropping the grants here as well as from
  // setupRbac.js means an existing database stops offering it without a full RBAC re-seed.
  const { rowCount } = await client.query(
    "DELETE FROM permissions WHERE name = 'results:acknowledge_critical'"
  );
  logger.info(`  - permission results:acknowledge_critical (${rowCount} row(s); role and account grants cascade)`);
}

async function rollback(client) {
  await client.query(`
    ALTER TABLE test_results
      ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS critical_acknowledged_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS critical_acknowledged_by INT,
      ADD COLUMN IF NOT EXISTS critical_acknowledgement_note TEXT
  `);
  await client.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS fk_results_critical_ack_by');
  await client.query(`
    ALTER TABLE test_results
      ADD CONSTRAINT fk_results_critical_ack_by FOREIGN KEY (critical_acknowledged_by) REFERENCES users(id)
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_test_results_critical_ack_by ON test_results(critical_acknowledged_by)');
  logger.info('  + the four columns, the FK and the index, all empty');
  logger.info('  ! the flags themselves are NOT restored — see audit_log, action result.critical_flag_retired');
  logger.info('  ! run setupRbac.js to put results:acknowledge_critical back');
}

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    logger.info(`[1.98.0] ${reversing ? 'Restoring' : 'Withdrawing'} the critical-value workflow…`);
    await client.query('BEGIN');
    if (reversing) await rollback(client); else await apply(client);
    await client.query('COMMIT');
    logger.info(`[1.98.0] ${reversing ? 'Reversed.' : 'Done.'}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.98.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
