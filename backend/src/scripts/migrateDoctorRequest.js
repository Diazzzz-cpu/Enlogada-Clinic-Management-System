/**
 * [1.106.0] A booking carries the doctor's signed request.
 *
 * A patient booking online typed the doctor's name, the PRC number and free-text clinical notes.
 * The clinic performs a test on a doctor's request, and the paper says all three in the doctor's
 * own hand, so the booking now uploads the paper instead — for every online booking, self-pay as
 * well as HMO. An HMO reads the same paper before it issues the LOA.
 *
 * Five columns on `patient_visits`:
 *
 *   doctor_request_file_path / _original_name / _mime_type / _size_bytes / _uploaded_at
 *
 * The file lives in uploads/doctor-requests. It is part of the visit's record, so pruneHmoCards.js
 * (insurance evidence, deleted after a year) never touches it.
 *
 * ── No CHECK constraint, deliberately ───────────────────────────────────────────────────────
 *
 * Every visit before today has no doctor's request, and a visit started at the desk is exempt:
 * the patient hands reception the paper. appointmentService enforces the rule for a patient's own
 * booking (referralService.assertDoctorRequestIfRequired), the way the HMO card's rule lives in
 * hmoService.
 *
 * ── A withdrawn draft ───────────────────────────────────────────────────────────────────────
 *
 * For an hour on 2026-10-12 this was drafted as six columns on `hmo_requests`
 * (migrateHmoDoctorRequest.js, never committed). A database that ran the draft has them; they are
 * dropped here when empty, and the script refuses rather than lose a file if any is not.
 *
 *   node src/scripts/migrateDoctorRequest.js
 *   node src/scripts/migrateDoctorRequest.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

const COLUMNS = [
  ['doctor_request_file_path', 'VARCHAR(255)'],
  ['doctor_request_original_name', 'TEXT'],
  ['doctor_request_mime_type', 'VARCHAR(100)'],
  ['doctor_request_size_bytes', 'INT'],
  ['doctor_request_uploaded_at', 'TIMESTAMP'],
];

const DRAFT_COLUMNS = [...COLUMNS.map(([name]) => name), 'doctor_request_purged_at'];

async function draftColumnsPresent() {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'hmo_requests' AND column_name = 'doctor_request_file_path'`
  );
  return rows.length > 0;
}

async function apply() {
  if (await draftColumnsPresent()) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM hmo_requests WHERE doctor_request_file_path IS NOT NULL'
    );
    if (rows[0].n > 0) {
      throw new Error(
        `${rows[0].n} HMO claim(s) hold a doctor's request under the withdrawn draft. ` +
        'Move each onto its visit by hand before running this; nothing was changed.'
      );
    }
  }

  await db.withTransaction(async () => {
    for (const [name, type] of COLUMNS) {
      await db.query(`ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
    for (const name of DRAFT_COLUMNS) {
      await db.query(`ALTER TABLE hmo_requests DROP COLUMN IF EXISTS ${name}`);
    }
  });

  console.log('\n  patient_visits.doctor_request_* columns are in place.');
  console.log('  Existing visits carry no doctor\'s request; only bookings made from now on are asked for one.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    for (const [name] of COLUMNS) {
      await db.query(`ALTER TABLE patient_visits DROP COLUMN IF EXISTS ${name}`);
    }
  });
  console.log('\n  Rolled back. Uploaded files stay in uploads/doctor-requests until removed by hand.\n');
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
