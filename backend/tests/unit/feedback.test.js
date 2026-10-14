const test = require('node:test');
const assert = require('node:assert/strict');

const { normaliseSubmission, summariseQuestions, responseRate } = require('../../src/utils/feedback');

/** Patient feedback: what a form must say, and how the overview counts it. [1.112.0] */

const refused = (fn, pattern) => assert.throws(fn, (err) => err.statusCode === 400 && pattern.test(err.message));

test('a form keeps the answers given and leaves blanks out', () => {
  const out = normaliseSubmission({ answers: { 1: 3, 2: '2', 3: '', 4: null }, language: 'tl' }, [1, 2, 3, 4]);
  assert.deepEqual(out.answers, [{ questionId: 1, rating: 3 }, { questionId: 2, rating: 2 }]);
  assert.equal(out.language, 'tl');
  assert.equal(out.comment, null);
  assert.equal(out.nameHidden, false);
});

test('a form must say something: an answer or a comment', () => {
  refused(() => normaliseSubmission({ answers: {} }, [1]), /at least one question/i);
  const commentOnly = normaliseSubmission({ answers: {}, comment: '  Salamat kaayo!  ' }, [1]);
  assert.equal(commentOnly.comment, 'Salamat kaayo!');
  assert.deepEqual(commentOnly.answers, []);
});

test('only Maayo, Okay lang or Dili maayo is a rating', () => {
  refused(() => normaliseSubmission({ answers: { 1: 4 } }, [1]), /Maayo, Okay lang or Dili maayo/);
  refused(() => normaliseSubmission({ answers: { 1: 0 } }, [1]), /Maayo/);
});

test('an answer to a question no longer asked is refused, not dropped', () => {
  refused(() => normaliseSubmission({ answers: { 9: 3 } }, [1, 2]), /no longer asked/);
});

test('an unknown language falls back to Cebuano, the form the clinic prints', () => {
  assert.equal(normaliseSubmission({ answers: { 1: 3 }, language: 'fr' }, [1]).language, 'ceb');
});

test('the name is hidden only when asked', () => {
  assert.equal(normaliseSubmission({ answers: { 1: 3 }, nameHidden: true }, [1]).nameHidden, true);
  assert.equal(normaliseSubmission({ answers: { 1: 3 }, nameHidden: 'yes' }, [1]).nameHidden, false);
});

test('tallies are per question, in order, with a percentage only where there are answers', () => {
  const rows = summariseQuestions(
    [{ id: 1 }, { id: 2 }],
    [{ question_id: 1, rating: 3, count: '3' }, { question_id: 1, rating: 1, count: 1 }]
  );
  assert.equal(rows[0].good, 3);
  assert.equal(rows[0].poor, 1);
  assert.equal(rows[0].total, 4);
  assert.equal(rows[0].goodPct, 75);
  assert.equal(rows[0].poorPct, 25);
  // Nobody answered question 2: no percentage, rather than a claim of 0%.
  assert.equal(rows[1].total, 0);
  assert.equal(rows[1].goodPct, null);
});

test('the response rate needs a completed visit to divide by', () => {
  assert.equal(responseRate(3, 12), 25);
  assert.equal(responseRate(0, 0), null);
});
