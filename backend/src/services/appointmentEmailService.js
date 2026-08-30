const { sendEmail } = require('../config/email');
const { formatTime12 } = require('../constants/clockFormat');
const { ARRIVAL_LEAD_MINUTES, arrivalTimeFor } = require('../constants/scheduling');
const logger = require('../config/logger');

/**
 * What the patient receives about their own booking. [1.24.0]
 *
 * The system sent exactly two emails: a password reset, and a result release. Booking online
 * produced an in-app notification for *staff* and nothing at all for the patient — so the only
 * record of their appointment was a confirmation screen that vanished when they closed the tab,
 * taking the reference code the front desk asks for with it.
 *
 * That is the standard email a booking system sends, and its absence pushes work onto the clinic:
 * every patient who cannot find their reference becomes a phone call to reception.
 *
 * ── Preparation is the part that actually saves a visit ───────────────────────────────────────
 * A Fasting Blood Sugar needs eight hours without food; a pelvic ultrasound needs a full bladder.
 * A patient told neither arrives unable to be tested, and the slot is lost with them. The
 * instructions are included here because this is the message they will still have on the morning
 * of the appointment — the booking screen is not.
 *
 * ── Never throws, never blocks ────────────────────────────────────────────────────────────────
 * Every function here is called AFTER the booking has committed, and sendEmail already swallows
 * SMTP failures. A clinic with no SMTP configured gets a logged skip and a working booking, which
 * is the correct trade: the appointment is the thing that matters, the email is a courtesy.
 */

const CLINIC_NAME = 'Enlogada Ultrasound and Diagnostic Clinic';

/** A DATE/date-string as something a patient reads, not an ISO instant. */
const readableDate = (value) => {
  const d = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
};

// Was `.slice(0, 5)`, which printed 24-hour "09:30" while the screen said "9:30 AM" — the
// clinic quoting two different times for one appointment. [1.36.0]
const readableTime = (value) => formatTime12(value);

/** Bare-minimum HTML escaping. Test names and instructions are clinic-authored, not user input,
 *  but they land in an email body and a stray angle bracket should not break the layout. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const shell = (heading, inner) => `
  <div style="font-family: Arial, sans-serif; max-width: 560px; padding: 20px; color: #1e293b;">
    <h2 style="margin:0 0 16px;">${esc(heading)}</h2>
    ${inner}
    <p style="margin-top:24px;">Thank you,<br/><strong>${CLINIC_NAME}</strong></p>
  </div>
`;

const detailTable = ({ reference, date, time, queueNumber }) => `
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
    <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Reference</td>
        <td style="padding:4px 0;"><strong>${esc(reference)}</strong></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Date</td>
        <td style="padding:4px 0;"><strong>${esc(readableDate(date))}</strong></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Scheduled service time</td>
        <td style="padding:4px 0;"><strong>${esc(readableTime(time))}</strong></td></tr>
    ${arrivalTimeFor(time) ? `<tr><td style="padding:4px 16px 4px 0;color:#64748b;">Recommended arrival</td>
        <td style="padding:4px 0;"><strong>${esc(readableTime(arrivalTimeFor(time)))}</strong>
        <span style="color:#64748b;">for front-desk check-in</span></td></tr>` : ''}
    ${queueNumber ? `<tr><td style="padding:4px 16px 4px 0;color:#64748b;">Queue</td>
        <td style="padding:4px 0;"><strong>${esc(queueNumber)}</strong></td></tr>` : ''}
  </table>
`;

/**
 * Preparation instructions, one per test that has any.
 *
 * Rendered only when at least one test needs something. A "Preparation: none required" block on
 * every booking trains the patient to skip the section, which is precisely the wrong habit for
 * the one time it says do not eat.
 */
