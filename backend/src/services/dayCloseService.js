const db = require('../config/database');
const visitRepository = require('../repositories/visitRepository');
const auditService = require('./auditService');

const ACTOR = 'System (end of day)';

/**
 * Closes what an earlier day left open with nothing able to move it. [1.130.0]
 *
 * Steven: "check if everything that all processes MAKE SENSE". They did not, here. A walk-in nobody
 * paid for stayed 'Pending' for good: today's queue is today's, and so is the till's, so nothing
 * could ever pay for it or serve it, while Visit History read it as waiting. A booking nobody came
 * for stayed 'Pending' too, and was never a no-show unless someone remembered to mark it. Run after
 * each day ends by jobs/dayCloseScheduler.js; the rules are in visitRepository.closeEarlierDays.
 * One audit entry per visit or booking closed, so each can be traced.
 */
class DayCloseService {
  async closeEarlierDays() {
    const closed = await db.withTransaction(() => visitRepository.closeEarlierDays());

    for (const v of closed.walkIns) {
      await auditService.log({
        actorName: ACTOR, action: 'visit.closed_unpaid', entityType: 'visit', entityId: v.id,
        description: `Closed visit ${v.queue_number ? `ticket ${v.queue_number}` : `#${v.id}`}: ${v.closed_reason}.`,
      });
    }
    for (const a of closed.noShows) {
      await auditService.log({
        actorName: ACTOR, action: 'appointment.no_show_auto', entityType: 'appointment', entityId: a.id,
        description: `Marked booking ${a.appointment_reference} a no-show: nobody checked in on its day, and it was not paid.`,
      });
    }
    return {
      unpaidWalkIns: closed.walkIns.length,
      noShows: closed.noShows.length,
      visitsClosed: closed.walkIns.length + closed.noShowVisits.length,
    };
  }
}

module.exports = new DayCloseService();
