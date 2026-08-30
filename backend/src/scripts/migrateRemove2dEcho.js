/**
 * [1.50.0] Remove 2D Echo from the system.
 *
 * The clinic does not offer it. [1.47.0] deactivated the two tests and left the `test_categories`
 * row in place, because 18 historical `visit_tests` pointed at it and a past visit has to keep
 * being able to say what it was for. That reason has expired: the count is now zero, so nothing
 * in the database needs the category to exist any more.
 *
 * ── This script refuses rather than destroys ────────────────────────────────────────────────
 *
 * It re-counts the references itself instead of trusting that statement. A developer database and
 * the clinic's live database are not the same database, and the whole argument for deleting rests
 * on a number that is only true of one of them. If any `visit_tests` row still points at a 2D Echo
 * test, this exits WITHOUT changing anything and prints what it found — deleting would either be
 * refused by the foreign key or, worse, silently orphan a visit's record of what it was for.
 *
 * A visit that cannot say what it was for is a permanent hole in a patient's record. There is no
 * version of "finish the cleanup" worth that, which is why the check is a hard stop and not a
 * warning.
 *
 *   node src/scripts/migrateRemove2dEcho.js              # report only
 *   node src/scripts/migrateRemove2dEcho.js --confirm    # apply
 *   node src/scripts/migrateRemove2dEcho.js --rollback   # put the category and tests back
 */

require('dotenv').config();
const db = require('../config/database');

const CATEGORY = '2D Echo';

// Restored by --rollback exactly as [1.47.0] left them: present, and inactive.
const TESTS = [
  { name: 'Plain 2D Echo with Doppler', price: 2500.0 },
  { name: 'Pediatric 2D Echo', price: 3000.0 },
];

async function countReferences() {
  const { rows } = await db.query(
    `SELECT COALESCE(COUNT(vt.id), 0)::int AS uses,
            COALESCE(COUNT(DISTINCT t.id), 0)::int AS tests
       FROM test_categories tc
       LEFT JOIN tests t ON t.category_id = tc.id
       LEFT JOIN visit_tests vt ON vt.test_id = t.id
      WHERE tc.name = $1`,
    [CATEGORY]
  );
  return rows[0] || { uses: 0, tests: 0 };
}

async function apply(confirm) {
  const { rows: cat } = await db.query('SELECT id FROM test_categories WHERE name = $1', [CATEGORY]);
  if (cat.length === 0) {
    console.log(`\n  "${CATEGORY}" is already gone. Nothing to do.\n`);
    return;
  }

  const { uses, tests } = await countReferences();
  console.log(`\n  Category "${CATEGORY}" (id ${cat[0].id})`);
  console.log(`    tests in it        : ${tests}`);
  console.log(`    visit_tests using  : ${uses}`);

  if (uses > 0) {
    console.error(
      `\n  REFUSED. ${uses} visit_test row(s) still point at ${CATEGORY}.\n` +
      `  Those rows are a patient's record of what their visit was for. Deleting the category\n` +
      `  would take that meaning away permanently, so nothing has been changed.\n\n` +
      `  If the clinic genuinely wants this history dropped, that is a separate, deliberate\n` +
      `  decision about patient records — not a side effect of retiring a service.\n`
    );
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log('\n  Dry run. Re-run with --confirm to delete the category and its tests.\n');
    return;
  }

  await db.withTransaction(async () => {
    const del = await db.query('DELETE FROM tests WHERE category_id = $1 RETURNING name', [cat[0].id]);
    await db.query('DELETE FROM test_categories WHERE id = $1', [cat[0].id]);
    del.rows.forEach((r) => console.log(`    removed test: ${r.name}`));
  });

  console.log(`\n  Done. "${CATEGORY}" removed.\n`);
}

async function rollback() {
  const { rows } = await db.query('SELECT id FROM test_categories WHERE name = $1', [CATEGORY]);
  if (rows.length > 0) {
    console.log(`\n  "${CATEGORY}" already exists. Nothing to do.\n`);
    return;
  }

  await db.withTransaction(async () => {
    const { rows: cat } = await db.query(
      'INSERT INTO test_categories (name) VALUES ($1) RETURNING id',
      [CATEGORY]
    );
    for (const t of TESTS) {
      await db.query(
        `INSERT INTO tests (category_id, name, price, is_active)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT DO NOTHING`,
        [cat[0].id, t.name, t.price]
      );
    }
  });

  console.log(`\n  Restored "${CATEGORY}" and its ${TESTS.length} tests, inactive.\n`);
}

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--rollback')) await rollback();
    else await apply(args.includes('--confirm'));
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
