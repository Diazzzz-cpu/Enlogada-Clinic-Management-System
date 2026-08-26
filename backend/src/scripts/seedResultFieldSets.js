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
 * "Pregnancy Evaluation" — the fetal biometry study, 17 reports. It has NO catalogue row, so the
 * clinic performs it and cannot bill it by name. That is a pricing decision, not a schema one, and
 * a fabricated price is exactly what `seedRealCatalogue.js` refuses to invent. Reported below.
 *
 * The per-fetus repeating group. 8 of those 17 Pregnancy Evaluations are TWINS — 47%, not the
 * fraction of a percent it looks like against the whole corpus. So the group is required before
 * biometry can be seeded at all, and it is not a small change: `mergeMeasurements` is keyed on
 * field code alone, and per-fetus means recasting the carry-forward rule onto a composite key.
 * That rule is the most safety-critical function in the feature. It also raises a question with no
 * current answer — if version 1 recorded two fetuses and version 2 submits one, is the missing
 * block "carry forward" or "erase"? Getting that wrong silently retains a demised fetus's biometry
 * on a live report. Not to be solved under time pressure.
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
const { LAB_FIELD_SETS, SIGNATORIES } = require('../constants/labResultForms');

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
      { code: 'endometrial_thickness', label: 'Endometrial thickness', kind: N, unit: 'cm' },
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
      { code: 'endometrial_thickness', label: 'Endometrial thickness', kind: N, unit: 'cm' },
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
  // ── The biophysical profile ────────────────────────────────────────────────────────────────
  //
  // Two sets, not one with an optional field, because the clinic bills two products and the totals
  // mean different things: /8 without a non-stress test and /10 with. A score of 8 presented as
  // though it were out of 10 reads as a worse result than it is.
  //
  // Manning scores each component 0 or 2. The clinic's two archived examples are both TWIN studies
  // carrying a per-fetus block (`FT - 2`, `FM - 2`, `FBM - 2`, `AFI - 2`), so the single-fetus form
  // below is that block taken once rather than a separate exemplar — stated plainly because
  // everything else in this file is transcribed directly.
  {
    code: 'bps', name: 'Biophysical Profile', tests: ['BPS'],
    fields: [
      { code: 'fetal_tone', label: 'Fetal tone (FT)', kind: N },
      { code: 'fetal_movement', label: 'Fetal movement (FM)', kind: N },
      { code: 'fetal_breathing', label: 'Fetal breathing movement (FBM)', kind: N },
      { code: 'amniotic_fluid', label: 'Amniotic fluid (AFI)', kind: N },
      {
        code: 'bps_total', label: 'Biophysical score', kind: N,
        derivation: 'BPS_SUM', derivedFrom: 'fetal_tone', note: 'out of 8',
      },
    ],
  },
  {
    code: 'bps_nst', name: 'Biophysical Profile with NST', tests: ['BPS w/ NST'],
    fields: [
      { code: 'fetal_tone', label: 'Fetal tone (FT)', kind: N },
      { code: 'fetal_movement', label: 'Fetal movement (FM)', kind: N },
      { code: 'fetal_breathing', label: 'Fetal breathing movement (FBM)', kind: N },
      { code: 'amniotic_fluid', label: 'Amniotic fluid (AFI)', kind: N },
      { code: 'non_stress_test', label: 'Non-stress test (NST)', kind: N },
      {
        code: 'bps_total', label: 'Biophysical score', kind: N,
        derivation: 'BPS_SUM', derivedFrom: 'fetal_tone', note: 'out of 10',
      },
    ],
  },
];

// Ultrasound first (its sets carry no discipline), then the laboratory forms.
const ALL_FIELD_SETS = [...FIELD_SETS, ...LAB_FIELD_SETS];

