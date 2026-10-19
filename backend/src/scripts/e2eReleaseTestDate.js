/**
 * Releases the test bookings that a stopped suite run left behind on a fixed test date. [1.72.0]
 *
 * booking-atomicity.spec.js books the SEEDED client on one far-off date. A run that finishes has
 * its bookings removed by the E2E purge, but a run stopped part-way never reaches its teardown, and
 * whatever it booked stays. The date has eighteen slots and the spec claims about eight per run, so
 * a stopped run or two later it cannot find a free one: "no slot left on 2026-11-18 that this run
 * has not used and this patient does not already hold". Measured on 2026-09-12: eleven leftovers,
 * six from a run on 2026-09-05 and five from one stopped that evening.
 *
 * Shelled out to from the frontend suite like e2eExpireHold.js, and for the reason
 * globalTeardown.js gives: the credentials and the `pg` client live here.
 *
 * Removed, the way an unpaid booking whose time is up is removed (visitRepository.removeVisits):
 * nothing is cancelled any more [1.131.0], and there is no cancel route. No email and no Activity
 * Log line, as these were only ever the suite's own fixtures.
 *
 * Guards, each independent, and each about what the script is allowed to touch:
 *
 *   - NODE_ENV must not be 'production'
 *   - the date must be in the FUTURE — a booking for today or earlier is a real visit
 *   - only bookings owned by the seeded test client or an @enlogada-e2e.test account
 *   - only a Pending booking whose visit has no payment of any kind, no result and no HMO claim
 *
 * Dry run unless --confirm, so it is also the one-command fix for that failure by hand:
 *
 *   node src/scripts/e2eReleaseTestDate.js --date=2026-11-18            list what would be released
 *   node src/scripts/e2eReleaseTestDate.js --date=2026-11-18 --confirm  release them
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const visitRepository = require('../repositories/visitRepository');

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

// The seeded account the booking specs sign in as (see TEST_ACCOUNTS.md). Throwaway accounts are
// matched by their reserved domain.
const TEST_ACCOUNTS = ['client@enlogada.com'];
const E2E_DOMAIN = '%@enlogada-e2e.test';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('release refused: NODE_ENV=production');
    process.exit(1);
  }

  const date = arg('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    console.error('release refused: --date=YYYY-MM-DD is required');
    process.exit(1);
  }

  const { rows: [check] } = await db.query('SELECT $1::date > CURRENT_DATE AS future', [date]);
  if (!check.future) {
    console.error(`release refused: ${date} is not in the future, so its bookings may be real visits`);
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT a.id, a.patient_visit_id, to_char(a.scheduled_time, 'HH24:MI') AS time, u.email
       FROM appointments a
       JOIN patient_visits pv ON pv.id = a.patient_visit_id
       JOIN patients p ON p.id = pv.patient_id
       JOIN users u ON u.id = p.user_id
      WHERE a.scheduled_date = $1::date
        AND a.status = 'Pending'
        AND (u.email = ANY($2::text[]) OR u.email LIKE $3)
        AND NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.patient_visit_id = pv.id)
        -- A claim is filed against a visit's TESTS (hmo_request_tests), not against the visit.
        AND NOT EXISTS (
              SELECT 1 FROM hmo_request_tests hrt
                JOIN visit_tests vt ON vt.id = hrt.visit_test_id
               WHERE vt.patient_visit_id = pv.id)
        AND NOT EXISTS (
              SELECT 1 FROM visit_tests vt
                JOIN test_results tr ON tr.visit_test_id = vt.id
               WHERE vt.patient_visit_id = pv.id)
      ORDER BY a.scheduled_time`,
    [date, TEST_ACCOUNTS, E2E_DOMAIN]
  );

  const list = rows.map((r) => `${r.time} (${r.email}, appointment ${r.id})`).join(', ');
  if (!process.argv.includes('--confirm')) {
    console.log(`DRY RUN — ${rows.length} leftover booking(s) on ${date} would be released${rows.length ? `: ${list}` : ''}`);
    process.exit(0);
  }
  if (rows.length === 0) {
    console.log(`nothing to release on ${date}`);
    process.exit(0);
  }

  // The booking and its visit together, child to parent, then the uploads they pointed at.
  const { files } = await db.withTransaction(() => visitRepository.removeVisits(rows.map((r) => r.patient_visit_id)));
  for (const f of files) {
    try { fs.unlinkSync(path.join(UPLOADS, f.dir, path.basename(f.p))); } catch { /* already gone */ }
  }

  console.log(`released ${rows.length} leftover booking(s) on ${date}: ${list}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`release-test-date failed: ${err.message}`);
  process.exit(1);
});
