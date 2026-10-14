/**
 * A department's worklist, one row per patient. [1.115.0]
 *
 * The worklist is a list of TESTS, and a patient who came in for six laboratory tests filled six
 * rows with the same ticket, name and wait, so finding the next person meant reading past five
 * copies of the last one. Grouped, a patient is one row, and their tests open under their name.
 *
 * Grouped by VISIT, not by patient: a visit is one queue ticket, and two visits of the same
 * person (a rare same-day return) are two tickets that the department may finish at different
 * times. A visit with one test in view stays an ordinary row, because a dropdown of one is a click
 * that shows nothing new.
 */

/**
 * @param {Array<object>} tests worklist rows, in the order the screen shows them
 * @returns {Array<{ key: string, first: object, tests: object[] }>} in order of each visit's first test
 */
export function groupByVisit(tests) {
  const groups = new Map();
  for (const test of tests || []) {
    const key = test.visit_id != null ? `visit-${test.visit_id}` : `test-${test.visit_test_id}`;
    if (!groups.has(key)) groups.set(key, { key, first: test, tests: [] });
    groups.get(key).tests.push(test);
  }
  return [...groups.values()];
}

/**
 * How many of a group's tests are in each status, in the order the work goes: what is still to be
 * done before what is waiting to be released.
 *
 * @returns {Array<{ status: string, count: number }>}
 */
export function statusCounts(tests) {
  const ORDER = ['Processing', 'Waiting for Release'];
  const counts = new Map();
  for (const t of tests || []) counts.set(t.test_status, (counts.get(t.test_status) || 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
    })
    .map(([status, count]) => ({ status, count }));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The footer's count: patients AND tests, because the sidebar's badge and the two figures above
 * the list count tests, and a footer counting only patients would disagree with all three.
 */
export function worklistCountLabel({ groups, tests, page, pageSize }) {
  const people = plural(groups, 'patient');
  const work = plural(tests, 'test');
  if (groups <= pageSize) return `${people} · ${work}`;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, groups);
  return `Showing ${first}–${last} of ${people} · ${work}`;
}