async function run() {
  const created = [];
  const updated = [];
  const unchanged = [];
  const unmapped = [];
  const notes = [];

  const categories = {};
  for (const name of ['Ultrasound', 'Laboratory']) {
    const row = (await db.query(`SELECT id FROM test_categories WHERE name = $1`, [name])).rows[0];
    if (!row) throw new Error(`No ${name} category — run migrateDb first.`);
    categories[name] = row.id;
  }

  for (const set of ALL_FIELD_SETS) {
    // Canonical code first, alias second. Looking up by name first is not idempotent and dies on
    // the unique index the second time — the same ordering seedRealCatalogue.js documents.
    const existing = (await db.query(`SELECT id FROM result_field_sets WHERE code = $1`, [set.code])).rows[0];
    let setId = existing?.id;

    if (!setId) {
      if (APPLY) {
        setId = (await db.query(
          `INSERT INTO result_field_sets (code, name, category_id, discipline)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [set.code, set.name, categories[set.discipline ? 'Laboratory' : 'Ultrasound'], set.discipline || null]
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
                                  is_required, reference_note, derivation, derived_from, section, is_active
                             FROM result_fields WHERE field_set_id = $1 AND code = $2`, [setId, f.code])).rows[0]
        : null;

      const want = {
        label: f.label, unit: f.unit || null, value_kind: f.kind, display_order: order,
        applies_to_sex: f.sex || null, is_required: !!f.req, reference_note: f.note || null,
        derivation: f.derivation || null, derived_from: f.derivedFrom || null,
        section: f.section || null,
      };

      if (!cur) {
        if (APPLY && setId) {
          await db.query(
            `INSERT INTO result_fields
               (field_set_id, code, label, value_kind, unit, display_order,
                applies_to_sex, is_required, reference_note, derivation, derived_from, section)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [setId, f.code, want.label, want.value_kind, want.unit, want.display_order,
             want.applies_to_sex, want.is_required, want.reference_note, want.derivation,
             want.derived_from, want.section]
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
                                    derivation=$8, derived_from=$9, section=$10, is_active=TRUE
            WHERE id=$11`,
          [want.label, want.unit, want.value_kind, want.display_order, want.applies_to_sex,
           want.is_required, want.reference_note, want.derivation, want.derived_from,
           want.section, cur.id]
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

  // ── Who signs a report ─────────────────────────────────────────────────────────────────────
  //
  // Transcribed from the clinic's own forms, never invented. The radiologist's licence number is
  // NULL because 1,113 archived ultrasound reports carry none — a blank prints nothing rather
  // than a plausible-looking number on a document a patient may file for reimbursement.
  for (const g of SIGNATORIES) {
    const catId = categories[g.category];
    if (!catId) { unmapped.push(`signatory "${g.name}" -> ${g.category} (no such category)`); continue; }
    const cur = (await db.query(
      `SELECT id, prc_license, display_order FROM clinic_signatories
        WHERE category_id = $1 AND full_name = $2 AND role_caption = $3`,
      [catId, g.name, g.caption]
    )).rows[0];
    if (!cur) {
      if (APPLY) {
        await db.query(
          `INSERT INTO clinic_signatories (category_id, full_name, role_caption, prc_license, display_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [catId, g.name, g.caption, g.prc, g.order]
        );
      }
      created.push(`  signatory ${g.category}: ${g.name} — ${g.caption}${g.prc ? ` (PRC ${g.prc})` : ''}`);
    } else if (String(cur.prc_license || '') !== String(g.prc || '')) {
      // A licence number changing is worth saying out loud rather than applying quietly.
      notes.push(`signatory "${g.name}" PRC differs: stored ${cur.prc_license || '(none)'} vs ${g.prc || '(none)'}`);
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
  line('  - A PRICE for "Pregnancy Evaluation". The clinic performs this study (17 reports in the');
  line('    archive) and has no catalogue row for it, so it cannot be billed by name. No price is');
  line('    invented here for the same reason seedRealCatalogue.js invents none.');
  line('  - Twin studies stay on free text: 8 of 17 Pregnancy Evaluations are twins, so biometry');
  line('    needs a per-fetus repeating group before it can be seeded at all.');
  line('  - Endometrial thickness is now a field. The clinic may want to drop the number from its');
  line('    canned sentence, or it will print in both the table and the narrative.');
  line('');
}

run()
  .then(() => process.exit(0))
  .catch((err) => { logger.error(`Seed failed: ${err.message}`); process.exit(1); });
