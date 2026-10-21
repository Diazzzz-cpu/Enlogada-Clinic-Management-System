/**
 * [1.136.0] Inviting a walk-in patient to the portal, and taking a record back out of one.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Most of this clinic's patients arrive as walk-ins with no account (83 active walk-in records on
 * the day this was written). [1.123.0] could join a record to an account only after the patient
 * had signed up on their own, and it did so on the desk's word alone: the account holder was never
 * asked, the address was never proven, and nothing could undo it. This replaces that with an
 * invitation the patient (or the family member who manages their records) accepts in the portal.
 *
 * ── What it adds ────────────────────────────────────────────────────────────────────────────
 *
 *   patient_invitations         one row per invitation sent: to whom, whose address it is, who
 *                               agreed and how, who sent it, and how it ended. No token: the email
 *                               carries no secret, and the address is proven by the account itself.
 *   patients.account_relationship   what the account holder is to this patient, once linked.
 *   patients.account_unlinked_at/_by   the last unlink, for the 30-day two-person rule.
 *   users.email_verified_at     when the account proved it receives mail at its address. Accepting
 *                               a record needs it. Backfilled only from code-confirmed sign-ups and
 *                               code-confirmed password resets.
 *   patient_visits.booked_online   stored at booking time, so "Booked online" never flips later.
 *   auth_codes purpose 'email_verify'   a code to prove an older account's address.
 *
 *   node src/scripts/migratePatientInvitations.js
 *   node src/scripts/migratePatientInvitations.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

const RELATIONSHIPS = "'self', 'parent_guardian', 'child', 'grandchild', 'spouse', 'sibling', 'other_family', 'caregiver'";

async function apply() {
  await db.withTransaction(async () => {
    // ── The invitation ─────────────────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS patient_invitations (
        id SERIAL PRIMARY KEY,
        patient_id INT NOT NULL,
        email VARCHAR(150) NOT NULL,
        relationship VARCHAR(20) NOT NULL,
        recipient_name VARCHAR(150),
        consent_basis VARCHAR(30) NOT NULL,
        invited_by INT,
        sends SMALLINT NOT NULL DEFAULT 1,
        last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        birthdate_attempts SMALLINT NOT NULL DEFAULT 0,
        address_differs_from_record BOOLEAN NOT NULL DEFAULT FALSE,
        accepted_at TIMESTAMP,
        accepted_by INT,
        revoked_at TIMESTAMP,
        revoked_by INT,
        revoked_reason VARCHAR(20),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_patient_invitations_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        CONSTRAINT fk_patient_invitations_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_patient_invitations_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_patient_invitations_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_patient_invitations_email CHECK (email = LOWER(email)),
        CONSTRAINT chk_patient_invitations_relationship CHECK (relationship IN (${RELATIONSHIPS})),
        CONSTRAINT chk_patient_invitations_consent CHECK (consent_basis IN
          ('own_address', 'patient_in_person', 'patient_by_phone', 'guardian_of_minor', 'responsible_for_patient')),
        -- Their own address is the patient's own; the patient agreeing in person or by phone, or a
        -- family member responsible for them, is always somebody else's address.
        CONSTRAINT chk_patient_invitations_consent_shape CHECK (
          (consent_basis <> 'own_address' OR relationship = 'self')
          AND (consent_basis NOT IN ('patient_in_person', 'patient_by_phone', 'responsible_for_patient')
               OR relationship <> 'self')
        ),
        CONSTRAINT chk_patient_invitations_recipient CHECK (relationship = 'self' OR recipient_name IS NOT NULL),
        CONSTRAINT chk_patient_invitations_closed CHECK (accepted_at IS NULL OR revoked_at IS NULL),
        CONSTRAINT chk_patient_invitations_revoked CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
        CONSTRAINT chk_patient_invitations_reason CHECK (revoked_reason IN
          ('withdrawn', 'superseded', 'linked', 'archived', 'declined', 'birthdate_locked', 'unlinked', 'not_delivered'))
      )
    `);
    // One open invitation per patient. "Open" cannot mention CURRENT_TIMESTAMP in an index, so an
    // expired one still counts: a new invitation supersedes it in the same transaction.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_invitations_open
        ON patient_invitations (patient_id) WHERE accepted_at IS NULL AND revoked_at IS NULL
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_patient_invitations_open_email
        ON patient_invitations (email) WHERE accepted_at IS NULL AND revoked_at IS NULL
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_patient_invitations_patient ON patient_invitations (patient_id, created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_patient_invitations_invited_by ON patient_invitations (invited_by)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_patient_invitations_accepted_by ON patient_invitations (accepted_by)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_patient_invitations_revoked_by ON patient_invitations (revoked_by)');

    // ── The record, once linked ────────────────────────────────────────────────────────────
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS account_relationship VARCHAR(20)');
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS account_unlinked_at TIMESTAMP');
    await db.query('ALTER TABLE patients ADD COLUMN IF NOT EXISTS account_unlinked_by INT');
    await db.query('ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_account_relationship');
    await db.query(`ALTER TABLE patients ADD CONSTRAINT chk_patients_account_relationship
                      CHECK (account_relationship IN (${RELATIONSHIPS}))`);
    await db.query('ALTER TABLE patients DROP CONSTRAINT IF EXISTS fk_patients_account_unlinked_by');
    await db.query(`ALTER TABLE patients ADD CONSTRAINT fk_patients_account_unlinked_by
                      FOREIGN KEY (account_unlinked_by) REFERENCES users(id) ON DELETE SET NULL`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_patients_account_unlinked_by ON patients (account_unlinked_by)');

    // ── The account's proven address ──────────────────────────────────────────────────────
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP');
    // Only what an emailed CODE proved. Matched on the descriptions completeSignup and
    // resetPassword write, because other things have written these actions: one dev database
    // holds an `auth.password_reset` for a password set by hand, which proved nothing. Keyed on
    // entity_id, the account; actor_id is SET NULL when a user goes.
    await db.query(`
      UPDATE users u SET email_verified_at = a.at
        FROM (SELECT entity_id, MIN(created_at) AS at
                FROM audit_log
               WHERE entity_type = 'user'
                 AND ((action = 'auth.account_created' AND description LIKE '%confirmed with an emailed code%')
                   OR (action = 'auth.password_reset' AND description LIKE 'Reset their password with an emailed code%'))
               GROUP BY entity_id) a
       WHERE u.id = a.entity_id AND u.email_verified_at IS NULL
    `);

    // ── How a visit came about ─────────────────────────────────────────────────────────────
    await db.query('ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS booked_online BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('ALTER TABLE patient_visits DROP CONSTRAINT IF EXISTS chk_visits_booked_online');
    await db.query(`ALTER TABLE patient_visits ADD CONSTRAINT chk_visits_booked_online
                      CHECK (NOT booked_online OR visit_type = 'Appointment')`);
    // A booking made before today was online when the account that made it is a patient's alone.
    await db.query(`
      UPDATE patient_visits pv SET booked_online = TRUE
       WHERE pv.visit_type = 'Appointment' AND NOT pv.booked_online
         AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = pv.created_by AND r.name = 'Client')
         AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                          WHERE ur.user_id = pv.created_by AND r.name <> 'Client')
    `);

    // ── A code that proves an older account's address ──────────────────────────────────────
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_purpose');
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_shape');
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_purpose
                      CHECK (purpose IN ('signup', 'password_reset', 'email_verify'))`);
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_shape CHECK (
                      (purpose IN ('password_reset', 'email_verify') AND user_id IS NOT NULL AND password_hash IS NULL)
                      OR (purpose = 'signup' AND user_id IS NULL AND password_hash IS NOT NULL
                          AND first_name IS NOT NULL AND last_name IS NOT NULL))`);
  });

  const { rows } = await db.query(`
    SELECT (SELECT COUNT(*)::int FROM patients WHERE user_id IS NULL AND archived_at IS NULL) AS walk_ins,
           (SELECT COUNT(*)::int FROM users WHERE email_verified_at IS NOT NULL) AS verified,
           (SELECT COUNT(*)::int FROM patient_visits WHERE booked_online) AS online`);
  const r = rows[0];
  console.log(`\n  ${r.walk_ins} active walk-in records can now be invited to the portal.`);
  console.log(`  ${r.verified} account(s) have a proven address; the rest confirm theirs with a code when they first accept a record.`);
  console.log(`  ${r.online} past booking(s) marked as booked online.\n`);
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query("DELETE FROM auth_codes WHERE purpose = 'email_verify'");
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_purpose');
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_shape');
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_purpose
                      CHECK (purpose IN ('signup', 'password_reset'))`);
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_shape CHECK (
                      (purpose = 'password_reset' AND user_id IS NOT NULL AND password_hash IS NULL)
                      OR (purpose = 'signup' AND user_id IS NULL AND password_hash IS NOT NULL
                          AND first_name IS NOT NULL AND last_name IS NOT NULL))`);
    await db.query('ALTER TABLE patient_visits DROP CONSTRAINT IF EXISTS chk_visits_booked_online');
    await db.query('ALTER TABLE patient_visits DROP COLUMN IF EXISTS booked_online');
    await db.query('ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at');
    await db.query('DROP INDEX IF EXISTS idx_patients_account_unlinked_by');
    await db.query('ALTER TABLE patients DROP CONSTRAINT IF EXISTS fk_patients_account_unlinked_by');
    await db.query('ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_account_relationship');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS account_unlinked_by');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS account_unlinked_at');
    await db.query('ALTER TABLE patients DROP COLUMN IF EXISTS account_relationship');
    await db.query('DROP TABLE IF EXISTS patient_invitations');
  });
  console.log('\n  Rolled back. Records linked by invitation stay linked; the invitations themselves are gone.\n');
}

(async () => {
  try {
    if (process.argv.includes('--rollback')) await rollback();
    else await apply();
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
