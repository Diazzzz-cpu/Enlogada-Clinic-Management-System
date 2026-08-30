const fs = require('fs');
const path = require('path');
const env = require('../config/environment');
const logger = require('../config/logger');
const { UPLOAD_ROOT } = require('../config/upload');

/**
 * The released-result email: its letterhead, its report table, and its attachment. [1.61.0]
 *
 * Split out of resultService because that file is about the clinical workflow — who authorised a
 * release, whether a visit is finished — and this is a document. Mixing a 60-line HTML template
 * into the middle of the release transaction made both harder to read.
 *
 * ── Why the report travels in the body AND as an attachment ─────────────────────────────────
 *
 * Both, not one or the other. An attachment a patient cannot open on their phone is no report at
 * all; a body with no document is not something a referring physician will accept. The clinic's
 * own data settled it: 41 released results, 41 with findings text, 40 with an uploaded PDF — so
 * either alone would have failed some patient.
 */

/**
 * Every value interpolated here comes from the database — a technician's free-text findings, a
 * patient's name as reception typed it. An apostrophe is ordinary in both, and an angle bracket
 * in findings ("<0.5 mmol/L") is ordinary too. Escaping is what keeps that rendering as text
 * rather than as markup the mail client tries to interpret.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Local date, never toISOString — that reports the UTC day, which in PHT is yesterday's. */
