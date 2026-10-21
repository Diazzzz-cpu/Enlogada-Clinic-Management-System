/**
 * Moves a test invitation, or a test account, to a state a spec cannot wait for. [1.136.0]
 *
 *   --expire            the newest open invitation to this address runs out (14 days cannot be waited)
 *   --ready-to-resend   its last email moves an hour back, past the 60-second cooldown
 *   --unverify          the ACCOUNT at this address has not proven it, as an account made before
 *                       [1.73.0] has not, so a spec can reach "Confirm your email first"
 *
 * Guards, as e2eAuthCode.js: not under NODE_ENV=production, and only an @enlogada-e2e.test address.
 * Shelled out to from frontend/tests/e2e/helpers/invitations.js.
 *
 *   node src/scripts/e2eInvitation.js --email=a@enlogada-e2e.test --expire
 */
require('dotenv').config();
const db = require('../config/database');

const E2E_DOMAIN = '@enlogada-e2e.test';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('invitation refused: NODE_ENV=production');
    process.exit(1);
  }
  const email = String(arg('email') || '').trim().toLowerCase();
  if (!email.endsWith(E2E_DOMAIN)) {
    console.error(`invitation refused: ${email || '(no --email)'} is not a ${E2E_DOMAIN} address`);
    process.exit(1);
  }

  if (flag('unverify')) {
    const { rowCount } = await db.query('UPDATE users SET email_verified_at = NULL WHERE LOWER(email) = $1', [email]);
    console.log(`invitation: ${rowCount} account(s) at ${email} unverified`);
  }

  if (flag('expire') || flag('ready-to-resend')) {
    const { rows } = await db.query(
      `UPDATE patient_invitations
          SET expires_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP - interval '1 minute' ELSE expires_at END,
              last_sent_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP - interval '1 hour' ELSE last_sent_at END
        WHERE id = (SELECT id FROM patient_invitations
                     WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL
                     ORDER BY created_at DESC LIMIT 1)
        RETURNING id`,
      [email, flag('expire'), flag('ready-to-resend')]
    );
    if (!rows.length) {
      console.error(`invitation: no open invitation to ${email}`);
      process.exit(1);
    }
    console.log(`invitation ${rows[0].id} (${email}) moved`);
  }
}

main()
  .catch((err) => {
    console.error('invitation failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
