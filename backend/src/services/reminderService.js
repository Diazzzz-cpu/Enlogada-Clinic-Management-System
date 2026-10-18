const appointmentRepository = require('../repositories/appointmentRepository');
const appointmentEmailService = require('./appointmentEmailService');
const { decide } = require('../utils/reminderTiming');
const { missingMailConfig } = require('../config/email');
const logger = require('../config/logger');

/** After a failed send, the same reminder is not tried again for this long. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Appointment reminders, sent by the server on its own. [1.130.0]
 *
 * They were a script someone had to schedule every evening ([1.25.0]), so in practice they went
 * out when somebody remembered. The server now sweeps every minute (jobs/reminderScheduler.js),
 * and `utils/reminderTiming.js` decides when each one is due: the evening before, or halfway to
 * a booking made later than that, never at night.
 *
 * Each reminder is CLAIMED before it is sent (`claimReminder`), so two servers on one database
 * never send it twice, and a failed send gives the claim back to be tried again later. A
 * reminder with no address to go to, or one too late to help, is stamped as handled: those are
 * permanent, and re-examining them every minute would change nothing.
 */
class ReminderService {
  constructor() {
    this.failedUntil = new Map();
  }

  /** Every booking still owed a reminder, with what a sweep at `now` would do. Reads only. */
  async plan({ now = new Date(), days = 2 } = {}) {
    const rows = await appointmentRepository.findReminderCandidates(days);
    return rows.map((r) => ({
      ...r,
      decision: decide({ startsAt: r.starts_at, bookedAt: r.booked_at, now }),
    }));
  }

  /** One sweep: sends what is due now. Does nothing while outbound mail is not configured. */
  async sweep(now = new Date()) {
    const counts = { sent: 0, noAddress: 0, missed: 0, failed: 0 };
    const missing = missingMailConfig();
    if (missing.length > 0) return { ...counts, notConfigured: missing };

    for (const r of await this.plan({ now })) {
      const { action } = r.decision;
      if (action === 'wait') continue;
      if ((this.failedUntil.get(r.id) || 0) > now.getTime()) continue;
      if (!(await appointmentRepository.claimReminder(r.id))) continue;

      if (action === 'skip') {
        counts.missed += 1;
        continue;
      }

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
        if (result?.error) throw new Error(result.error);
        if (result?.skipped) counts.noAddress += 1;
        else counts.sent += 1;
        this.failedUntil.delete(r.id);
      } catch (err) {
        await appointmentRepository.releaseReminderClaim(r.id);
        this.failedUntil.set(r.id, now.getTime() + RETRY_AFTER_MS);
        counts.failed += 1;
        logger.warn(`Reminder for ${r.appointment_reference} failed; will try again: ${err.message}`);
      }
    }
    return counts;
  }
}

module.exports = new ReminderService();
