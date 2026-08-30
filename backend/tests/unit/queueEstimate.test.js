const test = require('node:test');
const assert = require('node:assert/strict');

const queueEstimateService = require('../../src/services/queueEstimateService');
const db = require('../../src/config/database');

const { MAX_REPORTABLE_MINUTES, DEFAULT_SERVICE_MINUTES } = queueEstimateService.__constants;

/**
 * Turning a queue position into a time a patient is told. [1.63.0]
 *
 * `estimateFor` is pure — position and rate in, minutes out — and every rule in it is a promise
 * the clinic makes to somebody standing in a waiting room. Those are exactly the rules that get
 * "simplified" later by someone who does not know why the floor, the rounding and the cap are
 * there.
 *
 * The multiplier itself is measured in SQL (`getMedianServiceMinutes`) and is not tested here;
 * what is tested is what happens to it afterwards.
 */

// The module transitively opens a pg pool at require time.
test.after(async () => {
  await db.pool.end();
});

const rate = (minutes, basis = 'measured') => ({ minutes, sampleSize: 50, basis });

test('nobody is ever told zero — the person at the front is next, not finished', () => {
  const e = queueEstimateService.estimateFor(0, rate(6));
  assert.ok(e.estimated_wait_minutes >= 5, 'there is still one patient to deal with: them');
  assert.equal(e.patients_ahead, 0);
});

test('the estimate grows with the queue', () => {
  const at = (ahead) => queueEstimateService.estimateFor(ahead, rate(6)).estimated_wait_minutes;

  let previous = 0;
  for (const ahead of [0, 1, 2, 3, 5, 8]) {
    const now = at(ahead);
    assert.ok(now >= previous, `${ahead} ahead should not be quicker than fewer`);
    previous = now;
  }
});

test('it is rounded to five minutes, because that is the precision it has', () => {
  // "About 20 minutes" is an estimate a clinic can keep; "18 minutes" is a promise it cannot.
  for (const ahead of [0, 1, 2, 3, 4, 7, 11]) {
    const { estimated_wait_minutes: m } = queueEstimateService.estimateFor(ahead, rate(6));
    assert.equal(m % 5, 0, `${ahead} ahead gave ${m}`);
  }
});

test('a long queue is capped, and flagged as capped', () => {
  // Past a point no estimate is meaningful. "Over 90 minutes" is the honest shape of the fact;
  // stating 3 hours invites a patient to leave.
  const e = queueEstimateService.estimateFor(200, rate(6));
  assert.equal(e.estimated_wait_minutes, MAX_REPORTABLE_MINUTES);
  assert.equal(e.estimate_is_capped, true, 'the UI needs to say "over", not state the ceiling');
});

test('a short queue is not flagged as capped', () => {
  assert.equal(queueEstimateService.estimateFor(1, rate(6)).estimate_is_capped, false);
});

test('the basis travels with the estimate, so the UI can hedge a guess', () => {
  assert.equal(queueEstimateService.estimateFor(2, rate(6, 'measured')).estimate_basis, 'measured');
  assert.equal(queueEstimateService.estimateFor(2, rate(6, 'default')).estimate_basis, 'default');
});

test('a missing rate falls back to the stated default rather than producing NaN', () => {
  const e = queueEstimateService.estimateFor(2, null);
  assert.ok(Number.isFinite(e.estimated_wait_minutes));
  assert.equal(e.estimate_basis, 'default');
  assert.equal(e.estimated_wait_minutes, Math.min(
    Math.max(5, Math.round(((2 + 1) * DEFAULT_SERVICE_MINUTES) / 5) * 5),
    MAX_REPORTABLE_MINUTES
  ));
});

test('a negative or nonsense position is treated as the front of the queue', () => {
  for (const bad of [-1, -50, null, undefined, NaN, 'three']) {
    const e = queueEstimateService.estimateFor(bad, rate(6));
    assert.equal(e.patients_ahead, 0, JSON.stringify(bad));
    assert.ok(e.estimated_wait_minutes >= 5);
  }
});

test('annotate leaves a visit past the desk with NO estimate, not a zero', () => {
  // 'Processing' means billed and released to a department, where a front-desk estimate has
  // nothing to say. Zero would read as "no wait" — a claim rather than an absence.
  const rows = [
    { id: 1, status: 'Pending', patients_ahead: 0 },
    { id: 2, status: 'Processing', patients_ahead: 1 },
    { id: 3, status: 'Pending', patients_ahead: 1 },
  ];

  return queueEstimateService.annotate(rows).then((out) => {
    assert.ok(out[0].estimated_wait_minutes > 0);
    assert.equal(out[1].estimated_wait_minutes, null, 'a billed visit gets no estimate');
    assert.equal(out[1].estimate_basis, null);
    assert.ok(out[2].estimated_wait_minutes > 0);
  });
});

test('annotate returns an empty list untouched and never calls the database for it', async () => {
  assert.deepEqual(await queueEstimateService.annotate([]), []);
  assert.deepEqual(await queueEstimateService.annotate(null), null);
});