const preparationBlock = (tests = []) => {
  const needing = tests.filter((t) => t.preparation && String(t.preparation).trim());
  if (needing.length === 0) return '';

  return `
    <div style="margin:16px 0;padding:12px 14px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;">
      <p style="margin:0 0 8px;font-weight:bold;color:#92400e;">Before your appointment</p>
      <ul style="margin:0;padding-left:18px;color:#78350f;font-size:14px;">
        ${needing.map((t) => `<li style="margin-bottom:6px;"><strong>${esc(t.test_name || t.name)}</strong> — ${esc(t.preparation)}</li>`).join('')}
      </ul>
    </div>
  `;
};

const testList = (tests = []) => {
  if (!tests.length) return '';
  return `
    <p style="margin:16px 0 4px;font-weight:bold;">Tests booked</p>
    <ul style="margin:0;padding-left:18px;font-size:14px;">
      ${tests.map((t) => `<li>${esc(t.test_name || t.name)}</li>`).join('')}
    </ul>
  `;
};

class AppointmentEmailService {
  /** Sent once, immediately after a booking commits. */
  async sendBookingConfirmation({ to, patientName, reference, date, time, queueNumber, tests }) {
    if (!to) {
      // A walk-in registered at the desk has no account and no address. Not a failure.
      logger.debug('Booking confirmation skipped: no email address on the patient.');
      return { skipped: true };
    }

    return sendEmail({
      to,
      subject: `Your appointment on ${readableDate(date)} — ${CLINIC_NAME}`,
      html: shell(`Hello ${patientName},`, `
        <p>Your appointment is confirmed. Please keep this email — the reference below is what our
           front desk uses to check you in.</p>
        ${detailTable({ reference, date, time, queueNumber })}
        ${testList(tests)}
        ${preparationBlock(tests)}
        <p style="font-size:14px;">Please arrive about 10 minutes early. If you need to change or
           cancel this appointment, you can do it from your account.</p>
      `),
    });
  }

  /**
   * Sent when a booking moves — by the patient, or by reception on their behalf.
   *
   * The slots are `from` / `moved` rather than `from` / `to`, because `to` is already the
   * recipient. Naming both `to` is not a style question: destructuring took the second and the
   * address silently became a `{date, time}` object.
   */
  async sendRescheduleNotice({ to, patientName, reference, from, moved, queueNumber }) {
    if (!to) return { skipped: true };

    return sendEmail({
      to,
      subject: `Your appointment has moved to ${readableDate(moved.date)} — ${CLINIC_NAME}`,
      html: shell(`Hello ${patientName},`, `
        <p>Your appointment has been rescheduled.</p>
        <p style="font-size:14px;color:#64748b;margin:8px 0;">
          Was: ${esc(readableDate(from.date))} at ${esc(readableTime(from.time))}
        </p>
        ${detailTable({ reference, date: moved.date, time: moved.time, queueNumber })}
        <p style="font-size:14px;">Your reference code has <strong>not</strong> changed, so any
           booking pass you already have is still valid.</p>
      `),
    });
  }

  /**
   * Sent the day before. [1.25.0]
   *
   * Worth more here than in most booking systems, because this is where the preparation
   * instruction actually lands: "nothing to eat after 10pm tonight" is useful the evening before
   * and nearly useless at the moment of booking, which may have been three weeks earlier. The
   * clinic has been counting 'No Show' since the beginning with no tool against it; this is the
   * standard one.
   */
  async sendReminder({ to, patientName, reference, date, time, queueNumber, tests }) {
    if (!to) return { skipped: true };

    // Names the day rather than saying "tomorrow". The job can be run at any offset, so
    // "tomorrow" would simply be wrong at --days=2 — and it is ambiguous even at one day, since
    // an email sent at 23:50 and read at 00:10 means two different dates to writer and reader.
    return sendEmail({
      to,
      subject: `Reminder: your appointment on ${readableDate(date)} at ${readableTime(time)}`,
      html: shell(`Hello ${patientName},`, `
        <p>This is a reminder of your appointment on
           <strong>${esc(readableDate(date))}</strong> at <strong>${esc(readableTime(time))}</strong>.</p>
        ${detailTable({ reference, date, time, queueNumber })}
        ${preparationBlock(tests)}
        <p style="font-size:14px;">Please arrive by
           <strong>${esc(readableTime(arrivalTimeFor(time)) || readableTime(time))}</strong>
           (${ARRIVAL_LEAD_MINUTES} minutes before your scheduled time) for front-desk check-in,
           and bring a valid ID. If you can no longer make it, cancelling from your account frees
           the slot for someone else.</p>
      `),
    });
  }