function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Age at the time of the examination, which is the age the reference range was read against. */
function ageAt(birthdate, onDate) {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(born.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - born.getFullYear();
  const m = at.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * The clinic's letterhead and a confidentiality footer around whatever the caller supplies.
 *
 * Inline styles throughout, and a table for the outer frame: mail clients strip <style> blocks
 * and most have no flexbox worth relying on. This is deliberately not how the rest of the app is
 * written — email is a different medium with a 1999 rendering engine, and pretending otherwise
 * produces a report that looks correct in the browser and broken in Outlook.
 */
function wrapEmail(inner) {
  return `
<div style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr>
      <td style="padding:20px 24px;background:#769046;color:#ffffff;">
        <div style="font-size:17px;font-weight:bold;">${escapeHtml(env.CLINIC_NAME)}</div>
        <div style="font-size:12px;opacity:0.9;margin-top:3px;">${escapeHtml(env.CLINIC_ADDRESS)}</div>
        <div style="font-size:12px;opacity:0.9;">${escapeHtml(env.CLINIC_PHONE)} &nbsp;·&nbsp; ${escapeHtml(env.CLINIC_EMAIL)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
        ${inner}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;
                 font-size:11px;line-height:1.5;color:#64748b;">
        This message and any attachment contain confidential medical information intended only for
        the named patient. If you received it in error, please delete it and tell us at
        ${escapeHtml(env.CLINIC_EMAIL)}.
      </td>
    </tr>
  </table>
</div>`;
}

/**
 * Who this report is about, and when the examination happened.
 *
 * Age and sex are on it because they band the reference range a clinician reads the findings
 * against — a report naming neither is a page of numbers that cannot be interpreted. The date of
 * the EXAMINATION, not of the release: they are often different days and only one of them is
 * clinically meaningful.
 */
function reportTable(info) {
  const age = ageAt(info.birthdate, info.visit_date);
  const rows = [
    ['Patient', `${info.first_name} ${info.last_name}`],
    ['Age / Sex', [age === null ? null : `${age} years`, info.sex].filter(Boolean).join(' / ') || '—'],
    ['Examination', info.test_name],
    ['Department', info.category_name],
    ['Date of examination', formatDate(info.visit_date)],
    ['Date released', formatDate(info.released_at)],
  ];
  if (info.referring_physician) {
    rows.push([
      'Referring physician',
      info.referring_physician_prc
        ? `${info.referring_physician} (PRC ${info.referring_physician_prc})`
        : info.referring_physician,
    ]);
  }
  if (Number(info.version) > 1) rows.push(['Report version', `Amended · v${info.version}`]);

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;margin:18px 0;border-collapse:collapse;font-size:13px;">
    ${rows.map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top;width:40%;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:6px 0;color:#0f172a;font-weight:bold;">${escapeHtml(value)}</td>
      </tr>`).join('')}
  </table>`;
}

/**
 * The findings themselves.
 *
 * `white-space:pre-wrap` because a technician's line breaks are part of the report — a list of
 * analytes collapsed into one paragraph is a different document. Escaped first, so a "<" in a
 * value stays a "<".
 */
function findingsBlock(info) {
  const findings = (info.findings || '').trim();
  const remarks = (info.remarks || '').trim();
  if (!findings && !remarks) {
    return `<p style="margin:18px 0;padding:12px 14px;background:#f8fafc;border-radius:6px;color:#475569;">
              The written findings for this examination are in the attached report.
            </p>`;
  }

  return `
    ${findings ? `
      <div style="margin:18px 0 0;">
        <div style="font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;
                    color:#64748b;margin-bottom:6px;">Findings</div>
        <div style="padding:14px;background:#f8fafc;border-left:3px solid #769046;border-radius:6px;
                    white-space:pre-wrap;color:#0f172a;">${escapeHtml(findings)}</div>
      </div>` : ''}
    ${remarks ? `
      <div style="margin:16px 0 0;">
        <div style="font-size:11px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;
                    color:#64748b;margin-bottom:6px;">Remarks</div>
        <div style="padding:14px;background:#f8fafc;border-radius:6px;white-space:pre-wrap;
                    color:#0f172a;">${escapeHtml(remarks)}</div>
      </div>` : ''}`;
}

/**
 * The uploaded report document, if there is one and it is safe to attach.
 *
 * Three guards, and each has to hold:
 *
 *   CONTAINMENT   the path is rebuilt from UPLOAD_ROOT and re-checked with resolve(), the same
 *                 rule the download route follows. `file_path` is written by the server from
 *                 random hex, never from what a client sent, but a stored value is still an
 *                 input and the cost of being wrong here is emailing an arbitrary file off disk.
 *   EXISTENCE     a row can outlive its file — a restored database, a cleared uploads directory.
 *                 A missing file must degrade to "body only", never throw and lose the send.
 *   SIZE          Gmail refuses over 25MB and the message fails as a whole. A report that will
 *                 not send is worse than a report with no attachment, because the patient gets
 *                 nothing at all.
 *
 * Returns null rather than throwing on every failure, for the same reason: the findings are in
 * the body, so a patient still receives their report.
 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function resolveReportAttachment(info) {
  if (!info || !info.file_path) return null;

  try {
    const absolutePath = path.resolve(UPLOAD_ROOT, info.file_path);
    const root = path.resolve(UPLOAD_ROOT);
    if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
      logger.warn(`Refusing to attach a result file outside the upload root: ${info.file_path}`);
      return null;
    }
    if (!fs.existsSync(absolutePath)) {
      logger.warn(`Result file missing on disk, sending findings only: ${info.file_path}`);
      return null;
    }
    const { size } = fs.statSync(absolutePath);
    if (size > MAX_ATTACHMENT_BYTES) {
      logger.warn(`Result file too large to email (${size} bytes), sending findings only.`);
      return null;
    }

    // The name the PATIENT sees, built from the examination rather than reusing whatever the
    // technician's machine called the file. "laboratory-report-de jesus.pdf" tells the patient
    // nothing about which of their tests it is.
    const ext = path.extname(info.file_original_name || '') || path.extname(absolutePath) || '.pdf';
    const safeName = `${info.test_name} - ${info.first_name} ${info.last_name}`
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      filename: `${safeName}${ext}`,
      path: absolutePath,
      contentType: info.file_mime_type || 'application/octet-stream',
    };
  } catch (err) {
    logger.error('Could not attach the result file, sending findings only:', err);
    return null;
  }
}

module.exports = {
  escapeHtml,
  wrapEmail,
  reportTable,
  findingsBlock,
  resolveReportAttachment,
  MAX_ATTACHMENT_BYTES,
};
