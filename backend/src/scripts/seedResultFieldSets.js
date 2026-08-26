/**
 * Load the Ultrasound field sets. [1.50.0]
 *
 * Dry-run by default; `--confirm` writes. Same shape as `seedRealCatalogue.js`, and for the same
 * reason: this is content transcribed from the clinic's own documents, so anything ambiguous is
 * REPORTED rather than guessed at. A fabricated price is money taken on the strength of a made-up
 * number; a fabricated reference range or organ measurement is worse.
 *
 * ── Where every field below comes from ───────────────────────────────────────────────────────
 *
 * The clinic's archive of 1,113 real ultrasound reports. Nothing here is invented, and nothing is
 * included that does not appear in a real report. Presence rates are quoted per field so the next
 * reader can see which are genuinely optional rather than guessing from the absence of a NOT NULL.
 *
 * The corpus spells the same organ several ways — `Right Kidney` 402 times, `R Kidney` 228,
 * `Rt. Kidney` 47 — and the `Examination:` line has 154 distinct spellings collapsing to ~26 real
 * studies, including four for "transvaginal" and a `PELVGIC`. The canonical `label` here is what
 * ends that drift: it is what gets printed, so there is one spelling from the day this runs.
 *
 * ── Two things deliberately NOT seeded ───────────────────────────────────────────────────────
 *
 * TVS endometrial thickness. It is a real measurement, present in 179 reports — but it lives
 * inside a prose sentence, never in the Measurements block. Promoting it would change what the
 * printed report looks like, which is a decision for the clinic rather than for this script.
 *
 * The obstetric/biometry set (BPS, "Pregnancy Evaluation", n=30). It is the only study needing a
 * per-fetus repeating group — a twin report duplicates the whole column block — and it is 2.7% of
 * the corpus. The nine flat studies below cover roughly 90% of their ultrasound work with none of
 * that complexity. BPS keeps the free-text path it has today, so nothing regresses; it becomes a
 * seed-data change once the repeating group is built.
 *
 * ── Fields are deactivated, never deleted ────────────────────────────────────────────────────
 *
 * `seedRealCatalogue.js` replaces `test_package_items` wholesale with a DELETE, because a stale
 * component would be billed forever. That is not available here: `result_measurements.field_id`
 * references these rows, so deleting one would take recorded clinical values with it. This script
 * refuses to touch any field that has measurements against it.
 */
const db = require('../config/database');
const logger = require('../config/logger');

const APPLY = process.argv.includes('--confirm');

// N = number (one value), L3 = an L x W x H triple.
const N = 'number';
const L3 = 'linear3';

/**
 * `req` is the presence rate observed in the corpus, recorded so the next reader knows which
 * fields are genuinely optional. Only fields at 100% are marked required, and even then it is
 * advisory — nothing at the value level is NOT NULL.
 */
const LIVER = [
  { code: 'right_liver_lobe', label: 'Right Liver Lobe', kind: N, unit: 'cm', req: true },
  { code: 'left_liver_lobe', label: 'Left Liver Lobe', kind: N, unit: 'cm', req: true },
];
const GB_SPLEEN = [
  { code: 'gallbladder', label: 'Gallbladder', kind: L3, unit: 'cm' },
  { code: 'spleen', label: 'Spleen', kind: N, unit: 'cm' },
];
const KIDNEYS = [
  { code: 'right_kidney', label: 'Right Kidney', kind: L3, unit: 'cm' },
  { code: 'right_kidney_ct', label: 'Right Kidney CT', kind: N, unit: 'cm' },
  { code: 'left_kidney', label: 'Left Kidney', kind: L3, unit: 'cm' },
  { code: 'left_kidney_ct', label: 'Left Kidney CT', kind: N, unit: 'cm' },
];
// The prostate's weight is the one derived value in the flat studies. `N.V. = 5.0 - 25.0 gms` is
// printed beside it on the clinic's own form — a static annotation, not a range this system
// evaluates anything against.
const PROSTATE = [
  { code: 'prostate_gland', label: 'Prostate Gland', kind: L3, unit: 'cm', sex: 'Male' },
  {
    code: 'prostate_weight', label: 'Prostate weight', kind: N, unit: 'g', sex: 'Male',
    derivation: 'ELLIPSOID_VOLUME', derivedFrom: 'prostate_gland',
    note: 'N.V. = 5.0 - 25.0 gms',
  },
];
const UB = [
  { code: 'ub_prevoid_volume', label: 'UB Prevoid volume', kind: N, unit: 'cc' },
  { code: 'ub_postvoid_volume', label: 'UB Postvoid volume', kind: N, unit: 'cc' },
];
// Uterus and cervix are the gyn pair. On Whole/Lower Abdomen they are the FEMALE branch of the
// same slot the prostate occupies for men: of 405 whole abdomens, 194 carried a prostate, 193 a
// uterus, and none carried both.
const GYN = [
  { code: 'uterus', label: 'Uterus', kind: L3, unit: 'cm', sex: 'Female' },
  { code: 'cervix', label: 'Cervix', kind: L3, unit: 'cm', sex: 'Female' },
];

