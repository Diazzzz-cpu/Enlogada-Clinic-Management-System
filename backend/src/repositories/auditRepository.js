const db = require('../config/database');

/**
 * Entries a migration wrote to keep data it was about to drop. [1.111.0]
 *
 * They are RECORDS, not activity: nobody did anything at the moment they were written, and one
 * removal can write dozens — [1.109.0] wrote one per typed result, burying a morning of refunds
 * and corrections under "Typed values of result #…". Hidden from the activity feed by default and
 * shown on request, never deleted: on the clinic's database they are the only remaining copy of
 * what the dropped tables held.
 */
const ARCHIVE_ACTIONS = ['result.measurements_archived', 'clinic.signatory_archived', 'result.critical_flag_retired'];

class AuditRepository {
  async create({ actorId, actorName, action, entityType, entityId, description }) {
    const queryText = `
      INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, description)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await db.query(queryText, [actorId || null, actorName, action, entityType, entityId || null, description]);
    return result.rows[0];
  }

  async findRecent({ limit, offset, includeArchives = false }) {
    // The same filter on the list and the count, so the pages add up to the total shown.
    const where = includeArchives ? '' : 'WHERE action <> ALL($1::text[])';
    const params = includeArchives ? [] : [ARCHIVE_ACTIONS];
    const listQuery = `
      SELECT * FROM audit_log
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countQuery = `SELECT COUNT(*) as count FROM audit_log ${where}`;
    const [listResult, countResult] = await Promise.all([
      db.query(listQuery, [...params, limit, offset]),
      db.query(countQuery, params)
    ]);
    return {
      entries: listResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  }
}

module.exports = new AuditRepository();
