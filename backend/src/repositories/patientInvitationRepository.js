const db = require('../config/database');

/**
 * Invitations to the patient portal. [1.136.0] See migrations.md and utils/portalInvitation.js.
 *
 * "Open" is: not accepted, not revoked. Expiry is a time, so it is read in each query rather than
 * stored; the partial unique index on open rows therefore counts an expired invitation too, and a
 * new one supersedes it in the same transaction.
 *
 * Every state change is one conditional UPDATE … RETURNING, so two requests racing (a double click,
 * two tabs) cannot both succeed: whichever loses gets no row back.
 */
const OPEN = 'accepted_at IS NULL AND revoked_at IS NULL';

class PatientInvitationRepository {
  async create({ patientId, email, relationship, recipientName, consentBasis, invitedBy, ttlDays, addressDiffersFromRecord }) {
    const { rows } = await db.query(
      `INSERT INTO patient_invitations
         (patient_id, email, relationship, recipient_name, consent_basis, invited_by, expires_at, address_differs_from_record)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + ($7 || ' days')::interval, $8)
       RETURNING *`,
      [patientId, email, relationship, recipientName || null, consentBasis, invitedBy, String(ttlDays), Boolean(addressDiffersFromRecord)]
    );
    return rows[0];
  }

  /** The newest invitation for a patient, open or not, with who sent it. */
  async findLatestForPatient(patientId) {
    const { rows } = await db.query(
      `SELECT i.*, i.expires_at <= CURRENT_TIMESTAMP AS expired,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (i.last_sent_at + INTERVAL '60 seconds' - CURRENT_TIMESTAMP))))::int AS resend_wait,
              inv.first_name AS invited_by_first_name, inv.last_name AS invited_by_last_name
         FROM patient_invitations i
         LEFT JOIN users inv ON inv.id = i.invited_by
        WHERE i.patient_id = $1
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 1`,
      [patientId]
    );
    return rows[0] || null;
  }

  async findById(id) {
    const { rows } = await db.query('SELECT * FROM patient_invitations WHERE id = $1', [id]);
    return rows[0] || null;
  }

  /** End whatever is open for this patient, with a reason. Returns the rows it ended. */
  async revokeOpenForPatient(patientId, { actorId = null, reason }) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, revoked_reason = $3
        WHERE patient_id = $1 AND ${OPEN}
        RETURNING *`,
      [patientId, actorId, reason]
    );
    return rows;
  }

  /** End one invitation, if it is still open. */
  async revoke(id, { actorId = null, reason }) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, revoked_reason = $3
        WHERE id = $1 AND ${OPEN}
        RETURNING *`,
      [id, actorId, reason]
    );
    return rows[0] || null;
  }

  /** Count another email for an open invitation, after the cooldown and within the limit. */
  async recordResend(id, { cooldownSeconds, maxSends, ttlDays }) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET sends = sends + 1, last_sent_at = CURRENT_TIMESTAMP,
              -- A resend gives the patient the full time again, as a new invitation would.
              expires_at = CURRENT_TIMESTAMP + ($4 || ' days')::interval
        WHERE id = $1 AND ${OPEN}
          AND sends < $3
          AND last_sent_at <= CURRENT_TIMESTAMP - ($2 || ' seconds')::interval
        RETURNING *`,
      [id, String(cooldownSeconds), maxSends, String(ttlDays)]
    );
    return rows[0] || null;
  }

  /**
   * Spend one try at the date of birth, BEFORE it is compared, in one statement: two requests
   * racing cannot both get a free try. Outside any transaction on purpose, so a wrong date that
   * then throws does not roll its own count back.
   */
  async spendBirthdateAttempt(id, maxAttempts) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET birthdate_attempts = birthdate_attempts + 1
        WHERE id = $1 AND ${OPEN}
          AND expires_at > CURRENT_TIMESTAMP
          AND birthdate_attempts < $2
        RETURNING *`,
      [id, maxAttempts]
    );
    return rows[0] || null;
  }

  /** Open again the invitations a failed send had superseded. */
  async reopen(ids) {
    if (!ids.length) return;
    await db.query(
      `UPDATE patient_invitations SET revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL
        WHERE id = ANY($1::int[]) AND revoked_reason = 'superseded'`,
      [ids]
    );
  }

  /** Give back a try at the date of birth, when the date was right. */
  async refundBirthdateAttempt(id) {
    await db.query(
      'UPDATE patient_invitations SET birthdate_attempts = GREATEST(0, birthdate_attempts - 1) WHERE id = $1',
      [id]
    );
  }

  async markAccepted(id, userId) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET accepted_at = CURRENT_TIMESTAMP, accepted_by = $2
        WHERE id = $1 AND ${OPEN} AND expires_at > CURRENT_TIMESTAMP
        RETURNING *`,
      [id, userId]
    );
    return rows[0] || null;
  }

  /** Open, unexpired invitations for an address, with whose record each is. */
  async findOpenForEmail(email) {
    const { rows } = await db.query(
      `SELECT i.id, i.patient_id, i.relationship, i.expires_at, i.birthdate_attempts,
              p.first_name, p.last_name
         FROM patient_invitations i
         JOIN patients p ON p.id = i.patient_id
        WHERE i.email = LOWER($1) AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at > CURRENT_TIMESTAMP
          AND p.user_id IS NULL AND p.archived_at IS NULL
        ORDER BY i.created_at`,
      [email]
    );
    return rows;
  }

  /** Invitation emails sent to an address in the last `hours`, across every record. */
  async countSendsToEmailSince(email, hours) {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(sends), 0)::int AS n
         FROM patient_invitations
        WHERE email = LOWER($1) AND last_sent_at > CURRENT_TIMESTAMP - ($2 || ' hours')::interval`,
      [email, String(hours)]
    );
    return rows[0].n;
  }

  /** Invitations one member of staff sent since the start of today. */
  async countSentByToday(userId) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM patient_invitations
        WHERE invited_by = $1 AND created_at >= CURRENT_DATE`,
      [userId]
    );
    return rows[0].n;
  }
}

module.exports = new PatientInvitationRepository();
