import React from 'react';
import { printElement } from '../lib/printArea';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from './ui/button';
import { Printer, CheckCircle2, Wallet, ShieldCheck } from 'lucide-react';
import AppointmentTime from './ui/appointment-time';
import { formatCurrency } from '../lib/currency';
import DataBadge from './ui/data-badge';

/**
 * What the patient sees the moment a booking succeeds.
 *
 * ── The QR is a receipt, not a booking confirmation ─────────────────────────────────────────
 *
 * This screen used to render the scannable pass unconditionally, which quietly contradicted the
 * rule everywhere else in the app: `AppointmentsTab` issues the pass only when `is_paid`, and
 * `appointmentRepository.findByPatientUserId` documents why. A booking is NEVER paid at the
 * instant it is created — payment happens afterwards — so this screen was the one place that
 * handed out a pass for money the clinic had not received.
 *
 * The damage was not that reception would honour it. It is that the patient reasonably stops
 * here: they have a QR, the screen says "present this at the front desk", and nothing on it
 * mentions paying. They arrive expecting to walk in.
 *
 * So the pass appears only when there is nothing left to settle. Otherwise the reference is
 * printed as TEXT — the counter path never depended on the QR — and the screen says what is
 * owed and where to pay it.
 */
const BookingConfirmation = ({
  referenceCode,
  queueNumber,
  patientName,
  scheduledDate,
  scheduledTime,
  slotMinutes = null,
  amountDue = 0,
  isHmo = false,
  onClose,
}) => {
  const owed = Number(amountDue) || 0;
  // An HMO booking is not the patient's to settle — the claim decides what, if anything, they
  // owe — so it gets its own message rather than a demand for money that may never be due.
  const awaitingPayment = !isHmo && owed > 0;
  const showPass = !awaitingPayment && !isHmo;

  return (
    <div className="space-y-5">
      {awaitingPayment ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <Wallet className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm font-bold">
            Slot reserved — pay {formatCurrency(owed)} to get your pass
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm font-bold">Appointment booked successfully!</span>
        </div>
      )}

      <div className="print-area space-y-4 rounded-2xl border border-line bg-surface p-5 text-center">
        <div className="space-y-0.5">
          <h3 className="m-0 text-sm font-extrabold uppercase tracking-wide text-slate-900">
            Enlogada Ultrasound &amp; Diagnostic Clinic
          </h3>
          <p className="m-0 text-xs text-gray-500">Appointment Confirmation</p>
        </div>

        {showPass ? (
          <>
            <div className="flex justify-center py-2">
              <div
                data-testid="booking-pass-qr"
                className="inline-block rounded-xl border border-gray-200 bg-surface p-3"
              >
                <QRCodeSVG value={referenceCode} size={144} />
              </div>
            </div>
            <p className="m-0 text-fine text-gray-400">
              Present this code at the front desk, or let reception scan it on arrival.
            </p>
          </>
        ) : (
          /* Deliberately NOT a greyed-out or blurred QR. A pass that looks present but disabled
             reads as a loading failure, and a patient will keep waiting for it to resolve. There
             is simply no pass yet, and the screen says what produces one. */
          <div
            data-testid={isHmo ? 'booking-hmo-review' : 'booking-awaiting-payment'}
            className="space-y-2 rounded-xl border border-line bg-slate-50 px-4 py-4 text-left"
          >
            <p className="m-0 flex items-center gap-1.5 text-note font-bold text-slate-900">
              {isHmo ? (
                <ShieldCheck className="h-4 w-4 flex-shrink-0 text-azure-600" aria-hidden="true" />
              ) : (
                <Wallet className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
              )}
              {isHmo ? 'Your HMO claim is being reviewed' : 'Your pass appears once payment is confirmed'}
            </p>
            <p className="m-0 text-fine leading-relaxed text-slate-600">
              {isHmo ? (
                <>
                  The clinic checks your coverage before your visit. Bring your HMO card and the
                  reference below — reception will look it up at the front desk.
                </>
              ) : (
                <>
                  Open <strong>Appointments</strong> to pay {formatCurrency(owed)} into the
                  clinic&apos;s GCash or bank account and upload your confirmation. A cashier checks
                  it, and your scannable pass appears there. You can also pay at the counter on the
                  day.
                </>
              )}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div className="space-y-0.5">
            <span className="field-label">Reference Code</span>
            <DataBadge variant="reference" label="Reference code" copyable>{referenceCode}</DataBadge>
          </div>
          <div className="space-y-0.5">
            <span className="field-label">Queue Ticket</span>
            <span className="text-lg font-extrabold text-brand-600">{queueNumber}</span>
          </div>
        </div>

        {awaitingPayment && (
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div className="space-y-0.5">
              <span className="field-label">Amount Due</span>
              <span className="text-lg font-extrabold tabular-nums text-slate-900">
                {formatCurrency(owed)}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="field-label">Status</span>
              <span className="text-sm font-extrabold text-amber-700">Awaiting payment</span>
            </div>
          </div>
        )}

        {(patientName || scheduledDate) && (
          <div className="space-y-0.5 border-t border-line pt-3 text-xs text-gray-500">
            {patientName && <p className="m-0 font-semibold">{patientName}</p>}
            {scheduledDate && (
              <div className="m-0 space-y-1">
                <p className="m-0 font-semibold text-ink">{scheduledDate}</p>
                {/* Two named times, not one. [1.63.0] This said "at 9:00 AM" and a patient read
                    that as when to turn up — so they arrived at 9:00, queued to check in, and
                    their 9:00 slot started late through nobody's fault. */}
                <AppointmentTime scheduledTime={scheduledTime} slotMinutes={slotMinutes} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => printElement()}
          className="flex items-center space-x-1.5 text-xs font-bold"
        >
          <Printer className="h-3.5 w-3.5" />
          <span>Print</span>
        </Button>
        <Button type="button" onClick={onClose} className="text-xs font-bold">
          Done
        </Button>
      </div>
    </div>
  );
};

export default BookingConfirmation;
