/**
 * Take the typed result forms out of the database. [1.109.0]
 *
 * Since [1.94.0] a result IS its attached report file: the clinic already produces a document for
 * every diagnosis, and asking a technologist to type it in again was work done twice. The forms
 * that typing filled in stayed behind — five tables nothing in the product writes to any more:
 *
 *   result_field_sets       the form for a test (CBC, Urinalysis, Whole Abdomen…)
 *   result_fields           each line on a form, with its unit and printed range
 *   result_field_set_tests  which test used which form
 *   result_measurements     the values typed into them
 *   clinic_signatories      the names printed under a typed report
 *
 * ── It refuses before it would leave a report with nothing in it ────────────────────────────
 *
 * A current result with typed values and NO file shows those values and nothing else. Dropping
 * them would leave the patient's copy blank. So the script counts those first and stops, naming
 * them, unless `--force` is given — the same safeguard migrateRemove2dEcho.js applies, because a
 * developer database and the clinic's live one are not the same database, and the count that makes
 * this safe is only true of the one it was taken on.
 *
 * ── Nothing is lost, it is moved ──────────────────────────────────────────────────────────────
 *
 * Every result's typed values are written to audit_log as one entry per result
 * (`result.measurements_archived`), and every signatory as one entry each
 * (`clinic.signatory_archived`) — the clinic's own people, which nothing else holds. audit_log is
 * where this app keeps whatever must outlive the row it describes, as [1.98.0] did with the
 * critical flags.
 *
 * `--rollback` re-creates the five tables and puts the signatories back from audit_log. The forms
 * and the values are NOT restored: the forms came from seedResultFieldSets.js, which this release
 * removes, and the values stay readable in audit_log.
 *
 *   node src/scripts/migrateRemoveResultForms.js
 *   node src/scripts/migrateRemoveResultForms.js --force      # drop even if a file-less result has values
 *   node src/scripts/migrateRemoveResultForms.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

const ACTOR = 'System (migration 1.109.0)';
const TABLES = ['result_measurements', 'result_field_set_tests', 'result_fields', 'result_field_sets', 'clinic_signatories'];

async function tableExists(client, name) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${name}`]);
  return rows[0].present;
}

/** One measurement as the clinic writes it: "Hemoglobin = 14.8 g/dL (13.5-17.5)". */
function line(m) {
  const value = m.value_text
    || (m.value_date ? m.value_date.toISOString().slice(0, 10) : null)
    || [m.value_1, m.value_2, m.value_3].filter((v) => v !== null).map(Number).join(' x ');
  return `${m.group_label ? `${m.group_label} ` : ''}${m.label} = ${value}${m.unit ? ` ${m.unit}` : ''}`
    + (m.reference_note ? ` (${m.reference_note})` : '');
}

