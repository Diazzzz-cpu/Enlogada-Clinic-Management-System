/**
 * Loads the clinic's REAL printed price list into `tests` and `test_packages`.
 *
 * Transcribed from the clinic's own laminated sheets (laboratory, two X-ray pages, the 2025
 * ultrasound sheet, and the package panel), including the handwritten amendments where they are
 * unambiguous. Anything ambiguous is left out and reported at the end rather than guessed at — a
 * fabricated price is money taken from a patient on the strength of a made-up number.
 *
 * ── Why it updates in place ─────────────────────────────────────────────────────────────────
 *
 * `visit_tests.price_at_time` snapshots the sale price, and historical rows point at these ids, so
 * repricing a row cannot corrupt an old visit's total. A demo row whose real-world equivalent is
 * on a sheet is therefore RENAMED and REPRICED rather than replaced, and history follows it.
 *
 * A demo row with no equivalent is DEACTIVATED, never deleted: deleting would orphan the visits
 * that used it, and leaving it bookable would sell a service at a price the clinic never set.
 * Deactivation is also the recoverable direction — the summary names each one so the clinic can
 * switch it back on with a real price.
 *
 * Dry-run by default:
 *   node src/scripts/seedRealCatalogue.js
 *   node src/scripts/seedRealCatalogue.js --confirm
 */
const db = require('../config/database');
const logger = require('../config/logger');

const FASTING = 'Nothing to eat or drink except water for 8 hours before the test.';
const FULL_BLADDER = 'Drink 3–4 glasses of water an hour before and do not empty your bladder.';

// name, price, preparation. `''` preparation means "leave whatever is already there".
const CATALOGUE = {
  Laboratory: [
    // --- Blood chemistry ---
    ['Fasting Blood Sugar (FBS)', 190.00, FASTING],
    ['Random Blood Sugar (RBS)', 190.00, ''],
    ['HbA1c', 1000.00, ''],
    ['Creatinine', 190.00, ''],
    ['Blood Uric Acid (BUA)', 190.00, ''],
    ['Blood Urea Nitrogen (BUN)', 250.00, ''],
    ['Lipid Profile', 760.00, FASTING],
    ['Cholesterol only', 250.00, FASTING],
    ['SGPT', 230.00, ''],
    ['OGTT 75g', 800.00, FASTING],

    // --- Haematology ---
    ['Complete Blood Count (CBC)', 180.00, ''],
    ['Blood Typing', 190.00, ''],
    ['Clotting Time / Bleeding Time (CT BT)', 160.00, ''],

    // --- Clinical microscopy ---
    ['Urinalysis', 90.00, ''],
    ['Stool Exam', 90.00, ''],

    // --- Serology / immunology ---
    ['Hepatitis B Screening', 190.00, ''],
    ['VDRL / Syphilis', 290.00, ''],
    ['TSH', 800.00, ''],
    ['T3', 800.00, ''],
    ['T4', 800.00, ''],
    ['FT3', 800.00, ''],
    ['FT4', 800.00, ''],

    // Not on the PRINTED list. Handwritten beside the package panel as "HIV 500" — which the
    // clinic confirmed is an INDIVIDUAL price noted there, not a component breakdown of Package E.
    // It is also what makes the five bundles coherent: at 0.00 four of them totalled MORE than
    // their own components, which is not a package deal.
    ['HIV Screening', 500.00, ''],
  ],

  // 2025 sheet. "Billiary" on the printed sheet is a typo for "Biliary"; corrected, because the
  // misspelling is unambiguous and this string is what a patient reads on their own booking.
  Ultrasound: [
    ['Pelvic Ultrasound', 500.00, FULL_BLADDER],
    ['Trans-vaginal (TVS)', 700.00, ''],
    ['KUB / Prostate', 700.00, FULL_BLADDER],
    ['HBT', 700.00, FASTING],
    ['Upper Abdomen', 700.00, FASTING],
    ['Lower Abdomen', 700.00, FULL_BLADDER],
    ['Whole Abdomen', 1250.00, FASTING],
    ['Liver / Biliary Tree', 700.00, FASTING],
    ['Thyroid', 700.00, ''],
    ['BPS', 700.00, ''],
    ['Chest Ultrasound', 1000.00, ''],
    ['Transrectal', 700.00, ''],
    ['Scrotum', 700.00, ''],
    ['BPS w/ NST', 1300.00, ''],
  ],

  Xray: [
    // --- Chest and upper airway ---
    ['Chest PA', 300.00, ''],
    ['Apico-Lordotic View', 300.00, ''],
    ['Chest PAL', 500.00, ''],
    ['Chest APL', 500.00, ''],
    ['Waters View', 500.00, ''],
    ['Skull APL', 600.00, ''],
    ['Paranasal Sinuses (PNS)', 1000.00, ''],

    // --- Abdomen ---
    ['Abdomen Supine & Upright', 1300.00, ''],
    ['Abdomen Flat Plate & Upright', 1200.00, ''],

    // --- Spine ---
    ['Cervical APL', 600.00, ''],
    ['Thoracic Spine APL', 950.00, ''],
    ['Thoraco-Lumbar APL (TL)', 1300.00, ''],
    ['Lumbo-Sacral APL (LS)', 950.00, ''],
    ['Lumbar Spine APL', 950.00, ''],

    // --- Extremities ---
    ['Shoulder AP Int/Ext', 400.00, ''],
    ['Arm (Humerus) APL / Elbow APL', 400.00, ''],
    ['Forearm APL', 400.00, ''],
    ['Hand / Wrist APL', 400.00, ''],
    ['Pelvis AP / APL', 550.00, ''],
    ['Thigh (Femur) APL', 500.00, ''],
    ['Leg APL', 400.00, ''],
    ['Knee APL', 400.00, ''],
    ['Ankle APL', 400.00, ''],
    ['Foot APL', 400.00, ''],
  ],
};

