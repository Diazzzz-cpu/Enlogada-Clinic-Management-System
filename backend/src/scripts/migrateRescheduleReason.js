/**
 * [1.105.0] Moving a booking says why.
 *
 * A reschedule recorded who moved the booking and from when to when (audit_log), and nothing
 * about the reason. The clinic could not tell a patient who was unwell from one who simply
 * changed their mind, nor a booking the clinic itself asked to move — and when staff moved one
 * over the phone, the patient's email said only that it had moved.
 *
 * Two columns on `appointments`, holding the LATEST move:
 *
 *   reschedule_reason  what the person moving it said. Required by the API from now on.
 *   rescheduled_at     when it last moved, so a screen can say "moved" without a reason too.
 *
 * Every move, with its reason, stays in audit_log — this is the current state, not the history.
 *
 * ── The backfill ────────────────────────────────────────────────────────────────────────────
 *
 * `rescheduled_at` is filled from audit_log's 'appointment.rescheduled' entries, which recorded
 * the real moment. `reschedule_reason` is NOT backfilled: nobody was asked, and inventing one would
 * be the [1.32.0] mistake of putting a guess where a fact belongs. Those rows read "no reason
 * recorded".
 *
 *   node src/scripts/migrateRescheduleReason.js
 *   node src/scripts/migrateRescheduleReason.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  const backfilled = await db.withTransaction(async () => {
    await db.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reschedule_reason VARCHAR(500)');
    await db.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMP');

    const { rowCount } = await db.query(`
      UPDATE appointments a
         SET rescheduled_at = moved.at
        FROM (
          SELECT entity_id, MAX(created_at) AS at
            FROM audit_log
           WHERE action = 'appointment.rescheduled'
             AND entity_type = 'appointment'
           GROUP BY entity_id
        ) moved
       WHERE moved.entity_id = a.id
         AND a.rescheduled_at IS NULL
    `);
    return rowCount;
  });

  console.log(`\n  appointments.reschedule_reason and rescheduled_at are in place.`);
  console.log(`  ${backfilled} earlier move(s) given their date from audit_log; their reason was never asked, so it stays empty.\n`);
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE appointments DROP COLUMN IF EXISTS reschedule_reason');
    await db.query('ALTER TABLE appointments DROP COLUMN IF EXISTS rescheduled_at');
  });
  console.log('\n  Rolled back. Each move\'s reason is still in audit_log.\n');
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
