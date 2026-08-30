/**
 * [1.56.0] Archiving a patient record.
 *
 * ── Archive is not delete, and that distinction is the whole feature ────────────────────────
 *
 * A clinic accumulates records it no longer works with — a patient who moved away, a duplicate
 * created before someone searched properly, a profile opened in error. They clutter the roster
 * every receptionist searches all day, and there is currently no way to put one aside.
 *
 * Deleting is not the answer and must never become it. A patient row is the parent of their
 * visits, their bills and their results; removing it would either fail on the foreign keys or,
 * worse, take a clinical and financial history with it. Philippine practice expects diagnostic
 * records to be retained for years, and a receipt already issued must stay explicable.
 *
 * So: two nullable columns. `archived_at` NULL means active, which is every existing row without
 * a backfill. Nothing is removed, nothing cascades, and un-archiving is setting it back to NULL.
 *
 * `archived_by` is who decided. An archive is an editorial act on someone's medical record — it
 * hides them from the roster the front desk works from — and "who did this" is the first question
 * anyone asks when a record cannot be found.
 *
 *   node src/scripts/migratePatientArchive.js
 *   node src/scripts/migratePatientArchive.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP');
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS archived_by INT');

    const { rows } = await db.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'fk_patients_archived_by'`
    );
    if (rows.length === 0) {
      await db.query(`
        ALTER TABLE patients
          ADD CONSTRAINT fk_patients_archived_by FOREIGN KEY (archived_by) REFERENCES users(id)
      `);
    }

    // Partial: archived records are the minority and always will be, so the index covers the
    // rows the roster query excludes rather than the whole table.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_patients_archived
        ON patients (archived_at) WHERE archived_at IS NOT NULL
    `);
  });

  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
            COUNT(*)::int AS total
       FROM patients`
  );
  console.log(`\n  patients: ${rows[0].total} total, ${rows[0].archived} archived.`);
  console.log('  archived_at IS NULL means active — no backfill needed.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query('DROP INDEX IF EXISTS idx_patients_archived');
    await db.query('ALTER TABLE patients DROP CONSTRAINT IF EXISTS fk_patients_archived_by');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS archived_by');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS archived_at');
  });
  console.log('\n  Rolled back. Any record that was archived is active again.\n');
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
