/**
 * Appointment reminders, by hand. [1.25.0] [1.130.0]
 *
 * The server sends them by itself now (jobs/reminderScheduler.js), so nothing needs scheduling.
 * This shows the plan, and can run one sweep by hand:
 *
 *   node src/scripts/sendAppointmentReminders.js              # each booking owed a reminder, and when
 *   node src/scripts/sendAppointmentReminders.js --days=7     # look further ahead (default 7)
 *   node src/scripts/sendAppointmentReminders.js --json       # the same, as JSON
 *   node src/scripts/sendAppointmentReminders.js --confirm    # send what is due right now
 *
 * When each is due is `utils/reminderTiming.js`: the evening before at 18:00, or halfway to a
 * booking made later than that, never 21:00-07:00. Safe to run beside the server: each reminder
 * is claimed before it is sent, so it still goes out once.
 */
const logger = require('../config/logger');
const db = require('../config/database');
const reminderService = require('../services/reminderService');

function numericArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const stamp = (d) => {
  if (!d) return '-';
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
};

async function main() {
  const now = new Date();

  if (process.argv.includes('--confirm')) {
    const counts = await reminderService.sweep(now);
    if (counts.notConfigured) {
      logger.warn(`Outbound mail is not configured (${counts.notConfigured.join(', ')}); nothing sent.`);
      return 1;
    }
    logger.info(
      `Done. ${counts.sent} sent, ${counts.noAddress} with no address, ` +
      `${counts.missed} too late to send, ${counts.failed} failed.`
    );
    return counts.failed > 0 ? 1 : 0;
  }

  const plan = await reminderService.plan({ now, days: numericArg('days', 7) });
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(plan.map((r) => ({
      id: r.id,
      reference: r.appointment_reference,
      startsAt: stamp(r.starts_at),
      bookedAt: stamp(r.booked_at),
      dueAt: stamp(r.decision.due.at),
      kind: r.decision.due.kind,
      action: r.decision.action,
      hasAddress: Boolean(r.email),
    })))}\n`);
    return 0;
  }

  logger.info(`${plan.length} booking(s) owed a reminder. Nothing is sent without --confirm.`);
  for (const r of plan) {
    const { action, due, reason } = r.decision;
    logger.info(
      `  ${stamp(r.starts_at)}  ${r.appointment_reference}  ${r.first_name} ${r.last_name}` +
      `  due ${stamp(due.at)} (${due.kind})  now: ${action}${reason ? ` (${reason})` : ''}` +
      `${r.email ? '' : '  [no email address]'}`
    );
  }
  return 0;
}

main()
  .then((code) => db.pool.end().then(() => process.exit(code)))
  .catch((err) => {
    logger.error(`Reminder run failed: ${err.message}`);
    process.exit(1);
  });
