/**
 * Unpaid is temporary: nothing is "Cancelled" or a "No Show" any more. [1.131.0]
 *
 * Steven: a booking is paid first, and a walk-in pays for its tests to go ahead; once paid there
 * are no takebacks, and what is never paid is only temporary, so "Cancelled" goes, Visit History
 * included. From now on an unpaid walk-in or booking whose time is up is removed by
 * unpaidExpiryService. This does the same to what is already there:
 *
 *   - removes every visit that is Cancelled, or whose booking is Cancelled or a No Show, and that
 *     never had a receipt issued (a refunded receipt from before [1.121.0] is the books, and stays),
 *     with its tests, booking and anything else hung on it, one Activity Log line each;
 *   - drops patient_visits.closed_reason / closed_at, which [1.130.0] added to say why a visit was
 *     closed: a visit is now removed, not closed;
 *   - retires the appointments:cancel permission (setupRbac.js lists it as retired too).
 *
 *   node src/scripts/migrateUnpaidIsTemporary.js
 *   node src/scripts/migrateUnpaidIsTemporary.js --rollback   (puts the two columns back, empty;
 *                                                               removed visits are not restored)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');
const visitRepository = require('../repositories/visitRepository');
const auditService = require('../services/auditService');

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

async function main() {
  if (process.argv.includes('--rollback')) {
    await db.query('ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(200)');
    await db.query('ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP');
    logger.info('[1.131.0] rollback: closed_reason / closed_at are back (empty). Removed visits are not restored.');
    return;
  }

  const { due, files } = await db.withTransaction(async () => {
    const { rows } = await db.query(
      `SELECT pv.id, pv.status, pv.queue_number, pv.created_at, p.first_name, p.last_name,
              a.appointment_reference, a.status AS booking_status, a.scheduled_date
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
         LEFT JOIN appointments a ON a.patient_visit_id = pv.id
        WHERE (pv.status = 'Cancelled' OR a.status IN ('Cancelled', 'No Show'))
          AND NOT EXISTS (SELECT 1 FROM payments pay
                           WHERE pay.patient_visit_id = pv.id
                             AND (pay.payment_status IN ('Paid', 'Refunded') OR pay.receipt_number IS NOT NULL))
        ORDER BY pv.id`
    );
    const removed = await visitRepository.removeVisits(rows.map((r) => r.id));

    await db.query('ALTER TABLE patient_visits DROP COLUMN IF EXISTS closed_reason');
    await db.query('ALTER TABLE patient_visits DROP COLUMN IF EXISTS closed_at');

    for (const table of ['user_permissions', 'role_permissions']) {
      await db.query(
        `DELETE FROM ${table} USING permissions p WHERE ${table}.permission_id = p.id AND p.name = 'appointments:cancel'`
      );
    }
    await db.query(`DELETE FROM permissions WHERE name = 'appointments:cancel'`);
    return { due: rows, files: removed.files };
  });

  for (const f of files) {
    try { fs.unlinkSync(path.join(UPLOADS, f.dir, path.basename(f.p))); } catch { /* already gone */ }
  }
  for (const v of due) {
    const what = v.appointment_reference
      ? `booking ${v.appointment_reference} (${v.booking_status})`
      : `walk-in visit${v.queue_number ? ` ticket ${v.queue_number}` : ''}`;
    await auditService.log({
      actorName: 'System (migration 1.131.0)', action: 'visit.removed_unpaid', entityType: 'visit', entityId: v.id,
      description: `Removed the ${what} of ${v.first_name} ${v.last_name}: it was never paid, and unpaid is temporary.`,
    });
  }
  logger.info(`[1.131.0] removed ${due.length} never-paid cancelled or no-show visit(s); dropped closed_reason/closed_at; retired appointments:cancel.`);
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    logger.error(`[1.131.0] Failed: ${err.message}`);
    process.exitCode = 1;
    await db.pool.end().catch(() => {});
  });
