require('dotenv').config();

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`CRITICAL CONFIG ERROR: Environment variable "${envVar}" is missing.`);
  }
}

// The JWT secret is the only thing standing between a stranger and every account in the system.
// Presence alone was the entire check, which is not enough for two reasons.
//
// `.env.example` shipped a working placeholder, and the setup instructions say to base `.env` on
// it — so a deployment that copies the file without editing this line signs tokens with a string
// published in this repository. An attacker signs `{ userId: 1 }` themselves, and because
// authority is now read from the database for whatever userId the token names ([1.11.0]), they
// receive the full role set of user 1: the seeded SuperAdmin.
//
// Short secrets are brute-forceable offline against any captured token, so a length floor matters
// independently of whether the value is a known one.
const WEAK_SECRETS = new Set([
  'supersecretkeyreplaceinproduction',
  'secret',
  'changeme',
  'your_jwt_secret_here'
]);

if (WEAK_SECRETS.has(process.env.JWT_SECRET.trim().toLowerCase())) {
  throw new Error(
    'CRITICAL CONFIG ERROR: JWT_SECRET is still the example value. Anyone with this repository ' +
      'can mint valid tokens for any account. Generate one with: openssl rand -hex 32'
  );
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error(
    `CRITICAL CONFIG ERROR: JWT_SECRET is ${process.env.JWT_SECRET.length} characters; at least 32 ` +
      'are required. Generate one with: openssl rand -hex 32'
  );
}

module.exports = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  // Shortened from 7d. Roles and permissions are baked into the token at login, so a long-lived
  // token also means a long-lived stale authorization snapshot: revoke a role or deactivate an
  // account and the old token keeps working until it expires, because there is no revocation
  // list. A week of that on a system holding patient records is too generous — 1d covers a
  // working shift without forcing repeated sign-ins. Override with JWT_EXPIRES_IN if needed.
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  // --- Tax treatment -------------------------------------------------------------------
  // Whether the clinic is VAT-registered with the BIR. This is not cosmetic: it changes what a
  // senior citizen or PWD actually pays.
  //
  // Under RA 9994 and RA 10754 a VAT-registered establishment must treat the sale as VAT-EXEMPT
  // before discounting — strip the 12% VAT from the VAT-inclusive price, then apply the 20% to
  // that VAT-exempt base. A non-VAT establishment simply applies 20% to the price. The two give
  // materially different answers: on a PHP 1,000 service the patient pays 714.29 the correct way
  // and 800.00 the flat way, so getting this wrong overcharges the patient by 85.71 and
  // understates the deduction the clinic can claim.
  //
  // Prices in `tests` are stored VAT-INCLUSIVE (that is the shelf price a patient is quoted), so
  // the VAT is extracted from them rather than added on top.
  //
  // Defaults to true for a VAT-registered establishment, which ENLOGADA IS NOT — its
  // BIR-registered invoice reads "Non VAT Reg. TIN : 412-980-963-00000", so `false` is what
  // belongs in this clinic's .env. The default is left at true only because it is the safer
  // assumption for an unknown deployment: claiming a VAT exemption you are not registered for is
  // worse than not claiming one you are. Getting it wrong costs 85.71 per 1,000 on every senior
  // and PWD sale, and no test catches it — the specs read this value and adapt. — and confirm with your accountant before changing it.
  CLINIC_VAT_REGISTERED: process.env.CLINIC_VAT_REGISTERED !== 'false',
  VAT_RATE: parseFloat(process.env.VAT_RATE || '0.12'),

  /**
   * The clinic's own identity, for documents the backend composes on its own — currently the
   * released-result email. [1.61.0]
   *
   * The defaults are the same values frontend/src/lib/clinic.js falls back to, and that is the
   * point: a report emailed to a patient carries the letterhead they read on the website and on
   * their receipt. Three sources drifting apart is a document nobody can rely on, which is the
   * reasoning clinic.js already sets out for the printed receipt.
   *
   * TIN and business permit are deliberately absent. They belong on a BIR document, and a
   * diagnostic report is not one — inventing them onto a clinical email would be worse than the
   * receipt case, where at least the patient might file it for reimbursement.
   */
  CLINIC_NAME: process.env.CLINIC_NAME || 'Enlogada Ultrasound & Diagnostic Clinic',
  CLINIC_ADDRESS: process.env.CLINIC_ADDRESS || 'Bugo, Cagayan de Oro, Philippines 9000',
  CLINIC_PHONE: process.env.CLINIC_PHONE || '0936 132 0650',
  CLINIC_EMAIL: process.env.CLINIC_EMAIL || 'enlogadaclinic2011@gmail.com',

  // Outbound mail. EMAIL_* is accepted as an alias for SMTP_* because that is how Gmail names
  // these when you generate an App Password, and an operator following Google's own wording
  // should not end up with a silently unconfigured mailer. SMTP_* wins where both are set, being
  // the more specific and the one this project has always documented.
  //
  // The password is read from the environment and nowhere else — never a default, never a
  // fallback literal, never logged. `logSafeConfig` below must never gain a line for it.
  SMTP_HOST: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || process.env.EMAIL_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'Enlogada Clinic <noreply@enlogadaclinic.com>',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // --- Online payment gateway (GCash / Maya) --------------------------------------------
  // GCash and Maya do not issue direct merchant API access to applications; in the Philippines
  // you reach them through a BSP-regulated processor. This integration targets PayMongo's
  // hosted Checkout Session, which redirects the payer to GCash's / Maya's own real payment
  // pages and settles back over a signed webhook.
  //
  // Deliberately NOT in requiredEnvVars: with no key configured the gateway reports itself
  // unavailable and the clinic falls back to the cashier-recorded payment path, which is
  // exactly how the system behaved before online payment existed. Nothing breaks when these
  // are blank.
  //
  // PAYMONGO_API_BASE is configurable rather than hardcoded because PayMongo documents this
  // endpoint under both /v1 and /v2; set whichever your account's dashboard shows.
  PAYMONGO_SECRET_KEY: process.env.PAYMONGO_SECRET_KEY || '',
  PAYMONGO_WEBHOOK_SECRET: process.env.PAYMONGO_WEBHOOK_SECRET || '',
  PAYMONGO_API_BASE: process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com/v1'
};
