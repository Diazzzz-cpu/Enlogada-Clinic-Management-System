const env = require('../config/environment');
const { sendEmail } = require('../config/email');
const { escapeHtml } = require('./resultEmailTemplate');
const { CODE_TTL_MINUTES } = require('../utils/authCodes');

/**
 * The emails an account receives about itself: the sign-up code, the password-reset code, and
 * the notice that a password was changed. [1.73.0]
 *
 * ── What the old reset email got wrong ──────────────────────────────────────────────────────
 *
 * It interpolated the account's first name straight into HTML. A self-registered patient chooses
 * that value, so a name containing markup rendered as markup in the clinic's own email. Every
 * value from the database is escaped here.
 *
 * ── The code is never in the subject ────────────────────────────────────────────────────────
 *
 * A subject line is shown on a locked phone's notification screen, to anyone holding it. The code
 * is in the body only.
 *
 * Every function returns sendEmail's result unchanged — it never throws — so the caller decides
 * whether an undelivered code is fatal. For a sign-up it is: the person is about to be asked for
 * a code that never left. For a reset it is logged and nothing is said, because saying it would
 * tell a stranger that the address has an account.
 */

const clinicName = () => env.CLINIC_NAME || 'Enlogada Ultrasound and Diagnostic Clinic';

/** Inline styles and a table frame: mail clients strip <style> blocks. See resultEmailTemplate. */
function frame(inner) {
  return `
<div style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:18px 24px;background:#477233;color:#ffffff;font-size:16px;font-weight:bold;">
        ${escapeHtml(clinicName())}
      </td>
    </tr>
    <tr>
      <td style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
        ${inner}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.5;color:#64748b;">
        ${escapeHtml(env.CLINIC_ADDRESS || '')}${env.CLINIC_PHONE ? ` &nbsp;·&nbsp; ${escapeHtml(env.CLINIC_PHONE)}` : ''}
      </td>
    </tr>
  </table>
</div>`;
}

function codeBlock(code) {
  return `
    <p style="margin:20px 0;text-align:center;">
      <span style="display:inline-block;padding:12px 22px;border-radius:10px;background:#f1f5f9;border:1px solid #e2e8f0;
                   font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:#0f172a;">
        ${escapeHtml(code)}
      </span>
    </p>
    <p style="margin:0 0 12px;color:#475569;">
      The code works for ${CODE_TTL_MINUTES} minutes. Never share it — the clinic will never ask you for it.
    </p>`;
}

const greeting = (firstName) => `<p style="margin:0 0 12px;">Hello ${escapeHtml(firstName || 'there')},</p>`;

