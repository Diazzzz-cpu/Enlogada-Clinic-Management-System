/**
 * The clinic's LABORATORY result forms, transcribed from their own workbook. [1.52.0]
 *
 * Every label, unit, section and reference range below is what the clinic's `RESULT FORM` workbook
 * prints. Nothing is invented, and where the workbook contradicts itself the conflict is recorded
 * in a comment rather than silently resolved — see the block at the end of this file for the ones
 * that still need the clinic's answer.
 *
 * ── Why almost everything is `text` and not `number` ─────────────────────────────────────────
 *
 * The RESULT column of a laboratory form carries `YELLOW`, `NEGATIVE`, `FEW`, `0-2` and `1.010` in
 * the same column, often on the same form. A numeric input would refuse three of those five. Only
 * fields that are numeric on every observed sheet are `number`; everything else is `text`, which
 * is what the clinic actually writes.
 */

// `S` marks the section a field prints under; null means it prints ungrouped.
const LAB_FIELD_SETS = [
  // ── CLINICAL MICROSCOPY ────────────────────────────────────────────────────────────────────
  {
    code: 'urinalysis', name: 'Urinalysis', discipline: 'CLINICAL MICROSCOPY',
    tests: ['Urinalysis'],
    fields: [
      { code: 'specimen', label: 'Specimen', kind: 'text' },
      { code: 'color', label: 'Color', kind: 'text', section: 'Macroscopic:' },
      { code: 'appearance', label: 'Appearance', kind: 'text', section: 'Macroscopic:' },
      { code: 'glucose', label: 'Glucose', kind: 'text', section: 'Chemical:' },
      { code: 'protein', label: 'Protein', kind: 'text', section: 'Chemical:' },
      { code: 'ph', label: 'pH', kind: 'text', section: 'Chemical:' },
      { code: 'specific_gravity', label: 'Specific Gravity', kind: 'text', section: 'Chemical:' },
      { code: 'wbc', label: 'WBC', kind: 'text', unit: '/HPF', note: '0.0-5.0', section: 'Microscopic:' },
      { code: 'rbc', label: 'RBC', kind: 'text', unit: '/HPF', note: '0.0-2.0', section: 'Microscopic:' },
      { code: 'epithelial_cells', label: 'Epithelial Cells', kind: 'text', section: 'Microscopic:' },
      // The workbook prints these three with a double space inside the label. Seeded cleaned:
      // they are the only labels in 38 sheets with one, so it is a typing artefact, not a style.
      { code: 'mucous_threads', label: 'Mucous Threads', kind: 'text', section: 'Microscopic:' },
      { code: 'amorphous_urates', label: 'Amorphous Urates', kind: 'text', section: 'Microscopic:' },
      { code: 'bacteria', label: 'Bacteria', kind: 'text', section: 'Microscopic:' },
      { code: 'amorphous_phosphates', label: 'Amorphous Phosphates', kind: 'text', section: 'Microscopic:' },
    ],
  },
  {
    // The clinic's sheet is titled FECALYSIS and has NO reference-range column at all — the only
    // sheet in the workbook without one. Every note below is therefore null, deliberately.
    code: 'fecalysis', name: 'Fecalysis', discipline: 'CLINICAL MICROSCOPY',
    tests: ['Stool Exam'],
    fields: [
      { code: 'color', label: 'Color', kind: 'text', section: 'Macroscopic:' },
      { code: 'consistency', label: 'Consistency', kind: 'text', section: 'Macroscopic:' },
      { code: 'wbc', label: 'WBC', kind: 'text', unit: '/HPF', section: 'Microscopic:' },
      { code: 'rbc', label: 'RBC', kind: 'text', unit: '/HPF', section: 'Microscopic:' },
      { code: 'fat_globules', label: 'Fat Globules', kind: 'text', section: 'Microscopic:' },
      { code: 'ova_of_parasites', label: 'Ova of Parasites', kind: 'text', unit: '/HPF', section: 'Microscopic:' },
      { code: 'amoeba', label: 'Amoeba', kind: 'text', section: 'Microscopic:' },
      { code: 'others', label: 'Others', kind: 'text', section: 'Microscopic:' },
    ],
  },

  // ── HEMATOLOGY ─────────────────────────────────────────────────────────────────────────────
  {
    code: 'cbc', name: 'Complete Blood Count', discipline: 'HEMATOLOGY',
    tests: ['Complete Blood Count (CBC)'],
    fields: [
      { code: 'wbc', label: 'WBC', kind: 'number', unit: 'x10^9/L', note: '5.0-10.0' },
      { code: 'rbc', label: 'RBC', kind: 'number', unit: 'x10^12/L', note: '3.69-5.90' },
      // Sex-conditional ranges print BOTH halves, exactly as the clinic's form does. One field,
      // not two: the technician records one haemoglobin value, and the patient's sex decides only
      // which half of the printed range the reader applies. Splitting it into two fields would ask
      // for the same measurement twice.
      { code: 'hemoglobin', label: 'Hemoglobin', kind: 'number', unit: 'g/dl', note: 'Male: 13.7-16.7 / Female: 11.7-14.5' },
      { code: 'hematocrit', label: 'Hematocrit', kind: 'number', unit: '%', note: 'Male: 40.0-49.7 / Female: 34.2-44.2' },
      { code: 'mcv', label: 'MCV', kind: 'number', unit: 'fL', note: '70.0-97.0' },
      { code: 'mch', label: 'MCH', kind: 'number', unit: 'pg', note: '26.10-33.30' },
      { code: 'mchc', label: 'MCHC', kind: 'number', unit: 'g/dl', note: '32.0-35.0' },
      { code: 'platelet_count', label: 'Platelet Count', kind: 'number', unit: 'x10^9/L', note: '150.0-390.0' },
      { code: 'neutrophils', label: 'Neutrophils', kind: 'number', unit: '%', note: '55.0-62.0', section: 'Differential Count' },
      { code: 'lymphocytes', label: 'Lymphocytes', kind: 'number', unit: '%', note: '20.0-40.0', section: 'Differential Count' },
      { code: 'monocytes', label: 'Monocytes', kind: 'number', unit: '%', note: '4.0-10.0', section: 'Differential Count' },
      { code: 'eosinophils', label: 'Eosinophils', kind: 'number', unit: '%', note: '1.0-6.0', section: 'Differential Count' },
      { code: 'basophils', label: 'Basophils', kind: 'number', unit: '%', note: '0.0-1.0', section: 'Differential Count' },
      // Ungrouped on purpose. It prints two rows BELOW the differential block with a blank row
      // between, and it is not a differential parameter. A "section owns everything until the next
      // section" rule would file it under Differential Count on every CBC the clinic issues.
      { code: 'rdw_cv', label: 'RDW-CV', kind: 'number', unit: '%', note: '11.50-14.50' },
    ],
  },
  {
    code: 'ct_bt', caption: 'Examiner', signatureMode: 'electronic', name: 'Clotting Time / Bleeding Time', discipline: 'HEMATOLOGY',
    tests: ['Clotting Time / Bleeding Time (CT BT)'],
    fields: [
      // `text`, because the clinic writes the result as a phrase — minutes AND seconds — not a
      // number. A numeric field would refuse what they actually record.
      { code: 'clotting_time', label: 'Clotting Time ( CT )', kind: 'text', note: '4 - 7 Minutes' },
      { code: 'bleeding_time', label: 'Bleeding Time ( BT )', kind: 'text', note: '1 - 3 Minutes' },
    ],
  },

  // ── CLINICAL CHEMISTRY ─────────────────────────────────────────────────────────────────────
  {
    code: 'sgpt', name: 'SGPT', discipline: 'CLINICAL CHEMISTRY', tests: ['SGPT'],
    fields: [{ code: 'sgpt_alt', label: 'SGPT/ALT', kind: 'number', unit: 'U/L', note: '0.0 - 41.0' }],
  },
  {
    code: 'creatinine', name: 'Creatinine', discipline: 'CLINICAL CHEMISTRY', tests: ['Creatinine'],
    fields: [
      { code: 'creatinine', label: 'Creatinine', kind: 'number', unit: 'mg/dL', note: 'Male: 0.6-1.2 / Female: 0.5-1.0' },
    ],
  },
  {
    code: 'bua', caption: 'Examiner', name: 'Blood Uric Acid', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Blood Uric Acid (BUA)'],
    fields: [
      { code: 'bua', label: 'B U A', kind: 'number', unit: 'mg/dL', note: 'Male: 3.4-7.0 / Female: 2.4-5.7' },
    ],
  },
  {
    code: 'bun', name: 'Blood Urea Nitrogen', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Blood Urea Nitrogen (BUN)'],
    // The only standalone BUN sheet is captioned ( POST ), a post-loading variant. The catalogue
    // test is plain BUN, so the plain analyte is seeded from the two combined chemistry panels,
    // which both print 4.7-23.0. The ( POST ) caption is NOT carried — see the open questions.
    fields: [{ code: 'bun', label: 'Blood Urea Nitrogen', kind: 'number', unit: 'mg/dL', note: '4.7 - 23.0' }],
  },
  {
    code: 'fbs', name: 'Fasting Blood Sugar', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Fasting Blood Sugar (FBS)'],
    // CONFLICT, unresolved: the standalone forms print 70.0 - 100.0 and the two combined chemistry
    // panels print 70.0-99.0, for the same analyte. Seeded from the STANDALONE form because that
    // is the form this catalogue test corresponds to. The clinic must settle which is correct.
    fields: [{ code: 'fbs', label: 'F B S', kind: 'number', unit: 'mg/dL', note: '70.0 - 100.0' }],
  },
  {
    code: 'rbs', name: 'Random Blood Sugar', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Random Blood Sugar (RBS)'],
    fields: [{ code: 'rbs', label: 'R B S', kind: 'number', unit: 'mg/dL', note: '60.0 - 120.0' }],
  },
  {
    code: 'hba1c', name: 'HbA1c', discipline: 'CLINICAL CHEMISTRY', tests: ['HbA1c'],
    fields: [{ code: 'hba1c', label: 'HbA1c', kind: 'number', unit: '%', note: '4.5-6.0' }],
  },
  {
    code: 'cholesterol', name: 'Cholesterol', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Cholesterol only'],
    fields: [{ code: 'cholesterol', label: 'Cholesterol', kind: 'number', unit: 'mg/dL', note: '<240.0' }],
  },
  {
    code: 'lipid_profile', name: 'Lipid Profile', discipline: 'CLINICAL CHEMISTRY',
    tests: ['Lipid Profile'],
    fields: [
      { code: 'cholesterol', label: 'Cholesterol', kind: 'number', unit: 'mg/dL', note: '<240.0', section: 'LIPID PROFILE' },
      { code: 'triglycerides', label: 'Triglycerides', kind: 'number', unit: 'mg/dL', note: '<200.0', section: 'LIPID PROFILE' },
      { code: 'hdl', label: 'HDL', kind: 'number', unit: 'mg/dL', note: '30.0 - 85.0', section: 'LIPID PROFILE' },
      { code: 'ldl', label: 'LDL', kind: 'number', unit: 'mg/dL', note: '<150.0', section: 'LIPID PROFILE' },
      { code: 'vldl', label: 'VLDL', kind: 'number', unit: 'mg/dL', note: '0.0 - 40.0', section: 'LIPID PROFILE' },
      // No unit and no range on either source sheet. Typed by the clinic, not computed — the
      // workbook contains no formulas at all.
      { code: 'chol_hdl_ratio', label: 'Chol/HDL Ratio', kind: 'number', section: 'LIPID PROFILE' },
    ],
  },
  {
    code: 'ogtt_75', caption: 'Examiner', name: 'OGTT 75 grams', discipline: 'CLINICAL CHEMISTRY', tests: ['OGTT 75g'],
    // Seeded from the PLAIN form. The clinic keeps a second OGTT 75g sheet whose reference column
    // is captioned GESTATIONAL DIABETES and whose values are diagnostic THRESHOLDS with the
    // opposite polarity — above the number is positive. Merging the two would print a normal range
    // where a cut-off belongs. The gestational form needs its own catalogue test; see below.
    fields: [
      { code: 'fbs', label: 'FBS', kind: 'number', unit: 'mg/dl', note: '70.0 - 100.0' },
      { code: 'first_hour', label: 'FIRST HOUR', kind: 'number', unit: 'mg/dl' },
      { code: 'second_hour', label: 'SECOND HOUR', kind: 'number', unit: 'mg/dl' },
    ],
  },
  {
    code: 'thyroid_tsh', name: 'TSH', discipline: 'CLINICAL CHEMISTRY', tests: ['TSH'],
    // The workbook prints `miu/L`. Seeded as `mIU/L`, the SI form — see the units note below.
    fields: [{ code: 'tsh', label: 'T S H', kind: 'number', unit: 'mIU/L', note: '0.3 - 4.2' }],
  },
  {
    code: 'thyroid_t3', name: 'T3', discipline: 'CLINICAL CHEMISTRY', tests: ['T3'],
    fields: [{ code: 't3', label: 'T3', kind: 'number', unit: 'nmol/L', note: '1.23 - 3.07' }],
  },
  {
    code: 'thyroid_t4', name: 'T4', discipline: 'CLINICAL CHEMISTRY', tests: ['T4'],
    fields: [{ code: 't4', label: 'T4', kind: 'number', unit: 'nmol/L', note: '66.0 - 181.0' }],
  },
  {
    code: 'thyroid_ft3', name: 'FT3', discipline: 'CLINICAL CHEMISTRY', tests: ['FT3'],
    fields: [{ code: 'ft3', label: 'FT3', kind: 'number', unit: 'pmol/L', note: '2.8 - 7.1' }],
  },
  {
    code: 'thyroid_ft4', name: 'FT4', discipline: 'CLINICAL CHEMISTRY', tests: ['FT4'],
    fields: [{ code: 'ft4', label: 'FT4', kind: 'number', unit: 'pmol/L', note: '12.0 - 22.0' }],
  },

  // ── SEROLOGY / IMMUNOLOGY ──────────────────────────────────────────────────────────────────
  {
    code: 'hepatitis_b', caption: 'Examiner', name: 'Hepatitis B Screening', discipline: 'SEROLOGY/IMMUNOLOGY',
    tests: ['Hepatitis B Screening'],
    fields: [{ code: 'hbsag_screening', label: 'HBsAg Screening', kind: 'text' }],
  },
  {
    code: 'vdrl', name: 'VDRL / Syphilis', discipline: 'SEROLOGY/IMMUNOLOGY',
    tests: ['VDRL / Syphilis'],
    fields: [{ code: 'syphilis_vdrl', label: 'Syphilis/VDRL', kind: 'text' }],
  },
  {
    // Filed under Serology by the clinic, not Hematology. Their form, their filing.
    code: 'blood_typing', caption: 'Examiner', name: 'Blood Typing', discipline: 'SEROLOGY/IMMUNOLOGY',
    tests: ['Blood Typing'],
    fields: [{ code: 'blood_type', label: 'Blood Type', kind: 'text' }],
  },
  {
    // INFERRED, not transcribed — the workbook has no HIV sheet.
    //
    // Its three siblings do, and are identical in shape: HBsAg Screening, VDRL/Syphilis and
    // Anti-HCV Screening are each ONE Serology row carrying a text result of "REACTIVE" or
    // "NON-REACTIVE", with no unit and no reference range. HIV takes that shape.
    //
    // Marked inferred so nobody later reads it as transcribed and "corrects" a real form to match
    // it. Until now HIV Screening was the one active laboratory test with NO field set, so it
    // printed as bare prose with no TEST/RESULT/UNIT/RANGE table at all — the defect that prompted
    // this work.
    code: 'hiv_screening', caption: 'Examiner', name: 'HIV Screening', discipline: 'SEROLOGY/IMMUNOLOGY',
    tests: ['HIV Screening'],
    fields: [{ code: 'hiv_screening', label: 'HIV Screening', kind: 'text' }],
  },
];

/**
 * Who signs a report, by category. Transcribed from the clinic's forms — 36 of 38 sheets carry
 * exactly this pair, and the photograph of their current Urinalysis confirms both names, both role
 * captions and both licence numbers.
 *
 * The radiologist carries NO licence number, because 1,113 archived ultrasound reports contain
 * none. That blank prints nothing rather than a plausible-looking number.
 */
const SIGNATORIES = [
  { category: 'Laboratory', name: 'FLORENCE MEA D. ENLOGADA, RMT', caption: 'Medical Technologist', prc: '0142853', order: 1 },
  { category: 'Laboratory', name: 'DR. GERARD L. LAMAYRA, MD FPSP, MHM, MBA', caption: 'Pathologist', prc: '0083764', order: 2 },
  { category: 'Ultrasound', name: 'RENATO M. RIVERA JR., M.D.', caption: 'RADIOLOGIST/SONOLOGIST', prc: null, order: 1 },
];

module.exports = { LAB_FIELD_SETS, SIGNATORIES };
