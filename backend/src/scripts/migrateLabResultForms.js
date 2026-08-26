/**
 * Additive migration [1.52.0] — sections, and who signs a report.
 *
 * [1.50.0] built structured entry for Ultrasound, where a study is a flat list of organs. A
 * laboratory form is not flat: the clinic's Urinalysis prints `Macroscopic:`, `Chemical:` and
 * `Microscopic:` as heading rows with their analytes indented beneath, and a CBC groups five of its
 * fourteen rows under `Differential Count`. Without a section the printed form is a flat list of
 * thirteen items, which is not the document the clinic issues.
 *
 * ── Why a column and not an ordering convention ──────────────────────────────────────────────
 *
 * "A section owns everything until the next section" is the obvious rule and it is wrong on the
 * clinic's own CBC: `RDW-CV` prints two rows below `Basophils`, after the `Differential Count`
 * block, and is not a differential parameter. A convention would silently file it under the wrong
 * heading on every CBC the clinic ever issues. An explicit nullable column cannot.
 *
 * ── Why signatories are a table ──────────────────────────────────────────────────────────────
 *
 * A laboratory report carries TWO named signatories with PRC licence numbers — a Medical
 * Technologist and a Pathologist. An ultrasound report carries one radiologist and, in 1,113
 * archived reports, no licence number anywhere. So the block differs by category, which rules out
 * putting it on `users`: the pathologist is an external consultant who signs the report and has no
 * account, and `users` has no credential column by design.
 *
 * It is also not env config like the TIN. `lib/clinic.js` leaves the TIN blank because nobody had
 * supplied one; here the clinic's own forms supply both names and both licence numbers on 36 of 38
 * sheets, and a table lets them be corrected from a screen later rather than by editing `.env` and
 * restarting. Seeded, never invented — same rule as the price list.
 *
 * Reverse with:
 *   node src/scripts/migrateLabResultForms.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  // Nullable: most fields belong to no section, and every Ultrasound field set has none at all.
  await client.query(`ALTER TABLE result_fields ADD COLUMN IF NOT EXISTS section VARCHAR(60)`);
  logger.info('  + result_fields.section');

  // The discipline heading a form prints above its panel title — CLINICAL MICROSCOPY, HEMATOLOGY,
  // CLINICAL CHEMISTRY, SEROLOGY/IMMUNOLOGY. A property of the form, so it sits on the set.
  await client.query(`ALTER TABLE result_field_sets ADD COLUMN IF NOT EXISTS discipline VARCHAR(60)`);
  logger.info('  + result_field_sets.discipline');

  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_signatories (
      id            SERIAL PRIMARY KEY,
      -- Which reports this person signs. NULL means every category, which is how a clinic with one
      -- signatory for everything would configure it.
      category_id   INT,
      full_name     VARCHAR(120) NOT NULL,
      -- 'Medical Technologist', 'Pathologist', 'RADIOLOGIST/SONOLOGIST'. Printed verbatim beneath
      -- the name, exactly as the clinic's own forms do.
      role_caption  VARCHAR(80)  NOT NULL,
      -- Deliberately nullable, and deliberately NOT defaulted. The laboratory forms carry one for
      -- both signatories; the ultrasound corpus carries none for the radiologist. A blank prints
      -- nothing rather than a plausible-looking number, for the same reason lib/clinic.js refuses
      -- to invent a TIN: a patient may file this document for reimbursement.
      prc_license   VARCHAR(40),
      -- Left column first. The clinic prints the examiner left, the pathologist right.
      display_order SMALLINT     NOT NULL DEFAULT 1,
      is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_signatories_category FOREIGN KEY (category_id) REFERENCES test_categories(id),
      -- One person signs one role per category. Re-running the seed must not duplicate them.
      CONSTRAINT uq_signatory UNIQUE (category_id, full_name, role_caption)
    )
  `);
  logger.info('  + clinic_signatories');

  await client.query(`CREATE INDEX IF NOT EXISTS idx_signatories_category ON clinic_signatories (category_id)`);
  logger.info('  + indexes');
}

async function rollback(client) {
  const { rows } = await client
    .query(`SELECT COUNT(*)::int AS n FROM result_fields WHERE section IS NOT NULL`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} field(s) will lose their section heading`);
    logger.warn('    (the fields and their recorded values survive — only the grouping is dropped,');
    logger.warn('     so a Urinalysis would print as one flat list rather than three sections)');
  }

  await client.query('DROP TABLE IF EXISTS clinic_signatories');
  logger.info('  - clinic_signatories');
  await client.query('ALTER TABLE result_field_sets DROP COLUMN IF EXISTS discipline');
  logger.info('  - result_field_sets.discipline');
  await client.query('ALTER TABLE result_fields DROP COLUMN IF EXISTS section');
  logger.info('  - result_fields.section');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.52.0] ${reversing ? 'Rolling back' : 'Applying'} laboratory result forms…`);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.52.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();
  logger.info('[1.52.0] Done. Run seedResultFieldSets.js to load the laboratory forms.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.52.0] Migration failed: ${err.message}`);
  process.exit(1);
});