  /** Sent when a booking is cancelled, so the patient has a record that it really was. */
  async sendCancellationNotice({ to, patientName, reference, date, time }) {
    if (!to) return { skipped: true };

    return sendEmail({
      to,
      subject: `Your appointment on ${readableDate(date)} has been cancelled`,
      html: shell(`Hello ${patientName},`, `
        <p>Your appointment on <strong>${esc(readableDate(date))}</strong> at
           <strong>${esc(readableTime(time))}</strong> (reference ${esc(reference)}) has been
           cancelled, and the slot has been released.</p>
        <p style="font-size:14px;">If this was not you, please contact the clinic — nobody will
           be expecting you at that time.</p>
      `),
    });
  }
  /**
   * Their online payment was accepted, so the booking pass now exists.
   *
   * ── Why this is an email and not a notification ────────────────────────────────────────────
   *
   * The patient portal has no notification bell. Writing an in-app notification for a Client
   * would produce a row nobody can ever see — so for a patient, email IS the channel, and the
   * portal card is where they look it up afterwards.
   *
   * That matters more here than for most messages: the patient has paid and is waiting on
   * something the clinic controls. Silence reads as "it did not go through", and the usual next
   * step is paying a second time.
   */
  async sendPaymentVerified({ to, patientName, reference, receiptNumber, amount }) {
    if (!to) {
      logger.debug('Payment verified email skipped: no email address on the patient.');
      return { skipped: true };
    }

    return sendEmail({
      to,
      subject: `Payment received — ${CLINIC_NAME}`,
      html: shell(`Hello ${patientName},`, `
        <p>We have checked your payment and your booking is confirmed. Your QR booking pass is now
           in your account — show it at the front desk when you arrive.</p>
        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Booking</td>
              <td style="padding:4px 0;"><strong>${esc(reference || '—')}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Receipt</td>
              <td style="padding:4px 0;"><strong>${esc(receiptNumber || '—')}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#64748b;">Amount</td>
              <td style="padding:4px 0;"><strong>${esc(amount || '')}</strong></td></tr>
        </table>
        <p style="font-size:14px;">Please arrive about 10 minutes early.</p>
      `),
    });
  }

  /**
   * Their online payment could not be confirmed, and why.
   *
   * The reason is the whole message. A patient told only "rejected" rings the clinic, and whoever
   * answers has to go and look it up — which is the same failure [1.27.0] fixed for HMO refusals.
   * The service refuses to record a rejection without one, so there is always something to say.
   */
  async sendPaymentRejected({ to, patientName, reference, reason }) {
    if (!to) {
      logger.debug('Payment rejected email skipped: no email address on the patient.');
      return { skipped: true };
    }

    return sendEmail({
      to,
      subject: `We could not confirm your payment — ${CLINIC_NAME}`,
      html: shell(`Hello ${patientName},`, `
        <p>We were not able to confirm the payment you sent for your booking
           ${reference ? `<strong>${esc(reference)}</strong>` : ''}. Nothing has been charged.</p>
        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:4px 16px 4px 0;color:#64748b;vertical-align:top;">Reason</td>
              <td style="padding:4px 0;"><strong>${esc(reason)}</strong></td></tr>
        </table>
        <p style="font-size:14px;">You can send the payment again from your account — sign in and
           open the booking to upload a new confirmation. Your appointment time is still reserved
           in the meantime, and you can also settle at the counter when you arrive.</p>
      `),
    });
  }
}

module.exports = new AppointmentEmailService();