const FIELD_SETS = [
  {
    code: 'hbt', name: 'Hepatobiliary Tree', tests: ['HBT'],
    // The most rigid schema in the corpus: 4 fields, all at 96-100% across 23 reports, no kidneys.
    fields: [...LIVER, ...GB_SPLEEN],
  },
  {
    code: 'liver', name: 'Liver', tests: ['Liver / Biliary Tree'],
    fields: [...LIVER],
  },
  {
    code: 'upper_abdomen', name: 'Upper Abdomen', tests: ['Upper Abdomen'],
    // Whole Abdomen minus the pelvic organ. All six core fields at 100% across 30 reports.
    fields: [...LIVER, ...GB_SPLEEN, ...KIDNEYS],
  },
  {
    code: 'whole_abdomen', name: 'Whole Abdomen', tests: ['Whole Abdomen'],
    fields: [...LIVER, ...GB_SPLEEN, ...KIDNEYS, ...PROSTATE, GYN[0]],
  },
  {
    code: 'lower_abdomen', name: 'Lower Abdomen', tests: ['Lower Abdomen'],
    fields: [...KIDNEYS, ...GYN, PROSTATE[0], PROSTATE[1]],
  },
  {
    code: 'kub_prostate', name: 'KUB and Prostate', tests: ['KUB / Prostate'],
    // Plain KUB (n=57, kidneys only) is this study performed on a woman — the sex branch on the
    // prostate fields already covers it, so it needs no set of its own.
    fields: [...KIDNEYS, ...PROSTATE, ...UB],
  },
  {
    code: 'thyroid', name: 'Thyroid and Neck', tests: ['Thyroid'],
    // Isthmus is the only field present in 100% of the 48 thyroid reports; the lobes sit at
    // 83-85% because a thyroidectomy leaves none to measure.
    fields: [
      { code: 'right_thyroid_lobe', label: 'Right Thyroid Lobe', kind: L3, unit: 'cm' },
      { code: 'left_thyroid_lobe', label: 'Left Thyroid Lobe', kind: L3, unit: 'cm' },
      { code: 'isthmus', label: 'Isthmus', kind: N, unit: 'cm', req: true },
    ],
  },
  {
    code: 'tvs', name: 'Transvaginal', tests: ['Trans-vaginal (TVS)'],
    // Ovaries are genuinely optional at 31-37%: the canned sentence "the right ovary was not
    // visualized due to intervening gas" is what the report says instead.
    fields: [
      { code: 'uterus', label: 'Uterus', kind: L3, unit: 'cm' },
      { code: 'cervix', label: 'Cervix', kind: L3, unit: 'cm' },
      { code: 'right_ovary', label: 'Right Ovary', kind: L3, unit: 'cm' },
      { code: 'left_ovary', label: 'Left Ovary', kind: L3, unit: 'cm' },
    ],
  },
  {
    code: 'pelvic_gyn', name: 'Pelvic', tests: ['Pelvic Ultrasound'],
    // Same gyn schema as TVS, confirmed against 35 pelvic reports: 69% carry a Measurements
    // block, and its labels are Uterus (22), Cervix (22), Right/Left Ovary.
    fields: [
      { code: 'uterus', label: 'Uterus', kind: L3, unit: 'cm' },
      { code: 'cervix', label: 'Cervix', kind: L3, unit: 'cm' },
      { code: 'right_ovary', label: 'Right Ovary', kind: L3, unit: 'cm' },
      { code: 'left_ovary', label: 'Left Ovary', kind: L3, unit: 'cm' },
    ],
  },
  {
    code: 'scrotum', name: 'Scrotum', tests: ['Scrotum'],
    // Inguino-scrotal (n=13) shares this schema exactly; it has no catalogue row of its own.
    fields: [
      { code: 'right_testis', label: 'Right Testis', kind: L3, unit: 'cm' },
      { code: 'left_testis', label: 'Left Testis', kind: L3, unit: 'cm' },
      { code: 'right_epididymal_head', label: 'Right Epididymal head', kind: N, unit: 'cm' },
      { code: 'left_epididymal_head', label: 'Left Epididymal head', kind: N, unit: 'cm' },
    ],
  },
];

