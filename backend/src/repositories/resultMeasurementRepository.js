const db = require('../config/database');

/**
 * The structured half of a result. [1.50.0]
 *
 * Kept out of `resultRepository` deliberately: that file is already the largest repository in the
 * project and every query in it answers "what is this result", where these answer "what shape
 * should this result have" and "what numbers were recorded against this version". Two questions,
 * two files.
 *
 * ── Measurements are NEVER joined into a list query ──────────────────────────────────────────
 *
 * `CLAUDE.md` already warns that a `LEFT JOIN test_results` without `AND tr.is_current` repeats
 * the parent row once per amendment. A child table makes that worse in a way the `is_current`
 * filter does not fix: joining measurements into a worklist repeats the row once per FIELD —
 * eleven times for a whole abdomen — even when the version filter is perfectly correct. The
 * report that would suffer most is `getDiagnosticWorkload`, which [1.15.0] specifically called out
 * as the query that inflates a clinician's throughput when a row is duplicated.
 *
 * So they are fetched by their own call, keyed on a result id. Never add a join.
 */
const resultMeasurementRepository = {
  /**
   * The field set a given visit_test should be recorded with, or null for a test that has none —
   * which is every Laboratory and X-ray test today, and is what keeps their free-text path
   * byte-identical to before this feature existed.
   *
   * Fields come back including the ones that do not apply to this patient's sex; the caller
   * filters. The alternative — filtering in SQL — would mean the shape of the form silently
   * depended on a join, and a wrong sex on the patient record would look like a missing feature
   * rather than a wrong record.
   */
  async findFieldSetForVisitTest(visitTestId) {
    const setResult = await db.query(
      `SELECT fs.id, fs.code, fs.name, fs.repeat_label, fs.discipline
         FROM visit_tests vt
         JOIN result_field_set_tests m ON m.test_id = vt.test_id
         JOIN result_field_sets fs     ON fs.id = m.field_set_id
        WHERE vt.id = $1 AND fs.is_active = TRUE`,
      [visitTestId]
    );
    const set = setResult.rows[0];
    if (!set) return null;

    const fields = await db.query(
      `SELECT id, code, label, value_kind, unit, display_order, applies_to_sex,
              is_required, reference_note, derivation, derived_from, is_repeating, section
         FROM result_fields
        WHERE field_set_id = $1 AND is_active = TRUE
        ORDER BY display_order`,
      [set.id]
    );
    return { ...set, fields: fields.rows };
  },

  /**
   * The patient's sex and the visit's date, for the two things the write path needs them for:
   * refusing a uterus measurement on a male patient, and dating an EDC from the SCAN rather than
   * from whenever an amendment happens to be typed.
   */
  async findVisitContextByVisitTest(visitTestId) {
    const { rows } = await db.query(
      `SELECT p.sex, pv.created_at AS scan_date
         FROM visit_tests vt
         JOIN patient_visits pv ON pv.id = vt.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
        WHERE vt.id = $1`,
      [visitTestId]
    );
    return rows[0] || null;
  },

  /**
   * Who signs a report of this category, left column first.
   *
   * A laboratory report carries two — a Medical Technologist and a Pathologist, each with a PRC
   * licence number. An ultrasound report carries one radiologist and no licence number at all,
   * because 1,113 archived reports contain none. A category with no row configured prints no
   * signature block rather than a blank one.
   */
  async findSignatoriesByCategory(categoryName) {
    const { rows } = await db.query(
      `SELECT s.full_name, s.role_caption, s.prc_license, s.display_order
         FROM clinic_signatories s
         LEFT JOIN test_categories tc ON tc.id = s.category_id
        WHERE s.is_active = TRUE AND (s.category_id IS NULL OR tc.name = $1)
        -- id as a tiebreaker: display_order alone is stable only while no two signatories share
        -- one, and which name prints LEFT on a signed clinical document must never be whatever the
        -- planner returns that day. [1.53.0]
        ORDER BY s.display_order, s.id`,
      [categoryName]
    );
    return rows;
  },

  /** Everything recorded against one version of a result, ready to render. */
  async findByResultId(testResultId) {
    const { rows } = await db.query(
      `SELECT rm.id, rm.field_id, rm.group_index, rm.value_1, rm.value_2, rm.value_3,
              rm.value_text, rm.value_date, rm.value_source, rm.derivation,
              f.code AS field_code, f.label, f.unit, f.value_kind, f.reference_note,
              f.applies_to_sex, f.display_order, f.section
         FROM result_measurements rm
         JOIN result_fields f ON f.id = rm.field_id
        WHERE rm.test_result_id = $1
        ORDER BY f.display_order, rm.group_index`,
      [testResultId]
    );
    return rows;
  },

  /**
   * The same, for several versions at once — the amendment history screen shows each version's
   * numbers beside its prose, and doing that one query per version is how an N+1 gets written.
   */
  async findByResultIds(testResultIds) {
    if (!testResultIds.length) return [];
    const { rows } = await db.query(
      `SELECT rm.test_result_id, rm.field_id, rm.group_index, rm.value_1, rm.value_2, rm.value_3,
              rm.value_text, rm.value_date, rm.value_source, rm.derivation,
              f.code AS field_code, f.label, f.unit, f.value_kind, f.reference_note,
              f.display_order, f.section
         FROM result_measurements rm
         JOIN result_fields f ON f.id = rm.field_id
        WHERE rm.test_result_id = ANY($1)
        ORDER BY rm.test_result_id, f.display_order, rm.group_index`,
      [testResultIds]
    );
    return rows;
  },

  /**
   * Write the measurements for one version.
   *
   * Insert-only, because a version is written once: `createResult` inserts a new `test_results`
   * row per save rather than updating one, so there is never an existing set of rows to update.
   * Runs inside whatever transaction the caller opened — `db.query` joins the ambient one through
   * AsyncLocalStorage, which is why no client is passed.
   */
  async insertMany(testResultId, rows) {
    if (!rows.length) return 0;
    const values = [];
    const params = [];
    rows.forEach((r, i) => {
      const base = i * 10;
      values.push(`(${Array.from({ length: 10 }, (_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(
        testResultId, r.field_id, r.group_index || 1,
        r.value_1 ?? null, r.value_2 ?? null, r.value_3 ?? null,
        r.value_text ?? null, r.value_date ?? null,
        r.value_source || 'entered', r.derivation ?? null
      );
    });
    const { rowCount } = await db.query(
      `INSERT INTO result_measurements
         (test_result_id, field_id, group_index, value_1, value_2, value_3,
          value_text, value_date, value_source, derivation)
       VALUES ${values.join(',')}`,
      params
    );
    return rowCount;
  },
};

module.exports = resultMeasurementRepository;