// realName -> the existing demo row it replaces. Renamed and repriced rather than duplicated, so
// the historical visit_tests rows keep pointing at the right service.
const RENAME = {
  'Chest PA': 'Chest X-Ray (PA)',
  'Chest APL': 'Chest X-Ray (AP/Lateral)',
  Thyroid: 'Thyroid Ultrasound',
};

// Demo rows with no equivalent on any sheet. Deactivated with the reason, which is printed in the
// summary — the clinic may well offer these, but not at a price this repo invented.
const SUPERSEDE = {
  'Abdominal Ultrasound': 'the sheet splits this into Upper / Lower / Whole Abdomen at different prices',
  'Breast Ultrasound': 'not on the 2025 ultrasound sheet — carried a demo price',
  'Abdominal X-Ray': 'the sheet distinguishes Supine & Upright (1300) from Flat Plate & Upright (1200)',

  // The clinic does not offer these. Deactivated rather than deleted, and the 'ECG'
  // CATEGORIES stay: 18 historical visit_tests point at these rows, and dropping the category would
  // leave those visits unable to say what they were for. Deactivating is enough to achieve what was
  // actually asked — nothing new can be booked, and they disappear from the public price list and
  // the booking picker, both of which read only active rows.
  '12 Lead ECG': 'the clinic does not offer ECG',
};

// code, name, price, [component test names]. Component names must match CATALOGUE exactly.
const PACKAGES = [
  ['A', 'Package A', 1450.00,
    ['Complete Blood Count (CBC)', 'Urinalysis', 'Hepatitis B Screening', 'Blood Typing',
      'Pelvic Ultrasound', 'HIV Screening']],
  ['B', 'Package B', 1940.00,
    ['Complete Blood Count (CBC)', 'Urinalysis', 'Hepatitis B Screening', 'VDRL / Syphilis',
      'Blood Typing', 'Pelvic Ultrasound', 'HIV Screening', 'Fasting Blood Sugar (FBS)']],
  // The sheet reads "FBS/RBS" — either, and both are ₱190. FBS is the one carried here; the
  // choice is flagged in the summary.
  ['C', 'Package C', 1650.00,
    ['Complete Blood Count (CBC)', 'Urinalysis', 'Hepatitis B Screening', 'Blood Typing',
      'Fasting Blood Sugar (FBS)', 'Pelvic Ultrasound', 'HIV Screening']],
  ['D', 'Package D', 2400.00,
    ['Complete Blood Count (CBC)', 'Urinalysis', 'Hepatitis B Screening', 'Blood Typing',
      'OGTT 75g', 'Pelvic Ultrasound', 'HIV Screening']],
  ['E', 'Package E', 2050.00,
    ['Complete Blood Count (CBC)', 'Urinalysis', 'Hepatitis B Screening', 'VDRL / Syphilis',
      'Blood Typing', 'HIV Screening', 'Pelvic Ultrasound', 'Trans-vaginal (TVS)']],
];

const money = (n) => Number(n).toFixed(2);

