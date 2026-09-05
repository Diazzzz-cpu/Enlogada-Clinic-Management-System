/**
 * The two footers the clinic's own forms actually use. [1.64.0]
 *
 * `ResultReport` printed ONE disclaimer for every laboratory result:
 *
 *     NOTE: DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL
 *
 * The clinic's workbook (RESULT FORM FLORENCE MEA D. ENLOGADA.xlsx, ~30 sheets, one per form) uses
 * two, chosen per form. OGTT 50, OGTT 100, CT BT and Hct Hgb instead carry:
 *
 *     ** THIS IS AN ELECTRONICALLY SIGNED REPORT. NO SIGNATURE IS REQUIRED.**
 *
 * Those two sentences say opposite things about whether a signature is needed, so printing the
 * wrong one is not a cosmetic slip: it tells the patient to go and get a seal that the clinic never
 * intended to apply, or the reverse.
 *
 * The technologist's caption moves with it. The same person signs every report, but the workbook
 * captions her "Medical Technologist" on the chemistry and CBC forms and "Examiner" on Blood Type,
 * HBsAg, BUA, the OGTTs and CT BT. `clinic_signatories` holds one caption per CATEGORY, which
 * cannot express that — so the override lives on the FORM, and NULL means "use the signatory's own".
 *
 * Both columns are per-form facts. They belong to result_field_sets and nowhere else.
 *
 * Additive and idempotent. `--rollback` drops both columns.
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

const MODES = ['seal', 'electronic'];

async function apply(client) {
  await client.query(`
    ALTER TABLE result_field_sets
      ADD COLUMN IF NOT EXISTS signature_mode VARCHAR(12) NOT NULL DEFAULT 'seal'
  `);
  // The seal note is the overwhelming majority, so it is the default and existing rows are already
  // correct without a backfill.
  await client.query('ALTER TABLE result_field_sets DROP CONSTRAINT IF EXISTS chk_field_sets_signature_mode');
  await client.query(`
    ALTER TABLE result_field_sets
      ADD CONSTRAINT chk_field_sets_signature_mode CHECK (signature_mode IN (${MODES.map((m) => `'${m}'`).join(', ')}))
  `);
  await client.query(`
    ALTER TABLE result_field_sets
      ADD COLUMN IF NOT EXISTS technologist_caption VARCHAR(40)
  `);
  logger.info('  + result_field_sets.signature_mode (default seal, CHECK seal|electronic)');
  logger.info('  + result_field_sets.technologist_caption (NULL = use the signatory\'s own)');
}

async function rollback(client) {
  await client.query('ALTER TABLE result_field_sets DROP CONSTRAINT IF EXISTS chk_field_sets_signature_mode');
  await client.query('ALTER TABLE result_field_sets DROP COLUMN IF EXISTS signature_mode');
  await client.query('ALTER TABLE result_field_sets DROP COLUMN IF EXISTS technologist_caption');
  logger.info('  - signature_mode, technologist_caption');
}

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    logger.info(`[1.64.0] ${reversing ? 'Reversing' : 'Applying'} per-form signature footer…`);
    await client.query('BEGIN');
    if (reversing) await rollback(client); else await apply(client);
    await client.query('COMMIT');

    if (!reversing) {
      const { rows } = await client.query(
        "SELECT COUNT(*) FILTER (WHERE signature_mode = 'electronic')::int AS electronic, COUNT(*)::int AS total FROM result_field_sets"
      );
      logger.info(`[1.64.0] Done. ${rows[0].total} form(s); ${rows[0].electronic} electronically signed.`);
      logger.info('  Run seedResultFieldSets.js --confirm to set the per-form values.');
    } else {
      logger.info('[1.64.0] Reversed.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.64.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
