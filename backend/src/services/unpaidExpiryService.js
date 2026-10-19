const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');
const visitRepository = require('../repositories/visitRepository');
const auditService = require('./auditService');
const appointmentEmailService = require('./appointmentEmailService');

const ACTOR = 'System (unpaid, time up)';
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

const day = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

const WHY = {
  day_ended: (v) => `not paid by the end of ${day(v.created_at)}`,
  day_passed: (v) => `nobody came on ${day(v.scheduled_date)}, and it was not paid`,
  payment_window: () => 'not paid within its time to pay',
  hmo_undecided: () => 'its HMO had not approved it by the time it was booked for',
};

/**
 * Unpaid is temporary. [1.131.0]
 *
 * Steven: a booking is paid first, and a walk-in pays for its tests to go ahead; once paid there
 * are no takebacks. So nothing unpaid is ever "Cancelled" or a "No Show": when its time is up it is
 * removed (the rules are visitRepository.findExpiredUnpaid). The one record left is a line in the
 * Activity Log saying what was removed and why, and a patient whose booking is released is
 * emailed, since it simply disappears from their portal. Run every few minutes by
 * jobs/unpaidExpiryScheduler.js, so a lapsed time to pay frees its booking promptly.
 */
class UnpaidExpiryService {
  async removeExpired() {
    const { due, files } = await db.withTransaction(async () => {
      // Found inside the transaction that deletes, so what is removed is what was true at that
      // moment. A payment landing at the same instant blocks on the visit row and then fails the
      // delete, which rolls back and leaves it for the next sweep, by which time it is paid.
      const rows = await visitRepository.findExpiredUnpaid();
      const removed = await visitRepository.removeVisits(rows.map((r) => r.id));
      return { due: rows, files: removed.files };
    });
    if (!due.length) return { removed: 0, walkIns: 0, bookings: 0 };

    for (const f of files) {
      try { fs.unlinkSync(path.join(UPLOADS, f.dir, path.basename(f.p))); } catch { /* already gone */ }
    }

    for (const v of due) {
      const what = v.appointment_id
        ? `booking ${v.appointment_reference} for ${day(v.scheduled_date)}`
        : `walk-in visit${v.queue_number ? ` ticket ${v.queue_number}` : ''} of ${day(v.created_at)}`;
      const tests = (v.test_names || []).join(', ') || 'no tests';
      await auditService.log({
        actorName: ACTOR, action: 'visit.removed_unpaid', entityType: 'visit', entityId: v.id,
        description: `Removed the ${what} (${v.first_name} ${v.last_name}: ${tests}): ${WHY[v.why](v)}.`,
      });
      if (v.appointment_id && v.email) {
        appointmentEmailService.sendBookingReleased({
          to: v.email,
          patientName: `${v.first_name} ${v.last_name}`,
          reference: v.appointment_reference,
          date: v.scheduled_date,
          time: v.scheduled_time,
          why: v.why,
        }).catch((err) => logger.error(`Booking-released email failed for ${v.appointment_reference}: ${err.message}`));
      }
    }
    const bookings = due.filter((v) => v.appointment_id).length;
    return { removed: due.length, walkIns: due.length - bookings, bookings };
  }
}

module.exports = new UnpaidExpiryService();
