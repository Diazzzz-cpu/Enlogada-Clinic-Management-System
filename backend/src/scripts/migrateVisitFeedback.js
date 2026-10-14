/**
 * Patient feedback on a visit. [1.112.0]
 *
 * The clinic hands out a paper form — four questions, each ticked MAAYO / OKAY LANG / DILI MAAYO,
 * and a comment box. This puts it in the system: a patient answers in the portal once a visit's
 * results are released, reception types in the paper forms of walk-ins, and Admin reads the
 * overview and decides which questions are asked.
 *
 * ── Two tables, because two is the floor with real foreign keys ─────────────────────────────
 *
 *   feedback_questions      what is asked: the wording in Cebuano, Tagalog and English, its
 *                           place in the order, and whether it is asked at all.
 *   visit_feedback_answers  one row per visit per question, rating 1..3.
 *
 * The rest is ONE form per visit, so it sits on `patient_visits` as columns — the comment, when
 * and how it arrived, the language, who typed a paper form in, and whether the patient asked for
 * their name to be left off the overview. The doctor's-request upload [1.106.0] lives there for
 * the same reason. Name and date are never copied: they come through the visit's patient.
 *
 * Three language COLUMNS rather than a translations table: the clinic's set of languages is
 * fixed, and a translations table only pays for itself when languages keep being added.
 *
 * ── Rules the schema holds ──────────────────────────────────────────────────────────────────
 *
 *   - an answered question cannot be deleted (RESTRICT), only turned off, so a past answer
 *     always has the question it answered;
 *   - a paper form names who typed it in (chk_visits_feedback_paper);
 *   - deleting a visit takes its answers with it (CASCADE), as it takes everything else.
 *
 * Also grants `feedback:manage` (Admin: write and order the questions) and `feedback:record`
 * (Receptionist and Admin: type in a paper form), and loads the four questions from the clinic's
 * form when there are none yet. The Cebuano is the form's own wording; the Tagalog and English
 * are drafts for the clinic to confirm, and stay editable until a question is first answered.
 *
 *   node src/scripts/migrateVisitFeedback.js
 *   node src/scripts/migrateVisitFeedback.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

const QUESTIONS = [
  {
    ceb: 'Ma abi-abihon ba ang mga staff nga niatiman sa imo?',
    tl: 'Magiliw ba ang mga staff na nag-asikaso sa iyo?',
    en: 'Were the staff who attended to you welcoming?',
  },
  {
    ceb: 'On time ba ang pag hatag sa imohang result?',
    tl: 'Naibigay ba sa tamang oras ang iyong resulta?',
    en: 'Was your result released on time?',
  },
  {
    ceb: 'Limpyo ba ang reception area ug ang kuha-anan sa dugo?',
    tl: 'Malinis ba ang reception area at ang kuhaan ng dugo?',
    en: 'Were the reception and blood-extraction areas clean?',
  },
  {
    ceb: 'Limpyo ba ang rest room (CR)?',
    tl: 'Malinis ba ang CR?',
    en: 'Was the restroom (CR) clean?',
  },
];

const PERMISSIONS = [
  { name: 'feedback:manage', module: 'Feedback', description: 'Write, order and turn off the patient feedback questions', roles: ['Admin'] },
  { name: 'feedback:record', module: 'Feedback', description: "Type in a walk-in patient's paper feedback form", roles: ['Receptionist', 'Admin'] },
];

async function apply(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS feedback_questions (
      id          SERIAL PRIMARY KEY,
      prompt_ceb  TEXT NOT NULL,
      prompt_tl   TEXT NOT NULL,
      prompt_en   TEXT NOT NULL,
      sort_order  INT NOT NULL,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_by  INT,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_feedback_questions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS visit_feedback_answers (
      patient_visit_id INT NOT NULL,
      question_id      INT NOT NULL,
      rating           SMALLINT NOT NULL,
      CONSTRAINT pk_visit_feedback_answers PRIMARY KEY (patient_visit_id, question_id),
      CONSTRAINT fk_feedback_answers_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id) ON DELETE CASCADE,
      CONSTRAINT fk_feedback_answers_question FOREIGN KEY (question_id) REFERENCES feedback_questions(id),
      CONSTRAINT chk_feedback_answers_rating CHECK (rating IN (1, 2, 3))
    )`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_feedback_answers_question ON visit_feedback_answers (question_id)');
  logger.info('  + feedback_questions, visit_feedback_answers');

  await client.query(`
    ALTER TABLE patient_visits
      ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS feedback_comment TEXT,
      ADD COLUMN IF NOT EXISTS feedback_channel VARCHAR(10),
      ADD COLUMN IF NOT EXISTS feedback_language VARCHAR(3),
      ADD COLUMN IF NOT EXISTS feedback_recorded_by INT,
      ADD COLUMN IF NOT EXISTS feedback_name_hidden BOOLEAN NOT NULL DEFAULT FALSE`);
  const constraints = [
    ['chk_visits_feedback_channel', "CHECK (feedback_channel IN ('portal', 'paper'))"],
    ['chk_visits_feedback_language', "CHECK (feedback_language IN ('ceb', 'tl', 'en'))"],
    ['chk_visits_feedback_paper', "CHECK (feedback_channel IS DISTINCT FROM 'paper' OR feedback_recorded_by IS NOT NULL)"],
    ['fk_visits_feedback_recorded_by', 'FOREIGN KEY (feedback_recorded_by) REFERENCES users(id) ON DELETE SET NULL'],
  ];
  for (const [name, def] of constraints) {
    const { rows } = await client.query('SELECT 1 FROM pg_constraint WHERE conname = $1', [name]);
    if (!rows.length) await client.query(`ALTER TABLE patient_visits ADD CONSTRAINT ${name} ${def}`);
  }
  await client.query(`CREATE INDEX IF NOT EXISTS idx_patient_visits_feedback_recorded_by
                        ON patient_visits (feedback_recorded_by) WHERE feedback_recorded_by IS NOT NULL`);
  logger.info('  + patient_visits.feedback_* (six columns, their checks and the recorder FK)');

  for (const p of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (name, module, description) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
      [p.name, p.module, p.description]
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ANY($1::text[]) AND p.name = $2
       ON CONFLICT DO NOTHING`,
      [p.roles, p.name]
    );
  }
  logger.info('  + permissions feedback:manage (Admin), feedback:record (Receptionist, Admin)');

  const { rows: [{ count }] } = await client.query('SELECT COUNT(*)::int AS count FROM feedback_questions');
  if (count === 0) {
    for (const [i, q] of QUESTIONS.entries()) {
      await client.query(
        'INSERT INTO feedback_questions (prompt_ceb, prompt_tl, prompt_en, sort_order) VALUES ($1, $2, $3, $4)',
        [q.ceb, q.tl, q.en, i + 1]
      );
    }
    logger.info(`  + the clinic's ${QUESTIONS.length} questions, from its paper form`);
  } else {
    logger.info(`  = ${count} question(s) already on file; none added`);
  }
}

async function rollback(client) {
  await client.query('DROP TABLE IF EXISTS visit_feedback_answers');
  await client.query('DROP TABLE IF EXISTS feedback_questions');
  await client.query('DROP INDEX IF EXISTS idx_patient_visits_feedback_recorded_by');
  for (const name of ['chk_visits_feedback_channel', 'chk_visits_feedback_language', 'chk_visits_feedback_paper', 'fk_visits_feedback_recorded_by']) {
    await client.query(`ALTER TABLE patient_visits DROP CONSTRAINT IF EXISTS ${name}`);
  }
  await client.query(`
    ALTER TABLE patient_visits
      DROP COLUMN IF EXISTS feedback_name_hidden,
      DROP COLUMN IF EXISTS feedback_recorded_by,
      DROP COLUMN IF EXISTS feedback_language,
      DROP COLUMN IF EXISTS feedback_channel,
      DROP COLUMN IF EXISTS feedback_comment,
      DROP COLUMN IF EXISTS feedback_submitted_at`);
  await client.query("DELETE FROM permissions WHERE name IN ('feedback:manage', 'feedback:record')");
  logger.info('  - the feedback tables, columns and permissions');
}

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    logger.info(`[1.112.0] ${reversing ? 'Removing' : 'Adding'} patient feedback…`);
    await client.query('BEGIN');
    if (reversing) await rollback(client); else await apply(client);
    await client.query('COMMIT');
    logger.info(`[1.112.0] ${reversing ? 'Reversed.' : 'Done.'}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.112.0] Failed, nothing changed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
