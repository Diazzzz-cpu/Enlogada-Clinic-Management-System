const nodemailer = require('nodemailer');
const env = require('./environment');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false, // TLS
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS
  }
});

/**
 * Whether outbound mail can actually be sent.
 *
 * BOTH halves are required, and the missing one is named. This used to check the username alone,
 * so a half-configured clinic — address filled in, App Password still blank — passed the guard and
 * then failed inside nodemailer on every single send. That reads as a mail outage rather than as a
 * setting nobody finished, and it fails once per released result rather than once at startup.
 *
 * The value of the password is never logged, only whether it is empty. Same rule the payment
 * gateway's isConfigured() follows, and for the same reason.
 */
/**
 * The domain the E2E suite registers every throwaway account under. It does not exist.
 *
 * Every booking confirmation and released result addressed to one of these was a real SMTP send
 * from the clinic's real Gmail account to a domain with no MX record — so it consumed the
 * account's daily quota and came back as a bounce. Two consequences, and the second is worse:
 *
 *   the quota is finite      a free Gmail account allows a few hundred recipients a day. A full
 *                            suite run creates accounts and releases results, so a few runs and a
 *                            demo seed exhaust it — measured on 2026-08-26, the clinic's account
 *                            returned "550-5.4.5 Daily user sending limit exceeded" and a real
 *                            patient's result would have failed to send with it.
 *
 *   bounces cost reputation  repeated delivery failures to a nonexistent domain are exactly what
 *                            spam filtering scores against a sender. The cost of that is not paid
 *                            by the test suite; it is paid by a patient whose results quietly
 *                            land in their junk folder months later.
 *
 * Scoped by RECIPIENT rather than by NODE_ENV on purpose: the suite runs against the development
 * server in development mode, so an environment check would not catch it, and a production
 * environment must keep behaving exactly as it does today.
 */
const E2E_EMAIL_DOMAIN = '@enlogada-e2e.test';

const missingMailConfig = () => {
  const missing = [];
  if (!env.SMTP_USER || env.SMTP_USER === 'dummy_user@gmail.com') missing.push('SMTP_USER (or EMAIL_USER)');
  if (!env.SMTP_PASS) missing.push('SMTP_PASS (or EMAIL_APP_PASSWORD)');
  return missing;
};

const sendEmail = async ({ to, subject, html, attachments }) => {
  try {
    // Before the configuration check, because this is true whatever the clinic has configured.
    if (typeof to === 'string' && to.toLowerCase().endsWith(E2E_EMAIL_DOMAIN)) {
      logger.info(`Email suppressed — ${to} is a test address. Subject: ${subject}`);
      return { skipped: true, testRecipient: true };
    }

    const missing = missingMailConfig();
    if (missing.length > 0) {
      logger.warn(
        `Email skipped — not configured (${missing.join(', ')}). ` +
        `Would have sent to: ${to}, Subject: ${subject}`
      );
      return { skipped: true, missing };
    }

    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
      // Only when there is something to attach. nodemailer accepts an empty array, but passing
      // one on every send makes it harder to see at a glance which paths carry a document.
      ...(attachments && attachments.length ? { attachments } : {})
    });

    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error('Email sending failed:', err);
    // Don't throw — email failure should not break the main workflow
    return { error: err.message };
  }
};

module.exports = { sendEmail, missingMailConfig, E2E_EMAIL_DOMAIN };
