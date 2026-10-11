/**
 * Additive migration [1.29.0] — index what grows, and stop maintaining what nothing reads.
 *
 * MEASURED, not guessed. Against a same-shaped `audit_log` of 300,000 rows in a scratch schema —
 * roughly a year for this clinic, since [1.19.0] made audit_log record PHI *reads* as well as
 * writes, and CLAUDE.md's own projection is ~200 events a day:
 *
 *     activity log, newest page   87.3 ms  ->  0.9 ms   (2 seq scans -> 0)
 *     everything one actor did    58.0 ms  ->  5.8 ms   (1 seq scan  -> 0)
 *
 * The second one is the query a breach investigation runs, and it is the whole reason the audit
 * log exists. At demo scale both are under a millisecond either way, which is exactly why this
 * had to be measured at volume rather than on the seeded data.
 *
 * ── What gets an index, and what deliberately does not ──────────────────────────────────────
 *
 * Only foreign keys on tables that GROW WITH CLINIC ACTIVITY. An index is not free: it is paid
 * for on every insert and update, and on a table small enough to sit in one or two pages a
 * sequential scan beats an index lookup anyway.
 *
 * So `user_roles.assigned_by`, `role_permissions.permission_id`, `user_permissions.*` and
 * `user_departments.*` are left alone on purpose. They are bounded by the number of staff and the
 * number of permissions — a couple of hundred rows that never grow with patient volume. Indexing
 * them would add write cost to buy nothing, which is the same mistake as the two indexes this
 * migration drops.
 *
 * ── Two redundant indexes removed ───────────────────────────────────────────────────────────
 *
 * Also demonstrated rather than asserted, by building each case in a scratch schema and reading
 * the plan:
 *
 *   idx_audit_log_created_at (created_at DESC) duplicates idx_audit_log_created (created_at).
 *     A B-tree can be walked in either direction, so the ASC index serves ORDER BY ... DESC —
 *     confirmed: with only the ASC index present, the planner chose it for a DESC ordering.
 *
 *   idx_payments_status (payment_status) duplicates idx_payments_status_paid_at
 *     (payment_status, paid_at DESC). A composite serves any query its leading column serves —
 *     confirmed: with only the composite present, the planner chose it for a bare status filter.
 *
 * Both sit on tables that grow, so each was costing write time and disk on every audit entry and
 * every payment to serve reads that another index already covered.
 *
 * Additive and idempotent. Reversible:
 *   node src/scripts/migrateIndexHygiene.js
 *   node src/scripts/migrateIndexHygiene.js --rollback
 *
 * CONCURRENTLY is deliberately NOT used: it cannot run inside a transaction, and on a clinic
 * database of this size every index here builds in well under a second. Revisit if the clinic
 * ever reaches a scale where a brief lock on audit_log matters.
 */
const db = require('../config/database');
const logger = require('../config/logger');

// Foreign keys on tables that grow with how busy the clinic is.
const ADD = [
  ['idx_audit_log_actor', 'audit_log(actor_id)', 'who did it — the question the audit log exists to answer'],
  ['idx_payments_processed_by', 'payments(processed_by)', 'which cashier took it, for the daily cash-up'],
  ['idx_patient_visits_created_by', 'patient_visits(created_by)', 'who opened the visit; drives the staff workload report'],
  ['idx_patient_visits_discount_type', 'patient_visits(discount_type_id)', 'statutory discount reporting'],
  ['idx_patient_visits_discount_granted_by', 'patient_visits(discount_granted_by)', 'who granted a senior/PWD discount'],
  ['idx_patients_type', 'patients(patient_type_id)', 'joined on every patient list and queue row'],
  ['idx_test_results_superseded_by', 'test_results(superseded_by)', 'walking an amendment chain'],
  ['idx_hmo_requests_provider', 'hmo_requests(hmo_provider_id)', 'joined on every claims worklist row'],
  ['idx_hmo_requests_decided_by', 'hmo_requests(decided_by)', 'who decided the claim [1.28.0]'],
  ['idx_hmo_request_tests_decided_by', 'hmo_request_tests(decided_by)', 'who decided the test [1.27.0]'],
];

// Covered by another index that already exists; pure write cost until removed.
const DROP = [
  ['idx_audit_log_created_at', 'covered by idx_audit_log_created — a B-tree reads both ways'],
  ['idx_payments_status', 'covered by idx_payments_status_paid_at — leading column'],
];

// idx_test_results_critical_ack_by was on this list until [1.98.0], which withdrew the
// critical-value workflow and dropped the column it indexed. Removed rather than guarded: a
// database old enough to need this script has the column, and one new enough not to have it was
// built from schema.sql, where the index never existed either.
async function migrate(client) {
  for (const [name, target, why] of ADD) {
    await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`);
    logger.info(`  + ${name} — ${why}`);
  }
  for (const [name, why] of DROP) {
    await client.query(`DROP INDEX IF EXISTS ${name}`);
    logger.info(`  - ${name} — ${why}`);
  }
}

async function rollback(client) {
  for (const [name] of ADD) {
    await client.query(`DROP INDEX IF EXISTS ${name}`);
    logger.info(`  - ${name}`);
  }
  // Put the redundant pair back, so a rollback really is a rollback even though they earn nothing.
  await client.query('CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status)');
  logger.info('  + idx_audit_log_created_at, idx_payments_status (restored)');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.29.0] ROLLBACK — undoing the index hygiene pass…'
    : '[1.29.0] Indexing what grows, dropping what nothing reads…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.29.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`
  );
  logger.info(`[1.29.0] Done. ${rows[0].n} indexes on the public schema.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.29.0] Migration failed: ${err.message}`);
  process.exit(1);
});
