/**
 * cleanE2eData.js — removes accumulated Playwright/e2e fixture data from a DEV database.
 *
 * Why this exists: the clinic schedule seeds `max_concurrent_bookings = 1` on 30-minute
 * slots (18 bookable slots per weekday). Every e2e run books real slots and never releases
 * them, so after ~3 days of runs every bookable day in the 14-day window was 100% full and
 * booking was impossible — for the test suite AND for anyone using the app. The suite was
 * effectively poisoning itself. Run this before/after a suite run to reset the fixture load.
 *
 * SAFETY:
 *   - Dry-run by default. Pass --apply to actually delete.
 *   - Runs in a single transaction; any error rolls the whole thing back.
 *   - Never touches non-e2e accounts. The keep-list is every user whose email is NOT
 *     @enlogada-e2e.test — i.e. the seeded @enlogada.com staff/client accounts and any
 *     real personal accounts.
 *   - Every FK in this schema is NO ACTION (no cascades), so deletion order is load-bearing;
 *     children are removed before parents below.
 *
 * Usage (from backend/):
 *   node src/scripts/cleanE2eData.js                      # dry run — counts only
 *   node src/scripts/cleanE2eData.js --apply              # perform the purge
 *   node src/scripts/cleanE2eData.js --apply --unlimited-slots   # also lift the dev slot cap
 *   node src/scripts/cleanE2eData.js --apply --restore-slots     # put the cap back to 1
 *
 * Lift the cap only while you need it, and put it back before demonstrating anything. At 9999 the
 * availability screen reports every slot free no matter how many bookings it holds, so two
 * patients can be given the same 08:00 — and nothing on any screen says why. The suite no longer
 * needs the cap lifted: booking-atomicity.spec.js and ticket-release-gating.spec.js each claim
 * their own slot, and the teardown purge releases them at the end of every run.
 */
require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const UNLIMITED_SLOTS = process.argv.includes('--unlimited-slots');
// Puts the cap back. --unlimited-slots had no inverse, so the only way out of it was a hand-written
// UPDATE that nobody would think to run — and a lifted cap is invisible until you notice the
// booking page offering the same 08:00 to everybody, forever. Leaving a one-way door on a
// destructive-ish dev switch is how a demo ends up double-booking a slot in front of a client.
const RESTORE_SLOTS = process.argv.includes('--restore-slots');
const DEV_SLOT_CAPACITY = 9999;
// What schema.sql seeds. One patient per 30-minute slot is the clinic's actual rule.
const REAL_SLOT_CAPACITY = 1;

const E2E_EMAIL = `'%@enlogada-e2e.test'`;

