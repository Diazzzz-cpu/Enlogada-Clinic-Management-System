/**
 * The arithmetic an ultrasound report does. One definition, because the clinic currently has none.
 *
 * These three formulas are the ONLY ones evidenced by the clinic's 1,113-report archive, and each
 * was measured against it rather than looked up. That distinction matters: the obvious textbook
 * formula is wrong for one of them.
 *
 * ── Why the system should own this at all ────────────────────────────────────────────────────
 *
 * Because the clinic does it by hand and gets it wrong about 1 time in 20. Measured across 343
 * reports carrying a prostate weight beside its three axes: 94% sit within ±0.01 of the ellipsoid
 * coefficient, and the rest are stale — someone edited the axes and never recomputed the weight.
 * The number on those reports does not describe the measurements printed directly above it.
 *
 * ── Why the result is STORED, and never recomputed at render ─────────────────────────────────
 *
 * A released report must keep saying what it said. `result_measurements.derivation` stamps the
 * formula onto the row as it is written, so if a coefficient is ever corrected, new rows carry the
 * new code and old ones keep theirs. Same principle as [1.30.0]'s refusal to restate a closed day:
 * a document somebody acted on is a historical record, not a live view.
 */

/** π/6. The standard ellipsoid volume, and what the clinic's own figures actually follow. */
const ELLIPSOID_COEFFICIENT = 0.5236;

/**
 * Days added to the mean sac diameter in millimetres to get gestational age.
 *
 * **Not Hellman's +30.** That is the formula a textbook gives and it fits this clinic's data
 * badly — mean absolute error 6.6 days against 54 measured pairs, with not one landing within a
 * day. +25 gives 1.80 days mean error with 35 of 54 inside a day. The clinic is reading a chart
 * on the scanner, and this constant approximates that chart. Do not "correct" it to 30.
 */
const GA_FROM_MSD_OFFSET_DAYS = 25;

/** Naegele. Median across 19 reports was exactly 280, so this is their rule, not an assumption. */
const GESTATION_DAYS = 280;

const DERIVATIONS = {
  ELLIPSOID_VOLUME: 'ELLIPSOID_VOLUME',
  EDC_NAEGELE: 'EDC_NAEGELE',
  GA_FROM_MSD: 'GA_FROM_MSD',
};

/**
 * Volume of an ellipsoid from three axes, in the same cubic unit the axes are given in.
 *
 * Serves the prostate's weight in grams — 1 cc of prostate is taken as 1 g, which is what the
 * clinic's own reports do — and any cyst, nodule or hydrocele volume in cc.
 */
function ellipsoidVolume(a, b, c) {
  const axes = [a, b, c].map(Number);
  if (axes.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return Number((ELLIPSOID_COEFFICIENT * axes[0] * axes[1] * axes[2]).toFixed(2));
}

/** Gestational age in whole days from a mean sac diameter given in CENTIMETRES. */
function gestationalAgeFromMsd(msdCm) {
  const cm = Number(msdCm);
  if (!Number.isFinite(cm) || cm <= 0) return null;
  return Math.round(cm * 10) + GA_FROM_MSD_OFFSET_DAYS;
}

/**
 * Estimated date of confinement.
 *
 * `scanDate` is the VISIT's date, never `CURRENT_DATE`. Amending a report three days later must
 * not shift the patient's due date by three days — the gestational age was measured on the day of
 * the scan and the arithmetic has to start from the same place every time it is run.
 */
function estimatedDateOfConfinement(scanDate, gestationalAgeDays) {
  const days = Number(gestationalAgeDays);
  if (!scanDate || !Number.isFinite(days)) return null;
  const d = new Date(scanDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (GESTATION_DAYS - days));
  // Local getters, never toISOString(): in Philippine time that returns yesterday's date between
  // midnight and 08:00, silently.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Apply a field's declared derivation, given the values already merged for this version.
 *
 * Returns `null` when the inputs are absent, which is the common case rather than an error: a
 * technician who has not filled the prostate's axes yet should not get a weight of 0.
 */
function computeDerived(field, sourceValue, context = {}) {
  switch (field.derivation) {
    case DERIVATIONS.ELLIPSOID_VOLUME: {
      if (!sourceValue) return null;
      const v = ellipsoidVolume(sourceValue.value_1, sourceValue.value_2, sourceValue.value_3);
      return v === null ? null : { value_1: v };
    }
    case DERIVATIONS.GA_FROM_MSD: {
      if (!sourceValue) return null;
      const days = gestationalAgeFromMsd(sourceValue.value_1);
      return days === null ? null : { value_1: days };
    }
    case DERIVATIONS.EDC_NAEGELE: {
      if (!sourceValue) return null;
      const edc = estimatedDateOfConfinement(context.scanDate, sourceValue.value_1);
      return edc === null ? null : { value_date: edc };
    }
    default:
      return null;
  }
}

module.exports = {
  ELLIPSOID_COEFFICIENT,
  GA_FROM_MSD_OFFSET_DAYS,
  GESTATION_DAYS,
  DERIVATIONS,
  ellipsoidVolume,
  gestationalAgeFromMsd,
  estimatedDateOfConfinement,
  computeDerived,
};
