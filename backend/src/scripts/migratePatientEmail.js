/**
 * [1.60.0] An email address on the patient record itself.
 *
 * ── The feature that could not reach anybody ────────────────────────────────────────────────
 *
 * [1.59.0] gave the clinic an "Email Result" button and a record of what was sent. Measured
 * immediately afterwards, across all three modalities:
 *
 *   Laboratory  15 released results,  0 with an address
 *   X-Ray       12 released results,  0 with an address
 *   Ultrasound  13 released results,  0 with an address
 *
 * Forty released reports and nowhere to send a single one of them. The only address in the system
 * was `users.email`, reached through `patients.user_id` — and `user_id` is NULLABLE precisely
 * because reception registers walk-ins at the counter without a web account. That is how most of
 * this clinic's patients arrive, so "no email on file" was not an edge case; it was the norm, and
 * the delivery feature was unusable in practice for the people it was built for.
 *
 * ── Why a column on `patients` and not an account for everyone ──────────────────────────────
 *
 * Forcing a walk-in to create a login before the clinic can email them a result is a worse
 * clinic, not a better database. Somebody at the counter can say their email address in four
 * seconds; they cannot choose a password, confirm it and verify an inbox while a queue forms
 * behind them.
 *
 * ── Which address wins ──────────────────────────────────────────────────────────────────────
 *
 * COALESCE(NULLIF(p.email,''), u.email): the patient record first, the owning account second.
 *
 * The order matters because one account owns several patient profiles — a parent booking for
 * dependents, which is exactly why `GET /patients/my-profiles` is plural. The account's address
 * is the right default for a dependent, since the parent is the one who booked. But an address
 * typed onto a specific patient's record is a deliberate statement about THAT patient, and it
 * should win over an inherited one. Falling back rather than replacing means no existing
 * client-owned patient loses the address they already had.
 *
 *   node src/scripts/migratePatientEmail.js
 *   node src/scripts/migratePatientEmail.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS email VARCHAR(255)');

    // Deliberately NOT unique and NOT required. A household shares an address more often than
    // not — a mother and two children on one inbox is ordinary — and a UNIQUE here would refuse
    // the second child at the counter for no clinical reason. Nor is it mandatory: a patient
    // entitled to their result must never be turnable away for not having email.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_patients_email
        ON patients (LOWER(email)) WHERE email IS NOT NULL
    `);
  });

  // No backfill from users.email. The read COALESCEs, so a client-owned patient already resolves
  // to their account address — copying it into the row would freeze a value that should follow
  // the account when it changes, and create two places to correct one typo.
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS with_own_email,
            COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS with_account
       FROM patients WHERE archived_at IS NULL`
  );
  const { total, with_own_email: own, with_account: acct } = rows[0];
  console.log(`\n  patients: ${total} active — ${own} with their own email, ${acct} reachable via an account.`);
  console.log(`  ${total - own - acct} currently have no address at all; reception can add one from Patient Records.\n`);
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query('DROP INDEX IF EXISTS idx_patients_email');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS email');
  });
  console.log('\n  Rolled back. Only account-owned patients have an address again.\n');
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
