import { describe, it, expect } from 'vitest';
import { dayLabel, periodShort, pageFooter, cssString } from '../../src/lib/reportPrint';

/**
 * The words at the foot of every printed report page. [1.118.0]
 *
 * They are written into a CSS `content:` string while the report prints, so the two things that
 * can go wrong are a date read through UTC (the wrong day every morning in the Philippines) and a
 * name with a quote in it ending the string early, which would drop the footer silently.
 */

describe('dayLabel', () => {
  it('reads the date as a local calendar day', () => {
    expect(dayLabel('2026-10-09')).toBe('October 9, 2026');
    expect(dayLabel('2026-01-01')).toBe('January 1, 2026');
  });
});

describe('periodShort', () => {
  it('names the year once within a year', () => {
    expect(periodShort('2026-10-09', '2026-10-15')).toBe('Oct 9 to Oct 15, 2026');
  });
  it('names both years across a new year', () => {
    expect(periodShort('2026-12-20', '2027-01-05')).toBe('Dec 20, 2026 to Jan 5, 2027');
  });
  it('is one date for one day', () => {
    expect(periodShort('2026-10-15', '2026-10-15')).toBe('Oct 15, 2026');
  });
});

describe('pageFooter', () => {
  it('says whose report, which, for when, and that it is confidential', () => {
    expect(pageFooter({
      clinicName: 'Enlogada Ultrasound & Diagnostic Clinic',
      title: 'Departments Report',
      startDate: '2026-10-09',
      endDate: '2026-10-15',
    })).toBe('Enlogada Ultrasound & Diagnostic Clinic  ·  Departments Report  ·  Oct 9 to Oct 15, 2026  ·  Confidential');
  });
});

describe('cssString', () => {
  it('escapes what would end the string', () => {
    expect(cssString('Dr. "Ana" Reyes')).toBe('"Dr. \\"Ana\\" Reyes"');
    expect(cssString('a\\b')).toBe('"a\\\\b"');
    expect(cssString('one\ntwo')).toBe('"one two"');
  });
});
