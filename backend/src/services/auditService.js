const auditRepository = require('../repositories/auditRepository');
const userRepository = require('../repositories/userRepository');
const logger = require('../config/logger');

// Feature Gap Plan Phase D: a shared logging hook for the sensitive actions this session's
// other phases introduced (payment refund/cancel, staff password reset/status toggle, HMO
// provider changes, result corrections). Called fire-and-forget from each service after its
// own write succeeds — an audit-log failure must never roll back or fail the real operation,
// so this only ever logs and swallows, never throws.
class AuditService {
  // req.user (the JWT payload) only carries {userId, roles, permissions} — no name — so this
  // resolves the actor's display name itself rather than making every call site look it up.
  async log({ actorId, action, entityType, entityId, description }) {
    try {
      let actorName = 'Unknown';
      if (actorId) {
        const actor = await userRepository.findById(actorId);
        if (actor) actorName = `${actor.first_name} ${actor.last_name}`;
      }
      await auditRepository.create({ actorId, actorName, action, entityType, entityId, description });
    } catch (err) {
      logger.error('Failed to write audit log entry:', err);
    }
  }

  /**
   * Records that someone READ a patient's records.
   *
   * Every other call site in this service logs a write. Nothing recorded reads, so after the
   * mass-read hole that let any staff token walk the patient roster, the only trace would have
   * been a morgan line on stdout — which is not retained anywhere. A breach notification has to
   * name who accessed what, and that answer has to already exist when the question is asked.
   *
   * Scoped narrowly on purpose. This logs reads of an *identified patient's* records only: their
   * demographics, their result history, a specific result file. It deliberately does NOT log
   * worklists, queues or search results, which staff refresh constantly — that is the same
   * fan-out shape that took notification_reads to a quarter of a million rows, and it would bury
   * the entries that matter in noise. Reading a worklist is doing your job; opening one named
   * patient's file is the access an investigation actually asks about.
   *
   * Fire-and-forget like log() — a failure to record an access must not deny a clinician the
   * record they need to treat someone.
   */
  async logPhiRead({ actorId, patientId, resource, description }) {
    return this.log({
      actorId,
      action: `phi.read.${resource}`,
      entityType: 'patient',
      // Keyed on the patient rather than the row read, because "who has accessed this patient's
      // data?" is the only question this table will ever be asked during an incident. See the
      // idx_audit_log_entity_created index added in [1.19.0].
      entityId: patientId,
      description,
    });
  }

  async getRecentActivity({ page = 1, limit = 25, includeArchives = false }) {
    const offset = (page - 1) * limit;
    const { entries, total } = await auditRepository.findRecent({ limit, offset, includeArchives });
    return { entries, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }
}

module.exports = new AuditService();