class AccountEmailService {
  sendSignupCode({ to, firstName, code }) {
    return sendEmail({
      to,
      subject: `Confirm your email for ${clinicName()}`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0;">Enter this code on the sign-up page to finish creating your account.</p>
        ${codeBlock(code)}
        <p style="margin:0;color:#475569;">
          If you did not try to create an account, ignore this email. Without the code, no account is created.
        </p>`),
    });
  }

  sendResetCode({ to, firstName, code }) {
    return sendEmail({
      to,
      subject: `Your ${clinicName()} password reset code`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0;">Enter this code on the sign-in page to choose a new password.</p>
        ${codeBlock(code)}
        <p style="margin:0;color:#475569;">
          If you did not ask to reset your password, ignore this email. Your password stays as it is.
        </p>`),
    });
  }

  /** [1.136.0] Proving an existing account's address before it accepts a patient record. */
  sendEmailCheckCode({ to, firstName, code }) {
    return sendEmail({
      to,
      subject: `Confirm your email for ${clinicName()}`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0;">Enter this code in the patient portal to confirm this is your email address.</p>
        ${codeBlock(code)}
        <p style="margin:0;color:#475569;">
          If you did not ask for this, ignore this email. Nothing changes without the code.
        </p>`),
    });
  }

  /**
   * An invitation to the portal. [1.136.0]
   *
   * No link with a secret in it, no test, no result, no date of a visit: a subject line shows on a
   * locked phone, and a household reads one inbox. The patient's first name and last initial are
   * there so a family manager knows whose record it is. The address is proven by the account
   * that signs in, and the record is accepted with its date of birth.
   */
  sendPatientInvitation({ to, patientName, forSelf, relationshipLabel, expiresOn }) {
    const portal = env.FRONTEND_URL || '';
    const opening = forSelf
      ? `The front desk at ${escapeHtml(clinicName())} has invited you to our patient portal.`
      : `The front desk at ${escapeHtml(clinicName())} has invited you to see <strong>${escapeHtml(patientName)}</strong>'s record in our patient portal${relationshipLabel ? `, as their ${escapeHtml(relationshipLabel.toLowerCase())}` : ''}.`;
    return sendEmail({
      to,
      subject: forSelf
        ? `Your invitation to the ${clinicName()} patient portal`
        : `You're invited to see a family member's record at ${clinicName()}`,
      html: frame(`
        <p style="margin:0 0 12px;">Hello,</p>
        <p style="margin:0 0 12px;">${opening}
          There you can see visits with us, read the reports we release as digital copies, and find receipts.</p>
        <p style="margin:0 0 12px;">
          <strong>Create an account, or sign in, with this address: ${escapeHtml(to)}.</strong>
          Your portal will then show "A record is waiting". Confirm it with
          ${forSelf ? 'your' : `${escapeHtml(patientName)}'s`} date of birth.
        </p>
        ${portal ? `<p style="margin:16px 0;text-align:center;">
          <a href="${escapeHtml(portal)}" style="display:inline-block;padding:10px 20px;border-radius:10px;background:#477233;color:#ffffff;font-weight:bold;text-decoration:none;">Open the patient portal</a>
        </p>` : ''}
        <p style="margin:0 0 12px;color:#475569;">This invitation lasts until ${escapeHtml(expiresOn)}. If it runs out, ask the front desk for a new one.</p>
        <p style="margin:0;color:#475569;">
          Not expecting this? You can ignore it. Nothing is shared unless someone signed in with this address confirms the record.
        </p>`),
    });
  }

  /**
   * To a record's own address, when the invitation went somewhere else. [1.136.0] So a record
   * cannot be given to a different address without the address on file hearing about it.
   */
  sendRecordAccessNotice({ to, accepted }) {
    const contact = [env.CLINIC_PHONE, env.CLINIC_EMAIL].filter(Boolean).map(escapeHtml).join(' or ');
    return sendEmail({
      to,
      subject: `A portal account and your record at ${clinicName()}`,
      html: frame(`
        <p style="margin:0 0 12px;">Hello,</p>
        <p style="margin:0 0 12px;">
          ${accepted
            ? 'A patient portal account has just been given access to a record at our clinic that has this email address on it.'
            : 'Our front desk has invited a patient portal account to see a record at our clinic that has this email address on it.'}
          This is usually a family member who manages bookings and results for the patient.
        </p>
        <p style="margin:0;color:#475569;">
          If you were not expecting this, contact the clinic${contact ? ` at ${contact}` : ''}.
        </p>`),
    });
  }

  /** To the account holder, after they accepted a record. Detection for a link nobody expected. */
  sendRecordLinked({ to, firstName }) {
    const contact = [env.CLINIC_PHONE, env.CLINIC_EMAIL].filter(Boolean).map(escapeHtml).join(' or ');
    return sendEmail({
      to,
      subject: `A clinic record was added to your ${clinicName()} account`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0 0 12px;">A patient record from our clinic was just added to your portal account. You can see it under Profile.</p>
        <p style="margin:0;color:#475569;">If this was not you, contact the clinic${contact ? ` at ${contact}` : ''} straight away.</p>`),
    });
  }

  /** To the account holder, after an Admin took a record out of it. No name and no reason. */
  sendRecordUnlinked({ to, firstName }) {
    const contact = [env.CLINIC_PHONE, env.CLINIC_EMAIL].filter(Boolean).map(escapeHtml).join(' or ');
    return sendEmail({
      to,
      subject: `A patient record was removed from your ${clinicName()} account`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0 0 12px;">The clinic has removed a patient record from your portal account.</p>
        <p style="margin:0;color:#475569;">If this is unexpected, contact the front desk${contact ? ` at ${contact}` : ''}.</p>`),
    });
  }

  sendPasswordChanged({ to, firstName }) {
    const contact = [env.CLINIC_PHONE, env.CLINIC_EMAIL].filter(Boolean).map(escapeHtml).join(' or ');
    return sendEmail({
      to,
      subject: `Your ${clinicName()} password was changed`,
      html: frame(`
        ${greeting(firstName)}
        <p style="margin:0 0 12px;">
          The password for your account was just changed, and every device that was signed in has been signed out.
        </p>
        <p style="margin:0;color:#475569;">
          If this was not you, reset your password from the sign-in page straight away${contact ? `, and tell the clinic at ${contact}` : ''}.
        </p>`),
    });
  }
}

module.exports = new AccountEmailService();
