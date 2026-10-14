import { describe, it, expect } from 'vitest';
import { groupByVisit, statusCounts, worklistCountLabel } from '../../src/lib/worklistGroups';

/**
 * A department's worklist, one row per patient. [1.115.0]
 *
 * The cases that matter are the ones that would put a test under the wrong person or lose one:
 * order, a visit split by another patient's tests, and a row with no visit id.
 */

const t = (visitTestId, visitId, status = 'Processing') => ({
  visit_test_id: visitTestId, visit_id: visitId, test_status: status,
});

describe('groupByVisit', () => {
  it('puts a visit\'s tests together, in the order the list had them', () => {
    const groups = groupByVisit([t(1, 10), t(2, 20), t(3, 10), t(4, 10)]);
    expect(groups.map((g) => g.key)).toEqual(['visit-10', 'visit-20']);
    expect(groups[0].tests.map((x) => x.visit_test_id)).toEqual([1, 3, 4]);
    expect(groups[0].first.visit_test_id).toBe(1);
  });

  it('never merges two visits, even of the same patient', () => {
    const groups = groupByVisit([
      { ...t(1, 10), patient_id: 7 },
      { ...t(2, 11), patient_id: 7 },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('keeps a row with no visit id on its own, and loses nothing', () => {
    const groups = groupByVisit([t(1, null), t(2, undefined), t(3, 10)]);
    expect(groups.map((g) => g.key)).toEqual(['test-1', 'test-2', 'visit-10']);
    expect(groups.flatMap((g) => g.tests)).toHaveLength(3);
  });

  it('is empty for nothing', () => {
    expect(groupByVisit([])).toEqual([]);
    expect(groupByVisit(undefined)).toEqual([]);
  });
});

describe('statusCounts', () => {
  it('counts each status, work still to do first', () => {
    expect(statusCounts([
      t(1, 1, 'Waiting for Release'), t(2, 1), t(3, 1), t(4, 1, 'Waiting for Release'), t(5, 1),
    ])).toEqual([
      { status: 'Processing', count: 3 },
      { status: 'Waiting for Release', count: 2 },
    ]);
  });
});

describe('worklistCountLabel', () => {
  it('names both what the badge counts and what the rows are', () => {
    expect(worklistCountLabel({ groups: 3, tests: 8, page: 1, pageSize: 10 })).toBe('3 patients · 8 tests');
    expect(worklistCountLabel({ groups: 1, tests: 1, page: 1, pageSize: 10 })).toBe('1 patient · 1 test');
  });

  it('gives the range of patients once there is more than a page', () => {
    expect(worklistCountLabel({ groups: 14, tests: 30, page: 2, pageSize: 10 }))
      .toBe('Showing 11–14 of 14 patients · 30 tests');
  });
});
