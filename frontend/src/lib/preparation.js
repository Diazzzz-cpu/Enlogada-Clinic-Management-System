/**
 * What a patient must do before a test, composed rather than retyped. [1.54.0]
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 *
 * `tests.preparation` was a free-text box, and free text drifts. Measured on the clinic's own
 * catalogue: 61 active services, 16 carrying preparation, and among those 16 only FOUR distinct
 * sentences — two of which say the same thing in different words:
 *
 *     "Drink 3–4 glasses of water an hour before your appointment and do not empty your bladder."
 *        → Chest Ultrasound, Thyroid
 *     "Drink 3–4 glasses of water an hour before and do not empty your bladder."
 *        → KUB / Prostate, Lower Abdomen, Pelvic Ultrasound
 *
 * That is not a tidiness problem. The booking wizard de-duplicates preparation by TEST ID, not by
 * sentence, so a patient booking a Pelvic Ultrasound and a Thyroid scan together is shown both
 * lines — one instruction, printed twice, worded differently. A reader has to work out whether
 * they are being asked to do one thing or two.
 *
 * ── Composed, but stored as a sentence ──────────────────────────────────────────────────────
 *
 * The toggles produce text and the text is what goes in the column. No migration, and everything
 * downstream keeps working untouched: sendAppointmentReminders.js carries this string, the
 * confirmation email prints it, the booking wizard shows it. A structured column would have meant
 * teaching all three to render it, for no gain the patient can see.
 *
 * `parsePreparation` reads a stored sentence back into toggles so editing a test does not start
 * from blank. Anything it does not recognise is preserved verbatim in the free-text field — which
 * is the honest outcome: the clinic wrote something specific and it must not be silently dropped.
 */

/**
 * The requirements a diagnostic clinic actually asks for.
 *
 * Each owns its own sentence, so the wording is decided once. `build` takes the field's value
 * where one applies — fasting hours differ by test, everything else does not.
 */
export const PREPARATION_RULES = [
  {
    id: 'fasting',
    label: 'Fasting required',
    hint: 'Blood sugar, lipids, and most chemistry panels.',
    field: { key: 'hours', label: 'Hours', type: 'number', min: 1, max: 24, default: 8 },
    build: ({ hours }) =>
      `Nothing to eat or drink except water for ${hours || 8} hours before your appointment.`,
    // Matches either wording the catalogue already contains, and captures the hours.
    match: (text) => {
      const m = text.match(/nothing to eat or drink except water for (\d+) hours?/i);
      return m ? { hours: Number(m[1]) } : null;
    },
  },
  {
    id: 'fullBladder',
    label: 'Full bladder needed',
    hint: 'Pelvic, lower abdomen, KUB and prostate scans.',
    build: () =>
      'Drink 3–4 glasses of water an hour before your appointment and do not empty your bladder.',
    // Deliberately loose: it must recognise BOTH wordings already in the catalogue, so editing
    // either one ticks this box rather than leaving it as unrecognised free text.
    match: (text) => (/do not empty your bladder/i.test(text) ? {} : null),
  },
  {
    id: 'pregnancy',
    label: 'Ask about pregnancy',
    hint: 'Any X-ray. Radiation is the reason, so this one is not optional.',
    build: () => 'Please tell us before the scan if you are or might be pregnant.',
    match: (text) => (/might be pregnant/i.test(text) ? {} : null),
  },
  {
    id: 'noJewellery',
    label: 'No jewellery or metal',
    hint: 'X-ray and anything imaging the chest or neck.',
    build: () => 'Leave jewellery and metal items at home, or be ready to remove them.',
    match: (text) => (/jewellery/i.test(text) ? {} : null),
  },
  {
    id: 'bringPrevious',
    label: 'Bring previous results',
    hint: 'Follow-up scans, where the comparison is the point.',
    build: () => 'Bring any previous results or films for this area, and your referral letter.',
    match: (text) => (/previous results/i.test(text) ? {} : null),
  },
  {
    id: 'looseClothing',
    label: 'Loose clothing',
    hint: 'Anything needing access to the chest or abdomen.',
    build: () => 'Wear loose clothing that is easy to change out of.',
    match: (text) => (/loose clothing/i.test(text) ? {} : null),
  },
];

const byId = new Map(PREPARATION_RULES.map((r) => [r.id, r]));

/**
 * Turn the chosen rules and any free text into the sentence stored on the test.
 *
 * Rules first and in declaration order, so two tests carrying the same requirements produce
 * byte-identical text — which is what makes the wizard's de-duplication work. Free text last,
 * because it is the exception to everything above it.
 */
export function composePreparation(selected = {}, freeText = '') {
  const sentences = PREPARATION_RULES
    .filter((rule) => selected[rule.id])
    .map((rule) => rule.build(selected[rule.id] === true ? {} : selected[rule.id]));

  const extra = (freeText || '').trim();
  if (extra) sentences.push(extra);

  return sentences.join(' ');
}

/**
 * Read a stored sentence back into toggles plus whatever was not recognised.
 *
 * Recognised fragments are REMOVED from the remainder, so a test carrying only known rules edits
 * with an empty free-text box rather than showing the reader their own sentence twice — once as
 * ticked boxes and again as text they would then have to delete by hand.
 */
export function parsePreparation(text = '') {
  const source = (text || '').trim();
  if (!source) return { selected: {}, freeText: '' };

  const selected = {};
  let remainder = source;

  for (const rule of PREPARATION_RULES) {
    const hit = rule.match(remainder);
    if (!hit) continue;
    selected[rule.id] = rule.field ? hit : true;

    // Strip the sentence this rule owns. Split on sentence ends rather than matching the exact
    // stored string: the catalogue holds two wordings of the bladder rule, and only one of them
    // is what `build` would have produced.
    remainder = remainder
      .split(/(?<=\.)\s+/)
      .filter((sentence) => !rule.match(sentence))
      .join(' ');
  }

  return { selected, freeText: remainder.trim() };
}

/** The rule definition for an id, for a caller rendering one row. */
export const preparationRule = (id) => byId.get(id);
