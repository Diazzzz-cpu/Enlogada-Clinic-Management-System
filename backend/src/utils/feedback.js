/**
 * The rules and arithmetic of patient feedback, kept pure so they are tested without a database.
 * [1.112.0]
 *
 * A rating is 3 / 2 / 1 for the form's MAAYO / OKAY LANG / DILI MAAYO. The scale is fixed on
 * purpose: if the answers could be reworded or re-counted, one month could not be compared with
 * the next.
 */

const LANGUAGES = ['ceb', 'tl', 'en'];
const RATING_KEY = { 3: 'good', 2: 'ok', 1: 'poor' };
const MAX_COMMENT = 1000;

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

/**
 * Checks a submitted form and returns what should be stored.
 *
 * Every question is optional — the paper form does not force a tick either — but a form must say
 * SOMETHING: at least one answer or a comment. An answer to a question that is not being asked
 * (turned off, or never existed) is refused rather than dropped, so a stale screen learns it.
 *
 * @param {object} body  { answers: { [questionId]: 1|2|3 }, comment, language, nameHidden }
 * @param {number[]} askedIds  the ids of the questions currently being asked
 * @returns {{ answers: Array<{questionId:number, rating:number}>, comment: string|null,
 *             language: string, nameHidden: boolean }}
 */
function normaliseSubmission(body = {}, askedIds = []) {
  const asked = new Set(askedIds.map(Number));
  const raw = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};

  const answers = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue;   // left blank
    const questionId = Number(key);
    if (!asked.has(questionId)) throw badRequest('One of the answers is to a question that is no longer asked. Reload and try again.');
    const rating = Number(value);
    if (![1, 2, 3].includes(rating)) throw badRequest('Each answer must be Maayo, Okay lang or Dili maayo.');
    answers.push({ questionId, rating });
  }

  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;
  if (comment && comment.length > MAX_COMMENT) throw badRequest(`Please keep the comment under ${MAX_COMMENT} characters.`);
  if (!answers.length && !comment) throw badRequest('Answer at least one question, or write a comment.');

  const language = LANGUAGES.includes(body.language) ? body.language : 'ceb';
  return { answers, comment, language, nameHidden: body.nameHidden === true || body.nameHidden === 'true' };
}

/**
 * Per-question tallies, in the order the questions are given.
 *
 * A percentage with nothing to divide is NULL, not 0: "0% Maayo" is a claim about patients, and a
 * question nobody answered has made no such claim.
 *
 * @param {object[]} questions  rows with `id`
 * @param {Array<{question_id:number, rating:number, count:number|string}>} counts
 */
function summariseQuestions(questions = [], counts = []) {
  return questions.map((q) => {
    const tally = { good: 0, ok: 0, poor: 0 };
    for (const c of counts) {
      if (Number(c.question_id) === Number(q.id) && RATING_KEY[c.rating]) tally[RATING_KEY[c.rating]] += Number(c.count);
    }
    const total = tally.good + tally.ok + tally.poor;
    const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : null);
    return { ...q, ...tally, total, goodPct: pct(tally.good), okPct: pct(tally.ok), poorPct: pct(tally.poor) };
  });
}

/** Forms received per completed visit, as a percentage; null when no visit was completed. */
function responseRate(responses, completedVisits) {
  return completedVisits > 0 ? Math.round((responses / completedVisits) * 1000) / 10 : null;
}

module.exports = { LANGUAGES, MAX_COMMENT, normaliseSubmission, summariseQuestions, responseRate };
