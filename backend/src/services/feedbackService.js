const feedbackRepository = require('../repositories/feedbackRepository');
const auditService = require('./auditService');
const { normaliseSubmission, summariseQuestions, responseRate } = require('../utils/feedback');

/**
 * Patient feedback on a visit. [1.112.0]
 *
 * Asked once per VISIT, after its last result is released — the visit is then 'Completed'. Not
 * per test: a patient with a CBC and an ultrasound would otherwise be asked twice, and one of the
 * questions is whether the RESULT came on time, which cannot be answered before it has.
 *
 * Two ways in. A patient with an account answers in the portal; reception types in the paper form
 * a walk-in hands back. Either way it is one form per visit, and the second is refused.
 */

/** How long after a visit the portal keeps asking. Long enough to notice, short enough to remember. */
const PORTAL_WINDOW_DAYS = 30;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const fail = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/** All three wordings are required: a patient may answer in any of them. */
function prompts(body) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = { promptCeb: clean(body.promptCeb), promptTl: clean(body.promptTl), promptEn: clean(body.promptEn) };
  if (!out.promptCeb || !out.promptTl || !out.promptEn) {
    throw fail(400, 'Write the question in Cebuano, Tagalog and English.');
  }
  if ([out.promptCeb, out.promptTl, out.promptEn].some((p) => p.length > 300)) {
    throw fail(400, 'Keep each wording under 300 characters.');
  }
  return out;
}

class FeedbackService {
  // ── Questions ──────────────────────────────────────────────────────────────────────────────

  async listQuestions({ includeInactive = false } = {}) {
    return feedbackRepository.findQuestions({ activeOnly: !includeInactive });
  }

  async createQuestion(body, user) {
    const question = await feedbackRepository.createQuestion({ ...prompts(body), createdBy: user?.userId });
    await auditService.log({
      actorId: user?.userId, action: 'feedback.question_added', entityType: 'feedback_question',
      entityId: question.id, description: `Added a feedback question: "${question.prompt_en}"`,
    });
    return question;
  }

  /**
   * Rewords a question or turns it on or off.
   *
   * Once a question has answers its WORDING is fixed: last month's "Dili maayo" answered the
   * question as it was asked then, and rewording it would file those answers under a question
   * nobody saw. Turning it off is always allowed; to ask something different, add a new one.
   * An omitted field is left as it is, never cleared.
   */
  async updateQuestion(id, body, user) {
    const existing = await feedbackRepository.findQuestionById(id);
    if (!existing) throw fail(404, 'That question was not found.');

    const rewording = ['promptCeb', 'promptTl', 'promptEn'].some((k) => body[k] !== undefined);
    const next = {};
    if (rewording) {
      if (existing.answer_count > 0) {
        throw fail(409, 'This question already has answers, so its wording is kept. Turn it off and add a new question instead.');
      }
      Object.assign(next, prompts({
        promptCeb: body.promptCeb ?? existing.prompt_ceb,
        promptTl: body.promptTl ?? existing.prompt_tl,
        promptEn: body.promptEn ?? existing.prompt_en,
      }));
    }
    if (body.isActive !== undefined) next.isActive = body.isActive === true || body.isActive === 'true';

    const updated = await feedbackRepository.updateQuestion(id, next);
    if (next.isActive !== undefined && next.isActive !== existing.is_active) {
      await auditService.log({
        actorId: user?.userId, action: next.isActive ? 'feedback.question_on' : 'feedback.question_off',
        entityType: 'feedback_question', entityId: id,
        description: `${next.isActive ? 'Turned on' : 'Turned off'} the feedback question "${updated.prompt_en}"`,
      });
    }
    return updated;
  }

  /** `ids` must name every question exactly once: a partial order would leave two at one place. */
  async reorderQuestions(ids) {
    const all = await feedbackRepository.findQuestions({ activeOnly: false });
    const given = Array.isArray(ids) ? ids.map(Number) : [];
    const known = new Set(all.map((q) => q.id));
    if (given.length !== all.length || new Set(given).size !== given.length || given.some((i) => !known.has(i))) {
      throw fail(400, 'Send every question exactly once, in the new order.');
    }
    await feedbackRepository.reorderQuestions(given);
    return feedbackRepository.findQuestions({ activeOnly: false });
  }

  // ── Forms ──────────────────────────────────────────────────────────────────────────────────

  /** The visits a signed-in patient can still rate. */
  async pendingForPatient(user) {
    return feedbackRepository.findPendingForUser(user.userId, PORTAL_WINDOW_DAYS);
  }

  /**
   * Stores a form for a visit.
   *
   * @param {'portal'|'paper'} channel  portal: the patient, about their own visit; paper: a member
   *   of staff typing in the form the patient filled in at the clinic.
   */
  async submit(visitId, body, user, channel) {
    const visit = await feedbackRepository.findVisitForFeedback(visitId);
    // A patient asking about a visit that is not theirs is told it does not exist, as with every
    // other record they may not see.
    if (!visit || (channel === 'portal' && visit.user_id !== user.userId)) throw fail(404, 'Visit not found.');
    if (visit.status !== 'Completed') {
      throw fail(409, 'A visit can be rated once all of its results have been released.');
    }
    if (visit.feedback_submitted_at) throw fail(409, 'Feedback for this visit has already been recorded.');
    if (channel === 'portal') {
      const ageDays = (Date.now() - new Date(visit.created_at).getTime()) / 86400000;
      if (ageDays > PORTAL_WINDOW_DAYS + 1) throw fail(409, 'This visit is too long ago to rate here. You can tell the clinic at your next visit.');
    }

    const asked = (await feedbackRepository.findQuestions({ activeOnly: true })).map((q) => q.id);
    const form = normaliseSubmission(body, asked);
    const saved = await feedbackRepository.saveForm(visitId, {
      ...form,
      channel,
      recordedBy: channel === 'paper' ? user.userId : null,
    });
    if (!saved) throw fail(409, 'Feedback for this visit has already been recorded.');

    // A paper form is something a member of staff did, so it is in the Activity Log. A patient's
    // own form is not: it is the patient speaking, and the overview is where it is read.
    if (channel === 'paper') {
      await auditService.log({
        actorId: user.userId, action: 'feedback.paper_recorded', entityType: 'patient_visit', entityId: visit.id,
        description: `Recorded the paper feedback form for visit #${visit.id}`
          + (form.nameHidden ? ' (no name on the paper)' : ` (${visit.first_name} ${visit.last_name})`),
      });
    }
    return { visitId: visit.id, answers: form.answers.length };
  }

  // ── Overview ───────────────────────────────────────────────────────────────────────────────

  async overview(startDate, endDate) {
    if (!DATE_FORMAT.test(startDate || '') || !DATE_FORMAT.test(endDate || '')) {
      throw fail(400, 'startDate and endDate are both required (YYYY-MM-DD).');
    }
    if (startDate > endDate) throw fail(400, 'startDate must not be after endDate.');

    const [visits, questions, counts, forms] = await Promise.all([
      feedbackRepository.countVisits(startDate, endDate),
      feedbackRepository.findQuestionsForRange(startDate, endDate),
      feedbackRepository.countRatings(startDate, endDate),
      feedbackRepository.findForms(startDate, endDate),
    ]);
    return {
      startDate,
      endDate,
      completedVisits: visits.completed,
      responses: visits.responses,
      byChannel: { portal: visits.portal, paper: visits.paper },
      responseRate: responseRate(visits.responses, visits.completed),
      questions: summariseQuestions(questions, counts),
      forms,
    };
  }
}

module.exports = new FeedbackService();
