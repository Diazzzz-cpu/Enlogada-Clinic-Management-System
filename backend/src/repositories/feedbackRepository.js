const db = require('../config/database');

/**
 * Patient feedback: the questions, and one form per visit. [1.112.0]
 *
 * The form's own columns live on `patient_visits` (one per visit), its answers in
 * `visit_feedback_answers`. The patient's name is never copied anywhere: it is read through the
 * visit, so a corrected record corrects every form it filled in.
 */
class FeedbackRepository {
  // ── Questions ──────────────────────────────────────────────────────────────────────────────

  /** Questions in order, with how many answers each has (an answered question cannot be reworded). */
  async findQuestions({ activeOnly = true } = {}) {
    const { rows } = await db.query(
      `SELECT q.id, q.prompt_ceb, q.prompt_tl, q.prompt_en, q.sort_order, q.is_active, q.created_at,
              (SELECT COUNT(*)::int FROM visit_feedback_answers a WHERE a.question_id = q.id) AS answer_count
         FROM feedback_questions q
        ${activeOnly ? 'WHERE q.is_active' : ''}
        ORDER BY q.sort_order, q.id`
    );
    return rows;
  }

  async findQuestionById(id) {
    const { rows } = await db.query(
      `SELECT q.*, (SELECT COUNT(*)::int FROM visit_feedback_answers a WHERE a.question_id = q.id) AS answer_count
         FROM feedback_questions q WHERE q.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async createQuestion({ promptCeb, promptTl, promptEn, createdBy }) {
    const { rows } = await db.query(
      `INSERT INTO feedback_questions (prompt_ceb, prompt_tl, prompt_en, sort_order, created_by)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM feedback_questions), $4)
       RETURNING *`,
      [promptCeb, promptTl, promptEn, createdBy || null]
    );
    return rows[0];
  }

  /** Writes only the fields given; the service decides what may change. */
  async updateQuestion(id, { promptCeb, promptTl, promptEn, isActive }) {
    const { rows } = await db.query(
      `UPDATE feedback_questions
          SET prompt_ceb = COALESCE($2, prompt_ceb),
              prompt_tl  = COALESCE($3, prompt_tl),
              prompt_en  = COALESCE($4, prompt_en),
              is_active  = COALESCE($5, is_active),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [id, promptCeb ?? null, promptTl ?? null, promptEn ?? null, isActive ?? null]
    );
    return rows[0] || null;
  }

  /** Puts the questions in the order given, one transaction so a half-applied order is impossible. */
  async reorderQuestions(ids) {
    return db.withTransaction(async () => {
      for (const [i, id] of ids.entries()) {
        await db.query('UPDATE feedback_questions SET sort_order = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id, i + 1]);
      }
    });
  }

  // ── Forms ──────────────────────────────────────────────────────────────────────────────────

  /** What deciding whether a visit may be rated needs: its state, its patient and its owner. */
  async findVisitForFeedback(visitId) {
    const { rows } = await db.query(
      `SELECT pv.id, pv.status, pv.created_at, pv.feedback_submitted_at,
              p.id AS patient_id, p.user_id, p.first_name, p.last_name
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
        WHERE pv.id = $1`,
      [visitId]
    );
    return rows[0] || null;
  }

  /**
   * Stores one form. The UPDATE only matches a visit with no form yet, so two submissions racing
   * for the same visit cannot both land: the second finds nothing to update and is told so.
   *
   * @returns {Promise<boolean>} false when the visit already had a form
   */
  async saveForm(visitId, { answers, comment, channel, language, recordedBy, nameHidden }) {
    return db.withTransaction(async () => {
      const { rowCount } = await db.query(
        `UPDATE patient_visits
            SET feedback_submitted_at = CURRENT_TIMESTAMP,
                feedback_comment = $2, feedback_channel = $3, feedback_language = $4,
                feedback_recorded_by = $5, feedback_name_hidden = $6
          WHERE id = $1 AND feedback_submitted_at IS NULL`,
        [visitId, comment, channel, language, recordedBy || null, nameHidden]
      );
      if (!rowCount) return false;
      for (const a of answers) {
        await db.query(
          'INSERT INTO visit_feedback_answers (patient_visit_id, question_id, rating) VALUES ($1, $2, $3)',
          [visitId, a.questionId, a.rating]
        );
      }
      return true;
    });
  }

  /**
   * A signed-in patient's visits waiting to be rated: finished, not rated, and recent enough that
   * they still remember it. Across every profile the account holds, newest first.
   */
  async findPendingForUser(userId, days) {
    const { rows } = await db.query(
      `SELECT pv.id AS visit_id, pv.created_at AS visit_date, p.id AS patient_id, p.first_name, p.last_name
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
        WHERE p.user_id = $1
          AND pv.status = 'Completed'
          AND pv.feedback_submitted_at IS NULL
          AND pv.created_at >= CURRENT_DATE - $2::int
        ORDER BY pv.created_at DESC`,
      [userId, days]
    );
    return rows;
  }

  // ── Overview ───────────────────────────────────────────────────────────────────────────────
  //
  // Bucketed by the VISIT date, like every other clinical figure: a form that arrives a week
  // later belongs to the visit it describes. Half-open ranges on the raw column, never ::date.

  async countVisits(startDate, endDate) {
    const { rows } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
              COUNT(*) FILTER (WHERE feedback_submitted_at IS NOT NULL)::int AS responses,
              COUNT(*) FILTER (WHERE feedback_channel = 'portal')::int AS portal,
              COUNT(*) FILTER (WHERE feedback_channel = 'paper')::int AS paper
         FROM patient_visits
        WHERE created_at >= $1::date AND created_at < ($2::date + 1)`,
      [startDate, endDate]
    );
    return rows[0];
  }

  /** The questions asked now, plus any turned off since that still have answers in the range. */
  async findQuestionsForRange(startDate, endDate) {
    const { rows } = await db.query(
      `SELECT q.id, q.prompt_ceb, q.prompt_tl, q.prompt_en, q.sort_order, q.is_active
         FROM feedback_questions q
        WHERE q.is_active
           OR EXISTS (SELECT 1 FROM visit_feedback_answers a
                        JOIN patient_visits pv ON pv.id = a.patient_visit_id
                       WHERE a.question_id = q.id
                         AND pv.created_at >= $1::date AND pv.created_at < ($2::date + 1))
        ORDER BY q.sort_order, q.id`,
      [startDate, endDate]
    );
    return rows;
  }

  async countRatings(startDate, endDate) {
    const { rows } = await db.query(
      `SELECT a.question_id, a.rating, COUNT(*)::int AS count
         FROM visit_feedback_answers a
         JOIN patient_visits pv ON pv.id = a.patient_visit_id
        WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
        GROUP BY a.question_id, a.rating`,
      [startDate, endDate]
    );
    return rows;
  }

  /**
   * Every form in the range, newest first, with its answers. The name is withheld HERE when the
   * patient asked, so no screen or export can show it by mistake.
   */
  async findForms(startDate, endDate, limit = 500) {
    const { rows } = await db.query(
      `SELECT pv.id AS visit_id, pv.created_at AS visit_date, pv.queue_number,
              pv.feedback_submitted_at, pv.feedback_comment, pv.feedback_channel, pv.feedback_language,
              pv.feedback_name_hidden,
              CASE WHEN pv.feedback_name_hidden THEN NULL ELSE p.first_name || ' ' || p.last_name END AS patient_name,
              CASE WHEN pv.feedback_channel = 'paper' THEN rec.first_name || ' ' || rec.last_name END AS recorded_by_name,
              COALESCE((SELECT json_object_agg(a.question_id, a.rating)
                          FROM visit_feedback_answers a WHERE a.patient_visit_id = pv.id), '{}'::json) AS answers
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
         LEFT JOIN users rec ON rec.id = pv.feedback_recorded_by
        WHERE pv.feedback_submitted_at IS NOT NULL
          AND pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
        ORDER BY pv.created_at DESC
        LIMIT $3`,
      [startDate, endDate, limit]
    );
    return rows;
  }
}

module.exports = new FeedbackRepository();
