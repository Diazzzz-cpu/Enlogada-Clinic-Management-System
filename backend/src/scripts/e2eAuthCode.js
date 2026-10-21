/**
 * Puts a KNOWN code on a test account's newest open sign-up or reset code. [1.73.0]
 *
 * The suite cannot read an email: `sendEmail` never mails the @enlogada-e2e.test domain (it does
 * not exist, and every send cost the clinic's Gmail quota — see config/email.js). And the code is
 * stored only as a keyed hash, so it cannot be read back either. So a spec asks for a code the
 * normal way, then calls this to replace the stored hash with the hash of a code it knows, and
 * finishes through the real endpoint. Everything but the six digits is the production path.
 *
 * Shelled out to from frontend/tests/e2e/helpers/accounts.js, like e2eExpireHold.js, and for the
 * reason globalTeardown.js gives: the credentials and the `pg` client live here.
 *
 * Guards, each about what it may touch:
 *   - NODE_ENV must not be 'production'
 *   - only an @enlogada-e2e.test address
 *   - only an OPEN code (not used), the newest for that address and purpose
 *
 * A reset code is written after POST /auth/forgot-password has already answered — that is what
 * keeps the answer's timing from revealing whether the account exists — so this waits up to five
 * seconds for the row to appear.
 *
 *   node src/scripts/e2eAuthCode.js --email=a@enlogada-e2e.test --purpose=signup --code=246810
 *   node src/scripts/e2eAuthCode.js --email=… --purpose=password_reset --code=… --ready-to-resend
 *
 * --ready-to-resend also moves the last send an hour back, so a spec can test "Send a new code"
 * without waiting out the 60-second cooldown.
 */
require('dotenv').config();
const db = require('../config/database');
const env = require('../config/environment');
const { createCodeHasher, isWellFormedCode } = require('../utils/authCodes');

const E2E_DOMAIN = '@enlogada-e2e.test';
const PURPOSES = ['signup', 'password_reset', 'email_verify'];

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('auth-code refused: NODE_ENV=production');
    process.exit(1);
  }

  const email = String(arg('email') || '').trim().toLowerCase();
  const purpose = arg('purpose');
  const code = arg('code');

  if (!email.endsWith(E2E_DOMAIN)) {
    console.error(`auth-code refused: ${email || '(no --email)'} is not a ${E2E_DOMAIN} address`);
    process.exit(1);
  }
  if (!PURPOSES.includes(purpose)) {
    console.error(`auth-code refused: --purpose must be one of ${PURPOSES.join(', ')}`);
    process.exit(1);
  }
  if (!isWellFormedCode(code)) {
    console.error('auth-code refused: --code must be six digits');
    process.exit(1);
  }

  const { hashCode } = createCodeHasher(env.JWT_SECRET);
  const readyToResend = process.argv.includes('--ready-to-resend');

  for (let waited = 0; waited <= 5000; waited += 200) {
    const { rows } = await db.query(
      `UPDATE auth_codes
          SET code_hash = $1,
              attempts = 0,
              last_sent_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP - interval '1 hour' ELSE last_sent_at END
        WHERE id = (
                SELECT id FROM auth_codes
                 WHERE purpose = $2 AND email = $3 AND consumed_at IS NULL
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1)
      RETURNING id`,
      [hashCode(code), purpose, email, readyToResend]
    );
    if (rows.length) {
      console.log(`auth-code set on auth_codes ${rows[0].id} (${purpose}, ${email})`);
      process.exit(0);
    }
    await sleep(200);
  }

  console.error(`auth-code failed: no open ${purpose} code for ${email}. Has migrateAuthCodes.js been run?`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`auth-code failed: ${err.message}`);
  process.exit(1);
});