async function main() {
  const confirm = process.argv.includes('--confirm');
  logger.info(`Real catalogue seed — ${confirm ? 'APPLYING' : 'DRY RUN (pass --confirm to write)'}`);

  const { rows: cats } = await db.query(`SELECT id, name FROM test_categories`);
  const catId = new Map(cats.map((c) => [c.name, c.id]));
  for (const name of Object.keys(CATALOGUE)) {
    if (!catId.has(name)) throw new Error(`No "${name}" category found in test_categories.`);
  }

  const { rows: existing } = await db.query(
    `SELECT t.id, t.name, t.price, t.preparation, t.is_active, t.category_id, tc.name AS category
       FROM tests t JOIN test_categories tc ON tc.id = t.category_id`
  );
  const key = (cat, name) => `${cat}::${name.toLowerCase()}`;
  const byName = new Map(existing.map((t) => [key(t.category, t.name), t]));

  const planned = { update: [], insert: [], unchanged: [], supersede: [] };

  for (const [category, items] of Object.entries(CATALOGUE)) {
    for (const [name, price, prep] of items) {
      // Canonical name FIRST, the demo alias only as a fallback.
      //
      // The other order is not idempotent, and that is not theoretical: the first run renames
      // "Chest X-Ray (PA)" to "Chest PA", so a second run looks up the alias, fails to find it,
      // plans an INSERT, and dies on uq_tests_category_name — with the whole transaction rolled
      // back, so nothing else in the run lands either. These scripts are meant to be safe to
      // re-run; this makes it converge instead of breaking on the second attempt.
      const found = byName.get(key(category, name))
        || byName.get(key(category, RENAME[name] || name));
      if (!found) {
        planned.insert.push([category, name, price, prep]);
        continue;
      }
      const priceChanged = Number(found.price) !== price;
      const nameChanged = found.name !== name;
      const prepChanged = prep !== '' && (found.preparation || '') !== prep;
      if (priceChanged || nameChanged || prepChanged) {
        planned.update.push([found, category, name, price, prep]);
      } else {
        planned.unchanged.push(`${category} · ${name}`);
      }
    }
  }

  for (const [demoName, reason] of Object.entries(SUPERSEDE)) {
    const found = existing.find((t) => t.name === demoName && t.is_active);
    if (found) planned.supersede.push([found, reason]);
  }

  // Leftovers from E2E runs: the spec deactivates its fixture rather than deleting it, so they
  // accumulate. Only ever removes rows nothing references.
  const { rows: junk } = await db.query(
    `SELECT t.id, t.name FROM tests t
      WHERE t.name LIKE 'E2E %'
        AND NOT EXISTS (SELECT 1 FROM visit_tests vt WHERE vt.test_id = t.id)`
  );

  console.log('\n--- UPDATE (name / price / preparation) ---');
  for (const [found, category, name, price] of planned.update) {
    const rename = found.name !== name ? `  "${found.name}" ->` : '';
    console.log(`  ${category.padEnd(11)} ${rename}${name.padEnd(34)} ${money(found.price).padStart(9)} -> ${money(price).padStart(9)}`);
  }
  console.log('\n--- INSERT (new services) ---');
  planned.insert.forEach(([c, n, p]) => console.log(`  ${c.padEnd(11)} ${n.padEnd(38)} ${money(p).padStart(9)}`));
  console.log('\n--- DEACTIVATE (demo rows with no equivalent on any sheet) ---');
  planned.supersede.forEach(([t, why]) => console.log(`  ${t.name.padEnd(30)} — ${why}`));
  console.log('\n--- ALREADY CORRECT ---');
  planned.unchanged.forEach((n) => console.log(`  ${n}`));
  console.log('\n--- DELETE (unreferenced E2E fixtures) ---');
  junk.forEach((j) => console.log(`  ${j.name}`));

  console.log('\n--- PACKAGES ---');
  const upsideDown = [];
  for (const [code, name, price, items] of PACKAGES) {
    const listed = items.reduce((sum, n) => {
      for (const list of Object.values(CATALOGUE)) {
        const hit = list.find((r) => r[0] === n);
        if (hit) return sum + hit[1];
      }
      throw new Error(`Package ${code} names "${n}", which is not in CATALOGUE.`);
    }, 0);
    const saving = listed - price;
    if (saving < 0) upsideDown.push([name, -saving]);
    const verdict = saving < 0 ? `COSTS ${money(-saving)} MORE` : `saves ${money(saving)}`;
    console.log(`  ${name}  ${money(price).padStart(9)}   components at list ${money(listed).padStart(9)}   ${verdict}`);
    console.log(`    ${items.join(', ')}`);
  }

  // A bundle that costs more than its parts is not a bundle, and it is the sort of thing that only
  // shows up when you total it. Say so loudly rather than loading it quietly.
  if (upsideDown.length) {
    console.log(`
  !! ${upsideDown.length} of ${PACKAGES.length} packages cost MORE than their components at list price:`);
    upsideDown.forEach(([n, by]) => console.log(`       ${n} is ${money(by)} more expensive than buying the parts`));
    console.log('     Every one of them contains HIV Screening. If it is loaded at 0.00 this is');
    console.log('     what you see: the clinic gives HIV an individual price of 500 (handwritten');
    console.log('     beside the package panel), and at 500 all five become real savings');
    console.log('     (A +200, B +190, C +190, D +50, E +590).');
    console.log('     PRICING HIV RESOLVES THIS. No patient is affected meanwhile: a package sells');
    console.log('     at its own fixed price, never at the sum of its parts.');
  }

  if (!confirm) {
    console.log('\nDry run. Nothing written. Re-run with --confirm to apply.');
    process.exit(0);
  }

  await db.withTransaction(async () => {
    for (const [found, category, name, price, prep] of planned.update) {
      await db.query(
        `UPDATE tests
            SET name = $1, price = $2,
                preparation = COALESCE(NULLIF(TRIM($3), ''), preparation),
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $4`,
        [name, price, prep, found.id]
      );
    }
    for (const [category, name, price, prep] of planned.insert) {
      await db.query(
        `INSERT INTO tests (category_id, name, price, preparation, is_active)
         VALUES ($1, $2, $3, NULLIF(TRIM($4), ''), TRUE)`,
        [catId.get(category), name, price, prep]
      );
    }
    for (const [t] of planned.supersede) {
      await db.query(
        `UPDATE tests SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [t.id]
      );
    }
    for (const j of junk) {
      await db.query(`DELETE FROM tests WHERE id = $1`, [j.id]);
    }

    // Packages, after the tests exist so every component resolves.
    const { rows: allTests } = await db.query(`SELECT id, name FROM tests`);
    const testId = new Map(allTests.map((t) => [t.name.toLowerCase(), t.id]));

    for (const [code, name, price, items] of PACKAGES) {
      const ids = items.map((n) => {
        const id = testId.get(n.toLowerCase());
        if (!id) throw new Error(`Package ${code}: no test row named "${n}".`);
        return id;
      });

      const { rows: [pkg] } = await db.query(
        `INSERT INTO test_packages (code, name, price, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, price = EXCLUDED.price, is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [code, name, price]
      );

      // Replace the membership wholesale: the sheet is the source of truth, and a component
      // quietly left behind from a previous run would be billed inside a fixed price forever.
      await db.query(`DELETE FROM test_package_items WHERE package_id = $1`, [pkg.id]);
      for (const id of ids) {
        await db.query(
          `INSERT INTO test_package_items (package_id, test_id) VALUES ($1, $2)`,
          [pkg.id, id]
        );
      }
    }
  });

  const { rows: after } = await db.query(
    `SELECT tc.name AS category, COUNT(*)::int AS n
       FROM tests t JOIN test_categories tc ON tc.id = t.category_id
      WHERE t.is_active GROUP BY tc.name ORDER BY tc.name`
  );
  const { rows: pkgCount } = await db.query(`SELECT COUNT(*)::int AS n FROM test_packages WHERE is_active`);
  logger.info('Done.');
  after.forEach((r) => console.log(`  ${r.category.padEnd(12)} ${String(r.n).padStart(3)} active service(s)`));
  console.log(`  ${'Packages'.padEnd(12)} ${String(pkgCount[0].n).padStart(3)} active`);

  console.log('\nSTILL NEEDED FROM THE CLINIC:');
  console.log('  * The handwriting beside the package panel is a list of INDIVIDUAL prices, not a');
  console.log('    breakdown of Package E — confirmed by the clinic. Package E keeps its printed');
  console.log('    2050. Two of the three are still open:');
  console.log('      - "TVS-300" contradicts the 2025 ultrasound sheet, which prints');
  console.log('        Trans-vaginal (TVS) at 700. The PRINTED 700 was loaded. Which is current?');
  console.log('      - "PB-1,200" is an abbreviation this repo cannot resolve. Nothing loaded.');
  console.log('    ("HIV 500" is the third, and is loaded.)');
  console.log('  * The three deactivated demo services listed above — re-enable with a real price');
  console.log('    if the clinic does offer them.');
  console.log('  * "FOOT APL / APOL-200 ... 400/200 = 600" is handwritten on the X-ray sheet.');
  console.log('    Loaded as Foot APL 400. If the oblique view is a separate sellable line, say so.');
  console.log('  * "CHEST PAL" and "CHEST APL" are both printed at 500 and look like the same view.');
  console.log('    Both loaded as printed — confirm whether one should go.');
  console.log('  * Package C reads "FBS/RBS"; FBS was carried (both are 190).');
  console.log('  * ECG is DEACTIVATED — the clinic does not offer it. 2D Echo was removed');
  console.log('    categories remain so historical results can still say what they were.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Catalogue seed failed: ${err.message}`);
  process.exit(1);
});
