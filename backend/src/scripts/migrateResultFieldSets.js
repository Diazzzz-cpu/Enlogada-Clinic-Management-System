/**
 * Additive migration [1.50.0] — structured result entry, starting with Ultrasound.
 *
 * A result has been one free-text box since [1.0.0]. The clinic's real work is not shaped like
 * that: their own 1,113 ultrasound reports open with a `Measurements:` block — discrete, per-study
 * numeric fields with units — and only then the narrative. A technician retypes that block from
 * memory every time, and the archive shows what that costs. Roughly 1 in 20 reports carries a
 * derived weight that no longer matches its own axes, because someone edited the measurements and
 * never recomputed. One file titled `whole abdomen-female- normal.doc` contains a chest X-ray.
 *
 * ── Why this is not called a template ────────────────────────────────────────────────────────
 *
 * `frontend/src/lib/resultTemplates.js` already owns that word: a "template" there is a blob of
 * boilerplate prose the technician pastes into the findings box. A second meaning would make
 * every future conversation about either one ambiguous. A study's list of fields is a FIELD SET.
 *
 * ── Why four tables and not a JSONB column ───────────────────────────────────────────────────
 *
 * `grep -ic jsonb database/schema.sql` returns 0 — this schema has never used one, and the point
 * of storing a measurement is that something can read it back: which reports recorded a prostate
 * over 25 g, whether an axis changed between two versions of a report. A blob answers none of
 * that without parsing it first, and it cannot carry a foreign key back to the field it measures.
 *
 * ── Why the mapping is its own table rather than `tests.field_set_id` ────────────────────────
 *
 * `testRepository.updateTest` writes every column unconditionally, which is exactly how the
 * Services Catalogue's status toggle used to wipe a test's `preparation` (see CLAUDE.md, "An
 * omitted field is not an instruction to erase"). A new `tests` column walks into the same trap:
 * the first activate/deactivate that does not mention it would silently unmap the field set. A
 * separate table cannot be erased by a caller that never names it.
 *
 * ── Scoped by category so X-ray can arrive later without a rename ────────────────────────────
 *
 * X-ray is deliberately out of scope: the clinic's archive contains exactly two X-ray reports,
 * both Chest PA, against a 24-test X-ray catalogue. There is no evidence to build the other 23
 * from, and guessing at a clinical form is how you get a document that looks official and is
 * wrong. `category_id` means turning it on later is seed data, not a migration.
 *
 * Reverse with:
 *   node src/scripts/migrateResultFieldSets.js --rollback
 *
 * Unlike [1.45.0]'s rollback — which only dropped a grouping and left the money intact — this one
 * destroys recorded clinical measurements. It refuses to run while any exist unless --force is
 * also passed, and says how many it would take with it.
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  // ── The study catalogue ────────────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_field_sets (
      id           SERIAL PRIMARY KEY,
      code         VARCHAR(40)  NOT NULL UNIQUE,
      name         VARCHAR(120) NOT NULL,
      category_id  INT          NOT NULL,
      -- Non-NULL turns on a repeating group, and 'Fetus' is the only one the corpus needs: a twin
      -- study carries a duplicated column set. Every other study in 1,113 reports is flat, so
      -- this stays NULL for all of them rather than every set paying for the one that repeats.
      repeat_label VARCHAR(30),
      is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_field_sets_category FOREIGN KEY (category_id) REFERENCES test_categories(id)
    )
  `);
  logger.info('  + result_field_sets');

  // ── The fields themselves ──────────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_fields (
      id             SERIAL PRIMARY KEY,
      field_set_id   INT         NOT NULL,
      code           VARCHAR(40) NOT NULL,
      -- Printed verbatim on the report, so it carries the clinic's own wording. The corpus spells
      -- the same organ three ways ('Right Kidney' 402, 'R Kidney' 228, 'Rt. Kidney' 45); one row
      -- here is what ends that.
      label          VARCHAR(80) NOT NULL,
      -- 'linear3' is an L x W x H triple in ONE row. Three rows would lose the grouping, need an
      -- ordinal to put them back in order, and triple the join for no gain.
      value_kind     VARCHAR(12) NOT NULL,
      unit           VARCHAR(10),
      display_order  SMALLINT    NOT NULL,
      -- The sex-conditional branch. Whole Abdomen ends with a prostate OR a uterus and never
      -- both: of 405 reports, 194 carried prostate, 193 uterus, 0 carried both. NULL = applies to
      -- everyone. Deliberately not two field sets, which would duplicate the five shared organs.
      applies_to_sex VARCHAR(10),
      -- Advisory only, and nothing at the value level is NOT NULL. Every field in the corpus has
      -- a real absence rate — the thyroid's right lobe is present in 85% of thyroid studies, and
      -- 18 of 405 whole abdomens carry neither pelvic organ. A NOT NULL the clinic's own practice
      -- violates does not get respected, it gets a 0 typed into it, which is worse than a blank.
      is_required    BOOLEAN     NOT NULL DEFAULT FALSE,
      -- The static annotation printed beside a field on the clinic's form, e.g.
      -- 'N.V. = 5.0 - 25.0 gms'. Text, not numeric bounds: numeric bounds would invite an
      -- out-of-range flagging feature nobody asked for, and a reference range is a 95% interval,
      -- so on a multi-field study it would fire on a large share of perfectly normal reports.
      reference_note VARCHAR(60),
      -- NULL = the technician enters it. Otherwise the formula that produces it.
      derivation     VARCHAR(24),
      derived_from   VARCHAR(40),
      is_repeating   BOOLEAN     NOT NULL DEFAULT FALSE,
      is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
      CONSTRAINT fk_result_fields_set FOREIGN KEY (field_set_id)
        REFERENCES result_field_sets(id) ON DELETE CASCADE,
      CONSTRAINT uq_result_fields_code UNIQUE (field_set_id, code),
      CONSTRAINT chk_result_fields_kind CHECK (value_kind IN ('linear3','number','text','date')),
      CONSTRAINT chk_result_fields_sex
        CHECK (applies_to_sex IS NULL OR applies_to_sex IN ('Male','Female')),
      -- Only the three formulas the corpus actually evidences. Hadlock is deliberately absent:
      -- gestational age and estimated fetal weight come off the scanner printout, the templates
      -- state no regression for them, and a fabricated gestational age on a clinical report is
      -- not a rounding error.
      CONSTRAINT chk_result_fields_derivation
        CHECK (derivation IS NULL OR derivation IN ('ELLIPSOID_VOLUME','EDC_NAEGELE','GA_FROM_MSD')),
      CONSTRAINT chk_result_fields_derived_from
        CHECK ((derivation IS NULL) = (derived_from IS NULL))
    )
  `);
  logger.info('  + result_fields');

  // ── Which catalogue rows use which set ─────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_field_set_tests (
      id           SERIAL PRIMARY KEY,
      field_set_id INT NOT NULL,
      test_id      INT NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_fst_set  FOREIGN KEY (field_set_id)
        REFERENCES result_field_sets(id) ON DELETE CASCADE,
      CONSTRAINT fk_fst_test FOREIGN KEY (test_id) REFERENCES tests(id),
      -- One set per test: two would make "which grid do I render" unanswerable. A SET may serve
      -- several tests, which is why only test_id is unique.
      CONSTRAINT uq_fst_test UNIQUE (test_id)
    )
  `);
  logger.info('  + result_field_set_tests');

  // ── The recorded values ────────────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS result_measurements (
      id             SERIAL PRIMARY KEY,
      -- Attaches to the VERSION, not the visit_test, and that is the load-bearing choice.
      -- createResult inserts a NEW test_results row per save and copies nothing forward. If these
      -- hung off visit_test_id an amendment would rewrite the numbers belonging to the superseded
      -- version in place, so the amendment history would render v1's prose beside v2's figures —
      -- destroying exactly what [1.15.0] exists to keep.
      test_result_id INT         NOT NULL,
      field_id       INT         NOT NULL,
      group_index    SMALLINT    NOT NULL DEFAULT 1,
      value_1        NUMERIC(7,2),
      value_2        NUMERIC(7,2),
      value_3        NUMERIC(7,2),
      value_text     VARCHAR(120),
      value_date     DATE,
      -- 'computed' when the system derived it, 'override' when a sonologist typed a figure that
      -- disagrees with the formula. An override is kept exactly as typed: this system does not
      -- overrule a clinician, it only shows them the disagreement.
      value_source   VARCHAR(10) NOT NULL DEFAULT 'entered',
      -- Stamped WITH the value, not read from code at render time. If a coefficient is ever
      -- corrected, new rows carry the new code and already-released reports keep saying what they
      -- said — the same reason [1.30.0] never restates a closed day.
      derivation     VARCHAR(24),
      created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_measurements_result FOREIGN KEY (test_result_id)
        REFERENCES test_results(id) ON DELETE CASCADE,
      CONSTRAINT fk_measurements_field FOREIGN KEY (field_id) REFERENCES result_fields(id),
      CONSTRAINT uq_measurements UNIQUE (test_result_id, field_id, group_index),
      CONSTRAINT chk_measurements_source CHECK (value_source IN ('entered','computed','override')),
      CONSTRAINT chk_measurements_group CHECK (group_index >= 1),
      -- A row exists because it carries a value. All-NULL is a cleared field that should have been
      -- deleted, and on a printed clinical document it renders as an empty line the reader has to
      -- interpret.
      CONSTRAINT chk_measurements_has_value CHECK (
        value_1 IS NOT NULL OR value_text IS NOT NULL OR value_date IS NOT NULL)
    )
  `);
  logger.info('  + result_measurements');

  await client.query(`CREATE INDEX IF NOT EXISTS idx_result_fields_set ON result_fields (field_set_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fst_set ON result_field_set_tests (field_set_id)`);
  // The hot one: every rendered report joins measurements by their result.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_measurements_result ON result_measurements (test_result_id)`);
  // FK hygiene, per [1.29.0] — an unindexed FK makes the parent's delete scan the child.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_measurements_field ON result_measurements (field_id)`);
  logger.info('  + indexes');
}

async function rollback(client, force) {
  const { rows } = await client
    .query(`SELECT COUNT(*)::int AS n FROM result_measurements`)
    .catch(() => ({ rows: [{ n: 0 }] }));

  if (rows[0].n > 0 && !force) {
    logger.error(`  ! ${rows[0].n} recorded measurement(s) would be destroyed.`);
    logger.error('    These are clinical values a technician entered against a released report,');
    logger.error('    and nothing else in the database holds them. Re-run with --force if that is');
    logger.error('    genuinely what you want.');
    throw new Error('refusing to drop recorded measurements without --force');
  }
  if (rows[0].n > 0) {
    logger.warn(`  ! dropping ${rows[0].n} recorded measurement(s) because --force was passed`);
  }

  await client.query('DROP TABLE IF EXISTS result_measurements');
  logger.info('  - result_measurements');
  await client.query('DROP TABLE IF EXISTS result_field_set_tests');
  logger.info('  - result_field_set_tests');
  await client.query('DROP TABLE IF EXISTS result_fields');
  logger.info('  - result_fields');
  await client.query('DROP TABLE IF EXISTS result_field_sets');
  logger.info('  - result_field_sets');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  const force = process.argv.includes('--force');
  logger.info(`[1.50.0] ${reversing ? 'Rolling back' : 'Applying'} result field sets…`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client, force);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.50.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (!reversing) {
    const { rows } = await db
      .query(`SELECT COUNT(*)::int AS n FROM result_field_sets`)
      .catch(() => ({ rows: [{ n: 0 }] }));
    logger.info(`[1.50.0] Done. ${rows[0].n} field set(s) defined — run seedResultFieldSets.js to load them.`);
  } else {
    logger.info('[1.50.0] Done.');
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.50.0] Migration failed: ${err.message}`);
  process.exit(1);
});
