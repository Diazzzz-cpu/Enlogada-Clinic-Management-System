/**
 * Finds the out-of-range values in a technician's findings. [1.63.0]
 *
 * ── Why parse text rather than store structured results ─────────────────────────────────────
 *
 * `test_results.findings` is free TEXT, and deliberately so: it holds a CBC panel, a radiologist's
 * prose impression and a one-line note, and a schema that fits all three would fit none of them
 * well. `lib/resultTemplates.js` gives the analyte panels a consistent shape —
 *
 *     Hemoglobin: 14.5 g/dL (Normal: 13.0 - 17.5)
 *
 * — and that shape is what this reads. It is a presentation aid over text somebody already typed,
 * not a clinical decision: nothing here changes what is stored, released or emailed.
 *
 * ── It only ever ADDS emphasis ──────────────────────────────────────────────────────────────
 *
 * A line it cannot parse is returned unchanged and unmarked. That asymmetry is the whole safety
 * argument: the failure mode is "an abnormal value was not highlighted", which leaves the reader
 * exactly where they were before this existed. The opposite failure — marking a normal value as
 * abnormal, or worse, marking an abnormal one as normal — would be actively misleading, so nothing
 * is ever marked normal and no line is ever rewritten.
 *
 * This is an aid to reading, and explicitly NOT a substitute for the critical-value workflow. A
 * panic value still has to be flagged by the clinician and acknowledged with a recorded callback;
 * highlighting it here does not and must not discharge that.
 */

/**
 * `Label: value unit (Normal: low - high)`.
 *
 * Tolerant about the label wording — "Normal", "Ref", "Reference" and "Range" all appear in real
 * templates — and about the dash, because an en dash arrives whenever somebody pastes from Word.
 * Deliberately NOT tolerant about the value: it must be the first number after the colon, or the
 * line is left alone. Guessing which number on a line is "the result" is how a unit gets compared
 * against a range.
 */
const ANALYTE = new RegExp(
  '^(\\s*)'                                   // leading indent, preserved
  + '([^:]{1,60}?)'                           // label
  + ':\\s*'
  + '(-?\\d+(?:\\.\\d+)?)'                    // the value
  + '\\s*([^(]*?)\\s*'                        // unit, if any
  + '\\(\\s*(?:normal|ref|reference|range)\\s*:?\\s*'
  + '(-?\\d+(?:\\.\\d+)?)'                    // low
  + '\\s*[-–—]\\s*'
  + '(-?\\d+(?:\\.\\d+)?)'                    // high
  + '\\s*\\)\\s*$',
  'i'
);

/**
 * @typedef {object} FindingLine
 * @property {string} text        The line, unchanged.
 * @property {'high'|'low'|null} flag  Null when in range, or when the line is not an analyte.
 * @property {string|null} label
 * @property {number|null} value
 * @property {[number, number]|null} range
 */

/**
 * Splits findings into lines and flags the ones outside their stated range.
 *
 * @param {string} findings
 * @returns {FindingLine[]}
 */
export function analyseFindings(findings) {
  const text = String(findings ?? '');
  if (!text.trim()) return [];

  return text.split('\n').map((line) => {
    const match = ANALYTE.exec(line);
    if (!match) return { text: line, flag: null, label: null, value: null, range: null };

    const [, , label, rawValue, , rawLow, rawHigh] = match;
    const value = Number(rawValue);
    const low = Number(rawLow);
    const high = Number(rawHigh);

    // An inverted or nonsensical range means the line is not what this assumes. Leave it alone
    // rather than deciding a value is abnormal against limits that cannot be right.
    if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high) || low > high) {
      return { text: line, flag: null, label: null, value: null, range: null };
    }

    // Inclusive bounds: a haemoglobin of exactly 13.0 against "13.0 - 17.5" is normal. Excluding
    // the endpoints would flag the boundary case, which is the one clinicians care least about
    // and would see most often.
    const flag = value < low ? 'low' : value > high ? 'high' : null;

    return { text: line, flag, label: label.trim(), value, range: [low, high] };
  });
}

/**
 * How many values fall outside their range. For a summary line above a report.
 *
 * @param {string} findings
 * @returns {number}
 */
export function abnormalCount(findings) {
  return analyseFindings(findings).filter((l) => l.flag).length;
}

/**
 * Whether anything in these findings is out of range.
 *
 * @param {string} findings
 * @returns {boolean}
 */
export function hasAbnormal(findings) {
  return abnormalCount(findings) > 0;
}