async function apply(client, force) {
  if (!(await tableExists(client, 'result_measurements')) && !(await tableExists(client, 'clinic_signatories'))) {
    logger.info('  = the result-form tables are already gone; nothing to do');
    return;
  }

  // The safeguard. Current results whose only content is typed values.
  const { rows: bare } = await client.query(`
    SELECT tr.id, tr.visit_test_id, t.name AS test_name,
           p.first_name || ' ' || p.last_name AS patient_name
      FROM test_results tr
      JOIN visit_tests vt ON vt.id = tr.visit_test_id
      JOIN tests t        ON t.id = vt.test_id
      JOIN patient_visits pv ON pv.id = vt.patient_visit_id
      JOIN patients p     ON p.id = pv.patient_id
     WHERE tr.is_current AND tr.file_path IS NULL
       AND EXISTS (SELECT 1 FROM result_measurements m WHERE m.test_result_id = tr.id)
     ORDER BY tr.id
  `);
  if (bare.length && !force) {
    for (const r of bare.slice(0, 20)) {
      logger.warn(`  ! result #${r.id}: ${r.test_name} for ${r.patient_name} has typed values and no report file`);
    }
    if (bare.length > 20) logger.warn(`  ! …and ${bare.length - 20} more`);
    throw new Error(
      `${bare.length} current result(s) have typed values and no report file, and would show nothing ` +
      'once these tables are dropped. Attach their reports first, or re-run with --force (the values ' +
      'are copied into audit_log either way).'
    );
  }

  // The values, one audit entry per result.
  const { rows: measurements } = await client.query(`
    SELECT m.test_result_id, m.group_index, m.value_1, m.value_2, m.value_3, m.value_text, m.value_date,
           f.label, f.unit, f.reference_note, f.display_order,
           CASE WHEN fs.repeat_label IS NOT NULL THEN fs.repeat_label || ' ' || m.group_index END AS group_label,
           fs.name AS form_name, tr.visit_test_id, tr.version
      FROM result_measurements m
      JOIN result_fields f      ON f.id = m.field_id
      JOIN result_field_sets fs ON fs.id = f.field_set_id
      JOIN test_results tr      ON tr.id = m.test_result_id
     ORDER BY m.test_result_id, m.group_index, f.display_order
  `);
  const byResult = new Map();
  for (const m of measurements) {
    if (!byResult.has(m.test_result_id)) byResult.set(m.test_result_id, []);
    byResult.get(m.test_result_id).push(m);
  }
  for (const [resultId, rows] of byResult) {
    const first = rows[0];
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, description)
       VALUES (NULL, $1, 'result.measurements_archived', 'test_result', $2, $3)`,
      [
        ACTOR,
        resultId,
        `Typed values of result #${resultId} (visit test #${first.visit_test_id}, version ${first.version}, ` +
          `form "${first.form_name}"), archived when the result forms were removed in [1.109.0]: ` +
          rows.map(line).join('; '),
      ]
    );
  }
  logger.info(`  ~ typed values of ${byResult.size} result(s) (${measurements.length} value(s)) written to audit_log`);

  // The signatories: the clinic's own people.
  if (await tableExists(client, 'clinic_signatories')) {
    const { rows: signatories } = await client.query(`
      SELECT s.*, tc.name AS category_name
        FROM clinic_signatories s
        LEFT JOIN test_categories tc ON tc.id = s.category_id
       ORDER BY s.id
    `);
    for (const s of signatories) {
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, description)
         VALUES (NULL, $1, 'clinic.signatory_archived', 'clinic_signatory', $2, $3)`,
        [ACTOR, s.id, JSON.stringify({
          category: s.category_name, full_name: s.full_name, role_caption: s.role_caption,
          prc_license: s.prc_license, display_order: s.display_order, is_active: s.is_active,
        })]
      );
    }
    logger.info(`  ~ ${signatories.length} signator${signatories.length === 1 ? 'y' : 'ies'} written to audit_log`);
  }

  for (const t of TABLES) await client.query(`DROP TABLE IF EXISTS ${t}`);
  logger.info(`  - ${TABLES.join(', ')} (with their indexes and constraints)`);
}

async function rollback(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_field_sets (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      category_id INT NOT NULL,
      discipline VARCHAR(60),
      repeat_label VARCHAR(30),
      signature_mode VARCHAR(12) NOT NULL DEFAULT 'seal',
      technologist_caption VARCHAR(40),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_field_sets_category FOREIGN KEY (category_id) REFERENCES test_categories(id),
      CONSTRAINT chk_field_sets_signature_mode CHECK (signature_mode IN ('seal', 'electronic'))
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_fields (
      id SERIAL PRIMARY KEY,
      field_set_id INT NOT NULL,
      code VARCHAR(40) NOT NULL,
      label VARCHAR(80) NOT NULL,
      value_kind VARCHAR(12) NOT NULL,
      unit VARCHAR(10),
      display_order SMALLINT NOT NULL,
      section VARCHAR(60),
      applies_to_sex VARCHAR(10),
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      reference_note VARCHAR(60),
      derivation VARCHAR(24),
      derived_from VARCHAR(40),
      is_repeating BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT fk_result_fields_set FOREIGN KEY (field_set_id) REFERENCES result_field_sets(id) ON DELETE CASCADE,
      CONSTRAINT uq_result_fields_code UNIQUE (field_set_id, code),
      CONSTRAINT chk_result_fields_kind CHECK (value_kind IN ('linear3','number','text','date')),
      CONSTRAINT chk_result_fields_sex CHECK (applies_to_sex IS NULL OR applies_to_sex IN ('Male','Female')),
      CONSTRAINT chk_result_fields_derivation CHECK (
        derivation IS NULL OR derivation IN ('ELLIPSOID_VOLUME','EDC_NAEGELE','GA_FROM_MSD','BPS_SUM')),
      CONSTRAINT chk_result_fields_derived_from CHECK ((derivation IS NULL) = (derived_from IS NULL))
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_field_set_tests (
      id SERIAL PRIMARY KEY,
      field_set_id INT NOT NULL,
      test_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_fst_set FOREIGN KEY (field_set_id) REFERENCES result_field_sets(id) ON DELETE CASCADE,
      CONSTRAINT fk_fst_test FOREIGN KEY (test_id) REFERENCES tests(id),
      CONSTRAINT uq_fst_test UNIQUE (test_id)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_measurements (
      id SERIAL PRIMARY KEY,
      test_result_id INT NOT NULL,
      field_id INT NOT NULL,
      group_index SMALLINT NOT NULL DEFAULT 1,
      value_1 NUMERIC(10,4),
      value_2 NUMERIC(10,4),
      value_3 NUMERIC(10,4),
      value_text VARCHAR(120),
      value_date DATE,
      value_source VARCHAR(10) NOT NULL DEFAULT 'entered',
      derivation VARCHAR(24),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_measurements_result FOREIGN KEY (test_result_id) REFERENCES test_results(id) ON DELETE CASCADE,
      CONSTRAINT fk_measurements_field FOREIGN KEY (field_id) REFERENCES result_fields(id),
      CONSTRAINT uq_measurements UNIQUE (test_result_id, field_id, group_index),
      CONSTRAINT chk_measurements_source CHECK (value_source IN ('entered','computed','override')),
      CONSTRAINT chk_measurements_group CHECK (group_index >= 1),
      CONSTRAINT chk_measurements_has_value CHECK (value_1 IS NOT NULL OR value_text IS NOT NULL OR value_date IS NOT NULL)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_signatories (
      id SERIAL PRIMARY KEY,
      category_id INT,
      full_name VARCHAR(120) NOT NULL,
      role_caption VARCHAR(80) NOT NULL,
      prc_license VARCHAR(40),
      display_order SMALLINT NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_signatories_category FOREIGN KEY (category_id) REFERENCES test_categories(id),
      CONSTRAINT uq_signatory UNIQUE (category_id, full_name, role_caption)
    )`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_result_fields_set ON result_fields (field_set_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_fst_set ON result_field_set_tests (field_set_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_measurements_result ON result_measurements (test_result_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_measurements_field ON result_measurements (field_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_signatories_category ON clinic_signatories (category_id)');
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_signatory_global ON clinic_signatories (full_name, role_caption)
                       WHERE category_id IS NULL`);
  logger.info('  + the five tables and their indexes');

  // The signatories, from the entries apply() wrote. The latest entry per archived row wins.
  const { rows: archived } = await client.query(`
    SELECT DISTINCT ON (entity_id) description
      FROM audit_log
     WHERE action = 'clinic.signatory_archived'
     ORDER BY entity_id, id DESC`);
  let restored = 0;
  for (const { description } of archived) {
    const s = JSON.parse(description);
    const { rowCount } = await client.query(
      `INSERT INTO clinic_signatories (category_id, full_name, role_caption, prc_license, display_order, is_active)
       SELECT (SELECT id FROM test_categories WHERE name = $1), $2, $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM clinic_signatories WHERE full_name = $2 AND role_caption = $3)`,
      [s.category, s.full_name, s.role_caption, s.prc_license, s.display_order, s.is_active]
    );
    restored += rowCount;
  }
  logger.info(`  + ${restored} signator${restored === 1 ? 'y' : 'ies'} restored from audit_log`);
  logger.info('  ! the forms and the typed values are NOT restored — the values are in audit_log, action result.measurements_archived');
}

(async () => {
  const reversing = process.argv.includes('--rollback');
  const force = process.argv.includes('--force');
  const client = await pool.connect();
  try {
    logger.info(`[1.109.0] ${reversing ? 'Restoring' : 'Removing'} the typed result forms…`);
    await client.query('BEGIN');
    if (reversing) await rollback(client); else await apply(client, force);
    await client.query('COMMIT');
    logger.info(`[1.109.0] ${reversing ? 'Reversed.' : 'Done.'}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.109.0] Stopped, nothing changed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
