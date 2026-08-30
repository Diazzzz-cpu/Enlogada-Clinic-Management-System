import { describe, it, expect } from 'vitest';
import { analyseFindings, abnormalCount, hasAbnormal } from '../../src/lib/abnormalValues';

/**
 * Reading a technician's findings for out-of-range values. [1.63.0]
 *
 * This decides what a clinician's eye is drawn to on a released report, so the interesting cases
 * are not the ones it flags — they are the ones it must NOT.
 *
 * The safety argument is asymmetric on purpose: a line it cannot parse renders exactly as typed,
 * so the failure mode is a missed highlight, which leaves the reader where they were before the
 * feature existed. The opposite failure — marking an abnormal value as normal, or rewriting a
 * line — would be an assurance the software is not entitled to give.
 */

describe('flagging values against their stated range', () => {
  it('flags a value below the range as low', () => {
    const [line] = analyseFindings('Hemoglobin: 11.2 g/dL (Normal: 13.0 - 17.5)');
    expect(line.flag).toBe('low');
    expect(line.label).toBe('Hemoglobin');
    expect(line.value).toBe(11.2);
    expect(line.range).toEqual([13.0, 17.5]);
  });

  it('flags a value above the range as high', () => {
    expect(analyseFindings('WBC Count: 14.9 x 10^9/L (Normal: 4.5 - 11.0)')[0].flag).toBe('high');
  });

  it('leaves a value inside the range unflagged', () => {
    expect(analyseFindings('Hematocrit: 43.5 % (Normal: 40.0 - 52.0)')[0].flag).toBeNull();
  });

  it('treats the bounds as INCLUSIVE', () => {
    // A haemoglobin of exactly 13.0 against "13.0 - 17.5" is normal. Excluding the endpoints would
    // fire on the boundary case, which is the one clinicians care least about and would see most.
    expect(analyseFindings('Hb: 13.0 g/dL (Normal: 13.0 - 17.5)')[0].flag).toBeNull();
    expect(analyseFindings('Hct: 52.0 % (Normal: 40.0 - 52.0)')[0].flag).toBeNull();
  });

  it('reads the range wordings that actually appear in templates', () => {
    expect(analyseFindings('Platelet: 120 (Ref: 150 - 450)')[0].flag).toBe('low');
    expect(analyseFindings('Platelet: 120 (Reference: 150 - 450)')[0].flag).toBe('low');
    expect(analyseFindings('Platelet: 120 (Range: 150 - 450)')[0].flag).toBe('low');
  });

  it('tolerates an en dash, which arrives whenever somebody pastes from Word', () => {
    expect(analyseFindings('Glucose: 130 mg/dL (Normal: 70 – 100)')[0].flag).toBe('high');
  });

  it('handles a negative value and a negative bound', () => {
    expect(analyseFindings('Base excess: -4.0 mmol/L (Normal: -2.0 - 2.0)')[0].flag).toBe('low');
  });
});

describe('what it deliberately refuses to judge', () => {
  it('leaves a radiologist\'s prose alone', () => {
    expect(analyseFindings('- Lungs are clear with no active infiltrates.')[0].flag).toBeNull();
    expect(analyseFindings('IMPRESSION:')[0].flag).toBeNull();
  });

  it('leaves a heading containing parentheses alone', () => {
    // "COMPLETE BLOOD COUNT (CBC) RESULTS:" has a colon and brackets and is not an analyte.
    expect(analyseFindings('COMPLETE BLOOD COUNT (CBC) RESULTS:')[0].flag).toBeNull();
  });

  it('declines an inverted range rather than deciding against impossible limits', () => {
    expect(analyseFindings('Odd: 5 (Normal: 10 - 2)')[0].flag).toBeNull();
  });

  it('declines a line with no numeric value', () => {
    expect(analyseFindings('Culture: No growth (Normal: 0 - 0)')[0].flag).toBeNull();
  });

  it('never marks anything as normal — only abnormal or nothing', () => {
    const flags = analyseFindings([
      'Hemoglobin: 14.5 g/dL (Normal: 13.0 - 17.5)',
      '- Lungs are clear.',
    ].join('\n')).map((l) => l.flag);

    expect(flags.every((flag) => flag === null || flag === 'high' || flag === 'low')).toBe(true);
    expect(flags).toEqual([null, null]);
  });
});

describe('preserving what the technician typed', () => {
  const panel = [
    'COMPLETE BLOOD COUNT (CBC) RESULTS:',
    'Hemoglobin: 11.2 g/dL (Normal: 13.0 - 17.5)',
    'Hematocrit: 43.5 % (Normal: 40.0 - 52.0)',
    'WBC Count: 14.9 x 10^9/L (Normal: 4.5 - 11.0)',
    'Platelet Count: 280 x 10^9/L (Normal: 150 - 450)',
    '',
    'IMPRESSION:',
    'Anaemia with leucocytosis.',
  ].join('\n');

  it('round-trips the text unchanged', () => {
    // The whole safety argument rests on this: it only ever ADDS emphasis.
    expect(analyseFindings(panel).map((l) => l.text).join('\n')).toBe(panel);
  });

  it('preserves blank lines, which are structure', () => {
    // The blank line separates the panel from the impression.
    const lines = analyseFindings(panel);
    expect(lines).toHaveLength(8);
    expect(lines[5].text).toBe('');
  });

  it('counts exactly the out-of-range values', () => {
    expect(abnormalCount(panel)).toBe(2);
    expect(hasAbnormal(panel)).toBe(true);
  });

  it('reports nothing for empty or absent findings', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(analyseFindings(empty)).toEqual([]);
      expect(abnormalCount(empty)).toBe(0);
      expect(hasAbnormal(empty)).toBe(false);
    }
  });
});