async function run() {
  const created = [];
  const updated = [];
  const unchanged = [];
  const unmapped = [];
  const notes = [];

  const cat = (await db.query(`SELECT id FROM test_categories WHERE name = 'Ultrasound'`)).rows[0];
  if (!cat) throw new Error('No Ultrasound category — run setupRbac/migrateDb first.');

  for (const set of FIELD_SETS) {
    // Canonical code first, alias second. Looking up by name first is not idempotent and dies on
    // the unique index the second time — the same ordering seedRealCatalogue.js documents.
    const existing = (await db.query(`SELECT id FROM result_field_sets WHERE code = $1`, [set.code])).rows[0];
    let setId = existing?.id;

    if (!setId) {
      if (APPLY) {
        setId = (await db.query(
          `INSERT INTO result_field_sets (code, name, category_id) VALUES ($1,$2,$3) RETURNING id`,
          [set.code, set.name, cat.id]
        )).rows[0].id;
      }
      created.push(`${set.code} (${set.fields.length} fields)`);
    } else {
      unchanged.push(set.code);
    }

    // Fields
    let order = 0;
    for (const f of set.fields) {
      order += 1;
      const cur = setId
        ? (await db.query(`SELECT id, label, unit, value_kind, display_order, applies_to_sex,
                                  is_required, reference_note, derivation, derived_from, is_active
                             FROM result_fields WHERE field_set_id = $1 AND code = $2`, [setId, f.code])).rows[0]
        : null;

      const want = {
        label: f.label, unit: f.unit || null, value_kind: f.kind, display_order: order,
        applies_to_sex: f.sex || null, is_required: !!f.req, reference_note: f.note || null,
        derivation: f.derivation || null, derived_from: f.derivedFrom || null,
      };

      if (!cur) {
        if (APPLY && setId) {
          await db.query(
            `INSERT INTO result_fields
               (field_set_id, code, label, value_kind, unit, display_order,
                applies_to_sex, is_required, reference_note, derivation, derived_from)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [setId, f.code, want.label, want.value_kind, want.unit, want.display_order,
             want.applies_to_sex, want.is_required, want.reference_note, want.derivation, want.derived_from]
          );
        }
        created.push(`  ${set.code}.${f.code} — ${f.label}${f.unit ? ` (${f.unit})` : ''}`);
        continue;
      }

      const differs = Object.keys(want).some((k) => String(cur[k] ?? '') !== String(want[k] ?? ''));
      if (!differs) continue;

      // A field carrying recorded values keeps its identity; only its presentation may move.
      const used = (await db.query(
        `SELECT COUNT(*)::int AS n FROM result_measurements WHERE field_id = $1`, [cur.id]
      )).rows[0].n;
      if (used > 0 && cur.value_kind !== want.value_kind) {
        notes.push(`${set.code}.${f.code}: value_kind would change from ${cur.value_kind} to ${want.value_kind}, but ${used} recorded value(s) exist — SKIPPED`);
        continue;
      }
      if (APPLY) {
        await db.query(
          `UPDATE result_fields SET label=$1, unit=$2, value_kind=$3, display_order=$4,
                                    applies_to_sex=$5, is_required=$6, reference_note=$7,
                                    derivation=$8, derived_from=$9, is_active=TRUE
            WHERE id=$10`,
          [want.label, want.unit, want.value_kind, want.display_order, want.applies_to_sex,
           want.is_required, want.reference_note, want.derivation, want.derived_from, cur.id]
        );
      }
      updated.push(`${set.code}.${f.code}`);
    }

    // Map the set onto its catalogue rows.
    for (const testName of set.tests) {
      const t = (await db.query(`SELECT id, name FROM tests WHERE name = $1`, [testName])).rows[0];
      if (!t) { unmapped.push(`${set.code} -> "${testName}" (no such test)`); continue; }
      const map = (await db.query(`SELECT field_set_id FROM result_field_set_tests WHERE test_id = $1`, [t.id])).rows[0];
      if (map) {
        if (setId && map.field_set_id !== setId) {
          notes.push(`"${testName}" is already mapped to a different field set — SKIPPED`);
        }
        continue;
      }
      if (APPLY && setId) {
        await db.query(`INSERT INTO result_field_set_tests (field_set_id, test_id) VALUES ($1,$2)`, [setId, t.id]);
      }
      created.push(`  map "${testName}" -> ${set.code}`);
    }
  }

  const line = (t) => logger.info(t);
  line('');
  line(APPLY ? '=== APPLIED ===' : '=== DRY RUN — nothing written. Re-run with --confirm ===');
  if (created.length) { line(''); line('CREATE:'); created.forEach((c) => line(`  + ${c}`)); }
  if (updated.length) { line(''); line('UPDATE:'); updated.forEach((c) => line(`  ~ ${c}`)); }
  if (unchanged.length) { line(''); line(`ALREADY CORRECT: ${unchanged.join(', ')}`); }
  if (unmapped.length) { line(''); line('COULD NOT MAP:'); unmapped.forEach((c) => line(`  ? ${c}`)); }
  if (notes.length) { line(''); line('NOTES:'); notes.forEach((c) => line(`  ! ${c}`)); }

  line('');
  line('STILL NEEDED FROM THE CLINIC:');
  line('  - X-ray: only 2 real reports exist (both Chest PA) against 24 catalogue tests.');
  line('    Exemplars for the other views are needed before any X-ray field set can be written.');
  line('  - BPS / "Pregnancy Evaluation": confirm they are the same product, and that a per-fetus');
  line('    repeating group is wanted for twin studies. Free text until then.');
  line('  - TVS endometrial thickness is recorded in prose today, not in the Measurements block.');
  line('    Confirm whether the clinic wants it promoted to a field.');
  line('');
}

run()
  .then(() => process.exit(0))
  .catch((err) => { logger.error(`Seed failed: ${err.message}`); process.exit(1); });
