const db = require('../config/database');

class TestRepository {
  async findAllTests(includeInactive = false) {
    const whereClause = includeInactive ? '' : 'WHERE t.is_active = TRUE';
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      ${whereClause}
      ORDER BY tc.name, t.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  /**
   * Batch form of findTestById — one round trip for a whole set of ids.
   *
   * Used when attaching tests to a visit, which previously issued a findTestById per test. That
   * loop ran inside the booking transaction, holding the slot's advisory lock for the duration.
   * Ids absent from the result are simply missing; the caller compares counts to report which.
   */
  async findTestsByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE t.id = ANY($1::int[])
    `;
    const result = await db.query(queryText, [ids.map((id) => parseInt(id, 10))]);
    return result.rows;
  }

  async findTestById(id) {
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE t.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  // `preparation` is normalised to NULL when blank [1.24.0]: an empty string and "no preparation
  // needed" mean the same thing, and only one of them renders as nothing at all.
  async createTest({ categoryId, name, price, preparation = null }) {
    const queryText = `
      INSERT INTO tests (category_id, name, price, preparation)
      VALUES ($1, $2, $3, NULLIF(TRIM($4), ''))
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price, preparation]);
    return result.rows[0];
  }

  async updateTest(id, { categoryId, name, price, isActive, preparation = null }) {
    const queryText = `
      UPDATE tests
      SET category_id = $1, name = $2, price = $3, is_active = $4,
          preparation = NULLIF(TRIM($5), ''), updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price, isActive, preparation, id]);
    return result.rows[0];
  }

  async updateTestPrice(id, price) {
    const queryText = `
      UPDATE tests
      SET price = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [price, id]);
    return result.rows[0];
  }

  async findAllCategories() {
    const queryText = 'SELECT * FROM test_categories ORDER BY name';
    const result = await db.query(queryText);
    return result.rows;
  }

  // Visit-Tests: Link tests to a patient visit
  //
  // The conflict clause carried DO NOTHING, which is right for a retried booking re-sending the
  // same tests — it converges on the same rows instead of failing the unique constraint. But it was
  // also wrong in one case, and that case cost money. [1.71.0]
  //
  // A package EXPANDS into one row per component at an allocated share of its fixed price. Attach a
  // package to a visit that already carries one of those components as a loose row, and DO NOTHING
  // skipped the package's cheaper share — leaving the component at LIST price with package_id NULL,
  // for good. Nothing ever repaired it: every UPDATE on visit_tests sets `status` and nothing else,
  // and the bill is derived from SUM(price_at_time). The bundle then quietly costs more than its
  // own fixed price — +₱200 on Package A, +₱590 on Package E. Not reachable from booking, which
  // submits once with packages ordered first; reachable from reception's assign-tests dialog, where
  // reopening a visit to add work is the ordinary way to use it.
  //
  // So a package may now CLAIM a loose row. Each condition below stops it doing something worse:
  //
  //   visit_tests.package_id IS NULL   — never take a component from a DIFFERENT package. Two
  //                                      bundles sharing a test must not fight over one row.
  //   EXCLUDED.package_id IS NOT NULL  — only a PACKAGE claim may reprice. This function also
  //                                      inserts loose tests, and without this a re-added loose test
  //                                      would rewrite its own price_at_time to today's list price —
  //                                      restating a bill that column exists to freeze.
  //   no 'Paid' payment                — never restate a bill the patient holds a receipt for.
  //                                      testService.addTestsToVisit already refuses on a paid
  //                                      visit, but appointmentService's already-booked branch calls
  //                                      packageService.attachPackages DIRECTLY and bypasses it, so
  //                                      that guard cannot be relied on from here.
  //
  // Every path where this does not fire keeps the old DO NOTHING behaviour exactly.
  //
  // Still returns undefined for a row left untouched, so callers re-read rather than trusting
  // RETURNING — the [1.45.0] trap.
  async addTestToVisit({ patientVisitId, testId, priceAtTime, packageId = null }) {
    const queryText = `
      INSERT INTO visit_tests (patient_visit_id, test_id, price_at_time, package_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (patient_visit_id, test_id) DO UPDATE
        SET price_at_time = EXCLUDED.price_at_time,
            package_id    = EXCLUDED.package_id
        WHERE visit_tests.package_id IS NULL
          AND EXCLUDED.package_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM payments p
                 WHERE p.patient_visit_id = visit_tests.patient_visit_id
                   AND p.payment_status = 'Paid'
              )
      RETURNING *
    `;
    const result = await db.query(queryText, [patientVisitId, testId, priceAtTime, packageId]);
    return result.rows[0];
  }

  async findTestsByVisitId(patientVisitId) {
    const queryText = `
      SELECT vt.*, t.name as test_name, tc.name as category_name,
             tp.code AS package_code, tp.name AS package_name, tp.price AS package_price
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      LEFT JOIN test_packages tp ON tp.id = vt.package_id
      WHERE vt.patient_visit_id = $1
      ORDER BY tc.name, t.name
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  /**
   * One attached test, with everything a removal decision needs. [1.55.0]
   *
   * Fetched in ONE query rather than four, because every fact here is a reason to refuse and
   * asking separately invites a caller to check three of them and forget the fourth.
   */
  async findVisitTestForRemoval(visitTestId) {
    const queryText = `
      SELECT vt.id, vt.patient_visit_id, vt.status, vt.package_id, vt.price_at_time,
             t.name AS test_name,
             tp.name AS package_name,
             -- Money already taken against this visit. Removing a line after a receipt exists
             -- would change a bill that has been printed and filed.
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = vt.patient_visit_id AND pay.payment_status = 'Paid'
             ) AS visit_paid,
             -- Any result at all, including superseded versions: an amended report's history is
             -- as much a clinical record as its current version.
             EXISTS (
               SELECT 1 FROM test_results tr WHERE tr.visit_test_id = vt.id
             ) AS has_result
        FROM visit_tests vt
        JOIN tests t ON t.id = vt.test_id
        LEFT JOIN test_packages tp ON tp.id = vt.package_id
       WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /** Every line belonging to one package on one visit — a bundle is removed whole or not at all. */
  async findPackageLinesOnVisit(patientVisitId, packageId) {
    const result = await db.query(
      `SELECT vt.id, vt.status, t.name AS test_name,
              EXISTS (SELECT 1 FROM test_results tr WHERE tr.visit_test_id = vt.id) AS has_result
         FROM visit_tests vt JOIN tests t ON t.id = vt.test_id
        WHERE vt.patient_visit_id = $1 AND vt.package_id = $2`,
      [patientVisitId, packageId]
    );
    return result.rows;
  }

  async deleteVisitTests(ids) {
    if (!ids.length) return [];
    const result = await db.query(
      'DELETE FROM visit_tests WHERE id = ANY($1::int[]) RETURNING id',
      [ids]
    );
    return result.rows;
  }

  async updateVisitTestStatus(visitTestId, status) {
    const queryText = `
      UPDATE visit_tests
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, visitTestId]);
    return result.rows[0];
  }
}

module.exports = new TestRepository();
