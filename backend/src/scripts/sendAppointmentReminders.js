/**
 * Reminds patients about tomorrow's appointments. Schedule this daily. [1.25.0]
 *
 * `appointments.status` has carried 'No Show' since the beginning, which means the clinic was
 * already counting the problem and had nothing to do about it. A reminder the day before is the
 * standard tool, and the one that pays for itself: a no-show is a slot that earns nothing and
 * cannot be given to anybody else, because by the time you know, the day is gone.
 *
 * It also carries the preparation instructions, and that is the part worth the most. "Nothing to
 * eat or drink except water for 8 hours before your appointment" is actionable the evening
 * before; at the moment of booking, possibly three weeks earlier, it is forgotten by definition.
 * A patient who arrives having eaten is a wasted slot AND a wasted trip.
 *
 *   node src/scripts/sendAppointmentReminders.js              # tomorrow, dry run
 *   node src/scripts/sendAppointmentReminders.js --confirm    # actually send
 *   node src/scripts/sendAppointmentReminders.js --days=2 --confirm
 *
 * ── Safe to re-run, which is what makes it safe to schedule ───────────────────────────────────
 * Each appointment is stamped `reminder_sent_at` once it has been handled, and the query only
 * ever selects rows where that is NULL. Run it hourly and the second run finds nothing. A job
 * that cannot be run twice is one nobody dares automate, so it ends up run by hand — which is to
 * say not at all.
 *
 * The stamp is written even when there is no email address to send to. A walk-in registered at
 * the desk has no account; that is a permanent condition, not a transient failure, and leaving it
 * unstamped would make this job re-examine the same unreachable rows every night forever.
 *
 * ── Deliberately only 'Pending' ───────────────────────────────────────────────────────────────
 * A 'Confirmed' appointment is one the patient has already been checked in for, and Cancelled /
 * Completed / No Show are finished. Reminding any of them is worse than not reminding at all.
 *
 * Dates are handled in SQL rather than JavaScript, per the note in CLAUDE.md: CURRENT_DATE is the
 * server's local date, and building "tomorrow" from a JS Date would be the UTC day between
 * midnight and 08:00 in Philippine time — reminding the wrong day's patients, every morning.
 */
const db = require('../config/database');
const logger = require('../config/logger');
const appointmentEmailService = require('../services/appointmentEmailService');

function numericArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function main() {
  const daysAhead = numericArg('days', 1);
  const confirmed = process.argv.includes('--confirm');

  const { rows } = await db.query(
    `
    SELECT a.id, a.appointment_reference, a.scheduled_date, a.scheduled_time,
           pv.queue_number,
           p.first_name, p.last_name,
           u.email,
           COALESCE(
             ARRAY_AGG(
               JSON_BUILD_OBJECT('test_name', t.name, 'preparation', t.preparation)
               ORDER BY t.name
             ) FILTER (WHERE t.id IS NOT NULL),
             '{}'
           ) AS tests
    FROM appointments a
    JOIN patient_visits pv ON a.patient_visit_id = pv.id
    JOIN patients p ON pv.patient_id = p.id
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN visit_tests vt ON vt.patient_visit_id = pv.id
    LEFT JOIN tests t ON vt.test_id = t.id
    WHERE a.reminder_sent_at IS NULL
      AND a.status = 'Pending'
      -- Not a booking whose payment window ran out: its slot is gone. [1.123.0]
      AND (a.held_until IS NULL OR a.held_until > CURRENT_TIMESTAMP)
      AND a.scheduled_date = CURRENT_DATE + $1::int
    GROUP BY a.id, pv.queue_number, p.first_name, p.last_name, u.email
    ORDER BY a.scheduled_time
    `,
    [daysAhead]
  );

  const withEmail = rows.filter((r) => r.email);
  logger.info(
    `Reminders for ${daysAhead === 1 ? 'tomorrow' : `+${daysAhead} day(s)`}: ` +
    `${rows.length} appointment(s), ${withEmail.length} with an email address` +
    `${confirmed ? '' : ' (DRY RUN)'}`
  );

  if (rows.length === 0) {
    logger.info('Nothing to remind.');
    process.exit(0);
  }

  if (!confirmed) {
    for (const r of rows) {
      const prep = (r.tests || []).filter((t) => t.preparation).length;
      logger.info(
        `  ${String(r.scheduled_time).slice(0, 5)}  ${r.first_name} ${r.last_name}` +
        `  ${r.email || '(no email — would be stamped and skipped)'}` +
        `${prep ? `  [${prep} preparation note(s)]` : ''}`
      );
    }
    logger.info('DRY RUN — nothing sent, nothing stamped. Re-run with --confirm.');
    process.exit(0);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    try {
      const result = await appointmentEmailService.sendReminder({
        to: r.email,
        patientName: `${r.first_name} ${r.last_name}`,
        reference: r.appointment_reference,
        date: r.scheduled_date,
        time: r.scheduled_time,
        queueNumber: r.queue_number,
        tests: r.tests || [],
      });

      // Stamped whether it sent or was skipped for having nowhere to go — see the note above on
      // why an unreachable patient must not be re-examined every night. NOT stamped when the
      // send itself errored, so a transient SMTP failure is retried on the next run.
      if (result?.error) {
        failed += 1;
        logger.warn(`  ${r.appointment_reference}: send failed, will retry — ${result.error}`);
        continue;
      }

      await db.query('UPDATE appointments SET reminder_sent_at = NOW() WHERE id = $1', [r.id]);
      if (result?.skipped) skipped += 1;
      else sent += 1;
    } catch (err) {
      // One bad row must not stop the rest of the night's reminders.
      failed += 1;
      logger.error(`  ${r.appointment_reference}: ${err.message}`);
    }
  }

  logger.info(`Done. ${sent} sent, ${skipped} skipped (no address or no SMTP), ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error(`Reminder run failed: ${err.message}`);
  process.exit(1);
});