// Walk-in patients (user_id IS NULL) carry no email, so they need another signal.
//
// The reserved contact number is the one that matters going forward. Fixtures are named after
// real-sounding people now (see tests/e2e/helpers/people.js) precisely so that a run in progress
// does not fill the clinic's screens with `E2E Pkg1786480428` — which means the NAME can no longer
// identify them, and must not be relied on. 0900 is not a Philippine mobile prefix, so no live
// patient can collide with it.
//
// The old name shapes are kept below, and only for history: a database that silted up before this
// changed is full of them (a trailing epoch-ms stamp — Fixture17863654052789542,
// Reyes-17863726459464828 — a spec-prefixed first name, or a fixture-suffixed surname). Verified
// at the time to cover 1063/1063 walk-ins with 0 unmatched. Removing them would strand those rows
// permanently, so they stay until a database is known to be clean.
//
// Note that the AUTOMATIC teardown never used any of this: purgeE2eData.js scopes by the
// throwaway email domain and by the run's start timestamp, both name-independent. This script is
// the manual tool for a database that is already dirty.
const WALKIN_FIXTURE = `(
  p.contact_number = '09000000000'
  OR p.last_name ~ '[0-9]{8,}$'
  OR p.first_name ~ '^(M[0-9]+|E2E|Toast|Hmo|Returning|Search|Audit|Appt|Walkin)'
  OR p.last_name ~ '(Walkin|Tamper|Verify)$'
)`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  const report = [];

  try {
    await client.query('BEGIN');

    // ---- Build the target sets as temp tables so every later step shares one definition ----
    await client.query(`
      CREATE TEMP TABLE _e2e_users ON COMMIT DROP AS
        SELECT id FROM users WHERE email ILIKE ${E2E_EMAIL}
    `);
    await client.query(`
      CREATE TEMP TABLE _fx_patients ON COMMIT DROP AS
        SELECT p.id FROM patients p
        WHERE p.user_id IN (SELECT id FROM _e2e_users)
           OR (p.user_id IS NULL AND ${WALKIN_FIXTURE})
    `);
    await client.query(`
      CREATE TEMP TABLE _fx_visits ON COMMIT DROP AS
        SELECT pv.id FROM patient_visits pv WHERE pv.patient_id IN (SELECT id FROM _fx_patients)
    `);
    await client.query(`
      CREATE TEMP TABLE _fx_visit_tests ON COMMIT DROP AS
        SELECT vt.id FROM visit_tests vt WHERE vt.patient_visit_id IN (SELECT id FROM _fx_visits)
    `);
    // HMO requests are linked to visits only indirectly (hmo_request_tests.visit_test_id),
    // so capture the parent ids before their join rows are deleted.
    await client.query(`
      CREATE TEMP TABLE _fx_hmo_requests ON COMMIT DROP AS
        SELECT DISTINCT hrt.hmo_request_id AS id FROM hmo_request_tests hrt
        WHERE hrt.visit_test_id IN (SELECT id FROM _fx_visit_tests)
    `);

    for (const [label, table] of [
      ['e2e users', '_e2e_users'],
      ['fixture patients', '_fx_patients'],
      ['fixture visits', '_fx_visits'],
      ['fixture visit_tests', '_fx_visit_tests'],
      ['fixture hmo_requests', '_fx_hmo_requests'],
    ]) {
      const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
      report.push({ step: `TARGET ${label}`, rows: r.rows[0].c });
    }

    // ---- Reassign references held by KEPT rows before their owner user disappears ----
    // An e2e staff account may have created/processed/released a record belonging to a
    // patient we are keeping. Deleting the user would violate a NO ACTION FK, so hand the
    // reference to the seeded Super Admin (id 1) rather than dropping a real record.
    const reassign = [
      ['patient_visits.created_by', `UPDATE patient_visits SET created_by = 1
         WHERE created_by IN (SELECT id FROM _e2e_users) AND id NOT IN (SELECT id FROM _fx_visits)`],
      ['payments.processed_by', `UPDATE payments SET processed_by = 1
         WHERE processed_by IN (SELECT id FROM _e2e_users)
           AND patient_visit_id NOT IN (SELECT id FROM _fx_visits)`],
      ['test_results.released_by', `UPDATE test_results SET released_by = 1
         WHERE released_by IN (SELECT id FROM _e2e_users)
           AND visit_test_id NOT IN (SELECT id FROM _fx_visit_tests)`],
      ['user_roles.assigned_by', `UPDATE user_roles SET assigned_by = 1
         WHERE assigned_by IN (SELECT id FROM _e2e_users)
           AND user_id NOT IN (SELECT id FROM _e2e_users)`],
    ];
    for (const [label, sql] of reassign) {
      const r = await client.query(sql);
      if (r.rowCount) report.push({ step: `REASSIGN ${label} -> user 1`, rows: r.rowCount });
    }

    // ---- Delete children before parents (all FKs are NO ACTION) ----
    const deletes = [
      ['hmo_request_tests', `DELETE FROM hmo_request_tests WHERE visit_test_id IN (SELECT id FROM _fx_visit_tests)`],
      ['hmo_requests', `DELETE FROM hmo_requests WHERE id IN (SELECT id FROM _fx_hmo_requests)
         AND id NOT IN (SELECT hmo_request_id FROM hmo_request_tests)`],
      ['test_results', `DELETE FROM test_results WHERE visit_test_id IN (SELECT id FROM _fx_visit_tests)`],
      // A proof of payment points at both the visit and the payment it became. [1.48.0]
      ['payment_submissions', `DELETE FROM payment_submissions WHERE patient_visit_id IN (SELECT id FROM _fx_visits)`],
      ['payments', `DELETE FROM payments WHERE patient_visit_id IN (SELECT id FROM _fx_visits)`],
      ['appointments', `DELETE FROM appointments WHERE patient_visit_id IN (SELECT id FROM _fx_visits)`],
      ['visit_tests', `DELETE FROM visit_tests WHERE patient_visit_id IN (SELECT id FROM _fx_visits)`],
      ['patient_visits', `DELETE FROM patient_visits WHERE id IN (SELECT id FROM _fx_visits)`],
      ['patients', `DELETE FROM patients WHERE id IN (SELECT id FROM _fx_patients)`],
      ['audit_log', `DELETE FROM audit_log WHERE actor_id IN (SELECT id FROM _e2e_users)`],
      ['notification_reads', `DELETE FROM notification_reads WHERE user_id IN (SELECT id FROM _e2e_users)`],
      // By account, and by address for a sign-up that never became one. [1.73.0]
      ['auth_codes', `DELETE FROM auth_codes WHERE user_id IN (SELECT id FROM _e2e_users)
         OR email LIKE '%@enlogada-e2e.test'`],
      ['user_roles', `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM _e2e_users)`],
      ['users', `DELETE FROM users WHERE id IN (SELECT id FROM _e2e_users)`],
    ];
    for (const [label, sql] of deletes) {
      const r = await client.query(sql);
      report.push({ step: `DELETE ${label}`, rows: r.rowCount });
    }

    if (UNLIMITED_SLOTS && RESTORE_SLOTS) {
      throw new Error('--unlimited-slots and --restore-slots are opposites; pass one.');
    }
    if (UNLIMITED_SLOTS || RESTORE_SLOTS) {
      const capacity = RESTORE_SLOTS ? REAL_SLOT_CAPACITY : DEV_SLOT_CAPACITY;
      const r = await client.query(
        `UPDATE clinic_operating_hours SET max_concurrent_bookings = $1 WHERE is_open = true`,
        [capacity]
      );
      report.push({
        step: `${RESTORE_SLOTS ? 'REAL' : 'DEV'} slot capacity -> ${capacity}`,
        rows: r.rowCount
      });
    }

    console.table(report);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — rolled back. Re-run with --apply to perform the purge.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK due to error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
