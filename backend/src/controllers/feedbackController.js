const feedbackService = require('../services/feedbackService');

/** Patient feedback. [1.112.0] Parsing and shaping only; the rules are in feedbackService. */
class FeedbackController {
  async listQuestions(req, res, next) {
    try {
      const questions = await feedbackService.listQuestions();
      return res.status(200).json({ status: 'success', data: { questions } });
    } catch (err) { next(err); }
  }

  async listAllQuestions(req, res, next) {
    try {
      const questions = await feedbackService.listQuestions({ includeInactive: true });
      return res.status(200).json({ status: 'success', data: { questions } });
    } catch (err) { next(err); }
  }

  async createQuestion(req, res, next) {
    try {
      const question = await feedbackService.createQuestion(req.body || {}, req.user);
      return res.status(201).json({ status: 'success', message: 'Question added.', data: { question } });
    } catch (err) { next(err); }
  }

  async updateQuestion(req, res, next) {
    try {
      const question = await feedbackService.updateQuestion(Number(req.params.id), req.body || {}, req.user);
      return res.status(200).json({ status: 'success', data: { question } });
    } catch (err) { next(err); }
  }

  async reorderQuestions(req, res, next) {
    try {
      const questions = await feedbackService.reorderQuestions(req.body?.ids);
      return res.status(200).json({ status: 'success', data: { questions } });
    } catch (err) { next(err); }
  }

  async myPending(req, res, next) {
    try {
      const visits = await feedbackService.pendingForPatient(req.user);
      return res.status(200).json({ status: 'success', data: { visits } });
    } catch (err) { next(err); }
  }

  async submitOwn(req, res, next) {
    try {
      const result = await feedbackService.submit(Number(req.params.visitId), req.body || {}, req.user, 'portal');
      return res.status(201).json({ status: 'success', message: 'Thank you for your feedback.', data: result });
    } catch (err) { next(err); }
  }

  async submitPaper(req, res, next) {
    try {
      const result = await feedbackService.submit(Number(req.params.visitId), req.body || {}, req.user, 'paper');
      return res.status(201).json({ status: 'success', message: 'Paper form recorded.', data: result });
    } catch (err) { next(err); }
  }

  async overview(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await feedbackService.overview(startDate, endDate);
      return res.status(200).json({ status: 'success', data: { report } });
    } catch (err) { next(err); }
  }
}

module.exports = new FeedbackController();
